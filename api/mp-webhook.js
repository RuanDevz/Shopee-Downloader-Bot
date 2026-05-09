// api/mp-webhook.js
// -----------------------------------------------------------------------------
// Endpoint serverless que recebe notificações IPN/Webhook do Mercado Pago.
//
// Quando um pagamento muda de status, o MP faz um POST para esta URL com algo
// como `{ type: 'payment', data: { id: '12345' } }`. Buscamos o pagamento pela
// API do MP, verificamos se foi aprovado, e ativamos os 30 dias de premium.
//
// IMPORTANTE: o handler precisa responder 200 OK rapidamente — caso contrário
// o MP fará re-tentativas. Por isso, fazemos o trabalho síncrono (consultar
// pagamento + atualizar banco + avisar usuário no Telegram) mas com timeouts
// curtos no SDK do MP.
// -----------------------------------------------------------------------------

const crypto = require('crypto');
const bot = require('../src/bot');
const { getPayment } = require('../src/services/mercadopago');
const {
  approvePaymentAndActivatePremium,
  markPaymentStatus,
  getPaymentByExternalReference,
} = require('../src/services/db');

const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

/**
 * Valida a assinatura `x-signature` enviada pelo Mercado Pago, conforme
 * documentado em https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks#editor_4
 *
 * Formato esperado do header: "ts=1700000000,v1=hex..."
 *
 * Mensagem assinada (template):
 *   id:<dataId>;request-id:<x-request-id>;ts:<ts>;
 */
function verifyMpSignature(req) {
  if (!MP_WEBHOOK_SECRET) return true; // validação opcional

  const signatureHeader = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!signatureHeader || !requestId) return false;

  const parts = String(signatureHeader)
    .split(',')
    .reduce((acc, part) => {
      const [k, v] = part.split('=').map((s) => s && s.trim());
      if (k && v) acc[k] = v;
      return acc;
    }, {});

  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const dataId =
    (req.query && (req.query['data.id'] || req.query.id)) ||
    (req.body && req.body.data && req.body.data.id) ||
    '';

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const expected = crypto
    .createHmac('sha256', MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(v1, 'hex'),
    );
  } catch {
    return false;
  }
}

async function notifyUser(telegramId, premiumUntil) {
  const formatted = new Date(premiumUntil).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  await bot.telegram
    .sendMessage(
      telegramId,
      `✅ *Pagamento aprovado!*\n\n` +
        `💎 Plano *Premium* ativado!\n` +
        `Downloads *ilimitados* até *${formatted}*.\n\n` +
        `Pode mandar os links — sem cota, sem espera. 🚀`,
      { parse_mode: 'Markdown' },
    )
    .catch((err) =>
      console.error('[mp-webhook] falha ao notificar usuário:', err.message),
    );
}

async function notifyUserOnFailure(telegramId, status) {
  const msg =
    status === 'rejected'
      ? '❌ Seu pagamento foi *recusado*. Você pode tentar novamente com /upgrade.'
      : '⚠️ Seu pagamento foi *cancelado*. Use /upgrade quando quiser tentar de novo.';

  await bot.telegram
    .sendMessage(telegramId, msg, { parse_mode: 'Markdown' })
    .catch(() => {});
}

module.exports = async (req, res) => {
  // Health check.
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'mp-webhook' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  if (!verifyMpSignature(req)) {
    console.warn('[mp-webhook] assinatura inválida — rejeitando.');
    return res.status(401).json({ ok: false, error: 'Invalid signature' });
  }

  // SEMPRE responde 200 ao MP — depois processamos. Re-tentativas dele são
  // baseadas em 5xx; se respondêssemos 4xx/5xx ele bombardearia o endpoint.
  // Mas precisamos do `await` antes para a Vercel não matar a função.
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

  try {
    const topic = body?.type || body?.topic || req.query?.type;

    if (topic !== 'payment') {
      // merchant_order, plan, etc. — ignoramos por enquanto.
      console.log('[mp-webhook] ignorando topic:', topic);
      return res.status(200).json({ ok: true, ignored: true });
    }

    const paymentId =
      body?.data?.id || body?.resource || req.query?.['data.id'];
    if (!paymentId) {
      console.warn('[mp-webhook] sem payment id no payload:', body);
      return res.status(200).json({ ok: true, ignored: 'no payment id' });
    }

    const payment = await getPayment(String(paymentId));
    const externalReference = payment.external_reference;
    if (!externalReference) {
      console.warn('[mp-webhook] pagamento sem external_reference:', paymentId);
      return res.status(200).json({ ok: true, ignored: 'no external_ref' });
    }

    const status = payment.status; // 'approved' | 'rejected' | 'cancelled' | 'pending' | ...

    if (status === 'approved') {
      const result = await approvePaymentAndActivatePremium({
        externalReference,
        mpPaymentId: String(payment.id),
      });

      if (!result.alreadyApproved) {
        await notifyUser(result.payment.telegram_id, result.premiumUntil);
      }
    } else if (status === 'rejected' || status === 'cancelled') {
      await markPaymentStatus(externalReference, status, String(payment.id));
      const dbPayment = await getPaymentByExternalReference(externalReference);
      if (dbPayment) await notifyUserOnFailure(dbPayment.telegram_id, status);
    } else {
      // pending / in_process — só atualiza status no banco para auditoria.
      await markPaymentStatus(externalReference, status, String(payment.id));
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[mp-webhook] erro processando notificação:', error);
    // Mesmo em erro, devolvemos 200 pra evitar tempestade de retries do MP.
    // O log fica registrado no painel da Vercel para investigação.
    return res.status(200).json({ ok: true, error: error.message });
  }
};

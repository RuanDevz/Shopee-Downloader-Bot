// api/webhook.js
// -----------------------------------------------------------------------------
// Handler serverless da Vercel que recebe os updates do Telegram.
//
// O Telegram envia uma requisição POST para esta URL toda vez que o bot recebe
// uma mensagem. Aqui validamos um secret token (boa prática de segurança) e
// repassamos o update para o Telegraf processar.
//
// Importante:
// - NÃO usamos polling.
// - A função precisa responder rapidamente (200 OK), por isso o Telegraf é
//   chamado com `bot.handleUpdate(update)` e nada mais.
// -----------------------------------------------------------------------------

const bot = require('../src/bot');

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

module.exports = async (req, res) => {
  // Health check útil para conferir, no navegador, que o deploy está vivo.
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'telegram-shopee-bot',
      message: 'Webhook ativo. Envie updates via POST.',
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  // Validação do secret token. O Telegram envia o valor configurado em
  // setWebhook através do header `x-telegram-bot-api-secret-token`. Se o
  // secret estiver definido localmente, exigimos que ele bata.
  if (WEBHOOK_SECRET) {
    const incoming = req.headers['x-telegram-bot-api-secret-token'];
    if (incoming !== WEBHOOK_SECRET) {
      console.warn('[webhook] secret token inválido — rejeitando requisição.');
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  try {
    // A Vercel já faz o parse de JSON automaticamente em `req.body`.
    // Caso venha como string (ambientes não-Vercel), garantimos o parse.
    const update =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    await bot.handleUpdate(update);

    // Se o Telegraf não enviou resposta (ex.: nenhum middleware fez `res.end`),
    // garantimos um 200 OK para o Telegram não reenviar o update.
    if (!res.writableEnded) {
      res.status(200).json({ ok: true });
    }
  } catch (error) {
    console.error('[webhook] erro processando update:', error);
    if (!res.writableEnded) {
      res.status(200).json({ ok: true });
    }
  }
};

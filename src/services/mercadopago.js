// src/services/mercadopago.js
// -----------------------------------------------------------------------------
// Wrapper em torno do SDK oficial do Mercado Pago.
//
// O bot usa Checkout Pro: criamos uma "preference" e devolvemos a URL do
// init_point, que o usuário abre no navegador para pagar (PIX, cartão, boleto).
// Quando o pagamento muda de status, o MP chama nosso webhook (api/mp-webhook.js).
// -----------------------------------------------------------------------------

const crypto = require('crypto');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const BOT_USERNAME = process.env.BOT_USERNAME;

// Em centavos para evitar arredondamento de float.
const PREMIUM_PRICE_CENTS = parseInt(
  process.env.PREMIUM_PRICE_CENTS || '990',
  10,
);

if (!MP_ACCESS_TOKEN) {
  throw new Error('MP_ACCESS_TOKEN não definido no ambiente.');
}

if (!PUBLIC_BASE_URL) {
  throw new Error(
    'PUBLIC_BASE_URL não definido (ex.: https://seu-projeto.vercel.app).',
  );
}

const mpClient = new MercadoPagoConfig({
  accessToken: MP_ACCESS_TOKEN,
  options: { timeout: 10_000 },
});

const preferenceClient = new Preference(mpClient);
const paymentClient = new Payment(mpClient);

function buildExternalReference(telegramId) {
  // ID curto e único — usado para vincular pagamento ao usuário no webhook.
  return `tg-${telegramId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function buildBackUrl() {
  if (BOT_USERNAME) {
    return `https://t.me/${BOT_USERNAME.replace(/^@/, '')}`;
  }
  return PUBLIC_BASE_URL;
}

/**
 * Cria uma preferência Checkout Pro para o plano premium de 30 dias.
 * Retorna { externalReference, preferenceId, initPoint, amountCents }.
 */
async function createPremiumCheckout({ telegramId }) {
  const externalReference = buildExternalReference(telegramId);
  const amountReais = PREMIUM_PRICE_CENTS / 100;
  const backUrl = buildBackUrl();

  const preference = await preferenceClient.create({
    body: {
      items: [
        {
          id: 'premium-30d',
          title: 'Plano Premium 30 dias - Downloads ilimitados',
          description:
            'Acesso a downloads ilimitados de vídeos da Shopee por 30 dias.',
          quantity: 1,
          currency_id: 'BRL',
          unit_price: amountReais,
          category_id: 'services',
        },
      ],
      external_reference: externalReference,
      notification_url: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/api/mp-webhook`,
      back_urls: {
        success: backUrl,
        failure: backUrl,
        pending: backUrl,
      },
      auto_return: 'approved',
      statement_descriptor: 'SHOPEEBOT',
      metadata: { telegram_id: telegramId },
    },
  });

  return {
    externalReference,
    preferenceId: preference.id,
    initPoint: preference.init_point || preference.sandbox_init_point,
    amountCents: PREMIUM_PRICE_CENTS,
  };
}

/**
 * Consulta um pagamento pelo ID (usado no webhook quando o MP avisa "payment X mudou").
 */
async function getPayment(paymentId) {
  return paymentClient.get({ id: paymentId });
}

module.exports = {
  PREMIUM_PRICE_CENTS,
  createPremiumCheckout,
  getPayment,
};

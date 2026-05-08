// scripts/set-webhook.js
// -----------------------------------------------------------------------------
// Registra o webhook do bot no Telegram apontando para a Vercel.
//
// Uso:
//   1) Defina BOT_TOKEN, PUBLIC_URL e (opcional) TELEGRAM_WEBHOOK_SECRET no .env.
//   2) Rode: npm run set-webhook
// -----------------------------------------------------------------------------

require('dotenv').config();
const axios = require('axios');

async function main() {
  const { BOT_TOKEN, PUBLIC_URL, TELEGRAM_WEBHOOK_SECRET } = process.env;

  if (!BOT_TOKEN) throw new Error('BOT_TOKEN não definido no .env');
  if (!PUBLIC_URL) throw new Error('PUBLIC_URL não definido no .env');

  const webhookUrl = `${PUBLIC_URL.replace(/\/$/, '')}/api/webhook`;

  const payload = {
    url: webhookUrl,
    // Recebemos apenas o que o bot precisa — reduz tráfego.
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: true,
  };

  if (TELEGRAM_WEBHOOK_SECRET) {
    payload.secret_token = TELEGRAM_WEBHOOK_SECRET;
  }

  const { data } = await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`,
    payload,
  );

  console.log('Resposta do Telegram:', data);
  console.log(`\nWebhook registrado em: ${webhookUrl}`);
}

main().catch((err) => {
  console.error('Falha ao registrar webhook:', err.response?.data || err.message);
  process.exit(1);
});

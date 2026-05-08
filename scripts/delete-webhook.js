// scripts/delete-webhook.js
// -----------------------------------------------------------------------------
// Remove o webhook configurado no bot — útil ao trocar de domínio ou voltar
// a desenvolver localmente em modo polling.
// -----------------------------------------------------------------------------

require('dotenv').config();
const axios = require('axios');

async function main() {
  const { BOT_TOKEN } = process.env;
  if (!BOT_TOKEN) throw new Error('BOT_TOKEN não definido no .env');

  const { data } = await axios.post(
    `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`,
    { drop_pending_updates: true },
  );

  console.log('Resposta do Telegram:', data);
}

main().catch((err) => {
  console.error('Falha ao remover webhook:', err.response?.data || err.message);
  process.exit(1);
});

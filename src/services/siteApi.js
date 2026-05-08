// src/services/siteApi.js
// -----------------------------------------------------------------------------
// Cliente HTTP do site (shopeedownloader.com). Este é o ÚNICO ponto de contato
// do bot com o backend de usuários — sem banco local, sem cache, sem decisão
// de limite no bot. O servidor é a fonte da verdade:
//
//   POST /api/bot/link               → vincula telegram_id a um usuário do site
//   GET  /api/bot/users/:telegramId  → retorna { linked, premium, used, limit }
//   POST /api/bot/downloads          → tenta consumir 1 download (atômico)
//
// Toda requisição leva o header `X-Bot-Secret` com um segredo compartilhado.
// Sem ele, o site DEVE retornar 401.
// -----------------------------------------------------------------------------

const axios = require('axios');

const REQUEST_TIMEOUT_MS = 10_000;

function getConfig() {
  const baseUrl = process.env.SITE_API_URL;
  const apiKey = process.env.SITE_API_KEY;

  if (!baseUrl || !apiKey) {
    const err = new Error(
      'SITE_API_URL ou SITE_API_KEY não configurados nas variáveis de ambiente.',
    );
    err.code = 'SITE_CONFIG_MISSING';
    throw err;
  }

  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey };
}

function client() {
  const { baseUrl, apiKey } = getConfig();
  return axios.create({
    baseURL: baseUrl,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Bot-Secret': apiKey,
    },
    validateStatus: () => true, // tratamos status manualmente
  });
}

/**
 * Consome um token de deep-link (ex.: t.me/bot?start=TOKEN) e vincula o
 * usuário do site ao telegram_id.
 *
 * @param {{ token: string, telegramId: number, firstName?: string, username?: string }} args
 * @returns {Promise<{ premium: boolean, used: number, limit: number | null }>}
 */
async function linkAccount({ token, telegramId, firstName, username }) {
  const http = client();
  const { status, data } = await http.post('/api/bot/link', {
    token,
    telegram_id: telegramId,
    first_name: firstName,
    username,
  });

  if (status === 200 && data?.ok) {
    return {
      premium: !!data.premium,
      used: Number(data.used ?? 0),
      limit: data.limit ?? null,
    };
  }

  if (status === 404 || status === 410) {
    const err = new Error('Token de vínculo inválido ou expirado.');
    err.code = 'LINK_TOKEN_INVALID';
    throw err;
  }

  const err = new Error(`Falha ao vincular conta (HTTP ${status}).`);
  err.code = 'LINK_HTTP_ERROR';
  err.status = status;
  err.payload = data;
  throw err;
}

/**
 * Status do usuário (sem consumir cota).
 *
 * @param {number} telegramId
 * @returns {Promise<{ linked: boolean, premium: boolean, used: number, limit: number | null }>}
 */
async function getUserStatus(telegramId) {
  const http = client();
  const { status, data } = await http.get(
    `/api/bot/users/${encodeURIComponent(telegramId)}`,
  );

  if (status === 404) {
    return { linked: false, premium: false, used: 0, limit: null };
  }

  if (status === 200 && data?.ok) {
    return {
      linked: true,
      premium: !!data.premium,
      used: Number(data.used ?? 0),
      limit: data.limit ?? null,
    };
  }

  const err = new Error(`Falha ao consultar status (HTTP ${status}).`);
  err.code = 'STATUS_HTTP_ERROR';
  err.status = status;
  throw err;
}

/**
 * Tenta consumir 1 download para o usuário. O servidor decide se libera ou não
 * (atomicidade contra spam). Resposta esperada:
 *   200 { ok: true, allowed: true,  premium, used, limit, remaining }
 *   200 { ok: true, allowed: false, reason: "LIMIT_REACHED", used, limit }
 *   404                                 → telegram_id não vinculado
 *
 * @param {number} telegramId
 * @returns {Promise<{ allowed: boolean, reason?: string, premium: boolean, used: number, limit: number | null, remaining: number | null }>}
 */
async function registerDownload(telegramId) {
  const http = client();
  const { status, data } = await http.post('/api/bot/downloads', {
    telegram_id: telegramId,
  });

  if (status === 404) {
    const err = new Error('Usuário não vinculado.');
    err.code = 'NOT_LINKED';
    throw err;
  }

  if (status === 200 && data?.ok) {
    return {
      allowed: !!data.allowed,
      reason: data.reason,
      premium: !!data.premium,
      used: Number(data.used ?? 0),
      limit: data.limit ?? null,
      remaining: data.remaining ?? null,
    };
  }

  const err = new Error(`Falha ao registrar download (HTTP ${status}).`);
  err.code = 'DOWNLOAD_HTTP_ERROR';
  err.status = status;
  throw err;
}

module.exports = {
  linkAccount,
  getUserStatus,
  registerDownload,
};

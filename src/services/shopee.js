// src/services/shopee.js
// -----------------------------------------------------------------------------
// Camada de serviço que conversa com a API HTTP responsável por extrair o
// vídeo de uma URL da Shopee. A API em si é um endpoint comum (não usamos
// nenhum SDK do Supabase nem autenticação), portanto trabalhamos só com axios.
// -----------------------------------------------------------------------------

const axios = require('axios');

// Endpoint padrão. Pode ser sobrescrito via variável de ambiente SHOPEE_API_URL.
const DEFAULT_API_URL =
  'https://hwdahtwlpjlwrmkgimvq.supabase.co/functions/v1/shopee-extractor';

// Timeout em milissegundos para a chamada à API. Mantemos abaixo do limite
// da função serverless da Vercel para conseguirmos responder com elegância
// caso a API esteja lenta/offline.
const REQUEST_TIMEOUT_MS = 20_000;

// Regex usada para validar (de forma simples) se a string parece um link da Shopee.
// Cobre os domínios mais comuns:
//   - shopee.com.br, shopee.com, shopee.sg, s.shopee.com.br ...
//   - sho.pe (encurtador antigo)
//   - shp.ee / br.shp.ee (encurtador atual de compartilhamento, ex.: https://br.shp.ee/d2vuc39n)
const SHOPEE_URL_REGEX =
  /^https?:\/\/([a-z0-9-]+\.)*(shopee\.[a-z.]+|sho\.pe|shp\.ee)(\/[^\s]*)?$/i;

/**
 * Verifica se uma string é uma URL válida da Shopee.
 * @param {string} text
 * @returns {boolean}
 */
function isShopeeUrl(text) {
  if (typeof text !== 'string') return false;
  return SHOPEE_URL_REGEX.test(text.trim());
}

/**
 * Extrai os dados do vídeo a partir da URL da Shopee.
 *
 * @param {string} url URL da Shopee enviada pelo usuário.
 * @returns {Promise<{ videoUrl: string, cover?: string, caption?: string }>}
 * @throws {Error} Erro com `code` legível (ver ERROR_CODES).
 */
async function extractShopeeVideo(url) {
  const apiUrl = process.env.SHOPEE_API_URL || DEFAULT_API_URL;

  if (!isShopeeUrl(url)) {
    const err = new Error('URL inválida da Shopee.');
    err.code = 'INVALID_URL';
    throw err;
  }

  try {
    const { data } = await axios.post(
      apiUrl,
      { url },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        // Não jogamos exceção para 4xx/5xx automaticamente — tratamos abaixo.
        validateStatus: () => true,
      },
    );

    if (!data || data.success !== true || !data.videoUrl) {
      const err = new Error('A API não retornou um vídeo válido.');
      err.code = 'API_NO_VIDEO';
      err.payload = data;
      throw err;
    }

    return {
      videoUrl: data.videoUrl,
      cover: data.cover,
      caption: data.caption,
    };
  } catch (error) {
    // Repassa erros já normalizados acima.
    if (error.code === 'INVALID_URL' || error.code === 'API_NO_VIDEO') throw error;

    // Erros do axios: timeout, rede, DNS, etc.
    if (error.code === 'ECONNABORTED') {
      const err = new Error('A API demorou demais para responder.');
      err.code = 'TIMEOUT';
      throw err;
    }

    if (error.response) {
      const err = new Error(
        `A API respondeu com status ${error.response.status}.`,
      );
      err.code = 'API_HTTP_ERROR';
      err.status = error.response.status;
      throw err;
    }

    const err = new Error('Não foi possível conectar à API.');
    err.code = 'API_OFFLINE';
    err.cause = error;
    throw err;
  }
}

module.exports = {
  extractShopeeVideo,
  isShopeeUrl,
};

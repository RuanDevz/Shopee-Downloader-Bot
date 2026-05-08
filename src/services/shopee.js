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

/**
 * Baixa o vídeo da CDN para um Buffer, para depois fazer upload multipart
 * ao Telegram. Isso evita o limite de ~20MB que o Telegram aplica quando
 * recebe sendVideo com uma URL externa.
 *
 * @param {string} videoUrl
 * @returns {Promise<Buffer>}
 * @throws {Error} com `code` legível.
 */
async function downloadVideoBuffer(videoUrl) {
  // Telegram aceita até 50MB via Bot API (multipart). Cortamos um pouco antes
  // para não estourar.
  const MAX_BYTES = 49 * 1024 * 1024;

  try {
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      timeout: 25_000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      headers: {
        // Alguns CDNs bloqueiam clientes sem User-Agent.
        'User-Agent':
          'Mozilla/5.0 (compatible; ShopeeDownloaderBot/1.0; +https://shopeedownloader.com)',
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.5',
      },
    });

    return Buffer.from(response.data);
  } catch (error) {
    if (error.code === 'ECONNABORTED') {
      const err = new Error('Download do vídeo demorou demais.');
      err.code = 'VIDEO_DOWNLOAD_TIMEOUT';
      throw err;
    }
    if (error.message && error.message.includes('maxContentLength')) {
      const err = new Error('Vídeo maior que o limite suportado pelo Telegram (50MB).');
      err.code = 'VIDEO_TOO_LARGE';
      throw err;
    }
    const err = new Error('Falha ao baixar o vídeo da CDN.');
    err.code = 'VIDEO_DOWNLOAD_FAILED';
    err.cause = error;
    throw err;
  }
}

module.exports = {
  extractShopeeVideo,
  isShopeeUrl,
  downloadVideoBuffer,
};

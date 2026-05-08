// src/bot.js
// -----------------------------------------------------------------------------
// Configuração do bot do Telegram usando Telegraf.
//
// Este arquivo apenas EXPORTA a instância do bot — quem decide se vai rodar
// como webhook (na Vercel) ou em modo polling (localmente, opcional) é o
// `api/webhook.js` ou um runner local.
// -----------------------------------------------------------------------------

require('dotenv').config();

const { Telegraf } = require('telegraf');
const {
  extractShopeeVideo,
  isShopeeUrl,
  downloadVideoBuffer,
} = require('./services/shopee');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN não definido. Configure a variável de ambiente.');
}

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 25_000,
});

// ---------------------------------------------------------------------------
// /start — boas-vindas
// ---------------------------------------------------------------------------
bot.start(async (ctx) => {
  const name = ctx.from?.first_name || 'amigo(a)';
  await ctx.reply(
    `👋 Olá, ${name}!\n\n` +
      `Eu baixo vídeos da *Shopee* pra você. 🎬\n\n` +
      `📌 *Como usar:*\n` +
      `Cole aqui o link do vídeo (ex.: https://shopee.com.br/... ou https://br.shp.ee/...) ` +
      `e eu envio o arquivo prontinho pra você salvar.\n\n` +
      `Use /help se tiver dúvidas.`,
    { parse_mode: 'Markdown' },
  );
});

// ---------------------------------------------------------------------------
// /help — instruções rápidas
// ---------------------------------------------------------------------------
bot.help(async (ctx) => {
  await ctx.reply(
    `ℹ️ *Ajuda*\n\n` +
      `1️⃣ Copie o link do vídeo na Shopee.\n` +
      `2️⃣ Cole aqui no chat.\n` +
      `3️⃣ Aguarde alguns segundos — eu envio o vídeo.\n\n` +
      `Se algo der errado, tente novamente em instantes. 🙏`,
    { parse_mode: 'Markdown' },
  );
});

// ---------------------------------------------------------------------------
// Handler principal: qualquer texto enviado é tratado aqui.
// ---------------------------------------------------------------------------
bot.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim();

  // Ignora outros comandos não mapeados.
  if (text.startsWith('/')) return;

  if (!isShopeeUrl(text)) {
    await ctx.reply(
      `⚠️ Isso não parece ser um link da Shopee.\n\n` +
        `Envie uma URL no formato:\n` +
        `\`https://shopee.com.br/...\` ou \`https://br.shp.ee/...\``,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Mostra indicador nativo "enviando vídeo..." enquanto processa.
  const keepTyping = startChatAction(ctx, 'upload_video');

  try {
    console.log('[bot] solicitando extração:', { user: ctx.from?.id, url: text });

    // 1) Pega o videoUrl da API extratora.
    const { videoUrl, caption } = await extractShopeeVideo(text);

    // 2) Baixa o vídeo da CDN para um Buffer (evita o limite de ~20MB que
    //    o Telegram aplica quando recebe sendVideo com URL externa).
    console.log('[bot] baixando vídeo da CDN...');
    const buffer = await downloadVideoBuffer(videoUrl);
    console.log('[bot] vídeo baixado:', `${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

    // 3) Faz upload multipart para o Telegram.
    await ctx.replyWithVideo(
      { source: buffer, filename: 'shopee-video.mp4' },
      {
        caption: caption ? `🎬 ${caption}` : '🎬 Aqui está seu vídeo!',
        supports_streaming: true,
      },
    );
  } catch (error) {
    console.error('[bot] erro ao processar URL:', {
      code: error.code,
      message: error.message,
    });
    await ctx.reply(mapErrorToMessage(error), { parse_mode: 'Markdown' });
  } finally {
    keepTyping.stop();
  }
});

bot.catch((err, ctx) => {
  console.error('[bot] erro não tratado:', err);
  if (ctx && ctx.reply) {
    ctx
      .reply('😓 Ocorreu um erro inesperado. Por favor, tente novamente.')
      .catch(() => {});
  }
});

/**
 * Mantém o indicador "enviando vídeo..." aparecendo enquanto o bot processa.
 * O Telegram limpa o sendChatAction sozinho a cada ~5s, então renovamos.
 */
function startChatAction(ctx, action) {
  const tick = () => ctx.sendChatAction(action).catch(() => {});
  tick();
  const interval = setInterval(tick, 4500);
  return { stop: () => clearInterval(interval) };
}

function mapErrorToMessage(error) {
  switch (error.code) {
    case 'INVALID_URL':
      return '⚠️ Essa URL não parece válida. Verifique o link e tente novamente.';
    case 'TIMEOUT':
      return '⌛ A API demorou demais para responder. Tente de novo em instantes.';
    case 'API_OFFLINE':
      return '🚫 O serviço de extração está fora do ar agora. Tente mais tarde.';
    case 'API_HTTP_ERROR':
      return '😓 Houve um problema na API ao processar seu link. Tente outro vídeo.';
    case 'API_NO_VIDEO':
      return '🤔 Não consegui encontrar um vídeo nesse link. Confira se ele realmente contém um vídeo.';
    case 'VIDEO_DOWNLOAD_TIMEOUT':
      return '⌛ O vídeo demorou demais para baixar. Tente novamente em instantes.';
    case 'VIDEO_TOO_LARGE':
      return '📦 Esse vídeo é maior que o limite do Telegram (50MB). Baixe pelo site shopeedownloader.com';
    case 'VIDEO_DOWNLOAD_FAILED':
      return '😓 Não consegui baixar o vídeo da Shopee. Tente novamente.';
    default:
      return '❌ Algo deu errado. Tente novamente em alguns segundos.';
  }
}

module.exports = bot;

// src/bot.js
// -----------------------------------------------------------------------------
// Configuração do bot do Telegram usando Telegraf.
//
// Fluxo de premium/free:
//   1. O usuário clica em "Abrir no Telegram" no site shopeedownloader.com.
//      O site gera um token de uso único e abre t.me/<bot>?start=<token>.
//   2. O Telegram dispara /start <token> aqui — chamamos linkAccount() que
//      vincula o telegram_id ao user_id no banco do site.
//   3. A cada link que o usuário envia, chamamos registerDownload() ANTES de
//      extrair o vídeo. O site é quem decide se libera (premium = ilimitado;
//      free = até 10). Isso evita race conditions e mantém o contador no DB.
// -----------------------------------------------------------------------------

require('dotenv').config();

const { Telegraf } = require('telegraf');
const {
  extractShopeeVideo,
  isShopeeUrl,
  downloadVideoBuffer,
} = require('./services/shopee');
const {
  linkAccount,
  getUserStatus,
  registerDownload,
} = require('./services/siteApi');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SITE_URL = (process.env.SITE_PUBLIC_URL || 'https://shopeedownloader.com').replace(
  /\/$/,
  '',
);

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN não definido. Configure a variável de ambiente.');
}

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 25_000,
});

// ---------------------------------------------------------------------------
// /start — boas-vindas + vínculo via deep link
// ---------------------------------------------------------------------------
bot.start(async (ctx) => {
  const name = ctx.from?.first_name || 'amigo(a)';
  // Telegraf preenche `ctx.startPayload` com o que vier após "/start ".
  const token = (ctx.startPayload || '').trim();

  // Sem token → orienta o usuário a entrar pelo site.
  if (!token) {
    await ctx.reply(
      `👋 Olá, ${name}!\n\n` +
        `Para usar o bot, você precisa vincular sua conta do *Shopee Downloader*.\n\n` +
        `🔗 Acesse o site e clique em *Abrir no Telegram*:\n${SITE_URL}\n\n` +
        `Use /status para ver seu plano depois de vincular.`,
      { parse_mode: 'Markdown', disable_web_page_preview: true },
    );
    return;
  }

  // Com token → tenta vincular.
  try {
    const result = await linkAccount({
      token,
      telegramId: ctx.from.id,
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    });

    const planLine = result.premium
      ? '⭐ Plano: *Premium* — downloads ilimitados!'
      : `🆓 Plano: *Free* — ${result.used}/${result.limit ?? 10} downloads usados.`;

    await ctx.reply(
      `✅ Conta vinculada com sucesso, ${name}!\n\n` +
        `${planLine}\n\n` +
        `Agora é só me enviar o link de qualquer vídeo da Shopee. 🎬`,
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    console.error('[bot] erro ao vincular conta:', error.code, error.message);
    if (error.code === 'LINK_TOKEN_INVALID') {
      await ctx.reply(
        `⚠️ Esse link de vínculo expirou ou já foi usado.\n\n` +
          `Volte ao site e clique novamente em *Abrir no Telegram*:\n${SITE_URL}`,
        { parse_mode: 'Markdown', disable_web_page_preview: true },
      );
    } else {
      await ctx.reply(
        '😓 Não consegui vincular sua conta agora. Tente novamente em instantes.',
      );
    }
  }
});

// ---------------------------------------------------------------------------
// /help — instruções rápidas
// ---------------------------------------------------------------------------
bot.help(async (ctx) => {
  await ctx.reply(
    `ℹ️ *Ajuda*\n\n` +
      `1️⃣ Vincule sua conta entrando pelo site:\n${SITE_URL}\n` +
      `2️⃣ Cole o link do vídeo da Shopee aqui no chat.\n` +
      `3️⃣ Aguarde alguns segundos — eu envio o vídeo.\n\n` +
      `📊 /status — ver seu plano e downloads restantes.`,
    { parse_mode: 'Markdown', disable_web_page_preview: true },
  );
});

// ---------------------------------------------------------------------------
// /status — mostra plano e cota
// ---------------------------------------------------------------------------
bot.command('status', async (ctx) => {
  try {
    const status = await getUserStatus(ctx.from.id);

    if (!status.linked) {
      await ctx.reply(
        `🔒 Sua conta ainda não está vinculada.\n\n` +
          `Acesse ${SITE_URL} e clique em *Abrir no Telegram* para começar.`,
        { parse_mode: 'Markdown', disable_web_page_preview: true },
      );
      return;
    }

    if (status.premium) {
      await ctx.reply('⭐ Você é *Premium* — downloads ilimitados!', {
        parse_mode: 'Markdown',
      });
      return;
    }

    const limit = status.limit ?? 10;
    const remaining = Math.max(0, limit - status.used);
    await ctx.reply(
      `🆓 Plano *Free*\n\n` +
        `📥 Downloads usados: *${status.used}/${limit}*\n` +
        `✨ Restantes: *${remaining}*\n\n` +
        (remaining === 0
          ? `Para downloads ilimitados, faça upgrade em ${SITE_URL}`
          : `Quando acabar, faça upgrade em ${SITE_URL}`),
      { parse_mode: 'Markdown', disable_web_page_preview: true },
    );
  } catch (error) {
    console.error('[bot] erro em /status:', error.code, error.message);
    await ctx.reply('😓 Não consegui consultar seu status agora.');
  }
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

  // 1) Pede ao site para autorizar o download (atômico — sem race condition).
  let quota;
  try {
    quota = await registerDownload(ctx.from.id);
  } catch (error) {
    console.error('[bot] erro ao registrar download:', error.code, error.message);
    if (error.code === 'NOT_LINKED') {
      await ctx.reply(
        `🔒 Sua conta ainda não está vinculada.\n\n` +
          `Acesse ${SITE_URL} e clique em *Abrir no Telegram* para liberar os downloads.`,
        { parse_mode: 'Markdown', disable_web_page_preview: true },
      );
      return;
    }
    await ctx.reply('😓 Não consegui validar sua conta agora. Tente de novo em instantes.');
    return;
  }

  // 2) Limite atingido para usuário free.
  if (!quota.allowed) {
    const limit = quota.limit ?? 10;
    await ctx.reply(
      `🚫 Você atingiu o limite gratuito de *${limit} downloads*.\n\n` +
        `⭐ Faça upgrade para *Premium* e tenha downloads ilimitados:\n${SITE_URL}`,
      { parse_mode: 'Markdown', disable_web_page_preview: true },
    );
    return;
  }

  // 3) Autorizado — mostra indicador nativo "enviando vídeo..." e processa.
  // Não mandamos mensagem de status: o sendChatAction já dá o feedback visual,
  // e o usuário só vê o vídeo aparecer (sem mensagem extra "presa" no chat).
  const keepTyping = startChatAction(ctx, 'upload_video');

  try {
    console.log('[bot] solicitando extração:', {
      user: ctx.from?.id,
      premium: quota.premium,
      used: quota.used,
      limit: quota.limit,
    });

    // 3.1) Pega o videoUrl da API extratora.
    const { videoUrl, caption } = await extractShopeeVideo(text);

    // 3.2) Baixa o vídeo da CDN para um Buffer. Isso é fundamental:
    // se passássemos só a URL ao Telegram, ele tentaria buscar a CDN e
    // falharia em vídeos > ~20MB ou quando a CDN exige headers.
    console.log('[bot] baixando vídeo da CDN...');
    const buffer = await downloadVideoBuffer(videoUrl);
    console.log('[bot] vídeo baixado:', `${(buffer.length / 1024 / 1024).toFixed(2)}MB`);

    let captionText = caption ? `🎬 ${caption}` : '🎬 Aqui está seu vídeo!';
    if (!quota.premium && quota.remaining !== null) {
      captionText += `\n\n📊 Downloads restantes: ${quota.remaining}`;
    }

    // 3.3) Faz upload multipart para o Telegram.
    await ctx.replyWithVideo(
      { source: buffer, filename: 'shopee-video.mp4' },
      {
        caption: captionText,
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

/**
 * Mantém o indicador "enviando vídeo..." aparecendo enquanto o bot processa.
 * O Telegram limpa o sendChatAction sozinho a cada ~5s, então renovamos.
 *
 * @param {import('telegraf').Context} ctx
 * @param {'upload_video' | 'upload_document' | 'typing'} action
 */
function startChatAction(ctx, action) {
  const tick = () => ctx.sendChatAction(action).catch(() => {});
  tick();
  const interval = setInterval(tick, 4500);
  return {
    stop: () => clearInterval(interval),
  };
}

bot.catch((err, ctx) => {
  console.error('[bot] erro não tratado:', err);
  if (ctx && ctx.reply) {
    ctx
      .reply('😓 Ocorreu um erro inesperado. Por favor, tente novamente.')
      .catch(() => {});
  }
});

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
      return '📦 Esse vídeo é maior que o limite do Telegram (50MB). Tente outro.';
    case 'VIDEO_DOWNLOAD_FAILED':
      return '😓 Não consegui baixar o vídeo da Shopee. Tente novamente.';
    default:
      return '❌ Algo deu errado. Tente novamente em alguns segundos.';
  }
}

module.exports = bot;

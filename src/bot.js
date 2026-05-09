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
const {
  FREE_DAILY_LIMIT,
  PREMIUM_DURATION_DAYS,
  isPremiumActive,
  getOrCreateUser,
  checkDownloadAllowance,
  registerDownload,
  createPendingPayment,
} = require('./services/db');
const {
  PREMIUM_PRICE_CENTS,
  createPremiumCheckout,
} = require('./services/mercadopago');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN não definido. Configure a variável de ambiente.');
}

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 25_000,
});

function priceLabel() {
  const reais = (PREMIUM_PRICE_CENTS / 100).toFixed(2).replace('.', ',');
  return `R$ ${reais}`;
}

function formatBRDate(date) {
  return new Date(date).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

// ---------------------------------------------------------------------------
// Função utilitária para manter o indicador "enviando..." aparecendo
// ---------------------------------------------------------------------------
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

async function ensureUser(ctx) {
  return getOrCreateUser({
    telegramId: ctx.from.id,
    firstName: ctx.from.first_name,
    username: ctx.from.username,
  });
}

function buildLimitReachedMessage() {
  return (
    `🚫 *Limite diário atingido!*\n\n` +
    `Você já usou seus *${FREE_DAILY_LIMIT} downloads* gratuitos de hoje.\n\n` +
    `💎 *Plano Premium — ${priceLabel()}*\n` +
    `• Downloads *ilimitados* por *${PREMIUM_DURATION_DAYS} dias*\n` +
    `• Sem espera, sem cota diária\n\n` +
    `Use /upgrade para liberar agora.`
  );
}

// ---------------------------------------------------------------------------
// /start — boas-vindas
// ---------------------------------------------------------------------------
bot.start(async (ctx) => {
  await ensureUser(ctx).catch((err) =>
    console.error('[bot] erro criando usuário:', err),
  );

  const name = ctx.from?.first_name || 'amigo(a)';
  await ctx.reply(
    `👋 Olá, ${name}!\n\n` +
      `Eu baixo vídeos da *Shopee* pra você. 🎬\n\n` +
      `📌 *Como usar:*\n` +
      `Cole aqui o link do vídeo (ex.: https://shopee.com.br/... ou https://br.shp.ee/...) ` +
      `e eu envio o arquivo prontinho pra você salvar.\n\n` +
      `🆓 Plano gratuito: *${FREE_DAILY_LIMIT} downloads por dia*\n` +
      `💎 Plano Premium: *ilimitado por ${PREMIUM_DURATION_DAYS} dias* — use /upgrade\n\n` +
      `Use /status pra ver seu plano e /help pra dúvidas.`,
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
      `*Comandos:*\n` +
      `/status — ver seu plano e downloads restantes\n` +
      `/upgrade — assinar o Premium (${priceLabel()} / ${PREMIUM_DURATION_DAYS} dias ilimitado)\n\n` +
      `Se algo der errado, tente novamente em instantes. 🙏`,
    { parse_mode: 'Markdown' },
  );
});

// ---------------------------------------------------------------------------
// /status — mostra plano atual e cota restante
// ---------------------------------------------------------------------------
bot.command('status', async (ctx) => {
  try {
    const user = await ensureUser(ctx);

    if (isPremiumActive(user)) {
      await ctx.reply(
        `💎 *Plano: Premium*\n\n` +
          `Downloads: *ilimitados*\n` +
          `Válido até: *${formatBRDate(user.premium_until)}*\n\n` +
          `Aproveite! 🚀`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const used =
      user.last_download_date === today ? user.downloads_today : 0;
    const remaining = Math.max(0, FREE_DAILY_LIMIT - used);

    await ctx.reply(
      `🆓 *Plano: Gratuito*\n\n` +
        `Downloads hoje: *${used} / ${FREE_DAILY_LIMIT}*\n` +
        `Restantes: *${remaining}*\n\n` +
        `Quer ilimitado por ${PREMIUM_DURATION_DAYS} dias? Use /upgrade (${priceLabel()}).`,
      { parse_mode: 'Markdown' },
    );
  } catch (error) {
    console.error('[bot] erro em /status:', error);
    await ctx.reply('😓 Não consegui consultar seu plano agora. Tente de novo.');
  }
});

// ---------------------------------------------------------------------------
// /upgrade — gera link de pagamento do Mercado Pago
// ---------------------------------------------------------------------------
bot.command('upgrade', async (ctx) => {
  try {
    const user = await ensureUser(ctx);

    if (isPremiumActive(user)) {
      await ctx.reply(
        `💎 Você já tem Premium ativo!\n\n` +
          `Válido até: *${formatBRDate(user.premium_until)}*\n\n` +
          `Se quiser estender, é só pagar de novo — os 30 dias somam ao tempo restante.`,
        { parse_mode: 'Markdown' },
      );
    }

    const checkout = await createPremiumCheckout({ telegramId: ctx.from.id });

    await createPendingPayment({
      telegramId: ctx.from.id,
      externalReference: checkout.externalReference,
      preferenceId: checkout.preferenceId,
      amountCents: checkout.amountCents,
    });

    await ctx.reply(
      `💎 *Plano Premium — ${priceLabel()}*\n\n` +
        `✅ Downloads ilimitados\n` +
        `✅ Válido por *${PREMIUM_DURATION_DAYS} dias*\n` +
        `✅ PIX, cartão de crédito ou boleto\n\n` +
        `👇 Clique no link abaixo pra pagar:\n${checkout.initPoint}\n\n` +
        `_Assim que o pagamento for aprovado, eu te aviso aqui no chat e libero o acesso automaticamente._`,
      {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      },
    );
  } catch (error) {
    console.error('[bot] erro em /upgrade:', error);
    await ctx.reply(
      '😓 Não consegui gerar o link de pagamento agora. Tente novamente em instantes.',
    );
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

  // ---------- Checagem de cota / plano ANTES de qualquer trabalho pesado ----
  let user;
  try {
    user = await ensureUser(ctx);
  } catch (error) {
    console.error('[bot] erro carregando usuário:', error);
    await ctx.reply('😓 Falha ao verificar seu plano. Tente novamente.');
    return;
  }

  const allowance = await checkDownloadAllowance(user);
  if (!allowance.allowed) {
    await ctx.reply(buildLimitReachedMessage(), { parse_mode: 'Markdown' });
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

    // 4) Só registra consumo de cota DEPOIS que o vídeo foi enviado com
    //    sucesso — assim erros não consomem o limite do usuário.
    try {
      await registerDownload(user);
    } catch (err) {
      console.error('[bot] erro registrando download:', err);
    }

    // 5) Quando faltar pouco no plano free, lembra do upgrade.
    if (allowance.reason === 'free_quota') {
      const newRemaining = allowance.remaining - 1;
      if (newRemaining === 1) {
        await ctx.reply(
          `⚠️ Resta *1 download* hoje no plano gratuito.\n` +
            `Use /upgrade pra liberar ilimitado por ${PREMIUM_DURATION_DAYS} dias (${priceLabel()}).`,
          { parse_mode: 'Markdown' },
        );
      } else if (newRemaining === 0) {
        await ctx.reply(
          `🛑 Esse foi seu último download gratuito de hoje.\n` +
            `Pra continuar baixando, use /upgrade (${priceLabel()} / ${PREMIUM_DURATION_DAYS} dias ilimitado).`,
          { parse_mode: 'Markdown' },
        );
      }
    }
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

module.exports = bot;

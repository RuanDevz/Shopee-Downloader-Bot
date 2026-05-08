// src/bot.js
// -----------------------------------------------------------------------------
// Configuração do bot do Telegram usando Telegraf.
//
// Este arquivo apenas EXPORTA a instância do bot — quem decide se vai rodar
// como webhook (na Vercel) ou em modo polling (localmente, opcional) é o
// `api/webhook.js` ou um runner local. Manter o bot isolado deixa o handler
// serverless fino e fácil de testar.
// -----------------------------------------------------------------------------

require('dotenv').config();

const { Telegraf } = require('telegraf');
const { extractShopeeVideo, isShopeeUrl } = require('./services/shopee');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  // Falhamos cedo: sem token o bot não funciona.
  throw new Error('BOT_TOKEN não definido. Configure a variável de ambiente.');
}

const bot = new Telegraf(BOT_TOKEN, {
  // Importante em ambiente serverless: cada invocação é uma "vida" curta,
  // então damos um teto de tempo para o handler resolver.
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
      `Cole aqui o link do vídeo (ex.: https://shopee.com.br/...) ` +
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

  // Ignora outros comandos não mapeados — evita resposta confusa.
  if (text.startsWith('/')) return;

  if (!isShopeeUrl(text)) {
    await ctx.reply(
      `⚠️ Isso não parece ser um link da Shopee.\n\n` +
        `Envie uma URL no formato:\n` +
        `\`https://shopee.com.br/...\``,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  // Mensagem de feedback enquanto processamos. Guardamos a referência
  // para podermos editá-la (ou removê-la) depois.
  const statusMsg = await ctx.reply('⏳ Baixando vídeo... isso pode levar alguns segundos.');

  // Mostra "enviando vídeo..." na conversa do usuário (UX melhor).
  ctx.sendChatAction('upload_video').catch(() => {});

  try {
    console.log('[bot] solicitando extração:', { user: ctx.from?.id, url: text });

    const { videoUrl, caption } = await extractShopeeVideo(text);

    console.log('[bot] vídeo recebido, enviando ao usuário:', { videoUrl });

    await ctx.replyWithVideo(videoUrl, {
      caption: caption ? `🎬 ${caption}` : '🎬 Aqui está seu vídeo!',
      // supports_streaming permite reprodução enquanto baixa.
      supports_streaming: true,
    });

    // Limpa a mensagem de "Baixando vídeo..." para deixar o chat mais limpo.
    await ctx.telegram
      .deleteMessage(ctx.chat.id, statusMsg.message_id)
      .catch(() => {});
  } catch (error) {
    console.error('[bot] erro ao processar URL:', {
      code: error.code,
      message: error.message,
    });

    const friendly = mapErrorToMessage(error);

    // Edita a mensagem de status com a mensagem de erro amigável.
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, friendly, {
        parse_mode: 'Markdown',
      })
      .catch(async () => {
        // Se a edição falhar (mensagem expirada/apagada), enviamos uma nova.
        await ctx.reply(friendly, { parse_mode: 'Markdown' });
      });
  }
});

// ---------------------------------------------------------------------------
// Tratamento global — última linha de defesa para erros não previstos.
// ---------------------------------------------------------------------------
bot.catch((err, ctx) => {
  console.error('[bot] erro não tratado:', err);
  if (ctx && ctx.reply) {
    ctx
      .reply('😓 Ocorreu um erro inesperado. Por favor, tente novamente.')
      .catch(() => {});
  }
});

/**
 * Converte um erro do serviço em uma mensagem amigável para o usuário.
 * @param {Error & { code?: string }} error
 * @returns {string}
 */
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
    default:
      return '❌ Algo deu errado. Tente novamente em alguns segundos.';
  }
}

module.exports = bot;

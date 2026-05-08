# Telegram Shopee Bot

Bot de Telegram que recebe um link de vídeo da **Shopee** e devolve o arquivo de vídeo direto no chat, pronto para o usuário salvar.

- Stack: **Node.js + Telegraf + Axios + dotenv**
- Hospedagem: **Vercel (serverless)**
- Modo: **webhook** (não usa polling)

---

## Estrutura

```txt
telegram-shopee-bot/
├── api/
│   └── webhook.js          # Handler serverless da Vercel (recebe updates do Telegram)
├── scripts/
│   ├── set-webhook.js      # Registra o webhook no Telegram
│   └── delete-webhook.js   # Remove o webhook
├── src/
│   ├── bot.js              # Configuração do Telegraf, comandos e handlers
│   └── services/
│       └── shopee.js       # Cliente HTTP que consome a API extratora
├── .env.example
├── .gitignore
├── package.json
└── vercel.json
```

---

## 1. Instalação local

```bash
git clone <seu-repo>
cd telegram-shopee-bot
npm install
cp .env.example .env
```

Preencha o `.env`:

```env
BOT_TOKEN=123456:ABC...           # gerado no @BotFather
SHOPEE_API_URL=https://hwdahtwlpjlwrmkgimvq.supabase.co/functions/v1/shopee-extractor
TELEGRAM_WEBHOOK_SECRET=uma-string-aleatoria-bem-grande
PUBLIC_URL=https://seu-projeto.vercel.app
```

> Gere um secret forte com `openssl rand -hex 32` (ou qualquer gerador de strings aleatórias).

---

## 2. Como o bot funciona

1. O usuário envia um link da Shopee no chat.
2. O bot valida o formato da URL.
3. Faz `POST` para a API:
   ```
   POST https://hwdahtwlpjlwrmkgimvq.supabase.co/functions/v1/shopee-extractor
   { "url": "<link-da-shopee>" }
   ```
4. Espera a resposta:
   ```json
   {
     "success": true,
     "videoUrl": "https://video.mp4",
     "cover": "https://imagem.jpg",
     "caption": "descricao"
   }
   ```
5. Se `success === true`, envia o `videoUrl` ao usuário com `sendVideo` e usa o `caption` retornado.
6. Em caso de erro (timeout, URL inválida, API offline, vídeo não encontrado) responde com mensagem amigável.

---

## 3. Deploy na Vercel

### 3.1. Subir o projeto

Você pode usar o dashboard da Vercel **ou** a CLI:

```bash
npm i -g vercel
vercel              # primeira vez (linka o projeto)
vercel --prod       # publica em produção
```

### 3.2. Configurar variáveis de ambiente

No painel da Vercel: **Project → Settings → Environment Variables**

| Nome                       | Valor                                       |
| -------------------------- | ------------------------------------------- |
| `BOT_TOKEN`                | token do @BotFather                         |
| `SHOPEE_API_URL`           | URL da API extratora                        |
| `TELEGRAM_WEBHOOK_SECRET`  | string aleatória forte                      |

> **Não** coloque `PUBLIC_URL` na Vercel — ele só é usado pelo script local que registra o webhook.

Após salvar, faça **Redeploy** para que as variáveis entrem em vigor.

### 3.3. URL do webhook

A Vercel servirá o handler em:

```
https://<seu-projeto>.vercel.app/api/webhook
```

Abra essa URL no navegador — você deve ver:

```json
{ "ok": true, "service": "telegram-shopee-bot", "message": "Webhook ativo. Envie updates via POST." }
```

---

## 4. Configurar o webhook do Telegram

Com o `.env` preenchido (incluindo `PUBLIC_URL`), rode:

```bash
npm run set-webhook
```

Você verá algo como:

```json
{ "ok": true, "result": true, "description": "Webhook was set" }
```

Para confirmar pela API do Telegram, abra:

```
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

O campo `url` deve apontar para `https://<seu-projeto>.vercel.app/api/webhook`.

Para remover (ex.: voltar a desenvolver em polling local):

```bash
npm run delete-webhook
```

---

## 5. Comandos do bot

| Comando      | Descrição                                |
| ------------ | ---------------------------------------- |
| `/start`     | Boas-vindas e instruções básicas.        |
| `/help`      | Resumo de como usar o bot.               |
| (qualquer link) | Tenta extrair o vídeo da Shopee.      |

---

## 6. Boas práticas de segurança

- **Nunca** versione o `.env` — já está no `.gitignore`.
- Use `TELEGRAM_WEBHOOK_SECRET` para que somente o Telegram consiga acionar seu endpoint. O handler valida o header `x-telegram-bot-api-secret-token` e devolve `401` para chamadas não autenticadas.
- Mantenha o `BOT_TOKEN` apenas como **Environment Variable** na Vercel; nunca no código.
- Se o token vazar, revogue imediatamente em `@BotFather → /revoke`.
- A API que extrai os vídeos deve ter rate limiting; este bot já trata timeout/erros para não cascatear falhas.

---

## 7. Troubleshooting

| Sintoma                                         | O que checar                                           |
| ----------------------------------------------- | ------------------------------------------------------ |
| Bot não responde a nada                         | `getWebhookInfo` retorna a URL correta? Há `last_error_message`? |
| Resposta `Unauthorized` no log da Vercel        | `TELEGRAM_WEBHOOK_SECRET` precisa ser **idêntico** ao usado no `setWebhook`. |
| `BOT_TOKEN não definido`                        | Variável de ambiente não foi adicionada/redeployada na Vercel. |
| `A API demorou demais para responder`           | A função extratora pode estar fria; tentar novamente.  |
| `Não consegui encontrar um vídeo nesse link`    | O link enviado provavelmente não contém vídeo.         |

---

## Licença

MIT.

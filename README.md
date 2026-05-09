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
│   ├── webhook.js          # Handler serverless da Vercel (updates do Telegram)
│   └── mp-webhook.js       # Handler serverless (notificações do Mercado Pago)
├── scripts/
│   ├── set-webhook.js      # Registra o webhook no Telegram
│   ├── delete-webhook.js   # Remove o webhook
│   └── schema.sql          # Schema do Supabase (rodar uma vez)
├── src/
│   ├── bot.js              # Configuração do Telegraf, comandos e handlers
│   └── services/
│       ├── shopee.js       # Cliente HTTP que consome a API extratora
│       ├── db.js           # Acesso ao Supabase (usuários + cota + premium)
│       └── mercadopago.js  # SDK do Mercado Pago (Checkout Pro)
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

Preencha o `.env` (veja `.env.example` para a lista completa):

```env
# Telegram
BOT_TOKEN=123456:ABC...
BOT_USERNAME=ShopeeDownloaderBot
TELEGRAM_WEBHOOK_SECRET=uma-string-aleatoria-bem-grande
PUBLIC_URL=https://seu-projeto.vercel.app

# Shopee
SHOPEE_API_URL=https://hwdahtwlpjlwrmkgimvq.supabase.co/functions/v1/shopee-extractor

# Supabase (banco de usuários e pagamentos)
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOi...

# Mercado Pago (plano Premium)
MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxx
MP_WEBHOOK_SECRET=uma-string-aleatoria
PREMIUM_PRICE_CENTS=990
PUBLIC_BASE_URL=https://seu-projeto.vercel.app
```

> Gere secrets fortes com `openssl rand -hex 32` (ou qualquer gerador de strings aleatórias).

### 1.1. Preparar o Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **Project Settings → API**, copie a `URL` e a `service_role key`.
3. Abra o **SQL Editor**, cole o conteúdo de `scripts/schema.sql` e clique em *Run*.

### 1.2. Preparar o Mercado Pago

1. Acesse [developers.mercadopago.com.br](https://www.mercadopago.com.br/developers/panel/app) e crie uma aplicação.
2. Em **Credenciais de produção**, copie o `Access Token` para `MP_ACCESS_TOKEN`.
3. Em **Webhooks**, configure:
   - URL: `https://<seu-projeto>.vercel.app/api/mp-webhook`
   - Eventos: marque **"Pagamentos"** (`payment`).
   - Copie o secret gerado para `MP_WEBHOOK_SECRET`.

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

| Nome                       | Valor                                            |
| -------------------------- | ------------------------------------------------ |
| `BOT_TOKEN`                | token do @BotFather                              |
| `BOT_USERNAME`             | username do bot (sem @), usado no link de retorno |
| `SHOPEE_API_URL`           | URL da API extratora                             |
| `TELEGRAM_WEBHOOK_SECRET`  | string aleatória forte                           |
| `SUPABASE_URL`             | URL do projeto Supabase                          |
| `SUPABASE_SERVICE_KEY`     | service_role key do Supabase                     |
| `MP_ACCESS_TOKEN`          | Access Token de produção do Mercado Pago         |
| `MP_WEBHOOK_SECRET`        | secret do webhook configurado no painel do MP    |
| `PREMIUM_PRICE_CENTS`      | preço do plano em centavos (default `990`)       |
| `PUBLIC_BASE_URL`          | URL pública da Vercel (mesmo valor de `PUBLIC_URL`) |

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

| Comando         | Descrição                                                      |
| --------------- | -------------------------------------------------------------- |
| `/start`        | Boas-vindas e instruções básicas.                              |
| `/help`         | Resumo de como usar o bot.                                     |
| `/status`       | Mostra o plano atual e quantos downloads restam hoje.          |
| `/upgrade`      | Gera link de pagamento (Checkout Pro do Mercado Pago).         |
| (qualquer link) | Tenta extrair o vídeo da Shopee.                               |

### Planos

- **Gratuito**: 10 downloads por dia (reset diário automático).
- **Premium**: R$ 9,90 (configurável via `PREMIUM_PRICE_CENTS`) — downloads ilimitados por 30 dias. Ao expirar, o usuário volta ao plano gratuito automaticamente.

### Fluxo de pagamento

1. Usuário envia `/upgrade`.
2. Bot cria uma `Preference` no Mercado Pago e responde com o link de pagamento (PIX, cartão ou boleto).
3. Usuário paga.
4. Mercado Pago notifica `https://<seu-projeto>.vercel.app/api/mp-webhook`.
5. O webhook valida assinatura, consulta o pagamento, ativa 30 dias de premium e avisa o usuário no Telegram.

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

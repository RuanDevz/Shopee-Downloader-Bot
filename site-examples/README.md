# Integração site ↔ bot — exemplos

Estes arquivos vão **no projeto do site** (shopeedownloader.com), não no bot.

## Arquivos

| Origem | Destino no projeto Next.js |
| ------ | -------------------------- |
| `schema.sql` | Rodar no Postgres uma vez. |
| `next-app-router/api-bot-link.ts` | `app/api/bot/link/route.ts` |
| `next-app-router/api-bot-users.ts` | `app/api/bot/users/[telegramId]/route.ts` |
| `next-app-router/api-bot-downloads.ts` | `app/api/bot/downloads/route.ts` |
| `next-app-router/api-bot-issue-link-token.ts` | `app/api/bot/issue-link-token/route.ts` |
| `next-app-router/open-in-telegram-button.tsx` | Componente para o painel do usuário. |

## Variáveis de ambiente do site

| Nome | Descrição |
| ---- | --------- |
| `BOT_API_SECRET` | **Mesmo valor** de `SITE_API_KEY` no bot. Header `X-Bot-Secret`. |
| `POSTGRES_URL` (ou seu cliente) | Conexão com Postgres. |

## Fluxo end-to-end

```
[Site, usuário logado]
  └─ clica "Abrir no Telegram"
     └─ POST /api/bot/issue-link-token   →  cria bot_link_tokens(token, user_id, +10min)
        └─ window.location → t.me/<bot>?start=<token>

[Telegram → Bot]
  └─ /start <token>
     └─ bot POST {site}/api/bot/link  (X-Bot-Secret)
        └─ valida token, marca used_at, grava users.telegram_id
        └─ devolve { premium, used, limit }

[Telegram → Bot] (uso normal)
  └─ usuário cola link da Shopee
     └─ bot POST {site}/api/bot/downloads  (X-Bot-Secret)
        ├─ premium       → allowed: true (sem mexer no contador)
        └─ free + cota   → UPDATE atômico; allowed: true se incrementou
        └─ free + cheio  → allowed: false, reason: LIMIT_REACHED
     └─ se allowed → bot extrai vídeo e envia ao usuário
```

## Pontos críticos de segurança

1. **`BOT_API_SECRET`** precisa ser idêntico nos dois lados e nunca aparece no front.
2. Os endpoints `/api/bot/*` (exceto `issue-link-token`) **só** devem responder se o header `X-Bot-Secret` bater. Sem isso, qualquer um consome cota dos seus usuários.
3. Tokens de vínculo são de **uso único** e expiram em 10 minutos (`bot_link_tokens.expires_at`).
4. O contador é incrementado por **UPDATE atômico** com `WHERE downloads_used < FREE_LIMIT` — duas requisições simultâneas não conseguem ultrapassar o limite.
5. Se quiser permitir reset mensal da cota, basta um job que zere `downloads_used` (ou troque por uma tabela de janelas).

## Testando localmente

```bash
# No site, com o servidor Next rodando em http://localhost:3000:
curl -X GET http://localhost:3000/api/bot/users/123 \
  -H "X-Bot-Secret: $BOT_API_SECRET"

curl -X POST http://localhost:3000/api/bot/downloads \
  -H "X-Bot-Secret: $BOT_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"telegram_id":123}'
```

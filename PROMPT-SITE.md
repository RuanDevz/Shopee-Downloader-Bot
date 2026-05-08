# Prompt para integrar o site shopeedownloader.com com o bot do Telegram

Cole o conteúdo abaixo (a partir da linha `---`) como mensagem inicial em uma nova conversa do Claude **dentro do projeto do site** (Next.js + Postgres). Ele já carrega todo o contexto necessário — você não precisa explicar nada antes.

> Dica: rode esta conversa no diretório do site, não no diretório do bot. O Claude precisa enxergar o código do site para adaptar à autenticação e ao schema reais.

---

## Prompt (copiar tudo a partir daqui)

Olá Claude. Preciso integrar este site (shopeedownloader.com) com um **bot do Telegram** que já está em produção. O bot baixa vídeos da Shopee, mas hoje qualquer pessoa pode usar — quero que ele só funcione para usuários cadastrados aqui no site, com a regra:

- **Usuário Premium** → downloads ilimitados.
- **Usuário Free** → até 10 downloads (depois disso o bot bloqueia e mostra link para upgrade).

### Como o bot vai conversar com o site

O bot já está pronto e espera 4 endpoints HTTP no domínio do site, todos protegidos por um header `X-Bot-Secret` com um segredo compartilhado:

| Método | Rota                                | Quando o bot chama                                           |
| ------ | ----------------------------------- | ------------------------------------------------------------ |
| `POST` | `/api/bot/issue-link-token`         | Chamado pelo **site** (não pelo bot) quando o usuário clica em "Abrir no Telegram". Cria um token de uso único válido por 10 min. |
| `POST` | `/api/bot/link`                     | Chamado pelo bot quando o usuário entra via deep link `t.me/<bot>?start=<TOKEN>`. Valida o token e grava `telegram_id` no usuário. |
| `GET`  | `/api/bot/users/:telegramId`        | Chamado pelo bot ao receber `/status`. Retorna plano e cota. |
| `POST` | `/api/bot/downloads`                | Chamado pelo bot **antes de baixar cada vídeo**. Decide atomicamente se libera ou não, incrementando o contador. |

### Stack assumido

- **Next.js (App Router)** — rotas em `app/api/...`
- **Postgres** — adapte ao cliente que o projeto já usa (`@vercel/postgres`, `pg`, `drizzle`, `prisma`). Antes de implementar, **identifique qual o cliente atual** lendo o `package.json` e os imports existentes.
- **Auth existente** — identifique qual lib é usada (NextAuth, Clerk, Lucia, custom JWT) lendo o código. **Não invente** uma nova autenticação; apenas reutilize a função de sessão já existente.

### O que você precisa fazer

#### 1. Schema (SQL)

Crie/aplique uma migration que adiciona ao banco:

```sql
-- Adiciona colunas necessárias ao usuário (adapte o nome da tabela e o tipo de id ao real)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS downloads_used INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);

-- Tokens de uso único para vincular Telegram ↔ usuário do site
CREATE TABLE IF NOT EXISTS bot_link_tokens (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- Log opcional de auditoria
CREATE TABLE IF NOT EXISTS bot_downloads (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_downloads_user_created
  ON bot_downloads (user_id, created_at DESC);
```

> Adapte o tipo de `user_id` para bater com a coluna `id` real (pode ser `UUID`, `TEXT` etc.).

#### 2. Endpoints

Crie 4 arquivos. Os exemplos abaixo usam `@vercel/postgres` — **troque para o cliente real do projeto**.

**`app/api/bot/issue-link-token/route.ts`** — chamado pelo site quando o usuário logado clica no botão.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { randomBytes } from 'node:crypto';
// IMPORTANTE: troque essa import pela função de sessão real do projeto
// Ex.: import { auth } from '@/auth';

export async function POST(_req: NextRequest) {
  // const session = await auth();
  // const userId = session?.user?.id;
  const userId: string | number | null = null; // ← integrar com a auth real
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const token = randomBytes(24).toString('base64url');

  await sql`
    INSERT INTO bot_link_tokens (token, user_id, expires_at)
    VALUES (${token}, ${userId}, NOW() + INTERVAL '10 minutes')
  `;

  return NextResponse.json({ token });
}
```

**`app/api/bot/link/route.ts`** — chamado pelo bot.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FREE_LIMIT = 10;

export async function POST(req: NextRequest) {
  if (req.headers.get('x-bot-secret') !== process.env.BOT_API_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { token, telegram_id } = await req.json().catch(() => ({}));
  if (!token || !telegram_id) {
    return NextResponse.json({ ok: false, error: 'token e telegram_id obrigatórios' }, { status: 400 });
  }

  const { rows } = await sql`
    SELECT user_id FROM bot_link_tokens
    WHERE token = ${token} AND used_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `;
  const link = rows[0];
  if (!link) {
    return NextResponse.json({ ok: false, error: 'Token inválido/expirado' }, { status: 410 });
  }

  await sql`UPDATE users SET telegram_id = ${telegram_id} WHERE id = ${link.user_id}`;
  await sql`UPDATE bot_link_tokens SET used_at = NOW() WHERE token = ${token}`;

  const { rows: u } = await sql`
    SELECT is_premium, downloads_used FROM users WHERE id = ${link.user_id}
  `;
  const user = u[0];

  return NextResponse.json({
    ok: true,
    premium: !!user.is_premium,
    used: Number(user.downloads_used ?? 0),
    limit: user.is_premium ? null : FREE_LIMIT,
  });
}
```

**`app/api/bot/users/[telegramId]/route.ts`** — status do usuário.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FREE_LIMIT = 10;

export async function GET(req: NextRequest, { params }: { params: { telegramId: string } }) {
  if (req.headers.get('x-bot-secret') !== process.env.BOT_API_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const telegramId = Number(params.telegramId);
  if (!Number.isFinite(telegramId)) {
    return NextResponse.json({ ok: false, error: 'telegramId inválido' }, { status: 400 });
  }

  const { rows } = await sql`
    SELECT is_premium, downloads_used FROM users WHERE telegram_id = ${telegramId} LIMIT 1
  `;
  const user = rows[0];
  if (!user) return NextResponse.json({ ok: false, error: 'Não vinculado' }, { status: 404 });

  return NextResponse.json({
    ok: true,
    premium: !!user.is_premium,
    used: Number(user.downloads_used ?? 0),
    limit: user.is_premium ? null : FREE_LIMIT,
  });
}
```

**`app/api/bot/downloads/route.ts`** — gating atômico.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FREE_LIMIT = 10;

export async function POST(req: NextRequest) {
  if (req.headers.get('x-bot-secret') !== process.env.BOT_API_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { telegram_id } = await req.json().catch(() => ({}));
  const telegramId = Number(telegram_id);
  if (!Number.isFinite(telegramId)) {
    return NextResponse.json({ ok: false, error: 'telegram_id inválido' }, { status: 400 });
  }

  const { rows } = await sql`
    SELECT id, is_premium, downloads_used FROM users WHERE telegram_id = ${telegramId} LIMIT 1
  `;
  const user = rows[0];
  if (!user) return NextResponse.json({ ok: false, error: 'Não vinculado' }, { status: 404 });

  if (user.is_premium) {
    await sql`INSERT INTO bot_downloads (user_id) VALUES (${user.id})`;
    return NextResponse.json({
      ok: true, allowed: true, premium: true,
      used: Number(user.downloads_used ?? 0), limit: null, remaining: null,
    });
  }

  // UPDATE atômico: só incrementa se ainda houver cota.
  const { rows: updated } = await sql`
    UPDATE users SET downloads_used = downloads_used + 1
    WHERE id = ${user.id} AND downloads_used < ${FREE_LIMIT}
    RETURNING downloads_used
  `;

  if (updated.length === 0) {
    return NextResponse.json({
      ok: true, allowed: false, reason: 'LIMIT_REACHED', premium: false,
      used: FREE_LIMIT, limit: FREE_LIMIT, remaining: 0,
    });
  }

  const used = Number(updated[0].downloads_used);
  await sql`INSERT INTO bot_downloads (user_id) VALUES (${user.id})`;

  return NextResponse.json({
    ok: true, allowed: true, premium: false,
    used, limit: FREE_LIMIT, remaining: Math.max(0, FREE_LIMIT - used),
  });
}
```

#### 3. Botão "Abrir no Telegram"

Adicione ao painel/dashboard do usuário (a página onde ele já está logado). Onde colocar exatamente: **identifique no código a página de "minha conta" / dashboard atual** — provavelmente em `app/dashboard/page.tsx`, `app/(account)/...` ou similar — e ponha o botão lá num lugar de destaque.

```tsx
// components/OpenInTelegramButton.tsx
'use client';

import { useState } from 'react';

const BOT_USERNAME = 'shopee_downloader_bot'; // ⚠️ trocar pelo username real do bot

export function OpenInTelegramButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/bot/issue-link-token', { method: 'POST' });
      if (!res.ok) throw new Error('Falha');
      const { token } = await res.json();
      window.location.href = `https://t.me/${BOT_USERNAME}?start=${token}`;
    } catch {
      alert('Não foi possível abrir o Telegram agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded-lg bg-[#229ED9] hover:bg-[#1a85b8] disabled:opacity-60 px-6 py-3 text-white font-semibold inline-flex items-center gap-2 transition"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71l-4.14-3.06-2 1.94c-.23.23-.42.42-.83.42z" />
      </svg>
      {loading ? 'Abrindo…' : 'Abrir no Telegram'}
    </button>
  );
}
```

Use o componente:

```tsx
import { OpenInTelegramButton } from '@/components/OpenInTelegramButton';

// dentro do dashboard:
<section className="...">
  <h2>Bot do Telegram</h2>
  <p>Baixe vídeos direto pelo Telegram com sua conta vinculada.</p>
  <OpenInTelegramButton />
</section>
```

#### 4. Variáveis de ambiente

Adicione ao `.env.local` e à Vercel (Settings → Environment Variables):

```env
BOT_API_SECRET=<mesmo valor do SITE_API_KEY no projeto do bot>
```

⚠️ Esse valor precisa ser **idêntico** ao `SITE_API_KEY` configurado no projeto do bot. Sem ele os endpoints retornam 401.

### Regras importantes (não desviar)

1. **Não confie no bot**: o servidor é a fonte da verdade. O `UPDATE` atômico em `/api/bot/downloads` impede que dois requests simultâneos furem o limite.
2. **Token de vínculo**: uso único, 10 min de TTL, gerado com `crypto.randomBytes(24).toString('base64url')`.
3. **Header `X-Bot-Secret`**: obrigatório em todas as rotas `/api/bot/*` exceto `issue-link-token` (essa usa a sessão do site).
4. **Não exponha `BOT_API_SECRET` no frontend**. Ele só deve ser lido em código de servidor.
5. **Não invente schema de auth**. Reutilize o que já existe — leia o código primeiro.
6. **`FREE_LIMIT = 10`** está hardcoded em duas rotas. Se mudar o limite, mude nos dois lugares (ou extraia para `lib/bot.ts`).

### Como testar depois de implementar

```bash
# Substitua <SECRET> pelo valor real de BOT_API_SECRET.

# 1) Status (404 esperado se não houver usuário com esse telegram_id)
curl http://localhost:3000/api/bot/users/123 -H "X-Bot-Secret: <SECRET>"

# 2) Tentar download sem estar vinculado (404 esperado)
curl -X POST http://localhost:3000/api/bot/downloads \
  -H "X-Bot-Secret: <SECRET>" -H "Content-Type: application/json" \
  -d '{"telegram_id":123}'

# 3) Sem o header → deve retornar 401
curl http://localhost:3000/api/bot/users/123
```

Para testar o fluxo completo end-to-end:
1. Logar no site, abrir devtools, clicar no botão "Abrir no Telegram".
2. No banco, conferir que `bot_link_tokens` tem uma linha nova.
3. No Telegram, o `/start <token>` chega no bot e ele responde com "Conta vinculada com sucesso".
4. Na tabela `users`, conferir que `telegram_id` foi preenchido.
5. Mandar um link da Shopee no bot — o `bot_downloads` deve registrar uma linha e `users.downloads_used` deve incrementar (se não-premium).

### Antes de começar

Por favor, antes de escrever qualquer código, **leia o projeto** e me responda:

1. Qual cliente Postgres está em uso (`@vercel/postgres`, `pg`, `drizzle`, `prisma`)?
2. Qual lib de autenticação está em uso e como obter o user id da sessão?
3. Qual o nome real da tabela de usuários e o tipo do `id` (int / uuid / text)?
4. Onde fica a página do dashboard onde devo colocar o botão?

Com essas respostas eu adapto os trechos acima ao código real e implemento de uma vez.

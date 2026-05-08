// site-examples/next-app-router/api-bot-link.ts
// -----------------------------------------------------------------------------
// Coloque este arquivo em: app/api/bot/link/route.ts
//
// Endpoint chamado pelo bot quando o usuário entra via deep link
// (t.me/<bot>?start=<TOKEN>). Valida o token, marca como usado e grava
// o telegram_id no usuário correspondente.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres'; // ou seu cliente Postgres preferido

const FREE_LIMIT = 10;

function unauthorized(req: NextRequest) {
  return req.headers.get('x-bot-secret') !== process.env.BOT_API_SECRET;
}

export async function POST(req: NextRequest) {
  if (unauthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { token, telegram_id, first_name, username } = body ?? {};

  if (!token || !telegram_id) {
    return NextResponse.json(
      { ok: false, error: 'token e telegram_id são obrigatórios' },
      { status: 400 },
    );
  }

  // Busca o token (não usado e não expirado).
  const { rows } = await sql/* sql */ `
    SELECT user_id FROM bot_link_tokens
    WHERE token = ${token}
      AND used_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
  `;
  const link = rows[0];
  if (!link) {
    return NextResponse.json({ ok: false, error: 'Token inválido ou expirado' }, { status: 410 });
  }

  // Atualiza usuário e marca o token como usado, em uma transação implícita.
  // Se o telegram_id já estiver em uso por outro user, sobrescrevemos no mais
  // recente — adapte essa política se preferir o contrário.
  await sql/* sql */ `
    UPDATE users
       SET telegram_id = ${telegram_id}
     WHERE id = ${link.user_id}
  `;
  await sql/* sql */ `
    UPDATE bot_link_tokens
       SET used_at = NOW()
     WHERE token = ${token}
  `;

  const { rows: userRows } = await sql/* sql */ `
    SELECT is_premium, downloads_used FROM users WHERE id = ${link.user_id}
  `;
  const user = userRows[0];

  return NextResponse.json({
    ok: true,
    premium: !!user.is_premium,
    used: Number(user.downloads_used ?? 0),
    limit: user.is_premium ? null : FREE_LIMIT,
  });
}

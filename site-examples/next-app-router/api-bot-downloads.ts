// site-examples/next-app-router/api-bot-downloads.ts
// -----------------------------------------------------------------------------
// Coloque este arquivo em: app/api/bot/downloads/route.ts
//
// POST /api/bot/downloads
// O servidor é a fonte da verdade. Se o usuário é premium, sempre permite.
// Se é free, faz UPDATE atômico que só incrementa se ainda há cota — assim
// dois requests simultâneos não conseguem furar o limite.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FREE_LIMIT = 10;

export async function POST(req: NextRequest) {
  if (req.headers.get('x-bot-secret') !== process.env.BOT_API_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const telegramId = Number(body?.telegram_id);

  if (!Number.isFinite(telegramId)) {
    return NextResponse.json({ ok: false, error: 'telegram_id inválido' }, { status: 400 });
  }

  // Premium → sempre libera, sem mexer no contador.
  const { rows: premiumCheck } = await sql/* sql */ `
    SELECT id, is_premium, downloads_used
      FROM users
     WHERE telegram_id = ${telegramId}
     LIMIT 1
  `;
  const user = premiumCheck[0];
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Usuário não vinculado' }, { status: 404 });
  }

  if (user.is_premium) {
    // (opcional) registra log de auditoria
    await sql/* sql */ `INSERT INTO bot_downloads (user_id) VALUES (${user.id})`;
    return NextResponse.json({
      ok: true,
      allowed: true,
      premium: true,
      used: Number(user.downloads_used ?? 0),
      limit: null,
      remaining: null,
    });
  }

  // Free → UPDATE atômico: só incrementa se ainda houver cota.
  const { rows: updated } = await sql/* sql */ `
    UPDATE users
       SET downloads_used = downloads_used + 1
     WHERE id = ${user.id}
       AND downloads_used < ${FREE_LIMIT}
    RETURNING downloads_used
  `;

  if (updated.length === 0) {
    return NextResponse.json({
      ok: true,
      allowed: false,
      reason: 'LIMIT_REACHED',
      premium: false,
      used: FREE_LIMIT,
      limit: FREE_LIMIT,
      remaining: 0,
    });
  }

  const used = Number(updated[0].downloads_used);
  await sql/* sql */ `INSERT INTO bot_downloads (user_id) VALUES (${user.id})`;

  return NextResponse.json({
    ok: true,
    allowed: true,
    premium: false,
    used,
    limit: FREE_LIMIT,
    remaining: Math.max(0, FREE_LIMIT - used),
  });
}

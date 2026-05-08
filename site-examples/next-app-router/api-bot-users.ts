// site-examples/next-app-router/api-bot-users.ts
// -----------------------------------------------------------------------------
// Coloque este arquivo em: app/api/bot/users/[telegramId]/route.ts
//
// GET /api/bot/users/:telegramId
// Retorna o status atual do usuário (sem consumir cota).
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

const FREE_LIMIT = 10;

export async function GET(
  req: NextRequest,
  { params }: { params: { telegramId: string } },
) {
  if (req.headers.get('x-bot-secret') !== process.env.BOT_API_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const telegramId = Number(params.telegramId);
  if (!Number.isFinite(telegramId)) {
    return NextResponse.json({ ok: false, error: 'telegramId inválido' }, { status: 400 });
  }

  const { rows } = await sql/* sql */ `
    SELECT is_premium, downloads_used
      FROM users
     WHERE telegram_id = ${telegramId}
     LIMIT 1
  `;
  const user = rows[0];

  if (!user) {
    return NextResponse.json({ ok: false, error: 'Usuário não vinculado' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    premium: !!user.is_premium,
    used: Number(user.downloads_used ?? 0),
    limit: user.is_premium ? null : FREE_LIMIT,
  });
}

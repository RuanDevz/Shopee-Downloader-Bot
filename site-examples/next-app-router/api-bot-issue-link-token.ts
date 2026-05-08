// site-examples/next-app-router/api-bot-issue-link-token.ts
// -----------------------------------------------------------------------------
// Coloque este arquivo em: app/api/bot/issue-link-token/route.ts
//
// Endpoint chamado pelo BOTÃO "Abrir no Telegram" do site (não pelo bot!).
// Requer usuário logado — gera um token de uso único válido por 10 minutos.
// -----------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { randomBytes } from 'node:crypto';
// import { auth } from '@/auth'; // Substitua pela sua função de sessão (NextAuth, Clerk, etc.)

const TOKEN_TTL_MINUTES = 10;

export async function POST(_req: NextRequest) {
  // 1) Autenticação — usuário PRECISA estar logado no site.
  // const session = await auth();
  // if (!session?.user?.id) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // }
  // const userId = session.user.id;

  // ⚠️ Troque o bloco abaixo pela sua lógica real de sessão.
  const userId: number | null = null;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2) Gera token aleatório criptograficamente seguro.
  const token = randomBytes(24).toString('base64url');

  // 3) Persiste com TTL.
  await sql/* sql */ `
    INSERT INTO bot_link_tokens (token, user_id, expires_at)
    VALUES (
      ${token},
      ${userId},
      NOW() + INTERVAL '${TOKEN_TTL_MINUTES} minutes'
    )
  `;

  return NextResponse.json({ token });
}

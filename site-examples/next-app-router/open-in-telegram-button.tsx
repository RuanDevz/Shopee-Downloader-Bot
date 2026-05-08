// site-examples/next-app-router/open-in-telegram-button.tsx
// -----------------------------------------------------------------------------
// Botão "Abrir no Telegram" para colocar no painel do usuário no site.
//
// Fluxo:
//   1. Usuário (logado) clica no botão.
//   2. POST /api/bot/issue-link-token (server-side) cria um token de uso único
//      no Postgres com TTL de 10 min, vinculado ao user_id da sessão.
//   3. Redirecionamos para t.me/<bot>?start=<token>.
//   4. O bot recebe /start <token> → chama /api/bot/link → vincula a conta.
// -----------------------------------------------------------------------------

'use client';

import { useState } from 'react';

const BOT_USERNAME = 'shopee_downloader_bot'; // troque pelo username do seu bot

export function OpenInTelegramButton() {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch('/api/bot/issue-link-token', { method: 'POST' });
      if (!res.ok) throw new Error('Falha ao gerar token');
      const { token } = await res.json();
      window.location.href = `https://t.me/${BOT_USERNAME}?start=${token}`;
    } catch (err) {
      console.error(err);
      alert('Não foi possível abrir o Telegram agora. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="rounded-lg bg-blue-600 px-5 py-3 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
    >
      {loading ? 'Abrindo...' : '📲 Abrir no Telegram'}
    </button>
  );
}

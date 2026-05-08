-- =============================================================================
-- Schema sugerido para o banco do site shopeedownloader.com (Postgres)
-- Adapte ao schema que você já tem.
-- =============================================================================

-- Tabela de usuários (assumindo que já existe; caso não, exemplo abaixo).
-- Adicione apenas as colunas extras se a tabela já existir:
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS downloads_used INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);

-- Limite gratuito padrão. Mudar no código também (FREE_LIMIT).
-- Ex.: 10 downloads.

-- Tokens de uso único para vincular Telegram ↔ usuário.
CREATE TABLE IF NOT EXISTS bot_link_tokens (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_link_tokens_user
  ON bot_link_tokens (user_id);

-- (Opcional) Log de auditoria — útil para suporte e antifraude.
CREATE TABLE IF NOT EXISTS bot_downloads (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_downloads_user_created
  ON bot_downloads (user_id, created_at DESC);

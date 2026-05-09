-- =============================================================================
-- Schema do Supabase para o bot de Telegram com plano premium via Mercado Pago.
--
-- Rode no SQL Editor do Supabase (uma vez) ANTES de subir o bot.
-- =============================================================================

-- Tabela de usuários do bot.
-- - telegram_id é a chave natural (vindo de ctx.from.id no Telegraf).
-- - downloads_today + last_download_date implementam a cota diária do free.
-- - premium_until guarda a data/hora em que o plano premium expira (NULL = free).
create table if not exists public.bot_users (
  telegram_id      bigint primary key,
  first_name       text,
  username         text,
  downloads_today  integer not null default 0,
  last_download_date date,
  premium_until    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Tabela de pagamentos. Guardamos o vínculo entre o pagamento do MP e o
-- telegram_id, para conseguir ativar o plano quando o webhook chegar.
create table if not exists public.bot_payments (
  id                bigserial primary key,
  telegram_id       bigint not null references public.bot_users(telegram_id) on delete cascade,
  -- ID interno que enviamos como external_reference para o Mercado Pago.
  external_reference text not null unique,
  -- ID do pagamento devolvido pelo MP (preenchido quando o webhook bate).
  mp_payment_id     text,
  -- ID da preferência (Checkout Pro) gerada.
  mp_preference_id  text,
  amount_cents      integer not null,
  status            text not null default 'pending', -- pending | approved | rejected | cancelled
  created_at        timestamptz not null default now(),
  approved_at       timestamptz
);

create index if not exists idx_bot_payments_telegram on public.bot_payments(telegram_id);
create index if not exists idx_bot_payments_status   on public.bot_payments(status);

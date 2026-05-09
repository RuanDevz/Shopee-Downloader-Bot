// src/services/db.js
// -----------------------------------------------------------------------------
// Camada de acesso ao Supabase (Postgres).
//
// Concentra toda a lógica de cota diária e plano premium num só lugar para o
// bot.js e o webhook do Mercado Pago não duplicarem regras.
// -----------------------------------------------------------------------------

const { createClient } = require('@supabase/supabase-js');

const FREE_DAILY_LIMIT = 10;
const PREMIUM_DURATION_DAYS = 30;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    'SUPABASE_URL e SUPABASE_SERVICE_KEY precisam estar definidos no ambiente.',
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function isPremiumActive(user) {
  if (!user || !user.premium_until) return false;
  return new Date(user.premium_until).getTime() > Date.now();
}

/**
 * Garante que o usuário existe na tabela e retorna a linha.
 */
async function getOrCreateUser({ telegramId, firstName, username }) {
  const { data: existing, error: selectErr } = await supabase
    .from('bot_users')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (selectErr) throw selectErr;
  if (existing) return existing;

  const { data: inserted, error: insertErr } = await supabase
    .from('bot_users')
    .insert({
      telegram_id: telegramId,
      first_name: firstName ?? null,
      username: username ?? null,
    })
    .select('*')
    .single();

  if (insertErr) throw insertErr;
  return inserted;
}

/**
 * Verifica se o usuário pode baixar agora.
 * Retorna { allowed, reason, user, remaining }.
 *   reason: 'premium' | 'free_quota' | 'limit_reached'
 */
async function checkDownloadAllowance(user) {
  if (isPremiumActive(user)) {
    return { allowed: true, reason: 'premium', user, remaining: Infinity };
  }

  const today = todayISODate();
  const usedToday =
    user.last_download_date === today ? user.downloads_today : 0;
  const remaining = Math.max(0, FREE_DAILY_LIMIT - usedToday);

  if (remaining <= 0) {
    return { allowed: false, reason: 'limit_reached', user, remaining: 0 };
  }

  return { allowed: true, reason: 'free_quota', user, remaining };
}

/**
 * Incrementa a contagem de downloads do dia (apenas para usuários free).
 * Premium não consome cota.
 */
async function registerDownload(user) {
  if (isPremiumActive(user)) return;

  const today = todayISODate();
  const sameDay = user.last_download_date === today;
  const newCount = sameDay ? user.downloads_today + 1 : 1;

  const { error } = await supabase
    .from('bot_users')
    .update({
      downloads_today: newCount,
      last_download_date: today,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', user.telegram_id);

  if (error) throw error;
}

/**
 * Cria um registro de pagamento pendente no banco.
 */
async function createPendingPayment({
  telegramId,
  externalReference,
  preferenceId,
  amountCents,
}) {
  const { data, error } = await supabase
    .from('bot_payments')
    .insert({
      telegram_id: telegramId,
      external_reference: externalReference,
      mp_preference_id: preferenceId,
      amount_cents: amountCents,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getPaymentByExternalReference(externalReference) {
  const { data, error } = await supabase
    .from('bot_payments')
    .select('*')
    .eq('external_reference', externalReference)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Marca pagamento como aprovado e estende premium_until em 30 dias.
 * Idempotente: se já estiver aprovado, retorna sem alterar nada.
 */
async function approvePaymentAndActivatePremium({
  externalReference,
  mpPaymentId,
}) {
  const payment = await getPaymentByExternalReference(externalReference);
  if (!payment) {
    throw new Error(`Pagamento ${externalReference} não encontrado.`);
  }

  if (payment.status === 'approved') {
    return { payment, alreadyApproved: true };
  }

  const { data: user, error: userErr } = await supabase
    .from('bot_users')
    .select('*')
    .eq('telegram_id', payment.telegram_id)
    .single();

  if (userErr) throw userErr;

  // Se ainda houver tempo restante de premium, soma a partir da data atual de
  // expiração; senão soma a partir de agora.
  const baseDate = isPremiumActive(user)
    ? new Date(user.premium_until)
    : new Date();
  const newExpiry = new Date(
    baseDate.getTime() + PREMIUM_DURATION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { error: updateUserErr } = await supabase
    .from('bot_users')
    .update({
      premium_until: newExpiry.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', payment.telegram_id);

  if (updateUserErr) throw updateUserErr;

  const { error: updatePaymentErr } = await supabase
    .from('bot_payments')
    .update({
      status: 'approved',
      mp_payment_id: mpPaymentId ?? payment.mp_payment_id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', payment.id);

  if (updatePaymentErr) throw updatePaymentErr;

  return { payment, user, premiumUntil: newExpiry, alreadyApproved: false };
}

async function markPaymentStatus(externalReference, status, mpPaymentId) {
  await supabase
    .from('bot_payments')
    .update({
      status,
      mp_payment_id: mpPaymentId ?? null,
    })
    .eq('external_reference', externalReference);
}

module.exports = {
  FREE_DAILY_LIMIT,
  PREMIUM_DURATION_DAYS,
  isPremiumActive,
  getOrCreateUser,
  checkDownloadAllowance,
  registerDownload,
  createPendingPayment,
  getPaymentByExternalReference,
  approvePaymentAndActivatePremium,
  markPaymentStatus,
};

// @ts-check
// Helpers compartilhados pra endpoints admin (admin-errors-list, admin-moderate,
// admin-users). Valida token no Supabase + checa contra ADMIN_EMAILS.
// Throws ServiceError em falha. Sem Request/Response — controller cuida disso.
import { ServiceError, FALLBACK_SUPABASE_URL } from '../_security.js';

const AUTH_TIMEOUT_MS = 10000;

/**
 * Resolve a service key do Supabase (3 nomes aceitos pra compatibilidade).
 * @param {Record<string, string>} env
 * @returns {string | undefined}
 */
export function getServiceKey(env) {
  return env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Valida o token contra /auth/v1/user e devolve { callerId, email }.
 * Não checa contra ADMIN_EMAILS — caller faz isso.
 * @param {{ env: Record<string,string>, accessToken: string }} args
 * @returns {Promise<{ callerId: string, email: string }>}
 */
export async function verifyAdminToken({ env, accessToken }) {
  if (!accessToken) throw new ServiceError('sem token', 401);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || getServiceKey(env) || '';
  try {
    const u = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS)
    });
    if (!u.ok) throw new ServiceError('token inválido', 401);
    const ud = await u.json();
    return {
      callerId: ud?.id || '',
      email: (ud?.email || '').toLowerCase()
    };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('falha ao validar token', 401);
  }
}

/**
 * Devolve true se `email` está em ADMIN_EMAILS (env-var comma-separated).
 * @param {Record<string,string>} env
 * @param {string} email
 * @returns {boolean}
 */
export function isAdminEmail(env, email) {
  if (!email) return false;
  const admins = (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email);
}

/**
 * Checa se email está na lista ADMIN_EMAILS. Throw ServiceError 403 se não.
 * @param {Record<string,string>} env
 * @param {string} email
 */
export function ensureAdminEmail(env, email) {
  if (!isAdminEmail(env, email)) throw new ServiceError('não autorizado', 403);
}

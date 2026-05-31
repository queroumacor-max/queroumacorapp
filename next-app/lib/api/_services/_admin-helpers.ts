// lib/api/_services/_admin-helpers.ts — port de
// `functions/api/_services/_admin.js`. Helpers compartilhados pelos
// endpoints admin (errors-list, moderate, users, upload-style-ref).
//
// Re-exporta `isAdminEmail` / `ensureAdminEmail` / `getServiceKey` de
// `security.ts` pra dar um ponto único de import nos services admin —
// match com o padrão do vanilla, que mantinha tudo em `_admin.js`.

import { ServiceError, getSupabaseUrl } from '../security';

export { isAdminEmail, ensureAdminEmail, getServiceKey } from '../security';

const AUTH_TIMEOUT_MS = 10000;

/**
 * Valida o token contra `/auth/v1/user` e devolve `{ callerId, email }`.
 * Throw ServiceError em falha. Não checa contra ADMIN_EMAILS — caller
 * faz isso via `ensureAdminEmail`.
 *
 * Equivalente ao vanilla `_admin.verifyAdminToken`.
 */
export async function verifyAdminToken(
  accessToken: string
): Promise<{ callerId: string; email: string }> {
  if (!accessToken) throw new ServiceError('sem token', 401);
  const supaUrl = getSupabaseUrl();
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';

  let res: Response;
  try {
    res = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('falha ao validar token', 401);
  }
  if (!res.ok) throw new ServiceError('token inválido', 401);
  const data = (await res.json()) as { id?: string; email?: string };
  return {
    callerId: data?.id || '',
    email: (data?.email || '').toLowerCase(),
  };
}

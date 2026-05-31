// lib/api/_services/auth-rate-check.ts — port de
// `functions/api/auth-rate-check.js`. Rate limit defensivo de auth por IP.
//
// Camada ADVISORY: defesa real é rate limit nativo do Supabase + Cloudflare
// Rate Limiting Rules no edge. Cliente chama ANTES de bater na auth do
// Supabase pra economizar request e dificultar brute force.

import { checkRateLimit } from '../security';

export type AuthAction = 'login' | 'signup' | 'reset';

const LIMITS: Record<AuthAction, number> = {
  login: 10,
  signup: 5,
  reset: 5,
};

export interface AuthRateCheckResult {
  allowed: boolean;
  action: AuthAction;
  limit: number;
  skipped?: boolean;
  count?: number;
  retry_after_seconds?: number;
}

/**
 * @param ip — extraído do header `CF-Connecting-IP` / `X-Forwarded-For`
 *             pelo controller. Pode ser 'unknown' (não bloqueia — checkRateLimit
 *             ainda funciona com qualquer string como user key).
 */
export async function checkAuthRateLimit(args: {
  action?: string;
  ip: string;
}): Promise<AuthRateCheckResult> {
  const actionRaw = args.action || 'login';
  const action: AuthAction = actionRaw in LIMITS ? (actionRaw as AuthAction) : 'login';
  const limit = LIMITS[action];

  const userId = `ip:${args.ip}:${action}`;
  const rl = await checkRateLimit({ userId, endpoint: `auth-${action}`, limit });
  if (!rl.allowed) {
    return {
      allowed: false,
      action,
      limit,
      count: rl.count,
      retry_after_seconds: rl.retry_after_seconds,
    };
  }
  return {
    allowed: true,
    action,
    limit,
    skipped: !!rl.skipped,
  };
}

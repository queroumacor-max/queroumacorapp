// lib/api/security.ts — port parcial de `functions/api/_security.js`.
//
// Cobre o necessário pros 3 endpoints portados nesta sessão
// (health, log-error, cidades): ServiceError + jsonResponse +
// serviceErrorResponse + getToken + requireAuth (skeleton) +
// checkRateLimit (skeleton fail-open).
//
// AINDA NÃO portados (próximas sessões — usar como TODO list):
//   - `requirePro` / `gateProAI` / `gateProAIForm` — bundle PRO+auth+rate-limit
//     usado por todos os endpoints de IA. Requer SUPABASE_SERVICE_ROLE_KEY no
//     env do edge runtime e cuidado com o fail-CLOSED quando a key falta.
//   - `getTokenFromForm` — variante multipart (transcribe, upload-style-ref).
//   - `rateLimitResponse` — pareado com `checkRateLimit` completo (RPC
//     `check_rate_limit` no Supabase).
//   - Mensagens padronizadas `ERR_PRO_ONLY` / `ERR_UNAVAILABLE`.
//   - `FALLBACK_SUPABASE_URL` / `FALLBACK_ANON_KEY` — no Next preferimos
//     falhar cedo via env-var ausente; o vanilla mantinha fallback pra
//     sobreviver a CF binding faltando.
//
// Quando portar: replicar a semântica FAIL-OPEN (auth) vs FAIL-CLOSED (PRO
// check com service key configurada) descrita em detalhes em `_security.js`.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export class ServiceError extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(message: string, status = 500, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.extra = extra;
  }
}

export function jsonResponse(obj: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(obj, { status, headers });
}

export function serviceErrorResponse(err: ServiceError): NextResponse {
  const headers: Record<string, string> = {};
  const retryAfter = err.extra?.retry_after;
  if (typeof retryAfter === 'number') headers['retry-after'] = String(retryAfter);
  return NextResponse.json(
    { error: err.message, ...(err.extra || {}) },
    { status: err.status || 500, headers }
  );
}

/**
 * Extrai o JWT do request. Prioridade: header Authorization Bearer,
 * depois `accessToken` no body (útil pra multipart ou clientes que não
 * setam o header). Mesma assinatura do vanilla `_security.getToken`.
 */
export function getToken(
  request: NextRequest | Request,
  body?: { accessToken?: unknown } | null
): string {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (body && typeof body.accessToken === 'string') return body.accessToken;
  return '';
}

export interface AuthResult {
  user: { id: string; email?: string } | null;
  token?: string;
  anon?: boolean;
  warn?: string;
  error?: string;
  status?: number;
}

/**
 * Valida JWT do Supabase. FAIL-OPEN: retorna `{ user: null, anon: true }`
 * quando token ausente/inválido — chamador é responsável por barrar quando
 * `user` for null. Veja a doc detalhada em `_security.js`.
 *
 * Diferença pro vanilla: usamos o cliente `@supabase/supabase-js` em vez
 * de chamar `/auth/v1/user` direto via fetch. Mesmo comportamento.
 */
export async function requireAuth(
  request: NextRequest | Request,
  body?: { accessToken?: unknown } | null
): Promise<AuthResult> {
  const token = getToken(request, body);
  if (!token) return { user: null, anon: true };

  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    console.warn('requireAuth: SUPABASE_URL/ANON_KEY ausentes — fail-open');
    return { user: null, anon: true, warn: 'supabase_config_missing' };
  }
  try {
    const sb = createClient(supabaseUrl, anonKey);
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user?.id) {
      return { user: null, anon: true, warn: 'token_invalid' };
    }
    return { user: { id: data.user.id, email: data.user.email }, token };
  } catch (e) {
    console.warn('requireAuth: erro de rede — fail-open:', e instanceof Error ? e.message : e);
    return { user: null, anon: true, warn: 'network_error' };
  }
}

export interface RateLimitResult {
  allowed: boolean;
  skipped?: boolean;
  count?: number;
  limit?: number;
  retryAfter?: number;
}

/**
 * Rate limit por (user, endpoint, minuto). SKELETON FAIL-OPEN nesta
 * sessão — sempre retorna `{ allowed: true, skipped: true }`. A versão
 * completa do vanilla chama a RPC `check_rate_limit` no Supabase via
 * service-role; portar quando precisarmos endurecer os endpoints de IA.
 *
 * Aceita `opts` no formato que os endpoints novos vão usar (action +
 * max + windowSeconds), mas internamente ignora pra fail-open. Quando
 * portar de verdade, traduzir pros nomes da RPC (p_user_id, p_endpoint,
 * p_limit) e respeitar `windowSeconds` no SQL.
 */
export async function checkRateLimit(
  _request: NextRequest | Request,
  _opts: { action: string; max?: number; windowSeconds?: number }
): Promise<RateLimitResult> {
  // TODO migration: portar lógica completa de `_security.js#checkRateLimit`.
  return { allowed: true, skipped: true };
}

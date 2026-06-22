// lib/api/security.ts — port de `functions/api/_security.js` para Next.js.
//
// Cobre os endpoints já portados (health, log-error, cidades) + os 6 desta
// sessão (auth-rate-check, me-export, admin-errors-list, admin-moderate,
// admin-users, upload-style-ref).
//
// Diferenças do vanilla:
//   - Sem FALLBACK_SUPABASE_URL / FALLBACK_ANON_KEY — env-var ausente
//     falha cedo (`getSupabaseUrl()` throws ServiceError 503). Em Next o
//     edge precisa ter `SUPABASE_URL` / `SUPABASE_ANON_KEY` configuradas
//     no Cloudflare Pages / Vercel; sem isso, o app inteiro quebra mesmo
//     em runtime, então melhor falhar com 503 do que com fallback velho.
//   - `requireAuth` em modo "strict" (`requireAuthStrict`) — usado pelos
//     endpoints novos (me-export, admin-*) que NÃO podem ser anônimos.
//     A versão fail-open original (`requireAuth`) continua disponível pra
//     compatibilidade com endpoints que ainda dependem dela.

import { NextResponse, type NextRequest } from 'next/server';
import { assertProductionEnvs } from './env-check';
// `isAdminEmail` é implementada em `admin-config.ts` (cache + validação
// no startup, R-H6). Re-exportada abaixo pra manter o contrato existente
// (chamadores já importam de `lib/api/security`).
import { isAdminEmail } from './admin-config';
export { isAdminEmail };

// Boot-time check: roda 1x por cold-start de edge runtime. Em produção
// throws se faltar env crítica (Supabase URL/anon/service-role) — preferível
// a fail-open silencioso. Em dev/staging é no-op.
assertProductionEnvs();

export const ERR_PRO_ONLY = 'Esta função é exclusiva do Plano PRO ⚡';
export const ERR_UNAVAILABLE = 'serviço temporariamente indisponível';

const AUTH_TIMEOUT_MS = 10000;
const RATE_LIMIT_TIMEOUT_MS = 10000;

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
 * Resolve env-vars do Supabase. Throws ServiceError 503 se ausentes —
 * no Next preferimos fail-fast a fallback hardcoded.
 */
export function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new ServiceError(ERR_UNAVAILABLE, 503);
  return url.replace(/\/$/, '');
}

export function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) throw new ServiceError(ERR_UNAVAILABLE, 503);
  return key;
}

export function getServiceKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
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

/**
 * Variante multipart: extrai do FormData. Mesma prioridade
 * (Authorization header > formData.get('accessToken')).
 */
export function getTokenFromForm(
  request: NextRequest | Request,
  formData: FormData | null | undefined
): string {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  if (formData && typeof formData.get === 'function') {
    const v = formData.get('accessToken');
    if (typeof v === 'string') return v;
  }
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
 * Valida JWT via `/auth/v1/user`. FAIL-OPEN: retorna `{ user: null, anon: true }`
 * quando token ausente/inválido — chamador é responsável por barrar quando
 * `user` for null. Equivalente ao vanilla `_security.requireAuth`.
 *
 * Usa `fetch` direto (não `@supabase/supabase-js`) pra controlar timeout
 * e ficar compatível com edge runtime sem dependência client-side.
 */
export async function requireAuth(
  request: NextRequest | Request,
  body?: { accessToken?: unknown } | null
): Promise<AuthResult> {
  const token = getToken(request, body);
  if (!token) return { user: null, anon: true };

  let supabaseUrl: string;
  let anonKey: string;
  try {
    supabaseUrl = getSupabaseUrl();
    anonKey = getSupabaseAnonKey();
  } catch {
    console.warn('requireAuth: SUPABASE_URL/ANON_KEY ausentes — fail-open');
    return { user: null, anon: true, warn: 'supabase_config_missing' };
  }
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!res.ok) return { user: null, anon: true, warn: 'token_invalid' };
    const user = await res.json();
    if (!user?.id) return { user: null, anon: true, warn: 'invalid_user' };
    return { user: { id: user.id, email: user.email }, token };
  } catch (e) {
    console.warn('requireAuth: erro de rede — fail-open:', e instanceof Error ? e.message : e);
    return { user: null, anon: true, warn: 'network_error' };
  }
}

/**
 * Versão FAIL-CLOSED de requireAuth: throws ServiceError em vez de retornar
 * anon. Usada por endpoints que NÃO podem ser anônimos (me-export, admin-*).
 *
 * @returns { user: { id, email }, token } — sempre com user populado
 */
export async function requireAuthStrict(
  request: NextRequest | Request,
  body?: { accessToken?: unknown } | null
): Promise<{ user: { id: string; email: string }; token: string }> {
  const token = getToken(request, body);
  if (!token) throw new ServiceError('login obrigatório', 401);

  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('falha ao validar token', 401);
  }
  if (!res.ok) throw new ServiceError('token inválido', 401);
  const user = await res.json();
  if (!user?.id) throw new ServiceError('sessão inválida', 401);
  return {
    user: { id: user.id, email: (user.email || '').toLowerCase() },
    token,
  };
}

/**
 * Throw ServiceError 403 se email não for admin. Equivalente ao vanilla
 * `_admin.ensureAdminEmail`.
 */
export function ensureAdminEmail(email: string | null | undefined): void {
  if (!isAdminEmail(email)) throw new ServiceError('não autorizado', 403);
}

export interface RateLimitResult {
  allowed: boolean;
  skipped?: boolean;
  count?: number;
  limit?: number;
  retry_after_seconds?: number;
}

/**
 * Rate limit real via RPC `check_rate_limit` no Supabase. FAIL-OPEN se:
 *   - userId vazio (request anônimo);
 *   - SUPABASE_SERVICE_ROLE_KEY ausente;
 *   - RPC retornar erro/timeout.
 *
 * Equivalente ao vanilla `_security.checkRateLimit`.
 */
export async function checkRateLimit(opts: {
  userId: string | null | undefined;
  endpoint: string;
  limit?: number;
}): Promise<RateLimitResult> {
  const { userId, endpoint, limit = 30 } = opts;
  if (!userId) return { allowed: true, skipped: true };
  const serviceKey = getServiceKey();
  if (!serviceKey) return { allowed: true, skipped: true };

  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return { allowed: true, skipped: true };
  }

  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/check_rate_limit`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_endpoint: endpoint,
        p_limit: limit,
      }),
      signal: AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS),
    });
    if (!res.ok) return { allowed: true, skipped: true };
    const data = await res.json();
    return {
      allowed: !!data?.allowed,
      count: data?.count || 0,
      limit: data?.limit || limit,
      retry_after_seconds: data?.retry_after_seconds || 60,
    };
  } catch {
    return { allowed: true, skipped: true };
  }
}

/**
 * Resposta 429 padrão pareada com `checkRateLimit`.
 */
export function rateLimitResponse(rl: RateLimitResult): NextResponse {
  const retry = rl.retry_after_seconds || 60;
  return NextResponse.json(
    {
      error: `Limite por minuto atingido (${rl.count}/${rl.limit}). Tente em ${retry}s.`,
      retry_after: retry,
    },
    {
      status: 429,
      headers: { 'retry-after': String(retry) },
    }
  );
}

/**
 * Extrai o IP do cliente dos headers de borda. Prioriza `CF-Connecting-IP`
 * (Cloudflare Pages, onde o app roda) e cai pra `X-Forwarded-For` /
 * `X-Real-IP`. 'unknown' quando nenhum header está presente (checkRateLimit
 * ainda funciona com qualquer string como chave).
 */
export function getClientIp(request: NextRequest | Request): string {
  const h = request.headers;
  const cf = h.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const xreal = h.get('x-real-ip');
  if (xreal) return xreal.trim();
  return 'unknown';
}

/**
 * Rate limit GLOBAL por request, reaproveitando a RPC `check_rate_limit`.
 *
 * Chave: `userId` autenticado quando o controller já resolveu auth (mais
 * justo entre usuários atrás do mesmo NAT/IP); senão IP de borda. FAIL-OPEN
 * igual `checkRateLimit` (sem service key / Supabase fora → libera, pra não
 * derrubar rota legítima num blip — a defesa real fica no Cloudflare edge).
 *
 * Uso no topo do handler:
 *   const limited = await enforceRateLimit(request, { endpoint: 'cidades', limit: 60 });
 *   if (limited) return limited;
 *
 * @returns NextResponse 429 se estourou, ou `null` se liberado.
 */
export async function enforceRateLimit(
  request: NextRequest | Request,
  opts: { endpoint: string; limit?: number; userId?: string | null }
): Promise<NextResponse | null> {
  const { endpoint, limit = 60, userId } = opts;
  const key = userId ? `u:${userId}` : `ip:${getClientIp(request)}`;
  const rl = await checkRateLimit({ userId: key, endpoint, limit });
  if (!rl.allowed) return rateLimitResponse(rl);
  return null;
}

/**
 * Consulta `profiles.is_pro` + `pro_expires_at` via service_role.
 * FAIL-OPEN quando userId vazio (anônimo — gateProAI já barra). FAIL-CLOSED
 * em produção quando service key ausente (CRIT-5: env quebrada em prod não
 * pode liberar todos os features PRO). Dev/staging mantém fail-open pra DX.
 * FAIL-CLOSED quando service key existe mas Supabase está indisponível —
 * atacante não bypassa PRO via DoS.
 */
export async function requirePro(
  userId: string | null | undefined
): Promise<{ pro: boolean; checked: boolean; error?: string }> {
  if (!userId) return { pro: true, checked: false };
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        'requirePro: SUPABASE_SERVICE_ROLE_KEY ausente em produção — bloqueando acesso (fail-closed)'
      );
      return { pro: false, checked: false, error: 'service_unavailable' };
    }
    console.warn('requirePro: service key ausente — dev/staging fail-open');
    return { pro: true, checked: false };
  }
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return { pro: true, checked: false };
  }
  const url = `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(
    userId
  )}&select=is_pro,pro_expires_at`;
  try {
    const r = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.warn('requirePro: falha ao consultar profiles', r.status);
      return { pro: false, checked: false, error: 'verificação indisponível' };
    }
    const rows = (await r.json()) as Array<{ is_pro?: unknown; pro_expires_at?: unknown }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { pro: false, checked: true };
    }
    const prof = rows[0];
    const notExpired =
      !prof.pro_expires_at ||
      new Date(prof.pro_expires_at as string).getTime() > Date.now();
    return { pro: !!(prof.is_pro && notExpired), checked: true };
  } catch (e) {
    console.warn('requirePro: exceção', e instanceof Error ? e.message : e);
    return { pro: false, checked: false, error: 'erro de rede' };
  }
}

export interface GateProAIOk {
  userId: string | undefined;
  user: { id: string; email?: string } | null;
  token?: string;
}

/**
 * Bundle: requireAuth + requirePro + checkRateLimit. Retorna NextResponse de
 * erro se barrou, ou `{ userId, user, token }` se passou.
 * Espelha `gateProAI` do vanilla `_security.js`.
 *
 * Fail-CLOSED quando service-role key ausente — senão requirePro vira
 * fail-open e libera geral.
 */
export async function gateProAI(
  request: NextRequest | Request,
  body: { accessToken?: unknown } | null | undefined,
  opts: { endpoint: string; limit?: number; requirePro?: boolean }
): Promise<NextResponse | GateProAIOk> {
  const { endpoint, limit = 30, requirePro: needPro = true } = opts;
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return jsonResponse({ error: ERR_UNAVAILABLE }, 503);
  }
  const auth = await requireAuth(request, body);
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status || 401);
  const userId = auth.user?.id;
  if (needPro) {
    const proCheck = await requirePro(userId);
    if (!proCheck.pro) return jsonResponse({ error: ERR_PRO_ONLY }, 403);
  }
  const rl = await checkRateLimit({ userId, endpoint, limit });
  if (!rl.allowed) return rateLimitResponse(rl);
  return { userId, user: auth.user, token: auth.token };
}

// ─────────────────────────────────────────────────────────────────────────
// AI usage gating (Pagamentos#18, #19).
// ─────────────────────────────────────────────────────────────────────────

import {
  getAiUsageThisMonthViaRest,
  getPlanLimitViaRest,
  isProActiveViaRest,
  recordAiUsageViaRest,
} from './_services/_billing-helpers';

/**
 * Checa limite mensal de IA. Retorna NextResponse 429 com Retry-After se
 * passou; senão retorna `{ allowed, used, limit, plan }` pro caller decidir.
 *
 * É chamado APÓS `gateProAI` (que já garantiu auth + PRO + rate limit por
 * minuto). Este gate é por mês, escala mais alta — só barra se o usuário
 * realmente abusou no plano dele.
 *
 * Resolução do plano:
 *   1. isAdmin → 'admin' (limite 99999)
 *   2. is_pro_active (RPC com grace) → 'pro' (limite 500)
 *   3. fallback → 'free' (limite 30)
 *
 * `getPlanLimitViaRest` e `getAiUsageThisMonthViaRest` continuam fail-open
 * em DB error temporário — isso é resiliência (preferimos perder telemetria
 * a travar usuário PRO legítimo num blip do banco). O que mudou (CRIT-5):
 * service key AUSENTE agora é fail-CLOSED em produção, porque indica config
 * quebrada (não blip transitório), e o comportamento antigo libera-tudo era
 * abuso de quota IA esperando acontecer.
 */
export async function gateAiUsage(opts: {
  userId: string | undefined;
  email?: string | null;
  feature: string;
}): Promise<NextResponse | { allowed: true; plan: 'free' | 'pro' | 'admin'; used: number; limit: number }> {
  const { userId, email, feature } = opts;
  if (!userId) {
    // Sem userId, gateProAI já deveria ter barrado; aqui é defesa em prof.
    return { allowed: true, plan: 'free', used: 0, limit: 30 };
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    if (process.env.NODE_ENV === 'production') {
      // CRIT-5: env quebrada em prod não pode liberar quota IA.
      console.error(
        'gateAiUsage: SUPABASE_SERVICE_ROLE_KEY ausente em produção — 503 (fail-closed)'
      );
      return NextResponse.json(
        { error: 'service_unavailable' },
        { status: 503 }
      );
    }
    // dev/staging: deixa passar pra DX (mesmo comportamento antigo).
    return { allowed: true, plan: 'free', used: 0, limit: 30 };
  }
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return { allowed: true, plan: 'free', used: 0, limit: 30 };
  }

  // Resolve plano.
  let plan: 'free' | 'pro' | 'admin' = 'free';
  if (email && isAdminEmail(email)) {
    plan = 'admin';
  } else {
    const isPro = await isProActiveViaRest({ supaUrl, serviceKey, userId });
    if (isPro) plan = 'pro';
  }

  const [limit, used] = await Promise.all([
    getPlanLimitViaRest({ supaUrl, serviceKey, plan }),
    getAiUsageThisMonthViaRest({ supaUrl, serviceKey, userId }),
  ]);

  if (used >= limit) {
    return NextResponse.json(
      {
        error: `Limite mensal de IA atingido (${used}/${limit}). ${plan === 'free' ? 'Vire PRO pra mais.' : 'Aguarde o próximo mês.'}`,
        used,
        limit,
        plan,
        feature,
      },
      { status: 429 }
    );
  }
  return { allowed: true, plan, used, limit };
}

/**
 * Registra 1 uso de feature de IA. Chamado APÓS sucesso da chamada upstream.
 * Falha silenciosa.
 */
export async function recordAiUsage(opts: {
  userId: string | undefined;
  feature: string;
  costUnits?: number;
}): Promise<void> {
  const { userId, feature, costUnits = 1 } = opts;
  if (!userId) return;
  const serviceKey = getServiceKey();
  if (!serviceKey) return;
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return;
  }
  await recordAiUsageViaRest({
    supaUrl,
    serviceKey,
    userId,
    feature,
    costUnits,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Max payload guards (Backend#26).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Default cap pra payloads JSON/form. Multipart com upload deve passar
 * `maxBytes` explícito (ex.: 4MB pra style-refs, 50MB pra posts).
 *
 * 10MB é generoso o suficiente pro 99% dos endpoints atuais (log-error,
 * admin-*, chat-ai) mas barra payload pathológico que faria o edge runtime
 * estourar memória antes mesmo de parsear.
 */
export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

export interface ReadBodyOptions {
  /** Limite em bytes; default `DEFAULT_MAX_BYTES`. */
  maxBytes?: number;
  /** Tipo de parse. `json` (default) faz `JSON.parse`; `form` retorna `FormData`. */
  type?: 'json' | 'form';
}

/**
 * Lê e parseia o body do request com hard cap em bytes.
 *
 * Estratégia:
 *   1. Cheap path: se `content-length` declarado > maxBytes, 413 imediato.
 *      Cliente honesto declara content-length; atacante tentando burlar via
 *      `Transfer-Encoding: chunked` cai na verificação pós-leitura.
 *   2. Para `type: 'json'`, lê como texto e verifica byte-length de novo
 *      antes de `JSON.parse` — pega chunked que extrapolou.
 *   3. Para `type: 'form'`, delega para `request.formData()` (que respeita
 *      `bodyParserLimit` do Next runtime); cap aqui é defensivo.
 *
 * Throws `ServiceError(413)` em overflow ou `ServiceError(400)` em JSON
 * inválido. Route handler captura via `serviceErrorResponse`.
 */
export async function readBody(
  request: NextRequest | Request,
  options: ReadBodyOptions = {}
): Promise<unknown> {
  const max = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const contentLengthHeader = request.headers.get('content-length');
  const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  if (Number.isFinite(contentLength) && contentLength > max) {
    throw new ServiceError(`Payload too large: ${contentLength} > ${max}`, 413);
  }

  if (options.type === 'form') {
    // Não dá pra checar tamanho real do FormData antes de parsear; o
    // content-length header serve como gate primário. Quem precisa de cap
    // mais fino (validar tamanho de cada File field) deve fazer no handler.
    return await request.formData();
  }

  const text = await request.text();
  // Byte-length real (UTF-8 pode inflar 2-4x vs `length`). TextEncoder
  // disponível em edge runtime + node runtime.
  const byteLength =
    typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  if (byteLength > max) {
    throw new ServiceError(`Payload too large after read: ${byteLength} > ${max}`, 413);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError('Invalid JSON body', 400);
  }
}

/**
 * Variante multipart de `gateProAI`: extrai o token do FormData.
 */
export async function gateProAIForm(
  request: NextRequest | Request,
  formData: FormData,
  opts: { endpoint: string; limit?: number; requirePro?: boolean }
): Promise<NextResponse | GateProAIOk> {
  const { endpoint, limit = 30, requirePro: needPro = true } = opts;
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return jsonResponse({ error: ERR_UNAVAILABLE }, 503);
  }
  const accessToken = getTokenFromForm(request, formData);
  const auth = await requireAuth(request, { accessToken });
  if (auth.error) return jsonResponse({ error: auth.error }, auth.status || 401);
  const userId = auth.user?.id;
  if (needPro) {
    const proCheck = await requirePro(userId);
    if (!proCheck.pro) return jsonResponse({ error: ERR_PRO_ONLY }, 403);
  }
  const rl = await checkRateLimit({ userId, endpoint, limit });
  if (!rl.allowed) return rateLimitResponse(rl);
  return { userId, user: auth.user, token: auth.token };
}

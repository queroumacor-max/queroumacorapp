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
import { chaveDeRateLimit } from './_services/_untrusted';
import { assertProductionEnvs } from './env-check';
import { getRuntimeEnv, getSupabaseServiceKey } from './env';
// `isAdminEmail` é implementada em `admin-config.ts` (cache + validação
// no startup, R-H6). Re-exportada abaixo pra manter o contrato existente
// (chamadores já importam de `lib/api/security`).
import { isAdminEmail } from './admin-config';
export { isAdminEmail };

// NÃO chamar `assertProductionEnvs()` aqui. Era o que este arquivo fazia
// até 2026-09-01, e é exatamente o que o CLAUDE.md proíbe: no module-load
// não existe request, logo não existe env no edge do Cloudflare — o throw
// podia disparar com tudo configurado e derrubar a CARGA do módulo, o que
// o Next devolve como 500 puro (sem passar por error.tsx, porque não é
// erro de render). A garantia que importa é fail-closed POR REQUEST, e ela
// já existe em `requirePro` e `gateAiUsage` (503 sem service key).
// `assertProductionEnvs` segue exportado pra quem quiser checar dentro de
// um request.
void assertProductionEnvs;

export const ERR_PRO_ONLY = 'Esta função é exclusiva do Plano PRO ⚡';
export const ERR_UNAVAILABLE = 'serviço temporariamente indisponível';
export const ERR_LOGIN_REQUIRED = 'Faça login';

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
 * Resolve URL + anon key do Supabase SEMPRE DO MESMO PAR.
 *
 * INCIDENTE QUE ORIGINOU ISTO (2026-09-04): `getSupabaseUrl` e
 * `getSupabaseAnonKey` resolviam de forma INDEPENDENTE, cada uma com a sua
 * ordem. Em produção o painel do Cloudflare tinha `SUPABASE_URL` AUSENTE e um
 * `SUPABASE_ANON_KEY` legado (de OUTRO projeto, herança do app vanilla),
 * além do par `NEXT_PUBLIC_*` correto. O resultado foi um PAR CRUZADO: a URL
 * caía no `NEXT_PUBLIC_SUPABASE_URL` (projeto certo) e a chave vinha do
 * secret legado (projeto errado). O GoTrue recebia apikey de um projeto e
 * token de outro e respondia 401 "Invalid API key" para QUALQUER token —
 * que o `requireAuth` colapsava em `token_invalid`, derrubando toda a IA.
 *
 * A assimetria que confundiu o diagnóstico: o PostgREST seguia funcionando
 * porque quem o chama é o CLIENTE, com a chave boa do bundle. Só a
 * verificação do SERVIDOR usava a chave divergente.
 *
 * REGRA: um par só é aceito quando as DUAS metades vêm do mesmo prefixo.
 * Meia-a-meia nunca — é exatamente o que produziu o incidente.
 */
export interface SupabaseEnvPair {
  url: string;
  anonKey: string;
  /** De qual par veio — útil no diagnóstico, não muda comportamento. */
  source: 'public' | 'server';
}

export function resolveSupabaseEnv(): SupabaseEnvPair {
  const strip = (u: string) => u.replace(/\/$/, '');

  // Par PÚBLICO primeiro: é o que o bundle do cliente usa pra emitir o token,
  // então é o que o servidor precisa usar pra verificá-lo.
  const pubUrl = getRuntimeEnv('NEXT_PUBLIC_SUPABASE_URL');
  const pubKey = getRuntimeEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (pubUrl && pubKey) return { url: strip(pubUrl), anonKey: pubKey, source: 'public' };

  // Par SEM prefixo — aceito só INTEIRO.
  const srvUrl = getRuntimeEnv('SUPABASE_URL');
  const srvKey = getRuntimeEnv('SUPABASE_ANON_KEY');
  if (srvUrl && srvKey) return { url: strip(srvUrl), anonKey: srvKey, source: 'server' };

  throw new ServiceError(ERR_UNAVAILABLE, 503);
}

/** Ref do projeto a partir do host `<ref>.supabase.co`. */
export function projectRefFromUrl(url: string): string | null {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(url);
  return m ? m[1] : null;
}

/**
 * Ref do projeto a partir da anon key — ela é um JWT cujo payload traz `ref`.
 * Null quando não der pra ler (formato inesperado): na dúvida, não acusa.
 */
export function projectRefFromAnonKey(key: string): string | null {
  try {
    const part = key.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(pad)) as { ref?: unknown };
    return typeof payload.ref === 'string' ? payload.ref : null;
  } catch {
    return null;
  }
}

/**
 * Só a URL. NÃO exige anon key: os caminhos de SERVICE ROLE (audit_log,
 * log-error, push-notify, REST com service key) legitimamente não têm chave
 * anon nenhuma — cobrar o par deles seria quebrar quem nunca teve o problema.
 *
 * Ordem única (pública primeiro, igual ao resolvedor do par), então nenhum
 * ponto do código volta a discordar dos outros. Quando existe par completo,
 * devolve a URL DELE — assim url e chave nunca se separam onde importa.
 */
export function getSupabaseUrl(): string {
  try {
    return resolveSupabaseEnv().url;
  } catch {
    const url = getRuntimeEnv('NEXT_PUBLIC_SUPABASE_URL') || getRuntimeEnv('SUPABASE_URL');
    if (!url) throw new ServiceError(ERR_UNAVAILABLE, 503);
    return url.replace(/\/$/, '');
  }
}

/**
 * A anon key SÓ sai de um par completo — é o ponto do incidente. Uma chave
 * solta, sem a URL do mesmo prefixo, é exatamente o que produziu o
 * cruzamento; preferimos 503 a montar um par que o GoTrue vai recusar.
 */
export function getSupabaseAnonKey(): string {
  return resolveSupabaseEnv().anonKey;
}

export function getServiceKey(): string | undefined {
  return (
    getRuntimeEnv('SUPABASE_SERVICE_ROLE') ||
    getRuntimeEnv('SUPABASE_SERVICE_KEY') ||
    getSupabaseServiceKey()
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
  /**
   * Detalhe do 401 pra diagnostico. Tudo aqui e PUBLICO de proposito: o host
   * do projeto Supabase ja esta hardcoded no bundle do cliente, e o
   * `error_code` do GoTrue e o unico dado que separa "chave/projeto errados"
   * (`bad_jwt`) de "sessao revogada" (`session_not_found`). Nenhuma chave
   * entra aqui.
   */
  detail?: Record<string, string | number>;
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
    // Par ÚNICO: url e chave sempre do mesmo prefixo (ver resolveSupabaseEnv).
    const env = resolveSupabaseEnv();
    supabaseUrl = env.url;
    anonKey = env.anonKey;
  } catch {
    console.warn('requireAuth: SUPABASE_URL/ANON_KEY ausentes — fail-open');
    return { user: null, anon: true, warn: 'supabase_config_missing' };
  }

  // Guarda de projeto: a anon key é um JWT com o `ref` do projeto, e a URL
  // traz o mesmo ref no host. Divergiram = configuração cruzada, e o GoTrue
  // recusaria QUALQUER token com um 401 genérico. Acusar aqui evita que o
  // erro se disfarce de `token_invalid` — foi assim que o incidente de
  // 2026-09-04 passou dias parecendo problema de sessão.
  const refUrl = projectRefFromUrl(supabaseUrl);
  const refKey = projectRefFromAnonKey(anonKey);
  if (refUrl && refKey && refUrl !== refKey) {
    console.warn(
      `requireAuth: projeto divergente — url=${refUrl} anonKey=${refKey}`,
    );
    return {
      user: null,
      anon: true,
      warn: 'env_project_mismatch',
      detail: { url_ref: refUrl, key_ref: refKey },
    };
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // O status e o `error_code` do GoTrue sao o que separa as causas que
      // sobraram: `bad_jwt` = token nao confere com a chave/projeto que ESTE
      // servidor usa pra verificar; `session_not_found` = a sessao foi
      // revogada. Sem isso, as duas viram o mesmo `token_invalid`.
      let code = '';
      try {
        const j = (await res.json()) as { error_code?: string; msg?: string };
        code = String(j?.error_code || j?.msg || '').slice(0, 60);
      } catch {
        // corpo nao-JSON: o status sozinho ja ajuda
      }
      return {
        user: null,
        anon: true,
        warn: 'token_invalid',
        detail: {
          gotrue: res.status,
          code,
          // Host (publico) que ESTE servidor usou pra verificar. Comparar com
          // o `iss` do token do cliente fecha o caso de projeto divergente.
          host: supabaseUrl.replace(/^https?:\/\//, ''),
        },
      };
    }
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

  // Par ÚNICO: url e anonKey do MESMO objeto. Duas resoluções independentes
  // aqui seriam a forma exata do bug de 2026-09-04 — e este é o caminho
  // crítico de autenticação, onde ela custou mais caro.
  const { url: supabaseUrl, anonKey } = resolveSupabaseEnv();

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
 *
 * A mensagem DIZ QUAL email o servidor viu. Sem isso ("não autorizado
 * (email não admin)") o operador não tem como consertar: o portal admite
 * quem tem `portal_access`, mas estas rotas só aceitam `ADMIN_EMAILS` — e
 * quem está logado na loja com outra conta vê um 403 sem saber por quê
 * (2026-09-07, a lista de templates caiu na embutida por isso). O email é
 * o do próprio caller autenticado, então dizer não vaza nada.
 */
export function ensureAdminEmail(email: string | null | undefined): void {
  if (isAdminEmail(email)) return;
  throw new ServiceError(
    `não autorizado: o email "${email || '(sem email no login)'}" não está na lista ADMIN_EMAILS do servidor. ` +
      'Adicione esse email na env ADMIN_EMAILS (Cloudflare Pages → Settings → Environment variables → Production) e refaça o deploy.',
    403,
  );
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
        // A RPC recebe `uuid`: chave que não é UUID (`ip:…`, `log-error:…`)
        // dava 22P02 → 400 → liberava em silêncio. Nenhum limite por IP
        // valia (auditoria 2026-09-11). Agora vira UUID determinístico.
        p_user_id: await chaveDeRateLimit(userId),
        p_endpoint: endpoint,
        p_limit: limit,
      }),
      signal: AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Fail-open continua (blip do banco não pode derrubar rota legítima),
      // mas NUNCA mais em silêncio: foi o silêncio que escondeu o 22P02.
      console.warn(
        `[rate-limit] RPC respondeu ${res.status} pra endpoint=${endpoint}: ${(await res.text().catch(() => '')).slice(0, 160)}`
      );
      return { allowed: true, skipped: true };
    }
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
 * 401 de login com a CAUSA junto. `requireAuth` é fail-open e devolve
 * `user: null` por QUATRO motivos diferentes — sem token, env do Supabase
 * ausente no servidor, token recusado pelo GoTrue, ou timeout/erro de rede —
 * e todos viravam a MESMA string 'Faça login'. Indistinguíveis na tela, o que
 * já custou várias rodadas de adivinhação em produção (mesma lição do
 * `descreverArquivo` registrada no CLAUDE.md: mensagem de erro tem que
 * carregar a evidência).
 *
 * O motivo vai no corpo em `reason` E embutido no texto, porque as telas
 * mostram `data.error` cru — assim todo chamador ganha o diagnóstico sem
 * precisar de mudança no cliente. Os valores são coarse de propósito
 * (`no_token` | `supabase_config_missing` | `token_invalid` |
 * `network_error`): dizem onde olhar, sem vazar segredo nenhum.
 */
function loginRequiredResponse(auth: AuthResult): NextResponse {
  const reason = auth.warn || 'no_token';
  const d = auth.detail;
  // O sufixo visivel carrega o essencial pra quem le da tela e manda de volta.
  // Renderizado como `chave=valor` generico: cada `warn` traz um detail de
  // formato proprio (o GoTrue traz code/host; o env_project_mismatch traz os
  // dois refs de projeto), e um formato fixo imprimiria "undefined" no outro.
  const extra = d
    ? ' ' +
      Object.entries(d)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';
  return jsonResponse(
    { error: `${ERR_LOGIN_REQUIRED} (${reason}${extra})`, reason, ...(d ? { detail: d } : {}) },
    401,
  );
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
  // FIX C1 (auditoria 2026-08-26): `requireAuth` é fail-open e NUNCA popula
  // `auth.error` — sem este check, requisição SEM token pulava PRO, rate
  // limit e cota (requirePro(undefined) → {pro:true}; checkRateLimit sem
  // userId → skipped) e chegava na IA de graça. Anônimo agora é 401 aqui,
  // antes de qualquer custo. Vale também pro token inválido/expirado e pra
  // falha de rede no verify (fail-closed: auth não confirmada = negada).
  if (!auth.user?.id) return loginRequiredResponse(auth);
  const userId = auth.user.id;
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
  // FIX C1 — mesmo racional do gateProAI acima: anônimo nunca passa do gate.
  if (!auth.user?.id) return loginRequiredResponse(auth);
  const userId = auth.user.id;
  if (needPro) {
    const proCheck = await requirePro(userId);
    if (!proCheck.pro) return jsonResponse({ error: ERR_PRO_ONLY }, 403);
  }
  const rl = await checkRateLimit({ userId, endpoint, limit });
  if (!rl.allowed) return rateLimitResponse(rl);
  return { userId, user: auth.user, token: auth.token };
}

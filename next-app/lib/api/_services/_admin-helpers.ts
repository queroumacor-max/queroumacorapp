// lib/api/_services/_admin-helpers.ts — port de
// `functions/api/_services/_admin.js`. Helpers compartilhados pelos
// endpoints admin (errors-list, moderate, users, upload-style-ref).
//
// Re-exporta `isAdminEmail` / `ensureAdminEmail` / `getServiceKey` de
// `security.ts` pra dar um ponto único de import nos services admin —
// match com o padrão do vanilla, que mantinha tudo em `_admin.js`.
// ROTA NOVA DE ADMIN USA `ensurePortalAdmin` (abaixo), não `ensureAdminEmail`:
// o teste `__tests__/api/admin-portal-access.test.ts` varre app/api.

import {
  ServiceError,
  resolveSupabaseEnv,
  isAdminEmail,
  getServiceKey,
  getSupabaseUrl,
} from '../security';
import { logSecurityEvent } from '../securityEvents';
export { isAdminEmail, ensureAdminEmail, getServiceKey } from '../security';

const AUTH_TIMEOUT_MS = 10000;

// ── Quem é admin pra rota de servidor (2026-09-10, decisão do usuário:
// "habilite pelo promover") ────────────────────────────────────────────
// Antes toda rota admin exigia o e-mail em `ADMIN_EMAILS` (env do
// Cloudflare), e o "Promover" do portal só gravava `portal_access` — quem
// era promovido abria as telas (RLS deixa) e levava 403 ao enviar
// WhatsApp, sugerir com a IA, gerir usuários. Agora a regra é a MESMA do
// guard RSC do /admin/* (`isPortalAdmin` em lib/auth-server.ts):
// e-mail na allowlist OU `profiles.portal_access = true` OU
// `profiles.role = 'admin'`, lidos com a chave de serviço (o cliente não
// manda nada além do token). A allowlist continua valendo como
// porta de emergência — se o banco estiver fora, quem está nela entra.
//
// Cache por isolate de PORTAL_ADMIN_CACHE_MS: a aba WhatsApp chama
// `suggest`/`send` várias vezes por minuto e não vale um SELECT por
// clique. Revogar leva até esse tempo pra valer numa rota — o portal em si
// fecha na hora, porque a RLS não passa por aqui.
const PORTAL_ADMIN_CACHE_MS = 60_000;
const PORTAL_ADMIN_CACHE = new Map<string, { ok: boolean; until: number }>();

async function lerFlagsDoPerfil(callerId: string): Promise<{ portal_access?: boolean | null; role?: string | null } | null> {
  const serviceKey = getServiceKey();
  const url = getSupabaseUrl();
  if (!serviceKey || !url) return null;
  let res: Response;
  try {
    res = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=portal_access,role`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      },
    );
  } catch (e) {
    // Rede fora ou os 10s estouraram: sem ServiceError o erro cru vira 500
    // genérico (ou 401 nas rotas que só preservam status de ServiceError) e
    // o operador lê "token inválido" num problema de banco (Codex no #296).
    throw new ServiceError(
      'falha ao verificar permissão (' + ((e as Error)?.name === 'TimeoutError' ? 'tempo esgotado' : 'rede') + ')',
      502,
    );
  }
  if (!res.ok) throw new ServiceError('falha ao verificar permissão (profiles ' + res.status + ')', 502);
  let rows: Array<{ portal_access?: boolean | null; role?: string | null }>;
  try {
    rows = (await res.json()) as typeof rows;
  } catch {
    // Corpo que não é JSON (proxy, HTML de erro) é "não deu pra saber",
    // não "não autorizado".
    throw new ServiceError('falha ao verificar permissão (resposta inválida)', 502);
  }
  return Array.isArray(rows) ? rows[0] || null : null;
}

/** true se o caller pode usar as rotas admin (allowlist OU promovido no portal). */
export async function isPortalAdminUser(args: { callerId: string; email: string }): Promise<boolean> {
  if (isAdminEmail(args.email)) return true;
  if (!args.callerId) return false;
  const agora = Date.now();
  const cached = PORTAL_ADMIN_CACHE.get(args.callerId);
  if (cached && cached.until > agora) return cached.ok;
  const row = await lerFlagsDoPerfil(args.callerId);
  const ok = !!row && (row.portal_access === true || row.role === 'admin');
  PORTAL_ADMIN_CACHE.set(args.callerId, { ok, until: agora + PORTAL_ADMIN_CACHE_MS });
  return ok;
}

/** Esvazia o cache — só pra teste. */
export function _resetPortalAdminCache(): void {
  PORTAL_ADMIN_CACHE.clear();
}

/**
 * Mesma regra de `isPortalAdminUser`, mas SEM CACHE — pra ações
 * destrutivas/irreversíveis (ex.: `/api/admin/moderate` reject = hard
 * delete do post + storage) onde os 60s de cache do isolate são tempo
 * demais pra uma conta recém-despromovida ainda conseguir agir. Achado da
 * auditoria de negócio 2026-09-16: `ensurePortalAdmin` (cached) protegia
 * bem as ações reversíveis, mas o `/moderate` só chamava ela também — uma
 * conta despromovida no meio da janela de 60s ainda apagava post/mídia de
 * qualquer outro usuário.
 */
export async function ensurePortalAdminFresh(args: { callerId: string; email: string }): Promise<void> {
  if (isAdminEmail(args.email)) return;
  const row = args.callerId ? await lerFlagsDoPerfil(args.callerId) : null;
  const ok = !!row && (row.portal_access === true || row.role === 'admin');
  if (!ok) {
    // Auditoria de observabilidade de segurança (2026-09-17): gate admin
    // (a maior parte das rotas /api/admin/* passa por aqui ou por
    // `ensurePortalAdmin`) negava em silêncio — nenhum sinal pra detectar
    // uma conta comum tentando repetidamente rotas admin.
    logSecurityEvent(
      'security.authorization.denied',
      { reason: 'not_portal_admin', fresh: true, callerId: args.callerId || null },
      { severity: 'warning' },
    );
    // Como virar admin (ADMIN_EMAILS / Promover) NÃO vai pro corpo: quem
    // recebe este 403 é justamente quem não é admin (auditoria 2026-09-26, L2).
    throw new ServiceError('não autorizado', 403);
  }
}

/**
 * Substitui `ensureAdminEmail(email)` nas rotas admin. Sem `callerId` (token
 * sem sub) só a allowlist vale. O 403 é genérico de propósito: explicar como
 * virar admin pra quem não é admin é informação de graça pro atacante.
 */
export async function ensurePortalAdmin(args: { callerId: string; email: string }): Promise<void> {
  if (await isPortalAdminUser(args)) return;
  logSecurityEvent(
    'security.authorization.denied',
    { reason: 'not_portal_admin', fresh: false, callerId: args.callerId || null },
    { severity: 'warning' },
  );
  throw new ServiceError('não autorizado', 403);
}

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
  // Par ÚNICO: a chave TEM que ser a do mesmo projeto da url, senão o GoTrue
  // responde 401 pra qualquer token (ver resolveSupabaseEnv).
  const { url: supaUrl, anonKey } = resolveSupabaseEnv();

  let res: Response;
  try {
    res = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('falha ao validar token', 401);
  }
  if (!res.ok) {
    logSecurityEvent(
      'auth.login.failed',
      { reason: 'token_invalid', gotrue_status: res.status, admin_route: true },
      { severity: 'warning' },
    );
    // Corpo do GoTrue só no log (L2) — no 401 vai só o status.
    const corpo = (await res.text().catch(() => '')).slice(0, 200);
    console.warn('[admin-auth] GoTrue recusou o token', res.status, corpo);
    throw new ServiceError('token inválido', 401);
  }
  const data = (await res.json()) as { id?: string; email?: string };
  return {
    callerId: data?.id || '',
    email: (data?.email || '').toLowerCase(),
  };
}

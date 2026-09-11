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
  isTrustedAdminEmail,
  emailConfirmedFromGoTrue,
  getServiceKey,
  getSupabaseUrl,
} from '../security';
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

/**
 * true se o caller pode usar as rotas admin (allowlist OU promovido no portal).
 *
 * A allowlist só vale com o e-mail CONFIRMADO (`emailConfirmed`). Sem essa
 * exigência, qualquer pessoa se cadastrava com o e-mail de um admin que
 * ainda não tinha conta (ou com um e-mail digitado errado na env), recebia
 * uma sessão com aquele e-mail e entrava como admin (auditoria 2026-09-11).
 * Caller que não informa `emailConfirmed` NÃO ganha pela allowlist — fail
 * closed; o caminho por `portal_access`/`role` segue valendo.
 */
export async function isPortalAdminUser(args: {
  callerId: string;
  email: string;
  emailConfirmed?: boolean;
}): Promise<boolean> {
  if (isTrustedAdminEmail({ email: args.email, emailConfirmed: args.emailConfirmed })) return true;
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
 * Substitui `ensureAdminEmail(email)` nas rotas admin. Sem `callerId` (token
 * sem sub) só a allowlist vale. Mensagem do 403 diz os DOIS caminhos, porque
 * o operador que lê a faixa vermelha precisa saber o que fazer.
 */
export async function ensurePortalAdmin(args: {
  callerId: string;
  email: string;
  emailConfirmed?: boolean;
}): Promise<void> {
  if (await isPortalAdminUser(args)) return;
  throw new ServiceError(
    `não autorizado: a conta "${args.email || '(sem email no login)'}" não é admin do portal. ` +
      'Promova a pessoa na aba Pessoas do portal (botão Promover) ou adicione o e-mail na env ADMIN_EMAILS ' +
      '(Cloudflare Pages → Settings → Environment variables → Production) e refaça o deploy.',
    403,
  );
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
): Promise<{ callerId: string; email: string; emailConfirmed: boolean }> {
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
  if (!res.ok) throw new ServiceError('token inválido (auth ' + res.status + ': ' + (await res.text()).slice(0, 120) + ')', 401);
  const data = (await res.json()) as { id?: string; email?: string };
  return {
    callerId: data?.id || '',
    email: (data?.email || '').toLowerCase(),
    emailConfirmed: emailConfirmedFromGoTrue(data),
  };
}

/**
 * Admin "dono" = e-mail CONFIRMADO na allowlist `ADMIN_EMAILS`. É o único
 * nível que pode mexer em OUTRO admin (trocar login, revogar, excluir,
 * mudar papel). Operador promovido pelo portal (`portal_access`) tem o
 * resto. Sem essa separação, qualquer promovido tomava a conta de quem o
 * promoveu com um `set_email` + reset de senha.
 */
export function isOwnerAdmin(args: { email: string; emailConfirmed?: boolean }): boolean {
  return isTrustedAdminEmail(args);
}

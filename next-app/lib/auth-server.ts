// auth-server.ts — guard admin server-side pra RSCs do panel /admin.
//
// CRIT-4 (audit 2026-06-12): as 6 admin pages (/admin/reports, /admin/flags,
// /admin/products, /admin/products/[id], /admin/media-review,
// /admin/feature-interest) eram RSCs que montavam o componente client direto
// sem checar admin server-side. O guard era só client-side (mostrava "Sem
// acesso" se NÃO admin). Atacante autenticado que digitasse o path veria a
// page renderizar (HTML do shell), e — combinado com CRIT-3 (XSS) — escalava
// pra takeover.
//
// Estratégia (sem instalar @supabase/ssr — restrição do fix):
//
//   1. Helper de cookie httpOnly custom `sb-session-token` (gravado por
//      POST /api/auth/set-session-cookie após signIn). Lê o access_token JWT
//      do Supabase.
//   2. `requireAdminServer()`:
//        - Sem cookie → notFound() (não revela que /admin existe).
//        - Cookie com JWT inválido → notFound().
//        - JWT válido mas email não em ADMIN_EMAILS e profile.portal_access
//          != true → notFound().
//        - Admin → retorna `{ userId, email }`.
//   3. A page admin chama o helper antes de renderizar.
//   4. Defesa em profundidade: o componente client (ReportsAdmin etc.)
//      continua montando por baixo com seu próprio guard — RLS no DB já
//      protege escrita. Esse RSC guard bloqueia VAZAR o shell e info-
//      disclosure de URL existir.
//
// notFound() vs redirect(): preferimos notFound — admin legítimo que ainda
// não tem cookie (não passou pelo /login que grava cookie) vai ver 404,
// mas o ataque de info-disclosure fica bloqueado pra atacante random.
// Admin loga via /login (que chama set-session-cookie) → cookie grava →
// próximo acesso a /admin passa.

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
// Edge do Cloudflare: env do painel do Pages SÓ existe no request context —
// `process.env` dinâmico vem vazio em produção (descoberta 2026-08-22, ver
// lib/api/env.ts). Este guard lia process.env direto, então ADMIN_EMAILS e
// a service key nunca chegavam e TODO acesso a /admin/* caía em notFound(),
// mesmo admin com cookie válido. `getRuntimeEnv` lê o request context com
// fallback pra process.env (build/dev/vitest). Os acessos ESTÁTICOS a
// `process.env.NEXT_PUBLIC_*` ficam como fallback: o build do Next inlina
// essas expressões, então seguem funcionando onde o contexto faltar.
import { getRuntimeEnv } from '@/lib/api/env';
import {
  getSupabaseUrl as supabaseUrlOnly,
  resolveSupabaseEnv,
  type SupabaseEnvPair,
} from '@/lib/api/security';

const SESSION_COOKIE = 'sb-session-token';
const AUTH_TIMEOUT_MS = 10_000;

interface AdminGuardResult {
  userId: string;
  email: string;
}

// Delegam no par ÚNICO de security.ts — antes este arquivo tinha a PRÓPRIA
// ordem, que discordava da do `security.ts`. Caminhos diferentes escolhiam
// chaves diferentes, e só um deles funcionava.
//
// UMA resolução devolve url + anonKey juntas: quem fala com o GoTrue precisa
// das duas do MESMO projeto, e pedir cada metade por sua conta é a forma
// exata do bug de 2026-09-04.
function authEnv(): SupabaseEnvPair | null {
  try {
    return resolveSupabaseEnv();
  } catch {
    return null;
  }
}

// Só a URL — caminho de SERVICE ROLE (`isPortalAdmin`), que não pareia com
// anon key nenhuma e por isso pode usar o fallback só-URL do security.ts.
function getServiceUrl(): string | null {
  try {
    return supabaseUrlOnly();
  } catch {
    return null;
  }
}

function getServiceKey(): string | null {
  return (
    getRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getRuntimeEnv('SUPABASE_SERVICE_ROLE') ||
    getRuntimeEnv('SUPABASE_SERVICE_KEY') ||
    null
  );
}

/** Lê access_token do cookie httpOnly setado por /api/auth/set-session-cookie. */
async function readAccessTokenFromCookies(): Promise<string | null> {
  try {
    // next/headers cookies() é async no Next 15.
    const store = await cookies();
    const c = store.get(SESSION_COOKIE);
    if (!c?.value) return null;
    const v = c.value.trim();
    if (!v) return null;
    // Sanidade básica: JWT tem 3 segmentos.
    if (v.split('.').length !== 3) return null;
    return v;
  } catch {
    return null;
  }
}

/** Valida JWT via Supabase Auth REST. Retorna `{ id, email }` ou null. */
async function getUserFromToken(
  token: string
): Promise<{ id: string; email: string; emailConfirmed: boolean } | null> {
  const env = authEnv();
  if (!env) return null;
  try {
    const res = await fetch(`${env.url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.anonKey,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      id?: string;
      email?: string;
      email_confirmed_at?: unknown;
      confirmed_at?: unknown;
    };
    if (!data?.id || !data.email) return null;
    // Sessão de conta com e-mail NÃO confirmado existe (cadastro por e-mail
    // antes do clique no link). Nesse estado o e-mail não prova nada — só o
    // caminho por `portal_access`/`role` pode liberar. Ver auditoria 2026-09-11.
    const emailConfirmed =
      (typeof data.email_confirmed_at === 'string' && data.email_confirmed_at.length > 0) ||
      (typeof data.confirmed_at === 'string' && data.confirmed_at.length > 0);
    return { id: data.id, email: data.email.toLowerCase(), emailConfirmed };
  } catch {
    return null;
  }
}

/** Checa email em ADMIN_EMAILS env (runtime — nunca process.env direto). */
function isAdminEmail(email: string): boolean {
  const list = (getRuntimeEnv('ADMIN_EMAILS') || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Checa profile flags via service_role. Cobre admins via
 * portal_access/role='admin' que NÃO estão em ADMIN_EMAILS.
 * Fail-CLOSED: se REST falhar ou service key ausente, retorna false.
 *
 * FIX A-D1 (auditoria 2026-08-26): o select incluía `is_admin`, coluna que
 * NÃO existe em `profiles` (pegadinha documentada na Wave 34) — o PostgREST
 * respondia 400, `res.ok` era false e a função retornava SEMPRE false:
 * admins por portal_access/role fora de ADMIN_EMAILS caíam em 404 no
 * /admin/*. Nunca reintroduzir `is_admin` em select de profiles.
 */
async function isPortalAdmin(userId: string): Promise<boolean> {
  const url = getServiceUrl();
  const svc = getServiceKey();
  if (!url || !svc) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=portal_access,role`,
      {
        headers: {
          Authorization: `Bearer ${svc}`,
          apikey: svc,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      }
    );
    if (!res.ok) return false;
    const rows = (await res.json()) as Array<{
      portal_access?: boolean | null;
      role?: string | null;
    }>;
    const row = rows?.[0];
    if (!row) return false;
    return row.portal_access === true || row.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Guard admin pra RSCs do painel `/admin/*`.
 *
 * Comportamento:
 *   - Sem cookie de sessão: `notFound()`.
 *   - Cookie com JWT inválido: `notFound()`.
 *   - Sessão válida mas não admin: `notFound()`.
 *   - Admin: retorna `{ userId, email }`.
 *
 * `notFound()` joga pra 404 default — não revela que /admin existe.
 *
 * USO:
 * ```tsx
 * export const dynamic = 'force-dynamic';
 * export default async function AdminReportsPage() {
 *   await requireAdminServer();
 *   return <main>...</main>;
 * }
 * ```
 */
export async function requireAdminServer(): Promise<AdminGuardResult> {
  const token = await readAccessTokenFromCookies();
  if (!token) notFound();

  const user = await getUserFromToken(token);
  if (!user) notFound();

  // Admin via ADMIN_EMAILS env (só com e-mail confirmado) OR profile flags.
  const adminByEmail = user.emailConfirmed && isAdminEmail(user.email);
  const adminByProfile = adminByEmail
    ? true
    : await isPortalAdmin(user.id);

  if (!adminByEmail && !adminByProfile) notFound();
  return { userId: user.id, email: user.email };
}

export const __internal = {
  SESSION_COOKIE,
};

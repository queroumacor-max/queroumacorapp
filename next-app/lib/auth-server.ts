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

const SESSION_COOKIE = 'sb-session-token';
const AUTH_TIMEOUT_MS = 10_000;

interface AdminGuardResult {
  userId: string;
  email: string;
}

function getSupabaseUrl(): string | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  return url ? url.replace(/\/$/, '') : null;
}

function getAnonKey(): string | null {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    null
  );
}

function getServiceKey(): string | null {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
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
): Promise<{ id: string; email: string } | null> {
  const url = getSupabaseUrl();
  const anon = getAnonKey();
  if (!url || !anon) return null;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; email?: string };
    if (!data?.id || !data.email) return null;
    return { id: data.id, email: data.email.toLowerCase() };
  } catch {
    return null;
  }
}

/** Checa email em ADMIN_EMAILS env. */
function isAdminEmail(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/**
 * Checa profile flags via service_role. Cobre admins via
 * portal_access/is_admin/role='admin' que NÃO estão em ADMIN_EMAILS.
 * Fail-CLOSED: se REST falhar ou service key ausente, retorna false.
 */
async function isPortalAdmin(userId: string): Promise<boolean> {
  const url = getSupabaseUrl();
  const svc = getServiceKey();
  if (!url || !svc) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=portal_access,is_admin,role`,
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
      is_admin?: boolean | null;
      role?: string | null;
    }>;
    const row = rows?.[0];
    if (!row) return false;
    return (
      row.portal_access === true ||
      row.is_admin === true ||
      row.role === 'admin'
    );
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

  // Admin via ADMIN_EMAILS env OR profile flags.
  const adminByEmail = isAdminEmail(user.email);
  const adminByProfile = adminByEmail
    ? true
    : await isPortalAdmin(user.id);

  if (!adminByEmail && !adminByProfile) notFound();
  return { userId: user.id, email: user.email };
}

export const __internal = {
  SESSION_COOKIE,
};

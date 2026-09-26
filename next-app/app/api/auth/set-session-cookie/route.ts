// app/api/auth/set-session-cookie/route.ts — grava cookie httpOnly com o
// access_token do Supabase pra que RSCs do painel /admin/* possam validar
// sessão server-side (CRIT-4 do audit 2026-06-12).
//
// Cliente: `LoginForm` chama POST { accessToken } depois de signIn bem-
// sucedido. Sem isso, o cookie não é gravado e o admin verá 404 nas pages
// admin (RSC guard usa esse cookie via lib/auth-server.ts).
//
// Segurança:
//   - Valida JWT via Supabase Auth REST antes de gravar (não confia no body).
//   - Cookie httpOnly + Secure + SameSite=Strict + Path=/ (as páginas
//     /admin/* que leem o cookie são same-site; Strict não custa nada).
//   - Anti login-CSRF (auditoria 2026-09-26): só aceita Content-Type
//     application/json (form cross-site só manda text/plain/urlencoded/
//     multipart sem preflight → 415) e, com header Origin presente, só a
//     origem do próprio app (→ 403). Sem isso, um site terceiro postava um
//     token DO ATACANTE e o navegador da vítima gravava a sessão dele.
//   - max-age 1h (session token Supabase costuma viver isso; client renova).
//   - DELETE limpa o cookie (chamado pelo AuthProvider em signOut).

import { NextResponse, type NextRequest } from 'next/server';
import {
  enforceRateLimit,
  resolveSupabaseEnv,
  type SupabaseEnvPair,
} from '@/lib/api/security';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages, que exigia o
// contrário; ver ADR 0006 e docs/adr/0006-workers-migration-artifacts.md).
export const runtime = 'nodejs';

const SESSION_COOKIE = 'sb-session-token';
const AUTH_TIMEOUT_MS = 10_000;
const COOKIE_MAX_AGE = 60 * 60; // 1h

// Par ÚNICO de security.ts, resolvido de UMA vez. Este arquivo tinha a
// PRÓPRIA ordem (e ainda misturava process.env com getRuntimeEnv), podendo
// escolher uma chave de projeto diferente da url — a raiz do incidente de
// 2026-09-04. Url e anonKey saem do MESMO objeto: nunca duas resoluções.
function authEnv(): SupabaseEnvPair | null {
  try {
    return resolveSupabaseEnv();
  } catch {
    return null;
  }
}

async function validateToken(token: string): Promise<boolean> {
  const env = authEnv();
  if (!env) return false;
  try {
    const res = await fetch(`${env.url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.anonKey,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { id?: string };
    return !!data?.id;
  } catch {
    return false;
  }
}

const ALLOWED_ORIGINS = new Set([
  'https://queroumacor.com.br',
  'https://www.queroumacor.com.br',
]);

/** Origem permitida: produção OU a própria origem da request (preview/dev).
 * NÃO exportar: route.ts do Next só aceita exports fechados (quebra o build). */
function isAllowedOrigin(origin: string, requestUrl: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    return new URL(requestUrl).origin === origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return NextResponse.json({ error: 'Unsupported Media Type' }, { status: 415 });
  }
  const origin = request.headers.get('origin');
  if (origin && !isAllowedOrigin(origin, request.url)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }
  // Valida JWT contra o Supabase — limita brute-force de token por IP.
  const limited = await enforceRateLimit(request, { endpoint: 'set-session-cookie', limit: 20 });
  if (limited) return limited;
  let body: { accessToken?: unknown } | null = null;
  try {
    body = (await request.json()) as { accessToken?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const accessToken =
    typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';

  // JWT tem 3 segmentos. Sanidade básica antes de bater no Supabase.
  if (!accessToken || accessToken.split('.').length !== 3) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const valid = await validateToken(accessToken);
  if (!valid) {
    return NextResponse.json({ error: 'Token verification failed' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: accessToken,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

/** DELETE limpa o cookie no signOut. */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204 });
}

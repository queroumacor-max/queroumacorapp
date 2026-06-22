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
//   - Cookie httpOnly + Secure + SameSite=Lax + Path=/.
//   - max-age 1h (session token Supabase costuma viver isso; client renova).
//   - DELETE limpa o cookie (chamado pelo AuthProvider em signOut).

import { NextResponse, type NextRequest } from 'next/server';
import { enforceRateLimit } from '@/lib/api/security';

// Cloudflare Pages (next-on-pages) exige edge runtime explícito por rota.
export const runtime = 'edge';

const SESSION_COOKIE = 'sb-session-token';
const AUTH_TIMEOUT_MS = 10_000;
const COOKIE_MAX_AGE = 60 * 60; // 1h

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

async function validateToken(token: string): Promise<boolean> {
  const url = getSupabaseUrl();
  const anon = getAnonKey();
  if (!url || !anon) return false;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anon,
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

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    sameSite: 'lax',
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
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204 });
}

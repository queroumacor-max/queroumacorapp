// app/api/log-error/route.ts — port de `functions/api/log-error.js` +
// `functions/api/_services/log-error.js`. Recebe payload de erro do front
// (Web Vitals, exceptions, CSP), sanitiza, loga no console (Cloudflare/
// Vercel logs) e persiste em `errors` via service-role.
//
// FAIL-OPEN: sem SUPABASE_SERVICE_ROLE_KEY ou tabela ausente, segue só
// com console.log. Vanilla também faz best-effort com `waitUntil`; aqui,
// como o Next edge runtime não expõe waitUntil diretamente em route
// handlers, awaitamos a insert (latência aceita pra um endpoint de log).
//
// AINDA NÃO portado: rate-limit por IP (`ip:<x>`) — `_security.checkRateLimit`
// completa só funciona com user-id no vanilla, mas log-error usa IP. Quando
// portar checkRateLimit, ajustar a RPC pra aceitar prefixo "ip:".

import type { NextRequest } from 'next/server';
import { ServiceError, jsonResponse, serviceErrorResponse } from '@/lib/api/security';

export const runtime = 'edge';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSERT_TIMEOUT_MS = 5000;

interface LogErrorBody {
  type?: unknown;
  msg?: unknown;
  stack?: unknown;
  url?: unknown;
  ua?: unknown;
  metric?: unknown;
  value?: unknown;
  ctx?: unknown;
  user_id?: unknown;
  // aliases que o front também manda (alguns endpoints novos usam camelCase)
  message?: unknown;
  userAgent?: unknown;
  context?: unknown;
}

interface SafeErrorPayload {
  type: string | null;
  msg: string | null;
  stack: string | null;
  url: string | null;
  ua: string | null;
  metric: string | null;
  value: number | null;
  ctx: string | null;
  ts: number;
  user_id: string | null;
}

export async function POST(request: NextRequest) {
  try {
    // Body inválido: vanilla retorna 200 silenciosamente pra evitar loop de
    // log-error → log-error. Mantemos o mesmo comportamento.
    let body: LogErrorBody;
    try {
      body = (await request.json()) as LogErrorBody;
    } catch {
      return jsonResponse({ ok: true });
    }

    const safe = sanitizeErrorPayload(body);
    // Logar antes de tentar inserir — garante registro mesmo se o Supabase
    // estiver fora (Cloudflare/Vercel logs capturam).
    console.log('[client-log]', JSON.stringify(safe));
    await insertErrorRow(safe);
    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('log-error:', e);
    return jsonResponse({ error: 'internal' }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

function trunc(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  return v.slice(0, n);
}

export function sanitizeErrorPayload(body: LogErrorBody): SafeErrorPayload {
  const uidRaw = typeof body.user_id === 'string' ? body.user_id : '';
  // Aceita tanto `msg` (vanilla) quanto `message` (clientes novos).
  const msg = (typeof body.msg === 'string' ? body.msg : null) ??
              (typeof body.message === 'string' ? body.message : null);
  const ua = (typeof body.ua === 'string' ? body.ua : null) ??
             (typeof body.userAgent === 'string' ? body.userAgent : null);
  const ctx = (typeof body.ctx === 'string' ? body.ctx : null) ??
              (typeof body.context === 'string' ? body.context : null);
  return {
    type: trunc(body.type, 32),
    msg: trunc(msg, 500),
    stack: trunc(body.stack, 1500),
    url: trunc(body.url, 300),
    ua: trunc(ua, 200),
    metric: trunc(body.metric, 32),
    value: typeof body.value === 'number' ? body.value : null,
    ctx: trunc(ctx, 100),
    ts: Date.now(),
    user_id: UUID_RE.test(uidRaw) ? uidRaw : null,
  };
}

async function insertErrorRow(safe: SafeErrorPayload): Promise<void> {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) return; // fail-open

  const row = {
    type: safe.type,
    msg: safe.msg,
    stack: safe.stack,
    url: safe.url,
    ua: safe.ua,
    metric: safe.metric,
    value: safe.value,
    ctx: safe.ctx,
    user_id: safe.user_id,
    client_ts: safe.ts,
  };
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/errors`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
    });
    if (!res.ok) console.warn('[log-error] insert failed:', res.status);
  } catch (e) {
    console.warn('[log-error] insert err:', e instanceof Error ? e.message : e);
  }
}

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
//
// NOTA: `sanitizeErrorPayload` foi extraído pra `lib/api/log-error-helpers.ts`
// porque Next.js 15 não permite exports de helpers em arquivos de rota
// (só HTTP method handlers + config).

import type { NextRequest } from 'next/server';
import { ServiceError, jsonResponse, readBody, serviceErrorResponse } from '@/lib/api/security';
import {
  sanitizeErrorPayload,
  type LogErrorBody,
  type SafeErrorPayload,
} from '@/lib/api/log-error-helpers';

export const runtime = 'edge';

const INSERT_TIMEOUT_MS = 5000;

export async function POST(request: NextRequest) {
  try {
    // Body inválido: vanilla retorna 200 silenciosamente pra evitar loop de
    // log-error → log-error. Mantemos o mesmo comportamento — mas se for
    // 413 (payload abusivo), retorna o status normalmente: cliente honesto
    // jamais envia >1MB de log de erro, então um 413 ajuda a flagar abuso.
    let body: LogErrorBody;
    try {
      body = (await readBody(request, { maxBytes: 1024 * 1024 })) as LogErrorBody;
    } catch (e) {
      if (e instanceof ServiceError && e.status === 413) return serviceErrorResponse(e);
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

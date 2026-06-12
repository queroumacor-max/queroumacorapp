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
// R-H2 + R-H10 (rate-limit + Zod): chamadas com IP como chave. Body
// inválido ainda retorna 200 silencioso pra evitar loop (cliente honesto
// não tem incentivo a flag o shape; flag só payload pathológico via 413).
// Rate limit é FAIL-OPEN (checkRateLimit já cai silenciosamente em DB
// down) — não trava logging legítimo durante incidente real.
//
// NOTA: `sanitizeErrorPayload` foi extraído pra `lib/api/log-error-helpers.ts`
// porque Next.js 15 não permite exports de helpers em arquivos de rota
// (só HTTP method handlers + config).

import type { NextRequest } from 'next/server';
import {
  ServiceError,
  checkRateLimit,
  jsonResponse,
  rateLimitResponse,
  readBody,
  serviceErrorResponse,
} from '@/lib/api/security';
import {
  sanitizeErrorPayload,
  type LogErrorBody,
  type SafeErrorPayload,
} from '@/lib/api/log-error-helpers';
import { logErrorSchema } from '@/lib/api/schemas/log-error';

export const runtime = 'edge';

const INSERT_TIMEOUT_MS = 5000;

export async function POST(request: NextRequest) {
  try {
    // ─── 1) Rate limit por IP (R-H2) ─────────────────────────────────────
    // Endpoint público sem auth — sem cap, atacante drena quota Sentry e
    // floda a tabela `errors`. 30 req/min é confortável pro client honesto
    // (Web Vitals + 1-2 erros JS por sessão) e barra abuso bruto.
    const ip = extractIp(request);
    const rl = await checkRateLimit({
      userId: `log-error:${ip}`,
      endpoint: 'log-error',
      limit: 30,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

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

    // ─── 2) Validação Zod (R-H10) ─────────────────────────────────────────
    // Schema mantém comportamento fail-soft: shape inválido → 200 silencioso
    // (cliente não fica em loop). Schema só impede payload patológico via
    // hard caps que o sanitizer reforça depois.
    const parsed = logErrorSchema.safeParse(body);
    if (!parsed.success) {
      // Loga shape inválido pra Sentry/CF logs sem persistir nem propagar.
      console.warn('[log-error] invalid_shape', parsed.error.issues.slice(0, 3));
      return jsonResponse({ ok: true });
    }

    const safe = sanitizeErrorPayload(parsed.data as LogErrorBody);
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

/**
 * Extrai IP do request usando os headers que o Cloudflare Pages popula.
 * `cf-connecting-ip` é a fonte canônica; `x-forwarded-for` é fallback pra
 * outros edges (Vercel/local). Retorna 'unknown' se nenhum bater — não
 * bloqueia o request mas o rate limit ainda funciona com a string fixa.
 */
function extractIp(request: NextRequest | Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
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

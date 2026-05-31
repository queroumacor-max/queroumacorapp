// @ts-check
// Business logic do health check. Sem Request/Response — devolve um objeto
// com os campos do payload. Controller embrulha em Response 200 com headers
// de CORS + no-store.
import { FALLBACK_SUPABASE_URL } from '../_security.js';

const SUPABASE_TIMEOUT_MS = 2000;

/**
 * Coleta o estado de saúde do app.
 * Liveness do Supabase: ping no /rest/v1/ root com timeout curto. Falha
 * NÃO derruba (sempre devolve algo) — só sinaliza no body.
 * @param {{ env: Record<string, string>, colo?: string | null }} args
 * @returns {Promise<{ status: 'ok', time: string, app: 'queroumacorapp', region: string | null, version: string, supabase: 'ok'|'unreachable' }>}
 */
export async function getHealth({ env, colo }) {
  /** @type {any} */
  const body = {
    status: 'ok',
    time: new Date().toISOString(),
    app: 'queroumacorapp',
    region: colo || null,
    version: env.CF_PAGES_COMMIT_SHA || 'unknown'
  };
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  try {
    const r = await fetch(supaUrl + '/rest/v1/', { signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS) });
    // 401/404 são respostas válidas (Supabase respondeu). Só "unreachable"
    // se a request nem completar (timeout/erro).
    body.supabase = r.status > 0 ? 'ok' : 'unreachable';
  } catch (_) {
    body.supabase = 'unreachable';
  }
  return body;
}

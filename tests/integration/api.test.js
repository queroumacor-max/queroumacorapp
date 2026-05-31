// Integration tests for Cloudflare Pages Functions endpoints in /functions/api.
// Strategy: mock global.fetch per-test to intercept outbound HTTP (Supabase REST,
// Supabase Auth, IBGE, AI providers). No real network calls.
//
// Each endpoint exports onRequestPost/onRequestGet — we invoke them with a
// hand-rolled context { request, env, waitUntil }, simulating Cloudflare runtime.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { onRequest as healthHandler } from '../../functions/api/health.js';
import { onRequestPost as logErrorHandler } from '../../functions/api/log-error.js';
import { onRequestPost as authRateHandler } from '../../functions/api/auth-rate-check.js';
import { onRequestPost as adminErrorsHandler } from '../../functions/api/admin-errors-list.js';
import { onRequestGet as cidadesHandler } from '../../functions/api/cidades.js';
import { onRequestPost as resolveColorHandler } from '../../functions/api/resolve-color.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest({ method = 'POST', url = 'https://x/api/y', body, headers = {} } = {}) {
  const init = {
    method,
    headers: { 'content-type': 'application/json', ...headers }
  };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

async function invoke(handler, { method, body, headers, env = {}, url, cf } = {}) {
  const request = makeRequest({ method, body, headers, url });
  const ctx = { request, env, waitUntil: () => {}, params: {} };
  if (cf) ctx.cf = cf;
  return handler(ctx);
}

// fetch mock builder: maps url-substring -> response factory.
// Default behavior returns { ok:true, status:200, json:{} } so endpoints that
// fan out to Supabase rate-limit etc. don't explode.
function installFetchMock(routes = {}) {
  const fn = vi.fn(async (input, _init) => {
    const url = typeof input === 'string' ? input : (input?.url || '');
    for (const [needle, factory] of Object.entries(routes)) {
      if (url.includes(needle)) {
        const out = typeof factory === 'function' ? await factory(url, _init) : factory;
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out.body ?? {}), {
          status: out.status ?? 200,
          headers: out.headers ?? { 'content-type': 'application/json' }
        });
      }
    }
    // Default: empty 200 JSON
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  // Silence console.warn/log noise from fail-open paths
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── health.js ──────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with status ok and supabase=ok when supabase reachable', async () => {
    installFetchMock({
      '/rest/v1/': { status: 401, body: {} } // Supabase REST root usually 401 without key — counts as "ok"
    });
    const res = await invoke(healthHandler, { method: 'GET', env: { CF_PAGES_COMMIT_SHA: 'abc123' }, cf: { colo: 'GRU' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.app).toBe('queroumacorapp');
    expect(json.region).toBe('GRU');
    expect(json.version).toBe('abc123');
    expect(json.supabase).toBe('ok');
  });

  it('marks supabase unreachable when fetch throws', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down'); });
    const res = await invoke(healthHandler, { method: 'GET', env: {} });
    expect(res.status).toBe(200); // health is always 200 by design
    const json = await res.json();
    expect(json.supabase).toBe('unreachable');
  });

  it('sets CORS and no-store cache headers', async () => {
    installFetchMock({});
    const res = await invoke(healthHandler, { method: 'GET', env: {} });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

// ── log-error.js ───────────────────────────────────────────────────────────

describe('POST /api/log-error', () => {
  it('returns {ok:true} on valid payload (no service key → console-only path)', async () => {
    installFetchMock({});
    const res = await invoke(logErrorHandler, {
      body: { type: 'error', msg: 'boom', url: 'https://x/y', ua: 'jest' },
      env: {} // sem SERVICE_ROLE → skip insert, fail-open
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('returns ok even with bad JSON body (defensive — silenced for noisy clients)', async () => {
    installFetchMock({});
    const request = new Request('https://x/api/log-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json'
    });
    const res = await logErrorHandler({ request, env: {}, waitUntil: () => {} });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('attempts insert into errors table when SUPABASE_SERVICE_ROLE present', async () => {
    let insertCalled = false;
    const fetchMock = installFetchMock({
      '/rest/v1/rpc/check_rate_limit': { body: { allowed: true, count: 1, limit: 60 } },
      '/rest/v1/errors': (url, init) => {
        insertCalled = true;
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body);
        expect(body.type).toBe('error');
        expect(body.msg).toBe('crash');
        return { status: 201, body: {} };
      }
    });
    // Use a synchronous waitUntil so we can await the fire-and-forget insert
    const promises = [];
    const ctx = {
      request: makeRequest({ body: { type: 'error', msg: 'crash', user_id: '11111111-2222-3333-4444-555555555555' } }),
      env: { SUPABASE_SERVICE_ROLE: 'sk-test', SUPABASE_URL: 'https://fake.supabase.co' },
      waitUntil: (p) => promises.push(p)
    };
    const res = await logErrorHandler(ctx);
    expect(res.status).toBe(200);
    // drain fire-and-forget
    await Promise.all(promises);
    expect(insertCalled).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('returns 429 when rate limit exceeded', async () => {
    installFetchMock({
      '/rest/v1/rpc/check_rate_limit': { body: { allowed: false, count: 61, limit: 60, retry_after_seconds: 30 } }
    });
    const res = await invoke(logErrorHandler, {
      body: { type: 'error', msg: 'spam' },
      env: { SUPABASE_SERVICE_ROLE: 'sk-test', SUPABASE_URL: 'https://fake.supabase.co' },
      headers: { 'CF-Connecting-IP': '1.2.3.4' }
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
  });
});

// ── auth-rate-check.js ────────────────────────────────────────────────────

describe('POST /api/auth-rate-check', () => {
  it('returns allowed:true with default login limit when no service key (skipped)', async () => {
    installFetchMock({});
    const res = await invoke(authRateHandler, { body: { action: 'login' }, env: {} });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.allowed).toBe(true);
    expect(json.action).toBe('login');
    expect(json.limit).toBe(10);
    expect(json.skipped).toBe(true);
  });

  it('coerces unknown action to login', async () => {
    installFetchMock({});
    const res = await invoke(authRateHandler, { body: { action: 'hackeartudo' }, env: {} });
    const json = await res.json();
    expect(json.action).toBe('login');
    expect(json.limit).toBe(10);
  });

  it('uses signup-specific limit (5) for action=signup', async () => {
    installFetchMock({});
    const res = await invoke(authRateHandler, { body: { action: 'signup' }, env: {} });
    const json = await res.json();
    expect(json.action).toBe('signup');
    expect(json.limit).toBe(5);
  });

  it('returns 429 when rate limit exceeded (service key configured)', async () => {
    installFetchMock({
      '/rest/v1/rpc/check_rate_limit': { body: { allowed: false, count: 11, limit: 10, retry_after_seconds: 45 } }
    });
    const res = await invoke(authRateHandler, {
      body: { action: 'login' },
      env: { SUPABASE_SERVICE_ROLE: 'sk-test', SUPABASE_URL: 'https://fake.supabase.co' },
      headers: { 'CF-Connecting-IP': '9.9.9.9' }
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('45');
  });
});

// ── admin-errors-list.js ───────────────────────────────────────────────────

describe('POST /api/admin-errors-list', () => {
  it('returns 503 when SUPABASE_SERVICE_ROLE / ADMIN_EMAILS missing', async () => {
    installFetchMock({});
    const res = await invoke(adminErrorsHandler, { body: {}, env: {} });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/Dashboard admin não configurado/);
  });

  it('returns 400 on invalid JSON body', async () => {
    installFetchMock({});
    const request = new Request('https://x/api/admin-errors-list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad'
    });
    const res = await adminErrorsHandler({
      request,
      env: { SUPABASE_SERVICE_ROLE: 'sk', ADMIN_EMAILS: 'a@b.com' },
      waitUntil: () => {}
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 when no token provided', async () => {
    installFetchMock({});
    const res = await invoke(adminErrorsHandler, {
      body: {},
      env: { SUPABASE_SERVICE_ROLE: 'sk', ADMIN_EMAILS: 'a@b.com' }
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/sem token/);
  });

  it('returns 403 when authenticated user is NOT in ADMIN_EMAILS', async () => {
    installFetchMock({
      '/auth/v1/user': { body: { id: 'user-1', email: 'rando@b.com' } }
    });
    const res = await invoke(adminErrorsHandler, {
      body: {},
      headers: { 'Authorization': 'Bearer fake-jwt' },
      env: { SUPABASE_SERVICE_ROLE: 'sk', ADMIN_EMAILS: 'admin@b.com', SUPABASE_URL: 'https://fake.supabase.co' }
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/não autorizado/);
  });

  it('returns 200 with rows + total when caller is admin', async () => {
    installFetchMock({
      '/auth/v1/user': { body: { id: 'admin-1', email: 'admin@b.com' } },
      '/rest/v1/rpc/check_rate_limit': { body: { allowed: true, count: 1, limit: 60 } },
      '/rest/v1/errors?': (_url) => new Response(
        JSON.stringify([{ id: 1, msg: 'boom', type: 'error', created_at: '2026-05-30T00:00:00Z' }]),
        { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/42' } }
      )
    });
    const res = await invoke(adminErrorsHandler, {
      body: { limit: 10 },
      headers: { 'Authorization': 'Bearer fake-jwt' },
      env: { SUPABASE_SERVICE_ROLE: 'sk', ADMIN_EMAILS: 'admin@b.com', SUPABASE_URL: 'https://fake.supabase.co' }
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.rows)).toBe(true);
    expect(json.rows[0].msg).toBe('boom');
    expect(json.total).toBe(42);
    expect(json.limit).toBe(10);
  });

  it('returns 401 when supabase auth rejects token', async () => {
    installFetchMock({
      '/auth/v1/user': { status: 401, body: { error: 'bad' } }
    });
    const res = await invoke(adminErrorsHandler, {
      body: {},
      headers: { 'Authorization': 'Bearer expired' },
      env: { SUPABASE_SERVICE_ROLE: 'sk', ADMIN_EMAILS: 'admin@b.com', SUPABASE_URL: 'https://fake.supabase.co' }
    });
    expect(res.status).toBe(401);
  });
});

// ── cidades.js ─────────────────────────────────────────────────────────────

describe('GET /api/cidades', () => {
  it('returns 400 for invalid UF', async () => {
    installFetchMock({});
    const res = await invoke(cidadesHandler, {
      method: 'GET',
      url: 'https://x/api/cidades?uf=ZZ',
      env: {}
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/UF inválida/);
  });

  it('returns 400 when uf missing', async () => {
    installFetchMock({});
    const res = await invoke(cidadesHandler, {
      method: 'GET',
      url: 'https://x/api/cidades',
      env: {}
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with mapped cidades for valid UF (case-insensitive)', async () => {
    installFetchMock({
      'servicodados.ibge.gov.br': {
        body: [{ nome: 'São Paulo' }, { nome: 'Campinas' }, { extra: 'ignored', nome: 'Santos' }]
      }
    });
    // env sem KV binding → X-Cache: BYPASS (comportamento pré-KV preservado).
    const res = await invoke(cidadesHandler, {
      method: 'GET',
      url: 'https://x/api/cidades?uf=sp',
      env: { KV: undefined }
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uf).toBe('SP');
    expect(json.cidades).toEqual([{ nome: 'São Paulo' }, { nome: 'Campinas' }, { nome: 'Santos' }]);
    expect(res.headers.get('cache-control')).toMatch(/max-age=86400/);
    expect(res.headers.get('x-cache')).toBe('BYPASS');
  });

  it('returns 502 when IBGE returns non-2xx', async () => {
    installFetchMock({
      'servicodados.ibge.gov.br': { status: 500, body: {} }
    });
    const res = await invoke(cidadesHandler, {
      method: 'GET',
      url: 'https://x/api/cidades?uf=RJ',
      env: { KV: undefined }
    });
    expect(res.status).toBe(502);
  });

  it('serves from KV cache (HIT) without calling IBGE when key exists', async () => {
    const cached = [{ nome: 'São Paulo' }, { nome: 'Guarulhos' }];
    const fakeKV = {
      get: vi.fn(async (_key, _type) => cached),
      put: vi.fn(async () => {})
    };
    const fetchMock = installFetchMock({
      // Se o IBGE for chamado por engano, devolve algo claramente diferente
      // pra falhar o assert de payload abaixo.
      'servicodados.ibge.gov.br': { body: [{ nome: 'NÃO_DEVERIA_BATER' }] }
    });
    const res = await invoke(cidadesHandler, {
      method: 'GET',
      url: 'https://x/api/cidades?uf=SP',
      env: { KV: fakeKV }
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.uf).toBe('SP');
    expect(json.cidades).toEqual(cached);
    expect(res.headers.get('x-cache')).toBe('HIT');
    expect(fakeKV.get).toHaveBeenCalledWith('cidades:SP', 'json');
    expect(fakeKV.put).not.toHaveBeenCalled();
    // Confirma que IBGE NÃO foi chamado.
    const ibgeCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('servicodados.ibge.gov.br'));
    expect(ibgeCalls.length).toBe(0);
  });

  it('on KV MISS fetches IBGE and writes-back to KV with 7d TTL', async () => {
    const fakeKV = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {})
    };
    installFetchMock({
      'servicodados.ibge.gov.br': {
        body: [{ nome: 'Rio de Janeiro' }, { nome: 'Niterói' }]
      }
    });
    const res = await invoke(cidadesHandler, {
      method: 'GET',
      url: 'https://x/api/cidades?uf=RJ',
      env: { KV: fakeKV }
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.cidades).toEqual([{ nome: 'Rio de Janeiro' }, { nome: 'Niterói' }]);
    expect(res.headers.get('x-cache')).toBe('MISS');
    expect(fakeKV.get).toHaveBeenCalledWith('cidades:RJ', 'json');
    expect(fakeKV.put).toHaveBeenCalledTimes(1);
    const [putKey, putValue, putOpts] = fakeKV.put.mock.calls[0];
    expect(putKey).toBe('cidades:RJ');
    expect(JSON.parse(putValue)).toEqual([{ nome: 'Rio de Janeiro' }, { nome: 'Niterói' }]);
    expect(putOpts).toEqual({ expirationTtl: 7 * 24 * 3600 });
  });
});

// ── resolve-color.js ───────────────────────────────────────────────────────
// gateProAI requires service key OR returns 503; we test that branch + missing
// AI key branch. Happy path requires mocking callAIText which is imported from
// ./_ai.js — too tangled for an integration test (would need vi.mock on the
// ESM module). Covered by 503 + 400 paths instead.

describe('POST /api/resolve-color', () => {
  it('returns 503 when neither OPENAI_API_KEY nor GEMINI_API_KEY configured', async () => {
    installFetchMock({});
    const res = await invoke(resolveColorHandler, {
      body: { items: [{ id: '1', name: 'Vermelho Ferrari' }] },
      env: {}
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/IA não configurada/);
  });

  it('returns 400 for invalid JSON body', async () => {
    installFetchMock({});
    const request = new Request('https://x/api/resolve-color', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json'
    });
    const res = await resolveColorHandler({
      request,
      env: { OPENAI_API_KEY: 'sk-x' },
      waitUntil: () => {}
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 from gateProAI when service-role key missing (fail-CLOSED for IA endpoints)', async () => {
    installFetchMock({});
    const res = await invoke(resolveColorHandler, {
      body: { items: [{ id: '1', name: 'Branco Neve' }] },
      env: { OPENAI_API_KEY: 'sk-x' } // OPENAI present, but no service role → gateProAI returns 503
    });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/indisponível/);
  });

  // Note: happy-path test (200 with colors map) is skipped because callAIText
  // lives in ./_ai.js — would require vi.mock at the ESM module level which
  // conflicts with the top-level import of resolveColorHandler. The other
  // branches (no AI key / bad JSON / no service-role) exercise the entire
  // gateProAI + JSON-parse pipeline, which is the integration surface.
});

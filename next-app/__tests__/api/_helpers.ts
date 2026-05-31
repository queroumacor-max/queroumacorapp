// __tests__/api/_helpers.ts — utilitários compartilhados pelos testes
// dos route handlers de IA. Cobre as armadilhas comuns:
//   - gateProAI exige SUPABASE_SERVICE_ROLE_KEY pra não devolver 503.
//   - requireAuth chama `/auth/v1/user` — precisa mockar fetch.
//   - requirePro chama `/rest/v1/profiles` — também mockar pro user PRO.
//   - checkRateLimit chama RPC — devolver `{allowed:true}` por default.
//
// `installAuthMocks({ pro, fetchRest })` substitui `globalThis.fetch` por uma
// função que despacha pra: (1) endpoints de auth/rate-limit → mocks fixos;
// (2) outras URLs → handler customizado do teste pra simular OpenAI/Gemini.

import { vi, type Mock } from 'vitest';

export interface FetchCall {
  url: string;
  init?: RequestInit;
}

export interface InstallAuthMocksOpts {
  /** Se true (default), profile retorna `is_pro=true`. False → 403. */
  pro?: boolean;
  /** Se true, `/auth/v1/user` falha (token inválido). */
  unauth?: boolean;
  /**
   * Handler customizado pras URLs que NÃO são auth/profiles/rate_limit.
   * Use pra simular OpenAI/Gemini.
   */
  fetchRest?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface InstalledMocks {
  fetch: Mock;
  calls: FetchCall[];
  restore: () => void;
}

const SUPABASE_URL_TEST = 'https://test.supabase.co';

/**
 * Configura env-vars + globalThis.fetch pros testes de route handler de IA.
 * Sempre chame `restore()` no afterEach.
 */
export function installAuthMocks(opts: InstallAuthMocksOpts = {}): InstalledMocks {
  const { pro = true, unauth = false, fetchRest } = opts;

  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  process.env.SUPABASE_URL = SUPABASE_URL_TEST;
  process.env.SUPABASE_ANON_KEY = 'anon-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-test';

  const calls: FetchCall[] = [];

  const fetchMock: Mock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });

      // Auth check: /auth/v1/user
      if (url.includes('/auth/v1/user')) {
        if (unauth) return new Response('', { status: 401 });
        return new Response(
          JSON.stringify({ id: 'user-test-id', email: 'test@example.com' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // PRO check: /rest/v1/profiles?id=eq.<userId>
      if (url.includes('/rest/v1/profiles?')) {
        return new Response(
          JSON.stringify([{ is_pro: pro, pro_expires_at: null }]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // Rate limit RPC
      if (url.includes('/rest/v1/rpc/check_rate_limit')) {
        return new Response(
          JSON.stringify({ allowed: true, count: 1, limit: 30 }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // Outras URLs (OpenAI/Gemini/etc.) → handler do teste ou 500.
      if (fetchRest) return fetchRest(url, init);
      return new Response('not mocked', { status: 500 });
    }
  );

  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

  return {
    fetch: fetchMock,
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
      process.env = { ...originalEnv };
    },
  };
}

/**
 * Cria um NextRequest POST com body JSON + Bearer token.
 */
export function mkJsonReq(
  path: string,
  body: unknown,
  opts: { token?: string } = {}
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts.token !== undefined) {
    headers['authorization'] = `Bearer ${opts.token}`;
  } else {
    headers['authorization'] = 'Bearer test-token';
  }
  return new Request(`https://app.test${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Cria um NextRequest POST com FormData (multipart). Inclui accessToken por padrão.
 */
export function mkFormReq(
  path: string,
  fields: Record<string, string | Blob>,
  opts: { token?: string } = {}
): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) {
    headers['authorization'] = `Bearer ${opts.token}`;
  } else {
    headers['authorization'] = 'Bearer test-token';
  }
  return new Request(`https://app.test${path}`, {
    method: 'POST',
    headers,
    body: fd,
  });
}

/** Helper: cria Response JSON OpenAI Chat Completions com `content`. */
export function openAIChatResponse(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

/** Helper: cria Response JSON Gemini com `text`. */
export function geminiTextResponse(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

// __tests__/sw.test.ts — testes do Service Worker (`public/sw.js`).
//
// Por que carregar o fonte em vez de importar: `sw.js` roda num
// ServiceWorkerGlobalScope, não é um módulo — ele só registra handlers em
// `self`. Aqui montamos um escopo falso (self + Cache API + fetch), avaliamos
// o arquivo dentro dele e disparamos os eventos na mão.
//
// O que estes testes protegem: a regra de que RESPOSTA DE ERRO NUNCA ENTRA
// NEM SAI DO CACHE. Foi o que causou o "deu erro 500 e não abre mais" — um
// 500 passageiro virava conteúdo permanente e voltava a cada falha de rede.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SW_SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf-8');

const ORIGIN = 'https://queroumacor.com.br';

// ─── Cache API mínima em memória ────────────────────────────────────────────
class FakeCache {
  store = new Map<string, Response>();
  async put(req: Request | string, res: Response) {
    this.store.set(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url, res);
  }
  async match(req: Request | string) {
    return this.store.get(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url) ?? undefined;
  }
  async keys() {
    return [...this.store.keys()].map((u) => new Request(u));
  }
  async delete(req: Request | string) {
    return this.store.delete(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async match(req: Request | string) {
    for (const c of this.caches.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
}

interface Harness {
  cacheStorage: FakeCacheStorage;
  fetchCalls: string[];
  /** Fila de respostas por URL; cada chamada consome a próxima. */
  queue: Map<string, Array<Response | 'network-error'>>;
  handleFetch: (req: Request) => Promise<Response>;
  runInstall: () => Promise<void>;
  runActivate: () => Promise<void>;
}

function buildHarness(): Harness {
  const cacheStorage = new FakeCacheStorage();
  const fetchCalls: string[] = [];
  const queue = new Map<string, Array<Response | 'network-error'>>();

  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  const fakeFetch = async (input: Request | string) => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).href : input.url;
    fetchCalls.push(url);
    const pending = queue.get(url);
    const next = pending && pending.length ? pending.shift()! : 'network-error';
    if (next === 'network-error') throw new TypeError('Failed to fetch');
    return next;
  };

  const self = {
    location: new URL(`${ORIGIN}/`),
    addEventListener(type: string, fn: (e: unknown) => void) {
      (listeners[type] ||= []).push(fn);
    },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined, matchAll: async () => [] },
    registration: { showNotification: async () => undefined, unregister: async () => true },
  };

  // `setTimeout` imediato: o SW espera NAV_RETRY_DELAY_MS antes de repetir a
  // navegação; no teste isso vira zero pra não gastar tempo de suíte.
  const immediateTimeout = (fn: () => void) => {
    Promise.resolve().then(fn);
    return 0;
  };

  // eslint-disable-next-line no-new-func
  const evaluate = new Function(
    'self',
    'caches',
    'fetch',
    'Response',
    'Request',
    'URL',
    'setTimeout',
    SW_SOURCE,
  );
  evaluate(self, cacheStorage, fakeFetch, Response, Request, URL, immediateTimeout);

  const fire = async (type: string, event: Record<string, unknown>) => {
    for (const fn of listeners[type] || []) fn(event);
  };

  return {
    cacheStorage,
    fetchCalls,
    queue,
    async handleFetch(req: Request) {
      let responded: Promise<Response> | null = null;
      await fire('fetch', {
        request: req,
        respondWith: (p: Promise<Response>) => {
          responded = p;
        },
        waitUntil: () => undefined,
      });
      // Sem respondWith = o SW deixou passar pro browser.
      if (!responded) return fakeFetch(req);
      return responded;
    },
    async runInstall() {
      const pending: Promise<unknown>[] = [];
      await fire('install', { waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    },
    async runActivate() {
      const pending: Promise<unknown>[] = [];
      await fire('activate', { waitUntil: (p: Promise<unknown>) => pending.push(p) });
      await Promise.all(pending);
    },
  };
}

function navRequest(path: string) {
  return new Request(`${ORIGIN}${path}`, { headers: { Accept: 'text/html' } });
}

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
}

// O harness identifica navegação por `destination`/`mode`, que o Request do
// Node não deixa setar. Envolvemos num proxy só pra esses dois campos.
function asNavigation(req: Request): Request {
  return new Proxy(req, {
    get(target, prop, receiver) {
      if (prop === 'mode') return 'navigate';
      if (prop === 'destination') return 'document';
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Request;
}

describe('service worker — navegação', () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it('guarda no cache uma navegação 200', async () => {
    h.queue.set(`${ORIGIN}/feed`, [html('<p>feed</p>')]);
    const res = await h.handleFetch(asNavigation(navRequest('/feed')));
    expect(res.status).toBe(200);
    const cached = await h.cacheStorage.match(`${ORIGIN}/feed`);
    expect(cached).toBeDefined();
  });

  it('NUNCA guarda no cache uma resposta 500 — e nunca a entrega crua', async () => {
    // Duas entradas na fila: o SW repete a navegação uma vez em 5xx. Sem
    // cópia boa no cache, o que chega na tela é a página amigável de
    // auto-retry (v5) — nunca mais a tela "500 | Server Error" morta.
    h.queue.set(`${ORIGIN}/feed`, [html('erro', 500), html('erro', 500)]);
    const res = await h.handleFetch(asNavigation(navRequest('/feed')));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('erro 500');
    expect(await h.cacheStorage.match(`${ORIGIN}/feed`)).toBeUndefined();
  });

  it('5xx persistente registra o incidente no /api/log-error', async () => {
    h.queue.set(`${ORIGIN}/feed`, [html('erro', 502), html('erro', 502)]);
    await h.handleFetch(asNavigation(navRequest('/feed')));
    // Fire-and-forget: a chamada acontece mesmo sem resposta na fila (o
    // harness responde network-error e o SW engole).
    expect(h.fetchCalls.some((u) => u.endsWith('/api/log-error'))).toBe(true);
  });

  // Este teste TROCOU DE LADO em 01/09/2026, e a inversão é o registro do
  // bug: antes ele exigia que o 5xx de RSC voltasse CRU, "porque o router
  // trata". O aparelho provou que não trata — o runtime do Next pinta a
  // própria tela "500 | Server Error", sem navegação de documento, então
  // nenhuma defesa do SW rodava e a tela ficava morta até reiniciar o app.
  it('payload RSC com 5xx vira 503 vazio — NUNCA volta cru pro router', async () => {
    const rscUrl = `${ORIGIN}/feed?_rsc=abc123`;
    h.queue.set(rscUrl, [new Response('flight', { status: 500 }), new Response('flight', { status: 500 })]);
    const res = await h.handleFetch(new Request(rscUrl));
    expect(res.status).toBe(503);
    // Corpo vazio: HTML aqui corromperia o router, que espera flight data.
    expect(await res.text()).toBe('');
  });

  it('payload RSC com 200 passa intacto (não estragar o caminho feliz)', async () => {
    const rscUrl = `${ORIGIN}/feed?_rsc=ok`;
    h.queue.set(rscUrl, [new Response('flight-data', { status: 200 })]);
    const res = await h.handleFetch(new Request(rscUrl));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('flight-data');
  });

  it('payload RSC com rede morta vira 503 vazio (router faz hard-nav)', async () => {
    const rscUrl = `${ORIGIN}/feed?_rsc=abc123`;
    h.queue.set(rscUrl, ['network-error', 'network-error']);
    const res = await h.handleFetch(new Request(rscUrl));
    expect(res.status).toBe(503);
  });

  it('repete a navegação uma vez quando o servidor devolve 500', async () => {
    h.queue.set(`${ORIGIN}/feed`, [html('erro', 500), html('<p>ok</p>')]);
    const res = await h.handleFetch(asNavigation(navRequest('/feed')));
    expect(res.status).toBe(200);
    expect(h.fetchCalls.filter((u) => u.endsWith('/feed'))).toHaveLength(2);
  });

  it('repete a navegação uma vez quando a rede falha (retomada do WebView)', async () => {
    h.queue.set(`${ORIGIN}/feed`, ['network-error', html('<p>ok</p>')]);
    const res = await h.handleFetch(asNavigation(navRequest('/feed')));
    expect(res.status).toBe(200);
  });

  it('não serve um erro guardado por uma versão antiga do SW', async () => {
    // Simula o cache envenenado da v2: um 500 gravado como documento.
    const poisoned = await h.cacheStorage.open('quc-v3-static');
    await poisoned.put(`${ORIGIN}/feed`, html('500 do cloudflare', 500));

    h.queue.set(`${ORIGIN}/feed`, ['network-error', 'network-error']);
    const res = await h.handleFetch(asNavigation(navRequest('/feed')));

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain('Reconectando');
  });

  it('serve a cópia boa do cache quando a rede cai', async () => {
    const cache = await h.cacheStorage.open('quc-v5-static');
    await cache.put(`${ORIGIN}/feed`, html('<p>feed offline</p>'));

    h.queue.set(`${ORIGIN}/feed`, ['network-error', 'network-error']);
    const res = await h.handleFetch(asNavigation(navRequest('/feed')));

    await expect(res.text()).resolves.toContain('feed offline');
  });

  it('activate apaga os caches de versões anteriores', async () => {
    await h.cacheStorage.open('quc-v5-static');
    await h.cacheStorage.open('quc-v6-static');
    await h.cacheStorage.open('quc-v8-static');
    await h.runActivate();
    // Só a versão corrente sobrevive — é o bump de CACHE_VERSION que limpa
    // cache envenenado de versões antigas. (Acompanha o CACHE_VERSION do
    // sw.js: hoje quc-v8.)
    expect(await h.cacheStorage.keys()).toEqual(['quc-v8-static']);
  });
});

describe('service worker — API e estáticos', () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it('não guarda no cache um /api que respondeu 500', async () => {
    h.queue.set(`${ORIGIN}/api/feed`, [new Response('{}', { status: 500 })]);
    const res = await h.handleFetch(new Request(`${ORIGIN}/api/feed`));
    expect(res.status).toBe(500);
    expect(await h.cacheStorage.match(`${ORIGIN}/api/feed`)).toBeUndefined();
  });

  it('devolve 503 legível quando o /api cai e não há cache', async () => {
    h.queue.set(`${ORIGIN}/api/feed`, ['network-error']);
    const res = await h.handleFetch(new Request(`${ORIGIN}/api/feed`));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: 'offline' });
  });

  it('mutations (POST) passam direto, sem tocar no cache', async () => {
    h.queue.set(`${ORIGIN}/api/post`, [new Response('{}', { status: 200 })]);
    await h.handleFetch(new Request(`${ORIGIN}/api/post`, { method: 'POST' }));
    expect(await h.cacheStorage.match(`${ORIGIN}/api/post`)).toBeUndefined();
  });

  it('install tolera asset que falha, em vez de abortar o SW inteiro', async () => {
    h.queue.set(`${ORIGIN}/`, [html('<p>home</p>')]);
    h.queue.set(`${ORIGIN}/icon-192.png`, ['network-error']);
    await expect(h.runInstall()).resolves.toBeUndefined();
    expect(await h.cacheStorage.match(`${ORIGIN}/`)).toBeDefined();
  });
});

describe('service worker — resposta autenticada nunca entra no cache', () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it('GET /api/* com Authorization não é guardado', async () => {
    const url = `${ORIGIN}/api/whatsapp/templates`;
    h.queue.set(url, [new Response('{"templates":[]}', { status: 200 })]);
    const res = await h.handleFetch(new Request(url, { headers: { Authorization: 'Bearer x' } }));
    expect(res.status).toBe(200);
    expect(await h.cacheStorage.match(url)).toBeUndefined();
  });

  it('GET do PostgREST do Supabase com Authorization não é guardado', async () => {
    const url = 'https://test.supabase.co/rest/v1/messages?select=*';
    h.queue.set(url, [new Response('[]', { status: 200 })]);
    const res = await h.handleFetch(new Request(url, { headers: { authorization: 'Bearer x', apikey: 'k' } }));
    expect(res.status).toBe(200);
    expect(await h.cacheStorage.match(url)).toBeUndefined();
  });

  it('resposta Cache-Control: no-store / private não é guardada', async () => {
    const url = `${ORIGIN}/api/health`;
    h.queue.set(url, [new Response('{}', { status: 200, headers: { 'Cache-Control': 'private, max-age=0' } })]);
    await h.handleFetch(new Request(url));
    expect(await h.cacheStorage.match(url)).toBeUndefined();
  });

  it('GET público sem credencial continua entrando no cache (sem regressão offline)', async () => {
    const url = `${ORIGIN}/api/cidades?uf=SP`;
    h.queue.set(url, [new Response('[]', { status: 200 })]);
    await h.handleFetch(new Request(url));
    expect(await h.cacheStorage.match(url)).toBeDefined();
  });
});

/* eslint-disable no-restricted-globals */
// Service Worker — QueroUmaCor PWA / WebView (Capacitor iOS + Android)
// Estratégia:
//   - Estáticos (HTML/JS/CSS/fontes/imgs): cache-first com fallback network
//   - GETs de API (/api/*): network-first com fallback cache (stale-while-revalidate)
//   - POST/PUT/PATCH/DELETE: SEMPRE rede (mutations não podem ser cacheadas)
//   - Assets externos (Supabase Storage avatares/fotos): cache-first, max 7d
//
// Versão: bump CACHE_VERSION quando quiser invalidar tudo (deploy quebra cache).
// Quota: ~50MB de cache em mobile típico; runtimeCache é limitado a 100 entries
// (LRU manual). Mantém apenas o essencial.
//
// ─── REGRA DE OURO (2026-08-22): SÓ RESPOSTA 200 ENTRA NO CACHE ────────────
// A v2 gravava a resposta de NAVEGAÇÃO no cache sem olhar o status. Um 500
// passageiro do Cloudflare (ou um 502 no meio de um deploy) virava conteúdo
// PERMANENTE do cache: na próxima abertura, se a rede falhasse por um
// instante — o que acontece toda vez que o WebView do Android volta do
// background antes do rádio reconectar — o SW servia o 500 de volta. Daí o
// "deu erro 500 e não abre mais": a internet do usuário estava boa, o erro
// vinha do disco. Agora:
//   1. `isCacheable()` barra tudo que não for 200 same-origin não-redirecionado;
//   2. `matchUsable()` nunca devolve uma resposta de erro guardada;
//   3. navegação com falha de rede/5xx tenta DE NOVO antes de desistir;
//   4. o último recurso é uma página de erro gerada na hora, com botão de
//      recarregar — nunca um 500 congelado.
// Bump de CACHE_VERSION (v2 → v3) é o que limpa os caches já envenenados de
// quem está preso hoje: o `activate` apaga toda chave que não é da versão.
//
// v3 → v4 (2026-08-22): purga pareamento HTML↔CSS velho. A navegação é
// network-first, mas quando a rede pisca no retorno do background o SW serve
// o HTML guardado — que aponta pros bundles de uma build ANTERIOR, servidos
// cache-first de `/_next/static/`. O aparelho fica com um app inteiro de uma
// versão passada e correção nova nenhuma chega. O bump zera essa combinação.
//
// v5 → v6 (2026-09-01): o 5xx de PAYLOAD RSC também deixa de voltar cru.
// A v5 cobriu a navegação de documento, mas o caso real do aparelho era
// outro: a falha vinha no fetch do RSC, o router do Next pintava a própria
// tela de erro ("500 | Server Error") sem nunca fazer uma navegação de
// documento, e por isso NADA daqui rodava. Agora o 5xx de RSC vira 503 sem
// corpo — o mesmo tratamento da rede morta, que é o caminho comprovado de
// forçar o hard-nav e cair nas defesas completas.
//
// v4 → v5 (2026-08-28): 5xx CRU NUNCA MAIS CHEGA NA TELA em navegação de
// documento. O v4 já tentava de novo e já preferia o cache, mas quando não
// havia cópia boa devolvia o 500 do servidor — e como o app navega por
// dentro (SPA), documento no cache é raro: era a tela "500 | Server Error"
// morta ao retomar o WebView do background (o usuário tinha que matar o
// app). Agora o último recurso pra 5xx é a MESMA página amigável do modo
// offline, que se recarrega sozinha (backoff + teto por sessão) — o soluço
// do edge passa e o app volta sem intervenção. RSC continua recebendo o
// status cru (o router do Next trata e faz hard-nav, que cai aqui de novo
// como documento).

const CACHE_VERSION = 'quc-v8';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const IMG_CACHE = `${CACHE_VERSION}-img`;

const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
];

const MAX_RUNTIME_ENTRIES = 100;
const MAX_IMG_ENTRIES = 200;

// Quanto esperar antes de repetir uma navegação que falhou. O WebView do
// Android costuma retomar do background com o rádio ainda desligado; meio
// segundo resolve a maioria dos casos sem o usuário perceber.
const NAV_RETRY_DELAY_MS = 600;

// Instala: pre-cache dos estáticos essenciais.
//
// `cache.addAll` era all-or-nothing: um único 404/500 em qualquer item
// rejeitava o install inteiro e o SW nunca ativava. Agora cada asset é
// buscado e guardado de forma independente e tolerante a falha.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        STATIC_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            await putSafe(STATIC_CACHE, url, res);
          } catch {
            // Asset indisponível no momento do install — segue sem ele.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

// Ativa: limpa caches antigos quando bump de CACHE_VERSION.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

// Limita tamanho do cache via LRU (delete os mais antigos quando passa do max).
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map((req) => cache.delete(req)));
}

// Só 200 "de verdade" pode ser guardado.
//  - `res.ok` sozinho não basta: 204/206 e respostas opacas quebram o `put`.
//  - `res.redirected` estoura TypeError dentro do `Cache.put`, e uma resposta
//    redirecionada servida do cache faz o browser recusar a navegação.
function isCacheable(res) {
  return (
    !!res &&
    res.status === 200 &&
    res.type !== 'opaque' &&
    res.type !== 'opaqueredirect' &&
    !res.redirected
  );
}

// Grava no cache sem nunca derrubar o request que a originou. Toda falha
// (quota estoura, resposta não clonável, cache indisponível) é engolida:
// cache é otimização, não pode custar a resposta pro usuário.
// Resposta AUTENTICADA nunca entra no cache (auditoria 2026-09-11).
//
// O cache do service worker é por ORIGEM, não por sessão: o que entra aqui
// fica no aparelho depois do logout e é servido offline pra quem logar em
// seguida no mesmo aparelho. Os GETs do PostgREST/GoTrue (`/rest/v1/*`,
// `/auth/v1/user`) e os `/api/*` de admin viajam com `Authorization: Bearer`
// — mensagens, perfil, leads, tudo caía no `RUNTIME_CACHE`. Regra: request
// com credencial no header, ou resposta marcada `no-store`/`private`, passa
// direto. `Cache.match` ignora headers, então a exclusão TEM que ser na
// escrita.
function isPrivate(req, res) {
  try {
    if (req && req.headers && req.headers.get('authorization')) return true;
    const cc = res && res.headers ? res.headers.get('cache-control') || '' : '';
    if (/\b(no-store|private)\b/i.test(cc)) return true;
  } catch {
    // headers inacessíveis: na dúvida, trata como privado.
    return true;
  }
  return false;
}

async function putSafe(cacheName, req, res, maxEntries) {
  if (!isCacheable(res)) return;
  if (isPrivate(req, res)) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(req, res.clone());
    if (maxEntries) await trimCache(cacheName, maxEntries);
  } catch {
    // Silencioso de propósito.
  }
}

// Procura no cache e devolve SÓ se for uma resposta aproveitável. Caches
// escritos por versões antigas do SW podem conter 500/404 congelados — sem
// esse filtro, o fallback offline reapresentaria o erro pra sempre.
async function matchUsable(req) {
  try {
    const cached = await caches.match(req);
    return cached && cached.ok ? cached : null;
  } catch {
    return null;
  }
}

// Última linha de defesa: página gerada na hora, com botão de recarregar E
// auto-retry (backoff crescente, teto de 6 tentativas por incidente via
// sessionStorage — janela de 2min zera o contador). Nunca vem do cache,
// então não tem como envelhecer nem envenenar nada. `status` presente =
// era um 5xx do servidor (mensagem diz isso); ausente = falha de rede.
function offlineFallbackResponse(status) {
  const detail = status
    ? `O servidor deu uma instabilidade (erro ${status}). Vou tentar de novo sozinho em instantes.`
    : 'Não consegui falar com o servidor agora. Assim que a conexão voltar, eu tento de novo sozinho.';
  const html = `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QueroUmaCor — reconectando</title></head>
<body style="margin:0;display:flex;min-height:100dvh;align-items:center;justify-content:center;background:#fdfbf7;color:#1a1a2e;font:400 15px/1.6 system-ui,-apple-system,sans-serif;text-align:center;padding:24px">
<div><div style="font-size:44px;margin-bottom:12px">📶</div>
<h1 style="font-size:19px;margin:0 0 8px">Reconectando…</h1>
<p style="margin:0 0 20px;color:#6b6b7b;max-width:280px">${detail}</p>
<button onclick="location.reload()" style="border:0;border-radius:10px;background:#ff6b35;color:#fff;font:700 15px system-ui;padding:12px 26px">Tentar agora</button>
</div>
<script>(function(){try{
var K='qucAutoRetry';var now=Date.now();var st=null;
try{st=JSON.parse(sessionStorage.getItem(K)||'null')}catch(e){}
if(!st||now-st.t>120000)st={n:0,t:now};
if(st.n<6){st.n++;try{sessionStorage.setItem(K,JSON.stringify(st))}catch(e){}
setTimeout(function(){location.reload()},2500+st.n*1500);}
window.addEventListener('online',function(){location.reload()});
}catch(e){}})();</script>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Telemetria best-effort de incidente: registra no /api/log-error (aparece
// no /admin/errors) quando uma navegação terminou em 5xx mesmo após a
// retentativa. Fire-and-forget: se o edge está mal, este POST também pode
// falhar — nunca custa a resposta pro usuário.
function logNavIncident(status, url) {
  try {
    fetch('/api/log-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'sw-nav-5xx',
        msg: `navegação ${status} após retry: ${url}`,
        ua: (typeof navigator !== 'undefined' && navigator.userAgent) || '',
        ctx: 'sw',
      }),
    }).catch(() => {});
  } catch {
    // ignora
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Busca uma navegação com UMA segunda tentativa. Repete tanto em falha de
// rede quanto em 5xx — os dois são exatamente o que o app via ao voltar do
// background (rádio ainda subindo) ou ao pegar um cold start ruim do edge.
// GET idempotente, então repetir é seguro.
async function fetchNavigation(req) {
  try {
    const res = await fetch(req);
    if (res.status < 500) return res;
    await wait(NAV_RETRY_DELAY_MS);
    try {
      return await fetch(req);
    } catch {
      return res; // 2ª tentativa morreu: devolve o 5xx original.
    }
  } catch (err) {
    await wait(NAV_RETRY_DELAY_MS);
    return fetch(req); // Se falhar de novo, o caller trata.
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Só GET — mutations sempre vão direto pra rede.
  if (req.method !== 'GET') return;

  // Skip de cross-origin que não são do Supabase (extensões, analytics, etc).
  const isSameOrigin = url.origin === self.location.origin;
  const isSupabase = url.hostname.endsWith('.supabase.co');
  if (!isSameOrigin && !isSupabase) return;

  // API GETs: network-first, fallback cache (stale data quando offline).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          await putSafe(RUNTIME_CACHE, req, res, MAX_RUNTIME_ENTRIES);
          return res;
        } catch {
          const cached = await matchUsable(req);
          if (cached) return cached;
          // 503 legível em vez de `Response.error()`: o chamador consegue
          // distinguir "offline" de "bug" e mostrar a mensagem certa.
          return new Response(
            JSON.stringify({ error: 'offline', message: 'Sem conexão com o servidor.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
      })(),
    );
    return;
  }

  // Imagens (Supabase Storage + estáticas): cache-first.
  const isImage =
    req.destination === 'image' ||
    /\.(png|jpg|jpeg|webp|gif|svg|avif)(\?|$)/i.test(url.pathname);
  if (isImage) {
    event.respondWith(
      (async () => {
        const cached = await matchUsable(req);
        if (cached) return cached;
        const res = await fetch(req);
        await putSafe(IMG_CACHE, req, res, MAX_IMG_ENTRIES);
        return res;
      })(),
    );
    return;
  }

  // Navegação (HTML) + payloads RSC do Next App Router: network-first.
  //
  // CRÍTICO: a navegação client-side do App Router busca o RSC da rota
  // (`/loja?_rsc=…`). Se isso vier do cache-first, o router recebe um payload
  // de uma BUILD ANTERIOR e não casa com os chunks atuais → a transição entre
  // abas TRAVA (bug do modo visitante). Por isso esses requests NUNCA são
  // cache-first: vão na rede e só caem no cache como fallback offline.
  const isRsc =
    url.searchParams.has('_rsc') ||
    req.headers.get('RSC') === '1' ||
    req.headers.get('Next-Router-Prefetch') === '1';

  // Payloads RSC. HTML de fallback aqui corromperia o router (ele espera
  // flight data), então a resposta é sempre "vazia" — o que muda é o STATUS.
  //
  // v6 (2026-09-01) — O 5xx DEIXOU DE VOLTAR CRU. A versão anterior devolvia
  // o 500 do servidor apostando que "o router trata" fazendo hard-nav. O
  // aparelho provou que não: o runtime do Next pinta a PRÓPRIA tela de erro
  // ("500 | Server Error" — a marcação `next-error-h1` está no bundle do
  // cliente, `main-*.js`), e como não houve navegação de documento, nenhuma
  // das defesas daqui de baixo chega a rodar. Também não é erro de render,
  // então `error.tsx`/`global-error.tsx` não pegam. Resultado: uma lápide
  // que só saía reiniciando o app, com o service worker no comando o tempo
  // todo — o /diag do usuário confirmou "Service Worker controlando: sim".
  //
  // Agora o 5xx recebe o MESMO tratamento da rede morta: 503 sem corpo, que
  // é o caminho comprovado — o router descarta e faz hard-nav, a navegação
  // volta pra cá como documento e aí sim ganha a página "Reconectando…" com
  // auto-retry.
  if (isRsc) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetchNavigation(req);
          if (res.status >= 500) {
            logNavIncident(res.status, url.pathname + ' (rsc)');
            return new Response('', { status: 503 });
          }
          return res;
        } catch {
          return new Response('', { status: 503 });
        }
      })(),
    );
    return;
  }

  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetchNavigation(req);
          // `putSafe` já barra 4xx/5xx: erro nunca vira conteúdo persistido.
          await putSafe(STATIC_CACHE, req, res);
          // 5xx que sobreviveu à retentativa NUNCA vai cru pra tela (era a
          // tela "500 | Server Error" morta ao retomar o WebView): primeiro
          // uma cópia BOA do cache; senão a página amigável com auto-retry.
          if (res.status >= 500) {
            logNavIncident(res.status, url.pathname);
            const cached = (await matchUsable(req)) || (await matchUsable('/'));
            return cached || offlineFallbackResponse(res.status);
          }
          return res;
        } catch {
          const cached = (await matchUsable(req)) || (await matchUsable('/'));
          return cached || offlineFallbackResponse();
        }
      })(),
    );
    return;
  }

  // Assets imutáveis do Next (`/_next/static/...` — nome com content-hash):
  // cache-first é seguro porque uma mudança gera um nome de arquivo novo.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await matchUsable(req);
        if (cached) return cached;
        const res = await fetch(req);
        await putSafe(RUNTIME_CACHE, req, res, MAX_RUNTIME_ENTRIES);
        return res;
      })(),
    );
    return;
  }

  // Demais GETs same-origin (JS/CSS não-hasheado, manifest, etc.):
  // network-first com fallback cache. Evita servir bundle velho após deploy.
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        await putSafe(RUNTIME_CACHE, req, res, MAX_RUNTIME_ENTRIES);
        return res;
      } catch (err) {
        const cached = await matchUsable(req);
        if (cached) return cached;
        // Propaga a falha real de rede em vez de inventar um `Response.error()`
        // — o loader de chunk do Next precisa ver o erro pra tentar de novo.
        throw err;
      }
    })(),
  );
});

// Mensagens do app pra forçar update do SW (botão "Atualizar" no UI) e pra
// self-heal: `CLEAR_CACHES` apaga tudo e responde, pra tela de erro do app
// conseguir se desentupir sozinha sem o usuário reinstalar nada.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'CLEAR_CACHES') {
    event.waitUntil(
      (async () => {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {
          // ignora
        }
        try {
          event.source?.postMessage({ type: 'caches-cleared' });
        } catch {
          // ignora
        }
      })(),
    );
  }
});

// ─── Push Notifications (Release C8) ────────────────────────────────────────
// Browser/FCM/Mozilla autopush entrega encrypted payloads aqui via 'push'.
// O servidor (/api/push-notify) envia JSON cifrado AES128-GCM com schema:
//   { title: string, body?: string, url?: string, icon?: string, tag?: string }
// Se payload vier vazio (heartbeat/ping), mostra notificação genérica.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) {
      // event.data.json() já decripta + parseia se for JSON.
      data = event.data.json();
    }
  } catch (e) {
    // Payload pode não ser JSON (raro mas possível); cai num texto puro.
    try {
      data = { title: 'QueroUmaCor', body: event.data ? event.data.text() : '' };
    } catch {
      data = {};
    }
  }

  const title = (data && data.title) || 'QueroUmaCor';
  const options = {
    body: (data && data.body) || '',
    icon: (data && data.icon) || '/icon-192.png',
    badge: '/icon-192.png',
    tag: (data && data.tag) || undefined,
    data: {
      url: (data && data.url) || '/notificacoes',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click na notificação: foca janela existente em data.url se possível,
// senão abre nova. Fallback `/notificacoes` quando não tem url.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/notificacoes';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Procura uma aba do mesmo origin pra reaproveitar (UX: não duplica
      // aba). Compara origin pra ignorar hash/query.
      let target = null;
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url);
          const wantUrl = new URL(targetUrl, self.location.origin);
          if (clientUrl.origin === wantUrl.origin) {
            target = client;
            break;
          }
        } catch {
          // URL inválido — ignora.
        }
      }
      if (target) {
        try {
          await target.focus();
          if ('navigate' in target) {
            await target.navigate(targetUrl);
          }
          return;
        } catch {
          // Continua pro openWindow fallback.
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});

// Browser/FCM pode revogar subscription (user bloqueou, key rotacionada);
// avisa todas abas pra refazer flow de subscribe quando voltar (precisa
// do userId logado pro re-subscribe, então não dá pra fazer direto aqui).
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        try {
          client.postMessage({ type: 'pushsubscriptionchange' });
        } catch {
          // ignora
        }
      }
    })(),
  );
});

/* eslint-disable no-restricted-globals */
// Service Worker — QueroUmaCor PWA
// Estratégia:
//   - Estáticos (HTML/JS/CSS/fontes/imgs): cache-first com fallback network
//   - GETs de API (/api/*): network-first com fallback cache (stale-while-revalidate)
//   - POST/PUT/PATCH/DELETE: SEMPRE rede (mutations não podem ser cacheadas)
//   - Assets externos (Supabase Storage avatares/fotos): cache-first, max 7d
//
// Versão: bump CACHE_VERSION quando quiser invalidar tudo (deploy quebra cache).
// Quota: ~50MB de cache em mobile típico; runtimeCache é limitado a 100 entries
// (LRU manual). Mantém apenas o essencial.

const CACHE_VERSION = 'quc-v2';
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

// Instala: pre-cache dos estáticos essenciais.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
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
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches
              .open(RUNTIME_CACHE)
              .then((c) => c.put(req, clone))
              .then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || Response.error()),
        ),
    );
    return;
  }

  // Imagens (Supabase Storage + estáticas): cache-first.
  const isImage =
    req.destination === 'image' ||
    /\.(png|jpg|jpeg|webp|gif|svg|avif)(\?|$)/i.test(url.pathname);
  if (isImage) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok && res.type !== 'opaque') {
            const clone = res.clone();
            caches
              .open(IMG_CACHE)
              .then((c) => c.put(req, clone))
              .then(() => trimCache(IMG_CACHE, MAX_IMG_ENTRIES));
          }
          return res;
        });
      }),
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
  if (req.mode === 'navigate' || req.destination === 'document' || isRsc) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Só cacheia navegação real (document), não os payloads RSC — RSC é
          // versionado por build e poluiria o cache com entries órfãos.
          if (!isRsc) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  // Assets imutáveis do Next (`/_next/static/...` — nome com content-hash):
  // cache-first é seguro porque uma mudança gera um nome de arquivo novo.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches
              .open(RUNTIME_CACHE)
              .then((c) => c.put(req, clone))
              .then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
          }
          return res;
        });
      }),
    );
    return;
  }

  // Demais GETs same-origin (JS/CSS não-hasheado, manifest, etc.):
  // network-first com fallback cache. Evita servir bundle velho após deploy.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches
            .open(RUNTIME_CACHE)
            .then((c) => c.put(req, clone))
            .then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || Response.error())),
  );
});

// Mensagens do app pra forçar update do SW (botão "Atualizar" no UI).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
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

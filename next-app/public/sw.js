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

const CACHE_VERSION = 'quc-v1';
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

  // Navegação (HTML): network-first com fallback pro shell ('/'). Garante que
  // mudanças no app são vistas rapidamente, mas funciona offline.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  // JS/CSS/fontes: cache-first (build hash garante invalidação).
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
});

// Mensagens do app pra forçar update do SW (botão "Atualizar" no UI).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// QueroUmaCor Service Worker
const CACHE = 'queroumacor-v8';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // HTML / navegação: SEMPRE rede (nunca servir página velha do cache)
  if (req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('.html'))) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Demais GETs: rede primeiro; só cacheia resposta same-origin e OK
  e.respondWith(
    fetch(req).then(r => {
      if (sameOrigin && r && r.ok && r.type === 'basic') {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return r;
    }).catch(() => caches.match(req))
  );
});

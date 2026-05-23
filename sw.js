// QueroUmaCor Service Worker
const CACHE = 'queroumacor-v10';

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

  // HTML / navegação: força revalidação no servidor (bypassa cache HTTP
  // do navegador) pra não servir HTML velho. cache: 'reload'.
  if (req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('.html'))) {
    e.respondWith(fetch(req, { cache: 'reload' }).catch(() => caches.match(req)));
    return;
  }

  // Demais GETs same-origin: também revalida no servidor. Cross-origin
  // (IBGE etc) usa o cache padrão.
  if (sameOrigin) {
    e.respondWith(
      fetch(req, { cache: 'reload' }).then(r => {
        if (r && r.ok && r.type === 'basic') {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cross-origin: rede primeiro, sem reload forçado.
  e.respondWith(
    fetch(req).then(r => r).catch(() => caches.match(req))
  );
});

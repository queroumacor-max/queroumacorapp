// QueroUmaCor Service Worker
const CACHE = 'queroumacor-v12';

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

// cache-first com revalidação leve em background. Como nossos assets
// versionados usam ?v=AAAAMMDD<letra>, uma versão nova = URL nova =
// chave de cache nova, então cache-first é seguro.
function cacheFirst(req) {
  return caches.match(req).then(cached => {
    if (cached) return cached;
    return fetch(req).then(r => {
      if (r && r.ok && r.type === 'basic') {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return r;
    });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // NUNCA cachear /api/*. Respostas de admin/PRO/checkout/IA não podem
  // sair de cache antigo (risco de servir decisão stale ou falsificada
  // por atacante controlando a rede do device — Wi-Fi público, MITM).
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req));
    return;
  }

  // HTML / navegação: força revalidação no servidor (bypassa cache HTTP
  // do navegador) pra não servir HTML velho. cache: 'reload'.
  if (req.mode === 'navigate' || (sameOrigin && url.pathname.endsWith('.html'))) {
    e.respondWith(fetch(req, { cache: 'reload' }).catch(() => caches.match(req)));
    return;
  }

  // Assets versionados (?v=...) e estáticos same-origin: cache-first.
  // .js/.css carregam com ?v=AAAAMMDD<letra>, então novo deploy invalida
  // a chave de cache automaticamente. Imagens são imutáveis por path.
  if (sameOrigin) {
    const p = url.pathname;
    if (
      p.endsWith('.js') || p.endsWith('.css') ||
      p.endsWith('.webp') || p.endsWith('.png') ||
      p.endsWith('.jpg') || p.endsWith('.jpeg') ||
      p.endsWith('.svg') || p.endsWith('.gif') ||
      p.endsWith('.woff') || p.endsWith('.woff2') ||
      p.endsWith('.ico')
    ) {
      e.respondWith(cacheFirst(req));
      return;
    }
    // Demais same-origin (sem extensão conhecida): network-first com
    // fallback pra cache.
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

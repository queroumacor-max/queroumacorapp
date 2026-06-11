// QueroUmaCor — KILLSWITCH Service Worker (2026-06-10)
// ─────────────────────────────────────────────────────────────────────
// Substituição do SW vanilla legacy. Este SW:
//   1. Não cacheia nada.
//   2. Deleta TODOS os caches existentes.
//   3. Se desregistra.
//   4. Força reload em todas as abas abertas.
//
// Objetivo: limpar SWs antigos travados no navegador dos usuários,
// pra que o Next.js take over sem interferência de cache vanilla.
// Quando o Next SW oficial for registrado, este aqui já terá saído de cena.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {
      // ignore
    }
    try {
      await self.registration.unregister();
    } catch (e) {
      // ignore
    }
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => {
        try { c.navigate(c.url); } catch (e) { /* ignore */ }
      });
    } catch (e) {
      // ignore
    }
  })());
});

self.addEventListener('fetch', () => {
  // No-op: deixa o browser passar direto pra rede.
});

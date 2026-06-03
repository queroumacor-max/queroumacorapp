'use client';
// Registra o Service Worker no client. Mount-once no RootLayout (não dentro
// do AppShell, porque queremos cobrir login/signup também — assim o SW pega
// cache desde o primeiro request).
//
// Pula em:
//  - Server (sem window)
//  - Dev (Next.js Hot Reload + SW briga; só registra em production)
//  - Browsers sem SW support (raro hoje)

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (process.env.NODE_ENV !== 'production') return undefined;
    if (!('serviceWorker' in navigator)) return undefined;

    // Registra em window.load pra não competir com hidratação inicial.
    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          // Atualização disponível: o novo SW fica em "waiting".
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (!newSW) return;
            newSW.addEventListener('statechange', () => {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                // Há um SW novo aguardando — força ativação imediata.
                // Pra UX mais conservadora, poderíamos mostrar toast "Atualizar"
                // e deixar o user decidir. Por ora, ativa silencioso.
                newSW.postMessage('SKIP_WAITING');
              }
            });
          });
        })
        .catch(() => {
          // SW falhou — segue sem cache, app funciona normal.
        });
    };

    if (document.readyState === 'complete') {
      onLoad();
      return undefined;
    }
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}

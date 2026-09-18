// useWebXrSupport — detecta se o device suporta WebXR AR (immersive-ar).
// Android Chrome com ARCore → true. iOS Safari / desktop → false (cai no
// overlay 2D). Resolve uma vez e cacheia o resultado.

'use client';

import { useEffect, useState } from 'react';

export type WebXrSupport = 'checking' | 'supported' | 'unsupported';

export function useWebXrSupport(): WebXrSupport {
  const [support, setSupport] = useState<WebXrSupport>('checking');

  useEffect(() => {
    let cancelled = false;
    // Sincroniza com sistema externo (navigator.xr) — não é derivável no
    // render/SSR.
    const xr = (navigator as unknown as { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr;
    if (!xr?.isSessionSupported) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
      setSupport('unsupported');
      return;
    }
    xr
      .isSessionSupported('immersive-ar')
      .then((ok) => {
        if (!cancelled) setSupport(ok ? 'supported' : 'unsupported');
      })
      .catch(() => {
        if (!cancelled) setSupport('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}

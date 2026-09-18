// OfflineBanner — faixa fina "sem conexão" quando a rede cai, em vez de deixar
// a WebView só falhar em silêncio. Usa native.network (plugin Network na casca,
// eventos online/offline no navegador). Montado no AppShell; renderiza nada
// quando online.

'use client';

import { useEffect, useState } from 'react';
import { native } from '@/lib/native';

export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // Estado inicial só depois de montar (evita divergência de hidratação:
    // no server não há navigator.onLine). Sincroniza com sistema externo
    // (navigator/plugin Network) — não é derivável no render/SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setOnline(native.network.isOnline());
    const off = native.network.onChange((connected) => setOnline(connected));
    return off;
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="w-full text-center text-white text-xs font-semibold py-1.5"
      style={{ background: '#b91c1c' }}
    >
      Sem conexão — algumas coisas podem não carregar
    </div>
  );
}

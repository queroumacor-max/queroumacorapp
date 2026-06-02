// StagingBanner — badge fixo no topo da tela quando o host NÃO é
// queroumacor.com.br. Espelha o script inline em index.html linha 136+
// do vanilla. Em produção (queroumacor.com.br) o componente retorna null.
'use client';

import { useEffect, useState } from 'react';

export function StagingBanner() {
  const [host, setHost] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = window.location.hostname;
    // Produção: queroumacor.com.br ou www.queroumacor.com.br → sem badge.
    if (/(?:^|\.)queroumacor\.com\.br$/i.test(h)) return;
    setHost(h);
  }, []);

  if (!host) return null;

  return (
    <div
      role="note"
      aria-label="Ambiente de staging"
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: '#f59e0b',
        color: '#1a1a2e',
        font: '800 11px/1.5 monospace',
        letterSpacing: '.5px',
        padding: '2px 12px',
        borderRadius: '0 0 8px 8px',
        pointerEvents: 'none',
      }}
    >
      🧪 STAGING · {host}
    </div>
  );
}

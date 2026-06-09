// useTheme — hook simples pra ler/escrever tema 'light'|'dark'.
// Source of truth: atributo `data-theme` no <html>, sincronizado com
// localStorage. Inline script em layout.tsx seta antes do hydrate; este
// hook só muda o estado depois do mount.

'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Sincroniza mudanças do sistema (prefers-color-scheme) quando user
  // NÃO salvou preferência explícita. Se já salvou no localStorage,
  // ignora — preferência do user manda.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem('theme');
      if (saved) return; // user override domina
      const next: Theme = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      setThemeState(next);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    try {
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
    } catch {
      // localStorage pode falhar em mode privado de algum browser; tema só
      // não persiste, mas continua aplicado nesta sessão.
    }
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggle };
}

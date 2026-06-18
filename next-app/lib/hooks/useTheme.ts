// useTheme — modo claro/escuro opt-in. Claro é o padrão; o usuário liga o
// escuro manualmente (não seguimos prefers-color-scheme pra manter o claro
// como default de produto). A preferência persiste em localStorage.theme e é
// aplicada antes do paint pelo script inline no <head> (app/layout.tsx) — o
// hook só sincroniza o estado do React com o atributo data-theme já setado.
'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light';
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage indisponível (modo privado) — tema só não persiste */
  }
}

export function useTheme() {
  // Inicia em 'light' no SSR; o efeito abaixo corrige pro valor real no client
  // (o script do <head> já setou data-theme antes do hydrate).
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    setThemeState(readTheme());
    // Mantém sincronizado entre abas.
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) {
        const next: Theme = e.newValue === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        setThemeState(next);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(readTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return { theme, setTheme, toggle, isDark: theme === 'dark' };
}

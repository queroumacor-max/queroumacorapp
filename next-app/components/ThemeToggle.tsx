// ThemeToggle — botão de alternar tema light/dark. Renderiza ícone
// sol/lua conforme tema atual. Caller decide onde inserir (PerfilView,
// PerfilSettings, etc.).

'use client';

import { useTheme } from '@/lib/hooks/useTheme';

interface ThemeToggleProps {
  className?: string;
  /** Quando true, renderiza linha completa (ícone + label). Default: só ícone. */
  withLabel?: boolean;
}

export function ThemeToggle({ className = '', withLabel = false }: ThemeToggleProps) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  if (withLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        className={`flex items-center justify-between w-full px-4 py-3 rounded-xl bg-white border border-[color:var(--color-border)] ${className}`}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[color:var(--color-ink)]">
          {isDark ? <MoonIcon /> : <SunIcon />}
          {isDark ? 'Tema escuro' : 'Tema claro'}
        </span>
        <span
          className={`w-10 h-6 rounded-full relative transition-colors ${isDark ? 'bg-[color:var(--color-p1)]' : 'bg-[color:var(--color-border)]'}`}
          aria-hidden="true"
        >
          <span
            className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
            style={{ left: isDark ? 'calc(100% - 22px)' : '2px' }}
          />
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      className={`p-2 rounded-full hover:bg-[color:var(--color-border)] transition-colors ${className}`}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

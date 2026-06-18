// ThemeToggle — alterna entre claro e escuro. Renderiza um "row" no mesmo
// estilo dos outros itens do ProfileFooter (card branco/superfície + label +
// switch). O tema é opt-in: o default segue claro até o usuário ligar aqui.
'use client';

import { useTheme } from '@/lib/hooks/useTheme';

export function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={isDark}
      aria-label="Alternar modo escuro"
      className="flex items-center justify-between w-full px-4 py-3 rounded-xl bg-white border border-[color:var(--color-border)] text-sm font-semibold text-[color:var(--color-ink)]"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" style={{ fontSize: 16 }}>
          {isDark ? '🌙' : '☀️'}
        </span>
        Modo escuro
      </span>
      {/* Switch puramente visual — o estado real é o aria-checked do button. */}
      <span
        aria-hidden="true"
        style={{
          width: 42,
          height: 24,
          borderRadius: 999,
          background: isDark ? 'var(--color-p1)' : 'var(--color-border)',
          position: 'relative',
          transition: 'background .15s',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: isDark ? 20 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .15s',
            boxShadow: '0 1px 3px rgba(0,0,0,.3)',
          }}
        />
      </span>
    </button>
  );
}

// BottomNav — navbar inferior fixa escura espelhando o vanilla (index.html
// linha ~2630 + styles.css `.bot-nav`). 5 botões: Feed, Search, Loja,
// Notif, Perfil. Ícone ativo em laranja (var(--color-p1)) com dot abaixo.
//
// Detecta a rota atual via usePathname pra marcar ativo. Replica exato o
// comportamento do `showScreen()` vanilla que ativava bn-* via bnMap.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: ReactNode;
  /** Função pra mostrar dot vermelho (notificações pendentes, etc.). */
  showDot?: boolean;
}

const ITEMS: NavItem[] = [
  {
    href: '/feed',
    label: 'Feed',
    match: (p) => p === '/feed' || p === '/',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: '/search',
    label: 'Buscar',
    match: (p) => p.startsWith('/search') || p.startsWith('/explore'),
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    href: '/loja',
    label: 'Loja',
    match: (p) => p.startsWith('/loja'),
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
  {
    href: '/notificacoes',
    label: 'Notificações',
    match: (p) => p.startsWith('/notificacoes'),
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    href: '/perfil',
    label: 'Perfil',
    match: (p) => p.startsWith('/perfil') || p.startsWith('/pedidos') || p.startsWith('/orcamentos') || p.startsWith('/agenda') || p.startsWith('/crm') || p.startsWith('/financeiro'),
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed bottom-0 left-0 right-0 mx-auto w-full max-w-[430px] z-[300] bg-[color:var(--color-ink)] flex items-center justify-around px-2"
      style={{
        height: 'calc(60px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -4px 20px rgba(0,0,0,.2)',
      }}
    >
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className="relative flex flex-col items-center justify-center w-12 h-12 rounded-xl gap-1 transition-colors"
            style={{
              background: active ? 'rgba(255,107,53,.15)' : 'transparent',
              color: active ? 'var(--color-p1)' : 'rgba(255,255,255,.33)',
            }}
          >
            {item.icon}
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: active ? 'var(--color-p1)' : 'transparent',
              }}
              aria-hidden="true"
            />
            {item.showDot && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full"
                style={{ background: 'var(--color-p4)' }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// BottomNav — navbar inferior fixa escura. 5 botões com NOME embaixo do
// ícone (pedido do usuário, 04/11/2026): Início, Procurar, Loja, Mensagens,
// Empresa. A aba ativa fica laranja (ícone + nome) com fundo laranja claro.
// Mensagens desceu pra cá e o sino de avisos subiu pro TopNav (troca pedida
// na mesma data) — o badge daqui é o de mensagens não lidas.
//
// Detecta a rota atual via usePathname pra marcar ativo. Replica exato o
// comportamento do `showScreen()` vanilla que ativava bn-* via bnMap.
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useUnreadMessageCount } from '@/lib/hooks/useUnreadMessageCount';
import { useAuthGate } from '@/components/AuthGate';
import { hapticSelection } from '@/lib/native';

interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  icon: ReactNode;
  /** Função pra mostrar dot vermelho (notificações pendentes, etc.). */
  showDot?: boolean;
  /** Visitante: ao tocar, abre o cadastro em vez de navegar (área logada). */
  requiresAuth?: boolean;
  /** Rótulo curto pro prompt de cadastro (ex.: "ver seu perfil"). */
  gateAction?: string;
  /** Marcador lido pelo <AppTour> pra saber qual botão destacar. */
  tourId: string;
}

const ITEMS: NavItem[] = [
  {
    href: '/feed',
    tourId: 'nav-feed',
    label: 'Início',
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
    tourId: 'nav-search',
    label: 'Procurar',
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
    tourId: 'nav-loja',
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
    href: '/chat',
    tourId: 'nav-chat',
    label: 'Mensagens',
    requiresAuth: true,
    gateAction: 'ver suas mensagens',
    match: (p) => p.startsWith('/chat'),
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: '/perfil',
    tourId: 'nav-perfil',
    label: 'Empresa',
    requiresAuth: true,
    gateAction: 'acessar seu perfil',
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
  const unreadChat = useUnreadMessageCount();
  const { requireAuth } = useAuthGate();

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed bottom-0 left-0 right-0 mx-auto w-full max-w-[430px] z-[300] bg-[color:var(--color-ink-fixed)] flex items-center justify-around gap-1 px-2"
      style={{
        height: 'calc(60px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow: '0 -4px 20px rgba(0,0,0,.2)',
      }}
    >
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        const isChat = item.href === '/chat';
        const showBadge = isChat && unreadChat > 0;
        const badgeLabel = unreadChat > 99 ? '99+' : String(unreadChat);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-tour={item.tourId}
            onClick={(e) => {
              // Visitante tocando numa aba de área logada → abre cadastro.
              if (item.requiresAuth && !requireAuth(item.gateAction)) {
                e.preventDefault();
                return;
              }
              // Toque tátil leve ao trocar de aba (no-op fora da casca).
              if (!active) hapticSelection();
            }}
            aria-label={
              showBadge ? `${item.label} (${unreadChat} não lidas)` : item.label
            }
            aria-current={active ? 'page' : undefined}
            className="relative flex flex-col items-center justify-center flex-1 max-w-16 min-w-0 h-[52px] rounded-xl gap-[3px] transition-colors"
            style={{
              background: active ? 'rgba(255,107,53,.15)' : 'transparent',
              color: active ? 'var(--color-p1)' : 'rgba(255,255,255,.5)',
            }}
          >
            {item.icon}
            <span
              aria-hidden="true"
              className="text-[10px] leading-none font-semibold whitespace-nowrap"
            >
              {item.label}
            </span>
            {item.showDot && (
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-2 w-2.5 h-2.5 rounded-full"
                style={{ background: 'var(--color-p4)' }}
              />
            )}
            {showBadge && (
              <span
                className="absolute top-0 right-2 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-[color:var(--color-white-fixed)]"
                style={{ background: 'var(--color-p4)', lineHeight: 1 }}
              >
                {badgeLabel}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

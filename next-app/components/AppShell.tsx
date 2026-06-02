// AppShell — wrapper das telas autenticadas. Replica a estrutura
// `<header.top-nav> + <main.scroll> + <nav.bot-nav>` do vanilla
// (index.html), com fundo cream, max-width 430px, e padding-bottom
// pra não cobrir conteúdo com a bot-nav fixa.
//
// Uso: envolver children de páginas em `<AppShell>...</AppShell>`.
// Páginas de auth (/login, /signup, /) NÃO usam AppShell.
'use client';

import { TopNav } from './TopNav';
import { BottomNav } from './BottomNav';
import { RealtimeBindings } from './RealtimeBindings';
import type { ReactNode } from 'react';

interface AppShellProps {
  children: ReactNode;
  /** Esconde TopNav (ex.: tela de conversa que tem header próprio). */
  hideTopNav?: boolean;
  /** Esconde BottomNav (ex.: tela de chat conversation). */
  hideBottomNav?: boolean;
  /** Status do plano pra TopNav. */
  proStatus?: 'GRÁTIS' | 'PRO' | 'ADMIN';
}

export function AppShell({
  children,
  hideTopNav = false,
  hideBottomNav = false,
  proStatus = 'GRÁTIS',
}: AppShellProps) {
  return (
    <div className="flex flex-col w-full max-w-[430px] mx-auto h-screen bg-[color:var(--color-bg)] relative overflow-hidden" style={{ minHeight: '100dvh' }}>
      <RealtimeBindings />
      {!hideTopNav && <TopNav proStatus={proStatus} />}
      <main
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          paddingBottom: hideBottomNav
            ? 'env(safe-area-inset-bottom)'
            : 'calc(68px + env(safe-area-inset-bottom))',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {children}
      </main>
      {!hideBottomNav && <BottomNav />}
    </div>
  );
}

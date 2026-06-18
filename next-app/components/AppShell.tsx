// AppShell — wrapper das telas autenticadas. Replica a estrutura
// `<header.top-nav> + <main.scroll> + <nav.bot-nav>` do vanilla
// (index.html), com fundo cream, max-width 430px, e padding-bottom
// pra não cobrir conteúdo com a bot-nav fixa.
//
// Uso: envolver children de páginas em `<AppShell>...</AppShell>`.
// Páginas de auth (/login, /signup, /) NÃO usam AppShell.
'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
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
  /** Override do badge PRO/GRÁTIS/ADMIN. Quando omitido, TopNav deriva
   *  do profile via useProfile() (default — comportamento desejado em
   *  99% dos casos). Antes tinha default 'GRÁTIS' que sobrescrevia a
   *  derivação e o badge ficava travado em GRÁTIS pra todo mundo. */
  proStatus?: 'GRÁTIS' | 'PRO' | 'ADMIN';
  /** Quando false, NÃO exige login (renderiza o chrome pra todo mundo). Usado
   *  nas páginas públicas que ainda querem TopNav+BottomNav (ex.: /info/*
   *  legais, acessíveis deslogado p/ revisão das lojas). Default true. */
  requireAuth?: boolean;
}

export function AppShell({
  children,
  hideTopNav = false,
  hideBottomNav = false,
  proStatus,
  requireAuth = true,
}: AppShellProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Acesso sem conta REMOVIDO: telas privadas (requireAuth=true) exigem login —
  // visitante deslogado é mandado pro /login (com ?next pra voltar após logar).
  // Páginas públicas (/login, /signup, /, /completar-perfil) não usam AppShell;
  // as /info/* usam AppShell com requireAuth=false (chrome sem gate).
  useEffect(() => {
    if (!requireAuth) return;
    if (loading || user) return;
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [requireAuth, loading, user, pathname, router]);

  // Enquanto resolve auth ou enquanto o redirect dispara, não renderiza o
  // conteúdo privado (evita flash de tela protegida pra deslogado).
  if (requireAuth && (loading || !user)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-[color:var(--color-muted)] text-sm">Carregando…</div>
      </div>
    );
  }

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

// TopNav — navbar superior escura espelhando o vanilla (index.html linha
// ~227 + styles.css `.top-nav`). Fundo ink, logo Quero[Uma]Cor com
// "Uma" laranja, badge PRO/GRÁTIS à direita + ícone chat com badge dot.
//
// Replica visual EXATO do app antigo (smoke test do usuário: "fundo
// escuro com logo em branco+laranja, badge PRO verde, ícone msg
// no canto superior direito").
'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';

interface TopNavProps {
  /** Badge de status do plano. Default "GRÁTIS". Vira "PRO" se usuário ativo. */
  proStatus?: 'GRÁTIS' | 'PRO' | 'ADMIN';
  /** Se true, mostra dot vermelho no ícone de chat. */
  hasUnreadChat?: boolean;
}

export function TopNav({ proStatus = 'GRÁTIS', hasUnreadChat = false }: TopNavProps) {
  const { user } = useAuth();

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-2.5 bg-[color:var(--color-ink)] px-3.5 min-h-14"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'max(14px, env(safe-area-inset-left))',
        paddingRight: 'max(14px, env(safe-area-inset-right))',
      }}
    >
      <Link
        href={user ? '/feed' : '/'}
        className="text-white font-extrabold tracking-tight truncate"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(15px, 5vw, 21px)',
        }}
        aria-label="Ir para o início"
      >
        Quero<span className="text-[color:var(--color-p1)]">Uma</span>Cor
      </Link>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          className="flex items-center text-xs font-extrabold px-3 py-1.5 rounded-full bg-white/15 text-white tracking-widest cursor-pointer border-none"
          style={{ fontFamily: 'var(--font-display)' }}
          aria-label="Ver plano PRO"
        >
          {proStatus}
        </button>

        <Link
          href="/chat"
          aria-label="Chat"
          className="relative w-11 h-11 flex items-center justify-center rounded-full"
        >
          <svg
            viewBox="0 0 24 24"
            width="22"
            height="22"
            stroke="#fff"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {hasUnreadChat && (
            <span
              className="absolute top-1.5 right-1 w-2.5 h-2.5 rounded-full"
              style={{
                background: 'var(--color-p4)',
                border: '2px solid var(--color-ink)',
              }}
            />
          )}
        </Link>
      </div>
    </header>
  );
}

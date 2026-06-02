// TopNav — navbar superior escura espelhando o vanilla (index.html linha
// ~227 + styles.css `.top-nav`). Fundo ink, logo Quero[Uma]Cor com
// "Uma" laranja, badge PRO/GRÁTIS à direita + ícone chat com badge dot.
//
// O badge agora é derivado do profile do user (via useProfile):
//   - profile.is_admin || profile.portal_access → "ADMIN"
//   - profile.is_pro                              → "PRO"
//   - caso contrário                              → "GRÁTIS"
// Antes era prop default 'GRÁTIS' que ninguém sobrescrevia — sempre
// aparecia GRÁTIS mesmo pra user PRO no banco.
'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';

interface TopNavProps {
  /** Override do badge — usado em telas onde a regra de derivação não
   *  bate (ex.: preview de admin como se fosse usuário comum). Sem
   *  passar, o badge é computado do profile. */
  proStatus?: 'GRÁTIS' | 'PRO' | 'ADMIN';
  /** Se true, mostra dot vermelho no ícone de chat. */
  hasUnreadChat?: boolean;
}

export function TopNav({ proStatus, hasUnreadChat = false }: TopNavProps) {
  const { user } = useAuth();
  const { profile } = useProfile();

  // Derivação automática se o caller não passou proStatus.
  const computed: 'GRÁTIS' | 'PRO' | 'ADMIN' =
    profile?.is_admin || profile?.portal_access
      ? 'ADMIN'
      : profile?.is_pro
        ? 'PRO'
        : 'GRÁTIS';
  const badge = proStatus ?? computed;

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
          {badge}
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

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
import { useUnreadMessageCount } from '@/lib/hooks/useUnreadMessageCount';

interface TopNavProps {
  /** Override do badge — usado em telas onde a regra de derivação não
   *  bate (ex.: preview de admin como se fosse usuário comum). Sem
   *  passar, o badge é computado do profile. */
  proStatus?: 'GRÁTIS' | 'PRO' | 'ADMIN';
}

export function TopNav({ proStatus }: TopNavProps) {
  const { user } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const unreadChat = useUnreadMessageCount();

  // Derivação automática se o caller não passou proStatus.
  // is_admin/portal_access podem não estar no SELECT (Profile type
  // marca opcional) — só is_pro é garantido pela view profiles_public.
  const p = profile as
    | (typeof profile & {
        is_admin?: boolean | null;
        portal_access?: boolean | null;
        pro_expires_at?: string | null;
        pro_grace_until?: string | null;
      })
    | null;

  // PRO ativo: is_pro=true OU pro_expires_at futuro OU pro_grace_until futuro.
  // Cobre o caso em que o trigger do banco ainda não atualizou is_pro mas
  // o user já comprou (expires_at preenchido) ou está em grace period.
  const now = Date.now();
  const isProActive =
    !!p?.is_pro ||
    (p?.pro_expires_at ? new Date(p.pro_expires_at).getTime() > now : false) ||
    (p?.pro_grace_until ? new Date(p.pro_grace_until).getTime() > now : false);

  // Durante o loading (profile ainda não chegou do banco/cache), mostra
  // '···' em vez de cair pra 'GRÁTIS' default — evita flash falso pra admin/PRO
  // recém-logado. cache persistence resolve a maioria dos casos (hidratação
  // síncrona), mas no primeiro login esse fallback é a rede mostrando trabalho.
  const computed: 'GRÁTIS' | 'PRO' | 'ADMIN' | '···' =
    profileLoading && !profile
      ? '···'
      : p?.is_admin || p?.portal_access
        ? 'ADMIN'
        : isProActive
          ? 'PRO'
          : 'GRÁTIS';
  const badge = proStatus ?? computed;

  return (
    <header
      role="banner"
      className="sticky top-0 z-50 flex items-center justify-between gap-2.5 bg-[color:var(--color-ink-fixed)] px-3.5 min-h-14"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'max(14px, env(safe-area-inset-left))',
        paddingRight: 'max(14px, env(safe-area-inset-right))',
      }}
    >
      <Link
        href={user ? '/feed' : '/'}
        className="text-white font-extrabold tracking-tight whitespace-nowrap"
        style={{
          fontFamily: 'var(--font-display)',
          // Tamanho dinâmico — encolhe quando o badge é mais largo (ADMIN).
          // Min 13px garante legibilidade em telas pequenas; max 21px é o
          // teto desktop. 4.2vw escala suave entre os dois.
          fontSize: 'clamp(13px, 4.2vw, 21px)',
          letterSpacing: '-0.5px',
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
          aria-label={
            unreadChat > 0 ? `Chat (${unreadChat} não lidas)` : 'Chat'
          }
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
          {unreadChat > 0 && (
            <span
              className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
              style={{
                background: 'var(--color-p4)',
                border: '2px solid var(--color-ink-fixed)',
                lineHeight: 1,
              }}
            >
              {unreadChat > 99 ? '99+' : unreadChat}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}

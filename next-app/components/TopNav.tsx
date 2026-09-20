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
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { useUnreadMessageCount } from '@/lib/hooks/useUnreadMessageCount';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { canSeeProFeature, isAdmin } from '@/lib/policies';

// Telas-raiz (as 5 abas da BottomNav): nelas não há "de onde voltar".
// Nas DEMAIS, o TopNav ganha um ← — importante no app Android, onde o
// botão voltar nativo do wrapper fecha o app em vez de navegar.
const ROOT_PATHS = new Set(['/', '/feed', '/search', '/loja', '/notificacoes', '/perfil']);

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
  const router = useRouter();
  const pathname = usePathname();
  const showBack = !!pathname && !ROOT_PATHS.has(pathname);

  function handleBack() {
    // Sem histórico (deep-link, app recém-aberto nessa tela), volta pro
    // feed em vez de não fazer nada.
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/feed');
  }

  // Derivação automática se o caller não passou proStatus.
  //
  // A1 (01/09/2026) — ESTA DERIVAÇÃO ERA UMA SEGUNDA FONTE DE VERDADE.
  // O selo dizia PRO com `is_pro=true` sozinho, enquanto quem realmente
  // destranca as ferramentas (`canSeeProFeature`, usado em Agenda, CRM,
  // Anotações…) exige `is_pro=true` E data futura quando há data. Como
  // NADA limpa `is_pro` no vencimento — não há cron nem trigger pra isso,
  // e o portal ativa PRO gravando `is_pro=true` + expiração —, o estado
  // "is_pro=true com data vencida" é permanente. Nele a pessoa via PRO na
  // barra de cima e levava "Esta função é exclusiva do Plano PRO" ao tocar
  // em qualquer ferramenta. Pagou, o app dizia que era PRO, e nada abria.
  //
  // Agora o selo pergunta às MESMAS funções que trancam a porta.
  const policyUser = usePolicyUser();

  // Durante o loading (profile ainda não chegou do banco/cache), mostra
  // '···' em vez de cair pra 'GRÁTIS' default — evita flash falso pra admin/PRO
  // recém-logado. cache persistence resolve a maioria dos casos (hidratação
  // síncrona), mas no primeiro login esse fallback é a rede mostrando trabalho.
  const computed: 'GRÁTIS' | 'PRO' | 'ADMIN' | '···' =
    profileLoading && !profile
      ? '···'
      : isAdmin(policyUser)
        ? 'ADMIN'
        : canSeeProFeature(policyUser)
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
      {showBack ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Voltar"
          className="flex items-center justify-center flex-shrink-0 text-[color:var(--color-white-fixed)]"
          style={{
            width: 36,
            height: 36,
            marginRight: -6,
            background: 'rgba(255,255,255,.08)',
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ←
        </button>
      ) : null}
      <Link
        href={user ? '/feed' : '/'}
        className="text-[color:var(--color-white-fixed)] font-extrabold tracking-tight whitespace-nowrap"
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
        {!user ? (
          // Modo visitante: botão de login no lugar do badge + chat.
          <Link
            href="/login"
            className="text-sm font-extrabold px-4 py-1.5 rounded-full text-[color:var(--color-white-fixed)] whitespace-nowrap"
            style={{ background: 'var(--color-p1-button)', fontFamily: 'var(--font-display)' }}
            aria-label="Entrar ou cadastrar"
          >
            Entrar
          </Link>
        ) : (
          <>
        <Link
          href="/pro"
          data-tour="nav-plano"
          className="flex items-center text-xs font-extrabold px-3 py-1.5 rounded-full bg-[color:color-mix(in_srgb,var(--color-white-fixed)_15%,transparent)] text-[color:var(--color-white-fixed)] tracking-widest cursor-pointer border-none"
          style={{ fontFamily: 'var(--font-display)' }}
          aria-label="Ver plano PRO"
        >
          {badge}
        </Link>

        <Link
          href="/chat"
          data-tour="nav-chat"
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
              className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-[color:var(--color-white-fixed)]"
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
          </>
        )}
      </div>
    </header>
  );
}

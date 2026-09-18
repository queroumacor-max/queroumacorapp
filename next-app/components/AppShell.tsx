// AppShell — wrapper das telas autenticadas. Replica a estrutura
// `<header.top-nav> + <main.scroll> + <nav.bot-nav>` do vanilla
// (index.html), com fundo cream, max-width 430px, e padding-bottom
// pra não cobrir conteúdo com a bot-nav fixa.
//
// Uso: envolver children de páginas em `<AppShell>...</AppShell>`.
// Páginas de auth (/login, /signup, /) NÃO usam AppShell.
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import { isProfileComplete } from '@/lib/profileCompletion';
import { reportFailure } from '@/lib/utils/reportFailure';
import { useNoPullToRefresh } from '@/lib/hooks/useNoPullToRefresh';
import { hasStoredSession } from '@/lib/sessionStorageHybrid';
import { TopNav } from './TopNav';
import { BottomNav } from './BottomNav';
import { RealtimeBindings } from './RealtimeBindings';
import { NativePushRouter } from './NativePushRouter';
import { NativeChrome } from './NativeChrome';
import { NativePushBridge } from './NativePushBridge';
import { NativeBadge } from './NativeBadge';
import { OfflineBanner } from './OfflineBanner';
import { AppTour } from './AppTour';
import { PickerRecovery } from './PickerRecovery';
import { BackGuard } from './BackGuard';
import { SplashMascotes } from './SplashMascotes';
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
  const { profile, loading: profileLoading, error: profileError } = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const scrollRef = useRef<HTMLElement>(null);

  // Pull-to-refresh do navegador: o CSS (`overscroll-behavior-y: contain`)
  // corta o encadeamento do gesto; este hook cancela o toque que NASCE com o
  // scroller já no topo, que era o caso que sobrava no arrasto rápido.
  useNoPullToRefresh(scrollRef);

  // Sessão GRAVADA no aparelho mas ainda não restaurada (boot com rede
  // fria estourava o timeout de 8s e o app EXPULSAVA pro /login quem
  // estava logado — era o "pede senha toda vez que reinicia"). Com
  // sessão salva, a tela vira "Reconectando…" em vez de formulário.
  // Estado (e não chamada direta no render) pra não divergir na
  // hidratação — no server não há localStorage.
  const [storedSession, setStoredSession] = useState(false);
  useEffect(() => {
    // Sincroniza com localStorage (sistema externo) — leitura só existe no
    // browser, não é derivável no render/SSR (ver comentário acima).
    if (loading || user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver comentário acima
    setStoredSession(hasStoredSession());
  }, [loading, user]);

  // Acesso sem conta REMOVIDO: telas privadas (requireAuth=true) exigem login —
  // visitante deslogado é mandado pro /login (com ?next pra voltar após logar).
  // Páginas públicas (/login, /signup, /, /completar-perfil) não usam AppShell;
  // as /info/* usam AppShell com requireAuth=false (chrome sem gate).
  useEffect(() => {
    if (!requireAuth) return;
    if (loading || user) return;
    // Sessão salva no aparelho → NÃO expulsa: o AuthProvider re-tenta a
    // restauração (visibilitychange/online/pageshow) e o onAuthStateChange
    // entrega o user quando a rede acorda. Se o refresh token for
    // realmente inválido, o supabase-js apaga a sessão salva e este guard
    // volta a mandar pro /login sozinho.
    if (hasStoredSession()) return;
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [requireAuth, loading, user, pathname, router]);

  // Cadastro pela metade (Google/Apple): quem entra por OAuth nasce sem
  // categoria e sem @tag. O /completar-perfil existe pra isso, mas era a
  // ÚNICA chance de preencher — se o redirect do provedor não pousasse lá
  // (Redirect URL fora da allowlist do Supabase manda pro Site URL) ou se a
  // pessoa fechasse a aba no meio, ela seguia usando o app sem @tag pra
  // sempre: não aparecia na busca e não tinha link de perfil.
  //
  // Aqui o app volta a pedir os dados na próxima abertura, quantas vezes for
  // preciso. Só redireciona com o profile REALMENTE carregado — erro de rede
  // ou query em voo não pode expulsar ninguém da tela.
  const incomplete =
    requireAuth &&
    !loading &&
    !!user &&
    !profileLoading &&
    !profileError &&
    !isProfileComplete(profile);

  useEffect(() => {
    if (!incomplete) return;
    if (pathname === '/completar-perfil') return;
    // DIZ POR QUE mandou pra cá (07/09/2026). O relato "o cadastro pede tudo
    // de novo" já sobreviveu a duas correções, e a causa continua sendo
    // dedução: pode ser perfil que não existe (a trigger falhou e engoliu a
    // exceção com RAISE WARNING), pode ser perfil sem @tag, pode ser
    // categoria vazia. Cada um pede um conserto diferente. Uma linha no
    // /admin/errors por redirecionamento responde isso na próxima tentativa,
    // em vez de mais um palpite.
    const p = profile as Record<string, unknown> | null | undefined;
    const preenchido = (v: unknown) =>
      typeof v === 'string' ? v.trim().length > 0 : !!v;
    reportFailure(
      'profile-incomplete',
      new Error('mandado pro /completar-perfil'),
      {
        userId: user?.id,
        ctx:
          `perfil=${p ? 'existe' : 'NAO EXISTE'}` +
          ` user_type=${preenchido(p?.user_type) ? 'ok' : 'vazio'}` +
          ` role=${preenchido(p?.role) ? 'ok' : 'vazio'}` +
          ` tag=${preenchido(p?.tag) ? 'ok' : 'vazio'}` +
          ` username=${preenchido(p?.username) ? 'ok' : 'vazio'}` +
          ` de=${pathname}`,
      },
    );
    router.replace('/completar-perfil');
    // `profile`/`user` fora das deps de propósito: o efeito dispara pela
    // TRANSIÇÃO pra incompleto, e relê os dois no momento do disparo. Pô-los
    // aqui faria a linha ser gravada de novo a cada refetch do perfil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomplete, pathname, router]);

  // Enquanto resolve auth ou enquanto o redirect dispara, não renderiza o
  // conteúdo privado (evita flash de tela protegida pra deslogado).
  if (requireAuth && (loading || !user || incomplete)) {
    // Sessão salva + rede lenta: tela de reconexão com saídas manuais,
    // nunca o formulário de senha.
    if (!loading && !user && storedSession) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center gap-4">
          <img
            src="/mascotes-calicolors.webp"
            alt=""
            width={640}
            height={762}
            className="w-[44vw] max-w-[170px] h-auto rounded-2xl"
          />
          <div>
            <div className="font-bold text-[color:var(--color-ink)]">Reconectando…</div>
            <p className="text-sm text-[color:var(--color-muted)] mt-1 max-w-[260px]">
              Sua conta está salva neste aparelho — só estamos esperando a
              conexão responder.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-white font-bold"
            style={{
              padding: '12px 26px',
              borderRadius: 12,
              border: 'none',
              background: 'var(--color-p1)',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Tentar agora
          </button>
          <Link
            href="/login"
            className="text-xs text-[color:var(--color-muted)] underline"
          >
            Entrar com outra conta
          </Link>
        </div>
      );
    }
    // Splash com os mascotes — mascara a espera do boot com a marca em vez
    // do "Carregando…" seco (a outra tela de loading, "Made By QueroUmaCor",
    // é do wrapper e se troca no painel do WebIntoApp).
    return <SplashMascotes />;
  }

  return (
    // Altura em `dvh`, não `vh`: no Safari do iPhone o `100vh` conta a área
    // ATRÁS das barras do navegador, então a régua fica maior que o espaço
    // visível e o rodapé do app (BottomNav, campo de digitar do chat) nasce
    // abaixo da dobra. `h-screen` fica como fallback pra browser sem dvh.
    <div
      className="flex flex-col w-full max-w-[430px] mx-auto h-screen bg-[color:var(--color-bg)] relative overflow-hidden"
      style={{ height: '100dvh' }}
    >
      <RealtimeBindings />
      {/* Casca: barra de status, teclado, splash, resume (no-op fora dela). */}
      <NativeChrome />
      <NativePushBridge />
      {/* Número no ícone do app = avisos + mensagens não lidas (no-op fora da
          casca / sem plugin de badge). */}
      <NativeBadge />
      {/* Toque em push nativa → navega pro data.url (no-op fora da casca). */}
      <NativePushRouter />
      {/* App morto pelo Android enquanto a galeria estava aberta: devolve a
          pessoa pra tela onde ela estava, em vez de largá-la no feed sem a
          foto e sem explicação. Ver components/PickerRecovery.tsx. */}
      <PickerRecovery />
      {/* Botão VOLTAR do Android: sem isto ele fecha o app do meio de
          qualquer tela quando o histórico está vazio (deep link, ou a
          re-navegação depois que o Android mata o renderizador da WebView).
          Ver components/BackGuard.tsx. */}
      <BackGuard />
      {/* Faixa "sem conexão" quando a rede cai. */}
      <OfflineBanner />
      {!hideTopNav && <TopNav proStatus={proStatus} />}
      <main
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          paddingBottom: hideBottomNav
            ? 'env(safe-area-inset-bottom)'
            : 'calc(68px + env(safe-area-inset-bottom))',
          WebkitOverflowScrolling: 'touch',
          // Este `<main>` é o ÚNICO scroller da tela (a raiz é 100dvh +
          // overflow hidden). Sem `contain`, ao chegar no topo o resto do
          // gesto encadeia no scroller raiz e o Chrome dispara o
          // pull-to-refresh: arrastar pra voltar ao topo recarregava o app
          // no meio do caminho. Ver comentário em globals.css.
          overscrollBehaviorY: 'contain',
        }}
      >
        {children}
      </main>
      {!hideBottomNav && <BottomNav />}
      {/* Tour guiado da primeira abertura. Fica no shell pra ter TopNav e
          BottomNav já montados na hora de medir os alvos; ele mesmo decide
          quando abrir (só em /feed, só uma vez — ver AppTour.tsx). */}
      <AppTour />
    </div>
  );
}

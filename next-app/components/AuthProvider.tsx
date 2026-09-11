'use client';
// Provider que centraliza a sessão Supabase no React Context. Substitui o
// par `currentUser` + `initAuth()` do `head.js` vanilla — onde aquela versão
// pendurava o user numa global e chamava `loadFeed()`/`refreshProStatus()`
// imperativamente, aqui o estado vive em useState e os consumers (Header,
// Nav, páginas privadas) leem via `useAuth()` e reagem com useEffect.
//
// Eventos cobertos:
// - getSession() inicial (restaurar sessão de localStorage)
// - onAuthStateChange (login, logout, refresh do token, recovery)
// - signIn / signOut helpers (encapsulam supabase-js pra UI não importar SDK)
//
// Não trata PASSWORD_RECOVERY aqui — isso fica em `/update-password/page.tsx`
// quando essa rota for portada.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { reportFailure } from '@/lib/utils/reportFailure';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** True quando o user tem email confirmado (Supabase
   *  `auth.users.email_confirmed_at` presente). False quando logado mas
   *  sem confirmar; null quando deslogado. Usado por componentes pra
   *  gating de mutações (publicar post, comentar, mandar DM) e pra
   *  banner de "Confirme seu email". */
  emailVerified: boolean | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  /** Login/cadastro com Google (Supabase OAuth). Redireciona o browser pro
   *  Google e volta pra `/completar-perfil` (que manda pro /feed se o perfil
   *  já estiver completo, ou pede categoria/@tag se for conta nova). Retorna
   *  `{ error }` só se a inicialização do fluxo falhar (antes do redirect). */
  signInWithGoogle: () => Promise<{ error?: string }>;
  /** Login/cadastro com Apple (Supabase OAuth). Mesmo fluxo do Google. */
  signInWithApple: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /** Reenvio do email de confirmação (Supabase resend). Retorna mensagem
   *  amigável de erro ou undefined em sucesso. */
  resendVerification: () => Promise<{ error?: string }>;
}

// Teto pra resolução da sessão inicial. 8s é generoso pra um refresh de token
// em 3G ruim e curto o bastante pra ninguém achar que o app travou.
const SESSION_TIMEOUT_MS = 8000;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Último access_token já espelhado no cookie do guard /admin/* — evita
  // re-POSTar a cada re-render/sync com o mesmo token.
  const lastCookieTokenRef = useRef<string | null>(null);

  // CRIT-4: espelha o access_token no cookie httpOnly `sb-session-token`
  // (via /api/auth/set-session-cookie) SEMPRE que a sessão muda. O
  // LoginForm só cobria login com email/senha — quem entrava por
  // Google/Apple (OAuth) nunca ganhava o cookie e via 404 eterno em
  // /admin/*. Aqui cobre todos os caminhos (OAuth, restore de sessão,
  // TOKEN_REFRESHED — que também renova o cookie antes do max-age de 1h
  // expirar). Best-effort: só afeta o painel admin, nunca o login em si.
  useEffect(() => {
    const token = session?.access_token ?? null;
    if (!token || token === lastCookieTokenRef.current) return;
    lastCookieTokenRef.current = token;
    try {
      void fetch('/api/auth/set-session-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token }),
        credentials: 'same-origin',
      }).catch(() => {
        // Silencioso — cookie é UX-only pro /admin.
      });
    } catch {
      // fetch indisponível (SSR/teste) — ignora.
    }
  }, [session]);

  useEffect(() => {
    const sb = getSupabase();
    let mounted = true;

    // `getSession()` NÃO é só leitura de localStorage: quando o access token
    // está vencido, o supabase-js dispara um refresh pela rede e só resolve
    // depois dele. Dentro do WebView (Capacitor iOS/Android) esse fetch pode
    // ficar pendurado pra sempre — o sistema congela o WebView no background
    // e a requisição que estava em voo nunca é rejeitada nem concluída ao
    // voltar. Como o `loading` só virava false no `.then`/`.catch`, o app
    // ficava eternamente no "Carregando…" do AppShell: exatamente o
    // "sai e volta e não abre mais" relatado.
    //
    // Aqui a promessa corre contra um timeout. Estourou, destrava a tela: o
    // usuário cai no /login (que já manda de volta pro /feed sozinho se a
    // sessão aparecer depois pelo onAuthStateChange) em vez de encarar uma
    // tela morta sem saída.
    // Lê o usuário no SERVIDOR (`/auth/v1/user`) e adota se ele já estiver
    // confirmado. Mesma corrida contra timeout do syncSession — no WebView
    // nenhum await de rede pode ficar solto. Falhar aqui não custa nada: o
    // estado continua sendo o do localStorage.
    const revalidarEmail = async () => {
      try {
        const r = await Promise.race([
          sb.auth.getUser(),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), SESSION_TIMEOUT_MS),
          ),
        ]);
        if (!mounted || !r) return;
        const fresco = r.data?.user;
        if (fresco?.email_confirmed_at) setUser(fresco);
      } catch {
        // Sem rede / token recusado: fica com o snapshot local.
      }
    };

    const syncSession = async () => {
      try {
        const result = await Promise.race([
          sb.auth.getSession(),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), SESSION_TIMEOUT_MS),
          ),
        ]);
        if (!mounted) return;
        if (result) {
          const sess = result.data.session;
          setSession(sess);
          setUser(sess?.user ?? null);
          // `getSession()` devolve o usuário GUARDADO no localStorage, não o
          // do servidor. Quem confirma o e-mail FORA do app (abre o link no
          // Chrome, no e-mail do celular) fica com uma cópia velha dizendo
          // "não confirmado" — e o app barra publicar post com "Confirme seu
          // email antes de publicar", mesmo com a conta já confirmada há
          // horas. O snapshot só se atualiza no refresh do token (1h), que no
          // WebView quase nunca acontece: o app é morto e restaurado antes.
          // Então, e SÓ quando a cópia local diz não-confirmado, perguntamos
          // ao servidor. Some sozinho assim que confirmar.
          if (sess?.user && !sess.user.email_confirmed_at) {
            void revalidarEmail();
          }
        }
      } catch {
        // Falha de rede/refresh — segue pro finally e destrava a tela.
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void syncSession();

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, sess) => {
      if (!mounted) return;
      setSession(sess);
      setUser(sess?.user ?? null);
      // Só destrava quando REALMENTE chegou uma sessão. Com `sess` nulo o
      // `getSession()` (e o timeout dele) é quem decide — senão um
      // INITIAL_SESSION vazio adiantaria um pulo pro /login antes da sessão
      // guardada terminar de ser restaurada.
      if (sess) setLoading(false);
    });

    // Ao voltar do background (ou ao recuperar a rede), refaz a leitura da
    // sessão. Sem isso, quem destravou pelo timeout ficaria "deslogado" até
    // matar o app: o supabase-js não tenta de novo sozinho, e o WebView não
    // recarrega a página ao ser retomado.
    const onResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void syncSession();
    };
    // `pageshow` só interessa com persisted=true (volta do bfcache no
    // Safari/WKWebView); no load normal ele duplicaria o sync do mount.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void syncSession();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onResume);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onResume);
      window.addEventListener('pageshow', onPageShow);
    }

    return () => {
      mounted = false;
      subscription.unsubscribe();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onResume);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onResume);
        window.removeEventListener('pageshow', onPageShow);
      }
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  // Helper genérico de OAuth — Google e Apple só diferem no `provider`.
  const signInWithOAuth = useCallback(
    async (provider: 'google' | 'apple'): Promise<{ error?: string }> => {
      const nome = provider === 'apple' ? 'Apple' : 'Google';
      try {
        // Dentro da casca nativa (Capacitor), OAuth NÃO pode navegar a
        // WebView — Google recusa (`disallowed_useragent`) e o App-Bound
        // Domains do iOS bloqueia. O fluxo nativo abre o browser do sistema
        // e volta por deep link (lib/native/auth.ts).
        const { native } = await import('@/lib/native');
        const naCasca = native.isNative();
        if (native.oauth.isAvailable()) {
          const res = await native.oauth.signIn(provider);
          if (res.error !== 'unavailable') {
            if (!res.error) {
              // Sessão já gravada no client; mesmo landing do fluxo web, que
              // decide entre /feed e onboarding.
              //
              // `router.replace`, não `location.assign`: navegação de
              // DOCUMENTO que falhe ou seja cancelada faz o Capacitor pintar
              // a errorPath (o offline.html). Aqui isso seria cruel — a
              // pessoa acabou de concluir o login e veria "Sem conexão".
              router.replace('/completar-perfil');
            }
            return res;
          }
          // 'unavailable' = o plugin sumiu entre o check e a chamada. Antes
          // isto caía pro fluxo web — ver o bloco abaixo pra por que não cai
          // mais.
        }

        // DENTRO DA CASCA O FLUXO WEB É PROIBIDO — foi ele que derrubou a
        // build 17 na App Review (Guideline 2.1, 06/09/2026).
        //
        // O `signInWithOAuth` sem `skipBrowserRedirect` navega a PRÓPRIA
        // WebView pro provedor. `appleid.apple.com` não está em
        // `server.allowNavigation`, então o Capacitor faz duas coisas
        // (WebViewDelegationHandler.swift): entrega a URL ao sistema E
        // CANCELA a navegação. O cancelamento chega como
        // `didFailProvisionalNavigation`, e ali o Capacitor carrega a
        // `errorPath` — o `offline.html`. Resultado: a tela "Sem conexão"
        // ocupando o app inteiro, com a internet funcionando. Foi
        // exatamente o print que a Apple anexou.
        //
        // Ou seja: aqui não existe fallback. Ou o fluxo nativo funciona, ou
        // a pessoa recebe uma frase que diz o que fazer.
        if (naCasca) {
          reportFailure(
            'oauth-fail',
            new Error(`fluxo nativo indisponível (${provider})`),
            {
              ctx: `plataforma=${native.platform()} plugins=[${native
                .plugins()
                .join(',')}]`,
            },
          );
          return {
            error:
              `Não foi possível iniciar o login com ${nome}. Feche e abra o ` +
              `app de novo. Se continuar, entre com e-mail e senha.`,
          };
        }

        const sb = getSupabase();
        // redirectTo baseado no origin atual → funciona em produção e nos
        // previews (*.pages.dev). Precisa estar na allowlist de Redirect URLs
        // do Supabase (Auth → URL Configuration). Volta pra /completar-perfil,
        // que decide entre /feed (perfil completo) e onboarding (conta nova).
        const redirectTo =
          typeof window !== 'undefined'
            ? `${window.location.origin}/completar-perfil`
            : undefined;
        const { error } = await sb.auth.signInWithOAuth({
          provider,
          options: redirectTo ? { redirectTo } : undefined,
        });
        // Em sucesso o supabase-js navega o browser pro provedor (não retorna aqui).
        return error ? { error: error.message } : {};
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : `Falha ao conectar com o ${nome}`,
        };
      }
    },
    [router],
  );

  const signInWithGoogle = useCallback(
    () => signInWithOAuth('google'),
    [signInWithOAuth],
  );
  const signInWithApple = useCallback(
    () => signInWithOAuth('apple'),
    [signInWithOAuth],
  );

  const signOut = useCallback(async () => {
    // CRIT-4: limpa o cookie httpOnly `sb-session-token` (gravado no login
    // por /api/auth/set-session-cookie) pra que o guard server-side de
    // /admin/* não conceda acesso após logout. Não-fatal.
    try {
      await fetch('/api/auth/set-session-cookie', {
        method: 'DELETE',
        credentials: 'same-origin',
      });
    } catch {
      // Silencioso.
    }
    await getSupabase().auth.signOut();
    // O cache do service worker é por aparelho, não por conta: pede pra ele
    // esvaziar tudo no logout, senão uma resposta guardada (offline) do dono
    // anterior aparece pro próximo login no mesmo aparelho. Best-effort.
    try {
      navigator.serviceWorker?.controller?.postMessage('CLEAR_CACHES');
    } catch {
      // sem service worker — nada a limpar.
    }
  }, []);

  const resendVerification = useCallback(async (): Promise<{ error?: string }> => {
    if (!user?.email) return { error: 'Faça login antes de reenviar.' };
    try {
      const sb = getSupabase();
      // Supabase v2: auth.resend({ type: 'signup', email })
      const sbAny = sb.auth as unknown as {
        resend: (opts: { type: 'signup'; email: string }) => Promise<{ error?: { message: string } | null }>;
      };
      const { error } = await sbAny.resend({ type: 'signup', email: user.email });
      if (error) return { error: error.message };
      return {};
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Falha ao reenviar' };
    }
  }, [user]);

  // emailVerified: true quando Supabase marcou email_confirmed_at; false
  // quando logado e ainda não confirmou; null quando deslogado.
  const emailVerified: boolean | null = user
    ? Boolean((user as User & { email_confirmed_at?: string | null }).email_confirmed_at)
    : null;

  // useMemo evita re-render dos consumers quando o pai re-renderiza sem
  // mudança real no value — só refaz quando algum field muda de identidade.
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      emailVerified,
      signIn,
      signInWithGoogle,
      signInWithApple,
      signOut,
      resendVerification,
    }),
    [
      user,
      session,
      loading,
      emailVerified,
      signIn,
      signInWithGoogle,
      signInWithApple,
      signOut,
      resendVerification,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

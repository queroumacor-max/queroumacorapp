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
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

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
   *  Google e volta pra `/feed`; o client detecta a sessão na URL de retorno
   *  (detectSessionInUrl) e o onAuthStateChange acende o estado. Retorna
   *  `{ error }` só se a inicialização do fluxo falhar (antes do redirect). */
  signInWithGoogle: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  /** Reenvio do email de confirmação (Supabase resend). Retorna mensagem
   *  amigável de erro ou undefined em sucesso. */
  resendVerification: () => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sb = getSupabase();
    let mounted = true;

    sb.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, sess) => {
      if (!mounted) return;
      setSession(sess);
      setUser(sess?.user ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<{ error?: string }> => {
    try {
      const sb = getSupabase();
      // redirectTo baseado no origin atual → funciona em produção e nos
      // previews (*.pages.dev). Precisa estar na allowlist de Redirect URLs
      // do Supabase (Auth → URL Configuration).
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/feed` : undefined;
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: redirectTo ? { redirectTo } : undefined,
      });
      // Em sucesso o supabase-js navega o browser pro Google (não retorna aqui).
      return error ? { error: error.message } : {};
    } catch (e) {
      return {
        error: e instanceof Error ? e.message : 'Falha ao conectar com o Google',
      };
    }
  }, []);

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
      signOut,
      resendVerification,
    }),
    [user, session, loading, emailVerified, signIn, signInWithGoogle, signOut, resendVerification],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

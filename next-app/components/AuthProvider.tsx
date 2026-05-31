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
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
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

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
  }, []);

  // useMemo evita re-render dos consumers quando o pai re-renderiza sem
  // mudança real no value — só refaz quando algum field muda de identidade.
  const value = useMemo<AuthContextValue>(
    () => ({ user, session, loading, signIn, signOut }),
    [user, session, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

'use client';
// GoogleSignInButton — botão "Entrar com Google" via Supabase OAuth.
// Usado nas telas de /login e /signup. O Supabase já tem o provider Google
// configurado no painel; aqui só disparamos o fluxo OAuth.
//
// redirectTo usa window.location.origin (lido no clique pra não quebrar SSR);
// a raiz `/` redireciona todo mundo pro /feed (ver CLAUDE.md — modo guest).
import { useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export function GoogleSignInButton({ label = 'Entrar com Google' }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const sb = getSupabase();
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
      }
      // Em sucesso o browser navega pro Google — não há o que limpar aqui.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao entrar com Google');
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center justify-center gap-3 w-full font-bold text-base text-[color:var(--color-ink)] bg-white border-[1.5px] border-[color:var(--color-border)] hover:border-[color:var(--color-ink)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        style={{ padding: 15, borderRadius: 14 }}
      >
        <GoogleIcon />
        {loading ? 'Conectando…' : label}
      </button>
      {error && (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 px-3 py-2 rounded-lg mt-2"
        >
          {error}
        </p>
      )}
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

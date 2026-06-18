'use client';
// GoogleSignInButton — botão "Continuar com Google" reutilizado no /login e
// no /signup. Dispara o OAuth do Supabase via AuthProvider.signInWithGoogle();
// em sucesso o browser é redirecionado pro Google (não volta pra cá), então o
// estado `loading` só é resetado em caso de erro antes do redirect.

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

export function GoogleSignInButton({
  label = 'Continuar com Google',
}: {
  /** Texto do botão. Ex.: "Cadastrar com Google" na tela de signup. */
  label?: string;
}) {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    const { error } = await signInWithGoogle();
    if (error) {
      // Falhou antes do redirect — mostra o erro e reabilita o botão.
      setError(error);
      setLoading(false);
    }
    // Sucesso: o browser navega pro Google; mantemos `loading` até sair.
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center justify-center gap-2.5 w-full font-bold text-base text-[color:var(--color-ink)] bg-white border-[1.5px] border-[color:var(--color-border)] hover:border-[color:var(--color-ink)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        style={{ padding: 15, borderRadius: 14 }}
      >
        <GoogleLogo />
        {loading ? 'Redirecionando…' : label}
      </button>
      {error ? (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 px-3 py-2 rounded-lg mt-2"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

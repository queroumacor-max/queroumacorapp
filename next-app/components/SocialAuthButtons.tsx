'use client';
// SocialAuthButtons — botões de login/cadastro social (Google + Apple),
// reutilizados no /login e no /signup. Disparam o OAuth do Supabase via
// AuthProvider; em sucesso o browser é redirecionado pro provedor (não volta
// pra cá), então `loading` só é resetado em caso de erro antes do redirect.

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

function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <path d="M16.36 12.62c.03 2.93 2.57 3.9 2.6 3.92-.02.07-.41 1.4-1.35 2.78-.81 1.19-1.65 2.38-2.98 2.4-1.3.03-1.72-.77-3.21-.77-1.49 0-1.96.75-3.19.8-1.28.05-2.25-1.29-3.07-2.48-1.67-2.43-2.95-6.86-1.23-9.85a4.77 4.77 0 0 1 4.03-2.46c1.26-.02 2.44.85 3.21.85.76 0 2.2-1.05 3.71-.9.63.03 2.41.26 3.55 1.92-.09.06-2.12 1.24-2.1 3.69M13.93 4.2c.68-.82 1.13-1.97.1-3.15-.86-.04-1.93.51-2.61 1.33-.61.71-1.15 1.86-1.01 2.96.95.07 1.93-.5 2.61-1.31" />
    </svg>
  );
}

function OAuthButton({
  onClick,
  setError,
  variant,
  children,
}: {
  onClick: () => Promise<{ error?: string }>;
  setError: (s: string | null) => void;
  variant: 'google' | 'apple';
  children: React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setError(null);
    setLoading(true);
    const { error } = await onClick();
    if (error) {
      setError(error);
      setLoading(false);
    }
    // Sucesso: o browser navega pro provedor; mantemos `loading` até sair.
  }

  const isApple = variant === 'apple';
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={
        'flex items-center justify-center gap-2.5 w-full font-bold text-base disabled:opacity-60 disabled:cursor-not-allowed transition-colors ' +
        (isApple
          ? 'text-white bg-black border-[1.5px] border-black hover:opacity-90'
          : 'text-[color:var(--color-ink)] bg-white border-[1.5px] border-[color:var(--color-border)] hover:border-[color:var(--color-ink)]')
      }
      style={{ padding: 15, borderRadius: 14 }}
    >
      {loading ? 'Redirecionando…' : children}
    </button>
  );
}

/**
 * Botões Google + Apple empilhados, com uma área de erro compartilhada.
 * @param context 'login' | 'signup' — só muda o verbo ("Continuar"/"Cadastrar").
 */
export function SocialAuthButtons({ context = 'login' }: { context?: 'login' | 'signup' }) {
  const { signInWithGoogle, signInWithApple } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const verb = context === 'signup' ? 'Cadastrar' : 'Continuar';

  return (
    <div className="space-y-3">
      <OAuthButton onClick={signInWithGoogle} setError={setError} variant="google">
        <GoogleLogo />
        {verb} com Google
      </OAuthButton>
      <OAuthButton onClick={signInWithApple} setError={setError} variant="apple">
        <AppleLogo />
        {verb} com Apple
      </OAuthButton>
      {error ? (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 px-3 py-2 rounded-lg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

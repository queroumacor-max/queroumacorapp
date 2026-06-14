// Página /login — espelha o `#screen-login` do vanilla (index.html linha 271+).
// Pattern: `AuthScreen` (dark hero com logo + tagline, cream card com form
// arredondado no topo). Sem TopNav/BottomNav (vanilla esconde shells em
// telas de auth — modules/nav.js noNav=['login','signup','chatconv']).
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuthScreen } from '@/components/AuthScreen';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Entrar | QueroUmaCor',
  description: 'Entre na sua conta do QueroUmaCor.',
};

export default function LoginPage() {
  return (
    <AuthScreen
      tagline={
        <>
          A plataforma dos pintores profissionais
          <br />
          e quem precisa de um serviço de qualidade.
        </>
      }
    >
      <h2
        className="font-extrabold text-[color:var(--color-ink)]"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          marginBottom: 6,
        }}
      >
        Bem-vindo de volta 👋
      </h2>
      <div
        className="text-[color:var(--color-muted)]"
        style={{ fontSize: 14, marginBottom: 24 }}
      >
        Entre na sua conta para continuar
      </div>
      {/* Suspense obrigatório: LoginForm usa useSearchParams() */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthScreen>
  );
}

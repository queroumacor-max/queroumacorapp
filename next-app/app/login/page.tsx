// Página /login — espelha o `#screen-login` do vanilla (index.html linha 271+).
// Pattern: `AuthScreen` (dark hero com logo + tagline, cream card com form
// arredondado no topo). Sem TopNav/BottomNav (vanilla esconde shells em
// telas de auth — modules/nav.js noNav=['login','signup','chatconv']).
import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
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

      {/* Rodapé discreto com identificação formal do operador (CALICOLORS
          TINTAS LTDA) + links públicos pros Termos e Privacidade. Exigência
          de transparência (LGPD/CDC) e das app stores. As rotas
          /termos-de-uso e /politica-de-privacidade são públicas (sem login). */}
      <p
        className="text-center text-[color:var(--color-muted)]"
        style={{ fontSize: 11, lineHeight: 1.6, marginTop: 24 }}
      >
        QueroUmaCor é operado pela CALICOLORS TINTAS LTDA — CNPJ
        47.677.346/0001-92.
        <br />
        <Link
          href="/termos-de-uso"
          className="hover:underline"
          style={{ color: 'var(--color-p1)' }}
        >
          Termos de Uso
        </Link>{' '}
        ·{' '}
        <Link
          href="/politica-de-privacidade"
          className="hover:underline"
          style={{ color: 'var(--color-p1)' }}
        >
          Política de Privacidade
        </Link>
      </p>
    </AuthScreen>
  );
}

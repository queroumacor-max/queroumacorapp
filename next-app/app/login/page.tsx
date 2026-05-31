// Server Component: envia só a casca renderizada no SSR. Toda interação
// (form state, validação, submit) vive no LoginForm client component.
import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Entrar | QueroUmaCor',
  description: 'Entre na sua conta do QueroUmaCor.',
};

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[color:var(--color-bg)]">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <div className="text-center mb-6">
          <div
            className="text-3xl font-extrabold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Quero<span className="text-[color:var(--color-p1)]">Uma</span>Cor
          </div>
          <p className="text-xs text-[color:var(--color-muted)] mt-1">
            A plataforma dos pintores profissionais
          </p>
        </div>
        <h1
          className="text-2xl font-bold mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Bem-vindo de volta
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-6">
          Entre na sua conta para continuar
        </p>
        <LoginForm />
      </div>
    </main>
  );
}

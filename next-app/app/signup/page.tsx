// Server Component shell — só renderiza o frame e delega o multi-step
// pro SignupFlow client component. Mesmo padrão do /login.
import type { Metadata } from 'next';
import { SignupFlow } from './SignupFlow';

export const metadata: Metadata = {
  title: 'Cadastro | QueroUmaCor',
  description: 'Crie sua conta no QueroUmaCor.',
};

export default function SignupPage() {
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
        <SignupFlow />
      </div>
    </main>
  );
}

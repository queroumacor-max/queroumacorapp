// Página /signup — espelha o `#screen-signup` do vanilla (index.html linha
// 315+). Usa o mesmo AuthScreen do /login pra ter o pattern hero dark +
// cream card. O multi-step real fica no SignupFlow client component.
import type { Metadata } from 'next';
import { AuthScreen } from '@/components/AuthScreen';
import { SignupFlow } from './SignupFlow';

export const metadata: Metadata = {
  title: 'Cadastro | QueroUmaCor',
  description: 'Crie sua conta no QueroUmaCor.',
};

export default function SignupPage() {
  return (
    <AuthScreen tagline="Cadastro apenas por convite.">
      <SignupFlow />
    </AuthScreen>
  );
}

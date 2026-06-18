// /completar-perfil — onboarding pós-login social (Google/Apple). É o
// `redirectTo` do signInWithOAuth: decide entre mandar pro /feed (perfil já
// completo) ou pedir categoria + @tag (conta recém-criada via OAuth). Usa o
// mesmo AuthScreen do /login e /signup (hero dark + card cream, sem nav).
import type { Metadata } from 'next';
import { AuthScreen } from '@/components/AuthScreen';
import { CompleteProfileForm } from './CompleteProfileForm';

export const metadata: Metadata = {
  title: 'Completar cadastro | QueroUmaCor',
  description: 'Finalize seu perfil pra começar a usar o QueroUmaCor.',
  robots: { index: false, follow: false },
};

export default function CompletarPerfilPage() {
  return (
    <AuthScreen tagline="Quase lá — só mais um passo.">
      <CompleteProfileForm />
    </AuthScreen>
  );
}

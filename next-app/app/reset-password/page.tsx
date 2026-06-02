// Página /reset-password — solicita email do user pra mandar link de reset.
// Espelha sendPasswordReset() do vanilla (modules/auth-pw.js linha 9).
// Usa o mesmo AuthScreen do /login (hero dark + cream card).
import type { Metadata } from 'next';
import { AuthScreen } from '@/components/AuthScreen';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Recuperar senha | QueroUmaCor',
  description: 'Recupere o acesso à sua conta do QueroUmaCor.',
};

export default function ResetPasswordPage() {
  return (
    <AuthScreen
      tagline={
        <>
          Esqueceu a senha? A gente ajuda a recuperar
          <br />
          em alguns segundos.
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
        Recuperar senha 🔑
      </h2>
      <div
        className="text-[color:var(--color-muted)]"
        style={{ fontSize: 14, marginBottom: 24 }}
      >
        Vamos enviar um link de redefinição pro seu email.
      </div>
      <ResetPasswordForm />
    </AuthScreen>
  );
}

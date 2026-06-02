// Página /update-password — onde o user cai após clicar no link do email.
// Supabase Auth processa o hash da URL e cria a sessão antes do form
// montar (auth.onAuthStateChange dispara PASSWORD_RECOVERY).
// Espelha _initUpdatePasswordScreen + doSetNewPassword do vanilla.
import type { Metadata } from 'next';
import { AuthScreen } from '@/components/AuthScreen';
import { UpdatePasswordForm } from './UpdatePasswordForm';

export const metadata: Metadata = {
  title: 'Nova senha | QueroUmaCor',
  description: 'Defina uma nova senha para sua conta.',
};

export default function UpdatePasswordPage() {
  return (
    <AuthScreen
      tagline={
        <>
          Quase lá! Escolhe uma senha nova
          <br />
          e tu já tá dentro.
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
        Nova senha 🔐
      </h2>
      <div
        className="text-[color:var(--color-muted)]"
        style={{ fontSize: 14, marginBottom: 24 }}
      >
        Mínimo 8 caracteres. Confirme abaixo.
      </div>
      <UpdatePasswordForm />
    </AuthScreen>
  );
}

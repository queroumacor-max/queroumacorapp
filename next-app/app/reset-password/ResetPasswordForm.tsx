'use client';
// ResetPasswordForm — form de pedir reset. Equivalente Next/React do
// `sendPasswordReset()` em modules/auth-pw.js do vanilla.
//   - email validado por Zod (emailSchema);
//   - submit chama sb.auth.resetPasswordForEmail com redirectTo apontando
//     pra /update-password (rota desta mesma origem, fica disponível no
//     deeplink do email);
//   - sucesso mostra mensagem amigável + botão pra voltar pro login.

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema } from '@/lib/schemas';
import { getSupabase } from '@/lib/supabase';

const schema = z.object({ email: emailSchema });
type FormData = z.infer<typeof schema>;

export function ResetPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function onSubmit(data: FormData) {
    setServerError(null);
    try {
      const sb = getSupabase();
      const { error } = await sb.auth.resetPasswordForEmail(data.email, {
        redirectTo: `${window.location.origin}/update-password`,
      });
      if (error) {
        setServerError(error.message);
        return;
      }
      setSent(data.email);
    } catch (e) {
      setServerError((e as Error).message || 'Erro ao enviar email');
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <div className="text-5xl mb-3" aria-hidden="true">📬</div>
        <h3
          className="font-bold mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            color: 'var(--color-ink)',
          }}
        >
          Email enviado!
        </h3>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--color-muted)', lineHeight: 1.55 }}
        >
          Verifique a caixa de entrada de <b>{sent}</b>. Se não estiver lá,
          olhe na pasta de spam. O link vale por 1 hora.
        </p>
        <Link
          href="/login"
          className="block w-full text-center font-bold"
          style={{
            padding: 15,
            background: 'var(--color-p1)',
            color: '#fff',
            borderRadius: 14,
            fontSize: 16,
            textDecoration: 'none',
          }}
        >
          Voltar pro login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Email cadastrado
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          {...register('email')}
          className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
          aria-invalid={errors.email ? 'true' : 'false'}
        />
        {errors.email && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.email.message}
          </p>
        )}
      </div>

      {serverError && (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 px-3 py-2 rounded-lg"
        >
          {serverError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full bg-[color:var(--color-p1)] text-white font-bold text-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        style={{ padding: 15, borderRadius: 14, marginTop: 8 }}
      >
        {isSubmitting ? 'Enviando…' : 'Enviar link de recuperação'}
      </button>

      <p className="text-center text-sm text-[color:var(--color-muted)] pt-2">
        Lembrou da senha?{' '}
        <Link
          href="/login"
          className="font-bold hover:underline"
          style={{ color: 'inherit' }}
        >
          Entrar
        </Link>
      </p>
    </form>
  );
}

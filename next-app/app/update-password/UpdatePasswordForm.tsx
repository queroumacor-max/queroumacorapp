'use client';
// UpdatePasswordForm — form de definir nova senha. Equivalente Next/React
// do `doSetNewPassword()` em modules/auth-pw.js.
//
// Fluxo: user clica no link do email → Supabase processa hash da URL e
// cria sessão de password-recovery → user vê esse form → submit chama
// sb.auth.updateUser({ password }) → redireciona pra /feed.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { strongPasswordSchema } from '@/lib/schemas';
import { getSupabase } from '@/lib/supabase';

const schema = z
  .object({
    password: strongPasswordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: 'As senhas não coincidem',
    path: ['confirm'],
  });

type FormData = z.infer<typeof schema>;

export function UpdatePasswordForm() {
  const router = useRouter();
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  // Aguarda Supabase processar o hash da URL e disparar
  // PASSWORD_RECOVERY no auth state. Sem sessão, o updateUser falha
  // com "User not authenticated" — feedback ruim. Detectamos a sessão
  // antes de mostrar o form como acionável.
  useEffect(() => {
    const sb = getSupabase();
    let cancel = false;
    sb.auth.getSession().then(({ data }) => {
      if (cancel) return;
      if (data.session) setSessionReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true);
      }
    });
    return () => {
      cancel = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function onSubmit(data: FormData) {
    setServerError(null);
    try {
      const sb = getSupabase();
      const { error } = await sb.auth.updateUser({ password: data.password });
      if (error) {
        setServerError(error.message);
        return;
      }
      setDone(true);
      // Pequena pausa pra user ver a mensagem antes de navegar.
      setTimeout(() => {
        router.push('/feed');
        router.refresh();
      }, 1500);
    } catch (e) {
      setServerError((e as Error).message || 'Erro ao definir nova senha');
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="text-5xl mb-3" aria-hidden="true">✅</div>
        <h3
          className="font-bold mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            color: 'var(--color-ink)',
          }}
        >
          Senha atualizada!
        </h3>
        <p
          className="text-sm"
          style={{ color: 'var(--color-muted)', lineHeight: 1.55 }}
        >
          Redirecionando pra sua conta…
        </p>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="text-center" style={{ padding: '12px 0' }}>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          Validando link…
        </p>
        <p
          className="text-xs mt-3"
          style={{ color: 'var(--color-muted)' }}
        >
          Se isso demorar, o link pode ter expirado. Solicite um novo em{' '}
          <Link
            href="/reset-password"
            className="font-bold underline"
            style={{ color: 'var(--color-p1)' }}
          >
            Recuperar senha
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Nova senha
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            {...register('password')}
            className="w-full px-4 py-3 pr-12 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
            aria-invalid={errors.password ? 'true' : 'false'}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)]"
          >
            {showPw ? '🙈' : '👁'}
          </button>
        </div>
        {errors.password && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.password.message}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="confirm"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Confirme a senha
        </label>
        <div className="relative">
          <input
            id="confirm"
            type={showConfirm ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Digite de novo"
            {...register('confirm')}
            className="w-full px-4 py-3 pr-12 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
            aria-invalid={errors.confirm ? 'true' : 'false'}
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)]"
          >
            {showConfirm ? '🙈' : '👁'}
          </button>
        </div>
        {errors.confirm && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.confirm.message}
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
        {isSubmitting ? 'Salvando…' : 'Salvar nova senha'}
      </button>
    </form>
  );
}

'use client';
// LoginForm — equivalente Next/React do `doLogin()` em `head.js` vanilla.
// Mudanças vs vanilla:
//  - validação client-side feita pelo Zod (emailSchema/passwordSchema) em vez
//    de regex inline + alert/toast manual;
//  - submit usa o `signIn()` do AuthProvider (que encapsula supabase-js);
//  - sucesso redireciona pra `/feed` (vanilla: `showScreen('feed')` em
//    head.js:1008 após doLoginSupabase);
//  - reset de senha vive em rota separada (`/reset-password`) — ver TODO.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '@/lib/schemas';
import { useAuth } from '@/components/AuthProvider';

const schema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

type FormData = z.infer<typeof schema>;

export function LoginForm() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(data: FormData) {
    setServerError(null);
    const { error } = await signIn(data.email, data.password);
    if (error) {
      // Supabase retorna "Invalid login credentials" — tradução amigável.
      const friendly =
        error === 'Invalid login credentials'
          ? 'Email ou senha incorretos'
          : error;
      setServerError(friendly);
      return;
    }
    // Após login bem-sucedido: feed (app principal). Vanilla fazia
    // `showScreen('feed')` em head.js:1008 logo após doLoginSupabase.
    router.push('/feed');
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          {...register('email')}
          className="w-full px-4 py-3 text-base bg-[color:var(--color-bg)] border-2 border-transparent focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
          aria-invalid={errors.email ? 'true' : 'false'}
        />
        {errors.email && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.email.message}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Senha
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPw ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            {...register('password')}
            className="w-full px-4 py-3 pr-12 text-base bg-[color:var(--color-bg)] border-2 border-transparent focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
            aria-invalid={errors.password ? 'true' : 'false'}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] px-2 py-1"
          >
            {showPw ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        {errors.password && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="text-right -mt-2">
        {/* TODO: portar `/reset-password` (vanilla `sendPasswordReset` em modules/auth-pw.js).
            Por enquanto link estático — rota retorna 404 até feature ser portada. */}
        <Link
          href="/reset-password"
          className="text-sm text-[color:var(--color-p1)] font-semibold hover:underline"
        >
          Esqueceu a senha?
        </Link>
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
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold text-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </button>

      <p className="text-center text-sm text-[color:var(--color-muted)] pt-2">
        Não tem conta?{' '}
        <Link
          href="/signup"
          className="text-[color:var(--color-p1)] font-semibold hover:underline"
        >
          Cadastre-se grátis
        </Link>
      </p>
    </form>
  );
}

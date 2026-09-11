'use client';
// LoginForm — equivalente Next/React do `doLogin()` em `head.js` vanilla.
// Mudanças vs vanilla:
//  - validação client-side feita pelo Zod (emailSchema/passwordSchema) em vez
//    de regex inline + alert/toast manual;
//  - submit usa o `signIn()` do AuthProvider (que encapsula supabase-js);
//  - sucesso redireciona pra `/feed` (vanilla: `showScreen('feed')` em
//    head.js:1008 após doLoginSupabase);
//  - reset de senha vive em rota separada (`/reset-password`) — ver TODO.
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema, passwordSchema } from '@/lib/schemas';
import { useAuth } from '@/components/AuthProvider';
import { SocialAuthButtons } from '@/components/SocialAuthButtons';
import { getSupabase } from '@/lib/supabase';
import { mensagemDeLimite, preCheckAuthRate } from '@/lib/services/authRateCheck';

const schema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

type FormData = z.infer<typeof schema>;

// Whitelist de rotas permitidas como destino após login. Não aceitamos
// URL absoluta nem ?next= externo (mitiga open-redirect).
const ALLOWED_NEXT = new Set<string>([
  '/feed',
  '/perfil',
  '/delete-account',
  '/info',
  '/info/privacidade',
  '/info/termos',
  '/pro',
]);

function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/feed';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/feed';
  const clean = raw.split('?')[0].split('#')[0];
  return ALLOWED_NEXT.has(clean) ? raw : '/feed';
}

// "Lembrar meu e-mail": guarda SÓ o e-mail em localStorage pra pré-preencher
// o campo na próxima vez. A SENHA nunca é gravada — localStorage é legível
// por qualquer script da página, então senha em texto plano ali viraria
// alvo de XSS e fere a boa prática de segurança (LGPD art. 46 exige medidas
// proporcionais). Quem mantém a pessoa logada é a SESSÃO do Supabase, que
// já persiste sozinha; se o app está pedindo senha a cada abertura, o
// problema é a sessão sendo apagada (ver wrapper), não falta deste campo.
const SAVED_EMAIL_KEY = 'login_saved_email';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?.` porque `useSearchParams()` é tipado como anulável (o app passou a
  // ter também um `pages/500.tsx` — ver o comentário lá). Os outros usos no
  // app já tratavam o nulo; este era o único que não.
  const next = safeNext(searchParams?.get('next') ?? null);
  const { signIn, user, loading: authLoading } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  // Já logado nesta tela = chegou aqui por engano. Acontece quando o
  // AuthProvider destrava por timeout (WebView que voltou do background com a
  // rede ainda fria) e manda pro /login antes da sessão terminar de resolver:
  // segundos depois o onAuthStateChange entrega o usuário e, sem este efeito,
  // a pessoa ficaria encarando o formulário de login já estando autenticada.
  useEffect(() => {
    if (authLoading || !user) return;
    router.replace(next);
  }, [authLoading, user, next, router]);
  const [showPw, setShowPw] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Pré-preenche o e-mail salvo (se a pessoa marcou "lembrar" numa visita
  // anterior). try/catch: localStorage pode estar indisponível (modo
  // privado) e isso nunca pode quebrar o login.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_EMAIL_KEY);
      if (saved) {
        setRememberEmail(true);
        setValue('email', saved);
      }
    } catch {
      // segue sem pré-preencher
    }
  }, [setValue]);

  async function onSubmit(data: FormData) {
    setServerError(null);
    // Rate limit por IP (advisory, fail-open) ANTES de bater no Supabase.
    const limite = await preCheckAuthRate('login');
    if (limite.blocked) {
      setServerError(mensagemDeLimite(limite));
      return;
    }
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
    // Só grava o e-mail DEPOIS do login dar certo (não guardar typo).
    try {
      if (rememberEmail) localStorage.setItem(SAVED_EMAIL_KEY, data.email);
      else localStorage.removeItem(SAVED_EMAIL_KEY);
    } catch {
      // best-effort
    }
    // CRIT-4: grava cookie httpOnly com access_token pra que RSCs do painel
    // /admin/* consigam validar admin server-side via lib/auth-server.ts.
    // Não-fatal: se falhar, login continua normal (cookie só afeta /admin).
    try {
      const sb = getSupabase();
      const { data } = await sb.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken) {
        await fetch('/api/auth/set-session-cookie', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken }),
          credentials: 'same-origin',
        });
      }
    } catch {
      // Silencioso — UX-only pra admin.
    }
    // Após login bem-sucedido: redireciona pra `?next=` quando válido
    // (whitelist), senão `/feed`. Vanilla fazia `showScreen('feed')` em
    // head.js:1008 logo após doLoginSupabase.
    router.push(next);
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
          className="w-full px-4 py-3 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
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
            className="w-full px-4 py-3 pr-12 text-base bg-white border-[1.5px] border-[color:var(--color-border)] focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
            aria-invalid={errors.password ? 'true' : 'false'}
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {showPw ? (
                <>
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </>
              ) : (
                <>
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        </div>
        {errors.password && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between -mt-2">
        <label className="flex items-center gap-2 text-sm text-[color:var(--color-muted)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberEmail}
            onChange={(e) => setRememberEmail(e.target.checked)}
            className="w-4 h-4 accent-[#ff6b35]"
          />
          Lembrar meu e-mail
        </label>
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
        className="w-full bg-[color:var(--color-p1)] text-white font-bold text-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        style={{ padding: 15, borderRadius: 14, marginTop: 8 }}
      >
        {isSubmitting ? 'Entrando…' : 'Entrar'}
      </button>

      {/* Divisor entre login por senha e as alternativas (Google / visitante). */}
      <div className="flex items-center gap-3 pt-2" aria-hidden="true">
        <span className="flex-1 h-px bg-[color:var(--color-border)]" />
        <span className="text-xs text-[color:var(--color-muted)]">ou</span>
        <span className="flex-1 h-px bg-[color:var(--color-border)]" />
      </div>

      {/* Login social — Google + Apple OAuth via Supabase. */}
      <SocialAuthButtons context="login" />

      {/* Cadastro. Vanilla aplica `color:inherit` inline no link — neutraliza
          o `var(--p1)` e fica cinza igual o texto ao redor. Replicado. */}
      <p className="text-center text-sm text-[color:var(--color-muted)] pt-2">
        Não tem conta?{' '}
        <Link href="/signup" className="font-bold hover:underline" style={{ color: 'inherit' }}>
          Cadastre-se grátis
        </Link>
      </p>
    </form>
  );
}

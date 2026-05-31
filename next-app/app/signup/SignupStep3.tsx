'use client';
// SignupStep3 — senha + invite code opcional + termos.
// O vanilla tinha duas variantes (pintor: especialidades; cliente: tipos de
// serviço). Aqui simplificamos: o que de fato é gravado pelo doSignup vanilla
// é a senha; as especialidades viram edição de perfil pós-cadastro. Mantemos
// invite code opcional (formato QUC-XXXXX) e checkbox de consentimento LGPD.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { strongPasswordSchema } from '@/lib/schemas';

const schema = z.object({
  password: strongPasswordSchema,
  // Invite code: opcional, mas se preenchido tem que começar com "QUC-".
  // Trimmed + uppercase no submit pra bater com generateInviteCode vanilla.
  inviteCode: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => v === '' || /^QUC-[A-Z0-9]{5}$/.test(v), {
      message: 'Código de convite inválido (formato QUC-XXXXX)',
    })
    .optional()
    .default(''),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'Você precisa aceitar os Termos e a Política de Privacidade' }),
  }),
});

export type Step3Data = z.infer<typeof schema>;

interface Props {
  submitting: boolean;
  serverError: string | null;
  onSubmit: (data: Step3Data) => void;
  onBack: () => void;
}

export function SignupStep3({ submitting, serverError, onSubmit, onBack }: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Step3Data>({
    resolver: zodResolver(schema),
    defaultValues: {
      password: '',
      inviteCode: '',
      // consent default omitted on purpose: literal(true) só passa quando
      // o usuário marcar; manter undefined força a validação.
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <h1
        className="text-2xl font-bold mb-1"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Quase lá!
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] -mt-1">
        Crie uma senha segura e aceite os termos
      </p>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Senha
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          {...register('password')}
          className="w-full px-4 py-3 text-base bg-[color:var(--color-bg)] border-2 border-transparent focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors"
          aria-invalid={errors.password ? 'true' : 'false'}
        />
        {errors.password && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.password.message}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="inviteCode"
          className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
        >
          Código de convite{' '}
          <span className="text-xs text-[color:var(--color-muted)] font-normal">
            (opcional)
          </span>
        </label>
        <input
          id="inviteCode"
          type="text"
          placeholder="QUC-XXXXX"
          {...register('inviteCode')}
          className="w-full px-4 py-3 text-base bg-[color:var(--color-bg)] border-2 border-transparent focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors uppercase"
          aria-invalid={errors.inviteCode ? 'true' : 'false'}
        />
        {errors.inviteCode && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.inviteCode.message}
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 text-xs leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          {...register('consent')}
          className="mt-0.5 w-4 h-4 flex-shrink-0 accent-[color:var(--color-p1)]"
        />
        <span className="text-[color:var(--color-ink)]">
          Li e concordo com os{' '}
          <Link
            href="/info/termos"
            className="text-[color:var(--color-p1)] underline font-semibold"
          >
            Termos de Uso
          </Link>{' '}
          e a{' '}
          <Link
            href="/info/privacidade"
            className="text-[color:var(--color-p1)] underline font-semibold"
          >
            Política de Privacidade
          </Link>
          . Estou ciente do tratamento dos meus dados conforme a LGPD.
        </span>
      </label>
      {errors.consent && (
        <p className="text-sm text-[color:var(--color-danger)] -mt-2">
          {errors.consent.message}
        </p>
      )}

      {serverError && (
        <p
          role="alert"
          className="text-sm text-[color:var(--color-danger)] bg-[color:var(--color-danger)]/10 px-3 py-2 rounded-lg"
        >
          {serverError}
        </p>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="flex-1 py-3 border-2 border-[color:var(--color-border)] text-[color:var(--color-ink)] rounded-xl font-bold text-base hover:bg-[color:var(--color-bg)] disabled:opacity-50 transition-colors"
        >
          ← Voltar
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold text-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting ? 'Criando…' : 'Criar conta'}
        </button>
      </div>
    </form>
  );
}

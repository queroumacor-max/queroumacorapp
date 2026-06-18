'use client';
// SignupStep3 — senha + termos (invite acontece via link de indicação).
//
// Mudança importante: NÃO existe mais campo de "código de convite QUC-XXXXX".
// Agora o acesso ao app é por convite-via-link: alguém já cadastrado
// compartilha o próprio perfil e o link carrega ?ref=<userId>. O
// ReferralCapture armazena em localStorage e o SignupFlow só permite criar
// conta se houver um ref válido. Sem ref = sem cadastro.
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { strongPasswordSchema } from '@/lib/schemas';

const schema = z.object({
  password: strongPasswordSchema,
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
    watch,
    formState: { errors },
  } = useForm<Step3Data>({
    resolver: zodResolver(schema),
    defaultValues: {
      password: '',
      // consent default omitted on purpose: literal(true) só passa quando
      // o usuário marcar; manter undefined força a validação.
    },
  });

  // O botão NÃO é desabilitado pelo estado do checkbox (antes
  // `disabled={!consented}` ficava travado quando o aceite/senha vinham de
  // autofill/preenchimento programático que não dispara eventos do RHF). O
  // consentimento segue OBRIGATÓRIO via zod (`literal(true)`): sem aceite, o
  // submit é barrado e mostramos a mensagem de erro do consent. Idem senha.
  const passwordValue = watch('password') ?? '';
  const strength = scorePassword(passwordValue);

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
        {passwordValue.length > 0 && (
          <div className="mt-2" aria-live="polite">
            <div className="flex gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="h-1.5 flex-1 rounded-full transition-colors"
                  style={{
                    background:
                      i < strength.level ? strength.color : 'var(--color-border)',
                  }}
                />
              ))}
            </div>
            <p className="text-xs mt-1" style={{ color: strength.color }}>
              Senha {strength.label}
            </p>
          </div>
        )}
        {errors.password && (
          <p className="text-sm text-[color:var(--color-danger)] mt-1">
            {errors.password.message}
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
          {/* Abre em nova aba pra não perder o preenchimento do cadastro
              (navegar na mesma aba reseta o fluxo multi-step). */}
          <a
            href="/info/termos"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--color-p1)] underline font-semibold"
          >
            Termos de Uso
          </a>{' '}
          e a{' '}
          <a
            href="/info/privacidade"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:var(--color-p1)] underline font-semibold"
          >
            Política de Privacidade
          </a>
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

// Mede a força da senha pra dar feedback visual (UX — HIG/qualidade).
// Não altera a regra de validação (mínimo 8 chars segue no schema); é só
// indicador. level 1..4 → quantos segmentos acender.
function scorePassword(pw: string): {
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  color: string;
} {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  // mapeia 0..5 → 1..4 segmentos
  const level = (pw.length === 0 ? 0 : Math.min(4, Math.max(1, score))) as
    | 0
    | 1
    | 2
    | 3
    | 4;
  if (level <= 1) return { level, label: 'fraca', color: 'var(--color-danger)' };
  if (level === 2) return { level, label: 'razoável', color: '#d97706' };
  if (level === 3) return { level, label: 'boa', color: '#ca8a04' };
  return { level, label: 'forte', color: '#16a34a' };
}

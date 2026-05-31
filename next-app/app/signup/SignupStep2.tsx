'use client';
// SignupStep2 — dados básicos (nome, tag, email, telefone). RHF+Zod usando
// schemas centrais (emailSchema, tagSchema, phoneSchema). Tag tem feedback
// debounced via useTagAvailability — só bloqueia o avanço se o hook
// reportar 'taken' (estados 'idle'/'checking'/'available'/'invalid'
// deixam o submit acontecer; 'invalid' é coberto pelo tagSchema da RHF).
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { emailSchema, tagSchema, phoneSchema, requiredField } from '@/lib/schemas';
import { useTagAvailability } from '@/lib/hooks/useTagAvailability';

const schema = z.object({
  name: requiredField('seu nome').refine((v) => !v.includes('@'), {
    message: 'Não use o email como nome',
  }),
  tag: tagSchema,
  email: emailSchema,
  phone: phoneSchema,
});

export type Step2Data = z.infer<typeof schema>;

interface Props {
  initial?: Partial<Step2Data>;
  onNext: (data: Step2Data) => void;
  onBack: () => void;
}

export function SignupStep2({ initial, onNext, onBack }: Props) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Step2Data>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      tag: initial?.tag ?? '',
      email: initial?.email ?? '',
      phone: initial?.phone ?? '',
    },
  });

  const tagValue = watch('tag');
  const tagStatus = useTagAvailability(tagValue);

  function onSubmit(data: Step2Data) {
    if (tagStatus === 'taken') return;
    onNext(data);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <h1
        className="text-2xl font-bold mb-1"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Seus dados
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] -mt-1">
        Preencha as informações básicas
      </p>

      <Field id="name" label="Nome completo" error={errors.name?.message}>
        <input
          id="name"
          type="text"
          autoComplete="name"
          placeholder="Seu nome"
          {...register('name')}
          className={inputClass}
          aria-invalid={errors.name ? 'true' : 'false'}
        />
      </Field>

      <Field id="tag" label="Sua tag única" error={errors.tag?.message}>
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-muted)] font-semibold pointer-events-none"
            aria-hidden="true"
          >
            @
          </span>
          <input
            id="tag"
            type="text"
            autoComplete="username"
            placeholder="seunomedeusuario"
            {...register('tag')}
            className={inputClass + ' pl-8'}
            aria-invalid={errors.tag ? 'true' : 'false'}
          />
        </div>
        {!errors.tag && tagValue && (
          <p
            className={
              'text-xs mt-1 ' +
              (tagStatus === 'available'
                ? 'text-[color:var(--color-p1)]'
                : tagStatus === 'taken'
                  ? 'text-[color:var(--color-danger)]'
                  : 'text-[color:var(--color-muted)]')
            }
            role="status"
            aria-live="polite"
          >
            {tagStatus === 'checking' && 'Verificando disponibilidade...'}
            {tagStatus === 'available' && `@${tagValue} está disponível!`}
            {tagStatus === 'taken' && `@${tagValue} já está em uso.`}
            {tagStatus === 'invalid' && 'Use 3+ caracteres (letras, números, _).'}
          </p>
        )}
      </Field>

      <Field id="email" label="Email" error={errors.email?.message}>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          {...register('email')}
          className={inputClass}
          aria-invalid={errors.email ? 'true' : 'false'}
        />
      </Field>

      <Field id="phone" label="WhatsApp" error={errors.phone?.message}>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="(11) 99999-9999"
          {...register('phone')}
          className={inputClass}
          aria-invalid={errors.phone ? 'true' : 'false'}
        />
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3 border-2 border-[color:var(--color-border)] text-[color:var(--color-ink)] rounded-xl font-bold text-base hover:bg-[color:var(--color-bg)] transition-colors"
        >
          ← Voltar
        </button>
        <button
          type="submit"
          disabled={isSubmitting || tagStatus === 'taken' || tagStatus === 'checking'}
          className="flex-1 py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-bold text-base hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          Continuar →
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'w-full px-4 py-3 text-base bg-[color:var(--color-bg)] border-2 border-transparent focus:border-[color:var(--color-p1)] rounded-xl outline-none transition-colors';

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-semibold mb-1 text-[color:var(--color-ink)]"
      >
        {label}
      </label>
      {children}
      {error && (
        <p className="text-sm text-[color:var(--color-danger)] mt-1">{error}</p>
      )}
    </div>
  );
}

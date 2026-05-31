'use client';
// SignupFlow — orquestrador do multi-step. Estado local com useState (sem
// Context novo): cada step é um form RHF+Zod independente que reporta seu
// dado consolidado via callback `onNext(stepData)`. O motivo de lift de
// estado em vez de Context: só 3 steps, dados pequenos, e a vida do estado
// é exatamente igual à vida do componente. Context aqui seria over-engineering
// (consumers únicos, sem cross-cutting concerns).
//
// Cobre os 3 passos do vanilla:
//  Step 1 → role selector (selectRole/signupNext(2))
//  Step 2 → name/tag/email/phone + check de tag (validateAndGoStep3)
//  Step 3 → senha + invite + termos (doSignup)
//
// Submit final: chama lib/services/signup.signUp e redireciona pra `/`.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signUp } from '@/lib/services/signup';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { UserRole } from '@/lib/types';
import { SignupStep1, type Step1Data } from './SignupStep1';
import { SignupStep2, type Step2Data } from './SignupStep2';
import { SignupStep3, type Step3Data } from './SignupStep3';

type Step = 1 | 2 | 3;

interface DraftSignup {
  userType?: UserRole;
  name?: string;
  tag?: string;
  email?: string;
  phone?: string;
}

export function SignupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<DraftSignup>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleStep1(data: Step1Data) {
    setDraft((d) => ({ ...d, userType: data.userType }));
    setStep(2);
  }

  function handleStep2(data: Step2Data) {
    setDraft((d) => ({
      ...d,
      name: data.name,
      tag: data.tag,
      email: data.email,
      phone: data.phone,
    }));
    setStep(3);
  }

  async function handleStep3(data: Step3Data) {
    setServerError(null);
    setSubmitting(true);
    try {
      if (!draft.userType || !draft.name || !draft.tag || !draft.email || !draft.phone) {
        // Defensivo: usuário não pode chegar no step 3 sem isso, mas guard
        // pra TS narrowing + mensagem amigável se algo der errado.
        setServerError('Volte e preencha os passos anteriores.');
        return;
      }
      await signUp({
        userType: draft.userType,
        name: draft.name,
        tag: draft.tag,
        email: draft.email,
        phone: draft.phone,
        password: data.password,
        inviteCode: data.inviteCode || undefined,
      });
      router.push('/');
      router.refresh();
    } catch (e) {
      if (e instanceof ConflictError) {
        setServerError(e.message);
        // Tag colidiu — manda o usuário voltar pro step 2 escolher outra.
        setStep(2);
      } else if (e instanceof ValidationError) {
        setServerError(e.message);
      } else {
        setServerError('Erro inesperado ao criar conta.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <StepDots current={step} />
      {step === 1 && (
        <SignupStep1
          initialValue={draft.userType}
          onNext={handleStep1}
        />
      )}
      {step === 2 && (
        <SignupStep2
          initial={{
            name: draft.name,
            tag: draft.tag,
            email: draft.email,
            phone: draft.phone,
          }}
          onNext={handleStep2}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <SignupStep3
          submitting={submitting}
          serverError={serverError}
          onSubmit={handleStep3}
          onBack={() => setStep(2)}
        />
      )}
      <p className="text-center text-sm text-[color:var(--color-muted)] pt-6">
        Já tem conta?{' '}
        <Link
          href="/login"
          className="text-[color:var(--color-p1)] font-semibold hover:underline"
        >
          Entrar
        </Link>
      </p>
    </div>
  );
}

function StepDots({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-5" aria-hidden="true">
      {([1, 2, 3] as const).map((s) => (
        <span
          key={s}
          className={
            'h-2 rounded-full transition-all ' +
            (s === current
              ? 'w-6 bg-[color:var(--color-p1)]'
              : 'w-2 bg-[color:var(--color-border)]')
          }
        />
      ))}
    </div>
  );
}

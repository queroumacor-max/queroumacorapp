'use client';
// SignupFlow — orquestrador do multi-step.
//
// Cadastro é ABERTO (sem obrigatoriedade de convite) — requisito das lojas
// Apple/Google pra produção. Se o usuário chegar com `?ref=<userId>` na URL
// (link compartilhado por alguém já cadastrado), o referral ainda é creditado
// como bônus, mas a ausência dele NÃO bloqueia o cadastro.
//
// Steps:
//  Step 1 → role selector
//  Step 2 → name/tag/email/phone
//  Step 3 → senha + termos (sem invite code)
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signUp } from '@/lib/services/signup';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { UserRole } from '@/lib/types';
import { readPendingReferrer, clearPendingReferrer } from '@/components/ReferralCapture';
import { SocialAuthButtons } from '@/components/SocialAuthButtons';
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
  birthDate?: string;
  city?: string;
  state?: string;
  avatarFile?: File | null;
}

export function SignupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<DraftSignup>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Referral (opcional): lido sob demanda via readPendingReferrer() no
  // submit (gravado pelo ReferralCapture quando o link com ?ref=<userId>
  // pousa em qualquer rota). Se vazio, o cadastro segue normalmente — só
  // não credita bônus de indicação.

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
      birthDate: data.birthDate,
      city: data.city,
      state: data.state,
      avatarFile: data.avatarFile ?? null,
    }));
    setStep(3);
  }

  async function handleStep3(data: Step3Data) {
    setServerError(null);
    // Referral é opcional — se houver, credita bônus de indicação; se não,
    // segue o cadastro normalmente (cadastro aberto).
    const ref = readPendingReferrer();
    setSubmitting(true);
    try {
      // WhatsApp é obrigatório só pros profissionais (canal de leads);
      // pro Cliente é opcional (Apple 5.1.1).
      const phoneRequired = draft.userType !== 'cliente';
      if (
        !draft.userType ||
        !draft.name ||
        !draft.tag ||
        !draft.email ||
        (phoneRequired && !draft.phone)
      ) {
        setServerError('Volte e preencha os passos anteriores.');
        return;
      }
      const { userId } = await signUp({
        userType: draft.userType,
        name: draft.name,
        tag: draft.tag,
        email: draft.email,
        phone: draft.phone || '',
        password: data.password,
        birthDate: draft.birthDate || null,
        city: draft.city || null,
        state: draft.state || null,
        referrerId: ref ?? undefined,
        // Avatar é uploaded depois (precisa do userId da conta criada
        // pra usar o path do storage policy `<userId>/<ts>.<ext>`).
      });
      // Upload do avatar pós-signup. Best-effort — falhar não invalida
      // a conta. uploadAvatar atualiza profiles.avatar_url via UPDATE
      // direto (não dá pra concatenar com o UPDATE de signup.ts pq
      // o ID só existe após auth.signUp resolver).
      if (draft.avatarFile && userId) {
        try {
          const { uploadAvatar: doUpload } = await import('@/lib/services/profile');
          const url = await doUpload(userId, draft.avatarFile);
          // updateProfile separado pra setar avatar_url no row do user.
          const { updateProfile } = await import('@/lib/services/profile');
          await updateProfile(userId, { avatar_url: url });
        } catch {
          /* silent — user pode subir depois via /perfil/editar */
        }
      }
      // M2 (LGPD): registra consentimento em consent_log. Best-effort —
      // falha aqui não invalida cadastro (audit trail é secundário ao
      // fluxo principal). Grava 2 linhas: terms + privacy. O checkbox no
      // SignupStep3 é único pra ambos pq Cali Colors trata como mesmo
      // ato; cada linha permite revogação independente depois.
      if (userId) {
        try {
          const { recordConsent } = await import('@/lib/services/consent');
          await Promise.all([
            recordConsent({ userId, consentType: 'terms', consentGiven: true }),
            recordConsent({ userId, consentType: 'privacy', consentGiven: true }),
          ]);
        } catch {
          /* silent */
        }
      }
      // Limpa o referrer salvo + redireciona: pro perfil de quem indicou
      // (se houve convite) ou pro feed (cadastro aberto, sem referral).
      clearPendingReferrer();
      router.push(ref ? `/perfil/${ref}` : '/feed');
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
        <>
          {/* Cadastro rápido com Google/Apple (OAuth). Cria a conta direto e
              volta pra /completar-perfil pra escolher categoria + @tag. Quem
              prefere o fluxo completo por email/senha segue abaixo. */}
          <SocialAuthButtons context="signup" />
          <div className="flex items-center gap-3 py-4" aria-hidden="true">
            <span className="flex-1 h-px bg-[color:var(--color-border)]" />
            <span className="text-xs text-[color:var(--color-muted)]">ou</span>
            <span className="flex-1 h-px bg-[color:var(--color-border)]" />
          </div>
          <SignupStep1 initialValue={draft.userType} onNext={handleStep1} />
        </>
      )}
      {step === 2 && (
        <SignupStep2
          userType={draft.userType}
          initial={{
            name: draft.name,
            tag: draft.tag,
            email: draft.email,
            phone: draft.phone,
            // BUG fix: preservar também data/cidade/estado/foto ao voltar do
            // passo 3 (antes só name/tag/email/phone eram repassados).
            birthDate: draft.birthDate,
            city: draft.city,
            state: draft.state,
            avatarFile: draft.avatarFile,
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

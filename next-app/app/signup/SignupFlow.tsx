'use client';
// SignupFlow — orquestrador do multi-step.
//
// Cadastro AGORA é invite-only via link de indicação. NÃO existe mais
// código manual (QUC-XXXXX). O usuário precisa chegar com `?ref=<userId>`
// na URL (link compartilhado por alguém já cadastrado). Sem ref:
//  - mostra mensagem "convite necessário" no step 1
//  - botão de criar conta no step 3 também bloqueia + repete a mensagem
//
// Steps:
//  Step 1 → role selector
//  Step 2 → name/tag/email/phone
//  Step 3 → senha + termos (sem invite code)
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signUp } from '@/lib/services/signup';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { UserRole } from '@/lib/types';
import { readPendingReferrer, clearPendingReferrer } from '@/components/ReferralCapture';
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
  // Convite: lê do localStorage (gravado pelo ReferralCapture quando o
  // link com ?ref=<userId> pousa em qualquer rota). Se vazio = sem convite.
  const [referrerId, setReferrerId] = useState<string | null>(null);
  useEffect(() => {
    setReferrerId(readPendingReferrer());
  }, []);

  const hasInvite = !!referrerId;

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
    // Re-check do convite no submit (caso o user tenha aberto a aba antes
    // de receber o link — agora deve ter ref ou bloqueia).
    const ref = readPendingReferrer();
    if (!ref) {
      setServerError(
        'Cadastro requer convite. Peça pra alguém já cadastrado compartilhar o perfil dele com você — o link abre o app e libera o cadastro.',
      );
      return;
    }
    setSubmitting(true);
    try {
      if (!draft.userType || !draft.name || !draft.tag || !draft.email || !draft.phone) {
        setServerError('Volte e preencha os passos anteriores.');
        return;
      }
      const { userId } = await signUp({
        userType: draft.userType,
        name: draft.name,
        tag: draft.tag,
        email: draft.email,
        phone: draft.phone,
        password: data.password,
        birthDate: draft.birthDate || null,
        city: draft.city || null,
        state: draft.state || null,
        referrerId: ref,
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
      // Limpa o referrer salvo + redireciona pro perfil de quem indicou.
      clearPendingReferrer();
      router.push(`/perfil/${ref}`);
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
      {!hasInvite ? (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'rgba(255,107,53,.08)',
            border: '1.5px solid rgba(255,107,53,.35)',
            color: 'var(--color-ink)',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          <strong>🔒 Cadastro por convite</strong>
          <br />
          O QueroUmaCor é uma comunidade fechada. Pra criar conta você
          precisa do link de perfil de alguém já cadastrado. Peça pra um
          pintor/cliente que você conhece compartilhar o perfil dele —
          o link já libera o cadastro automaticamente.
        </div>
      ) : null}
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

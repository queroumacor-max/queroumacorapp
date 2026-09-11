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
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signUp } from '@/lib/services/signup';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { UserRole } from '@/lib/types';
import { readPendingReferrer, clearPendingReferrer } from '@/components/ReferralCapture';
import { mensagemDeLimite, preCheckAuthRate } from '@/lib/services/authRateCheck';
import { SocialAuthButtons } from '@/components/SocialAuthButtons';
import { reportFailure } from '@/lib/utils/reportFailure';
import { showToast } from '@/lib/toast';
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

// Rascunho persistido (2026-08-28): no wrapper Android, abrir a galeria pra
// escolher a foto manda o app pro fundo e o sistema pode MATAR o processo —
// ao voltar, a página recarrega e o cadastro inteiro se perdia (o state era
// só memória). O rascunho agora vai pro localStorage (sessionStorage NÃO
// sobrevive à morte do processo na WebView) com validade curta, e é limpo no
// sucesso. A senha NUNCA entra aqui (vive só no form do passo 3); o arquivo
// da foto também não (File não serializa) — só os campos digitados.
const DRAFT_KEY = 'signup_draft_v1';
const DRAFT_TTL_MS = 30 * 60 * 1000; // 30 min

function saveDraft(step: Step, draft: DraftSignup): void {
  try {
    const { avatarFile: _omit, ...rest } = draft;
    window.localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step, draft: rest, savedAt: Date.now() }),
    );
  } catch {
    // storage indisponível — segue só em memória, como antes.
  }
}

function readDraft(): { step: Step; draft: DraftSignup } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      step?: number;
      draft?: DraftSignup;
      savedAt?: number;
    };
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      window.localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    const step: Step = parsed.step === 2 || parsed.step === 3 ? parsed.step : 1;
    return { step, draft: parsed.draft ?? {} };
  } catch {
    return null;
  }
}

export function clearSignupDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignora
  }
}

export function SignupFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<DraftSignup>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Restaura o rascunho salvo (recarga no meio do cadastro — ver comentário
  // do DRAFT_KEY). Em useEffect, não no initializer: o initializer rodaria
  // diferente no server (sem localStorage) e quebraria a hidratação.
  useEffect(() => {
    const saved = readDraft();
    if (saved && (saved.step > 1 || Object.keys(saved.draft).length > 0)) {
      setDraft((d) => ({ ...saved.draft, ...d }));
      setStep(saved.step);
    }
  }, []);

  // Persiste a cada avanço/edição de passo.
  useEffect(() => {
    if (step > 1 || draft.userType) saveDraft(step, draft);
  }, [step, draft]);
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
      // Rate limit por IP (advisory, fail-open) contra criação automatizada
      // de contas pela UI. O limite de verdade é o do Supabase Auth.
      const limite = await preCheckAuthRate('signup');
      if (limite.blocked) {
        setServerError(mensagemDeLimite(limite));
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
        } catch (e) {
          // P4 (01/09/2026): era `catch {}` mudo. A pessoa escolhia a foto no
          // passo 2, o upload falhava e ninguém — nem ela, nem o
          // /admin/errors — ficava sabendo. Enquanto o bug de MIME do
          // seletor do Android esteve vivo, ISTO escondeu a falha em todo
          // cadastro novo. Segue best-effort (não invalida a conta), mas
          // agora deixa rastro e avisa.
          reportFailure('avatar-fail', e, { userId, ctx: 'signup' });
          // Toast e não state: o cadastro redireciona logo em seguida, e o
          // `ToastViewport` vive no layout raiz — então a mensagem sobrevive
          // à navegação e a pessoa sabe que precisa subir a foto depois.
          showToast('Conta criada, mas a foto não subiu. Dá pra colocar em Perfil › Editar.', 'error');
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
        } catch (e) {
          // Trilha de consentimento é secundária ao cadastro, mas some sem
          // deixar rastro — e é registro exigido pela LGPD.
          reportFailure('consent-fail', e, { userId, ctx: 'signup/consent' });
        }
      }
      // Limpa o referrer salvo + o rascunho persistido (dados pessoais não
      // ficam no aparelho depois do sucesso) + redireciona: pro perfil de
      // quem indicou (se houve convite) ou pro feed.
      clearPendingReferrer();
      clearSignupDraft();
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
          onPersist={(parcial) => setDraft((d) => ({ ...d, ...parcial }))}
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

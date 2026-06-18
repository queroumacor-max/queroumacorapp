// AiConsentGate — overlay de consentimento mostrado na primeira vez que o
// usuário abre um assistente de IA (Seu Zé, Alice, Senna, Fê). Bloqueia a
// interação até o aceite; "Agora não" volta pra tela anterior. Depois de
// aceitar uma vez, não aparece mais (persistido em localStorage via
// useAiConsent). Apple Guideline 5.1.1 / transparência LGPD.
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAiConsent } from '@/lib/hooks/useAiConsent';

export function AiConsentGate({ assistantName = 'o assistente' }: { assistantName?: string }) {
  const { accepted, accept } = useAiConsent();
  const router = useRouter();

  // Enquanto lê o storage (accepted === null) ou já aceitou, não renderiza nada.
  if (accepted !== false) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-consent-title"
    >
      <div className="bg-[color:var(--color-white)] rounded-2xl max-w-md w-full p-5 shadow-xl">
        <h2
          id="ai-consent-title"
          className="text-lg font-bold text-[color:var(--color-ink)] mb-1"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          🤖 Antes de usar {assistantName}
        </h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-3 leading-relaxed">
          Este recurso usa inteligência artificial. Para gerar as respostas,
          o que você escrever é enviado em tempo real aos provedores{' '}
          <b>OpenAI</b> e <b>Google</b>.
        </p>
        <ul className="text-sm text-[color:var(--color-ink)] mb-3 space-y-1.5 list-disc pl-5 leading-relaxed">
          <li>
            Seus dados <b>não são usados para treinar</b> modelos do
            QueroUmaCor.
          </li>
          <li>
            <b>Não envie dados sensíveis</b> (CPF, senhas, dados bancários).
          </li>
          <li>O conteúdo gerado é de sua responsabilidade.</li>
        </ul>
        <p className="text-xs text-[color:var(--color-muted)] mb-4">
          Saiba mais no item 6 da{' '}
          <Link
            href="/info/privacidade"
            className="underline"
            style={{ color: 'var(--color-p1)' }}
          >
            Política de Privacidade
          </Link>
          .
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2.5 text-sm font-semibold text-[color:var(--color-ink)] rounded-xl border border-[color:var(--color-border)]"
          >
            Agora não
          </button>
          <button
            type="button"
            onClick={accept}
            className="px-4 py-2.5 text-sm font-bold text-white rounded-xl"
            style={{ background: 'var(--color-p1)' }}
          >
            Concordar e continuar
          </button>
        </div>
      </div>
    </div>
  );
}

// OnboardingModal — tutorial de 5 passos exibido 1x pra novos usuários.
// Steps: Bem-vindo / Feed / Chat / Marketplace / Profile. Estado de
// "visto" persiste em localStorage via useOnboarding (chave
// `onboarding_seen_v1`). Cada step tem ícone grande (emoji pra não
// depender de lib de SVG), título e 1-2 frases curtas explicando.
//
// Botões:
//   - "Pular" (visível em todos os steps exceto o último) → fecha+marca seen
//   - "Próximo" (steps 0..3) → avança índice
//   - "Começar" (step 4) → fecha+marca seen
//
// Acessibilidade: role="dialog" + aria-modal + aria-labelledby; foco vai
// pro botão primário no mount. Esc fecha o modal (dispara dismiss).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnboarding } from '@/lib/hooks/useOnboarding';

interface Step {
  icon: string;
  title: string;
  text: string;
}

// Copy inspirada no `modules/info.js` (tom direto, PT-BR, frases curtas).
// Manter em const fora do componente pra evitar realocação em cada render.
const STEPS: ReadonlyArray<Step> = [
  {
    icon: '👋',
    title: 'Bem-vindo ao QueroUmaCor!',
    text: 'A rede social dos pintores profissionais. Vamos te mostrar o básico em 30 segundos.',
  },
  {
    icon: '📱',
    title: 'Feed',
    text: 'Veja trabalhos de outros pintores, curta, comente e siga quem te inspira. Publique seus próprios projetos.',
  },
  {
    icon: '💬',
    title: 'Chat',
    text: 'Converse com clientes e outros profissionais. Áudio, foto e localização suportados.',
  },
  {
    icon: '🛒',
    title: 'Marketplace',
    text: 'Compre tintas e materiais com desconto profissional na loja Cali Colors integrada.',
  },
  {
    icon: '👤',
    title: 'Perfil',
    text: 'Mostre seu portfólio, suas avaliações e ganhe pontos pra desbloquear PRO. Boa pintura!',
  },
];

export function OnboardingModal() {
  const { show, dismiss } = useOnboarding();
  const [step, setStep] = useState(0);
  const primaryBtnRef = useRef<HTMLButtonElement | null>(null);

  // Foca o botão primário ao abrir e a cada mudança de step pra que
  // teclado/leitor de tela acompanhem. Não usamos focus trap completo —
  // só dois botões, Tab cicla naturalmente.
  useEffect(() => {
    if (show) primaryBtnRef.current?.focus();
  }, [show, step]);

  // Esc fecha o modal (semântica padrão de dialog).
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [show, dismiss]);

  const next = useCallback(() => {
    setStep((s) => (s + 1 < STEPS.length ? s + 1 : s));
  }, []);

  const finish = useCallback(() => {
    dismiss();
    // Reset interno pra que se o componente remontar (improvável dado o
    // localStorage flag) ele comece do zero. Custo zero.
    setStep(0);
  }, [dismiss]);

  if (!show) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl text-center">
        {/* Indicador de progresso (dots). Aria-hidden porque o título e os
            botões já comunicam o passo atual aos leitores de tela. */}
        <div className="flex justify-center gap-1.5 mb-5" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-[color:var(--color-p1,#2563eb)]' : 'w-1.5 bg-[color:var(--color-border)]'
              }`}
            />
          ))}
        </div>

        <div className="text-6xl mb-3" aria-hidden="true">
          {current.icon}
        </div>

        <h2
          id="onboarding-title"
          className="text-xl font-bold mb-2 text-[color:var(--color-ink,#222)]"
        >
          {current.title}
        </h2>

        <p className="text-sm text-[color:var(--color-muted)] mb-6 leading-relaxed">{current.text}</p>

        <div className="flex items-center justify-between gap-3">
          {!isLast ? (
            <button
              type="button"
              onClick={finish}
              className="px-4 py-2 text-sm font-medium text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
            >
              Pular
            </button>
          ) : (
            // Espaçador invisível pra manter alinhamento à direita do botão
            // primário sem mudar o layout entre steps.
            <span aria-hidden="true" />
          )}

          <button
            ref={primaryBtnRef}
            type="button"
            onClick={isLast ? finish : next}
            className="px-6 py-2.5 bg-[color:var(--color-p1,#2563eb)] text-white text-sm font-bold rounded-lg hover:opacity-90"
          >
            {isLast ? 'Começar' : 'Próximo'}
          </button>
        </div>

        <p className="mt-4 text-xs text-[color:var(--color-muted)] opacity-70" aria-hidden="true">
          {step + 1} de {STEPS.length}
        </p>
      </div>
    </div>
  );
}

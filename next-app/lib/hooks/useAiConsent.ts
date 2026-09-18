// useAiConsent — consentimento opt-in antes do primeiro uso dos assistentes de
// IA (Seu Zé, Alice, Senna, Fê). Apple Guideline 5.1.1: o usuário precisa
// consentir explicitamente com o envio de dados a terceiros (OpenAI/Google)
// antes do primeiro uso. A decisão fica em localStorage (instantânea, sem
// round-trip); o aceite também é gravado em consent_log (best-effort, trilha
// LGPD) quando há usuário logado.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

const STORAGE_KEY = 'ai_consent_v1';

export function useAiConsent() {
  const { user } = useAuth();
  // null = ainda não sabemos (SSR/primeiro paint); true/false após ler storage.
  const [accepted, setAccepted] = useState<boolean | null>(null);

  useEffect(() => {
    // Sincroniza com localStorage (sistema externo) — leitura só existe no
    // browser, não é derivável no render/SSR (por isso `accepted` nasce
    // null).
    try {
      setAccepted(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      setAccepted(false);
    }
  }, []);

  // deps: [user?.id], não [user] — `accept` só lê `user.id` (2x abaixo),
  // nunca outro campo. Estreitar de propósito pra `accept` não trocar de
  // identidade quando campos não-relacionados do perfil mudam (nome, foto
  // etc.) — é o que o linter chama de "poderia preservar memoização menos
  // específica", mas widen pra `[user]` seria regressão de performance
  // real no React puro de hoje (o compiler que motivaria isso não está
  // ativo neste projeto).
  const accept = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* storage indisponível — segue só em memória nesta sessão */
    }
    setAccepted(true);
    // Trilha LGPD (best-effort, não bloqueia o fluxo).
    if (user?.id) {
      void (async () => {
        try {
          const { recordConsent } = await import('@/lib/services/consent');
          await recordConsent({
            userId: user.id,
            consentType: 'data_processing',
            consentGiven: true,
          });
        } catch {
          /* silent */
        }
      })();
    }
  }, [user?.id]);

  return { accepted, accept };
}

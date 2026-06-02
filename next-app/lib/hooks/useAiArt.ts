// useAiArt — hook React que centraliza geração de arte IG + créditos diários
// + post no feed via TanStack Query.
//
// Substitui o estado interno de modules/ai-art.js (vanilla):
//   - _aiArtPhotoDataUrl/_aiArtPhotoDataUrl2 → state local do componente
//     que consome o hook (não vale guardar aqui porque é UI state).
//   - _aiArtStyle/_aiArtAspect → idem.
//   - _aiArtResultDataUrl/_aiArtResultCaption → derivado de generateMutation.data.
//   - _aiArtGetUsed/_aiArtIncUsed → expostos via creditsUsed/creditsLeft
//     (lidos do localStorage). incrementCredits roda dentro do service em
//     sucesso pra UI não precisar pensar.
//   - _aiArtPost → postMutation.
//
// Não tem realtime: créditos são per-user-per-dia e mudam só por ação do
// usuário (gerar). UI atualiza creditsUsed via re-fetch trivial (state ticks
// quando generateMutation.isSuccess).

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  generateArt,
  postArtToFeed,
  getDailyCreditsUsed,
  maxCredits,
  DAILY_CREDITS_LIMIT,
  PRO_DAILY_LIMIT,
  type GenerateArtInput,
  type GenerateArtResult,
  type PostArtInput,
  type PostArtResult,
} from '@/lib/services/aiArt';
import { canSeeProFeature, isAdmin } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';

export interface UseAiArtResult {
  // Mutation: gerar arte
  generate: (input: Omit<GenerateArtInput, 'userId'>) => void;
  isGenerating: boolean;
  generateError: Error | null;
  result: GenerateArtResult | null;
  resetResult: () => void;

  // Mutation: postar no feed
  post: (input: Omit<PostArtInput, 'userId'>) => void;
  isPosting: boolean;
  postError: Error | null;
  postResult: PostArtResult | null;

  // Créditos diários (UX espelhando rate-limit do backend)
  creditsUsed: number;
  creditsLeft: number;
  creditsLimit: number;
  isAtLimit: boolean;
}

export function useAiArt(): UseAiArtResult {
  const { user } = useAuth();
  const policyUser = usePolicyUser();
  const userId = user?.id || '';
  const isPro = canSeeProFeature(policyUser);
  const admin = isAdmin(policyUser);
  // Limite efetivo:
  //  - admin: ilimitado (Number.MAX_SAFE_INTEGER pra UI não mostrar "X/2 hoje")
  //  - PRO: 2/dia (incluído na assinatura)
  //  - Free: 5/dia (legado — pacote pago futuro vai zerar isso)
  const effectiveLimit = admin
    ? Number.MAX_SAFE_INTEGER
    : isPro
      ? PRO_DAILY_LIMIT
      : DAILY_CREDITS_LIMIT;

  // tick força re-leitura do localStorage sem virar Context. Bump em sucesso
  // de generate (que incrementa o contador) e em 429 (que zera o restante).
  const [tick, setTick] = useState(0);

  const generateMutation = useMutation<
    GenerateArtResult,
    Error,
    Omit<GenerateArtInput, 'userId'>
  >({
    mutationFn: (input) => generateArt({ ...input, userId }),
    onSuccess: () => setTick((t) => t + 1),
    onError: (err) => {
      // Se o backend devolveu 429 (HTTP 429 vira "HTTP 429" na message do
      // NetworkError), forçamos o contador no máximo pra UI bater no estado
      // "limite atingido" imediatamente — espelha a UX do vanilla.
      const msg = String(err?.message || '');
      if (/429|limite.*atingid|daily limit/i.test(msg) && userId) {
        maxCredits(userId);
        setTick((t) => t + 1);
      }
    },
  });

  const postMutation = useMutation<
    PostArtResult,
    Error,
    Omit<PostArtInput, 'userId'>
  >({
    mutationFn: (input) => postArtToFeed({ ...input, userId }),
  });

  // Re-lê localStorage quando user trocar (multi-conta sem refresh).
  useEffect(() => {
    setTick((t) => t + 1);
  }, [userId]);

  const creditsUsed = userId ? getDailyCreditsUsed(userId) : 0;
  // tick é dependência implícita do read acima — referência abaixo evita
  // o lint sumir com `tick` e quebrar a invalidação de leitura.
  void tick;
  const creditsLeft = Math.max(0, effectiveLimit - creditsUsed);

  const resetResult = useCallback(() => {
    generateMutation.reset();
    postMutation.reset();
  }, [generateMutation, postMutation]);

  return {
    generate: generateMutation.mutate,
    isGenerating: generateMutation.isPending,
    generateError: generateMutation.error ?? null,
    result: generateMutation.data ?? null,
    resetResult,

    post: postMutation.mutate,
    isPosting: postMutation.isPending,
    postError: postMutation.error ?? null,
    postResult: postMutation.data ?? null,

    creditsUsed,
    creditsLeft,
    creditsLimit: effectiveLimit,
    isAtLimit: creditsLeft === 0,
  };
}

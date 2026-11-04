// usePublishPost — a mesma publicação de `executarPublicacao`, como mutation
// do React Query (pra quem precisa esperar o resultado na própria tela). O
// Composer usa a publicação em SEGUNDO PLANO (`lib/publicacaoFila.ts`); este
// hook fica pra chamadas que querem o resultado ali mesmo.

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import type { CreatePostResult } from '@/lib/services/posts';
import { hapticNotify } from '@/lib/native';
import { reportFailure } from '@/lib/utils/reportFailure';
import { executarPublicacao, type PublishPostInput } from '@/lib/services/publicarPost';

export type { PublishPostInput } from '@/lib/services/publicarPost';

export interface UsePublishPostResult {
  publish: (input: PublishPostInput) => void;
  publishAsync: (input: PublishPostInput) => Promise<CreatePostResult>;
  isPending: boolean;
  error: Error | null;
  reset: () => void;
}

export function usePublishPost(): UsePublishPostResult {
  const { user, emailVerified } = useAuth();
  const qc = useQueryClient();

  const mutation = useMutation<CreatePostResult, Error, PublishPostInput>({
    mutationFn: (input: PublishPostInput) =>
      executarPublicacao(input, { userId: user?.id, emailVerified }),
    // A falha de publicar só existia na faixa vermelha do Composer: se a
    // pessoa não transcrevesse a mensagem, ninguém aqui ficava sabendo.
    onError: (err) => {
      reportFailure('publish-fail', err, { userId: user?.id, ctx: 'composer' });
    },
    onSuccess: () => {
      // Vibração de conclusão (no-op fora da casca nativa).
      hapticNotify('success');
      // Invalida feed (lista pública) + perfil do usuário (lista própria).
      // Sem `await`: invalidação é fire-and-forget, próximo render busca.
      qc.invalidateQueries({ queryKey: ['feed'] });
      qc.invalidateQueries({ queryKey: ['profile-posts', user?.id] });
    },
  });

  return {
    publish: mutation.mutate,
    publishAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error ?? null,
    reset: mutation.reset,
  };
}

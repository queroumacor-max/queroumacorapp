// usePublishPost — hook que orquestra o fluxo completo de publicação:
// (1) upload de cada mídia selecionada → URLs públicas
// (2) insert da linha em `posts`
// (3) invalida cache do feed pra forçar refetch
//
// Implementado como useMutation única (em vez de splittar upload e insert):
// o caller só precisa saber "publicando? sim/não" e "erro? qual"; orquestração
// fica encapsulada aqui. Se algum upload falhar no meio, propaga o erro
// (NetworkError/ValidationError) — não tenta rollback automático dos uploads
// já feitos (storage barato, vira lixo que admin job pode limpar; mais
// importante é entregar feedback rápido).

'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  uploadMedia,
  createPost,
  readImageDimensions,
  type CreatePostMediaType,
  type CreatePostResult,
} from '@/lib/services/posts';
import { AuthenticationError, ValidationError } from '@/lib/errors';

export interface PublishPostInput {
  files: File[];                 // já validados pelo componente
  caption: string;
  mediaType: CreatePostMediaType;
  forSale?: boolean;
  price?: number | null;
  artType?: string | null;
  // S5: CTA "ver mais" pra story. Só usado quando mediaType='story'.
  linkUrl?: string | null;
}

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
    mutationFn: async (input: PublishPostInput) => {
      if (!user) throw new AuthenticationError('Faça login para publicar.');
      if (emailVerified === false) {
        throw new AuthenticationError(
          'Confirme seu email antes de publicar (link enviado no cadastro).',
        );
      }
      // Mídia obrigatória (defesa em profundidade — a UI já barra no Composer,
      // mas garantimos aqui pra NUNCA criar post só-texto no feed). BUG15.
      if (!input.files || input.files.length === 0) {
        throw new ValidationError(
          'Selecione pelo menos uma foto ou vídeo para publicar.',
        );
      }
      // Upload sequencial (não paralelo) pra mostrar progresso previsível
      // e não saturar conexão móvel. Pra 1-5 arquivos pequenos a diferença
      // de latência é irrelevante.
      const urls: string[] = [];
      // W/H da primeira imagem (Wave 17): só captura pra image; vídeo
      // segue null e o frontend usa aspect-ratio CSS como hoje.
      let firstWidth: number | null = null;
      let firstHeight: number | null = null;
      if (input.files[0] && input.mediaType !== 'video') {
        const dims = await readImageDimensions(input.files[0]);
        if (dims) {
          firstWidth = dims.width;
          firstHeight = dims.height;
        }
      }
      // Wave 29 (C4): SHA-256 da primeira mídia. uploadMedia calcula e
      // retorna o hash junto da URL; só persistimos o da primeira mídia
      // (paridade com mediaWidth/Height).
      let firstHash: string | null = null;
      for (let i = 0; i < input.files.length; i++) {
        const { url, mediaHash } = await uploadMedia(user.id, input.files[i]);
        urls.push(url);
        if (i === 0 && mediaHash) firstHash = mediaHash;
      }
      return createPost({
        userId: user.id,
        caption: input.caption || null,
        mediaUrls: urls,
        mediaType: input.mediaType,
        mediaWidth: firstWidth,
        mediaHeight: firstHeight,
        mediaHash: firstHash,
        forSale: input.forSale,
        price: input.price ?? null,
        artType: input.artType ?? null,
        linkUrl: input.linkUrl ?? null,
      });
    },
    onSuccess: () => {
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

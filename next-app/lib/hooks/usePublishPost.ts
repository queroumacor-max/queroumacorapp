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
  aprovarPostNoServidor,
  readImageDimensions,
  compressImage,
  COMPRESS_THRESHOLD,
  type CreatePostMediaType,
  type CreatePostResult,
} from '@/lib/services/posts';
import { getMediaType } from '@/lib/utils';
import { enquadrarImagem } from '@/lib/services/enquadrarImagem';
import { DESLOCAMENTO_CENTRO, type Enquadramento } from '@/lib/enquadramento';
import { AuthenticationError, ValidationError } from '@/lib/errors';
import { hapticNotify } from '@/lib/native';
import { reportFailure } from '@/lib/utils/reportFailure';
import { deletePost } from '@/lib/services/postInteractions';

export interface PublishPostInput {
  files: File[];                 // já validados pelo componente
  caption: string;
  mediaType: CreatePostMediaType;
  forSale?: boolean;
  price?: number | null;
  artType?: string | null;
  // S5: CTA "ver mais" pra story. Só usado quando mediaType='story'.
  linkUrl?: string | null;
  // Proporção/recorte escolhidos no composer (2026-09-07). Ausente ou
  // 'original' = a foto sobe como está.
  enquadramento?: Enquadramento;
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
      // COMPRESSÃO ANTES DO UPLOAD (2026-09-04). O "Gerar legenda" já
      // comprimia acima de COMPRESS_THRESHOLD; PUBLICAR subia o arquivo CRU.
      // Mesma foto, dois tratamentos, dependendo do botão — e desde a Onda B
      // a câmera NATIVA (quality 90, resolução cheia) virou o caminho
      // principal, então "cru" passou a significar 5-12 MB. O sintoma era
      // gerar a legenda com sucesso (arquivo pequeno) e o "Postar" logo
      // depois morrer com "Failed to fetch" (o upload grande caindo na rede
      // móvel dentro da WebView).
      //
      // Falha ao comprimir NÃO impede publicar: HEIC que a WebView não
      // decodifica pelo <img> rejeitaria aqui, e hoje esse arquivo sobe cru
      // sem problema. Na dúvida, o original.
      //
      // ENQUADRAMENTO (2026-09-07) vem ANTES da compressão: a pessoa escolheu
      // um quadro na tela e o arquivo tem que sair com ele. Aqui a regra é
      // diferente da compressão: se o recorte falhar, NÃO sobe cru em
      // silêncio — publicar a obra cortada no meio depois de a pessoa ter
      // enquadrado é trair a escolha dela. Estoura com o nome do arquivo.
      const enq = input.enquadramento;
      const recortar = !!enq && enq.proporcao !== 'original' && input.mediaType === 'image';
      const paraSubir: File[] = [];
      for (let i = 0; i < input.files.length; i++) {
        let f = input.files[i];
        if (input.mediaType === 'video' || getMediaType(f) === 'video') {
          paraSubir.push(f);
          continue;
        }
        if (recortar && enq) {
          try {
            f = await enquadrarImagem(f, {
              proporcao: enq.proporcao,
              modo: enq.modo,
              deslocamento: enq.deslocamentos[i] ?? DESLOCAMENTO_CENTRO,
            });
          } catch (e) {
            throw new ValidationError(
              `Não foi possível enquadrar "${f.name || `foto ${i + 1}`}". ` +
                'Escolha "Original" ou selecione a foto de novo.',
              e,
            );
          }
        }
        if (f.size <= COMPRESS_THRESHOLD) {
          paraSubir.push(f);
          continue;
        }
        try {
          paraSubir.push(await compressImage(f));
        } catch {
          paraSubir.push(f);
        }
      }

      // Upload sequencial (não paralelo) pra mostrar progresso previsível
      // e não saturar conexão móvel. Pra 1-5 arquivos pequenos a diferença
      // de latência é irrelevante.
      const urls: string[] = [];
      // W/H da primeira imagem (Wave 17): só captura pra image; vídeo
      // segue null e o frontend usa aspect-ratio CSS como hoje.
      // Lidas do arquivo QUE VAI SUBIR, não do original — comprimir muda as
      // dimensões, e gravar as do original reservaria o espaço errado no
      // feed (o salto de layout que a Wave 17 existe pra matar).
      let firstWidth: number | null = null;
      let firstHeight: number | null = null;
      if (paraSubir[0] && input.mediaType !== 'video') {
        const dims = await readImageDimensions(paraSubir[0]);
        if (dims) {
          firstWidth = dims.width;
          firstHeight = dims.height;
        }
      }
      // Wave 29 (C4): SHA-256 da primeira mídia. uploadMedia calcula e
      // retorna o hash junto da URL; só persistimos o da primeira mídia
      // (paridade com mediaWidth/Height).
      let firstHash: string | null = null;
      for (let i = 0; i < paraSubir.length; i++) {
        const { url, mediaHash } = await uploadMedia(user.id, paraSubir[i]);
        urls.push(url);
        if (i === 0 && mediaHash) firstHash = mediaHash;
      }

      const post = await createPost({
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

      // MODERAÇÃO NO SERVIDOR (2026-09-26). O post nasce `pending` —
      // invisível pra todo mundo menos o dono — e quem o publica é
      // /api/posts/approve, que relê o post do banco, confere o hash de CADA
      // mídia contra a blocklist e roda o Gemini (foto ou vídeo). Antes a
      // moderação era orquestrada AQUI, no cliente: quem gravasse direto na
      // API com o próprio token publicava sem passar por nada.
      //
      // Se a aprovação não sair (reprovado, limite, rede), o post pendente é
      // apagado: ele nunca apareceu pra ninguém, e deixá-lo ali só criaria um
      // fantasma no perfil da pessoa. Reprovado o servidor já retirou.
      if (post?.id) {
        try {
          await aprovarPostNoServidor(post.id);
        } catch (e) {
          await deletePost(user.id, post.id).catch(() => {});
          throw e;
        }
      }

      return post;
    },
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

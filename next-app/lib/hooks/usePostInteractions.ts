// usePostInteractions — hooks React que casam o service postInteractions com
// TanStack Query, com mutations otimistas onde fizer sentido (like, save).
//
// Mapeamento vanilla → React:
//   - togglePostLike (UI flip imediato + insert/delete) → useLike com
//     onMutate (snapshot + flip otimista) + onError (rollback) + onSettled
//     (invalidate pra reconciliar). Mesma "sensação" de UI imediata, sem o
//     bug do flip ficar fora de sync se o DB falhar.
//   - submitComment + dataset._loading guard → useComments.add usa
//     mutation.isPending pro caller desabilitar o button. Otimismo NÃO é
//     aplicado em comentários (a row precisa do id do servidor pra render).
//   - toggleSavePost → useSavedPosts.toggle (mesmo pattern do like).
//   - Events.post.liked (vanilla bus) → onSuccess invalidate da queryKey
//     ['notifications', userId] pra que o sininho refresque sem extra listener.
//
// Hooks NÃO encapsulam UI/toast — caller decide (PostActions chama toast em
// onSuccess/onError). Isso mantém hooks reutilizáveis em qualquer surface.

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  addComment,
  countLikes,
  deleteComment as deleteCommentSvc,
  deletePost as deletePostSvc,
  fetchComments,
  fetchSaved,
  hasLiked,
  reportPost as reportPostSvc,
  softDeleteComment as softDeleteCommentSvc,
  toggleCommentLike as toggleCommentLikeSvc,
  toggleLike as toggleLikeSvc,
  toggleSave as toggleSaveSvc,
  undoDeleteComment as undoDeleteCommentSvc,
  undoDeletePost as undoDeletePostSvc,
  type PostComment,
  type ReportReason,
  type SavedPostRow,
  type SoftDeleteResult,
} from '@/lib/services/postInteractions';

// ─── useLike ───────────────────────────────────────────────────────────────

export interface UseLikeResult {
  liked: boolean;
  count: number;
  toggle: () => void;
  loading: boolean;
  isPending: boolean;
  error: Error | null;
}

interface LikeSnapshot {
  liked: boolean;
  count: number;
}

/**
 * Hook do botão "curtir". Hidrata estado inicial em paralelo (hasLiked + count)
 * via useQuery; toggle usa mutation otimista com rollback em caso de erro.
 *
 * `initialData` (opcional): quando o caller já tem `{liked, count}` em mãos
 * (ex.: FeedPost que veio do RPC `get_feed_v2` ou enrichment do feed legacy),
 * usa como cache inicial pra pular o fetch separado de hasLiked+countLikes.
 * O useQuery só refetcha quando staleTime expira — economiza 2 round-trips
 * por card visível no feed.
 */
export function useLike(postId: string, initialData?: LikeSnapshot): UseLikeResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const key = ['post-like', postId, userId];

  const query = useQuery<LikeSnapshot, Error>({
    queryKey: key,
    queryFn: async () => {
      const [liked, count] = await Promise.all([
        hasLiked(userId, postId),
        countLikes(postId),
      ]);
      return { liked, count };
    },
    enabled: !!postId,
    staleTime: 30_000,
    initialData,
  });

  const mutation = useMutation<
    { liked: boolean; count: number },
    Error,
    void,
    { prev: LikeSnapshot | undefined }
  >({
    mutationFn: () => toggleLikeSvc(userId, postId),
    onMutate: async () => {
      // Cancela queries in-flight pra evitar race com refetch.
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<LikeSnapshot>(key);
      // Flip otimista — se prev existir, usa pra calcular novo count.
      if (prev) {
        const nextLiked = !prev.liked;
        const delta = nextLiked ? 1 : -1;
        qc.setQueryData<LikeSnapshot>(key, {
          liked: nextLiked,
          count: Math.max(0, prev.count + delta),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      // Rollback ao snapshot pré-mutate.
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (data) => {
      qc.setQueryData<LikeSnapshot>(key, data);
      // Bus equivalent: ao curtir, notif do autor pode ser inserida pelo
      // trigger → invalida o sininho pra refresh.
      if (userId) qc.invalidateQueries({ queryKey: ['notifications', userId] });
    },
    onSettled: () => {
      // Garante que cache reflita o servidor mesmo se o server retornou
      // count diferente do otimista (ex.: outros usuários curtiram no meio).
      qc.invalidateQueries({ queryKey: key });
    },
  });

  return {
    liked: query.data?.liked ?? false,
    count: query.data?.count ?? 0,
    toggle: () => {
      if (!userId) return; // no-op sem auth — caller mostra "login pra curtir"
      mutation.mutate();
    },
    loading: query.isLoading,
    isPending: mutation.isPending,
    error: query.error ?? mutation.error ?? null,
  };
}

// ─── useComments ───────────────────────────────────────────────────────────

export interface UseCommentsResult {
  comments: PostComment[];
  loading: boolean;
  error: Error | null;
  /** Adiciona comentário. `parentId` preenchido = resposta a outro comentário. */
  add: (text: string, parentId?: string | null) => Promise<PostComment>;
  remove: (commentId: string) => Promise<void>;
  /** Toggle de curtida (pincel) num comentário, com otimismo no cache. */
  likeComment: (commentId: string) => void;
  isAdding: boolean;
  isRemoving: boolean;
}

/**
 * Hook da lista de comentários. add/remove são mutateAsync (Promise) pra que
 * o caller possa await no submit e fechar input/limpar campo só depois do
 * sucesso. Não usa otimismo — a row depende do id gerado pelo servidor.
 *
 * `initialData` (opcional): quando o caller já tem os top-N comments em mãos
 * (ex.: FeedPost.comments do RPC `get_feed_v2`), usa como cache inicial pra
 * pular o fetchComments inicial. O useQuery só refetcha quando staleTime
 * expira — economiza 1 round-trip por card visível.
 */
export function useComments(postId: string, initialData?: PostComment[]): UseCommentsResult {
  const { user, emailVerified } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';
  const key = ['post-comments', postId];

  const query = useQuery<PostComment[], Error>({
    queryKey: key,
    queryFn: () => fetchComments(postId, userId),
    enabled: !!postId,
    staleTime: 30_000,
    initialData,
  });

  const addMut = useMutation<
    PostComment,
    Error,
    { text: string; parentId?: string | null },
    {
      previous: PostComment[] | undefined;
      tempId: string;
      optimisticAuthor: { name: string | null; tag: string | null; avatar_url: string | null };
    }
  >({
    mutationFn: ({ text, parentId }) => {
      if (emailVerified === false) {
        return Promise.reject(
          new Error('Confirme seu email antes de comentar.'),
        );
      }
      return addComment(userId, postId, text, parentId ?? null);
    },
    // Otimista: append de comment temporário pra UI atualizar na hora.
    // Reconciliação no onSuccess troca o temp pelo row real do servidor.
    //
    // Autor preenchido a partir do user_metadata (name/tag/avatar gravados no
    // signup) pra o comment já renderizar com o nome certo — e, crucialmente,
    // pra ele NÃO depender do refetch pra existir. Antes o autor vinha null e
    // o `onSettled` refazia `fetchComments`; se esse refetch voltasse sem o
    // comment (read-back atrasado / RLS), o otimista era descartado em
    // silêncio: texto sumia, nada aparecia, sem erro (BUG-01).
    onMutate: async ({ text, parentId }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PostComment[]>(key);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const meta = (user?.user_metadata ?? {}) as {
        name?: string | null;
        tag?: string | null;
        avatar_url?: string | null;
      };
      const optimisticAuthor = {
        name: meta.name ?? null,
        tag: meta.tag ?? null,
        avatar_url: meta.avatar_url ?? null,
      };
      const temp: PostComment = {
        id: tempId,
        post_id: postId,
        user_id: userId,
        text,
        parent_id: parentId ?? null,
        like_count: 0,
        liked_by_me: false,
        created_at: new Date().toISOString(),
        author: optimisticAuthor,
      };
      qc.setQueryData<PostComment[]>(key, (old) => [...(old ?? []), temp]);
      return { previous, tempId, optimisticAuthor };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (real, _vars, ctx) => {
      // Troca temp pelo row real, preservando o autor otimista quando o row
      // do INSERT não trouxe author (o service só seleciona campos crus).
      const merged: PostComment = real.author
        ? real
        : { ...real, author: ctx?.optimisticAuthor ?? null };
      qc.setQueryData<PostComment[]>(key, (old) =>
        (old ?? []).map((c) => (c.id === ctx?.tempId ? merged : c)),
      );
    },
    onSettled: async (real, _err, _vars, ctx) => {
      // Reconcilia com o banco (autor via JOIN, id real). Mas blinda contra o
      // drop silencioso: se o refetch voltar SEM o comment recém-criado
      // (lag de read-back / RLS), reinsere o otimista pra não sumir sem aviso.
      await qc.invalidateQueries({ queryKey: key });
      if (!real) return;
      const after = qc.getQueryData<PostComment[]>(key) ?? [];
      const hasReal = after.some((c) => c.id === real.id);
      const hasTemp = ctx?.tempId
        ? after.some((c) => c.id === ctx.tempId)
        : false;
      if (!hasReal && !hasTemp) {
        const merged: PostComment = real.author
          ? real
          : { ...real, author: ctx?.optimisticAuthor ?? null };
        qc.setQueryData<PostComment[]>(key, [...after, merged]);
      }
    },
  });

  // Remove com otimismo: tira o comment da UI imediatamente; rollback se
  // RLS bloquear (sem permissão) ou rede cair. Antes era invalidate-only,
  // então quando o DELETE silenciosamente afetava 0 rows (RLS), o refetch
  // devolvia o comment de volta sem feedback — UI parecia ignorar o clique.
  const removeMut = useMutation<void, Error, string, { previous: PostComment[] | undefined }>({
    mutationFn: (commentId: string) => deleteCommentSvc(commentId, userId),
    onMutate: async (commentId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PostComment[]>(key);
      qc.setQueryData<PostComment[]>(key, (old) =>
        (old ?? []).filter((c) => c.id !== commentId),
      );
      return { previous };
    },
    onError: (_err, _commentId, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  // Curtir comentário (pincel). Otimismo direto no cache da lista: flip de
  // liked_by_me + ajuste de like_count, com rollback no erro. Espelha o
  // toggle do post mas operando sobre o array de comments.
  const likeMut = useMutation<
    { liked: boolean; count: number },
    Error,
    string,
    { previous: PostComment[] | undefined }
  >({
    mutationFn: (commentId: string) => toggleCommentLikeSvc(userId, commentId),
    onMutate: async (commentId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PostComment[]>(key);
      qc.setQueryData<PostComment[]>(key, (old) =>
        (old ?? []).map((c) => {
          if (c.id !== commentId) return c;
          const nowLiked = !c.liked_by_me;
          return {
            ...c,
            liked_by_me: nowLiked,
            like_count: Math.max(0, (c.like_count ?? 0) + (nowLiked ? 1 : -1)),
          };
        }),
      );
      return { previous };
    },
    onError: (_err, _commentId, ctx) => {
      if (ctx?.previous !== undefined) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (data, commentId) => {
      // Reconcilia com a contagem autoritativa do servidor.
      qc.setQueryData<PostComment[]>(key, (old) =>
        (old ?? []).map((c) =>
          c.id === commentId
            ? { ...c, liked_by_me: data.liked, like_count: data.count }
            : c,
        ),
      );
    },
  });

  return {
    comments: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    add: (text: string, parentId?: string | null) =>
      addMut.mutateAsync({ text, parentId }),
    remove: removeMut.mutateAsync,
    likeComment: (commentId: string) => {
      if (!userId || !commentId) return;
      likeMut.mutate(commentId);
    },
    isAdding: addMut.isPending,
    isRemoving: removeMut.isPending,
  };
}

// ─── useSavedPosts ─────────────────────────────────────────────────────────

export interface UseSavedPostsResult {
  saved: SavedPostRow[];
  loading: boolean;
  error: Error | null;
  isSaved: (postId: string) => boolean;
  toggle: (postId: string) => void;
  isToggling: boolean;
}

/**
 * Hook da lista de posts salvos. `isSaved(postId)` deriva do array em memória
 * (O(n) por chamada — ok pra listas pequenas; se ficar grande, podemos
 * memoizar num Set). `toggle` usa otimismo: adiciona/remove do array antes
 * do fetch resolver, com rollback.
 */
export function useSavedPosts(userIdParam?: string): UseSavedPostsResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = userIdParam ?? user?.id ?? '';
  const key = ['saved-posts', userId];

  const query = useQuery<SavedPostRow[], Error>({
    queryKey: key,
    queryFn: () => fetchSaved(userId),
    enabled: !!userId,
    staleTime: 60_000,
  });

  const toggleMut = useMutation<
    { saved: boolean },
    Error,
    string,
    { prev: SavedPostRow[] | undefined }
  >({
    mutationFn: (postId: string) => toggleSaveSvc(userId, postId),
    onMutate: async (postId: string) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<SavedPostRow[]>(key);
      if (prev) {
        const exists = prev.some((r) => r.post_id === postId);
        const next = exists
          ? prev.filter((r) => r.post_id !== postId)
          : [
              ...prev,
              // row placeholder — id real vem no invalidate, mas pra UI
              // já é suficiente saber que o post está na lista.
              {
                id: `optimistic-${postId}`,
                user_id: userId,
                post_id: postId,
                created_at: new Date().toISOString(),
              },
            ];
        qc.setQueryData<SavedPostRow[]>(key, next);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const saved = query.data ?? [];
  const isSaved = (postId: string) => saved.some((r) => r.post_id === postId);

  return {
    saved,
    loading: query.isLoading,
    error: query.error ?? null,
    isSaved,
    toggle: (postId: string) => {
      if (!userId || !postId) return;
      toggleMut.mutate(postId);
    },
    isToggling: toggleMut.isPending,
  };
}

// ─── useReportPost ─────────────────────────────────────────────────────────

export interface UseReportPostResult {
  // reason aceita string livre — o ReportModal concatena detalhes no
  // formato "<reason>: <details>", então o type não fecha em ReportReason.
  report: (postId: string, reason: ReportReason | string, targetUserId?: string | null) => Promise<void>;
  isReporting: boolean;
  error: Error | null;
}

/**
 * Hook auxiliar pro ReportModal — mantém mutation simples (sem cache) pra
 * facilitar disabled-while-pending no botão "Enviar". Não invalida nada
 * (reports não são lidos pelo cliente, só pelo painel admin).
 */
export function useReportPost(): UseReportPostResult {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const mut = useMutation<
    void,
    Error,
    { postId: string; reason: ReportReason | string; targetUserId?: string | null }
  >({
    mutationFn: ({ postId, reason, targetUserId }) =>
      reportPostSvc(userId, postId, reason, targetUserId ?? null),
  });

  return {
    report: (postId, reason, targetUserId) =>
      mut.mutateAsync({ postId, reason, targetUserId }),
    isReporting: mut.isPending,
    error: mut.error ?? null,
  };
}

// ─── useDeletePost (soft delete + undo) ────────────────────────────────────

export interface UseDeletePostResult {
  /** Soft-deleta o post. Retorna {undoToken} pra o caller passar pro undo. */
  remove: (postId: string) => Promise<SoftDeleteResult>;
  /** Restaura post soft-deletado. */
  undo: (postId: string) => Promise<void>;
  isDeleting: boolean;
  isUndoing: boolean;
  error: Error | null;
}

/**
 * Hook do "deletar post" (soft delete). Substitui o hard delete anterior:
 * marca `deleted_at = now()` no banco, retorna `undoToken` pro caller
 * mostrar a UndoSnackbar e — se o usuário clicar "Desfazer" — invoca
 * `undo(postId)` que limpa o `deleted_at`.
 *
 * Invalida `posts`/`feed` no onSuccess de remove e undo — listas em
 * cache precisam refetchar pra sumir/voltar a card.
 */
export function useDeletePost(): UseDeletePostResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const removeMut = useMutation<SoftDeleteResult, Error, string>({
    mutationFn: (postId: string) => deletePostSvc(userId, postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  const undoMut = useMutation<void, Error, string>({
    mutationFn: (postId: string) => undoDeletePostSvc(userId, postId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['posts'] });
      qc.invalidateQueries({ queryKey: ['feed'] });
    },
  });

  return {
    remove: removeMut.mutateAsync,
    undo: undoMut.mutateAsync,
    isDeleting: removeMut.isPending,
    isUndoing: undoMut.isPending,
    error: removeMut.error ?? undoMut.error ?? null,
  };
}

// ─── useDeleteComment (soft delete + undo) ─────────────────────────────────

export interface UseDeleteCommentResult {
  remove: (commentId: string, postId: string) => Promise<SoftDeleteResult>;
  undo: (commentId: string, postId: string) => Promise<void>;
  /** Variante hard delete (mantida pra callers que ainda querem irreversível). */
  removeHard: (commentId: string) => Promise<void>;
  isDeleting: boolean;
  isUndoing: boolean;
  error: Error | null;
}

/**
 * Hook do "deletar comment" (soft delete + undo). O hard delete original
 * fica exposto como `removeHard` pra que callers que não querem o fluxo
 * de undo (ex.: deletar comment alheio pelo admin do post) ainda possam
 * usar.
 *
 * Toda mutation invalida ['post-comments', postId] — quem tem a lista
 * renderizada vê o comment sumir / voltar.
 */
export function useDeleteComment(): UseDeleteCommentResult {
  const { user } = useAuth();
  const qc = useQueryClient();
  const userId = user?.id ?? '';

  const removeMut = useMutation<
    SoftDeleteResult,
    Error,
    { commentId: string; postId: string }
  >({
    mutationFn: ({ commentId }) => softDeleteCommentSvc(commentId, userId),
    onSuccess: (_data, { postId }) => {
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
    },
  });

  const undoMut = useMutation<
    void,
    Error,
    { commentId: string; postId: string }
  >({
    mutationFn: ({ commentId }) => undoDeleteCommentSvc(commentId, userId),
    onSuccess: (_data, { postId }) => {
      qc.invalidateQueries({ queryKey: ['post-comments', postId] });
    },
  });

  const hardMut = useMutation<void, Error, string>({
    mutationFn: (commentId: string) => deleteCommentSvc(commentId, userId),
  });

  return {
    remove: (commentId, postId) => removeMut.mutateAsync({ commentId, postId }),
    undo: (commentId, postId) => undoMut.mutateAsync({ commentId, postId }),
    removeHard: hardMut.mutateAsync,
    isDeleting: removeMut.isPending,
    isUndoing: undoMut.isPending,
    error: removeMut.error ?? undoMut.error ?? null,
  };
}

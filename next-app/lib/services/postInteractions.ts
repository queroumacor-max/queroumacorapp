// postInteractions.ts — service layer das interações sociais sobre posts:
// curtir, comentar, salvar, denunciar, deletar. Espelha o subset do vanilla
// (modules/feed-interactions.js) sem a parte DOM/UI — só I/O puro contra o
// Supabase, com types inline porque o shape difere de lib/types.ts (em
// particular, `comments.text`, NÃO `comments.body`, e `reports` exige tripla
// reporter/post/reason).
//
// Schema relevante (supabase_init.sql):
//   - likes: id, user_id, post_id, created_at; UNIQUE(user_id, post_id)
//   - comments: id, post_id, user_id, text (NOT NULL), created_at
//   - saved_posts: id, user_id, post_id, created_at; UNIQUE(user_id, post_id)
//   - reports: id, reporter_id, post_id, target_user_id?, reason (NOT NULL),
//     status DEFAULT 'pending', created_at
//
// Convenções:
//   - Funções idempotentes (toggleLike/toggleSave) consultam estado atual e
//     fazem delete OR insert (delete-or-insert), evitando depender de UPSERT
//     no caller. Retornam o novo estado (`liked: boolean`) pra UI usar em
//     onSuccess sem precisar refetchar a contagem inteira.
//   - Funções de leitura retornam [] / 0 em ausência de IDs (mesma convenção
//     dos outros services do projeto) — caller que tem optional chaining
//     na queryKey não precisa de guard extra.
//   - Erros sobem como NetworkError com message do Supabase. Casos "no-op"
//     (ID vazio) NÃO estouram — só short-circuit.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

// Types inline (em vez de importar do types.ts) — o shape do `Comment` em
// types.ts usa `body`, mas o schema real do banco é `text`. Em vez de mexer
// no type global (que pode ser usado em outro contexto), declaramos local.

export interface PostComment {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
  // Autor — vem do JOIN com profiles em fetchComments. Pode faltar quando o
  // INSERT ainda não passou pela query com join (otimista). UI cai pra "Usuário".
  author?: {
    name?: string | null;
    tag?: string | null;
    avatar_url?: string | null;
  } | null;
}

export interface SavedPostRow {
  id: string;
  user_id: string;
  post_id: string;
  created_at: string;
}

// `reason` é text livre no banco mas a UI restringe ao conjunto canônico.
// Closed-set: o ReportModal só oferece esses 5 valores; se em algum momento
// precisarmos aceitar arbitrário, basta voltar `| (string & {})` aqui sem
// quebrar o downstream (já tipado com este alias).
export type ReportReason =
  | 'spam'
  | 'ofensivo'
  | 'violencia'
  | 'desinformacao'
  | 'outros';

// ─── LIKES ─────────────────────────────────────────────────────────────────

/**
 * Toggle idempotente de like. Consulta estado atual via select+maybeSingle e
 * decide entre delete/insert. Retorna o novo estado (`liked: boolean`) e a
 * contagem total atualizada — UI usa em onSuccess pra reconciliar otimismo
 * sem precisar refetchar.
 *
 * Race possível: dois clicks rápidos em sequência podem rodar dois "select
 * → insert" e o segundo insert quebrar no UNIQUE(user_id,post_id). Tratamos
 * o `23505` (unique violation) como sucesso silencioso pra blindar o caller
 * que já está usando mutation otimista (a UI já refletiu, banco recusou
 * idempotentemente — sem erro do ponto de vista do produto).
 */
export async function toggleLike(
  userId: string,
  postId: string,
): Promise<{ liked: boolean; count: number }> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!postId) throw new ValidationError('postId obrigatório');

  const sb = getSupabase();
  // Estado atual: existe linha (user,post)?
  const { data: existing, error: selErr } = await sb
    .from('likes')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (selErr) throw new NetworkError(selErr.message, selErr);

  let liked: boolean;
  if (existing) {
    const { error } = await sb
      .from('likes')
      .delete()
      .eq('user_id', userId)
      .eq('post_id', postId);
    if (error) throw new NetworkError(error.message, error);
    liked = false;
  } else {
    const { error } = await sb
      .from('likes')
      .insert({ user_id: userId, post_id: postId });
    // 23505 (PG unique_violation) = corrida entre dois inserts; trata como
    // sucesso (a linha existe → o usuário curtiu → estado final correto).
    if (error && (error as { code?: string }).code !== '23505') {
      throw new NetworkError(error.message, error);
    }
    liked = true;
  }
  const count = await countLikes(postId);
  return { liked, count };
}

/**
 * Lista os user_ids que curtiram um post. Útil pra mostrar "X e Y curtiram".
 */
export async function fetchLikes(postId: string): Promise<string[]> {
  if (!postId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('likes')
    .select('user_id')
    .eq('post_id', postId);
  if (error) throw new NetworkError(error.message, error);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}

/**
 * Conta likes do post via `count: 'exact', head: true` — não traz rows,
 * só o número. Bem mais barato que `select('id')` + length.
 */
export async function countLikes(postId: string): Promise<number> {
  if (!postId) return 0;
  const sb = getSupabase();
  const { count, error } = await sb
    .from('likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  if (error) throw new NetworkError(error.message, error);
  return count ?? 0;
}

/**
 * Verifica se um usuário já curtiu um post. Usado em useLike pra hidratar o
 * estado inicial sem precisar fazer dois fetches em paralelo no caller.
 */
export async function hasLiked(userId: string, postId: string): Promise<boolean> {
  if (!userId || !postId) return false;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('likes')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw new NetworkError(error.message, error);
  return !!data;
}

// ─── COMMENTS ──────────────────────────────────────────────────────────────

/**
 * Insere comentário. Texto trimado e validado: vazio → ValidationError (o
 * caller já valida via Zod ou button-disabled, mas guard defensivo evita
 * que rows vazias entrem no banco). Retorna a row completa pra UI poder
 * appendar otimisticamente sem refetch.
 */
export async function addComment(
  userId: string,
  postId: string,
  text: string,
): Promise<PostComment> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!postId) throw new ValidationError('postId obrigatório');
  const trimmed = (text || '').trim();
  if (!trimmed) throw new ValidationError('Comentário vazio');

  const sb = getSupabase();
  // Pegadinha resolvida (jun/2026): o .insert(...).select().single() estava
  // retornando data=null em alguns casos (RLS de SELECT recursivo durante
  // o RETURNING do PostgREST), e a checagem `if (!data) throw` rollbackava
  // o comment otimista da UI silenciosamente. Resultado pro user: comment
  // aparecia 1 frame e sumia, sem feedback.
  //
  // Fix: separa INSERT (autoritativo) de SELECT-de-leitura (best-effort).
  // Se INSERT passou e SELECT falhou, devolve objeto reconstruído com id
  // gerado client-side temp — o invalidateQueries do hook vai refetch e
  // resolver pro id real do banco.
  const { data, error } = await sb
    .from('comments')
    .insert({ post_id: postId, user_id: userId, text: trimmed })
    .select('id, post_id, user_id, text, created_at')
    .single();
  if (error) throw new NetworkError(error.message, error);
  if (data) return data as PostComment;
  // INSERT ok, SELECT vazio — devolve placeholder que o refetch substitui.
  return {
    id: `pending-${Date.now()}`,
    post_id: postId,
    user_id: userId,
    text: trimmed,
    created_at: new Date().toISOString(),
  } as PostComment;
}

/**
 * Deleta comentário. RLS no banco restringe a (a) dono do comment, (b) dono
 * do post (policy "Post owners can delete comments"), (c) admin via policy
 * "Admins can delete any comment" (SQL Wave 9). userId é exigido só pra
 * forçar o caller a estar autenticado.
 *
 * Pegadinha resolvida (jun/2026): antes era `.delete().eq('id', ...)` sem
 * verificar quantas rows foram afetadas. Se RLS bloqueava (e.g., user não é
 * dono nem do comment nem do post e SQL Wave 9 ainda não foi rodada),
 * Supabase devolvia "sucesso com 0 rows" e a UI achava que apagou. Agora
 * pedimos count='exact' e throw se nada foi apagado — caller vê toast.
 */
export async function deleteComment(
  commentId: string,
  userId: string,
): Promise<void> {
  if (!commentId) throw new ValidationError('commentId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');
  const sb = getSupabase();
  // .select('id') depois do delete: PostgREST devolve o array das rows
  // afetadas. Array vazio = nada deletado (RLS bloqueou ou id inexistente).
  // Antes era count: 'exact' mas em alguns builds do supabase-js o count
  // vinha undefined mesmo no sucesso, dando falso positivo de "sem permissão".
  const { data, error } = await sb
    .from('comments')
    .delete()
    .eq('id', commentId)
    .select('id');
  if (error) throw new NetworkError(error.message, error);
  if (!data || data.length === 0) {
    throw new NetworkError(
      'Sem permissão pra apagar este comentário (não é seu nem do seu post)',
    );
  }
}

/**
 * Atualiza o texto (caption) de um post existente. RLS garante que só
 * o dono (`auth.uid() = user_id`) consegue updatear. O filtro `.eq('user_id', userId)`
 * é defesa em profundidade.
 */
export async function updatePostCaption(
  postId: string,
  userId: string,
  caption: string,
): Promise<void> {
  if (!postId) throw new ValidationError('postId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');
  const trimmed = (caption ?? '').trim();
  const sb = getSupabase();
  const { error } = await sb
    .from('posts')
    .update({ caption: trimmed || null })
    .eq('id', postId)
    .eq('user_id', userId);
  if (error) throw new NetworkError(error.message, error);
}

/**
 * Lista comentários de um post, mais antigos primeiro (estilo IG/FB).
 */
export async function fetchComments(postId: string): Promise<PostComment[]> {
  if (!postId) return [];
  const sb = getSupabase();
  // 2-step em vez de JOIN: PostgREST embedded resource via `profiles!user_id`
  // estava silenciosamente devolvendo null em prod (FK não no cache do
  // PostgREST). Fazemos select dos comments + select dos perfis dos autores
  // separado — 2 round-trips mas resultado consistente.
  const { data, error } = await sb
    .from('comments')
    .select('id, post_id, user_id, text, created_at')
    .eq('post_id', postId)
    .is('deleted_at', null) // Wave 8 soft-delete: esconde apagados.
    .order('created_at', { ascending: true });
  if (error) throw new NetworkError(error.message, error);
  const rows = (data ?? []) as Array<{
    id: string;
    post_id: string | null;
    user_id: string | null;
    text: string;
    created_at: string | null;
  }>;
  const authorIds = [...new Set(rows.map((r) => r.user_id).filter((u): u is string => !!u))];
  let authors: Record<string, { name?: string | null; tag?: string | null; avatar_url?: string | null }> = {};
  if (authorIds.length > 0) {
    const { data: profs } = await sb
      .from('profiles_public')
      .select('id, name, tag, avatar_url')
      .in('id', authorIds);
    for (const p of (profs ?? []) as Array<{ id: string | null; name: string | null; tag: string | null; avatar_url: string | null }>) {
      if (p.id) authors[p.id] = { name: p.name, tag: p.tag, avatar_url: p.avatar_url };
    }
  }
  return rows.map((r) => ({
    id: r.id,
    post_id: r.post_id ?? '',
    user_id: r.user_id ?? '',
    text: r.text,
    created_at: r.created_at ?? '',
    author: r.user_id ? authors[r.user_id] ?? null : null,
  })) as PostComment[];
}

// ─── SAVED POSTS ───────────────────────────────────────────────────────────

/**
 * Toggle idempotente do "salvar post". Mesmo pattern do toggleLike — select
 * → delete-or-insert, com 23505 swallow no insert. Retorna novo estado.
 */
export async function toggleSave(
  userId: string,
  postId: string,
): Promise<{ saved: boolean }> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!postId) throw new ValidationError('postId obrigatório');

  const sb = getSupabase();
  const { data: existing, error: selErr } = await sb
    .from('saved_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (selErr) throw new NetworkError(selErr.message, selErr);

  if (existing) {
    const { error } = await sb
      .from('saved_posts')
      .delete()
      .eq('user_id', userId)
      .eq('post_id', postId);
    if (error) throw new NetworkError(error.message, error);
    return { saved: false };
  }
  const { error } = await sb
    .from('saved_posts')
    .insert({ user_id: userId, post_id: postId });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new NetworkError(error.message, error);
  }
  return { saved: true };
}

/**
 * Lista os posts salvos por um usuário (rows da tabela, não posts hidratados —
 * o caller faz join se precisar de caption/media via select('post_id, posts(*)')).
 */
export async function fetchSaved(userId: string): Promise<SavedPostRow[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('saved_posts')
    .select('id, user_id, post_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new NetworkError(error.message, error);
  return (data ?? []) as SavedPostRow[];
}

/**
 * Verifica se um usuário salvou um post (hidrata estado inicial em useSavedPosts).
 */
export async function hasSaved(userId: string, postId: string): Promise<boolean> {
  if (!userId || !postId) return false;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('saved_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw new NetworkError(error.message, error);
  return !!data;
}

// ─── REPORTS ───────────────────────────────────────────────────────────────

/**
 * Insere denúncia. `reason` é obrigatório (NOT NULL no schema). `targetUserId`
 * é opcional — o vanilla preenche quando consegue, deixa null quando não.
 * Não fazemos dedupe (mesmo report 2x não é bug do server — RLS aceita;
 * dedupe vivia no frontend via flag _reportSubmitting).
 *
 * `reason` aceita `ReportReason` literal ou `string` livre — o ReportModal
 * concatena detalhes no formato `"<reason>: <details>"` antes de chamar.
 */
export async function reportPost(
  reporterId: string,
  postId: string,
  reason: ReportReason | string,
  targetUserId?: string | null,
): Promise<void> {
  if (!reporterId) throw new ValidationError('reporterId obrigatório');
  if (!postId) throw new ValidationError('postId obrigatório');
  const trimmedReason = (reason || '').trim();
  if (!trimmedReason) throw new ValidationError('Motivo obrigatório');

  const sb = getSupabase();
  const { error } = await sb.from('reports').insert({
    reporter_id: reporterId,
    post_id: postId,
    target_user_id: targetUserId ?? null,
    reason: trimmedReason,
  });
  if (error) throw new NetworkError(error.message, error);
}

// ─── DELETE POST (soft delete + undo) ──────────────────────────────────────

/**
 * Resultado do soft-delete. `undoToken` é o `postId` propriamente (a UI passa
 * de volta pro `undoDeletePost`), mas envelopamos num objeto pra reservar
 * espaço futuro (ex.: timestamp de quando a snackbar expira, lista de
 * relacionados que precisam ser desfeitos juntos).
 */
export interface SoftDeleteResult {
  undoToken: string;
}

/**
 * Soft delete: marca `posts.deleted_at = now()` em vez de remover a row.
 *
 * Por que mudou (era hard delete antes):
 *  - UX#5 do BACKLOG: usuário acidentalmente deleta post → snackbar com
 *    "Desfazer" (10s) → undoDeletePost restaura.
 *  - Banco#13: hard delete vira UPDATE; cleanup_soft_deleted() roda hard
 *    delete só depois de 30 dias (cron / manual admin).
 *
 * Likes/comments/saved_posts NÃO são tocados aqui — a RLS atualizada esconde
 * o post de queries normais (deleted_at IS NULL), e os relacionamentos
 * ficam intactos pra que undoDeletePost restaure tudo de uma vez. O CASCADE
 * de FK só dispara no hard delete (cleanup), aí limpa tudo de uma vez.
 *
 * O filtro `eq('user_id', userId)` no UPDATE garante que só o dono possa
 * soft-deletar — mesmo que RLS seja afrouxada no futuro.
 */
export async function deletePost(
  userId: string,
  postId: string,
): Promise<SoftDeleteResult> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!postId) throw new ValidationError('postId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('posts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', postId)
    .eq('user_id', userId);
  if (error) throw new NetworkError(error.message, error);
  return { undoToken: postId };
}

/**
 * Reverte soft delete: limpa `deleted_at`. Idempotente (chamar 2x não
 * estoura erro). Retorna void — o caller já sabe qual postId restaurou.
 */
export async function undoDeletePost(
  userId: string,
  postId: string,
): Promise<void> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!postId) throw new ValidationError('postId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('posts')
    .update({ deleted_at: null })
    .eq('id', postId)
    .eq('user_id', userId);
  if (error) throw new NetworkError(error.message, error);
}

// ─── DELETE COMMENT (soft delete + undo) ───────────────────────────────────

/**
 * Soft delete de comment. Substitui o hard delete anterior (DELETE FROM
 * comments WHERE id = ?). RLS de SELECT esconde comments soft-deleted dos
 * outros usuários — owner + admin ainda enxergam.
 *
 * NÃO usa eq('user_id') no filter porque a policy original permitia ao dono
 * do post deletar comments alheios. Mantemos esse comportamento — quem tem
 * permissão de UPDATE (via RLS) consegue soft-deletar.
 */
export async function softDeleteComment(
  commentId: string,
  userId: string,
): Promise<SoftDeleteResult> {
  if (!commentId) throw new ValidationError('commentId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) throw new NetworkError(error.message, error);
  return { undoToken: commentId };
}

/**
 * Reverte soft delete de comment. Idempotente.
 */
export async function undoDeleteComment(
  commentId: string,
  userId: string,
): Promise<void> {
  if (!commentId) throw new ValidationError('commentId obrigatório');
  if (!userId) throw new ValidationError('userId obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('comments')
    .update({ deleted_at: null })
    .eq('id', commentId);
  if (error) throw new NetworkError(error.message, error);
}

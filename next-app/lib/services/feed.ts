// feed.ts — service layer da timeline principal (estilo Instagram).
// Porta as funções `loadFeed`/`loadPosts`/`fetchPublicProfiles` de
// /modules/feed.js do vanilla pra um shape isolado, testável e sem DOM.
//
// O que NÃO foi portado:
//   - paintFeedFromCache / scheduleFeedCacheSave: o TanStack Query no
//     componente já provê stale-while-revalidate nativo (com staleTime). A
//     camada manual de localStorage cache do vanilla virou redundante.
//   - observeFeedVideos / toggleFeedVideoMute: viram um hook React no
//     componente (useFeedVideoObserver) — não pertencem à camada de dados.
//   - _feedRoleFilter: state local no componente FeedView; passado como
//     `roleFilter` em fetchFeed pra filtrar no client side.
//   - getFollowingIds com cache: vira `useFollowing` hook (TanStack query
//     com staleTime de 5min).
//   - skeleton/retry UI: responsabilidade do componente, não do service.
//
// Decisões:
//   - fetchFeed faz Wave A (posts + perfis) e Wave B (likes/comments/saves)
//     numa única chamada — TanStack Query cuida do streaming pra UI; não
//     precisamos do paint progressivo do vanilla porque a query bloqueia
//     numa promise só. Se virar gargalo, dá pra split em duas queries
//     coordenadas via dependent queries.
//   - PostStatus: filtra `approved` ou NULL (compat com posts pré-moderação)
//     no service; idêntico ao vanilla DB.posts.getFeedPosts.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';
import { DB } from '@/lib/db';
import type { Post, Profile, UserRole } from '@/lib/types';

// ─── tipos inline (TS strict — exportados pra os hooks/componente) ───────

// Comentário enriquecido com o `text` cru do banco (schema usa coluna `text`,
// não `body` como o type Comment de types.ts). Mantemos formato dedicado pro
// feed pra não acoplar ao type Comment legado (que vai ser revisto à parte).
export interface FeedComment {
  id: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: string;
}

// Post enriquecido — espelha o shape que o vanilla passava pro buildFeedPostHTML:
//   - profile do autor já resolvido (ou {} se o perfil sumiu);
//   - flags `liked`/`saved` pré-computadas pro user atual;
//   - `likeCount` agregado (contagem total de likes do post);
//   - `comments` carregados (limite ~5 por post no vanilla; aqui sem limite
//     por enquanto — paginar depois quando virar custo).
export interface FeedPost extends Post {
  profile: Profile;
  liked: boolean;
  saved: boolean;
  likeCount: number;
  comments: FeedComment[];
}

export interface FetchFeedParams {
  // userId logado — opcional pra suportar feed público (não logado vê todos).
  userId?: string | null;
  offset?: number;
  limit?: number;
  // Filtro por role do autor (pintor/grafiteiro/automotivo). Vazio = todos.
  // No vanilla era client-side (filterFeedPosts no DOM); aqui sobe pro
  // fetch pra a paginação respeitar o filtro (evita carregar 30 posts e
  // mostrar 2). Filtro é aplicado APÓS o fetch (porque role mora em
  // profiles, não em posts — server filter ia exigir join custoso).
  roleFilter?: UserRole | string | null;
  // Se true, restringe aos posts dos `feedIds` (seguindo + o próprio user).
  // Se false/undefined, lista posts globais — usado em "Descobrir" no
  // futuro. Por enquanto sempre true no caller (FeedView).
  followingOnly?: boolean;
}

// Limite default — bate com FEED_PAGE = 30 do vanilla (modules/feed.js linha 22).
const FEED_PAGE_DEFAULT = 30;

// Cap defensivo — protege contra caller passar limit gigante que estourasse
// payload Supabase (default request size: 10MB). 100 é confortável.
const FEED_PAGE_MAX = 100;

// ─── fetchPublicProfiles ──────────────────────────────────────────────────
// Port literal do helper de modules/feed.js linhas 59-73. DB.profiles.getMany
// já faz exatamente isso (view → fallback profiles), então delegamos. Mantemos
// a função exportada porque o spec pede ela na lista de entregas e porque
// algum caller futuro pode usar sem precisar montar feed.

export async function fetchPublicProfiles(ids: string[]): Promise<Profile[]> {
  if (!ids || ids.length === 0) return [];
  return DB.profiles.getMany(ids);
}

// ─── fetchFeed ────────────────────────────────────────────────────────────
// Equivalente ao trio `loadFeed → loadPosts → enrich` do vanilla, mas como
// uma função única e pura (sem DOM, sem caches manuais, sem stories — stories
// têm sua própria página/feature). Devolve posts já enriquecidos com profile,
// liked, saved, likeCount e comments — pronto pra renderizar.

export async function fetchFeed(params: FetchFeedParams = {}): Promise<FeedPost[]> {
  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(
    Math.max(1, params.limit ?? FEED_PAGE_DEFAULT),
    FEED_PAGE_MAX,
  );
  const userId = params.userId ?? null;
  const roleFilter = params.roleFilter ?? null;
  const followingOnly = params.followingOnly ?? false;

  // Wave A: posts crus. DB.posts.getFeedPosts já lida com:
  //   - filtro media_type != 'story',
  //   - status = approved OR NULL (compat pré-moderação),
  //   - paginação por range(offset, offset+limit-1),
  //   - feedIds vazio = lista global.
  let feedIds: string[] = [];
  if (followingOnly && userId) {
    // Lista de quem o user segue + o próprio user (mesma lógica de
    // getFollowingIds do vanilla — inclui o próprio user pra ver os
    // próprios posts no feed).
    const following = await DB.follows.listFollowingIds(userId);
    feedIds = [...following, userId];
  }

  const postsRes = await DB.posts.getFeedPosts({
    feedIds,
    offset,
    limit,
  });
  if (postsRes.error) {
    throw new NetworkError(postsRes.error.message || 'Falha ao carregar feed', postsRes.error);
  }
  const posts = postsRes.data ?? [];
  if (posts.length === 0) return [];

  const userIds = [...new Set(posts.map((p) => p.user_id))];
  const postIds = posts.map((p) => p.id);

  // Wave B: perfis + likes (mine + total) + saved + comments em paralelo.
  // O vanilla fazia em duas waves (paint progressivo); aqui retornamos tudo
  // junto porque a UI espera a promise resolver — TanStack Query gerencia
  // o loading state. Se algum subset travar a UX, dá pra dividir em queries
  // dependentes depois.
  const sb = getSupabase();

  const profilesP = fetchPublicProfiles(userIds);
  const commentsP = sb
    .from('comments')
    .select('id, post_id, user_id, text, created_at')
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  const allLikesP = sb.from('likes').select('post_id').in('post_id', postIds);
  const myLikesP = userId
    ? sb.from('likes').select('post_id').eq('user_id', userId).in('post_id', postIds)
    : Promise.resolve({ data: [] as Array<{ post_id: string }>, error: null });
  const savedP = userId
    ? sb
        .from('saved_posts')
        .select('post_id')
        .eq('user_id', userId)
        .in('post_id', postIds)
    : Promise.resolve({ data: [] as Array<{ post_id: string }>, error: null });

  const [profiles, commentsRes, allLikesRes, myLikesRes, savedRes] = await Promise.all([
    profilesP,
    commentsP,
    allLikesP,
    myLikesP,
    savedP,
  ]);

  // Erro em sub-fetches é degradação graciosa: vanilla também ignora (segue
  // sem essa fatia em vez de quebrar o feed). Logamos via NetworkError só se
  // a fetch principal estourou — aqui ficam silenciosos.
  const commentsArr = (commentsRes.data ?? []) as FeedComment[];
  const allLikesArr = (allLikesRes.data ?? []) as Array<{ post_id: string }>;
  const myLikesArr = (myLikesRes.data ?? []) as Array<{ post_id: string }>;
  const savedArr = (savedRes.data ?? []) as Array<{ post_id: string }>;

  // Resolve perfis de autores de comentários que ainda não foram carregados
  // (autor de comment != autor de post). Mesma lógica do vanilla
  // (modules/feed.js linha 628). Sem isso, comment aparece como "Usuário".
  const commentUserIds = [
    ...new Set(commentsArr.map((c) => c.user_id).filter((id) => !userIds.includes(id))),
  ];
  let commentProfiles: Profile[] = [];
  if (commentUserIds.length > 0) {
    commentProfiles = await fetchPublicProfiles(commentUserIds);
  }
  const profMap = new Map<string, Profile>();
  for (const p of profiles) profMap.set(p.id, p);
  for (const p of commentProfiles) profMap.set(p.id, p);

  // Indexa likes/saved em sets pra lookup O(1) por post.
  const mySet = new Set(myLikesArr.map((l) => l.post_id));
  const savedSet = new Set(savedArr.map((l) => l.post_id));
  const likeCounts = new Map<string, number>();
  for (const l of allLikesArr) {
    likeCounts.set(l.post_id, (likeCounts.get(l.post_id) ?? 0) + 1);
  }
  // Bucketiza comments por post — mantém a ordem original (created_at asc).
  const commentsByPost = new Map<string, FeedComment[]>();
  for (const c of commentsArr) {
    const list = commentsByPost.get(c.post_id);
    if (list) list.push(c);
    else commentsByPost.set(c.post_id, [c]);
  }

  // Enriquece + (opcional) filtra por role do autor.
  const enriched: FeedPost[] = posts.map((p) => {
    const profile = profMap.get(p.user_id) ?? ({ id: p.user_id } as Profile);
    return {
      ...p,
      profile,
      liked: mySet.has(p.id),
      saved: savedSet.has(p.id),
      likeCount: likeCounts.get(p.id) ?? 0,
      comments: commentsByPost.get(p.id) ?? [],
    };
  });

  if (roleFilter) {
    const role = String(roleFilter).toLowerCase();
    return enriched.filter((p) => String(p.profile.role ?? '').toLowerCase() === role);
  }
  return enriched;
}

// Re-exporta a constante de page size pra o hook usar como pageSize default.
export const FEED_PAGE_SIZE = FEED_PAGE_DEFAULT;

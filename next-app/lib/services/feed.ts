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
  // Autor — vem do JOIN com profiles. Optional pra cobrir comments antigos
  // ou perfis deletados. PostCard cai pra "Usuário" quando ausente.
  author?: {
    name?: string | null;
    tag?: string | null;
    avatar_url?: string | null;
  } | null;
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
  // offset legado — mantido pra back-compat com callers antigos; cursor é
  // preferido. Se ambos vierem, cursor ganha.
  offset?: number;
  limit?: number;
  // Cursor de keyset pagination: ISO timestamp da última row da página
  // anterior. .lt('created_at', cursor) devolve a próxima janela sem shift
  // quando posts novos entram entre páginas (vs offset, que duplicaria/pula).
  // Performance: O(log n) com index em created_at vs O(n) do offset.
  cursor?: string | null;
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
  // signal pra abortar fetches em voo quando o componente desmonta ou a
  // query é invalidada (TanStack `useQuery({signal})` propaga aqui).
  signal?: AbortSignal;
}

// Página de feed retornada por fetchFeed — shape de cursor pagination.
//   - items: posts enriquecidos da página atual;
//   - nextCursor: created_at da última row (ou null se chegou no fim);
//   - hasMore: true se a página veio cheia (provável próxima existe).
// Caller (useInfiniteQuery) lê nextCursor pra próxima fetch.
export interface FeedPage {
  items: FeedPost[];
  nextCursor: string | null;
  hasMore: boolean;
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

// fetchFeedV2: tenta a RPC `get_feed_v2` (SQL Wave 16). Devolve null em
// qualquer erro pro caller cair no caminho legado. Mapeia o jsonb agregado
// da RPC pra FeedPost. Vantagem: 1 round-trip em vez de 5 (post + perfis +
// likes + saves + comments).
async function fetchFeedV2(params: FetchFeedParams): Promise<FeedPage | null> {
  const limit = Math.min(
    Math.max(1, params.limit ?? FEED_PAGE_DEFAULT),
    FEED_PAGE_MAX,
  );
  const userId = params.userId ?? null;
  const cursor = params.cursor ?? null;
  const followingOnly = params.followingOnly ?? false;
  const roleFilter = params.roleFilter ?? null;
  const signal = params.signal;

  // followingOnly precisa da lista de IDs — mesma lógica do caminho legado.
  let followingIds: string[] | null = null;
  if (followingOnly && userId) {
    const following = await DB.follows.listFollowingIds(userId);
    followingIds = [...following, userId];
  }

  const sb = getSupabase();
  // Cast: a RPC `get_feed_v2` foi criada manualmente no DB (Wave 16) e ainda
  // não está no schema TS gerado. Quando rodar `supabase gen types`, dá
  // pra remover o cast.
  const rpcAny = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => { abortSignal?: (s: AbortSignal) => unknown };
  const builder = rpcAny('get_feed_v2', {
    p_limit: limit,
    p_cursor: cursor,
    p_user_id: userId,
    p_following_ids: followingIds,
    p_role_filter: roleFilter ? String(roleFilter).toLowerCase() : null,
  });
  const withSignalRpc = signal && builder.abortSignal
    ? (builder.abortSignal(signal) as unknown as PromiseLike<{ data: unknown; error: { message: string } | null }>)
    : (builder as unknown as PromiseLike<{ data: unknown; error: { message: string } | null }>);

  const { data, error } = await withSignalRpc;
  if (error) {
    // Sinaliza pro caller cair pro legacy. Loga pra Sentry capturar
    // como breadcrumb — quando Sentry estiver carregado (browser).
    // eslint-disable-next-line no-console
    console.warn('[feed] get_feed_v2 falhou, fallback legacy:', error.message);
    addFeedBreadcrumb('rpc_error', { error: error.message });
    return null;
  }
  if (!Array.isArray(data)) return null;

  type RpcRow = {
    post_id: string;
    user_id: string;
    caption: string | null;
    media_url: string | null;
    media_type: string | null;
    media_width: number | null;
    media_height: number | null;
    created_at: string;
    boosted_until: string | null;
    author: Record<string, unknown> | null;
    like_count: number | string;
    comment_count: number | string;
    liked_by_me: boolean;
    saved_by_me: boolean;
    top_comments: Array<{
      id: string;
      user_id: string;
      text: string;
      created_at: string;
      author: { id?: string; name?: string | null; tag?: string | null; avatar_url?: string | null } | null;
    }> | null;
  };

  const rows = data as RpcRow[];
  const items: FeedPost[] = rows.map((r) => {
    const authorObj = (r.author ?? {}) as Record<string, unknown>;
    const profile: Profile = {
      id: r.user_id,
      name: (authorObj.name as string | null | undefined) ?? null,
      avatar_url: (authorObj.avatar_url as string | null | undefined) ?? null,
      role: (authorObj.role as Profile['role']) ?? undefined,
      is_pro: (authorObj.is_pro as boolean | undefined) ?? undefined,
      city: (authorObj.city as string | null | undefined) ?? null,
      state: (authorObj.state as string | null | undefined) ?? null,
      // tag mora fora do shape Profile estrito (vem do JSON da RPC); cast
      // mínimo via index signature.
      ...(authorObj.tag ? { tag: authorObj.tag as string } : {}),
    } as Profile;
    const comments: FeedComment[] = (r.top_comments ?? []).map((c) => ({
      id: c.id,
      post_id: r.post_id,
      user_id: c.user_id,
      text: c.text,
      created_at: c.created_at,
      author: c.author
        ? {
            name: c.author.name ?? null,
            tag: c.author.tag ?? null,
            avatar_url: c.author.avatar_url ?? null,
          }
        : null,
    }));
    return {
      id: r.post_id,
      user_id: r.user_id,
      caption: r.caption,
      media_url: r.media_url,
      media_type: (r.media_type ?? null) as Post['media_type'],
      media_width: r.media_width ?? null,
      media_height: r.media_height ?? null,
      created_at: r.created_at,
      boosted_until: r.boosted_until ?? null,
      profile,
      liked: !!r.liked_by_me,
      saved: !!r.saved_by_me,
      likeCount: Number(r.like_count ?? 0),
      comments,
    };
  });

  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow?.created_at ?? null;
  const hasMore = rows.length >= limit;
  addFeedBreadcrumb('rpc_ok', { rows: rows.length });
  return { items, nextCursor, hasMore };
}

// Breadcrumb pro Sentry — fica como rastro em qualquer erro futuro e
// também aparece em Performance traces. Não joga error pra não poluir
// Issues do Sentry. Silent quando @sentry/nextjs não carregou (SSR/test).
async function addFeedBreadcrumb(
  category: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.addBreadcrumb({
      category: `feed.${category}`,
      level: category === 'rpc_error' ? 'warning' : 'info',
      data,
    });
  } catch {
    // Sentry não carregou (build sem DSN, ou import quebrado) — ignora.
  }
}

export async function fetchFeed(params: FetchFeedParams = {}): Promise<FeedPage> {
  // Tenta RPC primeiro (Sprint 1.5). Em qualquer falha, cai pro caminho
  // legado abaixo — proteção contra regressão se a RPC ainda não existir
  // no DB ou se schema mudar.
  const v2 = await fetchFeedV2(params).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[feed] get_feed_v2 throw, fallback legacy:', e);
    addFeedBreadcrumb('rpc_throw', { error: String(e) });
    return null;
  });
  if (v2) return v2;

  const offset = Math.max(0, params.offset ?? 0);
  const limit = Math.min(
    Math.max(1, params.limit ?? FEED_PAGE_DEFAULT),
    FEED_PAGE_MAX,
  );
  const userId = params.userId ?? null;
  const roleFilter = params.roleFilter ?? null;
  const followingOnly = params.followingOnly ?? false;
  const cursor = params.cursor ?? null;
  const signal = params.signal;

  // Wave A: posts crus. DB.posts.getFeedPosts já lida com:
  //   - filtro media_type != 'story',
  //   - status = approved OR NULL (compat pré-moderação),
  //   - cursor (.lt('created_at', cursor)) ou offset legado,
  //   - feedIds vazio = lista global,
  //   - abortSignal pra cancel quando query desmonta/invalida.
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
    cursor,
    signal,
  });
  if (postsRes.error) {
    throw new NetworkError(postsRes.error.message || 'Falha ao carregar feed', postsRes.error);
  }
  const posts = postsRes.data ?? [];
  if (posts.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const userIds = [...new Set(posts.map((p) => p.user_id))];
  const postIds = posts.map((p) => p.id);

  // Wave B: perfis + likes (mine + total) + saved + comments em paralelo.
  // O vanilla fazia em duas waves (paint progressivo); aqui retornamos tudo
  // junto porque a UI espera a promise resolver — TanStack Query gerencia
  // o loading state. Se algum subset travar a UX, dá pra dividir em queries
  // dependentes depois.
  const sb = getSupabase();

  // Helper: propaga `signal` pro PostgrestBuilder via `.abortSignal()`. A
  // tipagem é tardia em alguns builds do supabase-js, então passamos por
  // unknown — runtime suporta sempre que > 2.0.
  const withSignal = <Q>(q: Q): Q => {
    if (!signal) return q;
    return (q as unknown as { abortSignal: (s: AbortSignal) => Q }).abortSignal(signal);
  };

  const profilesP = fetchPublicProfiles(userIds);
  // Comments SEM JOIN. A tentativa anterior `author:profiles!user_id(...)`
  // falhava em prod (FK não no PostgREST cache → author vinha null), e mesmo
  // o fallback dependia disso. Agora carregamos só os campos raw e enriquecemos
  // 100% via profMap depois (que já busca commenters via commentUserIds —
  // mesma lógica do vanilla, robusto e independente de FK).
  // Cap defensivo de 200 comments por wave (típico: 10 posts × 5 comments
  // visíveis no card = 50; 200 cobre posts populares sem catástrofe de payload).
  // Posts com mais comments têm o resto carregado on-demand no /post/[id].
  // Ordenamos DESC pra pegar os mais recentes; sort asc é feito client-side
  // depois (createdAt no commentsArr.sort).
  const commentsP = withSignal(
    sb
      .from('comments')
      .select('id, post_id, user_id, text, created_at')
      .in('post_id', postIds)
      .is('deleted_at', null) // Wave 8 soft-delete: snapshot inicial só ativos
      .order('created_at', { ascending: false })
      .limit(200),
  );
  const allLikesP = withSignal(
    sb.from('likes').select('post_id').in('post_id', postIds),
  );
  const myLikesP = userId
    ? withSignal(
        sb.from('likes').select('post_id').eq('user_id', userId).in('post_id', postIds),
      )
    : Promise.resolve({ data: [] as Array<{ post_id: string | null }>, error: null });
  const savedP = userId
    ? withSignal(
        sb
          .from('saved_posts')
          .select('post_id')
          .eq('user_id', userId)
          .in('post_id', postIds),
      )
    : Promise.resolve({ data: [] as Array<{ post_id: string | null }>, error: null });

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
  // Casts mínimos só onde o DB row tem nullable que o domain trata como
  // garantido (FK ON DELETE CASCADE, mas Supabase tipa nullable).
  const commentsArr = (commentsRes.data ?? []).map((c) => ({
    id: c.id,
    post_id: c.post_id ?? '',
    user_id: c.user_id ?? '',
    text: c.text,
    created_at: c.created_at ?? '',
    author: null, // preenchido pelo backfill abaixo via profMap
  })) as FeedComment[];
  const allLikesArr = (allLikesRes.data ?? []).filter(
    (l): l is { post_id: string } => typeof l.post_id === 'string',
  );
  const myLikesArr = (myLikesRes.data ?? []).filter(
    (l): l is { post_id: string } => typeof l.post_id === 'string',
  );
  const savedArr = (savedRes.data ?? []).filter(
    (l): l is { post_id: string } => typeof l.post_id === 'string',
  );

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
  // Backfill author via profMap pra qualquer comment que veio sem JOIN
  // (fallback path quando a FK não está no PostgREST cache). Mutamos o
  // commentsArr in-place — barato e evita 2º map.
  for (const c of commentsArr) {
    if (!c.author && c.user_id) {
      const p = profMap.get(c.user_id);
      if (p) {
        c.author = {
          name: p.name ?? null,
          tag: (p as { tag?: string | null }).tag ?? null,
          avatar_url: p.avatar_url ?? null,
        };
      }
    }
  }

  // Bucketiza comments por post. Query veio DESC (mais recentes primeiro)
  // pra respeitar o cap global de 200 — re-sortamos ASC dentro de cada
  // bucket pra UI mostrar do mais antigo pro mais novo (padrão IG/FB).
  const commentsByPost = new Map<string, FeedComment[]>();
  for (const c of commentsArr) {
    const list = commentsByPost.get(c.post_id);
    if (list) list.push(c);
    else commentsByPost.set(c.post_id, [c]);
  }
  for (const list of commentsByPost.values()) {
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  // Enriquece + (opcional) filtra por role do autor.
  const enriched: FeedPost[] = posts.map((p) => {
    // Profile pode não estar no map (perfil sumiu / fetch falhou). Fallback
    // mínimo só com id; satisfies pra garantir que o objeto literal cobre o
    // shape exigido sem cast forçado.
    const profile: Profile = profMap.get(p.user_id) ?? { id: p.user_id };
    return {
      ...p,
      profile,
      liked: mySet.has(p.id),
      saved: savedSet.has(p.id),
      likeCount: likeCounts.get(p.id) ?? 0,
      comments: commentsByPost.get(p.id) ?? [],
    };
  });

  // Cursor da próxima página = created_at do último post desta página (já em
  // desc order). hasMore=true se a página veio cheia — heurística simples:
  // se vieram MENOS posts que o limite, é fim (não tem mais). Note que o
  // roleFilter só filtra DEPOIS, então o cursor reflete o último post bruto
  // da página (não da lista filtrada) — isso é correto pra paginação avançar
  // mesmo se a página filtrada ficar vazia.
  const lastRaw = posts[posts.length - 1];
  const nextCursor = lastRaw?.created_at ?? null;
  const hasMore = posts.length >= limit;

  let items = enriched;
  if (roleFilter) {
    const role = String(roleFilter).toLowerCase();
    items = enriched.filter((p) => String(p.profile.role ?? '').toLowerCase() === role);
  }
  // S6: filtra blocked client-side no caminho legacy (RPC v2 já filtra
  // server-side, mas fallback precisa de defesa em profundidade). Best-
  // effort: se a RPC list_blocked_ids falhar, ignora (sem regressão).
  if (userId) {
    try {
      const { listBlockedIds } = await import('@/lib/services/blocks');
      const blocked = await listBlockedIds();
      if (blocked.length > 0) {
        const set = new Set(blocked);
        items = items.filter((p) => !set.has(p.user_id));
      }
    } catch {
      // ignora — feed continua mostrando blocked nesse caso extremo.
    }
  }
  return { items, nextCursor, hasMore };
}

// Re-exporta a constante de page size pra o hook usar como pageSize default.
export const FEED_PAGE_SIZE = FEED_PAGE_DEFAULT;

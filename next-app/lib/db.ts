// db.ts — port de /db.js para TS estrito.
// Fachada fina sobre o Supabase client pra centralizar queries repetidas
// (profiles, follows, posts). Mesma forma e mesmas decisões do vanilla:
//   - getters degradados (null/[]/0) quando o client não existe ou estoura,
//   - mutations retornam { ok, code?, message? } pra o caller diferenciar,
//   - follow() faz verify-after-insert (anti-pattern 23505 vindo de trigger).

import { getSupabase } from './supabase';
import { logger } from './logger';
import { errMsg } from './utils';
import type { Profile, Post, MutationResult } from './types';

// Mesmo default usado em fetchPublicProfiles (modules/feed.js). Mantém-se em
// sync manualmente — se a view profiles_public ganhar/perder coluna,
// atualizar aqui também. Lista enxuta de propósito (perfis carregam JSON pesado).
const PUBLIC_COLS = 'id, name, tag, avatar_url, role, user_type';

// Espelha POST_COLS de app.js e Config.feed.POST_COLS. Idem: alterar aqui
// implica alterar lá pra evitar drift.
const POST_COLS =
  'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at';

// _sb() devolve null quando a init estoura (env vars faltando, runtime sem
// fetch, etc.). Cada caller cai no caminho degradado correspondente.
function _sb(): ReturnType<typeof getSupabase> | null {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

// ─── profiles ────────────────────────────────────────────────────────────────

async function getById(id: string, cols?: string): Promise<Profile | null> {
  const sb = _sb();
  if (!sb || !id) return null;
  try {
    // maybeSingle() não estoura se a linha não existir (single() estoura).
    // Pra um getter público, ausência é resultado válido, não erro.
    const r = await sb
      .from('profiles')
      .select(cols || PUBLIC_COLS)
      .eq('id', id)
      .maybeSingle();
    if (r.error) {
      logger.warn('DB.profiles.getById', r.error.message);
      return null;
    }
    // Cast: o select aceita string dinâmica (`cols`), então o type checker
    // devolve GenericStringError. Pragmático — runtime sempre tem id.
    return (r.data as unknown as Profile | null) ?? null;
  } catch (e) {
    logger.warn('DB.profiles.getById exc', errMsg(e));
    return null;
  }
}

// Tenta `profiles_public` (view com colunas seguras) primeiro; se a view
// não existir/retornar vazio, cai pra `profiles` direto. Port do
// fetchPublicProfiles em modules/feed.js (que era delegado pelo db.js vanilla).
async function getMany(ids: string[], cols?: string): Promise<Profile[]> {
  if (!ids || !ids.length) return [];
  const useCols = cols || PUBLIC_COLS;
  const sb = _sb();
  if (!sb) return [];
  try {
    const r = await sb.from('profiles_public').select(useCols).in('id', ids);
    // Cast via unknown: select(string-runtime) faz o postgrest devolver
    // GenericStringError[] (type-checker não introspecciona o cols var).
    // Pragmático: domain type Profile é permissive, runtime sempre tem id.
    if (!r.error && r.data && r.data.length > 0) return r.data as unknown as Profile[];
    if (r.error) {
      logger.warn('profiles_public falhou, fallback p/ profiles', r.error.message);
    }
    const fb = await sb.from('profiles').select(useCols).in('id', ids);
    if (fb.error) {
      logger.warn('profiles fallback err', fb.error.message);
      return [];
    }
    return (fb.data as unknown as Profile[] | null) ?? [];
  } catch (e) {
    logger.warn('DB.profiles.getMany exc', errMsg(e));
    return [];
  }
}

// ─── follows ─────────────────────────────────────────────────────────────────

async function countFollowers(userId: string): Promise<number> {
  const sb = _sb();
  if (!sb || !userId) return 0;
  try {
    const r = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('following_id', userId);
    return r.count || 0;
  } catch (e) {
    logger.warn('DB.follows.countFollowers', errMsg(e));
    return 0;
  }
}

async function countFollowing(userId: string): Promise<number> {
  const sb = _sb();
  if (!sb || !userId) return 0;
  try {
    const r = await sb
      .from('follows')
      .select('*', { count: 'exact', head: true })
      .eq('follower_id', userId);
    return r.count || 0;
  } catch (e) {
    logger.warn('DB.follows.countFollowing', errMsg(e));
    return 0;
  }
}

async function listFollowingIds(userId: string): Promise<string[]> {
  const sb = _sb();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('follows')
      .select('following_id')
      .eq('follower_id', userId);
    if (error) {
      logger.warn('DB.follows.listFollowingIds', error.message);
      return [];
    }
    // FK pode ser null no schema (ON DELETE CASCADE); filtramos pra string[]
    // estrito antes de devolver — caller assume non-null id.
    return (data || [])
      .map((f) => f.following_id)
      .filter((id): id is string => id !== null);
  } catch (e) {
    logger.warn('DB.follows.listFollowingIds exc', errMsg(e));
    return [];
  }
}

// Espelho de listFollowingIds: lista quem segue um usuário.
async function listFollowerIds(userId: string): Promise<string[]> {
  const sb = _sb();
  if (!sb || !userId) return [];
  try {
    const { data, error } = await sb
      .from('follows')
      .select('follower_id')
      .eq('following_id', userId);
    if (error) {
      logger.warn('DB.follows.listFollowerIds', error.message);
      return [];
    }
    return (data || [])
      .map((f) => f.follower_id)
      .filter((id): id is string => id !== null);
  } catch (e) {
    logger.warn('DB.follows.listFollowerIds exc', errMsg(e));
    return [];
  }
}

async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
  const sb = _sb();
  if (!sb || !followerId || !followingId) return false;
  try {
    const r = await sb
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .limit(1);
    if (r.error) {
      logger.warn('DB.follows.isFollowing', r.error.message);
      return false;
    }
    return !!(r.data && r.data.length > 0);
  } catch (e) {
    logger.warn('DB.follows.isFollowing exc', errMsg(e));
    return false;
  }
}

// ANTI-PATTERN do bug 23505: o insert pode "voltar OK" e ainda assim a linha
// NÃO existir. Triggers AFTER INSERT em follows (ex.: créditos em points com
// UNIQUE em source+reference_id) podem dar ROLLBACK devolvendo 23505 — mas
// o erro é de OUTRA tabela. Por isso confirmamos com SELECT antes de dizer ok.
async function follow(followerId: string, followingId: string): Promise<MutationResult> {
  const sb = _sb();
  if (!sb) return { ok: false, code: 'no-client', message: 'Supabase client indisponível' };
  if (!followerId || !followingId) return { ok: false, code: 'bad-args', message: 'ids obrigatórios' };
  try {
    const { error } = await sb
      .from('follows')
      .insert({ follower_id: followerId, following_id: followingId });
    const { data: chk } = await sb
      .from('follows')
      .select('id')
      .eq('follower_id', followerId)
      .eq('following_id', followingId)
      .limit(1);
    if (chk && chk.length > 0) return { ok: true };
    const code = error?.code || 'no-row';
    const message = error?.message || 'Follow não persistiu';
    return { ok: false, code, message };
  } catch (e) {
    return { ok: false, code: 'exception', message: errMsg(e) };
  }
}

async function unfollow(followerId: string, followingId: string): Promise<MutationResult> {
  const sb = _sb();
  if (!sb) return { ok: false, code: 'no-client', message: 'Supabase client indisponível' };
  if (!followerId || !followingId) return { ok: false, code: 'bad-args', message: 'ids obrigatórios' };
  try {
    const { error } = await sb
      .from('follows')
      .delete()
      .eq('follower_id', followerId)
      .eq('following_id', followingId);
    if (error) return { ok: false, code: error.code || 'delete-error', message: error.message || '' };
    return { ok: true };
  } catch (e) {
    return { ok: false, code: 'exception', message: errMsg(e) };
  }
}

// ─── posts ───────────────────────────────────────────────────────────────────

// Shape retornado pelas funções que devolvem a query crua. Mesma forma do
// PostgrestSingleResponse, mas tipado mais permissivo (não casamos o data
// com o select string em tempo de compilação — Zod/parse no caller).
export interface QueryResult<T = unknown> {
  data: T[] | null;
  error: { code?: string; message?: string } | null;
}

interface CountByUserOpts {
  includeStories?: boolean;
}

async function countByUser(userId: string, opts?: CountByUserOpts): Promise<number> {
  const sb = _sb();
  if (!sb || !userId) return 0;
  try {
    let q = sb.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if (!opts || !opts.includeStories) q = q.neq('media_type', 'story');
    const r = await q;
    return r.count || 0;
  } catch (e) {
    logger.warn('DB.posts.countByUser', errMsg(e));
    return 0;
  }
}

interface GetByUserOpts {
  limit?: number;
  cols?: string;
  onlyApproved?: boolean;
  includeStories?: boolean;
}

// Lista posts de UM usuário (portfolio). Retorna a promise da query — o
// caller awaita e lê {data, error}. Diferente do vanilla (que retornava o
// builder) aqui já é a promise, então `await` resolve direto.
async function getByUser(userId: string, opts: GetByUserOpts = {}): Promise<QueryResult<Post>> {
  const sb = _sb();
  if (!sb) return { data: [], error: { message: 'no-client' } };
  const cols = opts.cols || POST_COLS;
  const limit = opts.limit || 60;
  let q = sb.from('posts').select(cols).eq('user_id', userId);
  if (!opts.includeStories) q = q.neq('media_type', 'story');
  if (opts.onlyApproved) q = q.or('status.eq.approved,status.is.null');
  q = q.order('created_at', { ascending: false }).limit(limit);
  const r = await q;
  return { data: (r.data as unknown as Post[] | null) ?? [], error: r.error };
}

interface GetFeedPostsOpts {
  cols?: string;
  offset?: number;
  limit?: number;
  feedIds?: string[];
}

async function getFeedPosts(opts: GetFeedPostsOpts = {}): Promise<QueryResult<Post>> {
  const sb = _sb();
  if (!sb) return { data: [], error: { message: 'no-client' } };
  const cols = opts.cols || POST_COLS;
  const offset = opts.offset || 0;
  const limit = opts.limit || 30;
  const feedIds = opts.feedIds || [];
  let q = sb.from('posts').select(cols).neq('media_type', 'story');
  // status nulo = posts antigos pré-moderação; mantemos compat aceitando ambos.
  q = q.or('status.eq.approved,status.is.null');
  if (feedIds.length > 0) q = q.in('user_id', feedIds);
  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  const r = await q;
  return { data: (r.data as unknown as Post[] | null) ?? [], error: r.error };
}

interface GetStoriesOpts {
  cols?: string;
  feedIds?: string[];
  sinceISO?: string;
  limit?: number;
}

async function getStories(opts: GetStoriesOpts = {}): Promise<QueryResult<Post>> {
  const sb = _sb();
  if (!sb) return { data: [], error: { message: 'no-client' } };
  const cols = opts.cols || POST_COLS;
  const feedIds = opts.feedIds || [];
  // Default 24h pra bater com o comportamento estilo IG já em produção.
  const sinceISO = opts.sinceISO || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const limit = opts.limit || 100;
  let q = sb.from('posts').select(cols).eq('media_type', 'story');
  q = q.or('status.eq.approved,status.is.null').not('media_url', 'is', null);
  if (feedIds.length > 0) q = q.in('user_id', feedIds);
  q = q.gte('created_at', sinceISO).order('created_at', { ascending: true }).limit(limit);
  const r = await q;
  return { data: (r.data as unknown as Post[] | null) ?? [], error: r.error };
}

// Fachada agregada — equivalente ao window.DB vanilla. Os call sites podem
// importar tanto o objeto agregado (`DB.profiles.getById(...)`) quanto os
// símbolos individuais.
export const DB = {
  profiles: { getById, getMany, PUBLIC_COLS },
  follows: { countFollowers, countFollowing, listFollowingIds, listFollowerIds, isFollowing, follow, unfollow },
  posts: { countByUser, getByUser, getFeedPosts, getStories, COLS: POST_COLS },
} as const;

export { PUBLIC_COLS as PROFILE_PUBLIC_COLS, POST_COLS };

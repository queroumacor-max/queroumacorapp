// mediaReviewAdmin — service de leitura/escrita da fila de revisão de
// mídia (`media_review_queue`) pelo painel admin. RLS no banco (Wave 29)
// só libera SELECT/UPDATE/DELETE pra is_portal_admin().
//
// Operações:
//   - fetchMediaReviewQueue: lista paginada com filtro por status
//   - approveMediaReview: marca como reviewed (não bloqueia o post)
//   - dismissMediaReview: marca como dismissed
//   - blockMediaPermanent: insere hash em `media_hash_blocklist`
//     (categoria 'reported'), soft-deleta o post (deleted_at=now()),
//     e marca queue como 'reviewed'
//   - escalateToNcmec: adiciona hash em blocklist com
//     reported_to_ncmec=true, soft-deleta post, marca queue como
//     'escalated_ncmec'. NCMEC report em si é manual (ver
//     docs/CSAM_POLICY.md).
//
// Cast manual pra tabelas novas (Wave 29) que ainda não estão no
// schema TS gen — mesmo pattern de artReferences.ts e product_variants.ts.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

export type MediaReviewStatus =
  | 'pending'
  | 'reviewed'
  | 'dismissed'
  | 'escalated_ncmec';

export type MediaReviewSeverity = 'low' | 'med' | 'high' | 'critical';

export interface MediaReviewRow {
  id: string;
  post_id: string | null;
  user_id: string;
  media_url: string;
  media_hash: string | null;
  reason: string;
  severity: MediaReviewSeverity;
  status: MediaReviewStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  // Enriquecido via JOIN
  user?: { id: string; name?: string | null; tag?: string | null } | null;
  post?: { id: string; caption?: string | null } | null;
}

export interface FetchMediaReviewParams {
  status?: MediaReviewStatus | 'all';
  limit?: number;
  cursor?: string | null;
}

export interface MediaReviewPage {
  items: MediaReviewRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

interface AnyError {
  message: string;
  code?: string;
}

interface AnyRow {
  id: string;
  post_id: string | null;
  user_id: string;
  media_url: string;
  media_hash: string | null;
  reason: string;
  severity: MediaReviewSeverity;
  status: MediaReviewStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

// Cast manual — tabelas novas (Wave 29) ainda fora do schema TS gen.
// Mesmo pattern de artReferences.ts.
interface UpdateChain {
  eq: (col: string, val: string) => PromiseLike<{ error: AnyError | null }>;
}
interface InsertChain {
  // Insert simples (sem .select()) basta — só queremos saber se houve erro.
}
interface SelectChain {
  order: (col: string, opts: { ascending: boolean }) => SelectChain;
  limit: (n: number) => SelectChain;
  eq: (col: string, val: string) => SelectChain;
  lt: (col: string, val: string) => SelectChain;
  then: (
    resolve: (v: { data: AnyRow[] | null; error: AnyError | null }) => void,
  ) => void;
}
interface MhblTableClient {
  select: (cols: string) => SelectChain;
  update: (vals: Record<string, unknown>) => UpdateChain;
  insert: (
    row: Record<string, unknown>,
  ) => PromiseLike<{ error: AnyError | null }> & InsertChain;
}

function mrqClient() {
  return getSupabase() as unknown as {
    from: (t: string) => MhblTableClient;
  };
}

export async function fetchMediaReviewQueue(
  params: FetchMediaReviewParams = {},
): Promise<MediaReviewPage> {
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const status = params.status ?? 'pending';
  const cursor = params.cursor ?? null;

  let q = mrqClient()
    .from('media_review_queue')
    .select(
      'id, post_id, user_id, media_url, media_hash, reason, severity, status, created_at, reviewed_at, reviewed_by',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'all') q = q.eq('status', status);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await new Promise<{
    data: AnyRow[] | null;
    error: AnyError | null;
  }>((resolve) => q.then(resolve));
  if (error)
    throw new NetworkError(error.message || 'Falha ao carregar fila', error);
  const rows = data ?? [];
  if (rows.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const postIds = [
    ...new Set(rows.map((r) => r.post_id).filter((id): id is string => !!id)),
  ];

  const sb = getSupabase();
  const [profilesRes, postsRes] = await Promise.all([
    userIds.length > 0
      ? sb.from('profiles_public').select('id, name, tag').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    postIds.length > 0
      ? sb.from('posts').select('id, caption').in('id', postIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profMap = new Map<
    string,
    { id: string; name?: string | null; tag?: string | null }
  >();
  for (const p of profilesRes.data ?? []) {
    const row = p as { id: string; name?: string | null; tag?: string | null };
    profMap.set(row.id, row);
  }
  const postMap = new Map<string, { id: string; caption?: string | null }>();
  for (const p of postsRes.data ?? []) {
    const row = p as { id: string; caption?: string | null };
    postMap.set(row.id, row);
  }

  const items: MediaReviewRow[] = rows.map((r) => ({
    ...r,
    user: profMap.get(r.user_id) ?? null,
    post: r.post_id ? postMap.get(r.post_id) ?? null : null,
  }));

  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow?.created_at ?? null;
  const hasMore = rows.length >= limit;
  return { items, nextCursor, hasMore };
}

/**
 * Marca uma entrada como revisada (sem bloquear o post). Use quando
 * a flag foi falso positivo do Gemini.
 */
export async function approveMediaReview(reviewId: string): Promise<void> {
  if (!reviewId) throw new ValidationError('reviewId obrigatório');
  const { error } = await mrqClient()
    .from('media_review_queue')
    .update({ status: 'reviewed', reviewed_at: new Date().toISOString() })
    .eq('id', reviewId);
  if (error) throw new NetworkError(error.message || 'Falha ao aprovar', error);
}

/**
 * Dispensa (false positive). Marca como 'dismissed' sem bloquear nada.
 */
export async function dismissMediaReview(reviewId: string): Promise<void> {
  if (!reviewId) throw new ValidationError('reviewId obrigatório');
  const { error } = await mrqClient()
    .from('media_review_queue')
    .update({ status: 'dismissed', reviewed_at: new Date().toISOString() })
    .eq('id', reviewId);
  if (error)
    throw new NetworkError(error.message || 'Falha ao dispensar', error);
}

/**
 * Bloqueio permanente: insere o hash na blocklist + soft-deleta o post.
 * Use quando confirmar conteúdo abusivo/spam que não é CSAM.
 *
 * `category` default 'reported' (catch-all). Pra CSAM use
 * `escalateToNcmec` que marca a flag específica.
 */
export async function blockMediaPermanent(args: {
  reviewId: string;
  hash: string;
  postId?: string | null;
  category?: 'csam' | 'abuse' | 'spam' | 'reported';
  notes?: string;
}): Promise<void> {
  const { reviewId, hash, postId, category = 'reported', notes } = args;
  if (!reviewId) throw new ValidationError('reviewId obrigatório');
  if (!hash) throw new ValidationError('hash obrigatório pra bloquear');

  // 1) Insere/upserta na blocklist (UNIQUE em hash garante idempotência).
  const { error: insErr } = await mrqClient()
    .from('media_hash_blocklist')
    .insert({
      hash,
      category,
      notes: notes ?? null,
    });
  // Code 23505 = unique violation; ignora (já está na lista).
  if (insErr && insErr.code !== '23505') {
    throw new NetworkError(
      insErr.message || 'Falha ao adicionar à blocklist',
      insErr,
    );
  }

  // 2) Soft-delete do post (Wave 8) — se ainda existe.
  if (postId) {
    const sb = getSupabase();
    const { error: pErr } = await sb
      .from('posts')
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq('id', postId);
    if (pErr) {
      console.warn('blockMediaPermanent: soft-delete post falhou', pErr.message);
    }
  }

  // 3) Marca a queue entry como revisada.
  const { error: upErr } = await mrqClient()
    .from('media_review_queue')
    .update({ status: 'reviewed', reviewed_at: new Date().toISOString() })
    .eq('id', reviewId);
  if (upErr)
    throw new NetworkError(upErr.message || 'Falha ao atualizar fila', upErr);
}

/**
 * Escalada NCMEC: marca o hash como csam + reported_to_ncmec na
 * blocklist, soft-deleta o post, e move a entry pra 'escalated_ncmec'.
 *
 * IMPORTANTE: este método NÃO envia automaticamente pro NCMEC. O
 * envio é manual via SaferNet/CyberTipline (ver docs/CSAM_POLICY.md).
 * Aqui só registra a intenção pra trilha de auditoria.
 */
export async function escalateToNcmec(args: {
  reviewId: string;
  hash: string;
  postId?: string | null;
  notes?: string;
  ncmecReportId?: string;
}): Promise<void> {
  const { reviewId, hash, postId, notes, ncmecReportId } = args;
  if (!reviewId) throw new ValidationError('reviewId obrigatório');
  if (!hash) throw new ValidationError('hash obrigatório pra escalar');

  // 1) Insere/upserta na blocklist como csam + reported_to_ncmec.
  const { error: insErr } = await mrqClient()
    .from('media_hash_blocklist')
    .insert({
      hash,
      category: 'csam',
      notes: notes ?? null,
      reported_to_ncmec: true,
      ncmec_report_id: ncmecReportId ?? null,
    });
  if (insErr && insErr.code !== '23505') {
    throw new NetworkError(
      insErr.message || 'Falha ao adicionar à blocklist',
      insErr,
    );
  }
  // 2) Soft-delete do post.
  if (postId) {
    const sb = getSupabase();
    const { error: pErr } = await sb
      .from('posts')
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq('id', postId);
    if (pErr) {
      console.warn('escalateToNcmec: soft-delete post falhou', pErr.message);
    }
  }
  // 3) Marca a queue entry como escalada.
  const { error: upErr } = await mrqClient()
    .from('media_review_queue')
    .update({
      status: 'escalated_ncmec',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', reviewId);
  if (upErr) throw new NetworkError(upErr.message || 'Falha ao escalar', upErr);
}

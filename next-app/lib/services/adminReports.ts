// adminReports — service de leitura/escrita da tabela `reports` pelo
// painel admin. RLS no banco (Wave 18) só libera SELECT/UPDATE pra
// is_portal_admin(); aqui não há gate adicional — confiamos no banco.
//
// fetchReports: lista paginada com filtro por status. JOIN com profiles
// e posts pra mostrar quem denunciou + quem foi alvo + qual post.
//
// updateReportStatus: muda status pra 'reviewed' | 'resolved' | 'dismissed'.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

export type ReportStatus = 'pending' | 'reviewed' | 'resolved' | 'dismissed';

export interface AdminReportRow {
  id: string;
  reporter_id: string;
  post_id: string | null;
  target_user_id: string | null;
  reason: string;
  status: ReportStatus;
  created_at: string;
  // Enriquecido via JOIN — opcional pra cobrir rows com FKs deletadas.
  reporter?: { id: string; name?: string | null; tag?: string | null } | null;
  target?: { id: string; name?: string | null; tag?: string | null } | null;
  post?: { id: string; caption?: string | null; media_url?: string | null } | null;
}

export interface FetchReportsParams {
  status?: ReportStatus | 'all';
  limit?: number;
  cursor?: string | null;
}

export interface ReportsPage {
  items: AdminReportRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function fetchAdminReports(
  params: FetchReportsParams = {},
): Promise<ReportsPage> {
  const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const status = params.status ?? 'pending';
  const cursor = params.cursor ?? null;

  const sb = getSupabase();
  let q = sb
    .from('reports')
    .select(
      'id, reporter_id, post_id, target_user_id, reason, status, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'all') q = q.eq('status', status);
  if (cursor) q = q.lt('created_at', cursor);

  const { data, error } = await q;
  if (error) throw new NetworkError(error.message || 'Falha ao carregar reports', error);
  const rows = (data ?? []) as Array<{
    id: string;
    reporter_id: string;
    post_id: string | null;
    target_user_id: string | null;
    reason: string;
    status: ReportStatus;
    created_at: string;
  }>;
  if (rows.length === 0) {
    return { items: [], nextCursor: null, hasMore: false };
  }

  const userIds = [
    ...new Set(
      rows.flatMap((r) => [r.reporter_id, r.target_user_id].filter((id): id is string => !!id)),
    ),
  ];
  const postIds = [...new Set(rows.map((r) => r.post_id).filter((id): id is string => !!id))];

  const [profilesRes, postsRes] = await Promise.all([
    userIds.length > 0
      ? sb.from('profiles_public').select('id, name, tag').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    postIds.length > 0
      ? sb.from('posts').select('id, caption, media_url').in('id', postIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const profMap = new Map<string, { id: string; name?: string | null; tag?: string | null }>();
  for (const p of profilesRes.data ?? []) {
    const row = p as { id: string; name?: string | null; tag?: string | null };
    profMap.set(row.id, row);
  }
  const postMap = new Map<string, { id: string; caption?: string | null; media_url?: string | null }>();
  for (const p of postsRes.data ?? []) {
    const row = p as { id: string; caption?: string | null; media_url?: string | null };
    postMap.set(row.id, row);
  }

  const items: AdminReportRow[] = rows.map((r) => ({
    ...r,
    reporter: profMap.get(r.reporter_id) ?? null,
    target: r.target_user_id ? profMap.get(r.target_user_id) ?? null : null,
    post: r.post_id ? postMap.get(r.post_id) ?? null : null,
  }));

  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow?.created_at ?? null;
  const hasMore = rows.length >= limit;
  return { items, nextCursor, hasMore };
}

export async function updateReportStatus(
  reportId: string,
  status: Exclude<ReportStatus, 'pending'>,
): Promise<void> {
  if (!reportId) throw new ValidationError('reportId obrigatório');
  const sb = getSupabase();
  const { error } = await sb.from('reports').update({ status }).eq('id', reportId);
  if (error) throw new NetworkError(error.message || 'Falha ao atualizar report', error);
}

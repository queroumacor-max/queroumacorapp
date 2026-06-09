// adminFeatureInterest — service de leitura agregada da tabela
// `feature_interest` pelo painel admin. Wave 19 libera SELECT pra
// is_portal_admin(). Métrica de produto: quais features "em breve"
// têm tração e contato pra avisar quando lançar.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface FeatureInterestRow {
  id: string;
  user_id: string | null;
  feature: string;
  action: string;
  contact: string | null;
  created_at: string;
  reporter?: { id: string; name?: string | null; tag?: string | null } | null;
}

export interface FeatureInterestSummary {
  feature: string;
  count: number;
  lastAt: string | null;
}

export async function fetchFeatureInterestSummary(): Promise<FeatureInterestSummary[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feature_interest')
    .select('feature, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw new NetworkError(error.message || 'Falha ao carregar feature_interest', error);
  const rows = (data ?? []) as Array<{ feature: string; created_at: string }>;
  const map = new Map<string, FeatureInterestSummary>();
  for (const r of rows) {
    const existing = map.get(r.feature);
    if (existing) {
      existing.count += 1;
      if (r.created_at > (existing.lastAt ?? '')) existing.lastAt = r.created_at;
    } else {
      map.set(r.feature, { feature: r.feature, count: 1, lastAt: r.created_at });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}

export async function fetchFeatureInterestRows(
  feature: string,
  limit = 100,
): Promise<FeatureInterestRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feature_interest')
    .select('id, user_id, feature, action, contact, created_at')
    .eq('feature', feature)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new NetworkError(error.message || 'Falha ao carregar rows', error);
  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string | null;
    feature: string;
    action: string;
    contact: string | null;
    created_at: string;
  }>;
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  let profMap = new Map<string, { id: string; name?: string | null; tag?: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await sb
      .from('profiles_public')
      .select('id, name, tag')
      .in('id', userIds);
    profMap = new Map(
      (profs ?? []).map((p) => {
        const row = p as { id: string; name?: string | null; tag?: string | null };
        return [row.id, row];
      }),
    );
  }

  return rows.map((r) => ({
    ...r,
    reporter: r.user_id ? profMap.get(r.user_id) ?? null : null,
  }));
}

// lib/api/_services/admin-errors-list.ts — port de
// `functions/api/_services/admin-errors-list.js`. Query da tabela `errors`
// (dashboard caseiro de erros) com filtros opcionais. Controller cuida de
// auth admin + rate-limit.

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';

const QUERY_TIMEOUT_MS = 10000;

export interface ErrorsListFilters {
  limit?: number | string;
  offset?: number | string;
  type?: string;
  since_hours?: number | string;
  search?: string;
}

export interface ErrorsListResult {
  rows: unknown[];
  total: number;
  limit: number;
  offset: number;
  since_hours: number;
}

function parseIntOr(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

export async function listErrors(args: {
  filters: ErrorsListFilters;
}): Promise<ErrorsListResult> {
  const { filters } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Dashboard admin não configurado', 503);
  const supaUrl = getSupabaseUrl();

  const limit = Math.min(Math.max(parseIntOr(filters?.limit, 50), 1), 200);
  const offset = Math.max(parseIntOr(filters?.offset, 0), 0);
  const filterType =
    typeof filters?.type === 'string' && filters.type ? filters.type.slice(0, 32) : '';
  const sinceHours = Math.min(Math.max(parseIntOr(filters?.since_hours, 24), 1), 720);
  const search =
    typeof filters?.search === 'string' && filters.search ? filters.search.slice(0, 100) : '';

  const sinceISO = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
  const qs = new URLSearchParams();
  qs.set('select', 'id,created_at,type,msg,stack,url,ua,metric,value,ctx,user_id,client_ts');
  qs.set('order', 'created_at.desc');
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));
  qs.set('created_at', `gte.${sinceISO}`);
  if (filterType) qs.set('type', `eq.${filterType}`);
  if (search) qs.set('msg', `ilike.*${search}*`);

  try {
    const r = await fetch(`${supaUrl}/rest/v1/errors?${qs.toString()}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'count=exact',
      },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('admin-errors-list supabase error', r.status, txt);
      throw new ServiceError('Falha ao consultar logs', 502);
    }
    const rows = (await r.json()) as unknown[];
    const range = r.headers.get('content-range') || '';
    const total = range.includes('/')
      ? parseInt(range.split('/')[1] || '0', 10) || rows.length
      : rows.length;
    return { rows, total, limit, offset, since_hours: sinceHours };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    console.warn('admin-errors-list exception:', e instanceof Error ? e.message : e);
    throw new ServiceError('Erro de rede consultando logs', 502);
  }
}

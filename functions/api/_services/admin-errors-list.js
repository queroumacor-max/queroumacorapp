// @ts-check
// Business logic — query da tabela errors com filtros opcionais.
// Controller cuida de auth admin + rate-limit.
import { ServiceError, FALLBACK_SUPABASE_URL } from '../_security.js';
import { getServiceKey } from './_admin.js';

const QUERY_TIMEOUT_MS = 10000;

/**
 * @param {{ env: Record<string,string>, filters: Record<string, any> }} args
 * @returns {Promise<{ rows: any[], total: number, limit: number, offset: number, since_hours: number }>}
 */
export async function listErrors({ env, filters }) {
  const serviceKey = getServiceKey(env);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');

  const limit = Math.min(Math.max(parseInt(filters?.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(filters?.offset) || 0, 0);
  const filterType = typeof filters?.type === 'string' && filters.type ? filters.type.slice(0, 32) : '';
  const sinceHours = Math.min(Math.max(parseInt(filters?.since_hours) || 24, 1), 720);
  const search = typeof filters?.search === 'string' && filters.search ? filters.search.slice(0, 100) : '';

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
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'count=exact'
      },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('admin-errors-list supabase error', r.status, txt);
      throw new ServiceError('Falha ao consultar logs', 502);
    }
    const rows = await r.json();
    const range = r.headers.get('content-range') || '';
    const total = range.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
    return { rows, total, limit, offset, since_hours: sinceHours };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    console.warn('admin-errors-list exception:', e && e.message);
    throw new ServiceError('Erro de rede consultando logs', 502);
  }
}

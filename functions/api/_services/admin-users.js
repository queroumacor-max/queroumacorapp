// @ts-check
// Business logic — promove/revoga acesso ao portal, set PRO, role, verified.
import { ServiceError, FALLBACK_SUPABASE_URL } from '../_security.js';
import { getServiceKey } from './_admin.js';

const TIMEOUT_MS = 10000;

const ROLE_MAP = {
  pintor:     { role: 'pintor',     user_type: 'pintor',     profession: 'pintor' },
  grafiteiro: { role: 'grafiteiro', user_type: 'grafiteiro', profession: 'grafiteiro' },
  automotivo: { role: 'automotivo', user_type: 'automotivo', profession: 'automotivo' },
  funileiro:  { role: 'automotivo', user_type: 'automotivo', profession: 'funileiro' },
  cliente:    { role: 'cliente',    user_type: 'cliente' }
};

/**
 * Constrói o patch baseado no action. Throw ServiceError se action/params inválidos.
 * @param {{ action: string, value?: any, expiresAt?: string, roleKey?: string }} body
 * @returns {Record<string, any>}
 */
export function buildPatch(body) {
  const { action } = body;
  if (action === 'promote' || action === 'revoke') {
    return { portal_access: action === 'promote' };
  }
  if (action === 'verify') {
    return { verified: body?.value === true };
  }
  if (action === 'set_pro') {
    const enable = body?.value === true;
    let expiresAt = null;
    if (enable) {
      const raw = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
      const parsed = raw ? new Date(raw) : null;
      expiresAt = (parsed && !isNaN(parsed.getTime()))
        ? parsed.toISOString()
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    return { is_pro: enable, pro_expires_at: expiresAt };
  }
  if (action === 'set_role') {
    const m = ROLE_MAP[typeof body?.roleKey === 'string' ? body.roleKey : ''];
    if (!m) throw new ServiceError('roleKey inválido', 400);
    return { ...m };
  }
  throw new ServiceError('ação inválida', 400);
}

/**
 * Verifica que o caller tem portal_access ATIVO (dupla checagem além de
 * estar em ADMIN_EMAILS). Antes, qualquer lojista com portal_access podia
 * se autopromover; agora as 2 condições precisam bater.
 * @param {{ env: Record<string,string>, callerId: string }} args
 */
export async function ensureCallerHasPortalAccess({ env, callerId }) {
  const serviceKey = getServiceKey(env);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const sHeaders = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  try {
    const g = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=portal_access`, {
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const arr = await g.json();
    if (!arr?.[0]?.portal_access) throw new ServiceError('não autorizado (portal_access)', 403);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('falha ao verificar permissão', 502);
  }
}

/**
 * Aplica patch no profile target.
 * @param {{ env: Record<string,string>, userId: string, patch: Record<string,any> }} args
 * @returns {Promise<{ ok: true, patch: Record<string,any> }>}
 */
export async function patchProfile({ env, userId, patch }) {
  const serviceKey = getServiceKey(env);
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const sHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json'
  };
  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    console.warn('admin-users supabase error', r.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }
  const updated = await r.json();
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, patch };
}

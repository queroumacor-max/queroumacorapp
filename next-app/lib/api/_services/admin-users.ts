// lib/api/_services/admin-users.ts — port de
// `functions/api/_services/admin-users.js`. Promove/revoga portal_access,
// set PRO, role, verified. Service role + dupla checagem de admin
// (ADMIN_EMAILS + portal_access ATIVO do caller).

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';

const TIMEOUT_MS = 10000;

export type AdminUsersAction = 'promote' | 'revoke' | 'verify' | 'set_pro' | 'set_role';

interface AdminUsersBody {
  action?: string;
  value?: unknown;
  expiresAt?: unknown;
  roleKey?: unknown;
}

const ROLE_MAP: Record<string, Record<string, string>> = {
  pintor: { role: 'pintor', user_type: 'pintor', profession: 'pintor' },
  grafiteiro: { role: 'grafiteiro', user_type: 'grafiteiro', profession: 'grafiteiro' },
  automotivo: { role: 'automotivo', user_type: 'automotivo', profession: 'automotivo' },
  funileiro: { role: 'automotivo', user_type: 'automotivo', profession: 'funileiro' },
  cliente: { role: 'cliente', user_type: 'cliente' },
};

/**
 * Constrói o patch baseado na action. Throw ServiceError se action/params inválidos.
 */
export function buildPatch(body: AdminUsersBody): Record<string, unknown> {
  const { action } = body;
  if (action === 'promote' || action === 'revoke') {
    return { portal_access: action === 'promote' };
  }
  if (action === 'verify') {
    return { verified: body?.value === true };
  }
  if (action === 'set_pro') {
    const enable = body?.value === true;
    let expiresAt: string | null = null;
    if (enable) {
      const raw = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
      const parsed = raw ? new Date(raw) : null;
      expiresAt =
        parsed && !isNaN(parsed.getTime())
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
 * Dupla checagem além de estar em ADMIN_EMAILS: caller PRECISA ter portal_access
 * ATIVO no profile. Bloqueia auto-promoção via lojistas com portal_access.
 */
export async function ensureCallerHasPortalAccess(args: { callerId: string }): Promise<void> {
  const { callerId } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  try {
    const g = await fetch(
      `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=portal_access`,
      { headers: sHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const arr = (await g.json()) as Array<{ portal_access?: boolean }>;
    if (!arr?.[0]?.portal_access) throw new ServiceError('não autorizado (portal_access)', 403);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('falha ao verificar permissão', 502);
  }
}

/**
 * Aplica patch no profile target.
 */
export async function patchProfile(args: {
  userId: string;
  patch: Record<string, unknown>;
}): Promise<{ ok: true; patch: Record<string, unknown> }> {
  const { userId, patch } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    console.warn('admin-users supabase error', r.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }
  const updated = (await r.json()) as unknown[];
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, patch };
}

/**
 * High-level: lookup de um usuário por id ou email. Devolve `{ users: [...] }`.
 * Usado pelo controller `admin-users` quando body manda `query`/`email`/`userId`
 * sem nenhuma `action` de mutação — vira modo "read only" pra preencher UI.
 *
 * Mantém compat com o controller vanilla (que só fazia PATCH) adicionando esse
 * modo de busca exigido pela task. Nenhum caller do app antigo é afetado.
 */
export async function listUsers(args: {
  query?: string;
  userId?: string;
  email?: string;
}): Promise<{ users: unknown[] }> {
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const qs = new URLSearchParams();
  qs.set(
    'select',
    'id,name,email,role,user_type,profession,is_pro,pro_expires_at,portal_access,verified,created_at'
  );
  qs.set('limit', '50');

  const q = (args.query || '').trim();
  if (args.userId) {
    qs.set('id', `eq.${args.userId}`);
  } else if (args.email) {
    qs.set('email', `ilike.${args.email}`);
  } else if (q) {
    // Busca por nome OU email (PostgREST `or`)
    qs.set('or', `(name.ilike.*${q}*,email.ilike.*${q}*)`);
  } else {
    throw new ServiceError('query/userId/email obrigatório', 400);
  }

  try {
    const r = await fetch(`${supaUrl}/rest/v1/profiles?${qs.toString()}`, {
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.warn('admin-users listUsers supabase error', r.status);
      throw new ServiceError('Falha ao consultar usuários', 502);
    }
    return { users: (await r.json()) as unknown[] };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('Erro de rede consultando usuários', 502);
  }
}

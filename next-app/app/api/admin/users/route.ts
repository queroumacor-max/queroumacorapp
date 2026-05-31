// app/api/admin/users/route.ts — port de `functions/api/admin-users.js`.
// Promove/revoga portal_access, set PRO, role, verified. Adiciona modo
// read-only (`query`/`email`/`userId` sem `action`) pra preencher UI de busca.

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getServiceKey,
  getToken,
  isAdminEmail,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken } from '@/lib/api/_services/_admin-helpers';
import {
  buildPatch,
  ensureCallerHasPortalAccess,
  listUsers,
  patchProfile,
} from '@/lib/api/_services/admin-users';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!getServiceKey()) {
    return jsonResponse(
      {
        error:
          'Gestão de usuários não configurada (SUPABASE_SERVICE_ROLE/SUPABASE_SERVICE_KEY ausente)',
      },
      503
    );
  }
  let body: {
    action?: unknown;
    userId?: unknown;
    accessToken?: unknown;
    query?: unknown;
    email?: unknown;
    value?: unknown;
    expiresAt?: unknown;
    roleKey?: unknown;
  };
  try {
    body = (await readBody(request, { maxBytes: 1024 * 1024 })) as typeof body;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  const action = typeof body?.action === 'string' ? body.action : '';
  try {
    const token = getToken(request, body);
    const { callerId, email } = await verifyAdminToken(token);
    if (!callerId) throw new ServiceError('token inválido', 401);
    if (!isAdminEmail(email)) throw new ServiceError('não autorizado (email não admin)', 403);
    const rl = await checkRateLimit({
      userId: callerId || email,
      endpoint: 'admin-users',
      limit: 30,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

    // Modo read-only: nenhuma action → busca por query/email/userId.
    if (!action) {
      return jsonResponse(
        await listUsers({
          query: typeof body?.query === 'string' ? body.query : undefined,
          email: typeof body?.email === 'string' ? body.email : undefined,
          userId: userId || undefined,
        })
      );
    }

    if (!userId) return jsonResponse({ error: 'userId obrigatório' }, 400);
    const patch = buildPatch({
      action,
      value: body?.value,
      expiresAt: body?.expiresAt,
      roleKey: body?.roleKey,
    });
    await ensureCallerHasPortalAccess({ callerId });
    return jsonResponse(await patchProfile({ userId, patch }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-users crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

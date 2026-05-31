// app/api/admin/moderate/route.ts — port de `functions/api/admin-moderate.js`.
// Fila de moderação admin (approve/reject de posts).

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  ensureAdminEmail,
  getServiceKey,
  getToken,
  isAdminEmail,
  jsonResponse,
  rateLimitResponse,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken } from '@/lib/api/_services/_admin-helpers';
import { moderateAction, type ModerateAction } from '@/lib/api/_services/admin-moderate';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!getServiceKey() || !process.env.ADMIN_EMAILS) {
    return jsonResponse({ error: 'Moderação admin não configurada' }, 503);
  }
  let body: { action?: unknown; postId?: unknown; accessToken?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const action = typeof body?.action === 'string' ? body.action : '';
  const postId = typeof body?.postId === 'string' ? body.postId : '';
  try {
    const token = getToken(request, body);
    const { callerId, email } = await verifyAdminToken(token);
    // Modo "check": só verifica se o caller é admin, sem aplicar nada
    if (action === 'check') return jsonResponse({ admin: isAdminEmail(email) });
    ensureAdminEmail(email);
    const rl = await checkRateLimit({
      userId: callerId || email,
      endpoint: 'admin-moderate',
      limit: 60,
    });
    if (!rl.allowed) return rateLimitResponse(rl);
    if (action !== 'approve' && action !== 'reject') {
      return jsonResponse({ error: 'ação inválida' }, 400);
    }
    return jsonResponse(await moderateAction({ action: action as ModerateAction, postId }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-moderate crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

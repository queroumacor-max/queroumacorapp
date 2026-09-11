// app/api/admin/errors-list/route.ts — port de `functions/api/admin-errors-list.js`.
// Dashboard caseiro de erros (substituto/complemento do Sentry).

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getServiceKey,
  getToken,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { listErrors } from '@/lib/api/_services/admin-errors-list';
// No edge do Cloudflare a env-var só existe dentro do request handler —
// `process.env` volta vazio aqui. Ver lib/api/env.ts.
import { getRuntimeEnv } from '@/lib/api/env';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!getServiceKey() || !getRuntimeEnv('ADMIN_EMAILS')) {
    return jsonResponse({ error: 'Dashboard admin não configurado (faltam env vars)' }, 503);
  }
  let body: Record<string, unknown>;
  try {
    body = (await readBody(request, { maxBytes: 1024 * 1024 })) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  try {
    const token = getToken(request, body as { accessToken?: unknown });
    const { callerId, email, emailConfirmed } = await verifyAdminToken(token);
    await ensurePortalAdmin({ callerId, email, emailConfirmed });
    const rl = await checkRateLimit({
      userId: callerId || email,
      endpoint: 'admin-errors-list',
      limit: 60,
    });
    if (!rl.allowed) return rateLimitResponse(rl);
    return jsonResponse(await listErrors({ filters: body || {} }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-errors-list crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

// app/api/me-export/route.ts — port de `functions/api/me-export.js`.
// LGPD Art. 18 V (portabilidade): exporta TODOS os dados pessoais do usuário
// autenticado num JSON estruturado.

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitResponse,
  requireAuthStrict,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { exportUserData } from '@/lib/api/_services/me-export';
import { logAuditEvent } from '@/lib/api/audit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  let body: { accessToken?: unknown } = {};
  try {
    body = (await request.json()) as { accessToken?: unknown };
  } catch {
    /* sem body OK — token pode vir só no header */
  }
  try {
    const { user } = await requireAuthStrict(request, body);
    // Rate limit (3/min): export bate em 16 queries paralelas — sem isso, DoS fácil.
    const rl = await checkRateLimit({ userId: user.id, endpoint: 'me-export', limit: 3 });
    if (!rl.allowed) return rateLimitResponse(rl);
    const data = await exportUserData({ userId: user.id, email: user.email });
    // Audit-log LGPD: portabilidade de dados é direito do titular (Art. 18 V).
    // Registramos quem exportou + quando pra rastreio de compliance.
    // R-H5: critical=true — sem trilha de quem exportou o que, perdemos
    // resposta a eventual incidente/auditoria DPO. Falha do insert
    // bloqueia o download (cliente recebe 500 e re-tenta).
    await logAuditEvent({
      actorId: user.id,
      action: 'lgpd.me_export',
      targetTable: 'profiles',
      targetId: user.id,
      changes: { email_prefix: user.email.split('@')[0]?.slice(0, 4) ?? null },
      request,
      critical: true,
    });
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="queroumacor-meus-dados-${user.id.slice(0, 8)}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('me-export crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

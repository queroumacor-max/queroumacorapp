// app/api/ig-art-diag/route.ts — port de `functions/api/ig-art-diag.js`.
// GET — diagnóstico de modelos disponíveis. PRO + admin (mesmo gate do vanilla).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { diagnoseIgArt } from '@/lib/api/_services/ig-art-diag';
import { isPortalAdminUser } from '@/lib/api/_services/_admin-helpers';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const g = await gateProAI(request, {}, {
    endpoint: 'ig-art-diag',
    limit: 10,
  });
  if (g instanceof NextResponse) return g;
  // "PRO + admin": o comentário dizia, o código só cobrava PRO — a rota
  // devolve lista de modelos e corpo de erro dos provedores, diagnóstico
  // de operador, não de usuário.
  try {
    const admin = await isPortalAdminUser({
      callerId: g.userId || '',
      email: g.user?.email || '',
      emailConfirmed: g.user?.emailConfirmed,
    });
    if (!admin) return NextResponse.json({ error: 'não autorizado' }, { status: 403 });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return NextResponse.json({ error: 'não autorizado' }, { status: 403 });
  }
  try {
    const testOpenAI =
      new URL(request.url).searchParams.get('openai') === '1';
    return NextResponse.json(await diagnoseIgArt({ testOpenAI }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('ig-art-diag crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

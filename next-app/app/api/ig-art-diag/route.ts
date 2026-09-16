// app/api/ig-art-diag/route.ts — port de `functions/api/ig-art-diag.js`.
// GET — diagnóstico de modelos disponíveis. PRO + admin (mesmo gate do vanilla).
//
// Auditoria de segurança Cloudflare (2026-09-13/15): o comentário sempre
// disse "PRO + admin", mas o código só checava PRO — qualquer assinante
// PRO podia forçar o worker a chamar generativelanguage.googleapis.com/
// api.openai.com (custo de cota) e descobrir quais chaves de IA estão
// configuradas (`configured: true/false`). `gateProAI` já validou a
// identidade (auth + PRO + rate limit); o `ensurePortalAdmin` reaproveita
// esse mesmo `userId`/`email` sem round-trip extra ao GoTrue.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { diagnoseIgArt } from '@/lib/api/_services/ig-art-diag';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const g = await gateProAI(request, {}, {
    endpoint: 'ig-art-diag',
    limit: 10,
  });
  if (g instanceof NextResponse) return g;
  try {
    await ensurePortalAdmin({ callerId: g.userId || '', email: g.user?.email || '' });

    const testOpenAI =
      new URL(request.url).searchParams.get('openai') === '1';
    return NextResponse.json(await diagnoseIgArt({ testOpenAI }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('ig-art-diag crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

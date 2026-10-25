// /api/billing/sync — o app avisa "comprei/restaurei"; o SERVIDOR confere
// na RevenueCat e credita (lib/api/_services/revenuecat.ts). O corpo não
// traz produto nem transação de propósito: nada do que o app manda vira
// crédito. Idempotente — chamar de novo só relê o mesmo estado.

import { NextResponse, type NextRequest } from 'next/server';
import { requireAuthStrict, ServiceError, checkRateLimit, rateLimitResponse } from '@/lib/api/security';
import { sincronizarCompras, RevenueCatConfigError } from '@/lib/api/_services/revenuecat';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: { accessToken?: string } = {};
  try {
    body = (await request.json()) as { accessToken?: string };
  } catch {
    body = {};
  }
  let userId: string;
  try {
    const auth = await requireAuthStrict(request, body);
    userId = auth.user.id;
  } catch (e) {
    const status = e instanceof ServiceError ? e.status : 401;
    return NextResponse.json({ error: 'Faça login' }, { status });
  }
  const rl = await checkRateLimit({ userId, endpoint: 'billing-sync', limit: 10 });
  if (!rl.allowed) return rateLimitResponse(rl);
  try {
    const r = await sincronizarCompras(userId);
    return NextResponse.json({
      ok: true,
      creditados: r.creditados,
      conflitos: r.conflitos,
      assinatura: r.assinatura ? { status: r.assinatura.status, until: r.assinatura.until } : null,
    });
  } catch (e) {
    if (e instanceof RevenueCatConfigError) {
      console.error('[billing] sync sem configuração:', e.message);
      return NextResponse.json({ error: 'Compras ainda não configuradas no servidor.' }, { status: 503 });
    }
    console.error('[billing] sync falhou:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: 'Não consegui confirmar a compra agora. Ela não se perde: tente "Restaurar compras" em instantes.' },
      { status: 500 },
    );
  }
}

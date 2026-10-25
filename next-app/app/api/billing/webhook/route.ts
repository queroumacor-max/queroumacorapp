// /api/billing/webhook — RevenueCat avisa renovação, cancelamento,
// expiração, carência, reembolso e transferência. Autenticado pelo header
// Authorization que a gente define no painel da RevenueCat
// (REVENUECAT_WEBHOOK_AUTH). O corpo só diz QUEM reler: o estado vem da
// API da RevenueCat (ver revenuecat.ts). Falha → 500, e a RevenueCat
// reenvia; como tudo é idempotente, reenviar é seguro.

import { NextResponse, type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import { safeEqual } from '@/lib/api/_services/whatsapp';
import { processarEventoRevenueCat, type RcEvento } from '@/lib/api/_services/revenuecat';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const esperado = getRuntimeEnv('REVENUECAT_WEBHOOK_AUTH') || '';
  if (!esperado) {
    console.error('[billing] webhook sem REVENUECAT_WEBHOOK_AUTH — recusado');
    return NextResponse.json({ error: 'não configurado' }, { status: 503 });
  }
  const recebido = request.headers.get('authorization') || '';
  if (!safeEqual(recebido, esperado)) {
    return NextResponse.json({ error: 'não autorizado' }, { status: 401 });
  }
  const len = Number(request.headers.get('content-length') || '0');
  if (len > 256 * 1024) return NextResponse.json({ error: 'corpo grande demais' }, { status: 413 });
  let ev: RcEvento | undefined;
  try {
    const json = (await request.json()) as { event?: RcEvento };
    ev = json?.event;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!ev || typeof ev !== 'object') return NextResponse.json({ ok: true, ignorado: true });
  try {
    const r = await processarEventoRevenueCat(ev);
    console.log(`[billing] webhook ${ev.type} contas=${r.contas}${r.reembolso ? ` reembolso=${r.reembolso}` : ''}`);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('[billing] webhook falhou:', ev.type, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'falha ao processar' }, { status: 500 });
  }
}

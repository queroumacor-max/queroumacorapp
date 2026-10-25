// app/api/admin/billing/route.ts — "Compras no app" do portal (2026-10-25).
// Compras, assinantes e saldos com SERVICE ROLE (billing_balance/usage_debits
// têm RLS "cada um vê o seu"). Só admin do portal, com rate limit.

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  getServiceKey,
  getSupabaseUrl,
  getToken,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { gerarRelatorioDeCompras } from '@/lib/api/_services/admin-billing';
import { getRuntimeEnv } from '@/lib/api/env';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const serviceKey = getServiceKey();
  if (!serviceKey || !getRuntimeEnv('ADMIN_EMAILS')) {
    return jsonResponse({ error: 'Relatório de compras não configurado (faltam env vars)' }, 503);
  }
  let body: { accessToken?: unknown };
  try {
    body = (await readBody(request, { maxBytes: 64 * 1024 })) as typeof body;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  try {
    const token = getToken(request, body);
    const { callerId, email } = await verifyAdminToken(token);
    await ensurePortalAdmin({ callerId, email });
    const rl = await checkRateLimit({ userId: callerId || email, endpoint: 'admin-billing', limit: 30 });
    if (!rl.allowed) return rateLimitResponse(rl);
    const relatorio = await gerarRelatorioDeCompras({ supaUrl: getSupabaseUrl(), serviceKey });
    return jsonResponse({ ok: true, ...relatorio });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-billing crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

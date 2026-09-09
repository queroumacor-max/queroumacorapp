// app/api/admin/stats/route.ts — "Uso do app" do portal (2026-09-09).
// Agrega quem faz o que na plataforma com SERVICE ROLE (ai_usage/referrals
// têm RLS "cada um vê o seu"). Só admin da allowlist, com rate limit.

import { type NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  ensureAdminEmail,
  getServiceKey,
  getSupabaseUrl,
  getToken,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken } from '@/lib/api/_services/_admin-helpers';
import { gerarRelatorioDeUso } from '@/lib/api/_services/admin-stats';
import { getRuntimeEnv } from '@/lib/api/env';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const serviceKey = getServiceKey();
  if (!serviceKey || !getRuntimeEnv('ADMIN_EMAILS')) {
    return jsonResponse({ error: 'Relatório de uso não configurado (faltam env vars)' }, 503);
  }
  let body: { accessToken?: unknown; desde?: unknown };
  try {
    body = (await readBody(request, { maxBytes: 64 * 1024 })) as typeof body;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  try {
    const token = getToken(request, body);
    const { callerId, email } = await verifyAdminToken(token);
    ensureAdminEmail(email);
    const rl = await checkRateLimit({ userId: callerId || email, endpoint: 'admin-stats', limit: 30 });
    if (!rl.allowed) return rateLimitResponse(rl);
    const desde = typeof body.desde === 'string' ? body.desde : null;
    const relatorio = await gerarRelatorioDeUso({ supaUrl: getSupabaseUrl(), serviceKey, desde });
    return jsonResponse({ ok: true, ...relatorio });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('admin-stats crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

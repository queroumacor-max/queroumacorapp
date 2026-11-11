// POST /api/oportunidades/varrer — lê os murais cadastrados em
// `oportunidade_fontes` e grava os pedidos de pintor novos (ver
// lib/api/_services/mural-condominio.ts).
//
// Dois chamadores:
//  - o pg_cron do Supabase, 1x/dia (`run_oportunidades_varredura()`), com o
//    header `x-internal-secret` = PUSH_INTERNAL_SECRET (mesmo segredo do
//    /api/posts/sweep-pending);
//  - o botão "Ler todos agora" do portal, com o token de um admin no corpo.
//    Ele repete a chamada até dar a volta nos murais ativos (12 por chamada),
//    por isso o limite é 12/min: 4 travava a leitura completa no meio. Cada
//    mural continua sendo lido UMA vez por volta (fila por `lida_em`).

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import {
  checkRateLimit,
  getClientIp,
  getServiceKey,
  getSupabaseUrl,
  getToken,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { safeEqual } from '@/lib/api/_services/whatsapp';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { varrerMurais } from '@/lib/api/_services/mural-condominio';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  const serviceKey = getServiceKey();
  if (!serviceKey) return jsonResponse({ ok: false, error: 'desativado' }, 503);

  const segredo = getRuntimeEnv('PUSH_INTERNAL_SECRET');
  const enviado = request.headers.get('x-internal-secret') || '';
  const peloCron = !!segredo && !!enviado && safeEqual(enviado, segredo);

  try {
    let chave = `ip:${getClientIp(request)}`;
    if (!peloCron) {
      let body: { accessToken?: unknown } = {};
      try {
        body = (await readBody(request, { maxBytes: 16 * 1024 })) as typeof body;
      } catch (e) {
        if (e instanceof ServiceError) return serviceErrorResponse(e);
        return jsonResponse({ ok: false, error: 'JSON inválido' }, 400);
      }
      const { callerId, email } = await verifyAdminToken(getToken(request, body));
      await ensurePortalAdmin({ callerId, email });
      chave = callerId || email || chave;
    }
    const rl = await checkRateLimit({ userId: chave, endpoint: 'oportunidades-varrer', limit: 12 });
    if (!rl.allowed) return rateLimitResponse(rl);

    const r = await varrerMurais({ supaUrl: getSupabaseUrl(), serviceKey });
    console.log('[oportunidades-varrer]', JSON.stringify(r));
    return jsonResponse({ ok: true, ...r });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('[oportunidades-varrer] erro', e instanceof Error ? e.message : e);
    return jsonResponse({ ok: false, error: 'Não consegui ler os murais agora.' }, 500);
  }
}

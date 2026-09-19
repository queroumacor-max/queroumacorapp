// app/api/whatsapp/followup/route.ts — dispara a VARREDURA DE FOLLOW-UP
// (ver lib/api/_services/whatsapp-followup.ts).
//
// Substitui `/api/whatsapp-evo/followup`, que nasceu no tempo da Evolution
// API e ficou com o nome de um serviço aposentado. A rota antiga continua
// no ar delegando pra esta, porque `app_settings.whatsapp_followup_url`
// ainda pode estar apontando pra lá — trocar código e configuração ao mesmo
// tempo deixaria a varredura sem chamador no intervalo entre os dois.
//
// Dois chamadores, duas autenticações:
//
//   1. pg_cron do Supabase, de hora em hora, via pg_net:
//        POST /api/whatsapp/followup?token=<segredo>
//
//      O segredo é `WHATSAPP_FOLLOWUP_URL_SECRET`, PRÓPRIO desta rota
//      (achado L3 da auditoria de webhooks 2026-09-17: até 2026-09-18 essa
//      chamada reusava o `WHATSAPP_WEBHOOK_URL_SECRET` do webhook, o que
//      funcionava mas aumentava o raio de um vazamento — quem descobrisse o
//      segredo do webhook também disparava a varredura de follow-up).
//      Migração feita e confirmada em produção (`run_whatsapp_followup()`
//      rodado à mão com o token novo, resultado ok) em 2026-09-18: gerado
//      valor novo (`openssl rand -hex 24`), cadastrado no Cloudflare Pages,
//      e a URL em `app_settings.whatsapp_followup_url` trocada pro `?token=`
//      novo — ver `migrations/2026-09-18-whatsapp-followup-dedicated-secret
//      .sql`. Os fallbacks pro segredo do webhook e pro antigo
//      `EVOLUTION_WEBHOOK_TOKEN` (Evolution API, aposentada em 2026-09-05)
//      foram removidos depois dessa confirmação — não sobrou chamador
//      configurado com o segredo velho.
//
//   2. O portal, no botão "🔁 Follow-up agora", com o token do admin no
//      corpo. Aceita `dryRun` pra ver o que ACONTECERIA sem enviar nada.
//
// Sempre 200 pro cron (o resultado vem no corpo): erro aqui não pode virar
// retry em cascata no banco.

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import {
  checkRateLimit,
  getToken,
  jsonResponse,
  rateLimitResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { runFollowupSweep } from '@/lib/api/_services/whatsapp-followup';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

/**
 * Compara em tempo constante. O segredo do cron viaja na URL, então uma
 * comparação que sai no primeiro byte diferente vaza o prefixo pra quem
 * medir. Mesmo cuidado do `checkWebhookUrlSecret`.
 */
function segredoConfere(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: NextRequest) {
  let body: { accessToken?: unknown; dryRun?: unknown } = {};
  try {
    body = ((await readBody(request, { maxBytes: 8 * 1024 })) || {}) as typeof body;
  } catch {
    body = {}; // cron manda corpo vazio
  }

  const provided = request.nextUrl.searchParams.get('token') || '';
  const expected = getRuntimeEnv('WHATSAPP_FOLLOWUP_URL_SECRET') || '';
  const viaToken = Boolean(expected) && segredoConfere(expected, provided);

  if (!viaToken) {
    // Caminho 2: admin do portal.
    try {
      const token = getToken(request, body);
      const { callerId, email } = await verifyAdminToken(token);
      if (!callerId) throw new ServiceError('token inválido', 401);
      await ensurePortalAdmin({ callerId, email });
    } catch (e) {
      if (e instanceof ServiceError) return serviceErrorResponse(e);
      return jsonResponse({ error: 'não autorizado' }, 401);
    }
  }

  const dryRun = body?.dryRun === true;
  // Rate limit só na varredura de VERDADE (dryRun não manda nada). Chave
  // fixa e global (não por chamador): o que queremos limitar é QUANTAS
  // VEZES a varredura roda de verdade por minuto, não quem pediu — cron
  // hourly + um admin clicando "Rodar agora" cabem sobrando; um replay do
  // mesmo POST em rajada, não. Complementa a trava por isolate em
  // `runFollowupSweep` (que sozinha não cobre isolates diferentes).
  if (!dryRun) {
    const rl = await checkRateLimit({
      userId: 'whatsapp-followup-sweep',
      endpoint: 'whatsapp-followup-sweep',
      limit: 4,
    });
    if (!rl.allowed) return rateLimitResponse(rl);
  }

  const result = await runFollowupSweep({ dryRun });
  return jsonResponse(result);
}

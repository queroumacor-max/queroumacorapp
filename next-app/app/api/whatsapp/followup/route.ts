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
//        POST /api/whatsapp/followup?token=<WHATSAPP_WEBHOOK_URL_SECRET>
//
//      MUDANÇA IMPORTANTE (2026-09-05): antes o segredo era o
//      `EVOLUTION_WEBHOOK_TOKEN`. Essa env foi REMOVIDA do Cloudflare junto
//      com a aposentadoria da Evolution, e o efeito passou despercebido: sem
//      ela, `expected` fica vazio, o caminho do cron nunca autentica e a
//      chamada cai na exigência de token de admin — que o cron não tem.
//      Resultado: 403 de hora em hora, sem ninguém ver, e o follow-up parado.
//      Agora vale o `WHATSAPP_WEBHOOK_URL_SECRET` (o mesmo do webhook, que
//      existe e está em uso), com o token antigo ainda aceito pra não
//      quebrar quem já estiver configurado.
//
//   2. O portal, no botão "🔁 Follow-up agora", com o token do admin no
//      corpo. Aceita `dryRun` pra ver o que ACONTECERIA sem enviar nada.
//
// Sempre 200 pro cron (o resultado vem no corpo): erro aqui não pode virar
// retry em cascata no banco.

import { type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/lib/api/env';
import {
  getToken,
  jsonResponse,
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken, ensurePortalAdmin } from '@/lib/api/_services/_admin-helpers';
import { runFollowupSweep } from '@/lib/api/_services/whatsapp-followup';

export const runtime = 'edge';

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
  // Ordem: o segredo atual primeiro; o antigo fica só como ponte pra
  // configuração que ainda não foi trocada.
  const aceitos = [
    getRuntimeEnv('WHATSAPP_WEBHOOK_URL_SECRET') || '',
    getRuntimeEnv('EVOLUTION_WEBHOOK_TOKEN') || '',
  ].filter(Boolean);
  const viaToken = aceitos.some((s) => segredoConfere(s, provided));

  if (!viaToken) {
    // Caminho 2: admin do portal.
    try {
      const token = getToken(request, body);
      const { callerId, email, emailConfirmed } = await verifyAdminToken(token);
      if (!callerId) throw new ServiceError('token inválido', 401);
      await ensurePortalAdmin({ callerId, email, emailConfirmed });
    } catch (e) {
      if (e instanceof ServiceError) return serviceErrorResponse(e);
      return jsonResponse({ error: 'não autorizado' }, 401);
    }
  }

  const result = await runFollowupSweep({ dryRun: body?.dryRun === true });
  return jsonResponse(result);
}

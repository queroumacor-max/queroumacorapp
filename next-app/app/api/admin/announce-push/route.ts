// POST /api/admin/announce-push — "📲 Enviar push" de um Aviso do portal.
//
// Corpo: { accessToken, announcementId, publicos: string[], dryRun?: boolean }
//   - dryRun=true só CONTA (quantos perfis batem e quantos têm push ativo) —
//     o portal mostra isso antes de confirmar.
//   - publicos: 'todos' | 'pintor' | 'grafiteiro' | 'automotivo' | 'arquiteto' | 'cliente'
//   - pessoas: string[] (uuids, até 20) — "pessoa específica"; quando vem,
//     substitui `publicos`.
// Só admin do portal (allowlist OU portal_access OU role=admin). Detalhes em
// lib/api/_services/announce-push.ts.

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
import { getRuntimeEnv } from '@/lib/api/env';
import { logAuditEvent } from '@/lib/api/audit';
import {
  enviarEmLotes,
  escolherDestinatarios,
  MAX_PESSOAS_POR_ENVIO,
  payloadDoAviso,
  publicosValidos,
  pessoasValidas,
  destinatariosPorId,
} from '@/lib/api/_services/announce-push';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const serviceKey = getServiceKey();
  if (!serviceKey) return jsonResponse({ error: 'Push não configurado (falta a chave de serviço)' }, 503);

  let body: { accessToken?: unknown; announcementId?: unknown; publicos?: unknown; pessoas?: unknown; dryRun?: unknown };
  try {
    body = (await readBody(request, { maxBytes: 16 * 1024 })) as typeof body;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  try {
    const token = getToken(request, body);
    const { callerId, email } = await verifyAdminToken(token);
    await ensurePortalAdmin({ callerId, email });
    const rl = await checkRateLimit({ userId: callerId || email, endpoint: 'admin-announce-push', limit: 10 });
    if (!rl.allowed) return rateLimitResponse(rl);

    const id = typeof body.announcementId === 'string' ? body.announcementId : '';
    if (!UUID.test(id)) return jsonResponse({ error: 'Aviso inválido' }, 400);
    const pessoas = pessoasValidas(body.pessoas);
    const publicos = pessoas.length > 0 ? [] : publicosValidos(body.publicos);
    if (pessoas.length === 0 && publicos.length === 0) return jsonResponse({ error: 'Escolha quem vai receber' }, 400);
    const dryRun = body.dryRun === true;

    const supabaseUrl = getSupabaseUrl();
    const rest = { supabaseUrl, serviceKey };

    const avRes = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/rest/v1/announcements?select=id,title,message,active&id=eq.${id}`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!avRes.ok) return jsonResponse({ error: `Não consegui ler o aviso (${avRes.status})` }, 500);
    const aviso = ((await avRes.json()) as Array<{ id: string; title: string; message: string; active: boolean }>)[0];
    if (!aviso) return jsonResponse({ error: 'Aviso não encontrado' }, 404);
    if (!aviso.active) return jsonResponse({ error: 'Esse aviso está desativado. Ative antes de mandar o push.' }, 409);

    const dest = pessoas.length > 0
      ? await destinatariosPorId(rest, pessoas)
      : await escolherDestinatarios(rest, publicos);
    const resumo = { perfis: dest.perfis, comPush: dest.ids.length, publicos, pessoas: pessoas.length };
    if (dryRun) return jsonResponse({ ok: true, dryRun: true, ...resumo });

    if (dest.ids.length === 0) {
      return jsonResponse({ error: pessoas.length > 0
        ? 'Essa pessoa não está com as notificações ativadas no celular (nunca permitiu, ou desinstalou o app).'
        : 'Ninguém desse público está com as notificações ativadas.' }, 400);
    }
    if (dest.ids.length > MAX_PESSOAS_POR_ENVIO) {
      return jsonResponse(
        { error: `São ${dest.ids.length} pessoas; o limite por envio é ${MAX_PESSOAS_POR_ENVIO}. Escolha menos públicos e mande em partes.` },
        400,
      );
    }

    const vapidPublic = getRuntimeEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY') || getRuntimeEnv('VAPID_PUBLIC_KEY');
    const vapidPrivate = getRuntimeEnv('VAPID_PRIVATE_KEY');
    const fcmProjectId = getRuntimeEnv('FCM_PROJECT_ID');
    const fcmClientEmail = getRuntimeEnv('FCM_CLIENT_EMAIL');
    const fcmPrivateKey = getRuntimeEnv('FCM_PRIVATE_KEY');
    const web = vapidPublic && vapidPrivate
      ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: getRuntimeEnv('VAPID_SUBJECT') || 'mailto:loja@calicolors.com.br' }
      : null;
    const fcm = fcmProjectId && fcmClientEmail && fcmPrivateKey
      ? { projectId: fcmProjectId, clientEmail: fcmClientEmail, privateKeyPem: fcmPrivateKey }
      : null;
    if (!web && !fcm) return jsonResponse({ error: 'Push não configurado no servidor' }, 503);

    const r = await enviarEmLotes(dest.ids, payloadDoAviso(aviso), { supabaseUrl, serviceKey, web, fcm });

    await logAuditEvent({
      actorId: callerId || null,
      action: 'admin.announcement.push',
      targetTable: 'announcements',
      targetId: id,
      changes: { publicos, escolhidos: pessoas, pessoas: dest.ids.length, enviados: r.sent, aparelhos: r.total },
      request,
    }).catch(() => {});

    return jsonResponse({ ok: true, ...resumo, ...r });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('announce-push crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno ao enviar o push' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204 });
}

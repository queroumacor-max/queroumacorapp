// app/api/whatsapp-evo/suggest/route.ts — "✨ Sugerir resposta" do portal.
//
// Modo COPILOTO: o operador clica, a IA lê a conversa e devolve o texto —
// NADA é enviado aqui. Ele revisa, edita e manda pelo botão normal.
//
// Diferente do automático (webhook), este caminho ignora horário comercial
// e o teto diário: quem está pedindo é uma pessoa, na frente da tela. As
// travas de PREÇO/ORÇAMENTO continuam valendo — a resposta vem marcada
// como "precisa de humano" e o portal avisa em vez de fingir que resolveu.

import { type NextRequest } from 'next/server';
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
import { generateAiReply, isAiConfigured, type ConversationTurn } from '@/lib/api/_services/whatsapp-ai';

export const runtime = 'edge';

const TIMEOUT_MS = 8000;

export async function POST(request: NextRequest) {
  let body: { waId?: unknown; accessToken?: unknown };
  try {
    body = (await readBody(request, { maxBytes: 16 * 1024 })) as typeof body;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  try {
    const token = getToken(request, body);
    const { callerId, email, emailConfirmed } = await verifyAdminToken(token);
    if (!callerId) throw new ServiceError('token inválido', 401);
    await ensurePortalAdmin({ callerId, email, emailConfirmed });

    const rl = await checkRateLimit({ userId: callerId, endpoint: 'wa-suggest', limit: 60 });
    if (!rl.allowed) return rateLimitResponse(rl);

    if (!isAiConfigured()) {
      return jsonResponse({ error: 'IA não configurada (OPENAI_API_KEY ausente)' }, 503);
    }
    const waId = typeof body?.waId === 'string' ? body.waId.replace(/\D/g, '') : '';
    if (!waId) return jsonResponse({ error: 'waId obrigatório' }, 400);

    // Histórico + lead, via REST com service_role.
    const url = getSupabaseUrl().replace(/\/$/, '');
    const key = getServiceKey() || '';
    const h = { apikey: key, Authorization: `Bearer ${key}` };

    const msgsRes = await fetch(
      `${url}/rest/v1/whatsapp_messages?wa_id=eq.${encodeURIComponent(waId)}&select=direction,body&order=created_at.desc&limit=10`,
      { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const rows = msgsRes.ok ? ((await msgsRes.json()) as Array<{ direction: string; body: string | null }>) : [];
    const turns: ConversationTurn[] = rows
      .reverse()
      .filter((r) => (r.body || '').trim())
      .map((r) => ({ direction: r.direction === 'out' ? 'out' : 'in', body: r.body || '' }));

    if (turns.length === 0) {
      return jsonResponse({ error: 'conversa sem mensagens pra IA ler' }, 400);
    }

    const leadRes = await fetch(
      `${url}/rest/v1/leads?phone=ilike.*${encodeURIComponent(waId.slice(-8))}*&select=name,category,segment,city,neighborhood&limit=1`,
      { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const leads = leadRes.ok ? ((await leadRes.json()) as Array<Record<string, string | null>>) : [];

    // Prompt editado no portal (coluna nova; ausente → padrão do código).
    let promptBase: string | null = null;
    try {
      const cfgRes = await fetch(`${url}/rest/v1/whatsapp_ai_config?id=eq.1&select=prompt`, {
        headers: h, signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (cfgRes.ok) promptBase = ((await cfgRes.json()) as Array<{ prompt?: string | null }>)[0]?.prompt || null;
    } catch { /* fica no padrão */ }

    const result = await generateAiReply({ lead: leads[0] || null, turns, promptBase });
    return jsonResponse({
      ok: true,
      reply: result.reply,
      escalate: result.escalate,
      reason: result.reason,
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.error('wa-suggest:', e instanceof Error ? e.message : e);
    return jsonResponse({ error: 'erro interno' }, 500);
  }
}

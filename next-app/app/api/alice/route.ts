// app/api/alice/route.ts — chat com a Alice Codessi (designer de interiores).
// Versão non-PRO do /api/chat-ai pra cliente final logado. Mesma infra de
// rate-limit (20/min) + cota mensal de IA, MAIS um limite de 3/dia
// específico da Alice pra controlar custo (clientes podem ser muitos +
// queries longas). Na 3ª pergunta do dia, injeta hint pra Alice convidar
// pra Loja + WhatsApp da Cali Colors no fim da resposta. 4ª+ é bloqueada
// com 429 + link de redirect pra loja.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
  getServiceKey,
  getSupabaseUrl,
} from '@/lib/api/security';
import { chatWithPersona, ALICE_LAST_OF_DAY_HINT } from '@/lib/api/_services/chat-ai';
import { getAiUsageTodayViaRest } from '@/lib/api/_services/_billing-helpers';

export const runtime = 'edge';

const ALICE_DAILY_LIMIT = 3;

// Resposta amigável quando o cliente bate o limite. Inclui CTA pra loja
// e WhatsApp da Cali Colors — converte a query bloqueada em ação útil.
const LIMIT_REACHED_MESSAGE =
  'Você já fez suas 3 perguntas de hoje à Alice. Ela volta amanhã com novas ideias! Enquanto isso, dá uma olhada nas cores na nossa Loja Cali Colors (/loja) ou fala com nossa equipe no WhatsApp: https://wa.me/5511959765031';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' },
      { status: 503 }
    );
  }
  let body: { message?: unknown; history?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  // requirePro: false → só auth + rate-limit. Cliente final não tem PRO.
  const g = await gateProAI(request, body, {
    endpoint: 'alice',
    limit: 20,
    requirePro: false,
  });
  if (g instanceof NextResponse) return g;

  // Limite diário de 3 perguntas. Conta antes de chamar IA. Se já bateu,
  // retorna 429 com mensagem amigável + link pra loja.
  // Fail-open quando service key ou Supabase URL ausentes (não trava
  // user legítimo por falha de infra).
  const serviceKey = getServiceKey();
  let supaUrl: string | null = null;
  try { supaUrl = getSupabaseUrl(); } catch { supaUrl = null; }
  let usedToday = 0;
  if (serviceKey && supaUrl && g.userId) {
    usedToday = await getAiUsageTodayViaRest({
      supaUrl,
      serviceKey,
      userId: g.userId,
      feature: 'alice',
    });
  }
  if (usedToday >= ALICE_DAILY_LIMIT) {
    return NextResponse.json(
      {
        error: LIMIT_REACHED_MESSAGE,
        reply: LIMIT_REACHED_MESSAGE,
        limitReached: true,
        usedToday,
        dailyLimit: ALICE_DAILY_LIMIT,
        retry_after_hours: 24,
      },
      { status: 429, headers: { 'retry-after': String(60 * 60 * 24) } }
    );
  }

  // Cota mensal padrão (free=30/pro=500). Continua valendo — bloqueia se
  // cliente passou o mês inteiro fazendo 3 perguntas/dia (~90/mês).
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'alice',
  });
  if (aiGate instanceof NextResponse) return aiGate;

  // Se esta é a 3ª pergunta (usedToday == 2 ANTES de incrementar),
  // injeta hint pro prompt convidar pra loja/WhatsApp no fim.
  const isLastOfDay = usedToday === ALICE_DAILY_LIMIT - 1;

  try {
    const result = await chatWithPersona({
      persona: 'alice',
      message: body?.message,
      history: body?.history,
      extraSystemHint: isLastOfDay ? ALICE_LAST_OF_DAY_HINT : undefined,
    });
    await recordAiUsage({ userId: g.userId, feature: 'alice' });
    return NextResponse.json({
      ...result,
      usedToday: usedToday + 1,
      dailyLimit: ALICE_DAILY_LIMIT,
      isLastOfDay,
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('alice crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

// app/api/chat/moderate-message/route.ts — moderação de mensagem de chat
// DEPOIS do envio (2026-09-23). Responde 202 na hora; a moderação roda no
// servidor via `runAfterResponse`, então não depende do app do remetente
// continuar aberto. Detalhes em `lib/api/_services/chat-moderation.ts`.

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  checkRateLimit,
  gateAiUsage,
  rateLimitResponse,
  recordAiUsage,
  rejectOversizedBody,
  requireAuth,
} from '@/lib/api/security';
import { getRuntimeEnv, runAfterResponse } from '@/lib/api/env';
import { lerMensagem, moderarMensagemDeChat } from '@/lib/api/_services/chat-moderation';

export const runtime = 'nodejs';

const schema = z.object({
  messageId: z.string().uuid(),
  accessToken: z.string().min(1).max(2000).optional(),
});

export async function POST(request: NextRequest) {
  const grande = rejectOversizedBody(request, 8 * 1024);
  if (grande) return grande;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'messageId inválido' }, { status: 400 });

  const auth = await requireAuth(request, parsed.data);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });
  if (!auth.user) return NextResponse.json({ error: 'Faça login' }, { status: 401 });
  const userId = auth.user.id;

  // Sem chave do Gemini não há o que fazer — mesmo fail-open de /api/moderate.
  if (!getRuntimeEnv('GEMINI_API_KEY')) {
    return NextResponse.json({ ok: false, engine: 'none' }, { status: 503 });
  }

  const rl = await checkRateLimit({ userId, endpoint: 'chat-moderate', limit: 60 });
  if (!rl.allowed) return rateLimitResponse(rl);

  const msg = await lerMensagem(parsed.data.messageId);
  if (!msg) return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 });
  if (msg.sender_id !== userId) {
    return NextResponse.json({ error: 'Só o remetente pede a moderação' }, { status: 403 });
  }
  if (msg.type !== 'text' || msg.deleted_at) {
    return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
  }

  const gate = await gateAiUsage({ userId, email: auth.user.email, feature: 'moderate' });
  if (gate instanceof NextResponse) return gate;

  runAfterResponse(
    (async () => {
      const apagou = await moderarMensagemDeChat(msg);
      await recordAiUsage({ userId, feature: 'moderate' });
      if (apagou) console.warn('chat-moderate: mensagem removida', msg.id);
    })(),
  );
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}

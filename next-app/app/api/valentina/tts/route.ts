// app/api/valentina/tts/route.ts — TTS pra Valentina (non-PRO, voz feminina).
// Espelha /api/tts mas com requirePro: false. Voz default 'nova' (feminino
// acolhedor); caller pode forçar outra via body.voice mas a allowlist no
// service só aceita 6 vozes OpenAI.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { synthesizeSpeech } from '@/lib/api/_services/tts';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'TTS não configurado: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
  let body: { text?: unknown; voice?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'valentina-tts',
    limit: 10,
    requirePro: false,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'valentina_tts',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const { audio } = await synthesizeSpeech({
      text: body?.text,
      voice: typeof body?.voice === 'string' ? body.voice : 'nova',
    });
    await recordAiUsage({ userId: g.userId, feature: 'valentina_tts' });
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'content-type': 'audio/ogg; codecs=opus',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('valentina-tts crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

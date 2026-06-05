// app/api/tts/route.ts — port de `functions/api/tts.js`.
// Devolve audio/mpeg binário (não JSON).

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
  let body: { text?: unknown; accessToken?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, { endpoint: 'tts', limit: 10 });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({ userId: g.userId, email: g.user?.email, feature: 'tts' });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const { audio } = await synthesizeSpeech({ text: body?.text });
    await recordAiUsage({ userId: g.userId, feature: 'tts' });
    return new NextResponse(audio, {
      status: 200,
      headers: {
        // opus em container ogg — todos os browsers modernos suportam.
        // Menor que mp3 (download mais rápido em 4G).
        'content-type': 'audio/ogg; codecs=opus',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('tts crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

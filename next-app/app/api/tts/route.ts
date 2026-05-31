// app/api/tts/route.ts — port de `functions/api/tts.js`.
// Devolve audio/mpeg binário (não JSON).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
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
  try {
    const { audio } = await synthesizeSpeech({ text: body?.text });
    return new NextResponse(audio, {
      status: 200,
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('tts crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

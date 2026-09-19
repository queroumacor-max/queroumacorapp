// app/api/transcribe/route.ts — port de `functions/api/transcribe.js`. Multipart.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  gateAiUsage,
  recordAiUsage,
  rejectOversizedBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { transcribeAudio } from '@/lib/api/_services/transcribe';
import { getRuntimeEnv } from '../../../lib/api/env';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY')) {
    return NextResponse.json(
      { error: 'Transcrição não configurada: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
  // Auditoria 2026-09-13: pré-check de Content-Length — o teto de 25MB do áudio (Whisper) já existe em transcribe.ts, mas só é conferido DEPOIS de `request.formData()` bufferizar tudo.
  const oversized = rejectOversizedBody(request, 27 * 1024 * 1024);
  if (oversized) return oversized;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'FormData inválido' }, { status: 400 });
  }
  const g = await gateProAIForm(request, formData, {
    endpoint: 'transcribe',
    limit: 10,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'transcribe',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await transcribeAudio({ audio: formData.get('audio') });
    await recordAiUsage({ userId: g.userId, feature: 'transcribe' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('transcribe crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

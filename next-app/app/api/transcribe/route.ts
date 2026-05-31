// app/api/transcribe/route.ts — port de `functions/api/transcribe.js`. Multipart.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { transcribeAudio } from '@/lib/api/_services/transcribe';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Transcrição não configurada: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
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
  try {
    return NextResponse.json(
      await transcribeAudio({ audio: formData.get('audio') })
    );
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('transcribe crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

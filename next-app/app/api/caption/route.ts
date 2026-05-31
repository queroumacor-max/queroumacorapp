// app/api/caption/route.ts — port de `functions/api/caption.js`. Multipart.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { generateCaption } from '@/lib/api/_services/caption';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'IA não configurada: defina OPENAI_API_KEY' },
      { status: 503 }
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'multipart/form-data inválido' },
      { status: 400 }
    );
  }
  const g = await gateProAIForm(request, form, { endpoint: 'caption', limit: 10 });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'caption',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await generateCaption({ image: form.get('image') });
    await recordAiUsage({ userId: g.userId, feature: 'caption' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('caption crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

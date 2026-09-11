// app/api/receipt-ocr/route.ts — extrai itens + valores de foto de recibo.
// Multipart. PRO feature (gate via gateProAIForm + ai_usage tracking).

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAIForm,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
  readBody,
} from '@/lib/api/security';
import { ocrReceipt } from '@/lib/api/_services/receipt-ocr';
import { getRuntimeEnv } from '../../../lib/api/env';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY')) {
    return NextResponse.json(
      { error: 'IA de visão não configurada: defina OPENAI_API_KEY' },
      { status: 503 },
    );
  }
  let formData: FormData;
  try {
    formData = (await readBody(request, { maxBytes: 12 * 1024 * 1024, type: 'form' })) as FormData;
  } catch (e) {
    if (e instanceof ServiceError && e.status === 413) return serviceErrorResponse(e);
    return NextResponse.json({ error: 'FormData inválido' }, { status: 400 });
  }
  const g = await gateProAIForm(request, formData, {
    endpoint: 'receipt-ocr',
    limit: 30, // recibos rodam mais que area-from-photo; teto generoso.
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'receipt_ocr',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await ocrReceipt({ image: formData.get('image') });
    await recordAiUsage({ userId: g.userId, feature: 'receipt_ocr' });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('receipt-ocr crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

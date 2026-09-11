// app/api/generate-logo/route.ts — port de `functions/api/generate-logo.js`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  gateProAI,
  gateAiUsage,
  recordAiUsage,
  ServiceError,
  serviceErrorResponse,
  readBody,
} from '@/lib/api/security';
import { generateLogo } from '@/lib/api/_services/generate-logo';
import { persistBrandLogos } from '@/lib/api/_services/brand-logos';
import { getRuntimeEnv } from '../../../lib/api/env';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!getRuntimeEnv('OPENAI_API_KEY')) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY não configurada' },
      { status: 503 }
    );
  }
  let body: { name?: unknown; style?: unknown; accessToken?: unknown };
  try {
    body = (await readBody(request, { maxBytes: 64 * 1024 })) as typeof body;
  } catch (e) {
    if (e instanceof ServiceError && e.status === 413) return serviceErrorResponse(e);
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const g = await gateProAI(request, body, {
    endpoint: 'generate-logo',
    limit: 3,
  });
  if (g instanceof NextResponse) return g;
  const aiGate = await gateAiUsage({
    userId: g.userId,
    email: g.user?.email,
    feature: 'generate_logo',
  });
  if (aiGate instanceof NextResponse) return aiGate;
  try {
    const result = await generateLogo({ name: body?.name, style: body?.style });
    await recordAiUsage({ userId: g.userId, feature: 'generate_logo' });
    // A IA devolve base64. Materializa em arquivo no Storage e registra em
    // `brand_logos` — é o que sobrevive à sessão e o que o /portal lê pra
    // saber qual pintor pediu qual estampa. Best-effort: se falhar, `urls`
    // volta como veio da IA e a tela funciona igual.
    const urls = await persistBrandLogos({
      userId: g.userId,
      images: result.urls,
      promptName: typeof body?.name === 'string' ? body.name : undefined,
      promptStyle: typeof body?.style === 'string' ? body.style : undefined,
    });
    // `archived` = quantas das 3 viraram arquivo+linha. Serve de sonda:
    // dá pra ver na resposta se o arquivamento está funcionando sem abrir o
    // banco (foi o que faltou pra diagnosticar o 1º deploy).
    const archived = urls.filter((u) => u.includes('/logos/')).length;
    return NextResponse.json({ ...result, urls, archived });
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('generate-logo crash:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

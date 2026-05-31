// app/api/upload-style-ref/route.ts — port de `functions/api/upload-style-ref.js`.
// Admin upload de template visual de cada estilo de Arte IG.
//
// Aceita 2 content-types:
//   - `application/json`     → body `{ styleKey, photoDataUrl, accessToken? }`
//                              (compat com cliente vanilla)
//   - `multipart/form-data`  → fields `styleKey`, `file`, `accessToken?`
//                              (forma preferida; token pode vir no Authorization)

import { type NextRequest, NextResponse } from 'next/server';
import {
  ensureAdminEmail,
  getToken,
  getTokenFromForm,
  jsonResponse,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';
import { verifyAdminToken } from '@/lib/api/_services/_admin-helpers';
import { uploadStyleRef } from '@/lib/api/_services/upload-style-ref';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  if (!process.env.ADMIN_EMAILS) {
    return jsonResponse({ error: 'ADMIN_EMAILS não configurado' }, 503);
  }
  const contentType = request.headers.get('content-type') || '';
  try {
    let token: string;
    let styleKey = '';
    let photoDataUrl: string | undefined;
    let file: File | undefined;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      token = getTokenFromForm(request, form);
      const sk = form.get('styleKey');
      styleKey = typeof sk === 'string' ? sk.trim() : '';
      const f = form.get('file');
      if (f && typeof f === 'object' && 'arrayBuffer' in f) {
        file = f as File;
      }
    } else {
      let body: { styleKey?: unknown; photoDataUrl?: unknown; accessToken?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return jsonResponse({ error: 'JSON inválido' }, 400);
      }
      token = getToken(request, body);
      styleKey = typeof body?.styleKey === 'string' ? body.styleKey.trim() : '';
      photoDataUrl = typeof body?.photoDataUrl === 'string' ? body.photoDataUrl : '';
    }

    const { email } = await verifyAdminToken(token);
    ensureAdminEmail(email);
    return jsonResponse(await uploadStyleRef({ styleKey, photoDataUrl, file }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('upload-style-ref crash:', e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error: 'Erro interno',
        detail: String(e instanceof Error ? e.message : e).slice(0, 200),
      },
      { status: 500 }
    );
  }
}

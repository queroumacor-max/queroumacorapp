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
  readBody,
  ServiceError,
  serviceErrorResponse,
} from '@/lib/api/security';

// Cap específico pra style-refs: 4MB cobre PNG/JPG até ~3000x3000 com
// qualidade alta. Acima disso é abuso / bug do cliente. JSON branch
// trata o mesmo cap (photoDataUrl em base64 infla ~33%, então
// 4MB de raw image vira ~5.3MB de data URL — usamos 6MB pra JSON
// pra acomodar a inflação base64 sem rejeitar uploads legítimos).
const MAX_MULTIPART_BYTES = 4 * 1024 * 1024;
const MAX_JSON_BYTES = 6 * 1024 * 1024;
import { verifyAdminToken } from '@/lib/api/_services/_admin-helpers';
import { uploadStyleRef } from '@/lib/api/_services/upload-style-ref';
import { logAuditEvent } from '@/lib/api/audit';

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
      // Cheap gate via content-length antes do parse. Multipart legítimo
      // de imagem 4MB + boundary fica em ~5MB; pegamos um pouco mais por
      // segurança. Cap fino do File.size é feito pelo service (uploadStyleRef).
      const form = (await readBody(request, {
        type: 'form',
        maxBytes: MAX_MULTIPART_BYTES + 256 * 1024,
      })) as FormData;
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
        body = (await readBody(request, { maxBytes: MAX_JSON_BYTES })) as typeof body;
      } catch (e) {
        if (e instanceof ServiceError) return serviceErrorResponse(e);
        return jsonResponse({ error: 'JSON inválido' }, 400);
      }
      token = getToken(request, body);
      styleKey = typeof body?.styleKey === 'string' ? body.styleKey.trim() : '';
      photoDataUrl = typeof body?.photoDataUrl === 'string' ? body.photoDataUrl : '';
    }

    const { callerId, email } = await verifyAdminToken(token);
    ensureAdminEmail(email);
    const result = await uploadStyleRef({ styleKey, photoDataUrl, file });
    // Audit-log: upload de style-ref muda bucket público; rastreamos quem subiu o quê.
    await logAuditEvent({
      actorId: callerId || null,
      action: 'admin.style_ref.upload',
      targetTable: 'storage.objects',
      targetId: styleKey,
      changes: {
        admin_email: email,
        contentType: contentType.includes('multipart/form-data') ? 'multipart' : 'json',
        fileSize: file?.size ?? null,
      },
      request,
    });
    return jsonResponse(result);
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

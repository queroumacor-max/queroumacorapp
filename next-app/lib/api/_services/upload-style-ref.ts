// lib/api/_services/upload-style-ref.ts — port de
// `functions/api/_services/upload-style-ref.js`. Admin upload de template
// visual de cada estilo de Arte IG. Restrito a ADMIN — afeta TODOS os
// usuários (controller faz a verificação via `verifyAdminToken` +
// `ensureAdminEmail`).

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';

const ALLOWED_STYLES = ['portrait', 'antesdepois', 'profissional', 'trabalho', 'grafite'];
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 4 * 1024 * 1024; // 4MB

export interface UploadStyleRefResult {
  ok: true;
  url: string;
  styleKey: string;
  path: string;
}

/**
 * Suporta duas formas de entrada:
 *   1. `photoDataUrl: "data:image/...;base64,..."`  — compat com vanilla.
 *   2. `file: File` (multipart)                     — usado pelo route handler
 *                                                      do Next quando o cliente
 *                                                      manda FormData.
 *
 * Em ambos os casos: valida mime, tamanho, faz upsert no bucket `style-refs`
 * via service_role e limpa as outras extensões pra não conflitar.
 */
export async function uploadStyleRef(args: {
  styleKey: string;
  photoDataUrl?: string;
  file?: File;
}): Promise<UploadStyleRefResult> {
  const { styleKey } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('SUPABASE service role não configurado', 503);
  if (!ALLOWED_STYLES.includes(styleKey)) {
    throw new ServiceError('styleKey inválido', 400, { allowed: ALLOWED_STYLES });
  }

  let bytes: Uint8Array;
  let mime: string;

  if (args.file) {
    if (!ALLOWED_MIME.has(args.file.type)) {
      throw new ServiceError('mime inválido (aceita jpeg/png/webp)', 400, {
        allowed: [...ALLOWED_MIME],
      });
    }
    if (args.file.size > MAX_BYTES) {
      throw new ServiceError(`Imagem grande demais (máx ${MAX_BYTES / 1024 / 1024}MB)`, 413);
    }
    bytes = new Uint8Array(await args.file.arrayBuffer());
    mime = args.file.type;
  } else {
    const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      args.photoDataUrl || ''
    );
    if (!m) throw new ServiceError('photoDataUrl inválida', 400);
    mime = m[1];
    if (!ALLOWED_MIME.has(mime)) {
      throw new ServiceError('mime inválido (aceita jpeg/png/webp)', 400, {
        allowed: [...ALLOWED_MIME],
      });
    }
    const b64 = m[2].replace(/\s+/g, '');
    if ((b64.length * 3) / 4 > MAX_BYTES) {
      throw new ServiceError(`Imagem grande demais (máx ${MAX_BYTES / 1024 / 1024}MB)`, 413);
    }
    const binary = atob(b64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  }

  const supaUrl = getSupabaseUrl();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${styleKey}.${ext}`;
  const uploadUrl = `${supaUrl}/storage/v1/object/style-refs/${encodeURIComponent(path)}`;

  const r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': mime,
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=60',
    },
    body: bytes,
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 400);
    throw new ServiceError('Falha ao subir no storage', 502, { detail: `${r.status}: ${txt}` });
  }

  // Limpa as outras extensões pra não conflitar (jpg → png, etc).
  const otherExts = ['jpg', 'jpeg', 'png', 'webp'].filter((e) => e !== ext);
  await Promise.all(
    otherExts.map(async (e) => {
      try {
        await fetch(
          `${supaUrl}/storage/v1/object/style-refs/${encodeURIComponent(styleKey + '.' + e)}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${serviceKey}` } }
        );
      } catch {
        /* ignora 404 */
      }
    })
  );

  const publicUrl = `${supaUrl}/storage/v1/object/public/style-refs/${encodeURIComponent(
    path
  )}?v=${Date.now()}`;
  return { ok: true, url: publicUrl, styleKey, path };
}

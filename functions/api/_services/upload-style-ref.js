// @ts-check
// Business logic — upload de template visual de cada estilo de Arte IG.
// Restrito a ADMIN (controller faz a verificação) — afeta TODOS os usuários.
// Pipeline: valida payload → upload pro bucket style-refs no Supabase storage
// (service_role) → devolve URL pública.
import { ServiceError, FALLBACK_SUPABASE_URL } from '../_security.js';
import { getServiceKey } from './_admin.js';

const ALLOWED_STYLES = ['portrait', 'antesdepois', 'profissional', 'trabalho', 'grafite'];
const MAX_BYTES = 4 * 1024 * 1024; // 4MB max

/**
 * @param {{ env: Record<string,string>, styleKey: string, photoDataUrl: string }} args
 * @returns {Promise<{ ok: true, url: string, styleKey: string, path: string }>}
 */
export async function uploadStyleRef({ env, styleKey, photoDataUrl }) {
  const serviceKey = getServiceKey(env);
  if (!serviceKey) throw new ServiceError('SUPABASE service role não configurado', 503);
  if (!ALLOWED_STYLES.includes(styleKey)) {
    throw new ServiceError('styleKey inválido', 400, { allowed: ALLOWED_STYLES });
  }
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoDataUrl || '');
  if (!m) throw new ServiceError('photoDataUrl inválida', 400);
  const mime = m[1];
  const b64 = m[2].replace(/\s+/g, '');
  if ((b64.length * 3 / 4) > MAX_BYTES) {
    throw new ServiceError(`Imagem grande demais (máx ${MAX_BYTES / 1024 / 1024}MB)`, 413);
  }

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const path = `${styleKey}.${ext}`;
  const uploadUrl = `${supaUrl}/storage/v1/object/style-refs/${encodeURIComponent(path)}`;

  const r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': mime,
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=60'
    },
    body: bytes
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 400);
    throw new ServiceError('Falha ao subir no storage', 502, { detail: `${r.status}: ${txt}` });
  }

  // Limpa as outras extensões pra não conflitar (se trocou jpg → png)
  const otherExts = ['jpg', 'jpeg', 'png', 'webp'].filter(e => e !== ext);
  for (const e of otherExts) {
    try {
      await fetch(`${supaUrl}/storage/v1/object/style-refs/${encodeURIComponent(styleKey + '.' + e)}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + serviceKey }
      });
    } catch { /* ignora 404 */ }
  }

  const publicUrl = `${supaUrl}/storage/v1/object/public/style-refs/${encodeURIComponent(path)}?v=${Date.now()}`;
  return { ok: true, url: publicUrl, styleKey, path };
}

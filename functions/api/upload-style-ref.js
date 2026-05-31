// @ts-check
// Controller fino — admin upload de template de cada estilo de Arte IG.
// Business logic em `./_services/upload-style-ref.js`. Affecta TODOS os
// usuários, então valida ADMIN_EMAILS antes.
import { jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { verifyAdminToken, isAdminEmail } from './_services/_admin.js';
import { uploadStyleRef } from './_services/upload-style-ref.js';

/**
 * @param {{ request: Request, env: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.ADMIN_EMAILS) return json({ error: 'ADMIN_EMAILS não configurado' }, 503);
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  let body; try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  try {
    const { email } = await verifyAdminToken({ env, accessToken });
    if (!isAdminEmail(env, email)) {
      throw new ServiceError('Acesso negado — só admin pode trocar templates', 403);
    }
    return json(await uploadStyleRef({
      env,
      styleKey: String(body?.styleKey || '').trim(),
      photoDataUrl: typeof body?.photoDataUrl === 'string' ? body.photoDataUrl : ''
    }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('upload-style-ref crash:', e && e.message);
    return json({ error: 'Erro interno', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
}

// @ts-check
// Controller fino — transcrição de áudio via Whisper. Lógica em `./_services/transcribe.js`.
import { gateProAIForm, jsonResponse as json, serviceErrorResponse, ServiceError } from './_security.js';
import { transcribeAudio } from './_services/transcribe.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost({ env, request }) {
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'Transcrição não configurada: defina OPENAI_API_KEY' }, 503);
  }
  let formData; try { formData = await request.formData(); } catch { return json({ error: 'FormData inválido' }, 400); }
  const g = await gateProAIForm(env, request, formData, { endpoint: 'transcribe', limit: 10 });
  if (g instanceof Response) return g;
  try {
    return json(await transcribeAudio({ env, audio: formData.get('audio') }));
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    console.warn('transcribe crash:', e && e.message);
    return json({ error: 'Erro interno' }, 500);
  }
}

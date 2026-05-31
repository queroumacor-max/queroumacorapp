// @ts-check
// Business logic — estimativa de metragem pintável via OpenAI gpt-4o-mini vision.
import { ServiceError } from '../_security.js';
import { imageToDataUrl } from './_shared.js';

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT = `Você é um pintor brasileiro experiente, mestre de obra, que olha uma foto de parede/cômodo/teto e estima a METRAGEM QUADRADA PINTÁVEL visível na foto, em m².

REGRAS:
- Considere APENAS a área pintável visível na foto (paredes, teto, superfícies de alvenaria/gesso/drywall).
- EXCLUA aberturas: janelas, portas, vidros, espelhos, móveis grandes embutidos.
- Use referências visuais (altura padrão de pé-direito 2,60m–2,80m, largura de portas ~0,80m, etc.) para calibrar.
- Seja CONSERVADOR: na dúvida entre dois valores, escolha o menor. É melhor subestimar.
- A estimativa é APROXIMADA. O usuário vai revisar manualmente.
- Se a foto não mostrar uma área pintável clara (ex.: foto só de objetos, paisagem externa sem parede, foto muito escura/borrada), devolva area_m2 = 0 e explique brevemente.

RESPONDA SOMENTE com JSON estrito no formato:
{"area_m2": <number>, "justification": "<uma frase curta em português brasileiro explicando o que foi estimado>"}

Sem markdown, sem texto antes ou depois. area_m2 deve ser um número (pode ter casas decimais). justification deve ser uma única frase curta (até ~120 caracteres).`;

/**
 * @param {{ env: Record<string,string>, image: File|Blob|null|string }} args
 * @returns {Promise<{ area_m2: number, justification: string }>}
 */
export async function estimateAreaFromPhoto({ env, image }) {
  if (!image || typeof image === 'string') {
    throw new ServiceError('image obrigatório (multipart com arquivo de imagem)', 400);
  }
  const size = image.size || 0;
  if (size <= 0) throw new ServiceError('Imagem vazia', 400);
  if (size > MAX_BYTES) throw new ServiceError('Imagem acima de 8 MB', 413);

  let dataUrl;
  try {
    dataUrl = await imageToDataUrl(image);
  } catch (e) {
    throw new ServiceError('Falha ao ler imagem: ' + String(e?.message || e), 400);
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Estime a metragem pintável visível nesta foto, em m². Lembre-se: seja conservador e exclua janelas/portas.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ] }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 200
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 300);
      console.warn('area-from-photo OpenAI error', r.status, errText);
      throw new ServiceError('IA indisponível — tente de novo em instantes', 502);
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!raw) throw new ServiceError('IA não retornou conteúdo', 502);

    let parsed;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch {
      throw new ServiceError('Resposta da IA não é JSON válido', 502);
    }
    const area = Number(parsed?.area_m2);
    const justification = String(parsed?.justification || '').trim().slice(0, 200);
    if (!isFinite(area) || area < 0) {
      throw new ServiceError('IA não devolveu uma metragem válida', 502);
    }
    return {
      area_m2: Math.round(area * 10) / 10,
      justification: justification || 'Estimativa visual aproximada — revise antes de comprar.'
    };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('OpenAI timeout (25s) — tente de novo', 504);
    throw new ServiceError('OpenAI: ' + String(e?.message || e), 502);
  }
}

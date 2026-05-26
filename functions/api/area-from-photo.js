// Estimativa de metragem por foto: recebe multipart com o campo 'image'
// (foto de parede/cômodo/teto) e devolve { area_m2, justification } via
// OpenAI gpt-4o-mini (vision). Requer OPENAI_API_KEY no Cloudflare Pages.
// A estimativa é APROXIMADA — o app avisa o usuário para revisar.
import { gateProAIForm, jsonResponse as json } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA de visão não configurada: defina OPENAI_API_KEY' }, 503);
  }

  let formData;
  try { formData = await request.formData(); }
  catch { return json({ error: 'FormData inválido' }, 400); }

  const g = await gateProAIForm(env, request, formData, { endpoint: 'area-from-photo', limit: 5 });
  if (g instanceof Response) return g;

  const image = formData.get('image');
  if (!image || typeof image === 'string') {
    return json({ error: 'image obrigatório (multipart com arquivo de imagem)' }, 400);
  }

  const size = image.size || 0;
  if (size <= 0) return json({ error: 'Imagem vazia' }, 400);
  if (size > 8 * 1024 * 1024) return json({ error: 'Imagem acima de 8 MB' }, 413);

  // Lê o arquivo e gera data URL base64
  let dataUrl;
  try {
    const buf = await image.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Conversão eficiente em chunks para evitar estouro do call stack
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    const b64 = btoa(bin);
    const mime = (image.type && /^image\//.test(image.type)) ? image.type : 'image/jpeg';
    dataUrl = `data:${mime};base64,${b64}`;
  } catch (e) {
    return json({ error: 'Falha ao ler imagem: ' + String(e?.message || e) }, 400);
  }

  const systemPrompt = `Você é um pintor brasileiro experiente, mestre de obra, que olha uma foto de parede/cômodo/teto e estima a METRAGEM QUADRADA PINTÁVEL visível na foto, em m².

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

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Estime a metragem pintável visível nesta foto, em m². Lembre-se: seja conservador e exclua janelas/portas.' },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 200
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!r.ok) {
      const errText = (await r.text()).slice(0, 300);
      console.warn('area-from-photo OpenAI error', r.status, errText);
      return json({ error: 'IA indisponível — tente de novo em instantes' }, 502);
    }

    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!raw) return json({ error: 'IA não retornou conteúdo' }, 502);

    let parsed;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch {
      return json({ error: 'Resposta da IA não é JSON válido' }, 502);
    }

    const area = Number(parsed?.area_m2);
    const justification = String(parsed?.justification || '').trim().slice(0, 200);
    if (!isFinite(area) || area < 0) {
      return json({ error: 'IA não devolveu uma metragem válida' }, 502);
    }

    return json({
      area_m2: Math.round(area * 10) / 10,
      justification: justification || 'Estimativa visual aproximada — revise antes de comprar.'
    });
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) return json({ error: 'OpenAI timeout (25s) — tente de novo' }, 504);
    return json({ error: 'OpenAI: ' + String(e?.message || e) }, 502);
  }
}

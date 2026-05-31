// @ts-check
// Business logic — gera legenda + hashtags pra post de portfólio.
import { ServiceError } from '../_security.js';
import { imageToDataUrl } from './_shared.js';

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT = `Você é um pintor brasileiro que manda muito bem em redes sociais e cria legendas envolventes para posts de portfólio de pintura e decoração.
A partir da FOTO enviada, identifique o estilo/efeito (ex.: pintura de parede, fachada, textura grafiato, marmorato, cimento queimado, epóxi, demarcação, mural/grafite, decoração, móvel pintado etc.) e escreva natural, em primeira pessoa quando fizer sentido, em português brasileiro.

REGRAS DE RESPOSTA (rígidas):
- Devolva SOMENTE um objeto JSON válido, sem markdown, sem texto fora do JSON.
- Formato exato: {"caption":"<1 a 2 frases em pt-br>","hashtags":["#tag1","#tag2","#tag3","#tag4"]}
- "caption": 1 a 2 frases curtas (até ~220 caracteres no total), em pt-br, com no máximo 1 emoji pontual (opcional).
- "hashtags": de 4 a 6 hashtags em pt-br, todas começando com "#", sem espaço, sem acento, em minúsculas (ex.: "#pintura", "#texturagrafiato", "#fachada"). Sem repetir hashtag.
- Nada de promessa de preço, nada de dados pessoais, nada de link.`;

/**
 * @param {{ env: Record<string,string>, image: File|Blob|null|string }} args
 * @returns {Promise<{ caption: string, hashtags: string[] }>}
 */
export async function generateCaption({ env, image }) {
  if (!image || typeof image === 'string') throw new ServiceError('campo "image" obrigatório', 400);
  const size = image.size || 0;
  if (size === 0) throw new ServiceError('imagem vazia', 400);
  if (size > MAX_BYTES) throw new ServiceError('imagem maior que 8 MB', 413);
  const mime = (image.type || 'image/jpeg').split(';')[0] || 'image/jpeg';
  if (!/^image\//i.test(mime)) throw new ServiceError('arquivo não é imagem', 400);

  let dataUrl;
  try { dataUrl = await imageToDataUrl(image); }
  catch (e) { throw new ServiceError('falha lendo imagem: ' + String(e?.message || e), 400); }

  let raw = '';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Gere a legenda e as hashtags para esta foto do meu portfólio de pintura/decoração.' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ] }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 400
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('caption OpenAI error', r.status, txt);
      throw new ServiceError('IA indisponível — tente de novo em instantes', 502);
    }
    const data = await r.json();
    raw = data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('OpenAI timeout (25s) — tente de novo', 504);
    throw new ServiceError('OpenAI: ' + String(e?.message || e), 502);
  }

  if (!raw) throw new ServiceError('IA não respondeu', 502);
  let parsed;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    throw new ServiceError('Resposta da IA não é JSON válido', 502);
  }
  const caption = sanitizeCaption(parsed?.caption);
  const hashtags = sanitizeHashtags(parsed?.hashtags);
  if (!caption && hashtags.length === 0) throw new ServiceError('IA devolveu vazio', 502);
  return { caption, hashtags };
}

function sanitizeCaption(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function sanitizeHashtags(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    let t = item.trim();
    if (!t) continue;
    if (!t.startsWith('#')) t = '#' + t;
    t = '#' + t.slice(1).replace(/\s+/g, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (t.length <= 1) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

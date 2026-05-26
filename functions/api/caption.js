// Gera legenda + hashtags em PT-BR para um post de portfólio a partir de uma foto.
// POST multipart/form-data com campo "image" (foto, <= 8 MB).
// Resposta: { caption: string, hashtags: string[] } (4-6 hashtags em PT-BR).
// Requer OPENAI_API_KEY no Cloudflare Pages.
import { gateProAIForm, jsonResponse as json } from './_security.js';

const MAX_BYTES = 8 * 1024 * 1024;

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY no Cloudflare Pages' }, 503);
  }

  let form;
  try { form = await request.formData(); }
  catch { return json({ error: 'multipart/form-data inválido' }, 400); }

  const g = await gateProAIForm(env, request, form, { endpoint: 'caption', limit: 10 });
  if (g instanceof Response) return g;

  const image = form.get('image');
  if (!image || typeof image === 'string') {
    return json({ error: 'campo "image" obrigatório' }, 400);
  }

  const size = image.size || 0;
  if (size === 0) return json({ error: 'imagem vazia' }, 400);
  if (size > MAX_BYTES) return json({ error: 'imagem maior que 8 MB' }, 413);

  const mime = (image.type || 'image/jpeg').split(';')[0] || 'image/jpeg';
  if (!/^image\//i.test(mime)) return json({ error: 'arquivo não é imagem' }, 400);

  let dataUrl;
  try {
    const buf = await image.arrayBuffer();
    const b64 = arrayBufferToBase64(buf);
    dataUrl = `data:${mime};base64,${b64}`;
  } catch (e) {
    return json({ error: 'falha lendo imagem: ' + String(e?.message || e) }, 400);
  }

  const systemPrompt = `Você é um pintor brasileiro que manda muito bem em redes sociais e cria legendas envolventes para posts de portfólio de pintura e decoração.
A partir da FOTO enviada, identifique o estilo/efeito (ex.: pintura de parede, fachada, textura grafiato, marmorato, cimento queimado, epóxi, demarcação, mural/grafite, decoração, móvel pintado etc.) e escreva natural, em primeira pessoa quando fizer sentido, em português brasileiro.

REGRAS DE RESPOSTA (rígidas):
- Devolva SOMENTE um objeto JSON válido, sem markdown, sem texto fora do JSON.
- Formato exato: {"caption":"<1 a 2 frases em pt-br>","hashtags":["#tag1","#tag2","#tag3","#tag4"]}
- "caption": 1 a 2 frases curtas (até ~220 caracteres no total), em pt-br, com no máximo 1 emoji pontual (opcional).
- "hashtags": de 4 a 6 hashtags em pt-br, todas começando com "#", sem espaço, sem acento, em minúsculas (ex.: "#pintura", "#texturagrafiato", "#fachada"). Sem repetir hashtag.
- Nada de promessa de preço, nada de dados pessoais, nada de link.`;

  const userText = 'Gere a legenda e as hashtags para esta foto do meu portfólio de pintura/decoração.';

  let raw = '';
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              { type: 'image_url', image_url: { url: dataUrl } }
            ]
          }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 400
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 200);
      return json({ error: `OpenAI ${r.status}: ${txt}` }, 502);
    }
    const data = await r.json();
    raw = data?.choices?.[0]?.message?.content?.trim() || '';
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) return json({ error: 'OpenAI timeout (25s) — tente de novo' }, 504);
    return json({ error: 'OpenAI: ' + String(e?.message || e) }, 502);
  }

  if (!raw) return json({ error: 'IA não respondeu' }, 502);

  let parsed;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    return json({ error: 'Resposta da IA não é JSON válido' }, 502);
  }

  const caption = sanitizeCaption(parsed?.caption);
  const hashtags = sanitizeHashtags(parsed?.hashtags);

  if (!caption && hashtags.length === 0) {
    return json({ error: 'IA devolveu vazio' }, 502);
  }

  return json({ caption, hashtags });
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
    // remove espaços internos e caracteres exóticos
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

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

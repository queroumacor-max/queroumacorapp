// Resolve a cor (hex) de produtos de tinta a partir do nome/código.
// Usa OpenAI; cai para Gemini. Requer OPENAI_API_KEY ou GEMINI_API_KEY.
// POST { items: [{ id, name, code }] }  ->  { colors: { id: "#rrggbb" | null } }
import { requireAuth, requirePro, checkRateLimit, rateLimitResponse } from './_security.js';

const GEMINI_MODEL = 'gemini-2.5-flash';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + PRO check (fail-open)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const rl = await checkRateLimit(env, auth.user && auth.user.id, 'resolve-color', 30);
  if (!rl.allowed) return rateLimitResponse(rl);

  const items = Array.isArray(body?.items) ? body.items.slice(0, 60) : [];
  if (items.length === 0) return json({ colors: {} });

  const list = items.map(it => ({
    id: String(it?.id ?? '').slice(0, 80),
    name: String(it?.name ?? '').slice(0, 160),
    code: String(it?.code ?? '').slice(0, 40)
  })).filter(it => it.id && it.name);

  const systemPrompt = `Você é um especialista em tintas e cores de marcas brasileiras e internacionais (Suvinil, Coral, Sherwin-Williams, Colorgin, Lukscolor, Metalatex, etc.).
Para cada produto, com base no NOME e CÓDIGO, deduza a cor real aproximada do produto e devolva o hexadecimal correspondente.
Regras:
- Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem markdown.
- Formato: { "<id>": "#rrggbb", ... } usando exatamente os ids recebidos.
- Use 6 dígitos hex com #. Ex: "#f5f5f0".
- Se o produto NÃO for uma cor (ex.: ferramenta, fita, solvente, massa, acessório) ou for impossível deduzir, use null.
- Para códigos conhecidos (ex.: SW 7063 = Nebulous White) use a cor real da marca.
- Não invente cores vivas para produtos neutros; tinta de parede costuma ser tom suave.
- DIFERENCIE variações da mesma cor base: "Vermelho Ferrari", "Vermelho Goiaba" e "Vermelho Malagueta" são vermelhos DIFERENTES — cada nome único deve ter um hex próprio. NUNCA repita o mesmo hex para nomes de cor diferentes; ajuste o tom conforme o qualificador (ex.: Goiaba mais rosado, Malagueta mais alaranjado/escuro, Ferrari vermelho puro vivo).`;

  const userPrompt = 'Produtos:\n' + list.map(it =>
    `- id="${it.id}" nome="${it.name}"${it.code ? ` codigo="${it.code}"` : ''}`
  ).join('\n');

  let raw = '';
  let lastError = '';

  if (env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
          max_tokens: 2000
        })
      });
      if (r.ok) {
        const data = await r.json();
        raw = data?.choices?.[0]?.message?.content?.trim() || '';
      } else {
        lastError = `OpenAI ${r.status}: ${(await r.text()).slice(0, 150)}`;
      }
    } catch (e) {
      lastError = 'OpenAI: ' + String(e?.message || e);
    }
  }

  if (!raw && env.GEMINI_API_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 2048 }
          })
        }
      );
      if (r.ok) {
        const data = await r.json();
        raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      } else {
        lastError = `Gemini ${r.status}: ${(await r.text()).slice(0, 150)}`;
      }
    } catch (e) {
      lastError = 'Gemini: ' + String(e?.message || e);
    }
  }

  if (!raw) return json({ error: lastError || 'IA não respondeu' }, 502);

  let parsed;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    return json({ error: 'Resposta da IA não é JSON válido' }, 502);
  }

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const colors = {};
  for (const it of list) {
    const v = parsed[it.id];
    colors[it.id] = (typeof v === 'string' && HEX.test(v.trim())) ? v.trim().toLowerCase() : null;
  }
  return json({ colors });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

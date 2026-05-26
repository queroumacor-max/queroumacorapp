// @ts-check
// Resolve a cor (hex) de produtos de tinta a partir do nome/código.
// Usa OpenAI; cai para Gemini. Requer OPENAI_API_KEY ou GEMINI_API_KEY.
// POST { items: [{ id, name, code }] }  ->  { colors: { id: "#rrggbb" | null } }
import { gateProAI, jsonResponse as json } from './_security.js';
import { callAIText } from './_ai.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const g = await gateProAI(env, request, body, { endpoint: 'resolve-color', limit: 30 });
  if (g instanceof Response) return g;

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

  const { text: raw, error } = await callAIText({
    env, systemPrompt, userMessage: userPrompt,
    temperature: 0,
    maxTokens: 2000,
    json: true
  });

  if (!raw) return json({ error: error || 'IA não respondeu' }, 502);

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

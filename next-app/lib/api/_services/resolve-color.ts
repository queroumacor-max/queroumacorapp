// lib/api/_services/resolve-color.ts — port de
// `functions/api/_services/resolve-color.js`. Resolve nome → hex via IA.

import { ServiceError } from '../security';
import { callAIText } from '../_ai';

const SYSTEM_PROMPT = `Você é um especialista em tintas e cores de marcas brasileiras e internacionais (Suvinil, Coral, Sherwin-Williams, Colorgin, Lukscolor, Metalatex, etc.).
Para cada produto, com base no NOME e CÓDIGO, deduza a cor real aproximada do produto e devolva o hexadecimal correspondente.
Regras:
- Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem markdown.
- Formato: { "<id>": "#rrggbb", ... } usando exatamente os ids recebidos.
- Use 6 dígitos hex com #. Ex: "#f5f5f0".
- Se o produto NÃO for uma cor (ex.: ferramenta, fita, solvente, massa, acessório) ou for impossível deduzir, use null.
- Para códigos conhecidos (ex.: SW 7063 = Nebulous White) use a cor real da marca.
- Não invente cores vivas para produtos neutros; tinta de parede costuma ser tom suave.
- DIFERENCIE variações da mesma cor base: "Vermelho Ferrari", "Vermelho Goiaba" e "Vermelho Malagueta" são vermelhos DIFERENTES — cada nome único deve ter um hex próprio. NUNCA repita o mesmo hex para nomes de cor diferentes; ajuste o tom conforme o qualificador (ex.: Goiaba mais rosado, Malagueta mais alaranjado/escuro, Ferrari vermelho puro vivo).`;

const HEX = /^#[0-9a-fA-F]{6}$/;

interface ItemIn {
  id?: unknown;
  name?: unknown;
  code?: unknown;
}

export async function resolveColors(args: {
  items?: unknown;
}): Promise<{ colors: Record<string, string | null> }> {
  const arr = Array.isArray(args.items) ? args.items.slice(0, 60) : [];
  if (arr.length === 0) return { colors: {} };

  const list = arr
    .map((it: ItemIn) => ({
      id: String(it?.id ?? '').slice(0, 80),
      name: String(it?.name ?? '').slice(0, 160),
      code: String(it?.code ?? '').slice(0, 40),
    }))
    .filter((it) => it.id && it.name);
  if (list.length === 0) return { colors: {} };

  const userPrompt =
    'Produtos:\n' +
    list
      .map(
        (it) =>
          `- id="${it.id}" nome="${it.name}"${it.code ? ` codigo="${it.code}"` : ''}`
      )
      .join('\n');

  const { text: raw, error } = await callAIText({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: userPrompt,
    temperature: 0,
    maxTokens: 2000,
    json: true,
  });
  if (!raw) throw new ServiceError(error || 'IA não respondeu', 502);

  let parsed: Record<string, unknown>;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw) as Record<string, unknown>;
  } catch {
    throw new ServiceError('Resposta da IA não é JSON válido', 502);
  }

  const colors: Record<string, string | null> = {};
  for (const it of list) {
    const v = parsed[it.id];
    colors[it.id] =
      typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : null;
  }
  return { colors };
}

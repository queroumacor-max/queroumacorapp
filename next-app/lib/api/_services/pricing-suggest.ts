// lib/api/_services/pricing-suggest.ts — port de
// `functions/api/_services/pricing-suggest.js`. Sugere preço com correção
// determinística quando IA erra a aritmética.

import { ServiceError } from '../security';

const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT = `Você é um mestre pintor brasileiro experiente, que orça serviços residenciais de pintura e revestimento em Reais (BRL). Atua principalmente em zonas urbanas de São Paulo e Rio de Janeiro.

Você considera:
- Tipo de serviço: pintura interna, pintura externa, fachada, textura (grafiato, marmorato, monocapa), piso epóxi, microcimento, esmalte sobre madeira/metal, etc.
- Escopo descrito pelo profissional/cliente: número de cômodos, preparação (massa, lixamento, selador), número de demãos, condição da superfície (mofo, infiltração, descascamento).
- Área em m² quando informada (use a área informada; só estime se não vier).
- Mão de obra + material, padrão de mercado SP/RJ urbano.

Faixas de referência (mão de obra + material, R$/m²):
- Pintura interna simples: R$ 25 a R$ 45 / m²
- Pintura externa / fachada: R$ 35 a R$ 60 / m²
- Textura (grafiato, monocapa): R$ 45 a R$ 90 / m²
- Marmorato / cimento queimado / microcimento: R$ 90 a R$ 220 / m²
- Piso epóxi residencial: R$ 80 a R$ 160 / m²
- Esmalte sobre portas/grades: R$ 40 a R$ 80 / m²

Estimativas de área típicas para residencial quando o cliente só dá cômodos:
- 1 quarto/sala (paredes + teto): ~25 m²
- 1 banheiro: ~15 m²
- 1 cozinha: ~20 m²
- Fachada de casa simples: ~60 m²

Seja realista — nem barato demais, nem absurdo. Ofereça uma mediana justa de mercado.

REGRA CRÍTICA — A MATEMÁTICA TEM QUE FECHAR:
"price" DEVE ser exatamente igual a round(area_m2 × rate_brl_per_m2) + extras_brl.
Confira a conta antes de responder. Ex.: 75 m² × R$ 25/m² = R$ 1.875 (não R$ 375).
Nunca arredonde para uma "ordem de grandeza" diferente do produto area × rate.

Responda APENAS em JSON estrito, neste formato exato:
{
  "area_m2": <número total de m² considerado>,
  "rate_brl_per_m2": <número R$ por m² usado, dentro das faixas acima>,
  "extras_brl": <número de custos fixos adicionais em R$, ex: massa corrida, ou 0>,
  "price": <número total em BRL = round(area_m2 × rate_brl_per_m2) + extras_brl>,
  "justification": "<uma frase curta em PT-BR, máx 180 caracteres, mencionando os m², o R$/m² e o tipo de serviço>"
}`;

export async function suggestPricing(args: {
  service_type?: unknown;
  description?: unknown;
  area_m2?: unknown;
}): Promise<{ price: number; justification: string }> {
  const serviceType =
    typeof args.service_type === 'string'
      ? args.service_type.trim().slice(0, 200)
      : '';
  const desc =
    typeof args.description === 'string'
      ? args.description.trim().slice(0, 2000)
      : '';
  const areaIn = args.area_m2;
  const area =
    areaIn === null || areaIn === undefined || areaIn === ''
      ? null
      : Number.isFinite(+(areaIn as number))
        ? +(areaIn as number)
        : null;
  if (!serviceType && !desc && !area) {
    throw new ServiceError(
      'Informe ao menos service_type, description ou area_m2',
      400
    );
  }

  const parts: string[] = [];
  if (serviceType) parts.push('Tipo de serviço: ' + serviceType);
  if (area && area > 0) parts.push('Área: ' + area + ' m²');
  if (desc) parts.push('Descrição do escopo:\n' + desc);
  const userMessage =
    'Sugira o preço total (R$) deste orçamento de pintura:\n\n' + parts.join('\n');

  const key = process.env.OPENAI_API_KEY;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 300);
      console.warn('pricing-suggest OpenAI error', r.status, errText);
      throw new ServiceError(
        'IA indisponível — tente de novo em instantes',
        502
      );
    }
    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (data?.choices?.[0]?.message?.content || '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceError('Resposta da IA não foi JSON válido', 502);
    }
    return finalizePricing(parsed, serviceType);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('OpenAI timeout (25s) — tente de novo', 504);
    }
    console.warn('pricing-suggest err:', e instanceof Error ? e.message : e);
    throw new ServiceError('Falha ao chamar a IA', 502);
  }
}

export function finalizePricing(
  parsed: unknown,
  serviceType: string
): { price: number; justification: string } {
  const p = parsed as {
    price?: unknown;
    area_m2?: unknown;
    rate_brl_per_m2?: unknown;
    extras_brl?: unknown;
    justification?: unknown;
  };
  const aiPrice = Number(p?.price);
  const aiArea = Number(p?.area_m2);
  const aiRate = Number(p?.rate_brl_per_m2);
  const aiExtras = Number(p?.extras_brl) || 0;
  let justification =
    typeof p?.justification === 'string' ? p.justification.trim() : '';

  if (!Number.isFinite(aiPrice) || aiPrice <= 0) {
    throw new ServiceError('IA não retornou um preço válido', 502);
  }
  let finalPrice = Math.round(aiPrice);
  if (
    Number.isFinite(aiArea) &&
    aiArea > 0 &&
    Number.isFinite(aiRate) &&
    aiRate > 0
  ) {
    const expected = Math.round(
      aiArea * aiRate + (Number.isFinite(aiExtras) ? aiExtras : 0)
    );
    const drift = Math.abs(expected - aiPrice) / Math.max(expected, 1);
    if (drift > 0.15) {
      console.warn('pricing-suggest: price mismatch corrigido', {
        aiPrice,
        expected,
        aiArea,
        aiRate,
        aiExtras,
      });
      finalPrice = expected;
      const areaTxt =
        aiArea % 1 === 0 ? String(aiArea) : aiArea.toFixed(1).replace('.', ',');
      const rateTxt =
        aiRate % 1 === 0 ? String(aiRate) : aiRate.toFixed(2).replace('.', ',');
      const svc = serviceType || 'o serviço descrito';
      justification = `Considerando ${areaTxt} m² a R$ ${rateTxt}/m² para ${svc}.`;
      if (Number.isFinite(aiExtras) && aiExtras > 0) {
        justification += ` + R$ ${Math.round(aiExtras)} de extras.`;
      }
    }
  }
  return {
    price: finalPrice,
    justification:
      justification ||
      'Estimativa com base no tipo de serviço, escopo descrito e área informada.',
  };
}

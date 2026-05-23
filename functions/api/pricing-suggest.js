// Sugestão de preço para orçamento de pintura.
// Recebe { service_type, description, area_m2 } e retorna
// { price: <number BRL>, justification: "<frase curta em PT-BR>" }.
// Usa OpenAI gpt-4o-mini com response_format json_object.
// Pattern: ver functions/api/chat-ai.js.
import { requireAuth, requirePro } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY no Cloudflare Pages' }, 502);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + PRO check (fail-open)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const serviceType = typeof body?.service_type === 'string' ? body.service_type.trim().slice(0, 200) : '';
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 2000) : '';
  const areaRaw = body?.area_m2;
  const area = (areaRaw === null || areaRaw === undefined || areaRaw === '')
    ? null
    : (Number.isFinite(+areaRaw) ? +areaRaw : null);

  if (!serviceType && !description && !area) {
    return json({ error: 'Informe ao menos service_type, description ou area_m2' }, 400);
  }

  const systemPrompt = `Você é um mestre pintor brasileiro experiente, que orça serviços residenciais de pintura e revestimento em Reais (BRL). Atua principalmente em zonas urbanas de São Paulo e Rio de Janeiro.

Você considera:
- Tipo de serviço: pintura interna, pintura externa, fachada, textura (grafiato, marmorato, monocapa), piso epóxi, microcimento, esmalte sobre madeira/metal, etc.
- Escopo descrito pelo profissional/cliente: número de cômodos, preparação (massa, lixamento, selador), número de demãos, condição da superfície (mofo, infiltração, descascamento).
- Área em m² quando informada.
- Mão de obra + material, padrão de mercado SP/RJ urbano.

Faixas de referência (mão de obra + material, R$/m²):
- Pintura interna simples: R$ 25 a R$ 45 / m²
- Pintura externa / fachada: R$ 35 a R$ 60 / m²
- Textura (grafiato, monocapa): R$ 45 a R$ 90 / m²
- Marmorato / cimento queimado / microcimento: R$ 90 a R$ 220 / m²
- Piso epóxi residencial: R$ 80 a R$ 160 / m²
- Esmalte sobre portas/grades: R$ 40 a R$ 80 / m²

Seja realista — nem barato demais, nem absurdo. Ofereça uma mediana justa de mercado. Quando faltar área, estime pelo escopo descrito.

Responda APENAS em JSON estrito, no formato:
{"price": <número em BRL, sem texto>, "justification": "<uma frase curta em português brasileiro explicando o cálculo>"}

A "justification" deve ter no máximo 180 caracteres, em uma única frase.`;

  const parts = [];
  if (serviceType) parts.push('Tipo de serviço: ' + serviceType);
  if (area && area > 0) parts.push('Área: ' + area + ' m²');
  if (description) parts.push('Descrição do escopo:\n' + description);
  const userMessage = 'Sugira o preço total (R$) deste orçamento de pintura:\n\n' + parts.join('\n');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 200);
      return json({ error: `OpenAI ${r.status}: ${errText}` }, 502);
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      return json({ error: 'Resposta da IA não foi JSON válido' }, 502);
    }
    const price = Number(parsed?.price);
    const justification = typeof parsed?.justification === 'string' ? parsed.justification.trim() : '';
    if (!Number.isFinite(price) || price <= 0) {
      return json({ error: 'IA não retornou um preço válido' }, 502);
    }
    return json({
      price: Math.round(price),
      justification: justification || 'Estimativa com base no tipo de serviço, escopo descrito e área informada.'
    });
  } catch (e) {
    return json({ error: 'Falha ao chamar a IA: ' + String(e?.message || e) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

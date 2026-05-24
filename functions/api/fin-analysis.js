// Análise financeira IA — recebe agregados do mês atual e anterior + amostra
// de jobs recentes e devolve 3-4 frases curtas em PT-BR com margem, tendência
// e uma recomendação acionável. Não inventa números.
import { requireAuth, requirePro, checkRateLimit, rateLimitResponse, jsonResponse as json } from './_security.js';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + PRO check (fail-open)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const rl = await checkRateLimit(env, auth.user && auth.user.id, 'fin-analysis', 5);
  if (!rl.allowed) return rateLimitResponse(rl);

  const sanitizeAgg = (a) => {
    const o = a && typeof a === 'object' ? a : {};
    return {
      receita: Number(o.receita) || 0,
      custos: Number(o.custos) || 0,
      lucro: Number(o.lucro) || 0,
      jobsCount: Number(o.jobsCount) || 0
    };
  };
  const thisMonth = sanitizeAgg(body?.thisMonth);
  const lastMonth = sanitizeAgg(body?.lastMonth);
  const recentJobs = Array.isArray(body?.recentJobs)
    ? body.recentJobs.slice(0, 12).map(j => ({
        service_type: String((j && j.service_type) || 'Projeto').slice(0, 80),
        revenue: Number(j && j.revenue) || 0,
        material_cost: Number(j && j.material_cost) || 0
      }))
    : [];

  const systemPrompt = `Você é um analista financeiro especializado em pintores autônomos brasileiros.
Receberá os números agregados dos últimos 30 dias (thisMonth) e dos 30 dias anteriores (lastMonth),
além de uma amostra de projetos recentes (recentJobs). Cada agregado tem:
- receita (R$ recebido)
- custos (R$ gasto em material)
- lucro (receita - custos)
- jobsCount (quantos projetos concluídos)

Produza uma análise CONCISA de 3 a 4 frases em português brasileiro, em texto corrido (sem listas, sem markdown, sem negrito, sem títulos). Inclua, nessa ordem:
1) a margem de lucro do mês atual em % (calcule lucro/receita*100 quando receita>0; se receita=0, diga que não houve receita);
2) a tendência comparando com o mês anterior (melhor ou pior, e por quê — receita, custos ou volume de projetos);
3) UMA recomendação prática e específica para o próximo mês, baseada nos dados.

Regras rígidas:
- Use SOMENTE os números fornecidos. NÃO invente valores, projetos, clientes ou prazos.
- Se faltarem dados (mês anterior zerado, sem jobs), diga isso de forma curta.
- Tom: direto, profissional, próximo, como um consultor pragmático. Sem floreio, sem emoji, sem "olá".
- Valores em R$ no padrão brasileiro (vírgula como decimal). Arredonde % para 1 casa.
- Resposta total: 3 a 4 frases. Nada mais.`;

  const userPayload = JSON.stringify({ thisMonth, lastMonth, recentJobs });

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
          { role: 'user', content: `Dados:\n${userPayload}\n\nResponda em JSON: {"analysis": "<3 a 4 frases>"}` }
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      })
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 200);
      return json({ error: `OpenAI ${r.status}: ${txt}` }, 502);
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!raw) return json({ error: 'IA retornou vazio' }, 502);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return json({ error: 'Resposta IA inválida' }, 502); }
    const analysis = typeof parsed?.analysis === 'string' ? parsed.analysis.trim() : '';
    if (!analysis) return json({ error: 'Resposta IA sem análise' }, 502);
    return json({ analysis });
  } catch (e) {
    return json({ error: 'OpenAI: ' + String(e?.message || e) }, 502);
  }
}

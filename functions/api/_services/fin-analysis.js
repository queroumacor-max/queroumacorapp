// @ts-check
// Business logic — análise financeira IA (3-4 frases sobre margem, tendência, recomendação).
import { ServiceError } from '../_security.js';

const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT = `Você é um analista financeiro especializado em pintores autônomos brasileiros.
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

function sanitizeAgg(a) {
  const o = a && typeof a === 'object' ? a : {};
  return {
    receita: Number(o.receita) || 0,
    custos: Number(o.custos) || 0,
    lucro: Number(o.lucro) || 0,
    jobsCount: Number(o.jobsCount) || 0
  };
}

/**
 * @param {{ env: Record<string,string>, thisMonth?: any, lastMonth?: any, recentJobs?: any }} args
 * @returns {Promise<{ analysis: string }>}
 */
export async function analyzeFinancials({ env, thisMonth, lastMonth, recentJobs }) {
  const tm = sanitizeAgg(thisMonth);
  const lm = sanitizeAgg(lastMonth);
  const rj = Array.isArray(recentJobs)
    ? recentJobs.slice(0, 12).map(j => ({
        service_type: String((j && j.service_type) || 'Projeto').slice(0, 80),
        revenue: Number(j && j.revenue) || 0,
        material_cost: Number(j && j.material_cost) || 0
      }))
    : [];

  const userPayload = JSON.stringify({ thisMonth: tm, lastMonth: lm, recentJobs: rj });

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Dados:\n${userPayload}\n\nResponda em JSON: {"analysis": "<3 a 4 frases>"}` }
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('fin-analysis OpenAI error', r.status, txt);
      throw new ServiceError('IA indisponível — tente de novo em instantes', 502);
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    if (!raw) throw new ServiceError('IA retornou vazio', 502);
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new ServiceError('Resposta IA inválida', 502); }
    const analysis = typeof parsed?.analysis === 'string' ? parsed.analysis.trim() : '';
    if (!analysis) throw new ServiceError('Resposta IA sem análise', 502);
    return { analysis };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) throw new ServiceError('OpenAI timeout (25s) — tente de novo', 504);
    throw new ServiceError('OpenAI: ' + String(e?.message || e), 502);
  }
}

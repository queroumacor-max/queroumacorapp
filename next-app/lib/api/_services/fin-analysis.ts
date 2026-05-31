// lib/api/_services/fin-analysis.ts — port de
// `functions/api/_services/fin-analysis.js`. Análise financeira via OpenAI.

import { ServiceError } from '../security';

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

interface Aggregate {
  receita: number;
  custos: number;
  lucro: number;
  jobsCount: number;
}

function sanitizeAgg(a: unknown): Aggregate {
  const o = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  return {
    receita: Number(o.receita) || 0,
    custos: Number(o.custos) || 0,
    lucro: Number(o.lucro) || 0,
    jobsCount: Number(o.jobsCount) || 0,
  };
}

export async function analyzeFinancials(args: {
  thisMonth?: unknown;
  lastMonth?: unknown;
  recentJobs?: unknown;
}): Promise<{ analysis: string }> {
  const tm = sanitizeAgg(args.thisMonth);
  const lm = sanitizeAgg(args.lastMonth);
  const rj = Array.isArray(args.recentJobs)
    ? args.recentJobs.slice(0, 12).map((j) => {
        const obj = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
        return {
          service_type: String(obj.service_type || 'Projeto').slice(0, 80),
          revenue: Number(obj.revenue) || 0,
          material_cost: Number(obj.material_cost) || 0,
        };
      })
    : [];

  const userPayload = JSON.stringify({ thisMonth: tm, lastMonth: lm, recentJobs: rj });
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
          {
            role: 'user',
            content: `Dados:\n${userPayload}\n\nResponda em JSON: {"analysis": "<3 a 4 frases>"}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      const txt = (await r.text()).slice(0, 300);
      console.warn('fin-analysis OpenAI error', r.status, txt);
      throw new ServiceError(
        'IA indisponível — tente de novo em instantes',
        502
      );
    }
    const data = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = (data?.choices?.[0]?.message?.content || '').trim();
    if (!raw) throw new ServiceError('IA retornou vazio', 502);
    let parsed: { analysis?: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ServiceError('Resposta IA inválida', 502);
    }
    const analysis =
      typeof parsed?.analysis === 'string' ? parsed.analysis.trim() : '';
    if (!analysis) throw new ServiceError('Resposta IA sem análise', 502);
    return { analysis };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('OpenAI timeout (25s) — tente de novo', 504);
    }
    throw new ServiceError(
      'OpenAI: ' + (e instanceof Error ? e.message : String(e)),
      502
    );
  }
}

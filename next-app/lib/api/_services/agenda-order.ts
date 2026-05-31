// lib/api/_services/agenda-order.ts — port de
// `functions/api/_services/agenda-order.js`. Otimiza ordem das visitas do dia.

import { ServiceError } from '../security';
import { callAIText } from '../_ai';

const SYSTEM_PROMPT = `Você é um pintor brasileiro experiente, com cabeça de logística, que precisa visitar várias obras no mesmo dia. Seu trabalho é colocar as visitas na ordem que minimiza o tempo total de deslocamento, considerando APENAS o texto dos endereços (cidade, bairro, região, CEP se houver) e seu conhecimento geral da geografia das cidades brasileiras (zonas Norte/Sul/Leste/Oeste/Central, bairros vizinhos, eixos viários conhecidos).
Regras:
- Você NÃO tem GPS nem mapa real — é uma heurística baseada em conhecimento das cidades.
- Mantenha exatamente os MESMOS IDs recebidos na entrada; apenas reordene. NÃO invente, NÃO remova, NÃO duplique IDs.
- Considere o horário (scheduled_time) só como peso leve: se uma obra tem hora marcada cedo, ela tende a vir antes; mas a prioridade é minimizar deslocamento.
- Responda SOMENTE com JSON válido, sem markdown, no formato:
  {"ordered_ids": ["<id>", "<id>", ...], "notes": "<1 a 2 frases em português explicando a ordem (ex.: começa pela zona sul, depois sobe pro centro)>"}
- "notes" curto, no máximo 2 frases, em PT-BR.`;

interface CleanJob {
  id: string;
  client_name: string;
  address: string;
  scheduled_time: string;
}

export async function orderAgenda(args: {
  date?: unknown;
  jobs?: unknown;
}): Promise<{ ordered_ids: string[]; notes: string }> {
  const cleanDate = typeof args.date === 'string' ? args.date.slice(0, 10) : '';
  const rawJobs = Array.isArray(args.jobs) ? args.jobs.slice(0, 40) : [];
  const cleanJobs: CleanJob[] = rawJobs
    .map((j) => {
      const obj = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
      return {
        id: String(obj.id ?? '').slice(0, 80),
        client_name: String(obj.client_name ?? '').slice(0, 120),
        address: String(obj.address ?? '').slice(0, 240),
        scheduled_time: String(obj.scheduled_time ?? '').slice(0, 10),
      };
    })
    .filter((j) => j.id);

  if (cleanJobs.length < 2) {
    throw new ServiceError('Envie ao menos 2 obras com id', 400);
  }

  const validIds = new Set(cleanJobs.map((j) => j.id));
  const userPrompt =
    `Data: ${cleanDate || '(sem data)'}\nObras do dia:\n` +
    cleanJobs
      .map(
        (j) =>
          `- id="${j.id}" cliente="${j.client_name}" endereco="${j.address}"${j.scheduled_time ? ` hora="${j.scheduled_time}"` : ''}`
      )
      .join('\n');

  const { text: raw, error } = await callAIText({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: userPrompt,
    temperature: 0.2,
    maxTokens: 800,
    json: true,
  });
  if (!raw) throw new ServiceError(error || 'IA não respondeu', 502);

  let parsed: { ordered_ids?: unknown; notes?: unknown } | undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        /* ignore */
      }
    }
  }
  if (!parsed || !Array.isArray(parsed.ordered_ids)) {
    throw new ServiceError('Resposta da IA inválida', 502);
  }

  // Sanitiza: mantém só ids válidos, sem duplicar, completa com os faltantes.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of parsed.ordered_ids) {
    const s = String(id);
    if (validIds.has(s) && !seen.has(s)) {
      ordered.push(s);
      seen.add(s);
    }
  }
  for (const j of cleanJobs) {
    if (!seen.has(j.id)) {
      ordered.push(j.id);
      seen.add(j.id);
    }
  }
  const notes =
    typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 400) : '';
  return { ordered_ids: ordered, notes };
}

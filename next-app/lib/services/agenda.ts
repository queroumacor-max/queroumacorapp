// agenda.ts — service layer para a tabela `jobs` (calendário do pintor /
// obras agendadas). Espelha o comportamento de modules/agenda.js do vanilla
// (loadAgenda, salvarJob, updateJobStatus, otimizarDiaAgenda), mas sem o
// acoplamento DOM/global: cada função é pura (recebe params, devolve dado
// ou estoura erro tipado).
//
// Schema (supabase_init.sql linha 613-627): jobs(id, painter_id, quote_id,
// client_name, service_type, address, scheduled_date (date), scheduled_time
// (text livre), status default 'agendado', notes, revenue, material_cost,
// created_at). RLS (linha 636): só o painter dono (`auth.uid()=painter_id`)
// pode ler/escrever — todas as funções aqui assumem que o painterId passado
// é o do usuário logado (UI não deve permitir mexer em jobs de outros).
//
// fetchJobsByMonth filtra por intervalo de mês (em vez de trazer todos os
// 500 jobs como o vanilla fazia) porque o calendário só renderiza um mês
// por vez — economiza banda em pintores com muito histórico.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import type { Job, JobInput, JobStatus } from '@/lib/types';

// Colunas que a agenda renderiza. Mesmo subset do vanilla (modules/agenda.js
// linha 27) — sem `notes`/`material_cost`/`revenue` aqui porque a lista do
// dia mostra esses campos só quando o usuário expande/edita; pra evitar
// trazer payload desnecessário no fetch do mês, deixamos fora.
const JOB_COLS =
  'id, painter_id, status, scheduled_date, scheduled_time, client_name, service_type, address, revenue, material_cost, created_at';

// Cap pra defender de pintor com históricos absurdos. 500 é o mesmo limite
// do vanilla — em prática um mês raramente passa de 60 jobs.
const MONTH_LIMIT = 500;

/**
 * Formata Date → "YYYY-MM-DD" no fuso local (sem shift UTC). Usado pra
 * montar o range [primeiro dia, primeiro dia do próximo mês) que a query
 * `gte/lt` consome. Mesma lógica de agYmd em utils.ts.
 */
function localYmd(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Busca os jobs do pintor em um mês específico (year/month, 1-12).
 * Retorna [] se painterId vazio (consistente com fetchPedidos/fetchLeads).
 *
 * O filtro é `scheduled_date >= primeiro_dia_mes AND < primeiro_dia_proximo_mes`
 * — abrange tudo do dia 1 até o último, inclusive. Jobs com scheduled_date
 * NULL são ignorados (não aparecem no calendário).
 */
export async function fetchJobsByMonth(
  painterId: string,
  year: number,
  month: number // 1-12 (humano), NÃO 0-11 do Date
): Promise<Job[]> {
  if (!painterId) return [];
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new ValidationError('Ano inválido', { field: 'year' });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ValidationError('Mês inválido (use 1-12)', { field: 'month' });
  }

  // month vem 1-12, Date espera 0-11. start = dia 1; end = dia 1 do próximo
  // mês (Date overflow handles dezembro → janeiro do ano seguinte).
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const startKey = localYmd(start);
  const endKey = localYmd(end);

  const sb = getSupabase();
  const { data, error } = await sb
    .from('jobs')
    .select(JOB_COLS)
    .eq('painter_id', painterId)
    .gte('scheduled_date', startKey)
    .lt('scheduled_date', endKey)
    .order('scheduled_date', { ascending: true })
    .limit(MONTH_LIMIT);

  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data ?? []) as Job[];
}

/**
 * Cria um novo job pro pintor. painter_id vem como parâmetro (não do form)
 * pra fechar a porta de "UI grava em nome de outro pintor" — RLS já bloqueia
 * no banco, mas a defesa em camadas evita request rejeitado pelo servidor
 * quando dá pra falhar antes.
 *
 * Validação mínima local: client_name obrigatório (mesma regra de salvarJob
 * no vanilla). O resto pode ser null/vazio — o usuário preenche depois.
 */
export async function createJob(
  painterId: string,
  input: JobInput
): Promise<Job> {
  if (!painterId) throw new ValidationError('Faça login para criar projetos.');
  const clientName = (input.client_name || '').trim();
  if (!clientName) {
    throw new ValidationError('Informe o cliente', { field: 'client_name' });
  }

  const row = {
    painter_id: painterId,
    client_name: clientName,
    service_type: input.service_type || null,
    address: input.address || null,
    scheduled_date: input.scheduled_date || null,
    scheduled_time: input.scheduled_time || null,
    notes: input.notes || null,
    revenue: input.revenue ?? 0,
    material_cost: input.material_cost ?? 0,
    // status default 'agendado' vem do banco — não setamos aqui pra que
    // mudança futura no default não exija mexer no client.
  };

  const sb = getSupabase();
  const { data, error } = await sb
    .from('jobs')
    .insert(row)
    .select(JOB_COLS)
    .single();

  if (error) {
    throw new NetworkError(error.message, error);
  }
  if (!data) {
    throw new NetworkError('Insert retornou vazio');
  }
  return data as Job;
}

/**
 * Atualiza o status de um job. O `eq('painter_id', painterId)` é redundante
 * com a RLS mas dá camada de defesa contra bug client-side que tentasse
 * mexer no job de outro pintor.
 *
 * Retorna void — chamadores fazem invalidação via TanStack Query, não
 * precisam do row atualizado.
 */
export async function updateJobStatus(
  jobId: string,
  painterId: string,
  status: JobStatus
): Promise<void> {
  if (!jobId) throw new ValidationError('Job inválido', { field: 'jobId' });
  if (!painterId) {
    throw new ValidationError('Pintor inválido', { field: 'painterId' });
  }

  const sb = getSupabase();
  const { error } = await sb
    .from('jobs')
    .update({ status })
    .eq('id', jobId)
    .eq('painter_id', painterId);

  if (error) {
    throw new NetworkError(error.message, error);
  }
}

// Shape do que /api/agenda-order devolve em sucesso. Backend (vanilla
// functions/api/agenda-order.js + _services/agenda-order.js) retorna
// `{ ordered_ids: string[], notes?: string }`. Espelha o que o frontend
// renderiza em modules/agenda.js linha 178+.
export interface OptimizeDayResult {
  ordered_ids: string[];
  notes?: string;
}

/**
 * Chama /api/agenda-order (IA) pra otimizar a ordem das visitas do dia.
 * Recebe os jobs do dia (já filtrados em memória pelo caller) e pede pra
 * IA reordenar baseado em endereço/cliente/hora.
 *
 * Estoura ValidationError se a lista tem menos de 2 jobs (regra do produto:
 * < 2 não precisa otimizar) ou NetworkError se a request falhar / payload
 * inválido. O gating PRO acontece no servidor (gateProAI) — o client mostra
 * o botão só pra PRO mas a checagem final é server-side.
 */
export async function optimizeDayOrder(
  date: string,
  jobs: Job[]
): Promise<OptimizeDayResult> {
  if (!date) throw new ValidationError('Data inválida', { field: 'date' });
  if (!Array.isArray(jobs) || jobs.length < 2) {
    throw new ValidationError('Precisa de 2+ obras no mesmo dia.');
  }

  // Payload enxuto: só o que a IA precisa pra ordenar. id como string pra
  // bater com o que o backend espera (UUID serializa nativamente).
  const payload = {
    date,
    jobs: jobs.map((j) => ({
      id: String(j.id),
      client_name: j.client_name || '',
      address: j.address || '',
      scheduled_time: j.scheduled_time || '',
    })),
  };

  let res: Response;
  try {
    res = await fetch('/api/agenda-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao otimizar dia', e);
  }

  // Tenta parsear JSON mesmo em erro pra surfar mensagem legível do backend
  // (ex.: "PRO necessário", "Rate limit excedido", "IA não configurada").
  let data: { ordered_ids?: unknown; notes?: unknown; error?: unknown } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Resposta sem JSON — segue pra erro genérico abaixo.
  }

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : 'Erro ao otimizar';
    throw new NetworkError(msg);
  }
  if (!Array.isArray(data.ordered_ids)) {
    throw new NetworkError('Resposta inválida do otimizador');
  }

  return {
    ordered_ids: data.ordered_ids.map((id) => String(id)),
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

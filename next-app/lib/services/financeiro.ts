// financeiro.ts — service layer pra feature "Financeiro" (dashboard de
// lucro/comissões do pintor PRO). Espelha modules/financeiro.js do vanilla
// (loadFinanceiro / salvarFinEntry / deleteFinEntry / analisarFinanceiroIA).
//
// Modelo de dados: a feature reaproveita a tabela `jobs` como "livro caixa"
// — cada lançamento financeiro é um job em status `concluido` com `revenue`
// (entrada) e `material_cost` (custo). Mesma estratégia do vanilla porque
// projetos do Pipeline (jobs reais) e lançamentos manuais (custos avulsos,
// receitas extras) entram no mesmo P&L; criar uma segunda tabela duplicaria
// agregação. Diferenciação entrada/custo no UI é derivada (revenue>0 sem
// custo = entrada pura; custo>0 sem revenue = saída).
//
// `commissions` (linha 647-660 do supabase_init.sql) NÃO é consumida aqui:
// é a tabela administrativa de comissões da loja (platform/seller split) e
// não pertence ao P&L do pintor — só admin lê via policy `is_portal_admin()`.
//
// fetchEntries filtra por janela de tempo (monthsBack) pra evitar trazer
// histórico inteiro de um pintor com 3 anos de jobs.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import type { Job } from '@/lib/types';

// Colunas que o dashboard renderiza. Mesmo subset do vanilla
// (modules/financeiro.js linha 24) — sem `notes`/`address` que o financeiro
// não usa, pra economizar payload.
const ENTRY_COLS =
  'id, painter_id, service_type, client_name, revenue, material_cost, status, scheduled_date, created_at';

// 500 alinhado com agenda.ts pra coerência de defaults entre features que
// leem `jobs`. Janelas típicas (3, 6, 12 meses) ficam bem abaixo disso.
const ENTRY_LIMIT = 500;

// Default usado por fetchEntries quando o caller não especifica — 6 meses
// cobre o típico "trimestre + comparativo" sem pesar a query.
const DEFAULT_MONTHS_BACK = 6;

export interface FinEntryInput {
  /** Nome do projeto/lançamento (ex.: "Pintura cozinha"). */
  service_type: string;
  /** Cliente (opcional — "-" pra lançamentos sem cliente). */
  client_name?: string | null;
  /** Receita em R$ (>= 0). */
  revenue: number;
  /** Custo de material em R$ (>= 0). */
  material_cost: number;
}

export interface MonthSummary {
  /** Receita total no período. */
  receita: number;
  /** Custos totais no período. */
  custos: number;
  /** Lucro = receita - custos (pode ser negativo). */
  lucro: number;
  /** Quantos lançamentos contam pro agregado. */
  count: number;
}

export interface AIAnalysisPayload {
  thisMonth: MonthSummary;
  lastMonth: MonthSummary;
  recentJobs: Array<{
    service_type: string;
    revenue: number;
    material_cost: number;
  }>;
}

export interface AIAnalysisResult {
  /** Texto curto e acionável gerado pelo gpt-4o-mini. */
  analysis: string;
}

/**
 * Calcula o cutoff ISO pra "N meses atrás a partir de hoje". Usado em queries
 * `gte('created_at', cutoff)`. Sempre devolve string ISO em UTC — o Supabase
 * compara timestamptz consistente com isso.
 */
function monthsAgoIso(monthsBack: number): string {
  const days = Math.max(1, Math.floor(monthsBack * 30));
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Busca os lançamentos financeiros do pintor nos últimos N meses. Retorna []
 * se painterId vazio (consistente com fetchPedidos/fetchLeads/fetchJobsByMonth)
 * pra que o caller não precise checar antes.
 *
 * Filtros aplicados:
 *   - painter_id = painterId (RLS já força isso, mas defesa em camadas)
 *   - status = 'concluido' (mesma regra do vanilla pra excluir rascunhos)
 *   - created_at >= cutoff (janela de tempo)
 *
 * Ordenação: created_at DESC pra dashboard mostrar entradas mais recentes
 * primeiro (mesmo do vanilla, modules/financeiro.js linha 24).
 */
export async function fetchEntries(
  painterId: string,
  monthsBack: number = DEFAULT_MONTHS_BACK
): Promise<Job[]> {
  if (!painterId) return [];
  if (!Number.isFinite(monthsBack) || monthsBack <= 0) {
    throw new ValidationError('monthsBack inválido', { field: 'monthsBack' });
  }

  const cutoff = monthsAgoIso(monthsBack);
  const sb = getSupabase();
  const { data, error } = await sb
    .from('jobs')
    .select(ENTRY_COLS)
    .eq('painter_id', painterId)
    .eq('status', 'concluido')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(ENTRY_LIMIT);

  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data ?? []) as Job[];
}

/**
 * Cria um novo lançamento financeiro (job concluído). painter_id vem como
 * parâmetro (não do form) pra blindar contra UI gravando em nome de outro
 * pintor — RLS bloqueia no banco, defesa em camadas evita request rejeitada.
 *
 * Validação mínima: precisa ter service_type OU client_name preenchido E
 * pelo menos um valor (revenue OU custo) > 0. Mesma regra do vanilla
 * (modules/financeiro.js linha 92-93).
 *
 * `scheduled_date` recebe a data de hoje no fuso local (YYYY-MM-DD) pra que
 * o lançamento apareça no calendário/agenda se o pintor cruzar telas.
 */
export async function createEntry(
  painterId: string,
  input: FinEntryInput
): Promise<Job> {
  if (!painterId) throw new ValidationError('Faça login para criar lançamentos.');

  const serviceType = (input.service_type || '').trim();
  const clientName = (input.client_name || '').trim();
  if (!serviceType && !clientName) {
    throw new ValidationError('Informe o nome do projeto ou cliente', {
      field: 'service_type',
    });
  }

  const revenue = Number.isFinite(input.revenue) ? Math.max(0, input.revenue) : 0;
  const cost = Number.isFinite(input.material_cost)
    ? Math.max(0, input.material_cost)
    : 0;
  if (revenue <= 0 && cost <= 0) {
    throw new ValidationError('Informe um valor recebido ou gasto', {
      field: 'revenue',
    });
  }

  // YYYY-MM-DD no fuso local (mesma lógica do agYmd em utils.ts) — usar
  // toISOString puro shifta pra UTC e pode gravar o dia errado pra usuários
  // em fusos negativos no fim do dia.
  const today = new Date();
  const ymd = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  const row = {
    painter_id: painterId,
    client_name: clientName || '-',
    service_type: serviceType || 'Projeto',
    revenue,
    material_cost: cost,
    status: 'concluido' as const,
    scheduled_date: ymd,
    notes: 'Lançamento financeiro',
  };

  const sb = getSupabase();
  const { data, error } = await sb
    .from('jobs')
    .insert(row)
    .select(ENTRY_COLS)
    .single();

  if (error) {
    throw new NetworkError(error.message, error);
  }
  if (!data) {
    throw new NetworkError('Insert de lançamento retornou vazio');
  }
  return data as Job;
}

/**
 * Apaga um lançamento financeiro. O `eq('painter_id', painterId)` é
 * redundante com a RLS mas evita request rejeitada quando o cliente está
 * confuso (ex.: cache estagnado tentando deletar id que mudou de dono).
 *
 * Retorna void — caller faz invalidação via TanStack Query e não precisa
 * do row devolvido.
 */
export async function deleteEntry(
  entryId: string,
  painterId: string
): Promise<void> {
  if (!entryId) throw new ValidationError('Lançamento inválido', { field: 'entryId' });
  if (!painterId) throw new ValidationError('Pintor inválido', { field: 'painterId' });

  const sb = getSupabase();
  const { error } = await sb
    .from('jobs')
    .delete()
    .eq('id', entryId)
    .eq('painter_id', painterId);

  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Incrementa o custo de material num projeto/lançamento existente. Caso de
 * uso: pintor tem um projeto "Pintura interna" (criado a partir do orçamento
 * via syncToJobs) e quer adicionar despesa de tinta/material a ele em vez
 * de criar um lançamento separado.
 *
 * delta pode ser positivo (custo novo) ou negativo (correção). Faz select
 * + update — Supabase JS não tem atomic increment client-side. Em ambiente
 * com escrita concorrente isso seria race-condition, mas pintor não está
 * lançando custo em 2 abas ao mesmo tempo na prática.
 *
 * Threw ValidationError se ids ausentes. NetworkError em falha de I/O.
 */
export async function incrementCost(
  entryId: string,
  painterId: string,
  delta: number,
): Promise<void> {
  if (!entryId) throw new ValidationError('Lançamento inválido', { field: 'entryId' });
  if (!painterId) throw new ValidationError('Pintor inválido', { field: 'painterId' });
  if (!Number.isFinite(delta) || delta === 0) {
    throw new ValidationError('Valor inválido', { field: 'delta' });
  }
  const sb = getSupabase();
  const { data, error: selErr } = await sb
    .from('jobs')
    .select('material_cost')
    .eq('id', entryId)
    .eq('painter_id', painterId)
    .single();
  if (selErr) throw new NetworkError(selErr.message, selErr);
  const current = Number(data?.material_cost) || 0;
  const next = Math.max(0, current + delta);
  const { error } = await sb
    .from('jobs')
    .update({ material_cost: next })
    .eq('id', entryId)
    .eq('painter_id', painterId);
  if (error) throw new NetworkError(error.message, error);
}

/**
 * Agrega receita/custos/lucro de um conjunto de lançamentos. Helper puro
 * (sem rede) reutilizado pelo hook pra calcular cards KPI e pra montar
 * payload da análise IA.
 *
 * Mesma fórmula do vanilla (modules/financeiro.js linha 26-28 e linhas
 * 145-150): soma `revenue` e `material_cost`, lucro = receita - custos.
 * Lida com null/undefined nas colunas (jobs antigos podem não ter os
 * campos preenchidos) tratando como 0.
 */
export function getMonthSummary(entries: Job[]): MonthSummary {
  let receita = 0;
  let custos = 0;
  for (const j of entries) {
    receita += Number(j.revenue) || 0;
    custos += Number(j.material_cost) || 0;
  }
  return {
    receita,
    custos,
    lucro: receita - custos,
    count: entries.length,
  };
}

/**
 * Dispara análise IA do mês via /api/fin-analysis. Backend (functions/api/
 * fin-analysis.js) é PRO-gated por gateProAI — gate client-side
 * (canSeeProFeature) evita request inútil, mas a checagem real fica no
 * servidor.
 *
 * Recebe os payloads já agregados (thisMonth/lastMonth/recentJobs) em vez
 * de fazer fetch + aggregation aqui — separa "buscar dados" de "enviar pra
 * IA" e permite testar essa função sem mockar a tabela `jobs`.
 *
 * Erros:
 *   - rede falha → NetworkError com cause original
 *   - backend devolve !ok → NetworkError com mensagem do backend
 *   - resposta sem `analysis` → NetworkError "resposta inválida"
 */
export async function analyzeWithAI(
  payload: AIAnalysisPayload
): Promise<AIAnalysisResult> {
  let res: Response;
  try {
    res = await fetch('/api/fin-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao chamar análise IA', e);
  }

  // Tenta parsear JSON mesmo em erro pra surfar mensagem legível do backend
  // (ex.: "PRO necessário", "IA não configurada", "Rate limit excedido").
  let data: { analysis?: unknown; error?: unknown } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Resposta sem JSON — segue pra erro genérico abaixo.
  }

  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : 'Erro na análise IA';
    throw new NetworkError(msg);
  }
  if (typeof data.analysis !== 'string' || !data.analysis.trim()) {
    throw new NetworkError('Resposta inválida da análise IA');
  }

  return { analysis: data.analysis };
}

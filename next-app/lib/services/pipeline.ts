// pipeline.ts — service layer para a tabela `quotes` (pipeline / kanban de
// orçamentos do pintor). Port de modules/pipeline.js do vanilla, com a parte
// de DOM/modal removida — aqui só ficam as operações de dados.
//
// Schema (supabase_init.sql linhas 538-580 + 1063-1101):
//   id, painter_id, client_id, status (pending/rascunho/enviado/aprovado/
//   em_execucao/concluido/recusado), title, service_type, area_m2, address,
//   description, price, proposed_date, sent_at, approved_at, approved_by,
//   approval_method, approval_note, completed_at, scope_snapshot (jsonb),
//   quote_data (jsonb), images (jsonb), client_followup_optin, created_at.
//
// RLS (linha 569+): INSERT só por client_id == auth.uid(); UPDATE por
// client_id OR painter_id. Por isso o painter usa RPC create_painter_draft
// (SECURITY DEFINER) pra inserir — INSERT direto seria rejeitado.

import { getSupabase } from '@/lib/supabase';
import {
  NetworkError,
  ValidationError,
  AuthorizationError,
} from '@/lib/errors';
import type { Quote, QuoteSnapshot, Job } from '@/lib/types';
import type { Json } from '@/lib/database.types';

// QUOTE_STATUS — const tipada que define vocabulário + label/cor por status.
// Mesmas chaves que modules/pipeline.js (linha 19), mesma ordem (ciclo de
// vida do orçamento). UI lê daqui pra montar lanes do kanban e badges dos
// cards — manter sincronizado com QuoteStatus em lib/types.ts.
export const QUOTE_STATUS = {
  pending: { label: 'A orçar', color: '#8a8a99' },
  rascunho: { label: 'Rascunho', color: '#8a8a99' },
  enviado: { label: 'Enviado', color: '#f4a300' },
  aprovado: { label: 'Aprovado', color: '#2ec4b6' },
  em_execucao: { label: 'Em execução', color: '#3a86ff' },
  concluido: { label: 'Concluído', color: '#16a34a' },
  recusado: { label: 'Recusado', color: '#e63946' },
} as const;

export type PipelineStatus = keyof typeof QUOTE_STATUS;

// Lanes do kanban — equivalente ao array `groups` de modules/pipeline.js
// (linha 127). Mantém a mesma ordem visual do vanilla pra consistência UX.
// Cada lane agrega 1+ status (ex.: "A orçar" cobre pending E rascunho).
export const PIPELINE_LANES: Array<{
  title: string;
  statuses: PipelineStatus[];
}> = [
  { title: 'A orçar', statuses: ['pending', 'rascunho'] },
  { title: 'Enviado', statuses: ['enviado'] },
  { title: 'Aprovado', statuses: ['aprovado'] },
  { title: 'Em execução', statuses: ['em_execucao'] },
  { title: 'Concluído', statuses: ['concluido'] },
  { title: 'Recusado', statuses: ['recusado'] },
];

// Subset rico de colunas usadas pelo kanban + tela de detalhe. Mantém o join
// `profiles!client_id(name)` pra economizar 1 round-trip por card — vanilla
// faz o mesmo (modules/pipeline.js linha 98).
const QUOTE_COLS =
  '*, client:profiles!client_id(name)';

const DEFAULT_LIMIT = 100;

export interface FetchQuotesOptions {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

export interface QuotesPage {
  items: Quote[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ─── reads ──────────────────────────────────────────────────────────────

/**
 * Busca todas as quotes do pintor atual, ordenadas mais novas primeiro.
 * Retorna [] se painterId vazio (consistente com fetchPedidos/fetchLeads).
 *
 * Sobrecarga: chamada sem options retorna Quote[] (back-compat); com options
 * habilita keyset pagination + AbortController. Cursor é ISO timestamp de
 * created_at da última row da página anterior.
 *
 * O caller é responsável por chamar `syncToJobs` antes/depois — não fazemos
 * aqui pra manter o read puro (sem efeito colateral). usePipeline encadeia
 * via mutation onSuccess quando precisar.
 */
export async function fetchQuotes(painterId: string): Promise<Quote[]>;
export async function fetchQuotes(
  painterId: string,
  options: FetchQuotesOptions,
): Promise<QuotesPage>;
export async function fetchQuotes(
  painterId: string,
  options?: FetchQuotesOptions,
): Promise<Quote[] | QuotesPage> {
  if (!painterId) {
    return options ? { items: [], nextCursor: null, hasMore: false } : [];
  }
  const limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT);
  const cursor = options?.cursor ?? null;
  const signal = options?.signal;
  const sb = getSupabase();
  let q = sb
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('painter_id', painterId);
  if (cursor) {
    q = q.lt('created_at', cursor);
  }
  q = q.order('created_at', { ascending: false }).limit(limit);
  const qFinal = signal
    ? (q as unknown as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(signal)
    : q;
  const { data, error } = await qFinal;
  if (error) {
    throw new NetworkError(error.message, error);
  }
  const items = (data ?? []) as Quote[];
  if (!options) return items;
  const last = items[items.length - 1];
  // created_at é optional no domain type (legado); na prática DB sempre tem.
  // Fallback null se faltar — hasMore=false impede o caller de tentar mais.
  const nextCursor = (last?.created_at as string | null | undefined) ?? null;
  const hasMore = items.length >= limit && !!nextCursor;
  return { items, nextCursor, hasMore };
}

/**
 * Busca uma quote específica por id. Usa o mesmo select rico de fetchQuotes
 * pra o componente de detalhe ter snapshot/items prontos sem fetch extra.
 */
export async function fetchQuote(id: string): Promise<Quote | null> {
  if (!id) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('id', id)
    .single();
  if (error) {
    // PGRST116 = no rows; trata como null em vez de erro pra detalhe
    // renderizar 404 amigável.
    if ((error as { code?: string }).code === 'PGRST116') return null;
    throw new NetworkError(error.message, error);
  }
  return (data ?? null) as Quote | null;
}

// ─── writes ─────────────────────────────────────────────────────────────

export interface SaveQuoteInput {
  client_name?: string | null;
  service_type?: string | null;
  title?: string | null;
  area_m2?: number | null;
  price?: number | null;
  quote_data?: unknown;
}

/**
 * Salva um novo orçamento como rascunho via RPC `create_painter_draft`
 * (SECURITY DEFINER força painter_id = auth.uid()). Equivalente ao
 * `salvarOrcamento` do vanilla (modules/pipeline.js linha 207).
 *
 * Retorna o id da quote criada — útil pra redirecionar pra tela de detalhe.
 */
export async function saveQuote(
  input: SaveQuoteInput
): Promise<{ quoteId: string }> {
  if (!input || !input.price || input.price <= 0) {
    throw new ValidationError('Informe um valor pro orçamento.');
  }
  const sb = getSupabase();
  const { data, error } = await sb.rpc('create_painter_draft', {
    p_client_name: input.client_name || 'Cliente',
    p_service_type: input.service_type || 'Orçamento',
    p_title: input.title || input.service_type || 'Orçamento',
    p_area_m2: input.area_m2 ?? null,
    p_price: input.price,
    // p_quote_data: Json | undefined no schema (não aceita null direto);
    // tratamos null como undefined (omitir = default '{}' do RPC).
    p_quote_data: (input.quote_data ?? undefined) as Json | undefined,
  });
  if (error) {
    throw new NetworkError(error.message, error);
  }
  if (!data) {
    throw new NetworkError('RPC create_painter_draft retornou vazio.');
  }
  return { quoteId: String(data) };
}

/**
 * Marca o orçamento como `enviado` e grava `sent_at` + `price`. Espelha
 * `enviarQuoteConfirmar` do vanilla (linha 245), sem a parte de modal/UI.
 *
 * RLS exige painter_id == auth.uid(); o filtro `.eq('painter_id', painterId)`
 * é defensa adicional contra UI passar o id errado.
 */
export async function sendQuote(
  id: string,
  price: number,
  painterId: string
): Promise<void> {
  if (!id) throw new ValidationError('Orçamento inválido.');
  if (!painterId) throw new AuthorizationError('Faça login pra enviar.');
  if (!price || price <= 0) throw new ValidationError('Informe um valor válido.');
  const sb = getSupabase();
  const { error } = await sb
    .from('quotes')
    .update({
      status: 'enviado',
      sent_at: new Date().toISOString(),
      price,
    })
    .eq('id', id)
    .eq('painter_id', painterId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Aprovação manual (pintor marca como aceito por canal externo — WhatsApp,
 * presencial). Congela o escopo via `buildSnapshot`. Espelha
 * `aprovarQuoteManual` do vanilla (linha 304).
 *
 * approval_note é opcional (UI pode pular o prompt). Quando vier, é trimada
 * — string vazia vira null pra não poluir o banco com '   '.
 */
export async function approveQuote(
  id: string,
  quote: Quote,
  painterId: string,
  approvalNote?: string | null
): Promise<void> {
  if (!id) throw new ValidationError('Orçamento inválido.');
  if (!painterId) throw new AuthorizationError('Faça login pra aprovar.');
  const sb = getSupabase();
  const note = (approvalNote ?? '').trim();
  const { error } = await sb
    .from('quotes')
    .update({
      status: 'aprovado',
      approved_at: new Date().toISOString(),
      approved_by: painterId,
      approval_method: 'manual',
      approval_note: note || null,
      // QuoteSnapshot é interface tipada; jsonb column aceita `Json` literal.
      // Cast via unknown — mesma razão do `cart` em mkt.ts.
      scope_snapshot: buildSnapshot(quote) as unknown as Json,
    })
    .eq('id', id)
    .eq('painter_id', painterId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Recusa o orçamento (status: recusado). Espelha `recusarQuote` do vanilla
 * (linha 320). Sem prompt extra — UI faz a confirmação antes de chamar.
 */
export async function rejectQuote(
  id: string,
  painterId: string
): Promise<void> {
  if (!id) throw new ValidationError('Orçamento inválido.');
  if (!painterId) throw new AuthorizationError('Faça login pra recusar.');
  const sb = getSupabase();
  const { error } = await sb
    .from('quotes')
    .update({ status: 'recusado' })
    .eq('id', id)
    .eq('painter_id', painterId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Avança o estágio do orçamento (em_execucao | concluido). Quando vai pra
 * concluido, também grava `completed_at`. Espelha `setQuoteStage` do vanilla
 * (linha 329). Pontos de conclusão são creditados via trigger no banco
 * (`trg_award_quote_completed_points`), não chamamos aqui.
 */
export async function setQuoteStage(
  id: string,
  status: 'em_execucao' | 'concluido',
  painterId: string
): Promise<void> {
  if (!id) throw new ValidationError('Orçamento inválido.');
  if (!painterId) throw new AuthorizationError('Faça login.');
  if (status !== 'em_execucao' && status !== 'concluido') {
    throw new ValidationError('Estágio inválido.');
  }
  const sb = getSupabase();
  // Patch tipado em vez de Record<string, unknown> — o typed client rejeita
  // o índice livre em favor do shape exato de quotes.Update.
  const patch: { status: string; completed_at?: string } = { status };
  if (status === 'concluido') {
    patch.completed_at = new Date().toISOString();
  }
  const { error } = await sb
    .from('quotes')
    .update(patch)
    .eq('id', id)
    .eq('painter_id', painterId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

// ─── IA: sugestão de preço ─────────────────────────────────────────────

export interface SuggestPriceInput {
  service_type?: string | null;
  description?: string | null;
  area_m2?: number | null;
}

export interface SuggestPriceResult {
  price: number;
  justification: string;
}

/**
 * Chama o endpoint /api/pricing-suggest (Cloudflare function) que invoca o
 * Seu Zé (gpt). Equivalente ao `sugerirPrecoQuote` do vanilla (linha 269),
 * sem a parte de modal — só retorna `{ price, justification }`.
 *
 * Erros:
 *   - 403/401 → AuthorizationError (feature PRO ou rate limit)
 *   - 502 / IA não configurada → NetworkError com message do backend
 *   - resposta sem `price` numérico → NetworkError (resposta malformada)
 */
export async function suggestPrice(
  input: SuggestPriceInput
): Promise<SuggestPriceResult> {
  let res: Response;
  try {
    res = await fetch('/api/pricing-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_type: input.service_type || '',
        description: input.description || '',
        area_m2: input.area_m2 ?? null,
      }),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao sugerir preço.', e);
  }

  // Tenta parsear JSON mesmo em erro — backend surfa mensagens legíveis
  // (ex.: "PRO necessário", "Rate limit excedido", "IA não configurada").
  let data: { price?: unknown; justification?: unknown; error?: unknown } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    // Sem JSON na resposta — vamos pro fallback de erro genérico abaixo.
  }

  if (res.status === 401 || res.status === 403) {
    const msg = typeof data.error === 'string' ? data.error : 'Sem acesso.';
    throw new AuthorizationError(msg);
  }
  if (!res.ok) {
    const msg = typeof data.error === 'string' ? data.error : 'Erro ao sugerir preço.';
    throw new NetworkError(msg);
  }
  if (typeof data.price !== 'number') {
    throw new NetworkError('Resposta inválida do Seu Zé.');
  }
  return {
    price: data.price,
    justification:
      typeof data.justification === 'string' ? data.justification : '',
  };
}

// ─── snapshot + sync com agenda ────────────────────────────────────────

/**
 * Congela o escopo+valor do orçamento como referência imutável. Port direto
 * de `buildQuoteSnapshot` do vanilla (linha 33). Usado em approveQuote pra
 * gravar em scope_snapshot — o cliente vê depois mesmo se o pintor editar
 * o orçamento original (no caso de não estar mais alive).
 */
export function buildSnapshot(q: Quote): QuoteSnapshot {
  return {
    frozen_at: new Date().toISOString(),
    service_type: q.service_type ?? null,
    title: q.title ?? null,
    area_m2: q.area_m2 ?? null,
    address: q.address ?? null,
    description: q.description ?? null,
    price: Number(q.price) || 0,
    proposed_date: q.proposed_date ?? null,
    quote_data: q.quote_data ?? null,
  };
}

/**
 * Sincroniza quotes em estado terminal (aprovado/em_execucao/concluido) com
 * a tabela `jobs` — orçamento vira projeto na agenda/financeiro. Idempotente:
 * só cria jobs que faltam e nunca rebaixa o status de um job existente.
 *
 * Port de `syncQuotesToJobs` do vanilla (linha 50). Diferenças:
 *   - retorna { created, updated } pra observability/log (vanilla era silent);
 *   - não estoura em caso de erro parcial — loga e segue, mesmo comportamento
 *     do vanilla (que usa try/catch envolvendo o loop inteiro).
 */
export async function syncToJobs(
  painterId: string
): Promise<{ created: number; updated: number }> {
  if (!painterId) return { created: 0, updated: 0 };
  const sb = getSupabase();

  const { data: quotes } = await sb
    .from('quotes')
    .select(
      'id, client_name, service_type, address, price, proposed_date, status, client:profiles!client_id(name)'
    )
    .eq('painter_id', painterId)
    .in('status', ['aprovado', 'em_execucao', 'concluido']);

  if (!quotes || quotes.length === 0) {
    return { created: 0, updated: 0 };
  }

  const { data: jobs } = await sb
    .from('jobs')
    .select('id, quote_id, status')
    .eq('painter_id', painterId)
    .not('quote_id', 'is', null);

  const byQuote = new Map<string, Job>();
  for (const j of (jobs ?? []) as Job[]) {
    if (j.quote_id) byQuote.set(j.quote_id, j);
  }

  // Data local YYYY-MM-DD pra default de scheduled_date (mesmo cálculo do
  // vanilla — evita timezone shift gravando UTC quando o pintor está em BR).
  const t = new Date();
  const ymd = new Date(t.getTime() - t.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);

  let created = 0;
  let updated = 0;

  for (const q of quotes as Array<{
    id: string;
    client_name?: string | null;
    service_type?: string | null;
    address?: string | null;
    price?: number | null;
    proposed_date?: string | null;
    status: string;
    client?: { name?: string | null } | null;
  }>) {
    const existing = byQuote.get(q.id);
    if (!existing) {
      const { error } = await sb.from('jobs').insert({
        painter_id: painterId,
        quote_id: q.id,
        client_name: q.client_name || q.client?.name || 'Cliente',
        service_type: q.service_type || 'Serviço',
        address: q.address || null,
        scheduled_date: q.proposed_date || ymd,
        status: q.status === 'concluido' ? 'concluido' : 'agendado',
        revenue: Number(q.price) || 0,
        material_cost: 0,
        notes: 'Gerado automaticamente do orçamento aprovado',
      });
      if (!error) created += 1;
    } else if (
      q.status === 'concluido' &&
      existing.status !== 'concluido' &&
      existing.status !== 'cancelado'
    ) {
      const { error } = await sb
        .from('jobs')
        .update({ status: 'concluido' })
        .eq('id', existing.id)
        .eq('painter_id', painterId);
      if (!error) updated += 1;
    }
  }

  return { created, updated };
}

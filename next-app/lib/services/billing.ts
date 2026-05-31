// billing.ts — service layer pra `invoices`, `ai_usage`, `plan_limits`.
//
// Implementa 4 features de hardening pagamentos (migration
// `2026-05-31-payments-hardening.sql`):
//   1. Invoice tracking (Pagamentos#11)            — fetch/record invoices
//   2. Grace period 3 dias (Pagamentos#17)          — via is_pro_active() RPC
//   3. ai_usage table + counter mensal (#19)        — recordAiUsage + getter
//   4. Limit-por-plano (#18)                        — canUseAi (gate antes da IA)
//
// Quem chama:
//   - mp-webhook (server-side via service_role) → recordInvoice
//   - route handlers de IA (server-side via service_role) → canUseAi + recordAiUsage
//   - UI do plano (client-side via anon + RLS owner) → fetchInvoices, getAiUsageThisMonth
//
// CHAVE: as escritas em `invoices`/`ai_usage` são SEMPRE via service_role
// (RLS deny-by-default pra authenticated). Por isso `recordInvoice` e
// `recordAiUsage` aceitam `client?` injetado — em route handler de IA, o
// caller passa `createServiceClient()`. Pra leitura RLS user-owned, usa
// o `getSupabase()` padrão.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import type { SupabaseClient } from '@supabase/supabase-js';

// O Database typed client (lib/database.types.ts) ainda não tem as tabelas/RPCs
// novas desta wave (invoices, ai_usage, plan_limits, is_pro_active,
// ai_usage_this_month, upsert_invoice). Pra não bloquear build até o
// `generate_typescript_types` rodar, usamos `SupabaseClient` genérico aqui.
//
// Quando o user rodar a migration e regerar database.types.ts, podemos
// remover este cast e voltar a usar `SupabaseClient<Database>`.

// ─── Tipos ─────────────────────────────────────────────────────────────────

export type InvoiceType = 'subscription' | 'order' | 'refund';
export type InvoiceStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export type AiFeature =
  | 'chat_ai'
  | 'caption'
  | 'transcribe'
  | 'tts'
  | 'generate_logo'
  | 'area_from_photo'
  | 'pricing_suggest'
  | 'fin_analysis'
  | 'crm_draft'
  | 'agenda_order'
  | 'resolve_color'
  | 'moderate'
  | 'moderate_video'
  | 'ig_art';

export type PlanName = 'free' | 'pro' | 'admin';

export interface Invoice {
  id: string;
  user_id: string | null;
  external_id: string;
  provider: string;
  type: InvoiceType;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  metadata: Record<string, unknown> | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanLimit {
  plan: PlanName;
  ai_monthly_limit: number;
  features: Record<string, boolean | number | string>;
}

export interface CanUseAiResult {
  allowed: boolean;
  used: number;
  limit: number;
  plan: PlanName;
}

// ─── Constantes ────────────────────────────────────────────────────────────

const INVOICE_COLS =
  'id, user_id, external_id, provider, type, amount, currency, status, metadata, paid_at, created_at, updated_at';

// Fallback in-memory pra quando `plan_limits` não responde — não bloqueia
// IA por failure de DB. Espelha os valores do INSERT da migration.
const FALLBACK_LIMITS: Record<PlanName, PlanLimit> = {
  free: { plan: 'free', ai_monthly_limit: 30, features: {} },
  pro: { plan: 'pro', ai_monthly_limit: 500, features: {} },
  admin: { plan: 'admin', ai_monthly_limit: 99999, features: {} },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

type AnyClient = SupabaseClient | ReturnType<typeof getSupabase>;

// Cast pra `SupabaseClient` (sem generic Database) — as tabelas/RPCs novas
// desta wave ainda não estão no Database type. Os métodos são estruturalmente
// idênticos em runtime.
function resolveClient(client?: AnyClient | null): SupabaseClient {
  return (client ?? getSupabase()) as unknown as SupabaseClient;
}

// ─── Invoice CRUD ──────────────────────────────────────────────────────────

/**
 * Lê as invoices do usuário (RLS user-owned). Anônimo retorna [].
 */
export async function fetchInvoices(
  userId: string,
  client?: AnyClient | null
): Promise<Invoice[]> {
  if (!userId) return [];
  const sb = resolveClient(client);
  const { data, error } = await sb
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new NetworkError(error.message, error);
  return (data ?? []) as unknown as Invoice[];
}

/**
 * Registra/atualiza uma invoice via RPC `upsert_invoice` (idempotente por
 * `external_id`). Chamado pelo mp-webhook DEPOIS de validar valor + signature.
 *
 * Estoura ValidationError se `external_id`/`type`/`amount`/`status` ausentes
 * — esses são os campos mínimos pro registro fazer sentido.
 *
 * O trigger `handle_invoice_paid` propaga `is_pro=true + pro_expires_at +30d`
 * em transitions → 'paid' pra type='subscription'.
 */
export async function recordInvoice(
  invoice: {
    user_id?: string | null;
    external_id: string;
    provider?: string;
    type: InvoiceType;
    amount: number;
    currency?: string;
    status: InvoiceStatus;
    metadata?: Record<string, unknown> | null;
    paid_at?: string | null;
  },
  client?: AnyClient | null
): Promise<Invoice> {
  if (!invoice.external_id) throw new ValidationError('external_id obrigatório');
  if (!invoice.type) throw new ValidationError('type obrigatório');
  if (typeof invoice.amount !== 'number' || !Number.isFinite(invoice.amount)) {
    throw new ValidationError('amount inválido');
  }
  if (!invoice.status) throw new ValidationError('status obrigatório');

  const sb = resolveClient(client);
  const { data, error } = await sb.rpc('upsert_invoice', {
    p_user_id: invoice.user_id ?? null,
    p_external_id: invoice.external_id,
    p_provider: invoice.provider ?? 'mercadopago',
    p_type: invoice.type,
    p_amount: invoice.amount,
    p_currency: invoice.currency ?? 'BRL',
    p_status: invoice.status,
    p_metadata: invoice.metadata ?? null,
    p_paid_at: invoice.paid_at ?? null,
  });
  if (error) throw new NetworkError(error.message, error);
  // RPC returns SETOF/RECORD; supabase-js retorna o row direto.
  return data as unknown as Invoice;
}

// ─── AI usage ──────────────────────────────────────────────────────────────

/**
 * Conta o uso do mês corrente. `feature` opcional → conta TODAS as features.
 *
 * Usa RPC `ai_usage_this_month` (SECURITY DEFINER, GRANT pra authenticated)
 * em vez de COUNT(*) direto na tabela porque a tabela é deny-read pra
 * cross-user; o RPC valida que `p_user_id = auth.uid()` indiretamente já que
 * o caller passa o próprio uid.
 *
 * Fallback: se RPC falhar (offline, rls), retorna 0 — preferimos liberar IA
 * a bloquear usuário legítimo por falha do counter. Isso é OK porque o
 * gate de PRO/admin já filtrou abuse mais grosseiro.
 */
export async function getAiUsageThisMonth(
  userId: string,
  feature?: AiFeature,
  client?: AnyClient | null
): Promise<number> {
  if (!userId) return 0;
  const sb = resolveClient(client);
  const { data, error } = await sb.rpc('ai_usage_this_month', {
    p_user_id: userId,
    p_feature: feature ?? null,
  });
  if (error) {
    console.warn('getAiUsageThisMonth: rpc falhou', error.message);
    return 0;
  }
  const n = typeof data === 'number' ? data : Number(data ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Registra 1 uso de feature de IA. Chamado pelo route handler APÓS o
 * sucesso da chamada upstream (OpenAI/Gemini).
 *
 * MUST be called server-side via service_role (RLS deny-write pra authenticated).
 * Pra isso, caller injeta `client` criado com SERVICE_ROLE_KEY.
 *
 * Falha silenciosa: log + return — counter perder 1 uso é melhor que UI quebrar.
 */
export async function recordAiUsage(
  userId: string,
  feature: AiFeature,
  costUnits = 1,
  client?: AnyClient | null
): Promise<void> {
  if (!userId) return;
  if (!feature) return;
  const sb = resolveClient(client);
  const { error } = await sb.from('ai_usage').insert({
    user_id: userId,
    feature,
    cost_units: costUnits,
  });
  if (error) {
    // Não estoura — counter offline é melhor que IA quebrada.
    console.warn('recordAiUsage falhou:', error.message);
  }
}

// ─── Plan limits ───────────────────────────────────────────────────────────

/**
 * Carrega o limite do plano. Cacheado in-memory por chamada via FALLBACK_LIMITS
 * — se a tabela `plan_limits` não responder, devolve fallback hardcoded
 * (mesmos valores da migration). Garante que `canUseAi` nunca trava por
 * indisponibilidade do `plan_limits`.
 */
export async function getPlanLimit(
  plan: PlanName,
  client?: AnyClient | null
): Promise<PlanLimit> {
  const sb = resolveClient(client);
  const { data, error } = await sb
    .from('plan_limits')
    .select('plan, ai_monthly_limit, features')
    .eq('plan', plan)
    .maybeSingle();
  if (error || !data) {
    return FALLBACK_LIMITS[plan] ?? FALLBACK_LIMITS.free;
  }
  return data as unknown as PlanLimit;
}

/**
 * Decide se o usuário pode usar uma feature de IA. Retorna `{ allowed, used,
 * limit, plan }` pra route handler decidir entre seguir (200) ou bloquear (429).
 *
 * Resolução do plano (ordem de precedência):
 *   1. admin → 'admin'
 *   2. is_pro_active (RPC) === true → 'pro'
 *   3. caso contrário → 'free'
 *
 * `is_pro_active` é o RPC que considera grace period (3 dias após
 * pro_expires_at). Isso é PROPOSITALMENTE feito por RPC pra centralizar a
 * lógica que policies.ts client-side também usa.
 *
 * Em caso de falha de DB, FAIL-OPEN como 'free' com limite normal — o
 * usuário não fica travado se o counter quebra.
 */
export async function canUseAi(
  userId: string,
  _feature: AiFeature,
  opts: { isAdmin?: boolean; client?: AnyClient | null } = {}
): Promise<CanUseAiResult> {
  // `_feature` reservado pra extensão futura (per-feature limits dentro
  // de `plan_limits.features`). Hoje só somamos uso total do mês.
  const { isAdmin = false, client } = opts;
  if (!userId) {
    // Anônimo: bloqueado por design (rotas de IA exigem auth antes).
    return { allowed: false, used: 0, limit: 0, plan: 'free' };
  }

  const sb = resolveClient(client);

  // Resolve o plano.
  let plan: PlanName = 'free';
  if (isAdmin) {
    plan = 'admin';
  } else {
    try {
      const { data, error } = await sb.rpc('is_pro_active', { p_user_id: userId });
      if (!error && data === true) plan = 'pro';
    } catch (e) {
      console.warn(
        'canUseAi: is_pro_active rpc falhou — fallback free:',
        e instanceof Error ? e.message : e
      );
    }
  }

  const [limitRow, used] = await Promise.all([
    getPlanLimit(plan, sb),
    getAiUsageThisMonth(userId, undefined, sb),
  ]);

  const limit = limitRow.ai_monthly_limit;
  return {
    allowed: used < limit,
    used,
    limit,
    plan,
  };
}

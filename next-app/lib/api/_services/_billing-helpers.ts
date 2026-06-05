// _billing-helpers.ts — wrappers REST puros pra usar dentro de route handlers
// edge runtime (mp-webhook, etc.) que NÃO podem importar supabase-js (peso
// bundle + complicações de SSR/Edge).
//
// O service principal `lib/services/billing.ts` é o caminho preferido pra
// código que já tem `supabase-js` carregado (UI client, server actions). Pra
// edge runtime puro como mp-webhook, este helper fala REST direto via
// SUPABASE_URL + service_role.
//
// NÃO usar este arquivo em UI. Use `billing.ts` (que respeita RLS).

const SUPA_TIMEOUT_MS = 10000;

export type InvoiceType = 'subscription' | 'order' | 'refund';
export type InvoiceStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export interface InvoicePayload {
  user_id: string | null;
  external_id: string;
  provider?: string;
  type: InvoiceType;
  amount: number;
  currency?: string;
  status: InvoiceStatus;
  metadata?: Record<string, unknown> | null;
  paid_at?: string | null;
}

/**
 * Registra/atualiza uma invoice via RPC `upsert_invoice`. Idempotente por
 * `external_id` no banco — webhook re-entrega não duplica.
 *
 * Falha silenciosa por design: o webhook NÃO pode reverter o estado do
 * pagamento por falha de conciliação. Log warning + segue. Anti-retry-storm:
 * MP fica reenviando se webhook retorna 5xx — preferimos perder uma row de
 * conciliação a duplicar PRO ativações.
 */
export async function recordInvoiceViaRest(args: {
  supaUrl: string;
  serviceKey: string;
  invoice: InvoicePayload;
}): Promise<{ ok: boolean; error?: string }> {
  const { supaUrl, serviceKey, invoice } = args;
  if (!supaUrl || !serviceKey) {
    return { ok: false, error: 'config ausente' };
  }
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/upsert_invoice`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: invoice.user_id,
        p_external_id: invoice.external_id,
        p_provider: invoice.provider ?? 'mercadopago',
        p_type: invoice.type,
        p_amount: invoice.amount,
        p_currency: invoice.currency ?? 'BRL',
        p_status: invoice.status,
        p_metadata: invoice.metadata ?? null,
        p_paid_at: invoice.paid_at ?? null,
      }),
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn(
        `recordInvoiceViaRest: rpc ${res.status} - ${t.slice(0, 200)}`
      );
      return { ok: false, error: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.warn(
      'recordInvoiceViaRest: exceção',
      e instanceof Error ? e.message : String(e)
    );
    return { ok: false, error: 'network' };
  }
}

/**
 * Registra um uso de IA via REST direto. Pareado com `recordAiUsage` do
 * service `lib/services/billing.ts`, mas pra edge runtime sem supabase-js.
 *
 * Falha silenciosa (log + return).
 */
export async function recordAiUsageViaRest(args: {
  supaUrl: string;
  serviceKey: string;
  userId: string;
  feature: string;
  costUnits?: number;
}): Promise<void> {
  const { supaUrl, serviceKey, userId, feature, costUnits = 1 } = args;
  if (!supaUrl || !serviceKey || !userId || !feature) return;
  try {
    const res = await fetch(`${supaUrl}/rest/v1/ai_usage`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        feature,
        cost_units: costUnits,
      }),
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn(
        `recordAiUsageViaRest: ${res.status} - ${t.slice(0, 200)}`
      );
    }
  } catch (e) {
    console.warn(
      'recordAiUsageViaRest: exceção',
      e instanceof Error ? e.message : String(e)
    );
  }
}

/**
 * Conta uso do mês via RPC `ai_usage_this_month`. Falha → retorna 0
 * (fail-open: melhor liberar IA do que travar usuário legítimo).
 */
export async function getAiUsageThisMonthViaRest(args: {
  supaUrl: string;
  serviceKey: string;
  userId: string;
  feature?: string | null;
}): Promise<number> {
  const { supaUrl, serviceKey, userId, feature = null } = args;
  if (!supaUrl || !serviceKey || !userId) return 0;
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/ai_usage_this_month`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_feature: feature,
      }),
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!res.ok) return 0;
    const data = await res.json().catch(() => 0);
    const n = typeof data === 'number' ? data : Number(data ?? 0);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Conta uso da feature pelo user HOJE (UTC date). Usado pra rate-limit
 * diário (ex.: Alice = 3/dia). Faz query direta na tabela `ai_usage` via
 * PostgREST com `Prefer: count=exact` + `Range: 0-0` (não baixa rows, só
 * conta). Fail-open: erro → retorna 0.
 *
 * Não precisa de migration nova — usa a tabela ai_usage já existente.
 */
export async function getAiUsageTodayViaRest(args: {
  supaUrl: string;
  serviceKey: string;
  userId: string;
  feature: string;
}): Promise<number> {
  const { supaUrl, serviceKey, userId, feature } = args;
  if (!supaUrl || !serviceKey || !userId || !feature) return 0;
  // ISO date YYYY-MM-DD na timezone UTC. Em UTC pra evitar drift entre
  // edge regions; cliente brasileiro no fim do dia (~21h UTC = 18h BRT)
  // ainda pode ter sua "noite" no dia UTC seguinte. Aceitável — efetivo
  // window é 24h sliding na pior das hipóteses.
  const today = new Date().toISOString().slice(0, 10);
  try {
    const url = `${supaUrl}/rest/v1/ai_usage?user_id=eq.${encodeURIComponent(userId)}&feature=eq.${encodeURIComponent(feature)}&created_at=gte.${today}T00:00:00Z&select=id`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!res.ok) return 0;
    // Content-Range: "0-0/N" ou "*/N" — extrai o N após a /
    const contentRange = res.headers.get('content-range') || '';
    const m = contentRange.match(/\/(\d+)$/);
    if (!m) return 0;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Checa se o user tem PRO ativo (considerando grace period). RPC
 * `is_pro_active`. Falha → false (fail-closed pra evitar bypass).
 */
export async function isProActiveViaRest(args: {
  supaUrl: string;
  serviceKey: string;
  userId: string;
}): Promise<boolean> {
  const { supaUrl, serviceKey, userId } = args;
  if (!supaUrl || !serviceKey || !userId) return false;
  try {
    const res = await fetch(`${supaUrl}/rest/v1/rpc/is_pro_active`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_user_id: userId }),
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Limit do plano via PostgREST direto. Cacheable in-memory por chamada.
 * Falha → fallback hardcoded (mesmos valores da migration).
 */
const FALLBACK_LIMITS: Record<string, number> = {
  free: 30,
  pro: 500,
  admin: 99999,
};

export async function getPlanLimitViaRest(args: {
  supaUrl: string;
  serviceKey: string;
  plan: 'free' | 'pro' | 'admin';
}): Promise<number> {
  const { supaUrl, serviceKey, plan } = args;
  if (!supaUrl || !serviceKey) return FALLBACK_LIMITS[plan] ?? 30;
  try {
    const res = await fetch(
      `${supaUrl}/rest/v1/plan_limits?plan=eq.${encodeURIComponent(plan)}&select=ai_monthly_limit`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
      }
    );
    if (!res.ok) return FALLBACK_LIMITS[plan] ?? 30;
    const rows = (await res.json().catch(() => [])) as Array<{
      ai_monthly_limit?: number;
    }>;
    const n = rows?.[0]?.ai_monthly_limit;
    return typeof n === 'number' && Number.isFinite(n)
      ? n
      : FALLBACK_LIMITS[plan] ?? 30;
  } catch {
    return FALLBACK_LIMITS[plan] ?? 30;
  }
}

// lib/api/_services/mp-webhook.ts — port de `functions/api/mp-webhook.js`.
// Webhook do Mercado Pago: confirma assinatura HMAC, busca o evento real na
// API do MP (fonte da verdade), valida valor (anti-fraude) e atualiza Supabase.
//
// Comportamento crítico (PRESERVADO do vanilla):
//   1. HMAC-SHA256 sobre `id:<dataId>;request-id:<reqId>;ts:<ts>;` com
//      MP_WEBHOOK_SECRET (Web Crypto, edge-friendly).
//      - PRODUÇÃO (NODE_ENV=production): SEM secret → fail-closed (401).
//        Fechado no CRIT-2 do audit 2026-06-12 — sem secret atacante
//        forjava webhook `external_reference=<vítima>` + `status=authorized`
//        e liberava PRO sem pagamento.
//      - DEV/STAGING: SEM secret → fail-open (compat com ambientes locais).
//      - MP_WEBHOOK_ENFORCE=true em qualquer ambiente: SEM secret → 401.
//   2. Timing-safe equal (manual; Web Crypto não expõe timingSafeEqual).
//   3. Return 200 EM TODOS os erros não-fatais (anti-retry storm do MP).
//      Exceção: signature inválida → 401 (sinaliza pro atacante que está
//      barrado; MP real só envia assinatura válida).
//   4. Idempotência por estado: order já 'paid' com mesmo tx_id → no-op;
//      preapproval em estado intermediário → no-op.
//   5. Anti-fraude:
//      - Order: paid_amount vs order.total (diff>0.01 → marca 'amount_mismatch'
//        em vez de 'paid', NÃO libera produto).
//      - Preapproval: transaction_amount vs PRO_AMOUNT_BRL (R$39).
//        Currency != BRL → ignora ativação.
//
// Diferenças do vanilla:
//   - Service recebe { rawBody, headers, env } em vez de Request (controller
//     extrai). Isso é DELIBERADO: HMAC valida sobre rawBody (string), então
//     o controller faz request.text() e passa pra cá pra evitar consumir
//     stream duas vezes.
//   - Sem FALLBACK_SUPABASE_URL — usa getSupabaseUrl() (throws ServiceError 503).
//   - Tipagem TS estrita pros payloads MP.
//
// Retorno do service: { status: number, msg: string } — controller monta
// o NextResponse. NUNCA throw: anti-retry-storm.

import { getServiceKey, getSupabaseUrl } from '../security';
import { recordInvoiceViaRest } from './_billing-helpers';
import { logAuditEvent } from '../audit';

const MP_TIMEOUT_MS = 15000;
const SUPA_TIMEOUT_MS = 10000;
const PRO_AMOUNT_BRL = 39;
const PRO_VALIDITY_DAYS = 33;

/**
 * Startup check (idempotente, roda 1x por instância). Emite `console.error`
 * caro em produção sem `MP_WEBHOOK_SECRET` configurado — combinado com o
 * fail-closed em `verifyMpSignature`, qualquer webhook em prod sem secret
 * vai 401 (não há janela de fraude), mas o log explícito facilita
 * diagnóstico no Sentry/CF logs.
 */
let configValidated = false;
function validateMpConfigOnce(): void {
  if (configValidated) return;
  if (process.env.NODE_ENV === 'production' && !process.env.MP_WEBHOOK_SECRET) {
    console.error(
      '[mp-webhook] CRITICAL: MP_WEBHOOK_SECRET ausente em produção. ' +
        'Webhooks serão rejeitados com 401 (fail-closed). Configure a env var.'
    );
  }
  configValidated = true;
}

export interface WebhookResult {
  status: number;
  body: { received?: boolean; msg?: string; error?: string };
}

interface MpWebhookBody {
  type?: string;
  topic?: string;
  data?: { id?: string };
  resource?: string;
}

interface MpPaymentResponse {
  status?: string;
  transaction_amount?: number;
  payment_type_id?: string;
  payment_method_id?: string;
  external_reference?: string;
}

interface MpPreapprovalResponse {
  status?: string;
  external_reference?: string;
  auto_recurring?: {
    transaction_amount?: number;
    currency_id?: string;
  };
}

interface OrderRow {
  id: string;
  total: number | null;
  status: string;
  tx_id: string | null;
}

/**
 * Processa o webhook MP. Sempre retorna 200 (anti-retry storm) exceto
 * em signature inválida (401). NUNCA throws — qualquer erro vira `ok(...)`.
 */
export async function processMpWebhook(args: {
  rawBody: string;
  url: string;
  headers: Headers;
}): Promise<WebhookResult> {
  validateMpConfigOnce();
  const { rawBody, url, headers } = args;

  let body: MpWebhookBody = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as MpWebhookBody;
    } catch {
      /* MP às vezes manda só query params, segue com body={} */
    }
  }

  // Validação HMAC PRIMEIRO — antes de qualquer side-effect.
  const sigOk = await verifyMpSignature({ headers, body });
  if (!sigOk) {
    return {
      status: 401,
      body: { error: 'invalid signature' },
    };
  }

  const serviceKey = getServiceKey();
  // Responde 200 mesmo em erro de config pra MP não ficar reenviando.
  if (!process.env.MP_ACCESS_TOKEN || !serviceKey) {
    return ok('config ausente');
  }

  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return ok('supabase config ausente');
  }

  const urlObj = safeParseUrl(url);
  const type =
    body?.type ||
    body?.topic ||
    urlObj?.searchParams.get('type') ||
    urlObj?.searchParams.get('topic') ||
    '';
  const eventId =
    body?.data?.id ||
    urlObj?.searchParams.get('data.id') ||
    urlObj?.searchParams.get('id') ||
    (typeof body?.resource === 'string' ? body.resource.split('/').pop() : '') ||
    '';

  const isPreapproval =
    String(type).includes('preapproval') || String(type).includes('subscription');
  const isPayment =
    String(type) === 'payment' ||
    String(type) === 'payment.created' ||
    String(type) === 'payment.updated';

  if (!isPreapproval && !isPayment) return ok('evento ignorado');
  if (!eventId) return ok('sem id');

  const sHeaders: Record<string, string> = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // -------------------- LOJA (one-shot payment) --------------------
  if (isPayment) {
    return await processPaymentEvent({
      eventId,
      supaUrl,
      serviceKey,
      sHeaders,
      reqHeaders: headers,
    });
  }

  // -------------------- PRO (preapproval) --------------------
  return await processPreapprovalEvent({
    eventId,
    supaUrl,
    serviceKey,
    sHeaders,
    reqHeaders: headers,
  });
}

// ── Payment (Loja) ─────────────────────────────────────────────────────────

async function processPaymentEvent(opts: {
  eventId: string;
  supaUrl: string;
  serviceKey: string;
  sHeaders: Record<string, string>;
  reqHeaders: Headers;
}): Promise<WebhookResult> {
  const { eventId, supaUrl, serviceKey, sHeaders, reqHeaders } = opts;

  let pay: MpPaymentResponse;
  try {
    const r = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(eventId)}`,
      {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
        signal: AbortSignal.timeout(MP_TIMEOUT_MS),
      }
    );
    if (!r.ok) return ok(`mp payment ${r.status}`);
    pay = (await r.json()) as MpPaymentResponse;
  } catch {
    return ok('erro ao consultar payment');
  }

  const orderId = pay?.external_reference;
  if (!orderId) return ok('payment sem external_reference');

  const status = pay?.status;
  const transactionAmount = Number(pay?.transaction_amount || 0);
  const paymentMethod = pay?.payment_type_id || pay?.payment_method_id || null;

  // Busca a order pra validar valor + idempotência
  const getR = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,total,status,tx_id`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    }
  );
  if (!getR.ok) return ok(`supabase get order ${getR.status}`);
  const rows = (await getR.json().catch(() => [])) as OrderRow[];
  const order = Array.isArray(rows) && rows[0];
  if (!order) return ok('order não encontrada');

  // Idempotência: já paid com mesmo tx_id → no-op
  if (order.status === 'paid' && order.tx_id === String(eventId)) {
    return ok('idempotente');
  }
  // Não sobrescreve estado final
  if (order.status !== 'pending' && status === 'approved') {
    return ok('order já fora de pending');
  }

  let patch: Record<string, unknown>;
  if (status === 'approved') {
    const expected = Number(order.total || 0);
    if (transactionAmount > 0 && Math.abs(transactionAmount - expected) > 0.01) {
      patch = {
        status: 'amount_mismatch',
        tx_id: String(eventId),
        paid_amount: transactionAmount,
        payment_method: paymentMethod,
      };
    } else {
      patch = {
        status: 'paid',
        tx_id: String(eventId),
        paid_amount: transactionAmount || expected,
        paid_at: new Date().toISOString(),
        payment_method: paymentMethod,
        gateway: 'mp',
      };
    }
  } else if (
    status === 'refunded' ||
    status === 'cancelled' ||
    status === 'rejected'
  ) {
    patch = { status: status === 'rejected' ? 'canceled' : status };
  } else {
    return ok('payment status ' + status + ' — sem ação');
  }

  const upR = await fetch(
    `${supaUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    {
      method: 'PATCH',
      headers: sHeaders,
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
    }
  );
  if (!upR.ok) {
    const t = await upR.text().catch(() => '');
    return ok(`supabase update ${upR.status}: ${t.slice(0, 150)}`);
  }

  // Audit-log: pagamento concluído (paid/amount_mismatch/refunded/cancelled).
  // Actor null porque webhook é server-to-server; target_table=orders.
  // R-H5: critical=true só pra `paid` (financeiro real). Outros estados
  // (cancelled, refunded, amount_mismatch) mantém fail-open: perder
  // trilha de cancelamento é menos crítico que perder de pagamento.
  // Como o webhook DEVE retornar 200 (anti-retry storm), capturamos o
  // throw e logamos `console.error` (Sentry alerta) sem mudar o status.
  try {
    await logAuditEvent({
      actorId: null,
      action: `mp.order.${patch.status}`,
      targetTable: 'orders',
      targetId: orderId,
      changes: {
        mp_status: status,
        tx_id: String(eventId),
        paid_amount: patch.paid_amount,
        payment_method: paymentMethod,
      },
      request: { headers: reqHeaders },
      critical: patch.status === 'paid',
    });
  } catch (e) {
    console.error(
      'mp-webhook: CRITICAL audit insert failed for paid order',
      { orderId, tx_id: String(eventId) },
      e instanceof Error ? e.message : e,
    );
    // Não muda o status retornado pro MP — order já está paid no banco.
  }

  // Hardening#11 — registra invoice pra conciliação. Idempotente por
  // external_id via RPC upsert_invoice. Falha aqui NÃO reverte o pagamento
  // (order já está paid no banco) — apenas loga pra investigação.
  await recordInvoiceViaRest({
    supaUrl,
    serviceKey,
    invoice: {
      // Ordens são por order; user_id fica null aqui (orders.user_id seria
      // melhor, mas o webhook não tem esse campo na resposta — pode ser
      // recuperado depois via reconciliação).
      user_id: null,
      external_id: String(eventId),
      provider: 'mercadopago',
      type: mapInvoiceTypeFromOrderStatus(String(patch.status)),
      amount: Number(patch.paid_amount ?? order.total ?? transactionAmount ?? 0),
      currency: 'BRL',
      status: mapInvoiceStatusFromOrderStatus(String(patch.status)),
      metadata: {
        order_id: orderId,
        payment_method: paymentMethod,
        mp_status: status,
      },
      paid_at:
        patch.status === 'paid'
          ? (patch.paid_at as string | undefined) ?? new Date().toISOString()
          : null,
    },
  });

  return ok('order ' + (patch.status || 'updated'));
}

/**
 * Mapeia `orders.status` (paid|refunded|cancelled|canceled|amount_mismatch)
 * pro enum de `invoices.status`. amount_mismatch vira 'failed' (não 'paid'
 * porque o produto não foi liberado).
 */
function mapInvoiceStatusFromOrderStatus(orderStatus: string): import('./_billing-helpers').InvoiceStatus {
  switch (orderStatus) {
    case 'paid':
      return 'paid';
    case 'refunded':
      return 'refunded';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    case 'amount_mismatch':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * Refund é o único tipo "especial"; tudo mais é 'order' (one-shot).
 */
function mapInvoiceTypeFromOrderStatus(orderStatus: string): import('./_billing-helpers').InvoiceType {
  return orderStatus === 'refunded' ? 'refund' : 'order';
}

// ── Preapproval (PRO) ──────────────────────────────────────────────────────

async function processPreapprovalEvent(opts: {
  eventId: string;
  supaUrl: string;
  serviceKey: string;
  sHeaders: Record<string, string>;
  reqHeaders: Headers;
}): Promise<WebhookResult> {
  const { eventId, supaUrl, serviceKey, sHeaders, reqHeaders } = opts;

  let pre: MpPreapprovalResponse;
  try {
    const r = await fetch(`https://api.mercadopago.com/preapproval/${eventId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    if (!r.ok) return ok(`mp ${r.status}`);
    pre = (await r.json()) as MpPreapprovalResponse;
  } catch {
    return ok('erro ao consultar mp');
  }

  const userId = pre?.external_reference;
  if (!userId) return ok('sem external_reference');

  const status = pre?.status;
  // Valida valor (anti-fraude: atacante criava preapproval R$1 e ativava PRO)
  const proAmount = Number(pre?.auto_recurring?.transaction_amount || 0);
  const proCurrency = String(pre?.auto_recurring?.currency_id || '');

  let patch: Record<string, unknown>;
  if (status === 'authorized') {
    if (
      proCurrency !== 'BRL' ||
      Math.abs(proAmount - PRO_AMOUNT_BRL) > 0.01
    ) {
      console.warn('mp-webhook: preapproval com valor suspeito, ignorando ativação', {
        userIdPrefix: String(userId).slice(0, 8),
        proAmount,
        proCurrency,
        expected: PRO_AMOUNT_BRL,
      });
      return ok('preapproval com valor diferente do esperado');
    }
    patch = {
      is_pro: true,
      mp_preapproval_id: eventId,
      pro_expires_at: new Date(
        Date.now() + PRO_VALIDITY_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  } else if (status === 'cancelled' || status === 'paused') {
    // R-H12 (2026-06-12): cancel/pause da subscription NÃO revoga acesso
    // imediato — usuário mantém PRO até o fim do ciclo já pago.
    //
    // Comportamento documentado:
    //   (1) acesso continua até `pro_expires_at` (data do fim do ciclo);
    //   (2) `pro_grace_until = pro_expires_at` sinaliza pro UX "subscription
    //       cancelada, expira em <data>";
    //   (3) `is_pro_active(uuid)` (SQL Wave 7) honra `pro_grace_until`
    //       (cláusula OR no SQL), então user permanece PRO até a data;
    //   (4) admin pode revogar IMEDIATO via `/admin/users` se precisar
    //       (chargeback, fraude) — esse caminho zera `is_pro`/`pro_expires_at`.
    //
    // NÃO setamos `is_pro=false` aqui nem zeramos `pro_expires_at`. O
    // próximo ciclo que não chegar ativa a expiração natural via `now()`.
    //
    // SELECT prévio do profile pra copiar `pro_expires_at` em
    // `pro_grace_until` — UX precisa do timestamp pra mostrar "expira em".
    // Falha silenciosa: se SELECT falhar, fazemos só o patch parcial sem
    // grace_until (acesso continua via pro_expires_at, que é o que importa).
    let currentExpiresAt: string | null = null;
    try {
      const pr = await fetch(
        `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=pro_expires_at`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
        },
      );
      if (pr.ok) {
        const rows = (await pr.json().catch(() => [])) as Array<{
          pro_expires_at?: string | null;
        }>;
        currentExpiresAt = rows?.[0]?.pro_expires_at ?? null;
      }
    } catch {
      /* silent — patch parcial vale (acesso preservado por pro_expires_at) */
    }
    patch = {
      mp_preapproval_id: eventId,
      pro_grace_until: currentExpiresAt,
      // is_pro intacto: trigger handle_invoice_paid e ativação normal mexem
      // nele. pro_expires_at também intacto pra expiração natural.
    };
  } else {
    return ok('preapproval status ' + status + ' — sem ação');
  }

  try {
    const r = await fetch(
      `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: sHeaders,
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(SUPA_TIMEOUT_MS),
      }
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return ok(`supabase ${r.status}: ${t.slice(0, 150)}`);
    }
  } catch {
    return ok('erro ao atualizar supabase');
  }

  // Audit-log: mudança de subscription PRO (activate/cancel/pause).
  // actor_id é o usuário cuja subscription mudou — webhook é server-to-server
  // mas a ação afeta este usuário diretamente.
  // R-H5: critical=true só pra `authorized` (financeiro: PRO ativado).
  // Cancel/pause mantém fail-open (perder trilha de desativação é menos
  // problemático que perder de ativação). Webhook DEVE retornar 200
  // (anti-retry MP) — capturamos throw e logamos via console.error.
  try {
    await logAuditEvent({
      actorId: userId,
      action: `mp.subscription.${status}`,
      targetTable: 'profiles',
      targetId: userId,
      changes: {
        mp_preapproval_id: eventId,
        mp_status: status,
        is_pro_new: patch.is_pro,
        pro_amount: proAmount,
        pro_currency: proCurrency,
      },
      request: { headers: reqHeaders },
      critical: status === 'authorized',
    });
  } catch (e) {
    console.error(
      'mp-webhook: CRITICAL audit insert failed for authorized subscription',
      { userIdPrefix: String(userId).slice(0, 8), mp_preapproval_id: eventId },
      e instanceof Error ? e.message : e,
    );
    // Não muda status retornado — profile já está is_pro=true no banco.
  }

  // Hardening#11 — registra invoice de subscription. Idempotente por
  // external_id (mp preapproval id). O trigger handle_invoice_paid propaga
  // o pro_expires_at automaticamente, MAS o webhook também já faz isso
  // explicitamente acima (compat com fluxo legado, sem duplicar dias). O
  // trigger só roda se status='paid' E foi transição (idempotente).
  const isAuthorized = status === 'authorized';
  await recordInvoiceViaRest({
    supaUrl,
    serviceKey,
    invoice: {
      user_id: userId,
      external_id: String(eventId),
      provider: 'mercadopago',
      type: 'subscription',
      amount: proAmount,
      currency: proCurrency || 'BRL',
      status: isAuthorized
        ? 'paid'
        : status === 'cancelled'
          ? 'cancelled'
          : status === 'paused'
            ? 'failed'
            : 'pending',
      metadata: {
        mp_preapproval_id: eventId,
        mp_status: status,
      },
      paid_at: isAuthorized ? new Date().toISOString() : null,
    },
  });

  return ok('ok');
}

// ── HMAC / signature ───────────────────────────────────────────────────────

/**
 * Verifica o header x-signature do Mercado Pago.
 * Formato: "ts=<unixtime>,v1=<hmac-sha256-hex>"
 * HMAC calculado sobre `id:<dataId>;request-id:<reqId>;ts:<ts>;` usando
 * MP_WEBHOOK_SECRET.
 *
 * Comportamento quando MP_WEBHOOK_SECRET está ausente (CRIT-2 fix 2026-06-12):
 *   - NODE_ENV=production → fail-closed (401). Loga `audit_event` com
 *     action='mp.webhook.rejected_no_secret' pra alertar operação.
 *   - MP_WEBHOOK_ENFORCE=true (qualquer env) → fail-closed.
 *   - Dev/staging sem ENFORCE → fail-open (UX local).
 */
async function verifyMpSignature(args: {
  headers: Headers;
  body: MpWebhookBody;
}): Promise<boolean> {
  const { headers, body } = args;
  if (!process.env.MP_WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        'mp-webhook: MP_WEBHOOK_SECRET ausente em produção — rejeitando webhook (fail-closed)'
      );
      // Audit-log: tentativa de webhook em prod sem secret configurado.
      // R-H5: critical=true — esta é a única visibilidade que temos de
      // tentativas de fraude com config quebrada em prod. Perder o
      // registro = perder evidência forense. Capturamos throw porque o
      // webhook sempre retorna 401 a partir daqui (não muda nada).
      try {
        await logAuditEvent({
          actorId: null,
          action: 'mp.webhook.rejected_no_secret',
          targetTable: null,
          targetId: null,
          changes: {
            reason: 'MP_WEBHOOK_SECRET ausente em produção',
            node_env: 'production',
          },
          request: { headers },
          critical: true,
        });
      } catch (e) {
        console.error(
          'mp-webhook: CRITICAL audit insert failed for rejected_no_secret',
          e instanceof Error ? e.message : e,
        );
      }
      return false;
    }
    if (process.env.MP_WEBHOOK_ENFORCE === 'true') {
      console.warn(
        'mp-webhook: MP_WEBHOOK_ENFORCE=true mas MP_WEBHOOK_SECRET ausente — rejeitando'
      );
      return false;
    }
    console.warn(
      'mp-webhook: MP_WEBHOOK_SECRET não configurado — dev/staging fail-open'
    );
    return true;
  }
  const sigHeader = headers.get('x-signature') || '';
  const reqId = headers.get('x-request-id') || '';
  const parts: Record<string, string> = {};
  for (const p of sigHeader.split(',')) {
    const idx = p.indexOf('=');
    if (idx <= 0) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k && v) parts[k] = v;
  }
  const ts = parts.ts || '';
  const v1 = parts.v1 || '';
  if (!ts || !v1) return false;
  const dataId = (body && body.data && body.data.id) || '';
  const manifest = `id:${dataId};request-id:${reqId};ts:${ts};`;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(process.env.MP_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(manifest)
    );
    const hex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return timingSafeEqualHex(hex, v1);
  } catch (e) {
    console.warn(
      'mp-webhook: erro ao calcular HMAC:',
      e instanceof Error ? e.message : String(e)
    );
    return false;
  }
}

/**
 * Comparação em tempo constante (hex strings). Edge runtime não expõe
 * crypto.timingSafeEqual, então implementamos manualmente.
 *
 * Exportado pra teste.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ok(msg: string): WebhookResult {
  return { status: 200, body: { received: true, msg } };
}

function safeParseUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

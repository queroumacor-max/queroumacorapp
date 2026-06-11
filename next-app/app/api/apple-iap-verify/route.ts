// app/api/apple-iap-verify/route.ts — recebe `receipt` + `transactionId`
// do wrapper iOS (Capacitor) e marca a invoice como paga (trigger
// `handle_invoice_paid` Wave 7 propaga `is_pro=true + pro_expires_at +30d`).
//
// ⚠️  STUB DE PRODUÇÃO INCOMPLETO ⚠️
// ──────────────────────────────────
// Esta rota ACEITA `receipt` ÀS CEGAS — NÃO faz call pra Apple verifyReceipt.
// Em produção, qualquer cliente honesto vai mandar um receipt válido, mas
// qualquer um pode forjar um string aleatório e virar PRO.
//
// PRÉ-PRODUÇÃO TODO:
//   1. Configurar `APPLE_APP_SHARED_SECRET` (App Store Connect →
//      Subscriptions → App-Specific Shared Secret).
//   2. POST `https://buy.itunes.apple.com/verifyReceipt` (production) ou
//      `https://sandbox.itunes.apple.com/verifyReceipt` (dev). Body:
//      `{ "receipt-data": <base64>, "password": "<shared secret>",
//         "exclude-old-transactions": true }`.
//   3. Validar resposta `status === 0` e `latest_receipt_info[0].product_id`
//      casa com o esperado.
//   4. Idealmente também configurar App Store Server Notifications V2
//      (webhook do Apple) pra renewal/cancel/grace sem polling.
//
// Detalhes em `docs/BILLING_STRATEGY.md`.

import { type NextRequest, NextResponse } from 'next/server';
import {
  ServiceError,
  getServiceKey,
  getSupabaseUrl,
  jsonResponse,
  requireAuthStrict,
  serviceErrorResponse,
} from '@/lib/api/security';

export const runtime = 'edge';

const PRO_AMOUNT_BRL = 39;
const INSERT_TIMEOUT_MS = 8000;

interface VerifyBody {
  receipt?: string;
  transactionId?: string;
  productId?: string;
  userId?: string;
  accessToken?: string;
}

export async function POST(request: NextRequest) {
  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  const receipt = typeof body.receipt === 'string' ? body.receipt.trim() : '';
  const transactionId =
    typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
  const productId =
    typeof body.productId === 'string' ? body.productId.trim() : '';

  if (!receipt) return jsonResponse({ error: 'receipt obrigatório' }, 400);
  if (!transactionId) {
    return jsonResponse({ error: 'transactionId obrigatório' }, 400);
  }
  if (!productId) return jsonResponse({ error: 'productId obrigatório' }, 400);

  // Auth: user precisa estar logado pra creditar PRO na conta dele.
  let userId: string;
  try {
    const { user } = await requireAuthStrict(request, body);
    userId = user.id;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'auth falhou' }, 401);
  }

  // ⚠️  STUB: produção precisa chamar Apple verifyReceipt aqui.
  // Sem isso, qualquer receipt é aceito. Veja JSDoc no topo do arquivo.
  console.warn(
    '[apple-iap-verify] STUB: aceitando receipt sem verificação ' +
      'server-side. NÃO usar em produção sem chamar Apple verifyReceipt.'
  );

  // Grava invoice via service_role. Trigger handle_invoice_paid (Wave 7)
  // propaga is_pro=true + pro_expires_at +30d em transitions → 'paid'.
  // external_id = transactionId garante idempotência (Apple reenvia o mesmo
  // transactionId em re-purchase / restore).
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return jsonResponse({ error: 'service indisponível' }, 503);
  }
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return jsonResponse({ error: 'service indisponível' }, 503);
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
        p_user_id: userId,
        p_external_id: transactionId,
        p_provider: 'apple-iap',
        p_type: 'subscription',
        p_amount: PRO_AMOUNT_BRL,
        p_currency: 'BRL',
        p_status: 'paid',
        p_metadata: {
          product_id: productId,
          // NÃO armazenamos o receipt completo no metadata (pode ter 100KB+).
          // Em produção, salva só um hash pra auditoria.
          receipt_hash: receipt.length > 16 ? receipt.slice(0, 16) + '...' : receipt,
          source: 'apple-iap-verify-stub',
        },
        p_paid_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[apple-iap-verify] upsert_invoice falhou', res.status, txt.slice(0, 200));
      return jsonResponse({ error: 'falha ao registrar invoice' }, 502);
    }
  } catch (e) {
    console.warn(
      '[apple-iap-verify] upsert exception:',
      e instanceof Error ? e.message : e
    );
    return jsonResponse({ error: 'erro interno' }, 500);
  }

  return NextResponse.json({ ok: true, verified: 'stub', plan: 'pro' });
}

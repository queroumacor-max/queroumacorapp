// app/api/play-billing-verify/route.ts — recebe `purchaseToken` do TWA
// Android e marca a invoice como paga (trigger `handle_invoice_paid` Wave 7
// propaga `is_pro=true + pro_expires_at +30d` no profile).
//
// ⚠️  STUB DE PRODUÇÃO INCOMPLETO ⚠️
// ──────────────────────────────────
// Esta rota ACEITA `purchaseToken` ÀS CEGAS — NÃO faz call pra Google Play
// Developer API pra validar que o token é genuíno e ainda está ativo. Em
// produção, qualquer cliente honesto vai mandar um token válido, mas qualquer
// um pode forjar um string aleatório e virar PRO.
//
// PRÉ-PRODUÇÃO TODO:
//   1. Instalar `googleapis` (`npm i googleapis`).
//   2. Criar service account no Google Cloud Console com permissão
//      `androidpublisher.subscriptions.get` e armazenar JSON em
//      `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` env var.
//   3. Chamar `androidpublisher.purchases.subscriptionsv2.get({
//        packageName: 'br.com.queroumacor.app',
//        token: purchaseToken
//      })` e validar `subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE'`
//      antes de gravar a invoice como paga.
//   4. Idealmente também receber RTDN (Real-Time Developer Notifications)
//      via Pub/Sub pra atualizar status em renewal/cancel/grace sem
//      precisar de polling.
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
  purchaseToken?: string;
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

  const purchaseToken =
    typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : '';
  const productId =
    typeof body.productId === 'string' ? body.productId.trim() : '';

  if (!purchaseToken) {
    return jsonResponse({ error: 'purchaseToken obrigatório' }, 400);
  }
  if (!productId) {
    return jsonResponse({ error: 'productId obrigatório' }, 400);
  }

  // Auth: user precisa estar logado pra creditar PRO na conta dele.
  // Permite accessToken no body como fallback (mesma convenção do
  // /api/checkout) — facilita TWA que pode não setar Authorization header.
  let userId: string;
  try {
    const { user } = await requireAuthStrict(request, body);
    userId = user.id;
  } catch (e) {
    if (e instanceof ServiceError) return serviceErrorResponse(e);
    return jsonResponse({ error: 'auth falhou' }, 401);
  }

  // ⚠️  STUB: produção precisa chamar Google Play Developer API aqui.
  // Sem isso, qualquer token é aceito. Veja JSDoc no topo do arquivo.
  console.warn(
    '[play-billing-verify] STUB: aceitando purchaseToken sem verificação ' +
      'server-side. NÃO usar em produção sem chamar Google Play Developer API.'
  );

  // Grava invoice via service_role. Trigger handle_invoice_paid (Wave 7)
  // propaga is_pro=true + pro_expires_at +30d em transitions → 'paid'.
  // Reusa o RPC upsert_invoice pra idempotência por external_id.
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
        p_external_id: purchaseToken,
        p_provider: 'google-play',
        p_type: 'subscription',
        p_amount: PRO_AMOUNT_BRL,
        p_currency: 'BRL',
        p_status: 'paid',
        p_metadata: { product_id: productId, source: 'play-billing-verify-stub' },
        p_paid_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn('[play-billing-verify] upsert_invoice falhou', res.status, txt.slice(0, 200));
      return jsonResponse({ error: 'falha ao registrar invoice' }, 502);
    }
  } catch (e) {
    console.warn(
      '[play-billing-verify] upsert exception:',
      e instanceof Error ? e.message : e
    );
    return jsonResponse({ error: 'erro interno' }, 500);
  }

  return NextResponse.json({ ok: true, verified: 'stub', plan: 'pro' });
}

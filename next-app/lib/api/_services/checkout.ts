// lib/api/_services/checkout.ts — port de
// `functions/api/_services/checkout.js`. Cria preapproval (assinatura PRO)
// no Mercado Pago.
//
// accessToken é a fonte autoritativa de userId/email — cliente NÃO passa
// body.userId/body.email (atacante forjava external_reference=<vítima>
// ativando PRO em conta alheia).
//
// Diferenças do vanilla:
//   - Sem FALLBACK_SUPABASE_URL/FALLBACK_ANON_KEY: usa `getSupabaseUrl()`
//     que throw ServiceError 503 quando ausente (consistente com o resto
//     do port Next).
//   - Tipos TS estritos pra payload do MP.

import { ServiceError, resolveSupabaseEnv } from '../security';
import { getRuntimeEnv } from '../env';

const MP_TIMEOUT_MS = 15000;
const AUTH_TIMEOUT_MS = 10000;
const PRO_AMOUNT_BRL = 39;

export interface CreateProCheckoutResult {
  init_point: string;
  preapproval_id: string | null;
}

interface MpPreapprovalResponse {
  init_point?: string;
  sandbox_init_point?: string;
  id?: string;
  message?: string;
}

export async function createProCheckout(args: {
  accessToken: string;
}): Promise<CreateProCheckoutResult> {
  const { accessToken } = args;

  if (!getRuntimeEnv('MP_ACCESS_TOKEN')) {
    // Nome da env só no log (auditoria 2026-09-26, L3).
    console.warn('[checkout] MP_ACCESS_TOKEN ausente');
    throw new ServiceError('Serviço indisponível no momento.', 503);
  }
  if (!accessToken) throw new ServiceError('accessToken obrigatório — faça login', 401);

  const verified = await verifySupabaseToken(accessToken);
  if (!verified || !verified.id) {
    throw new ServiceError('Sessão inválida — faça login novamente', 401);
  }
  const userId = verified.id;
  const email = verified.email;
  if (!email) {
    throw new ServiceError('Email não disponível no perfil — atualize seu cadastro', 400);
  }

  // Origem hardcoded — evita Host header forge (proxy/CDN poderia forwardar
  // Host arbitrário e MP redirecionar pra attacker.com).
  const origin = 'https://queroumacor.com.br';
  const payload = {
    reason: 'QueroUmaCor PRO — assinatura mensal',
    external_reference: userId,
    payer_email: email,
    back_url: origin + '/?pro=success',
    status: 'pending',
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: PRO_AMOUNT_BRL,
      currency_id: 'BRL',
    },
  };

  try {
    const r = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getRuntimeEnv('MP_ACCESS_TOKEN')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    const data = (await r.json().catch(() => ({}))) as MpPreapprovalResponse;
    if (!r.ok) {
      const detail = (data?.message || JSON.stringify(data)).slice(0, 300);
      console.warn('checkout MP error', r.status, detail);
      throw new ServiceError('Falha temporária no pagamento — tente de novo', 502);
    }
    const initPoint = data.init_point || data.sandbox_init_point;
    if (!initPoint) throw new ServiceError('Mercado Pago não retornou init_point', 502);
    return { init_point: initPoint, preapproval_id: data.id || null };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const err = e as { name?: string; message?: string };
    const isTimeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) throw new ServiceError('Mercado Pago timeout (15s) — tente de novo', 504);
    console.warn('checkout: exception', err?.message || e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}

async function verifySupabaseToken(
  token: string
): Promise<{ id: string; email: string } | null> {
  // Par ÚNICO — url e anonKey do MESMO objeto, nunca duas resoluções.
  let supaUrl: string;
  let anonKey: string;
  try {
    ({ url: supaUrl, anonKey } = resolveSupabaseEnv());
  } catch {
    return null;
  }
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const u = (await r.json().catch(() => null)) as { id?: string; email?: string } | null;
    if (!u || typeof u.id !== 'string' || !u.id) return null;
    return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
  } catch (e) {
    console.warn(
      'checkout: erro ao validar token no Supabase:',
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

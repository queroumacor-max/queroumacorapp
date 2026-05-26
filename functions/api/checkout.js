// @ts-check
// Cria uma assinatura recorrente (preapproval) no Mercado Pago para o Plano PRO.
// Requer a variável de ambiente MP_ACCESS_TOKEN no Cloudflare Pages.
// Se o cliente enviar body.accessToken, validamos no Supabase e usamos o
// user.id / email autoritativos do token (ignorando o que veio no body).
// Sem token, mantemos o fluxo antigo (fail-back) para não quebrar clientes
// que ainda não passam o accessToken.
import { jsonResponse as json, FALLBACK_SUPABASE_URL, FALLBACK_ANON_KEY } from './_security.js';

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.MP_ACCESS_TOKEN) {
    return json({ error: 'MP_ACCESS_TOKEN não configurada no projeto Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!accessToken) {
    return json({ error: 'accessToken obrigatório — faça login' }, 401);
  }

  // accessToken É a fonte autoritativa de userId/email — o cliente NÃO
  // pode mais passar body.userId/body.email (antes era fallback, e atacante
  // forjava external_reference=<vítima> ativando PRO em conta alheia).
  const verified = await verifySupabaseToken(accessToken, env);
  if (!verified || !verified.id) {
    return json({ error: 'Sessão inválida — faça login novamente' }, 401);
  }
  const userId = verified.id;
  // body.email NÃO é mais aceito como fallback — atacante podia passar
  // email da vítima e o MP enviava cobrança em nome dela (phishing). Email
  // agora vem APENAS do JWT verificado.
  const email = verified.email;
  if (!email) {
    return json({ error: 'Email não disponível no perfil — atualize seu cadastro' }, 400);
  }

  // Origem hardcoded — evita Host header forge (proxy/CDN poderia
  // forwardar Host arbitrário e MP redirecionar pra attacker.com)
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
      transaction_amount: 39,
      currency_id: 'BRL'
    }
  };

  try {
    const r = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data?.message || JSON.stringify(data)).slice(0, 300);
      console.warn('checkout MP error', r.status, detail);
      return json({ error: 'Falha temporária no pagamento — tente de novo' }, 502);
    }
    const initPoint = data.init_point || data.sandbox_init_point;
    if (!initPoint) {
      return json({ error: 'Mercado Pago não retornou init_point' }, 502);
    }
    return json({ init_point: initPoint, preapproval_id: data.id || null });
  } catch (e) {
    const isTimeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) return json({ error: 'Mercado Pago timeout (15s) — tente de novo' }, 504);
    console.warn('checkout: exception', e && e.message || e);
    return json({ error: 'Erro interno — tente de novo em instantes' }, 500);
  }
}

// Valida o accessToken no endpoint /auth/v1/user do Supabase.
// Retorna { id, email } se válido, ou null caso contrário.
/**
 * @param {string} token
 * @param {Record<string, string>} env
 * @returns {Promise<{ id: string, email: string } | null>}
 */
async function verifySupabaseToken(token, env) {
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || FALLBACK_ANON_KEY;
  try {
    const r = await fetch(`${supaUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': anonKey
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    if (!u || typeof u.id !== 'string' || !u.id) return null;
    return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
  } catch (e) {
    console.warn('checkout: erro ao validar token no Supabase:', String(e?.message || e));
    return null;
  }
}

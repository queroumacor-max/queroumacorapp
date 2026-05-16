// Cria uma assinatura recorrente (preapproval) no Mercado Pago para o Plano PRO.
// Requer a variável de ambiente MP_ACCESS_TOKEN no Cloudflare Pages.
export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.MP_ACCESS_TOKEN) {
    return json({ error: 'MP_ACCESS_TOKEN não configurada no projeto Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!userId || !email) {
    return json({ error: 'userId e email são obrigatórios' }, 400);
  }

  // Origem do site para o redirecionamento de volta após o pagamento
  const origin = (() => {
    try { return new URL(request.url).origin; }
    catch { return 'https://queroumacor.com.br'; }
  })();

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
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return json({ error: `Mercado Pago ${r.status}: ${(data?.message || JSON.stringify(data)).slice(0, 300)}` }, 502);
    }
    const initPoint = data.init_point || data.sandbox_init_point;
    if (!initPoint) {
      return json({ error: 'Mercado Pago não retornou init_point' }, 502);
    }
    return json({ init_point: initPoint, preapproval_id: data.id || null });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

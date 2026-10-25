import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  planejarSync,
  contasDoEvento,
  reembolsoDeConsumivel,
  ehProdutoAssinatura,
  chaveDaTransacao,
  sincronizarCompras,
} from '../../lib/api/_services/revenuecat';

const AGORA = Date.parse('2026-10-25T12:00:00Z');
const UID = '11111111-2222-3333-4444-555555555555';
const OUTRO = '99999999-2222-3333-4444-555555555555';

describe('planejarSync — consumíveis', () => {
  it('credita só produto conhecido, chaveado pela transação da loja', () => {
    const p = planejarSync(
      {
        non_subscriptions: {
          quote_pack_40: [{ id: 'rc1', store_transaction_id: 'GPA.1', store: 'play_store', is_sandbox: true }],
          obra_1: [{ id: 'rc2', store_transaction_id: '2000001', store: 'app_store', price: { amount: 2.9, currency: 'brl' }, purchase_date: '2026-10-25T10:00:00Z' }],
          produto_estranho: [{ id: 'x', store_transaction_id: 'GPA.9', store: 'play_store' }],
        },
      },
      AGORA,
    );
    expect(p.consumiveis).toEqual([
      { txKey: 'rc:play_store:GPA.1', productId: 'quote_pack_40', store: 'play_store', sandbox: true, preco: null, compradoEm: null },
      // Preço cobrado e data vão pro `raw` (tela de Compras do portal).
      { txKey: 'rc:app_store:2000001', productId: 'obra_1', store: 'app_store', sandbox: false, preco: { amount: 2.9, currency: 'BRL' }, compradoEm: '2026-10-25T10:00:00Z' },
    ]);
  });

  it('sem id de transação nem loja não credita', () => {
    const p = planejarSync({ non_subscriptions: { quote_1: [{ id: '' }, {}] } }, AGORA);
    expect(p.consumiveis).toEqual([]);
  });
});

describe('planejarSync — assinatura', () => {
  const sub = (s: Record<string, unknown>) =>
    planejarSync({ subscriptions: { 'quotes_unlimited:mensal': { store: 'play_store', store_transaction_id: 'GPA.s', ...s } } }, AGORA)
      .assinatura;

  it('ativa', () => {
    expect(sub({ expires_date: '2026-11-25T12:00:00Z' })).toMatchObject({ status: 'active', until: '2026-11-25T12:00:00.000Z' });
  });
  it('cancelada continua valendo até o fim', () => {
    expect(sub({ expires_date: '2026-11-25T12:00:00Z', unsubscribe_detected_at: '2026-10-20T00:00:00Z' })).toMatchObject({
      status: 'cancelled',
      until: '2026-11-25T12:00:00.000Z',
    });
  });
  it('carência estende o fim', () => {
    expect(sub({ expires_date: '2026-10-24T12:00:00Z', grace_period_expires_date: '2026-10-28T12:00:00Z' })).toMatchObject({
      status: 'grace',
      until: '2026-10-28T12:00:00.000Z',
    });
  });
  it('expirada', () => {
    expect(sub({ expires_date: '2026-10-01T00:00:00Z' })).toMatchObject({ status: 'expired' });
  });
  it('reembolso corta na hora', () => {
    const a = sub({ expires_date: '2026-11-25T12:00:00Z', refunded_at: '2026-10-25T10:00:00Z' });
    expect(a?.status).toBe('refunded');
    expect(Date.parse(String(a?.until))).toBeLessThanOrEqual(AGORA);
  });
  it('o id do evento muda quando o estado muda (cada estado aplica uma vez)', () => {
    const a = sub({ expires_date: '2026-11-25T12:00:00Z' });
    const b = sub({ expires_date: '2026-12-25T12:00:00Z' });
    expect(a?.eventId).not.toBe(b?.eventId);
  });
  it('reconhece o id do Google com plano base e ignora outros produtos', () => {
    expect(ehProdutoAssinatura('quotes_unlimited')).toBe(true);
    expect(ehProdutoAssinatura('quotes_unlimited:mensal')).toBe(true);
    expect(ehProdutoAssinatura('quotes_unlimited_x')).toBe(false);
    expect(planejarSync({ subscriptions: { outra: { expires_date: '2027-01-01' } } }, AGORA).assinatura).toBeNull();
  });
});

describe('webhook — quem reler e reembolso', () => {
  it('só UUIDs (id anônimo da RevenueCat fica de fora), sem repetir', () => {
    expect(
      contasDoEvento({ app_user_id: UID, original_app_user_id: '$RCAnonymousID:abc', aliases: [UID], transferred_to: [OUTRO] }),
    ).toEqual([UID, OUTRO]);
  });
  it('reembolso de consumível gera a mesma chave do crédito', () => {
    expect(
      reembolsoDeConsumivel({ type: 'CANCELLATION', product_id: 'quote_pack_40', store: 'PLAY_STORE', transaction_id: 'GPA.1', cancel_reason: 'CUSTOMER_SUPPORT' }),
    ).toBe(chaveDaTransacao('play_store', 'GPA.1'));
    expect(reembolsoDeConsumivel({ type: 'CANCELLATION', product_id: 'quotes_unlimited', store: 'PLAY_STORE', transaction_id: 'x' })).toBeNull();
    expect(reembolsoDeConsumivel({ type: 'RENEWAL', product_id: 'quote_1', store: 'APP_STORE', transaction_id: 'x' })).toBeNull();
  });
});

describe('sincronizarCompras', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it('lê a RevenueCat com a chave secreta e credita pelo banco', async () => {
    process.env.REVENUECAT_SECRET_KEY = 'sk_test';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    const chamadas: Array<{ url: string; body?: unknown; auth?: string | null }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      chamadas.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: h.get('authorization') });
      if (url.includes('api.revenuecat.com')) {
        return new Response(
          JSON.stringify({
            subscriber: {
              non_subscriptions: { quote_1: [{ id: 'a', store_transaction_id: 'GPA.7', store: 'play_store' }] },
              subscriptions: { quotes_unlimited: { expires_date: '2099-01-01T00:00:00Z', store: 'play_store', store_transaction_id: 'GPA.s' } },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('grant_billing_purchase')) return new Response('"granted"', { status: 200 });
      if (url.includes('set_pro_subscription')) return new Response('"applied"', { status: 200 });
      return new Response('?', { status: 500 });
    });
    const r = await sincronizarCompras(UID);
    expect(r.creditados).toBe(1);
    expect(r.assinaturaResultado).toBe('applied');
    expect(chamadas[0].url).toContain(`/subscribers/${UID}`);
    expect(chamadas[0].auth).toBe('Bearer sk_test');
    const grant = chamadas.find((c) => c.url.includes('grant_billing_purchase'));
    expect(grant?.body).toMatchObject({ p_user: UID, p_transaction_id: 'rc:play_store:GPA.7', p_product_id: 'quote_1' });
  });

  it('id que não é UUID nem chega na RevenueCat', async () => {
    await expect(sincronizarCompras('$RCAnonymousID:x')).rejects.toThrow();
  });
});

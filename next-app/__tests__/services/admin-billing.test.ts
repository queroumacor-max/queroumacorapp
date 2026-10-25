import { describe, it, expect } from 'vitest';
import { montarRelatorioDeCompras } from '@/lib/api/_services/admin-billing';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const AGORA = Date.parse('2026-10-25T12:00:00Z');

const perfis = [
  { id: U1, name: 'Ana', tag: 'ana', phone: '5511999990000', email: 'a@x.com', role: 'pintor' },
  { id: U2, business_name: 'Bia Pinturas', name: 'Bia', tag: null, username: 'bia', role: 'pintor' },
];

describe('montarRelatorioDeCompras', () => {
  const rel = montarRelatorioDeCompras(
    {
      eventos: [
        { id: 1, store_transaction_id: 'app_store:1', user_id: U1, product_id: 'quote_pack_40', platform: 'app_store', kind: 'purchase', credit_kind: 'quote', credits_granted: 40, status: 'applied', raw: { sandbox: false, price: { amount: 29.9, currency: 'brl' } }, created_at: '2026-10-25T10:00:00Z' },
        { id: 2, store_transaction_id: 'app_store:2', user_id: U1, product_id: 'quote_1', platform: 'app_store', kind: 'purchase', credit_kind: 'quote', credits_granted: 1, status: 'refunded', raw: {}, created_at: '2026-10-25T09:00:00Z' },
        { id: 3, store_transaction_id: 'app_store:3', user_id: U2, product_id: 'obra_1', platform: 'app_store', kind: 'purchase', credit_kind: 'obra', credits_granted: 1, status: 'applied', raw: { sandbox: true }, created_at: '2026-10-25T11:00:00Z' },
        { id: 4, store_transaction_id: 'rc-sub:x', user_id: U2, product_id: 'quotes_unlimited', platform: 'play_store', kind: 'active', status: 'applied', raw: {}, created_at: '2026-10-24T11:00:00Z' },
        { id: 5, store_transaction_id: 'app_store:5', user_id: '33333333-3333-3333-3333-333333333333', product_id: 'quote_1', kind: 'purchase', status: 'applied', raw: {}, created_at: '2026-10-20T11:00:00Z' },
      ],
      saldos: [
        { user_id: U1, free_quotes: 2, quote_credits: 39, free_obras: 1, obra_credits: 0 },
        { user_id: U2, free_quotes: 5, quote_credits: 0, free_obras: 0, obra_credits: 0, unlimited_until: '2026-11-24T00:00:00Z', unlimited_status: 'active' },
      ],
      debitos: [{ kind: 'quote', fonte: 'free' }, { kind: 'quote', fonte: 'free' }, { kind: 'quote', fonte: 'credit' }, { kind: 'obra', fonte: 'unlimited' }],
      config: { enforce: false, free_quotes: 5, free_obras: 1 },
      perfis,
    },
    AGORA,
  );

  it('ordena por data, mais nova primeiro', () => {
    expect(rel.compras.map((c) => c.id)).toEqual([3, 1, 2, 4, 5]);
  });
  it('valor cobrado vem do raw; sem ele, preço de tabela marcado como estimado', () => {
    expect(rel.compras.find((c) => c.id === 1)!.valor).toEqual({ amount: 29.9, currency: 'BRL', estimado: false });
    expect(rel.compras.find((c) => c.id === 2)!.valor).toEqual({ amount: 1, currency: 'BRL', estimado: true });
  });
  it('teste (sandbox) e reembolso ficam fora da contagem de vendas', () => {
    expect(rel.totais.compras).toBe(3); // 1 (pacote), 4 (PRO ativo), 5
    expect(rel.totais.comprasTeste).toBe(1);
    expect(rel.totais.reembolsos).toBe(1);
    expect(rel.totais.receitaPorMoeda).toEqual({ BRL: 29.9 });
    expect(rel.totais.receitaEstimadaBrl).toBe(90.8);
  });
  it('assinatura: o status é o estado mandado pela loja', () => {
    expect(rel.compras.find((c) => c.id === 4)).toMatchObject({ tipo: 'assinatura', status: 'active', produtoRotulo: 'PRO mensal' });
  });
  it('pessoa: nome do negócio primeiro; conta sem perfil não some', () => {
    expect(rel.compras.find((c) => c.id === 3)!.pessoa).toMatchObject({ nome: 'Bia Pinturas', tag: 'bia' });
    expect(rel.compras.find((c) => c.id === 5)!.pessoa!.nome).toMatch(/sem perfil/);
  });
  it('assinantes, saldos comprados e uso por fonte', () => {
    expect(rel.totais.assinantesAtivos).toBe(1);
    expect(rel.saldos.map((s) => s.pessoa!.id)).toEqual([U1]);
    expect(rel.uso).toEqual({ orcamentos: { free: 2, credit: 1 }, obras: { unlimited: 1 } });
    expect(rel.avisos.join(' ')).toMatch(/DESLIGADA/);
  });
});

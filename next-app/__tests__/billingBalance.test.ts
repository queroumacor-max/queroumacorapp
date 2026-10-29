import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREE_QUOTES,
  FREE_OBRAS,
  BILLING_PRODUCTS,
  CREDITOS_POR_PRODUTO,
  creditosDoProduto,
  ehAssinatura,
  fonteDoProximo,
  podeUsar,
  aplicarDebito,
  resumoDoSaldo,
  ehErroSemSaldo,
  saldoDaLinha,
  BalanceEmptyError,
  type BillingBalance,
  situacaoDoPlano,
} from '@/lib/billingBalance';

const AGORA = new Date('2026-10-25T12:00:00Z');
const base: BillingBalance = {
  freeQuotes: 5,
  quoteCredits: 0,
  freeObras: 1,
  obraCredits: 0,
  unlimitedUntil: null,
  proActive: false,
  enforced: true,
};

const SQL = readFileSync(join(__dirname, '../../migrations/2026-10-25-billing-balance.sql'), 'utf8');
// Crédito único (2026-10-28) recria débito/compra/reembolso por cima.
const SQL_UNICO = readFileSync(join(__dirname, '../../migrations/2026-10-28-billing-credito-unico.sql'), 'utf8');

describe('orçamentos — ordem do débito', () => {
  it('começa com 5 grátis', () => {
    expect(FREE_QUOTES).toBe(5);
    expect(fonteDoProximo(base, 'quote', AGORA)).toBe('free');
  });

  it('grátis antes dos créditos', () => {
    const b = { ...base, freeQuotes: 1, quoteCredits: 40 };
    const d1 = aplicarDebito(b, 'quote', AGORA);
    expect(d1).toMatchObject({ freeQuotes: 0, quoteCredits: 40 });
    expect(fonteDoProximo(d1, 'quote', AGORA)).toBe('credit');
    expect(aplicarDebito(d1, 'quote', AGORA)).toMatchObject({ freeQuotes: 0, quoteCredits: 39 });
  });

  it('crédito único: o mesmo crédito paga orçamento e obra', () => {
    const b = { ...base, freeQuotes: 0, freeObras: 0, quoteCredits: 40, obraCredits: 0 };
    expect(fonteDoProximo(b, 'obra', AGORA)).toBe('credit');
    expect(aplicarDebito(b, 'obra', AGORA)).toMatchObject({ quoteCredits: 39 });
    // saldo antigo de obra (antes de juntar) também paga orçamento
    const c = { ...base, freeQuotes: 0, freeObras: 0, quoteCredits: 0, obraCredits: 2 };
    expect(fonteDoProximo(c, 'quote', AGORA)).toBe('credit');
    expect(aplicarDebito(c, 'quote', AGORA)).toMatchObject({ obraCredits: 1, quoteCredits: 0 });
  });

  it('assinatura ativa não debita nada', () => {
    const b = { ...base, unlimitedUntil: '2026-11-25T12:00:00Z' };
    expect(fonteDoProximo(b, 'quote', AGORA)).toBe('unlimited');
    expect(fonteDoProximo(b, 'obra', AGORA)).toBe('unlimited');
    expect(aplicarDebito(b, 'quote', AGORA)).toEqual(b);
    expect(aplicarDebito(b, 'obra', AGORA)).toEqual(b);
  });

  it('assinatura vencida volta a debitar', () => {
    const b = { ...base, freeQuotes: 0, quoteCredits: 2, unlimitedUntil: '2026-10-24T12:00:00Z' };
    expect(fonteDoProximo(b, 'quote', AGORA)).toBe('credit');
  });

  it('PRO antigo vale como ilimitado (a assinatura substitui o PRO)', () => {
    const b = { ...base, freeQuotes: 0, freeObras: 0, proActive: true };
    expect(podeUsar(b, 'quote', AGORA)).toBe(true);
    expect(podeUsar(b, 'obra', AGORA)).toBe(true);
  });

  it('sem saldo barra só com a cobrança ligada', () => {
    const vazio = { ...base, freeQuotes: 0, freeObras: 0 };
    expect(podeUsar(vazio, 'quote', AGORA)).toBe(false);
    expect(podeUsar(vazio, 'obra', AGORA)).toBe(false);
    expect(podeUsar({ ...vazio, enforced: false }, 'quote', AGORA)).toBe(true);
  });

  it('débito nunca deixa negativo; data inválida não vira ilimitado', () => {
    const vazio = { ...base, freeQuotes: 0, freeObras: 0 };
    expect(aplicarDebito(vazio, 'quote', AGORA)).toEqual(vazio);
    expect(fonteDoProximo({ ...vazio, unlimitedUntil: 'lixo' }, 'quote', AGORA)).toBeNull();
  });
});

describe('obras', () => {
  it('1 obra grátis, depois usa crédito', () => {
    expect(FREE_OBRAS).toBe(1);
    const d = aplicarDebito(base, 'obra', AGORA);
    expect(d.freeObras).toBe(0);
    expect(fonteDoProximo(d, 'obra', AGORA)).toBeNull();
    expect(fonteDoProximo({ ...d, quoteCredits: 1 }, 'obra', AGORA)).toBe('credit');
    // obra_1 (compra antiga) vira 1 crédito único
    expect(creditosDoProduto('obra_1')).toEqual({ kind: 'quote', n: 1 });
  });
});

describe('produtos', () => {
  it('consumíveis e assinatura', () => {
    expect(creditosDoProduto('quote_1')).toEqual({ kind: 'quote', n: 1 });
    expect(creditosDoProduto('quote_pack_40')).toEqual({ kind: 'quote', n: 40 });
    expect(creditosDoProduto('quotes_unlimited')).toBeNull();
    expect(creditosDoProduto('qualquer')).toBeNull();
    expect(ehAssinatura('quotes_unlimited')).toBe(true);
    expect(ehAssinatura('obra_1')).toBe(false);
  });

  it('o SQL credita o MESMO que o app mostra', () => {
    for (const [id, { n }] of Object.entries(CREDITOS_POR_PRODUTO)) {
      expect(SQL_UNICO).toContain(`WHEN '${id}' THEN v_n := ${n};`);
    }
    expect(SQL_UNICO).toContain('UPDATE public.billing_balance SET quote_credits = quote_credits + v_n');
    expect(SQL).toContain(`'${BILLING_PRODUCTS.pro}'`);
  });

  it('crédito único no SQL: IA gasta o mesmo saldo e só o servidor debita', () => {
    expect(SQL_UNICO).toContain("CHECK (kind IN ('quote', 'obra', 'ai'))");
    expect(SQL_UNICO).toMatch(/CREATE OR REPLACE FUNCTION public\.debit_ai_credit[\s\S]*FOR UPDATE/);
    expect(SQL_UNICO).toContain('REVOKE ALL ON FUNCTION public.debit_ai_credit(uuid, text) FROM PUBLIC, anon, authenticated;');
    expect(SQL_UNICO).toContain('GRANT EXECUTE ON FUNCTION public.debit_ai_credit(uuid, text) TO service_role;');
    expect(SQL_UNICO).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.(debit_ai_credit|_usage_debit|grant_billing_purchase)[^;]*authenticated/);
    const defs = SQL_UNICO.match(/^LANGUAGE \w+( STABLE)? SECURITY DEFINER[^\n]*/gm) ?? [];
    expect(defs.length).toBe(4);
    for (const d of defs) expect(d).toContain('SET search_path = public');
  });
});

describe('texto e erro', () => {
  it('resumo do saldo', () => {
    expect(resumoDoSaldo(base, 'quote', AGORA)).toBe('5 grátis');
    expect(resumoDoSaldo({ ...base, freeQuotes: 2, quoteCredits: 1 }, 'quote', AGORA)).toBe('2 grátis + 1 pacote');
    expect(resumoDoSaldo({ ...base, freeQuotes: 0, quoteCredits: 40 }, 'quote', AGORA)).toBe('40 pacotes');
    expect(resumoDoSaldo({ ...base, freeObras: 0 }, 'obra', AGORA)).toBe('Sem obras disponíveis');
    expect(resumoDoSaldo({ ...base, freeObras: 0, quoteCredits: 3 }, 'obra', AGORA)).toBe('3 pacotes');
    expect(resumoDoSaldo({ ...base, proActive: true }, 'quote', AGORA)).toBe('Orçamentos ilimitados');
    expect(resumoDoSaldo({ ...base, proActive: true }, 'obra', AGORA)).toBe('Obras ilimitadas');
  });

  it('reconhece o erro de sem saldo de cada tipo', () => {
    expect(ehErroSemSaldo({ code: 'P0402', message: 'quote_balance_empty' }, 'quote')).toBe(true);
    expect(ehErroSemSaldo({ code: 'P0402', message: 'quote_balance_empty' }, 'obra')).toBe(false);
    expect(ehErroSemSaldo({ code: 'P0402', message: 'obra_balance_empty' }, 'obra')).toBe(true);
    expect(ehErroSemSaldo({ code: '42501', message: 'permission denied' }, 'quote')).toBe(false);
    expect(ehErroSemSaldo(null, 'quote')).toBe(false);
    expect(SQL).toContain(`'quote_balance_empty' USING ERRCODE = 'P0402'`);
    expect(SQL).toContain(`'obra_balance_empty' USING ERRCODE = 'P0402'`);
    expect(new BalanceEmptyError('obra')).toMatchObject({ kind: 'obra', status: 402, code: 'obra_balance_empty' });
  });

  it('lê a linha da RPC com defesa', () => {
    expect(
      saldoDaLinha({ free_quotes: 3, quote_credits: 40, free_obras: 0, obra_credits: 2, unlimited_until: null, pro_active: false, enforced: true }),
    ).toEqual({ freeQuotes: 3, quoteCredits: 40, freeObras: 0, obraCredits: 2, unlimitedUntil: null, proActive: false, enforced: true });
    expect(saldoDaLinha({ free_quotes: -2, quote_credits: 'x' })).toMatchObject({ freeQuotes: 0, quoteCredits: 0, enforced: false });
    expect(saldoDaLinha(null)).toBeNull();
  });
});

describe('guardas do SQL', () => {
  it('crédito e débito nunca ficam abertos pro usuário', () => {
    const internas = ['_billing_unlimited', '_usage_debit', 'debit_obra_on_insert', 'grant_billing_purchase', 'revoke_billing_purchase', 'set_pro_subscription'];
    for (const fn of internas) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
    }
    expect(SQL).not.toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.(${internas.join('|')})[^;]*authenticated`));
  });

  it('débito trava a linha; gravar orçamento e criar obra debitam', () => {
    expect(SQL).toContain('FOR UPDATE');
    expect(SQL).toMatch(/create_painter_draft[\s\S]*PERFORM public\._usage_debit\('quote', auth\.uid\(\), v_id\)/);
    expect(SQL).toContain("PERFORM public._usage_debit('obra', NEW.owner_id, NEW.id)");
    expect(SQL).toMatch(/CREATE TRIGGER trg_debit_obra_on_insert BEFORE INSERT ON public\.obras/);
  });

  it('transação da loja é única (antifraude)', () => {
    expect(SQL).toContain('store_transaction_id text NOT NULL UNIQUE');
    expect(SQL).toContain("'conflict'");
  });

  it('toda função SECURITY DEFINER fixa search_path', () => {
    const defs = SQL.match(/^LANGUAGE \w+( STABLE)? SECURITY DEFINER[^\n]*/gm) ?? [];
    expect(defs.length).toBeGreaterThanOrEqual(8);
    for (const d of defs) expect(d).toContain('SET search_path = public');
  });

  it('cobrança nasce desligada (rollout)', () => {
    expect(SQL).toContain('enforce boolean NOT NULL DEFAULT false');
  });
});

describe('situacaoDoPlano — selo do topo e tela de compra concordam (29/10)', () => {
  const b = { freeQuotes: 5, quoteCredits: 1, freeObras: 1, obraCredits: 0, unlimitedUntil: null, proActive: false, enforced: false };
  const agora = new Date('2026-10-29T12:00:00Z');
  it('grátis com pacote não é PRO', () => {
    expect(situacaoDoPlano({ id: 'u', is_pro: false }, b, agora)).toEqual({ plano: 'gratis', ate: null });
  });
  it('assinatura da loja ativa = PRO, com a data dela', () => {
    const r = situacaoDoPlano({ id: 'u' }, { ...b, unlimitedUntil: '2026-11-29T12:00:00Z', proActive: true }, agora);
    expect(r).toEqual({ plano: 'pro', ate: Date.parse('2026-11-29T12:00:00Z') });
  });
  it('assinatura vencida não é PRO', () => {
    expect(situacaoDoPlano({ id: 'u' }, { ...b, unlimitedUntil: '2026-10-01T00:00:00Z' }, agora).plano).toBe('gratis');
  });
  it('banco diz ilimitado sem PRO nem assinatura = conta da equipe', () => {
    expect(situacaoDoPlano({ id: 'u' }, { ...b, proActive: true }, agora).plano).toBe('admin');
  });
  it('admin pelo perfil', () => {
    expect(situacaoDoPlano({ id: 'u', role: 'admin' }, b, agora).plano).toBe('admin');
  });
});

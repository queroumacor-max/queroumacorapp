import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FREE_QUOTES,
  QUOTE_PRODUCTS,
  CREDITOS_POR_PRODUTO,
  creditosDoProduto,
  ehAssinatura,
  fonteDoProximo,
  podeGravarOrcamento,
  aplicarDebito,
  resumoDoSaldo,
  ehErroSemSaldo,
  saldoDaLinha,
  type QuoteBalance,
} from '@/lib/quoteBalance';

const AGORA = new Date('2026-10-25T12:00:00Z');
const base: QuoteBalance = {
  freeRemaining: 5,
  credits: 0,
  unlimitedUntil: null,
  proActive: false,
  enforced: true,
};

const SQL = readFileSync(join(__dirname, '../../migrations/2026-10-25-quote-balance.sql'), 'utf8');

describe('saldo de orçamentos — ordem do débito', () => {
  it('começa com 5 grátis', () => {
    expect(FREE_QUOTES).toBe(5);
    expect(fonteDoProximo(base, AGORA)).toBe('free');
  });

  it('grátis antes dos créditos', () => {
    const b = { ...base, freeRemaining: 1, credits: 40 };
    expect(fonteDoProximo(b, AGORA)).toBe('free');
    const depois = aplicarDebito(b, AGORA);
    expect(depois).toMatchObject({ freeRemaining: 0, credits: 40 });
    expect(fonteDoProximo(depois, AGORA)).toBe('credit');
    expect(aplicarDebito(depois, AGORA)).toMatchObject({ freeRemaining: 0, credits: 39 });
  });

  it('assinatura ativa não debita nada', () => {
    const b = { ...base, freeRemaining: 3, credits: 10, unlimitedUntil: '2026-11-25T12:00:00Z' };
    expect(fonteDoProximo(b, AGORA)).toBe('unlimited');
    expect(aplicarDebito(b, AGORA)).toEqual(b);
  });

  it('assinatura vencida volta a debitar', () => {
    const b = { ...base, freeRemaining: 0, credits: 2, unlimitedUntil: '2026-10-24T12:00:00Z' };
    expect(fonteDoProximo(b, AGORA)).toBe('credit');
  });

  it('PRO antigo vale como ilimitado (substitui o PRO)', () => {
    const b = { ...base, freeRemaining: 0, credits: 0, proActive: true };
    expect(fonteDoProximo(b, AGORA)).toBe('unlimited');
    expect(podeGravarOrcamento(b, AGORA)).toBe(true);
  });

  it('sem saldo barra só com a cobrança ligada', () => {
    const vazio = { ...base, freeRemaining: 0, credits: 0 };
    expect(fonteDoProximo(vazio, AGORA)).toBeNull();
    expect(podeGravarOrcamento(vazio, AGORA)).toBe(false);
    expect(podeGravarOrcamento({ ...vazio, enforced: false }, AGORA)).toBe(true);
  });

  it('débito nunca deixa negativo', () => {
    const vazio = { ...base, freeRemaining: 0, credits: 0 };
    expect(aplicarDebito(vazio, AGORA)).toEqual(vazio);
  });

  it('data inválida não vira ilimitado', () => {
    expect(fonteDoProximo({ ...base, freeRemaining: 0, unlimitedUntil: 'lixo' }, AGORA)).toBeNull();
  });
});

describe('produtos', () => {
  it('consumíveis dão 1 e 40; assinatura não dá crédito', () => {
    expect(creditosDoProduto('quote_1')).toBe(1);
    expect(creditosDoProduto('quote_pack_40')).toBe(40);
    expect(creditosDoProduto('quotes_unlimited')).toBe(0);
    expect(creditosDoProduto('qualquer')).toBe(0);
    expect(ehAssinatura('quotes_unlimited')).toBe(true);
    expect(ehAssinatura('quote_1')).toBe(false);
  });

  it('o SQL credita o MESMO número que o app mostra', () => {
    for (const [id, n] of Object.entries(CREDITOS_POR_PRODUTO)) {
      expect(SQL).toContain(`WHEN '${id}' THEN ${n}`);
    }
    expect(SQL).toContain(`'${QUOTE_PRODUCTS.unlimited}'`);
  });
});

describe('texto e erro', () => {
  it('resumo do saldo', () => {
    expect(resumoDoSaldo(base, AGORA)).toBe('5 grátis');
    expect(resumoDoSaldo({ ...base, freeRemaining: 2, credits: 1 }, AGORA)).toBe('2 grátis + 1 comprado');
    expect(resumoDoSaldo({ ...base, freeRemaining: 0, credits: 40 }, AGORA)).toBe('40 comprados');
    expect(resumoDoSaldo({ ...base, freeRemaining: 0 }, AGORA)).toBe('Sem orçamentos disponíveis');
    expect(resumoDoSaldo({ ...base, proActive: true }, AGORA)).toBe('Orçamentos ilimitados');
  });

  it('reconhece o erro de sem saldo da RPC', () => {
    expect(ehErroSemSaldo({ code: 'P0402', message: 'x' })).toBe(true);
    expect(ehErroSemSaldo({ code: 'P0001', message: 'quote_balance_empty' })).toBe(true);
    expect(ehErroSemSaldo({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(ehErroSemSaldo(null)).toBe(false);
    expect(SQL).toContain(`'quote_balance_empty' USING ERRCODE = 'P0402'`);
  });

  it('lê a linha da RPC com defesa', () => {
    expect(saldoDaLinha({ free_remaining: 3, credits: 40, unlimited_until: null, pro_active: false, enforced: true }))
      .toEqual({ freeRemaining: 3, credits: 40, unlimitedUntil: null, proActive: false, enforced: true });
    expect(saldoDaLinha({ free_remaining: -2, credits: 'x' })).toMatchObject({ freeRemaining: 0, credits: 0, enforced: false });
    expect(saldoDaLinha(null)).toBeNull();
  });
});

describe('guardas do SQL', () => {
  it('crédito e débito nunca ficam abertos pro usuário', () => {
    for (const fn of ['_quote_debit', 'grant_quote_purchase', 'revoke_quote_purchase', 'set_quote_subscription']) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
    }
    expect(SQL).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.(grant_quote_purchase|revoke_quote_purchase|set_quote_subscription|_quote_debit)[^;]*authenticated/);
  });

  it('débito trava a linha e a gravação debita', () => {
    expect(SQL).toContain('FOR UPDATE');
    expect(SQL).toMatch(/create_painter_draft[\s\S]*PERFORM public\._quote_debit\(auth\.uid\(\), v_id\)/);
  });

  it('transação da loja é única (antifraude)', () => {
    expect(SQL).toContain('store_transaction_id text NOT NULL UNIQUE');
    expect(SQL).toContain("'conflict'");
  });

  it('toda função SECURITY DEFINER fixa search_path', () => {
    const defs = SQL.match(/^LANGUAGE plpgsql SECURITY DEFINER[^\n]*/gm) ?? [];
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(d).toContain('SET search_path = public');
  });

  it('cobrança nasce desligada (rollout)', () => {
    expect(SQL).toContain('enforce_quotes boolean NOT NULL DEFAULT false');
  });
});

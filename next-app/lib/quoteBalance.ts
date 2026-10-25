// Saldo de orçamentos (freemium + compras in-app). Regra pura, sem rede.
//
// A FONTE DE VERDADE é o banco (`quote_balance` + `_quote_debit` na
// migration 2026-10-25-quote-balance.sql). Este arquivo espelha a mesma
// regra pra tela (paywall, contador) — quem debita é SEMPRE o servidor,
// dentro da RPC que grava o orçamento. Mudou a regra aqui, mudar lá; o
// teste `quoteBalance.test.ts` lê o SQL e falha se os dois divergirem.
//
import { AppError } from '@/lib/errors';

// Regras (decisão do usuário, 2026-10-25):
//   - todo mundo começa com 5 orçamentos grátis (inclusive quem já usa);
//   - conta quando o orçamento é GRAVADO (editar o mesmo não conta de novo);
//   - ordem do débito: assinatura ativa (não debita) → grátis → créditos;
//   - a assinatura ilimitada substitui o PRO: PRO ativo também é ilimitado;
//   - preço vem da loja (Play/App Store) em runtime, nunca daqui.

export const FREE_QUOTES = 5;

/** IDs dos produtos — iguais no Play Console e no App Store Connect. */
export const QUOTE_PRODUCTS = {
  single: 'quote_1',
  pack40: 'quote_pack_40',
  unlimited: 'quotes_unlimited',
} as const;

export type QuoteProductId = (typeof QUOTE_PRODUCTS)[keyof typeof QUOTE_PRODUCTS];

/** Créditos que cada consumível dá. Assinatura não dá crédito. */
export const CREDITOS_POR_PRODUTO: Record<string, number> = {
  [QUOTE_PRODUCTS.single]: 1,
  [QUOTE_PRODUCTS.pack40]: 40,
};

export function creditosDoProduto(productId: string): number {
  return CREDITOS_POR_PRODUTO[productId] ?? 0;
}

export function ehAssinatura(productId: string): boolean {
  return productId === QUOTE_PRODUCTS.unlimited;
}

export interface QuoteBalance {
  freeRemaining: number;
  credits: number;
  /** Fim da assinatura (ISO) — null sem assinatura. */
  unlimitedUntil: string | null;
  /** PRO antigo (manual/pontos) ou admin: ilimitado enquanto valer. */
  proActive: boolean;
  /** Cobrança ligada? Desligada, ninguém é barrado (rollout). */
  enforced: boolean;
}

export type FonteDoDebito = 'unlimited' | 'free' | 'credit';

export function ilimitadoAtivo(b: QuoteBalance, agora: Date = new Date()): boolean {
  if (b.proActive) return true;
  if (!b.unlimitedUntil) return false;
  const fim = Date.parse(b.unlimitedUntil);
  return Number.isFinite(fim) && fim > agora.getTime();
}

/**
 * De onde sai o próximo orçamento. `null` = sem saldo (abre o paywall).
 * Com a cobrança desligada, nunca é null — mas segue dizendo a fonte, pro
 * contador da tela já mostrar o que vai acontecer quando ligar.
 */
export function fonteDoProximo(b: QuoteBalance, agora: Date = new Date()): FonteDoDebito | null {
  if (ilimitadoAtivo(b, agora)) return 'unlimited';
  if (b.freeRemaining > 0) return 'free';
  if (b.credits > 0) return 'credit';
  return null;
}

export function podeGravarOrcamento(b: QuoteBalance, agora: Date = new Date()): boolean {
  return !b.enforced || fonteDoProximo(b, agora) !== null;
}

/** Saldo depois de gravar um orçamento (espelho do UPDATE da RPC). */
export function aplicarDebito(b: QuoteBalance, agora: Date = new Date()): QuoteBalance {
  const fonte = fonteDoProximo(b, agora);
  if (fonte === 'free') return { ...b, freeRemaining: b.freeRemaining - 1 };
  if (fonte === 'credit') return { ...b, credits: b.credits - 1 };
  return b;
}

/** Frase do contador ("3 grátis + 40 comprados"). */
export function resumoDoSaldo(b: QuoteBalance, agora: Date = new Date()): string {
  if (ilimitadoAtivo(b, agora)) return 'Orçamentos ilimitados';
  const partes: string[] = [];
  if (b.freeRemaining > 0) partes.push(`${b.freeRemaining} grátis`);
  if (b.credits > 0) partes.push(`${b.credits} comprado${b.credits === 1 ? '' : 's'}`);
  if (partes.length === 0) return 'Sem orçamentos disponíveis';
  return partes.join(' + ');
}

/** Erro que a RPC levanta sem saldo (SQLSTATE P0402). */
export const SEM_SALDO_CODE = 'P0402';
export const SEM_SALDO_MSG = 'quote_balance_empty';

export function ehErroSemSaldo(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  return err.code === SEM_SALDO_CODE || (err.message ?? '').includes(SEM_SALDO_MSG);
}

/** Gravar sem saldo: a tela abre o paywall em vez de mostrar erro. */
export class QuoteBalanceEmptyError extends AppError {
  constructor() {
    super('Seus orçamentos acabaram. Compre um pacote ou assine o ilimitado pra continuar.', {
      code: 'quote_balance_empty',
      status: 402,
    });
    this.name = 'QuoteBalanceEmptyError';
  }
}

/** Linha crua da RPC `my_quote_balance` → modelo da tela. */
export function saldoDaLinha(row: unknown): QuoteBalance | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return {
    freeRemaining: num(r.free_remaining),
    credits: num(r.credits),
    unlimitedUntil: typeof r.unlimited_until === 'string' ? r.unlimited_until : null,
    proActive: r.pro_active === true,
    enforced: r.enforced === true,
  };
}

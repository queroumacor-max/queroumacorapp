// Saldo de uso (freemium + compras in-app). Regra pura, sem rede.
//
// A FONTE DE VERDADE é o banco (`billing_balance` + `_usage_debit` na
// migration 2026-10-25-billing-balance.sql). Este arquivo espelha a mesma
// regra pra tela (paywall, contador) — quem debita é SEMPRE o servidor,
// na mesma transação que grava o orçamento / cria a obra. Mudou a regra
// aqui, mudar lá; o teste `billingBalance.test.ts` lê o SQL e falha se
// os dois divergirem.
//
// Regras (decisão do usuário, 2026-10-25; crédito único em 2026-10-28):
//   - orçamentos: 5 grátis pra todo mundo; conta ao GRAVAR;
//   - Gestão de Obras: 1 obra grátis; conta ao CRIAR (editar não conta);
//   - CRÉDITO ÚNICO: o que se compra é crédito, e 1 crédito vale 1
//     orçamento, OU 1 obra, OU 1 uso de IA (depois do teste grátis).
//     Avulso = 1 crédito, Iniciante = 40. O saldo mora em
//     `billing_balance.quote_credits` (nome antigo mantido);
//   - ordem: ilimitado (não debita) → grátis do tipo → créditos;
//   - a assinatura `quotes_unlimited` é o "PRO ilimitado": tudo sem
//     limite. PRO antigo (manual) e admin também;
//   - preço vem da loja (Play/App Store) em runtime, nunca daqui.

import { AppError } from '@/lib/errors';

export const FREE_QUOTES = 5;
export const FREE_OBRAS = 1;

/**
 * IDs dos produtos — iguais no Play Console e no App Store Connect. Os IDs
 * antigos foram mantidos (produto de loja não muda de ID): `quote_1` é o
 * Avulso (1 crédito) e `quote_pack_40` o Iniciante (40 créditos). `obra_1`
 * saiu da tela; compra antiga dele vale 1 crédito.
 */
export const BILLING_PRODUCTS = {
  quote1: 'quote_1',
  quotePack40: 'quote_pack_40',
  obra1: 'obra_1',
  pro: 'quotes_unlimited',
} as const;

export type UsageKind = 'quote' | 'obra';

/** O que cada consumível dá (crédito único). A assinatura não dá crédito. */
export const CREDITOS_POR_PRODUTO: Record<string, { kind: UsageKind; n: number }> = {
  [BILLING_PRODUCTS.quote1]: { kind: 'quote', n: 1 },
  [BILLING_PRODUCTS.quotePack40]: { kind: 'quote', n: 40 },
  [BILLING_PRODUCTS.obra1]: { kind: 'quote', n: 1 },
};

export function creditosDoProduto(productId: string): { kind: UsageKind; n: number } | null {
  return CREDITOS_POR_PRODUTO[productId] ?? null;
}

export function ehAssinatura(productId: string): boolean {
  return productId === BILLING_PRODUCTS.pro;
}

export interface BillingBalance {
  freeQuotes: number;
  quoteCredits: number;
  freeObras: number;
  obraCredits: number;
  /** Fim da assinatura (ISO) — null sem assinatura. */
  unlimitedUntil: string | null;
  /** PRO antigo (manual/pontos), assinatura ou admin, segundo o servidor. */
  proActive: boolean;
  /** Cobrança ligada? Desligada, ninguém é barrado (rollout). */
  enforced: boolean;
}

export type FonteDoDebito = 'unlimited' | 'free' | 'credit';

export function ilimitadoAtivo(b: BillingBalance, agora: Date = new Date()): boolean {
  if (b.proActive) return true;
  if (!b.unlimitedUntil) return false;
  const fim = Date.parse(b.unlimitedUntil);
  return Number.isFinite(fim) && fim > agora.getTime();
}

/** Créditos comprados (saldo único — vale orçamento, obra e IA). */
export function creditos(b: BillingBalance): number {
  return b.quoteCredits + b.obraCredits;
}

function saldoDo(b: BillingBalance, kind: UsageKind): { free: number; cred: number } {
  return { free: kind === 'quote' ? b.freeQuotes : b.freeObras, cred: creditos(b) };
}

/**
 * De onde sai o próximo orçamento/obra. `null` = sem saldo (abre o
 * paywall). Com a cobrança desligada continua dizendo a fonte, pro
 * contador já mostrar o que vai acontecer quando ligar.
 */
export function fonteDoProximo(b: BillingBalance, kind: UsageKind, agora: Date = new Date()): FonteDoDebito | null {
  if (ilimitadoAtivo(b, agora)) return 'unlimited';
  const s = saldoDo(b, kind);
  if (s.free > 0) return 'free';
  if (s.cred > 0) return 'credit';
  return null;
}

export function podeUsar(b: BillingBalance, kind: UsageKind, agora: Date = new Date()): boolean {
  return !b.enforced || fonteDoProximo(b, kind, agora) !== null;
}

/** Saldo depois de usar um (espelho do UPDATE de `_usage_debit`). */
export function aplicarDebito(b: BillingBalance, kind: UsageKind, agora: Date = new Date()): BillingBalance {
  const fonte = fonteDoProximo(b, kind, agora);
  if (fonte === 'free') {
    return kind === 'quote' ? { ...b, freeQuotes: b.freeQuotes - 1 } : { ...b, freeObras: b.freeObras - 1 };
  }
  if (fonte === 'credit') {
    return b.quoteCredits > 0 ? { ...b, quoteCredits: b.quoteCredits - 1 } : { ...b, obraCredits: b.obraCredits - 1 };
  }
  return b;
}

/** Frase do contador ("3 grátis + 40 pacotes"). */
export function resumoDoSaldo(b: BillingBalance, kind: UsageKind, agora: Date = new Date()): string {
  const nome = kind === 'quote' ? 'orçamentos' : 'obras';
  if (ilimitadoAtivo(b, agora)) return `${nome[0].toUpperCase()}${nome.slice(1)} ilimitad${kind === 'quote' ? 'os' : 'as'}`;
  const s = saldoDo(b, kind);
  const partes: string[] = [];
  if (s.free > 0) partes.push(`${s.free} grátis`);
  if (s.cred > 0) partes.push(textoCreditos(s.cred));
  if (partes.length === 0) return `Sem ${nome} disponíveis`;
  return partes.join(' + ');
}

/** "1 pacote" / "40 pacotes" — na tela o crédito se chama PACOTE (decisão de 29/10). */
export function textoCreditos(n: number): string {
  return `${n} pacote${n === 1 ? '' : 's'}`;
}

/** Erros que o banco levanta sem saldo (SQLSTATE P0402). */
export const SEM_SALDO_CODE = 'P0402';
const SEM_SALDO_MSG: Record<UsageKind, string> = {
  quote: 'quote_balance_empty',
  obra: 'obra_balance_empty',
};

export function ehErroSemSaldo(
  err: { code?: string | null; message?: string | null } | null | undefined,
  kind: UsageKind,
): boolean {
  if (!err) return false;
  return (err.message ?? '').includes(SEM_SALDO_MSG[kind]);
}

/** Sem saldo: a tela abre o paywall em vez de mostrar erro. */
export class BalanceEmptyError extends AppError {
  kind: UsageKind;
  constructor(kind: UsageKind) {
    super(
      kind === 'quote'
        ? 'Seus orçamentos grátis e seus créditos acabaram. Compre créditos ou assine o PRO pra continuar.'
        : 'Sua obra grátis já foi usada e seus créditos acabaram. Compre créditos ou assine o PRO pra continuar.',
      { code: SEM_SALDO_MSG[kind], status: 402 },
    );
    this.name = 'BalanceEmptyError';
    this.kind = kind;
  }
}

/** Linha crua da RPC `my_billing_balance` → modelo da tela. */
export function saldoDaLinha(row: unknown): BillingBalance | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return {
    freeQuotes: num(r.free_quotes),
    quoteCredits: num(r.quote_credits),
    freeObras: num(r.free_obras),
    obraCredits: num(r.obra_credits),
    unlimitedUntil: typeof r.unlimited_until === 'string' ? r.unlimited_until : null,
    proActive: r.pro_active === true,
    enforced: r.enforced === true,
  };
}

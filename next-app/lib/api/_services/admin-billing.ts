// admin-billing — tela "Compras no app" do portal (2026-10-25).
//
// Quem agrega é o SERVIDOR (service role), igual ao "Uso do app": a
// `billing_balance` e a `usage_debits` têm RLS "cada um vê o seu", então a
// consulta direta do portal mostraria só o saldo do próprio admin.
//
// Valor: a loja (Apple/Google) é quem cobra. Quando a RevenueCat informa o
// preço, ele vai no `raw.price` do evento e a tela mostra o valor COBRADO.
// Sem isso (compra antiga, ou a RC não mandou), a tela mostra o preço de
// TABELA, marcado como estimativa — nunca como se fosse o cobrado.

import { buscarTabela, type Linha } from './admin-stats';
import { BILLING_PRODUCTS } from '../../billingBalance';

// Crédito único (2026-10-28): quote_1 = Avulso (1 crédito), quote_pack_40 =
// Iniciante (40 créditos). obra_1 saiu da tela; compra antiga dele vale 1.
export const ROTULO_PRODUTO: Record<string, string> = {
  [BILLING_PRODUCTS.quote1]: 'Avulso (1 crédito)',
  [BILLING_PRODUCTS.quotePack40]: 'Iniciante (40 créditos)',
  [BILLING_PRODUCTS.obra1]: '1 obra extra (antigo)',
  [BILLING_PRODUCTS.pro]: 'PRO ilimitado (mensal)',
};

/**
 * Preço de tabela (R$). Só estimativa: quem cobra é a loja. Avulso R$2,50 e
 * PRO R$60 decididos em 28/10; o Iniciante segue no valor de 25/10 até o
 * usuário definir o novo.
 */
export const PRECO_TABELA_BRL: Record<string, number> = {
  [BILLING_PRODUCTS.quote1]: 2.5,
  [BILLING_PRODUCTS.quotePack40]: 29.9,
  [BILLING_PRODUCTS.obra1]: 2.9,
  [BILLING_PRODUCTS.pro]: 60,
};

export interface PessoaResumo {
  id: string;
  nome: string;
  tag: string | null;
  telefone: string | null;
  email: string | null;
  papel: string | null;
}

export interface CompraLinha {
  id: number;
  quando: string;
  pessoa: PessoaResumo | null;
  produto: string;
  produtoRotulo: string;
  plataforma: string | null;
  tipo: 'compra' | 'assinatura';
  status: string;
  creditos: number;
  creditoTipo: string | null;
  sandbox: boolean;
  transacao: string;
  valor: { amount: number; currency: string; estimado: boolean } | null;
}

export interface AssinanteLinha {
  pessoa: PessoaResumo | null;
  ate: string | null;
  status: string | null;
  ativo: boolean;
}

export interface SaldoLinha {
  pessoa: PessoaResumo | null;
  orcamentosGratis: number;
  orcamentosCreditos: number;
  obrasGratis: number;
  obrasCreditos: number;
}

export interface RelatorioCompras {
  geradoEm: string;
  config: { enforce: boolean | null; freeQuotes: number | null; freeObras: number | null };
  totais: {
    compras: number;
    comprasTeste: number;
    reembolsos: number;
    assinantesAtivos: number;
    receitaPorMoeda: Record<string, number>;
    receitaEstimadaBrl: number;
    porProduto: Record<string, number>;
  };
  uso: { orcamentos: Record<string, number>; obras: Record<string, number>; ia: Record<string, number> };
  compras: CompraLinha[];
  assinantes: AssinanteLinha[];
  saldos: SaldoLinha[];
  avisos: string[];
}

export interface DadosCompras {
  eventos: Linha[];
  saldos: Linha[];
  debitos: Linha[];
  config: Linha | null;
  perfis: Linha[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const raw = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function pessoaDe(p: Linha | undefined, id: unknown): PessoaResumo | null {
  if (!p) return id ? { id: String(id), nome: '(conta apagada ou sem perfil)', tag: null, telefone: null, email: null, papel: null } : null;
  return {
    id: String(p.id),
    nome: str(p.business_name) || str(p.name) || 'Sem nome',
    tag: str(p.tag) || str(p.username),
    telefone: str(p.phone),
    email: str(p.email),
    papel: str(p.role) || str(p.user_type),
  };
}

function precoDoRaw(r: Record<string, unknown>): { amount: number; currency: string } | null {
  const p = raw(r.price);
  const amount = Number(p.amount);
  const currency = typeof p.currency === 'string' ? p.currency.toUpperCase() : '';
  return Number.isFinite(amount) && /^[A-Z]{3}$/.test(currency) ? { amount, currency } : null;
}

/** Pura e testada. */
export function montarRelatorioDeCompras(d: DadosCompras, agora: number = Date.now()): RelatorioCompras {
  const perfis = new Map(d.perfis.map((p) => [String(p.id), p]));
  const avisos: string[] = [];

  const compras: CompraLinha[] = d.eventos.map((e) => {
    const r = raw(e.raw);
    const produto = String(e.product_id || '');
    const assinatura = produto === BILLING_PRODUCTS.pro;
    const cobrado = precoDoRaw(r);
    const tabela = PRECO_TABELA_BRL[produto];
    return {
      id: num(e.id),
      quando: String(r.purchased_at || e.created_at || ''),
      pessoa: pessoaDe(perfis.get(String(e.user_id)), e.user_id),
      produto,
      produtoRotulo: ROTULO_PRODUTO[produto] || produto,
      plataforma: str(e.platform),
      tipo: assinatura ? 'assinatura' : 'compra',
      // Compra avulsa: applied | refunded. Assinatura: o `kind` é o estado
      // que a RC mandou (active, cancelled, expired, refunded...).
      status: assinatura ? String(e.kind || e.status || '') : String(e.status || ''),
      creditos: num(e.credits_granted),
      creditoTipo: str(e.credit_kind),
      sandbox: r.sandbox === true,
      transacao: String(e.store_transaction_id || ''),
      valor: cobrado
        ? { ...cobrado, estimado: false }
        : tabela !== undefined
          ? { amount: tabela, currency: 'BRL', estimado: true }
          : null,
    };
  });
  compras.sort((a, b) => (Date.parse(b.quando) || 0) - (Date.parse(a.quando) || 0) || b.id - a.id);

  const receitaPorMoeda: Record<string, number> = {};
  const porProduto: Record<string, number> = {};
  let receitaEstimadaBrl = 0;
  let nCompras = 0;
  let nTeste = 0;
  let nReembolsos = 0;
  for (const c of compras) {
    const pago = c.tipo === 'compra' ? c.status === 'applied' : c.status === 'active';
    if (c.status === 'refunded') nReembolsos++;
    if (!pago) continue;
    if (c.sandbox) {
      nTeste++;
      continue;
    }
    nCompras++;
    porProduto[c.produto] = (porProduto[c.produto] || 0) + 1;
    if (c.valor && !c.valor.estimado) receitaPorMoeda[c.valor.currency] = (receitaPorMoeda[c.valor.currency] || 0) + c.valor.amount;
    receitaEstimadaBrl += PRECO_TABELA_BRL[c.produto] || 0;
  }

  const assinantes: AssinanteLinha[] = [];
  const saldos: SaldoLinha[] = [];
  for (const b of d.saldos) {
    const pessoa = pessoaDe(perfis.get(String(b.user_id)), b.user_id);
    const ate = str(b.unlimited_until);
    if (ate || str(b.unlimited_status)) {
      const t = ate ? Date.parse(ate) : NaN;
      assinantes.push({ pessoa, ate, status: str(b.unlimited_status), ativo: Number.isFinite(t) && t > agora });
    }
    const linha: SaldoLinha = {
      pessoa,
      orcamentosGratis: num(b.free_quotes),
      orcamentosCreditos: num(b.quote_credits),
      obrasGratis: num(b.free_obras),
      obrasCreditos: num(b.obra_credits),
    };
    if (linha.orcamentosCreditos > 0 || linha.obrasCreditos > 0) saldos.push(linha);
  }
  assinantes.sort((a, b) => Number(b.ativo) - Number(a.ativo) || (Date.parse(b.ate || '') || 0) - (Date.parse(a.ate || '') || 0));
  saldos.sort((a, b) => b.orcamentosCreditos + b.obrasCreditos - (a.orcamentosCreditos + a.obrasCreditos));

  const uso = { orcamentos: {} as Record<string, number>, obras: {} as Record<string, number>, ia: {} as Record<string, number> };
  for (const u of d.debitos) {
    const alvo = u.kind === 'obra' ? uso.obras : u.kind === 'ai' ? uso.ia : uso.orcamentos;
    const fonte = String(u.fonte || '?');
    alvo[fonte] = (alvo[fonte] || 0) + 1;
  }

  const cfg = d.config;
  if (cfg && cfg.enforce === false) avisos.push('Cobrança DESLIGADA (billing_config.enforce = false): ninguém é barrado por saldo ainda.');

  return {
    geradoEm: new Date(agora).toISOString(),
    config: {
      enforce: cfg && typeof cfg.enforce === 'boolean' ? cfg.enforce : null,
      freeQuotes: cfg ? num(cfg.free_quotes) : null,
      freeObras: cfg ? num(cfg.free_obras) : null,
    },
    totais: {
      compras: nCompras,
      comprasTeste: nTeste,
      reembolsos: nReembolsos,
      assinantesAtivos: assinantes.filter((a) => a.ativo).length,
      receitaPorMoeda,
      receitaEstimadaBrl: Math.round(receitaEstimadaBrl * 100) / 100,
      porProduto,
    },
    uso,
    compras,
    assinantes,
    saldos,
    avisos,
  };
}

/** Busca tudo com service role e monta o relatório. */
export async function gerarRelatorioDeCompras(args: {
  supaUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}): Promise<RelatorioCompras> {
  const base = { supaUrl: args.supaUrl, serviceKey: args.serviceKey, fetchImpl: args.fetchImpl };
  const falhas: string[] = [];
  const ler = async (tabela: string, select: string, order: string): Promise<Linha[]> => {
    try {
      return (await buscarTabela({ ...base, tabela, select, order })).rows;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('admin-billing:', tabela, msg);
      falhas.push(`${tabela} (${msg.slice(0, 80)})`);
      return [];
    }
  };
  const [eventos, saldos, debitos, configs] = await Promise.all([
    ler('billing_events', 'id,store_transaction_id,user_id,product_id,platform,kind,credit_kind,credits_granted,status,raw,created_at', 'id'),
    ler('billing_balance', 'user_id,free_quotes,quote_credits,free_obras,obra_credits,unlimited_until,unlimited_status', 'user_id'),
    ler('usage_debits', 'id,kind,fonte', 'id'),
    ler('billing_config', 'id,enforce,free_quotes,free_obras', 'id'),
  ]);

  // Perfis só de quem aparece (compra ou saldo), em lotes pra URL não estourar.
  const ids = [...new Set([...eventos, ...saldos].map((r) => String(r.user_id || '')).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const perfis: Linha[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    try {
      const r = await buscarTabela({
        ...base,
        tabela: 'profiles',
        select: 'id,name,business_name,tag,username,phone,email,role,user_type',
        filtros: [`id=in.(${lote.join(',')})`],
      });
      perfis.push(...r.rows);
    } catch (e) {
      falhas.push(`profiles (${(e instanceof Error ? e.message : String(e)).slice(0, 80)})`);
    }
  }

  const rel = montarRelatorioDeCompras({ eventos, saldos, debitos, config: configs[0] || null, perfis });
  if (falhas.length) rel.avisos.push(`Não consegui ler: ${falhas.join('; ')}. Os números dessas tabelas estão zerados.`);
  return rel;
}

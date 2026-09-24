// Reabrir um orçamento gravado no assistente — pra EDITAR, DUPLICAR ou
// começar do MODELO (sugestões do pintor Léo, 2026-09-24: "colocar um
// orçamento mestre como modelo, copiar e só editar os próximos, e poder
// editar pra corrigir algumas informações").
//
// Não precisa de SQL: o assistente já grava o formulário INTEIRO em
// `quotes.quote_data` (`...form` em `montarQuoteData`). Aqui é o caminho de
// volta — do jsonb pro formulário —, lendo campo a campo com checagem de
// tipo, porque o jsonb pode vir de versões antigas (ou do vanilla) sem
// algum campo, e um valor de tipo errado quebraria o formulário.
//
// O "modelo" é uma marca em `quote_data.modelo = true` (um por pintor).

import {
  ENDERECO_VAZIO,
  type EnderecoDoCliente,
} from '@/lib/orcamentoDocumento';
import {
  servicosDoQuoteData,
  type ServicoDoOrcamento,
} from '@/lib/orcamentoServicos';

/** O formulário do assistente de orçamento (`QuoteWizard`). */
export interface FormularioDoOrcamento {
  // Número do orçamento ("12/2026") — calculado na abertura a partir dos
  // orçamentos já gravados; gravado em quote_data.numero.
  numero: string;
  // Cliente
  clientName: string;
  clientPhone: string;
  cliente: EnderecoDoCliente;
  visitaTecnica: string; // valor do <input type="datetime-local">
  // Profissional — o que o perfil NÃO tem (CNPJ/CPF) e o que pode divergir
  // do perfil neste orçamento. Prefill do último orçamento gravado.
  profCnpj: string;
  profCpf: string;
  profEndereco: string;
  profEmail: string;
  // Serviços — cada um com espaço, material e itens da Tabela ABRAPP.
  // Gravados em quote_data.servicos. Começa vazio; o Gravar exige ≥ 1.
  servicos: ServicoDoOrcamento[];
  // Logística
  durationDays: string;
  includeMaterial: boolean;
  includeLabor: boolean;
  warranty: string; // ex.: 90 dias retoques
  // Preço
  price: string;
  desconto: string; // "10%" ou "500,00"
  // Pagamento
  pagamento: string[];
  chavePix: string;
  // Textos
  laudoTecnico: string;
  description: string; // "Informações adicionais" no PDF
  scope: string;
}

export type ModoDeReabrir = 'editar' | 'duplicar';

const CAMPOS_TEXTO = [
  'numero', 'clientName', 'clientPhone', 'visitaTecnica',
  'profCnpj', 'profCpf', 'profEndereco', 'profEmail',
  'durationDays', 'warranty', 'price', 'desconto', 'chavePix',
  'laudoTecnico', 'description', 'scope',
] as const;

/** O que é DESTE cliente/desta visita — não vai pra cópia nem pro modelo. */
const SO_DO_ORIGINAL = new Set<string>(['numero', 'clientName', 'clientPhone', 'visitaTecnica']);

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Monta o formulário a partir de `quote_data`. Só devolve os campos que o
 * jsonb tem de fato (com o tipo certo) — quem chama faz
 * `{ ...formAtual, ...resultado }`, então o que falta fica como estava.
 *
 * - `editar`: tudo, inclusive cliente e número.
 * - `duplicar` (e começar do modelo): tudo MENOS cliente, endereço do
 *   cliente, visita técnica e número — o próximo orçamento é de outra pessoa.
 */
export function formularioDeQuoteData(
  quoteData: unknown,
  modo: ModoDeReabrir,
): Partial<FormularioDoOrcamento> {
  const qd = objeto(quoteData);
  if (!qd) return {};
  const out: Partial<FormularioDoOrcamento> = {};
  const copia = modo === 'duplicar';

  for (const campo of CAMPOS_TEXTO) {
    if (copia && SO_DO_ORIGINAL.has(campo)) continue;
    const v = qd[campo];
    if (typeof v === 'string') out[campo] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[campo] = String(v);
  }
  if (typeof qd.includeMaterial === 'boolean') out.includeMaterial = qd.includeMaterial;
  if (typeof qd.includeLabor === 'boolean') out.includeLabor = qd.includeLabor;
  if (Array.isArray(qd.pagamento)) {
    out.pagamento = qd.pagamento.filter((x): x is string => typeof x === 'string');
  }

  const servicos = servicosDoQuoteData(qd);
  if (servicos.length) out.servicos = servicos;

  if (!copia) {
    const c = objeto(qd.cliente);
    if (c) {
      const cliente: EnderecoDoCliente = { ...ENDERECO_VAZIO };
      for (const k of Object.keys(ENDERECO_VAZIO) as (keyof EnderecoDoCliente)[]) {
        if (typeof c[k] === 'string') cliente[k] = c[k] as string;
      }
      out.cliente = cliente;
    }
  }
  return out;
}

/** `quote_data` marcado como modelo? */
export function ehModelo(quoteData: unknown): boolean {
  return objeto(quoteData)?.modelo === true;
}

/** O modelo do pintor numa lista de orçamentos (o mais recente, se houver mais de um). */
export function acharModelo<T extends { quote_data?: unknown }>(quotes: readonly T[]): T | null {
  return quotes.find((q) => ehModelo(q.quote_data)) ?? null;
}

/** Lê `?base=<id>&modo=editar|duplicar` da URL do assistente. */
export function lerReabertura(base: unknown, modo: unknown): { baseId: string; modo: ModoDeReabrir } | null {
  if (typeof base !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(base)) return null;
  return { baseId: base, modo: modo === 'editar' ? 'editar' : 'duplicar' };
}

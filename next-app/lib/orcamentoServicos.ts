// orcamentoServicos — os serviços de um orçamento (tile "Orçamento · Crie e
// envie"), cada um com o seu espaço, material e itens da Tabela ABRAPP.
//
// Um orçamento tem VÁRIOS serviços (pintura interna da sala + fachada, por
// exemplo), e cada serviço carrega o próprio espaço (tipo, área, pé direito,
// cômodos, superfície, acesso), o próprio material (tinta, cor, demãos,
// preparação) e a própria lista de ITENS — linhas escolhidas na Tabela de
// Preços da ABRAPP ou avulsas, com quantidade e valor por unidade.
//
// Decisões que valem registro:
//
//  1. O VALOR DO ITEM NASCE VAZIO, a sugestão fica do lado. A tabela é
//     sugestão de mão de obra; quem assina o orçamento é o pintor. Preencher
//     o campo sozinho faria a pessoa mandar preço de tabela sem ter decidido
//     nada — e "Usar média" é um toque.
//
//  2. Quantidade e valor são TEXTO no estado (o que a pessoa digitou). A
//     conversão pra número acontece só nas contas, aqui, num lugar só —
//     `parseBRL` aceita "1.500,50" e "1500.50" (regra P1 de 2026-09-01).
//
//  3. Tudo aqui é puro e independente de React: o QuoteWizard usa pra montar
//     a tela, e o PDF/pipeline usam pra LER o que foi gravado em
//     `quotes.quote_data.servicos`. Uma conta só pros dois lados, senão o
//     total da tela e o do PDF divergem.

import { parseBRL, fmtBRL } from '@/lib/utils';
import {
  rotuloAltura,
  unidadeCurta,
  type PriceAltura,
  type PriceItem,
} from '@/lib/services/priceTable';

// ─── Opções dos campos (fonte única — tela e defaults) ────────────────────

export const TIPOS_DE_SERVICO = [
  'Pintura interna',
  'Pintura externa / fachada',
  'Textura (grafiato/marmorato)',
  'Piso epóxi',
  'Microcimento',
  'Esmalte (portas/grades)',
  'Pintura automotiva',
  'Grafite / mural',
] as const;

export const ESTADOS_DA_SUPERFICIE = [
  'Nova (alvenaria recém-feita)',
  'Boa (só limpeza)',
  'Pintura antiga em bom estado',
  'Descascando / mofo / infiltração',
  'Concreto ou tijolo aparente',
] as const;

export const OPCOES_DE_ACESSO = [
  'Térreo / sem altura',
  'Escada (até 3m)',
  'Andaime (3-6m)',
  'Andaime alto / cadeira suspensa (acima 6m)',
] as const;

export const TIPOS_DE_TINTA = [
  'Acrílica (interna/externa)',
  'PVA (interna)',
  'Esmalte sintético (madeira/metal)',
  'Esmalte aquoso',
  'Epóxi (piso/banheiro)',
  'Elastomérica (fachada)',
  'Textura/grafiato',
  'Outra',
] as const;

export const OPCOES_DE_PREPARACAO = [
  'Massa corrida',
  'Lixamento',
  'Selador',
  'Fundo preparador',
  'Fungicida (mofo)',
  'Tratamento de trincas',
] as const;

// ─── Tipos ────────────────────────────────────────────────────────────────

export interface SugestaoDePreco {
  min: number | null;
  medio: number;
  max: number | null;
}

/** Uma linha da Tabela ABRAPP (ou avulsa) dentro de um serviço. */
export interface ItemDoOrcamento {
  /** id local (só pra React/remoção) */
  id: string;
  /** `price_table_items.id`; null = item avulso digitado pelo pintor */
  priceItemId: string | null;
  servico: string;
  /** "Látex · Acrílico Premium · até 3 m" — só pra tela */
  detalhe: string | null;
  /** chave de unidade da tabela ('m2', 'diaria', 'unidade'…) */
  unidade: string;
  /** texto do campo; vazio/inválido conta como 1 */
  quantidade: string;
  /** texto do campo; VAZIO por padrão (decisão 1) */
  valorUnitario: string;
  sugestao: SugestaoDePreco | null;
  /** Texto longo que sai no PDF embaixo do nome ("Empapelamento e proteção do piso…") */
  descricao?: string;
}

/**
 * Um serviço do orçamento: itens + (opcionalmente) espaço e material. Campo
 * de texto vazio = não informado; nada é inventado no PDF.
 */
export interface ServicoDoOrcamento {
  id: string;
  // Espaço (opcional)
  tipo: string;
  areaM2: string;
  peDireito: string;
  comodos: string;
  superficie: string;
  acesso: string;
  // Material e técnica
  tinta: string;
  cor: string;
  demaos: string;
  preparacao: string[];
  /** "interna" | "externa" — vira "Este serviço será realizado na parte Interna da casa" no PDF */
  local?: string;
  // Itens da Tabela ABRAPP / avulsos
  itens: ItemDoOrcamento[];
}

/** Chave onde a lista vive dentro de `quotes.quote_data`. */
export const QUOTE_DATA_SERVICOS_KEY = 'servicos';

let seq = 0;
export function novoId(prefixo = 'srv'): string {
  seq += 1;
  return `${prefixo}-${Date.now().toString(36)}-${seq}`;
}

/**
 * Serviço em branco. TUDO vazio de propósito (3ª rodada, 2026-09-07): o
 * serviço nasce de um item da tabela, e o pintor só abre "Detalhes" se quiser
 * dizer tipo, área, tinta… Um default como "Pintura interna" apareceria no
 * PDF como se a pessoa tivesse escolhido — e ela não escolheu.
 */
export function novoServico(over: Partial<ServicoDoOrcamento> = {}, id: string = novoId('srv')): ServicoDoOrcamento {
  return {
    id,
    tipo: '',
    areaM2: '',
    peDireito: '',
    comodos: '',
    superficie: '',
    acesso: '',
    tinta: '',
    cor: '',
    demaos: '',
    preparacao: [],
    local: '',
    itens: [],
    ...over,
  };
}

/**
 * Serviço novo JÁ COM o primeiro item — é assim que um serviço nasce na tela:
 * a pessoa escolhe uma linha da tabela (ou cria um avulso) e o bloco aparece
 * em volta dela. Herda acesso e tinta do serviço anterior, porque obra do
 * mesmo lugar costuma repetir os dois (trocar é um toque).
 */
export function servicoComItem(
  item: ItemDoOrcamento,
  anterior?: ServicoDoOrcamento | null,
  id: string = novoId('srv'),
): ServicoDoOrcamento {
  return novoServico(
    {
      ...(anterior ? { acesso: anterior.acesso, tinta: anterior.tinta } : {}),
      itens: [item],
    },
    id,
  );
}

/** Monta um item a partir de uma linha da Tabela ABRAPP. */
export function itemDaTabela(item: PriceItem, id: string = novoId('item')): ItemDoOrcamento {
  const detalhe = [item.grupo, item.tipo, rotuloAltura(item.altura)].filter(Boolean).join(' · ');
  return {
    id,
    priceItemId: item.id,
    servico: item.servico,
    detalhe: detalhe || null,
    unidade: item.unidade,
    quantidade: '1',
    valorUnitario: '',
    sugestao:
      item.preco_medio > 0
        ? { min: item.preco_min, medio: item.preco_medio, max: item.preco_max }
        : null,
    descricao: '',
  };
}

/** Linha livre — serviço que não está na tabela (grafite, automotivo…). */
export function itemAvulso(nome = '', id: string = novoId('item')): ItemDoOrcamento {
  return {
    id,
    priceItemId: null,
    servico: nome,
    detalhe: null,
    unidade: 'unidade',
    quantidade: '1',
    valorUnitario: '',
    sugestao: null,
    descricao: '',
  };
}

/**
 * Deduz o eixo de altura da tabela a partir do campo "Acesso" do serviço.
 * "Andaime (3-6m)" e "cadeira suspensa (acima 6m)" → acima de 3 m; térreo e
 * escada → até 3 m. Serve só pra PRÉ-selecionar o filtro do seletor — a
 * pessoa troca se quiser.
 */
export function alturaDoAcesso(access: string | null | undefined): PriceAltura | null {
  const a = (access ?? '').toLowerCase();
  if (!a) return null;
  if (/andaime|acima|suspens/.test(a)) return 'acima_3m';
  return 'ate_3m';
}

// ─── Contas por item ──────────────────────────────────────────────────────

/** Quantidade numérica; vazio, inválido ou ≤ 0 vale 1 (mesma regra de `totalPara`). */
export function quantidadeDe(s: ItemDoOrcamento): number {
  const q = Number(String(s.quantidade ?? '').replace(',', '.'));
  return Number.isFinite(q) && q > 0 ? q : 1;
}

/** Valor unitário digitado; vazio ou ≤ 0 → null ("ainda não decidido"). */
export function valorUnitarioDe(s: ItemDoOrcamento): number | null {
  const raw = String(s.valorUnitario ?? '').trim();
  if (!raw) return null;
  const v = parseBRL(raw);
  return v > 0 ? v : null;
}

/** valor digitado × quantidade; null enquanto o valor estiver vazio. */
export function subtotalDoItem(s: ItemDoOrcamento): number | null {
  const v = valorUnitarioDe(s);
  if (v === null) return null;
  return arredondar(v * quantidadeDe(s));
}

/** média da tabela × quantidade; null sem sugestão. */
export function subtotalSugerido(s: ItemDoOrcamento): number | null {
  if (!s.sugestao || s.sugestao.medio <= 0) return null;
  return arredondar(s.sugestao.medio * quantidadeDe(s));
}

export interface Totais {
  /** soma só do que a pessoa já preencheu */
  preenchido: number;
  /** soma usando o valor digitado e, onde falta, a média da tabela */
  sugerido: number;
  /** quantas linhas ainda estão sem valor */
  semValor: number;
  /** quantas linhas sem valor NEM sugestão (avulso ou item zerado) */
  semSugestao: number;
}

export function totaisDosItens(lista: readonly ItemDoOrcamento[]): Totais {
  let preenchido = 0;
  let sugerido = 0;
  let semValor = 0;
  let semSugestao = 0;
  for (const s of lista) {
    const sub = subtotalDoItem(s);
    if (sub !== null) {
      preenchido += sub;
      sugerido += sub;
      continue;
    }
    semValor += 1;
    const sug = subtotalSugerido(s);
    if (sug === null) semSugestao += 1;
    else sugerido += sug;
  }
  return {
    preenchido: arredondar(preenchido),
    sugerido: arredondar(sugerido),
    semValor,
    semSugestao,
  };
}

/** Totais do orçamento inteiro = itens de todos os serviços. */
export function totaisDoOrcamento(servicos: readonly ServicoDoOrcamento[]): Totais {
  return totaisDosItens(servicos.flatMap((s) => s.itens));
}

/** Uma linha de texto por item — WhatsApp, e-mail, descrição pra IA. */
export function descreverItem(s: ItemDoOrcamento): string {
  const nome = s.servico.trim() || 'Serviço';
  const qtd = quantidadeDe(s);
  const unid = unidadeCurta(s.unidade);
  const v = valorUnitarioDe(s);
  const sub = subtotalDoItem(s);
  const base = `${nome} — ${fmtNum(qtd)} ${unid}`;
  if (v === null || sub === null) return `${base} (valor a definir)`;
  return `${base} × R$ ${fmtBRL(v)} = R$ ${fmtBRL(sub)}`;
}

// ─── Contas por serviço / orçamento ───────────────────────────────────────

/** Área numérica do serviço; vazio/inválido → null. */
export function areaDoServico(s: ServicoDoOrcamento): number | null {
  const n = Number(String(s.areaM2 ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Soma das áreas informadas; null se nenhum serviço tem área. */
export function areaTotal(servicos: readonly ServicoDoOrcamento[]): number | null {
  let soma = 0;
  let algum = false;
  for (const s of servicos) {
    const a = areaDoServico(s);
    if (a !== null) {
      soma += a;
      algum = true;
    }
  }
  return algum ? arredondar(soma) : null;
}

/**
 * Título do orçamento a partir dos serviços: um só → o tipo dele; vários →
 * tipos distintos unidos por " + ". Vai pra `quotes.service_type`/`title`,
 * que o pipeline e o PDF mostram.
 */
export function tituloDosServicos(servicos: readonly ServicoDoOrcamento[]): string {
  // Sem tipo escolhido, o nome do serviço é o do PRIMEIRO item da tabela.
  const nomes = servicos.map((s) => s.tipo.trim() || s.itens[0]?.servico.trim() || '').filter(Boolean);
  const distintos = Array.from(new Set(nomes));
  return distintos.length > 0 ? distintos.join(' + ') : 'Orçamento';
}

/**
 * "Pintura interna · 80 m² · 3 cômodos" — cabeçalho curto do serviço. Sem
 * tipo escolhido, vale o nome do primeiro item da tabela.
 */
export function nomeDoServico(s: ServicoDoOrcamento): string {
  return s.tipo.trim() || s.itens[0]?.servico.trim() || 'Serviço';
}

export function resumoDoServico(s: ServicoDoOrcamento): string {
  const area = areaDoServico(s);
  const partes = [
    nomeDoServico(s),
    area !== null ? `${fmtNum(area)} m²` : null,
    s.comodos.trim() ? `${s.comodos.trim()} ${s.comodos.trim() === '1' ? 'cômodo' : 'cômodos'}` : null,
  ].filter(Boolean);
  return partes.join(' · ');
}

/** Pares rótulo/valor do espaço + material, só os preenchidos (tela e PDF). */
export function detalhesDoServico(s: ServicoDoOrcamento): Array<[string, string]> {
  const linhas: Array<[string, string]> = [];
  const push = (k: string, v: string | null | undefined) => {
    if (v && v.trim()) linhas.push([k, v.trim()]);
  };
  push('Área', areaDoServico(s) !== null ? `${s.areaM2.trim()} m²` : '');
  push('Pé direito', s.peDireito ? `${s.peDireito} m` : '');
  push('Cômodos', s.comodos);
  push('Superfície', s.superficie);
  push('Acesso', s.acesso);
  push('Tinta', [s.tinta.trim(), s.cor.trim()].filter(Boolean).join(' · '));
  push('Demãos', s.demaos);
  push('Preparação', s.preparacao.join(', '));
  return linhas;
}

/** Bloco de texto de um serviço — WhatsApp, e-mail, descrição pra IA. */
export function descreverServico(s: ServicoDoOrcamento, opts: { marcador?: string } = {}): string {
  const m = opts.marcador ?? '•';
  const linhas = [
    resumoDoServico(s),
    ...detalhesDoServico(s)
      .filter(([k]) => k !== 'Área' && k !== 'Cômodos') // já estão no resumo
      .map(([k, v]) => `  ${k}: ${v}`),
    ...s.itens.map((i) => `  ${m} ${descreverItem(i)}`),
  ];
  return linhas.join('\n');
}

/**
 * Texto que vai pra Cali Colors quando o pintor aceita pedir orçamento de
 * material (pergunta do QuoteWizard). Só o que a loja precisa pra cotar:
 * serviços, espaço, tinta e itens com quantidade. De propósito SEM dados
 * do cliente (nome/telefone/endereço são do pintor, não da loja) e SEM os
 * preços de mão de obra do pintor.
 */
export function textoDosItensParaLoja(
  servicos: readonly ServicoDoOrcamento[],
  pintor: { nome: string; cidade?: string | null; uf?: string | null },
): string {
  const local = [pintor.cidade?.trim(), pintor.uf?.trim()].filter(Boolean).join('/');
  const blocos = servicos.map((s, i) => {
    const linhas = [
      `${servicos.length > 1 ? `${i + 1}) ` : ''}${resumoDoServico(s)}`,
      ...detalhesDoServico(s)
        .filter(([k]) => k !== 'Área' && k !== 'Cômodos')
        .map(([k, v]) => `  ${k}: ${v}`),
      ...s.itens.map((it) => `  • ${it.servico.trim() || 'Serviço'} — ${fmtNum(quantidadeDe(it))} ${unidadeCurta(it.unidade)}`),
    ];
    return linhas.join('\n');
  });
  const area = areaTotal(servicos);
  return [
    '🧾 Pedido de orçamento de material (sem compromisso)',
    `Pintor: ${pintor.nome}${local ? ` · ${local}` : ''}`,
    '',
    ...blocos,
    ...(area !== null && servicos.length > 1 ? ['', `Área total: ${fmtNum(area)} m²`] : []),
    '',
    'Podem me passar um orçamento dos materiais pra essa obra?',
  ].join('\n');
}

/** Um item avulso sem nome gravaria uma linha muda no PDF. */
export function temAvulsoSemNome(servicos: readonly ServicoDoOrcamento[]): boolean {
  return servicos.some((s) => s.itens.some((i) => i.priceItemId === null && !i.servico.trim()));
}

// ─── Leitura do jsonb ─────────────────────────────────────────────────────

/**
 * Lê a lista gravada em `quote_data` (jsonb) sem confiar no formato: linha
 * malformada é descartada em vez de derrubar o PDF inteiro. Aceita o objeto
 * `quote_data` ou a própria lista.
 *
 * Tolera o formato da 1ª versão (2026-09-07, mesmo dia), em que `servicos`
 * era a lista de ITENS direto: vira um serviço único com os campos de
 * espaço/material que viviam no topo do `quote_data`.
 */
export function servicosDoQuoteData(qd: unknown): ServicoDoOrcamento[] {
  const topo = qd && typeof qd === 'object' && !Array.isArray(qd) ? (qd as Record<string, unknown>) : null;
  const bruto = Array.isArray(qd) ? qd : topo ? topo[QUOTE_DATA_SERVICOS_KEY] : null;
  if (!Array.isArray(bruto)) return [];

  const servicos: ServicoDoOrcamento[] = [];
  const itensSoltos: ItemDoOrcamento[] = [];
  bruto.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.itens) || typeof r.tipo === 'string') {
      servicos.push(servicoDeLinha(r, i));
      return;
    }
    // Formato antigo: item de tabela direto na lista.
    const item = itemDeLinha(r, i);
    if (item) itensSoltos.push(item);
  });

  if (itensSoltos.length > 0) {
    servicos.push(
      novoServico(
        {
          tipo: texto(topo?.serviceType) || 'Serviço',
          areaM2: texto(topo?.areaM2),
          peDireito: texto(topo?.ceilingHeight),
          comodos: texto(topo?.rooms),
          superficie: texto(topo?.surfaceState),
          acesso: texto(topo?.access),
          tinta: texto(topo?.paintType),
          cor: texto(topo?.colorWant),
          demaos: texto(topo?.coats),
          preparacao: listaDeTexto(topo?.prep),
          itens: itensSoltos,
        },
        'srv-legado',
      ),
    );
  }
  return servicos;
}

function servicoDeLinha(r: Record<string, unknown>, i: number): ServicoDoOrcamento {
  const itens: ItemDoOrcamento[] = [];
  if (Array.isArray(r.itens)) {
    r.itens.forEach((raw, j) => {
      if (!raw || typeof raw !== 'object') return;
      const item = itemDeLinha(raw as Record<string, unknown>, j);
      if (item) itens.push(item);
    });
  }
  return {
    id: texto(r.id) || `srv-${i}`,
    tipo: texto(r.tipo),
    areaM2: texto(r.areaM2),
    peDireito: texto(r.peDireito),
    comodos: texto(r.comodos),
    superficie: texto(r.superficie),
    acesso: texto(r.acesso),
    tinta: texto(r.tinta),
    cor: texto(r.cor),
    demaos: texto(r.demaos),
    preparacao: listaDeTexto(r.preparacao),
    local: texto(r.local),
    itens,
  };
}

function itemDeLinha(r: Record<string, unknown>, i: number): ItemDoOrcamento | null {
  if (typeof r.servico !== 'string' || !r.servico.trim()) return null;
  const sug = r.sugestao;
  let sugestao: SugestaoDePreco | null = null;
  if (sug && typeof sug === 'object') {
    const so = sug as Record<string, unknown>;
    const medio = numOuNull(so.medio);
    if (medio !== null && medio > 0) {
      sugestao = { min: numOuNull(so.min), medio, max: numOuNull(so.max) };
    }
  }
  return {
    id: texto(r.id) || `item-${i}`,
    priceItemId: typeof r.priceItemId === 'string' ? r.priceItemId : null,
    servico: r.servico,
    detalhe: texto(r.detalhe) || null,
    unidade: texto(r.unidade) || 'unidade',
    quantidade: texto(r.quantidade) || '1',
    valorUnitario: texto(r.valorUnitario),
    sugestao,
    descricao: texto(r.descricao),
  };
}

// ─── privados ─────────────────────────────────────────────────────────────

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

function numOuNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function texto(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function listaDeTexto(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

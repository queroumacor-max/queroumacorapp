// orcamentoDocumento — o DOCUMENTO do orçamento (o PDF que o cliente recebe),
// no layout de referência que o usuário mandou em 2026-09-08 (orçamento da
// LP Decor Pinturas, 4 páginas): cabeçalho do profissional com logo e
// "Orçamento nº", bloco do cliente com endereço e visita técnica, tabela de
// serviços (item + descrição longa | valor unitário | quantidade | subtotal),
// faixas de total/subtotal/desconto/valor total, laudo técnico, informações
// adicionais, pagamento (formas + chave PIX), "parte interna/externa" por
// serviço, botões Recusar/Aprovar e a página "Área do profissional".
//
// Este módulo é PURO: recebe a linha de `quotes` + o perfil do pintor e
// devolve a estrutura pronta pra desenhar. Quem desenha são DOIS
// renderizadores com o mesmo modelo — `lib/pdf/quotePdf.ts` (jsPDF, o
// arquivo de verdade que vai pro cliente, e o único caminho que funciona no
// app) e `components/orcamento/OrcamentoDocumento.tsx` (HTML, a prévia na
// tela e o print do navegador). Se a conta vivesse em cada um, a prévia
// mentiria sobre o arquivo.
//
// O que NÃO existe no banco e por isso vive em `quote_data` (sem SQL):
// número sequencial (`numero`), visita técnica, endereço completo do
// cliente, desconto, laudo técnico, formas de pagamento + chave PIX,
// descrição longa por item, "local" (interna/externa) por serviço e o
// CNPJ/CPF/endereço do pintor (snapshot em `quote_data.painter` — o perfil
// não tem essas colunas).

import { fmtBRL, parseBRL } from '@/lib/utils';
import { unidadeCurta } from '@/lib/services/priceTable';
import {
  nomeDoServico,
  quantidadeDe,
  servicosDoQuoteData,
  subtotalDoItem,
  valorUnitarioDe,
  type ItemDoOrcamento,
  type ServicoDoOrcamento,
} from '@/lib/orcamentoServicos';

// ─── O que o wizard grava em quote_data (além de `servicos`) ─────────────

export interface EnderecoDoCliente {
  rua: string;
  bairro: string;
  complemento: string;
  cidade: string;
  uf: string;
  cep: string;
}

export const ENDERECO_VAZIO: EnderecoDoCliente = {
  rua: '',
  bairro: '',
  complemento: '',
  cidade: '',
  uf: '',
  cep: '',
};

/** Snapshot do profissional gravado no orçamento (o perfil não tem CNPJ/CPF). */
export interface ProfissionalDoOrcamento {
  nome: string;
  rotulo: string; // "Pintor", "Grafiteiro"…
  cnpj: string;
  cpf: string;
  endereco: string;
  telefone: string;
  email: string;
  logo: string;
  sobre: string;
}

export const FORMAS_DE_PAGAMENTO = [
  'Dinheiro',
  'PIX',
  'Cartão de crédito',
  'Cartão de débito',
  'Transferência bancária',
  'Boleto',
] as const;

// ─── Modelo do documento ──────────────────────────────────────────────────

export interface ItemDoDocumento {
  titulo: string;
  descricao: string;
  /** "Valor por m²", "Valor por diária"… */
  rotuloUnidade: string;
  valorUnitario: number | null;
  quantidade: number;
  subtotal: number | null;
}

export interface GrupoDoDocumento {
  /** null quando o orçamento tem um serviço só (a tabela sai lisa, como na referência) */
  titulo: string | null;
  itens: ItemDoDocumento[];
}

export interface DocumentoOrcamento {
  numero: string;
  /** "01/06/2026 às 06:57" (Brasília) */
  geradoEm: string;
  profissional: ProfissionalDoOrcamento;
  cliente: { nome: string; telefone: string; enderecoLinha: string; cep: string };
  visitaTecnica: string | null;
  grupos: GrupoDoDocumento[];
  totais: {
    /** soma dos subtotais dos itens com valor */
    totalServicos: number;
    subtotal: number;
    desconto: number;
    valorTotal: number;
    /** algum item ainda sem valor — a tabela mostra "a definir" */
    temItemSemValor: boolean;
  };
  laudoTecnico: string;
  informacoesAdicionais: string;
  pagamento: { formas: string[]; chavePix: string };
  locais: Array<{ titulo: string; texto: string }>;
  aprovacao: { aprovarUrl: string | null; recusarUrl: string | null };
}

/** O mínimo que o modelo precisa da linha de `quotes`. */
export interface QuoteParaDocumento {
  id?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
  address?: string | null;
  service_type?: string | null;
  title?: string | null;
  description?: string | null;
  price?: number | string | null;
  quote_data?: unknown;
  created_at?: string | null;
}

/** O mínimo que o modelo precisa do perfil do pintor (pode ser null). */
export interface PerfilParaDocumento {
  name?: string | null;
  tag?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  bio?: string | null;
  profession?: string | null;
  role?: string | null;
  business_logo_url?: string | null;
  business_name?: string | null;
}

const ROTULO_POR_PAPEL: Record<string, string> = {
  pintor: 'Pintor',
  grafiteiro: 'Grafiteiro',
  automotivo: 'Pintor automotivo',
  funileiro: 'Funileiro',
  arquiteto: 'Arquiteto / Engenheiro',
  engenheiro: 'Engenheiro',
};

export function rotuloDoProfissional(perfil: PerfilParaDocumento | null | undefined): string {
  const p = (perfil?.profession || perfil?.role || '').trim().toLowerCase();
  return ROTULO_POR_PAPEL[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Pintor');
}

/**
 * Monta o documento. `agora` só existe pra teste — "gerado em" é a hora da
 * geração do arquivo, não a de criação do orçamento (como na referência).
 */
export function montarDocumento(
  quote: QuoteParaDocumento,
  perfil: PerfilParaDocumento | null | undefined,
  opts: { agora?: Date } = {},
): DocumentoOrcamento {
  const qd = objeto(quote.quote_data);
  const snapshot = objeto(qd.painter);

  const profissional: ProfissionalDoOrcamento = {
    nome:
      texto(snapshot.name) ||
      perfil?.business_name ||
      perfil?.name ||
      (perfil?.tag ? '@' + perfil.tag : '') ||
      'Profissional',
    rotulo: texto(snapshot.rotulo) || rotuloDoProfissional(perfil),
    cnpj: texto(snapshot.cnpj),
    cpf: texto(snapshot.cpf),
    endereco:
      texto(snapshot.endereco) ||
      juntar([perfil?.address, juntar([perfil?.city, perfil?.state], ' - ')], ', '),
    telefone: texto(snapshot.phone) || perfil?.phone || '',
    email: texto(snapshot.email) || perfil?.email || '',
    // Nunca cai pro avatar_url (foto de perfil): sem logo de negócio
    // configurado, o cabeçalho fica sem imagem — foto pessoal no lugar de
    // logo confundia o cliente (pedido do usuário, 2026-09-26).
    logo: texto(snapshot.logo) || perfil?.business_logo_url || '',
    sobre: texto(snapshot.sobre) || perfil?.bio || '',
  };

  const endereco = enderecoDoQuoteData(qd);
  const cliente = {
    nome: quote.client_name || texto(qd.clientName) || '',
    telefone: quote.client_phone || texto(qd.clientPhone) || '',
    enderecoLinha: linhaDeEndereco(endereco) || quote.address || '',
    cep: endereco.cep,
  };

  const servicos = servicosDoQuoteData(qd);
  const grupos = gruposDoDocumento(servicos, quote, qd);

  const itens = grupos.flatMap((g) => g.itens);
  const totalServicos = arredondar(
    itens.reduce((acc, i) => acc + (i.subtotal ?? 0), 0),
  );
  const temItemSemValor = itens.some((i) => i.subtotal === null);
  const precoGravado = numero(quote.price);
  const descontoDigitado = parseDesconto(texto(qd.desconto), totalServicos);

  // Subtotal é a soma dos itens; sem item com valor, é o próprio preço
  // gravado (orçamento antigo ou preço da IA).
  const subtotal = totalServicos > 0 ? totalServicos : precoGravado;
  let desconto = descontoDigitado;
  let valorTotal: number;
  if (precoGravado > 0) {
    valorTotal = precoGravado;
    // Preço digitado abaixo da soma sem desconto explícito: a diferença É o
    // desconto — é o que o cliente vê na referência.
    if (desconto === 0 && subtotal > valorTotal) desconto = arredondar(subtotal - valorTotal);
  } else {
    valorTotal = Math.max(0, arredondar(subtotal - desconto));
  }

  const numeroDoc = texto(qd.numero) || (quote.id ? quote.id.slice(0, 8) : '—');
  const digitos = digitosDoTelefone(profissional.telefone);
  const nomeCliente = cliente.nome ? ` (${cliente.nome})` : '';

  return {
    numero: numeroDoc,
    geradoEm: formatarDataHora(opts.agora ?? new Date()),
    profissional,
    cliente,
    visitaTecnica: formatarDataHoraLocal(texto(qd.visitaTecnica)),
    grupos,
    totais: { totalServicos, subtotal, desconto, valorTotal, temItemSemValor },
    laudoTecnico: texto(qd.laudoTecnico),
    informacoesAdicionais: texto(qd.description) || quote.description || '',
    pagamento: {
      formas: listaDeTexto(qd.pagamento),
      chavePix: texto(qd.chavePix),
    },
    locais: locaisDosServicos(servicos),
    aprovacao: {
      aprovarUrl: digitos
        ? waMe(digitos, `Olá! Aprovo o orçamento nº ${numeroDoc}${nomeCliente}.`)
        : null,
      recusarUrl: digitos
        ? waMe(digitos, `Olá. Não vou seguir com o orçamento nº ${numeroDoc}${nomeCliente}.`)
        : null,
    },
  };
}

// ─── Pedaços (exportados pra teste e pro wizard) ─────────────────────────

export function enderecoDoQuoteData(qd: unknown): EnderecoDoCliente {
  const c = objeto(objeto(qd).cliente);
  return {
    rua: texto(c.rua),
    bairro: texto(c.bairro),
    complemento: texto(c.complemento),
    cidade: texto(c.cidade),
    uf: texto(c.uf),
    cep: texto(c.cep),
  };
}

/** "Rua X, 70 - Jd Dos Ipês - Casa - Suzano - SP" (só o que está preenchido). */
export function linhaDeEndereco(e: EnderecoDoCliente): string {
  return juntar([e.rua, e.bairro, e.complemento, e.cidade, e.uf], ' - ');
}

/**
 * Desconto digitado: "10%" → percentual da base; "500", "R$ 500,00" → valor.
 * Vazio ou inválido → 0. Nunca maior que a base.
 */
export function parseDesconto(s: string, base: number): number {
  const raw = (s ?? '').trim();
  if (!raw) return 0;
  let v: number;
  if (raw.endsWith('%')) {
    const pct = parseBRL(raw.slice(0, -1));
    v = (base * pct) / 100;
  } else {
    v = parseBRL(raw);
  }
  if (!Number.isFinite(v) || v <= 0) return 0;
  return arredondar(Math.min(v, base > 0 ? base : v));
}

/** Rótulo da coluna "Valor Unitário" de cada linha, como na referência. */
export function rotuloDeUnidade(unidade: string): string {
  const curta = unidadeCurta(unidade);
  return `Valor por ${curta}`;
}

export function itemDoDocumento(i: ItemDoOrcamento): ItemDoDocumento {
  return {
    titulo: i.servico.trim() || 'Serviço',
    descricao: (i.descricao ?? '').trim(),
    rotuloUnidade: rotuloDeUnidade(i.unidade),
    valorUnitario: valorUnitarioDe(i),
    quantidade: quantidadeDe(i),
    subtotal: subtotalDoItem(i),
  };
}

/** "dd/mm/aaaa às HH:MM" em Brasília (regra do projeto: todo horário é BRT). */
export function formatarDataHora(d: Date): string {
  try {
    const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const hora = d.toLocaleTimeString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${data} às ${hora}`;
  } catch {
    return d.toLocaleString('pt-BR');
  }
}

/**
 * Valor de um `<input type="datetime-local">` ("2026-05-25T17:10") →
 * "25/05/2026 às 17:10". É hora LOCAL digitada, não instante: não passa por
 * fuso nenhum, senão a visita marcada pras 17:10 sairia 14:10 no PDF.
 */
export function formatarDataHoraLocal(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec((s ?? '').trim());
  if (!m) return null;
  const [, a, me, di, h, mi] = m;
  return h && mi ? `${di}/${me}/${a} às ${h}:${mi}` : `${di}/${me}/${a}`;
}

export function fmtValor(n: number | null): string {
  return n === null ? 'a definir' : `R$ ${fmtBRL(n)}`;
}

export function fmtQuantidade(n: number): string {
  return Number.isInteger(n)
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

// ─── privados ─────────────────────────────────────────────────────────────

function gruposDoDocumento(
  servicos: ServicoDoOrcamento[],
  quote: QuoteParaDocumento,
  qd: Record<string, unknown>,
): GrupoDoDocumento[] {
  if (servicos.length > 0) {
    const comItens = servicos.filter((s) => s.itens.length > 0);
    const unico = comItens.length <= 1;
    return comItens.map((s) => ({
      titulo: unico ? null : nomeDoServico(s),
      itens: s.itens.map(itemDoDocumento),
    }));
  }

  // Formato do vanilla: quote_data.itens = [{desc, valor}]
  const legado = Array.isArray(qd.itens) ? (qd.itens as unknown[]) : [];
  const itensLegado: ItemDoDocumento[] = [];
  for (const raw of legado) {
    const r = objeto(raw);
    const desc = texto(r.desc);
    if (!desc) continue;
    const valor = parseBRL(texto(r.valor));
    itensLegado.push({
      titulo: desc,
      descricao: '',
      rotuloUnidade: 'Valor',
      valorUnitario: valor > 0 ? valor : null,
      quantidade: 1,
      subtotal: valor > 0 ? valor : null,
    });
  }
  if (itensLegado.length > 0) return [{ titulo: null, itens: itensLegado }];

  // Orçamento antigo do wizard (um serviço, um preço): vira uma linha só,
  // com o escopo como descrição.
  const preco = numero(quote.price);
  const titulo = quote.service_type || quote.title || 'Serviço';
  const descricao = texto(qd.scope) || quote.description || '';
  return [
    {
      titulo: null,
      itens: [
        {
          titulo,
          descricao,
          rotuloUnidade: 'Valor',
          valorUnitario: preco > 0 ? preco : null,
          quantidade: 1,
          subtotal: preco > 0 ? preco : null,
        },
      ],
    },
  ];
}

function locaisDosServicos(servicos: ServicoDoOrcamento[]): Array<{ titulo: string; texto: string }> {
  const out: Array<{ titulo: string; texto: string }> = [];
  for (const s of servicos) {
    const local = (s.local ?? '').trim().toLowerCase();
    if (local !== 'interna' && local !== 'externa') continue;
    const nomes = s.itens.map((i) => i.servico.trim()).filter(Boolean);
    const textoLocal = s.tipo.trim()
      ? [s.tipo.trim(), ...nomes].join(', ')
      : nomes.join(', ') || nomeDoServico(s);
    out.push({
      titulo: `Este serviço será realizado na parte ${local === 'interna' ? 'Interna' : 'Externa'} da casa`,
      texto: textoLocal,
    });
  }
  return out;
}

function waMe(digitos: string, mensagem: string): string {
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Só dígitos pro wa.me. Mesma regra do `normalizeWhatsAppTarget`: 10 dígitos
 * é fixo BR; 11 dígitos só é celular BR se o 3º for 9 (senão é DDI
 * estrangeiro, ex.: 1 650 315-4274); com "+" na frente é internacional e
 * passa verbatim. Colar 55 em tudo foi o que virou um contato dos EUA em
 * número inexistente (2026-08-28).
 */
export function digitosDoTelefone(raw: string): string {
  const bruto = (raw ?? '').trim();
  const d = bruto.replace(/\D/g, '');
  if (!d) return '';
  if (bruto.startsWith('+')) return d;
  if (d.length === 10) return '55' + d;
  if (d.length === 11 && d[2] === '9') return '55' + d;
  return d;
}

function objeto(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function numero(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

function listaDeTexto(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
}

function juntar(partes: Array<string | null | undefined>, sep: string): string {
  return partes.map((p) => (p ?? '').trim()).filter(Boolean).join(sep);
}

function arredondar(n: number): number {
  return Math.round(n * 100) / 100;
}

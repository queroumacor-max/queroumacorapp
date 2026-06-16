// mkt.ts — service layer pra a feature "Loja Cali Colors".
// Espelha modules/mkt.js do vanilla (catálogo + carrinho + camiseta
// personalizada + checkout Mercado Pago).
//
// Decisões de design vs vanilla:
//   - Estado mutável module-level (cartItems, mktProducts) → state vive no
//     hook React (TanStack Query cache); service é stateless.
//   - Localstorage shadow → fica no hook como `onMutate` otimista; service
//     só lida com Supabase (fonte de verdade).
//   - `resolveColorHex` + `COLOR_DICT` → exportados como puros pra serem
//     usados tanto pelo ProductCard quanto por testes determinísticos.
//   - `mktClassify` → função pura, exportada pra filtros de UI + testes.
//   - `submitOrder` (vanilla `submitCartOrder`) → 2 fases: cria order +
//     chama /api/mp-checkout-loja. O service só faz o INSERT no Supabase
//     e devolve o orderId; chamar o endpoint MP fica no hook pra que
//     window.location.href seja decisão da UI, não do service.
//
// Tipos INLINE (spec: NÃO tocar em lib/types.ts).

import { getSupabase } from '@/lib/supabase';
import type { Json } from '@/lib/database.types';
import {
  NetworkError,
  ValidationError,
  AuthorizationError,
} from '@/lib/errors';

// ─── tipos inline ──────────────────────────────────────────────────────────

// Subset de `products` que a UI consome. Permissivo (vários optional) pra
// absorver linhas legadas com colunas vazias — espelha o shape vanilla.
export interface Product {
  id: string;
  name: string;
  code?: string | null;
  category?: string | null;
  volume?: string | null;
  price: number;
  color_hex?: string | null;
  color_gradient?: string | null;
  stock?: number | null;
  badge?: string | null;
  description?: string | null;
  line?: string | null;
  rendimento?: string | null;
  demaos?: string | null;
  secagem?: string | null;
  active?: boolean | null;
  image_url?: string | null;
  created_at?: string | null;
  // Campo virtual (não vem do banco): produtos agrupados pelo mesmo nome
  // base, diferindo apenas pelo sufixo de tamanho (18L, 3,6L, 900ml…).
  _groupVariants?: GroupVariant[];
}

// Variante de tamanho gerada automaticamente pelo agrupamento de nomes.
export interface GroupVariant {
  sizeLabel: string;
  product: Product;
}

// Variante de produto (Wave 25) — quartinho/galão/lata etc.
// Sem variantes cadastradas, products.price segue valendo (fallback).
export interface ProductVariant {
  id: string;
  product_id: string;
  size_label: string;
  volume_ml: number | null;
  price: number;
  stock: number | null;
  sort_order: number;
}

// Item de carrinho — snapshot de Product no momento que foi adicionado
// (preserva price/color mesmo se o produto for atualizado depois).
export interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
  color_hex?: string | null;
  color_gradient?: string | null;
  volume?: string | null;
  // Wave 25: variante escolhida. Quando preenchido, o `id` do CartItem é
  // composto (`<productId>:<variantId>`) pra que dois tamanhos do mesmo
  // produto contem como linhas separadas. `price`/`volume` já refletem a
  // variante (snapshot — não atualiza se o admin mudar depois).
  variant_id?: string | null;
  variant_label?: string | null;
  // Suporta produtos sintéticos (camiseta personalizada com customização).
  customization?: ShirtCustomization | null;
}

// Categoria do menu lateral — espelha MKT_MENUS keys do vanilla.
export type MktCategory =
  | 'arte_urbana'
  | 'tintas'
  | 'tintas_auto'
  | 'texturas'
  | 'epoxi'
  | 'solventes'
  | 'adesivos'
  | 'ferramentas'
  | 'pintura'
  | 'eletrica'
  | 'equipamentos'
  | 'estetica_automotiva'
  | 'epi'
  | 'outros';

export interface MktMenuEntry {
  key: MktCategory;
  label: string;
  kw: string[];
}

// Filtro pra fetchProducts — null/undefined campos = sem filtro.
export interface ProductFilter {
  category?: MktCategory | null;
  search?: string | null;
  // Pra paginar no futuro; default = 1000 (pega tudo).
  limit?: number;
  // signal pra cancelar fetch quando query desmonta/invalida.
  signal?: AbortSignal;
}

// Resposta de submitOrder: id da order criada + total persistido.
export interface OrderSubmitResult {
  orderId: string;
  total: number;
}

// Customização de camiseta (cor + tamanho + qty + opcional logo overlay).
export interface ShirtCustomization {
  color: string; // hex (#000000) ou nome ('preto')
  size: 'P' | 'M' | 'G' | 'GG' | 'XGG';
  logoUrl?: string | null;
}

// Shirt model (mock — não há tabela `shirts` no banco, camisetas são fixas).
export interface Shirt {
  id: string;
  name: string;
  basePrice: number;
  colors: string[];
  sizes: ShirtCustomization['size'][];
  image: string;
}

// ─── cores: dicionário determinístico + resolução por nome ────────────────
// COPIADO de modules/mkt.js linhas 23-37. Fonte da verdade visual.

export const COLOR_DICT: ReadonlyArray<readonly [string, string]> = [
  ['branco neve', '#fbfbf7'],
  ['branco gelo', '#eef0ea'],
  ['branco fosco', '#f4f3ee'],
  ['off white', '#efece1'],
  ['branco', '#f6f5f0'],
  ['preto fosco', '#1c1c1c'],
  ['preto', '#1a1a1a'],
  ['cinza chumbo', '#4b4f54'],
  ['cinza grafite', '#3a3d40'],
  ['grafite', '#3a3d40'],
  ['cinza claro', '#c7c9c8'],
  ['cinza escuro', '#5a5d5f'],
  ['cinza concreto', '#9a9b96'],
  ['concreto', '#9a9b96'],
  ['cinza', '#9b9d9c'],
  ['prata', '#c5c7c9'],
  ['aluminio', '#b8bcc0'],
  ['azul claro', '#9ec7e8'],
  ['azul bebe', '#bcd9ee'],
  ['azul royal', '#1f4ea1'],
  ['azul marinho', '#1b2a4a'],
  ['azul petroleo', '#1f5560'],
  ['azul turquesa', '#2bb6c4'],
  ['turquesa', '#2bb6c4'],
  ['azul', '#2f6fb0'],
  ['verde musgo', '#5a6b3b'],
  ['verde limao', '#bcd64a'],
  ['verde agua', '#bfe3d8'],
  ['verde bandeira', '#1e7a3d'],
  ['verde oliva', '#6b6b3a'],
  ['verde', '#2e8b57'],
  ['amarelo ouro', '#e0a526'],
  ['amarelo canario', '#f5d427'],
  ['amarelo', '#f2c531'],
  ['ouro', '#caa233'],
  ['dourado', '#caa233'],
  ['vermelho', '#c0392b'],
  ['vinho', '#5e1f24'],
  ['bordo', '#5e1f24'],
  ['carmim', '#9b1c2e'],
  ['laranja', '#e67e22'],
  ['terracota', '#b5562e'],
  ['tijolo', '#9c4a2f'],
  ['salmao', '#f0a78f'],
  ['rosa', '#e79bb3'],
  ['pink', '#e84d8a'],
  ['magenta', '#c0337a'],
  ['roxo', '#6b3fa0'],
  ['lilas', '#b9a5d6'],
  ['violeta', '#7a4fb0'],
  ['marrom', '#6b4226'],
  ['cafe', '#4b3621'],
  ['chocolate', '#4b2e1e'],
  ['caramelo', '#a9743b'],
  ['tabaco', '#7a5230'],
  ['imbuia', '#5a3a22'],
  ['mogno', '#6e3326'],
  ['cedro', '#8a5a33'],
  ['castanho', '#5d3a22'],
  ['bege', '#d8c6a8'],
  ['areia', '#d6c5a0'],
  ['palha', '#e3d5ad'],
  ['creme', '#efe6cf'],
  ['nude', '#e3c9b3'],
  ['camurca', '#c9a878'],
  ['marfim', '#efe7d2'],
  ['gelo', '#eef0ea'],
  ['perola', '#ece7dd'],
];

// Cores "placeholder" que NÃO contam como cor escolhida — vêm do seed default.
const PLACEHOLDER_HEX = /^#?(c0622d|cccccc|ddd|dddddd|e8e2d9)$/i;

function normTxt(s: unknown): string {
  return (
    ' ' +
    String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[̀-ͯ]/g, '') +
    ' '
  );
}

/**
 * Resolve a cor de um produto: usa `color_hex` se for uma cor real (não
 * placeholder), senão tenta inferir do nome via COLOR_DICT. Devolve null
 * se nada matchou — UI fallback pra ícone de categoria.
 */
export function resolveColorHex(p: Pick<Product, 'name' | 'color_hex'> | null | undefined): string | null {
  if (!p) return null;
  const ch = p.color_hex ? String(p.color_hex).trim() : '';
  if (ch && !PLACEHOLDER_HEX.test(ch.replace('#', ''))) return ch;
  const n = normTxt(p.name);
  for (const [k, hex] of COLOR_DICT) {
    if (n.includes(k)) return hex;
  }
  return ch || null;
}

/**
 * Background CSS pra ícone do produto: gradient se tiver, senão cor sólida,
 * senão um cinza-creme default. Pode ser usado direto em `style.background`.
 */
export function productBg(p: Product | null | undefined): string {
  if (p && p.color_gradient) {
    return 'linear-gradient(135deg,' + p.color_gradient + ')';
  }
  return resolveColorHex(p ?? null) || '#e8e2d9';
}

// ─── classificação automática (marca/tipo no nome) ────────────────────────
// COPIADO de modules/mkt.js linhas 57-68. Mantemos as keywords aqui — fonte
// única no port; quando o vanilla for retirado, esses arrays viram canônicos.

export const MKT_MENUS: ReadonlyArray<MktMenuEntry> = [
  { key: 'arte_urbana', label: '🎨 Arte Urbana & Spray', kw: ['arte urbana', 'colorgin', 'spray', 'aerossol', 'aerosol', 'grafit', 'graffit'] },
  { key: 'tintas', label: '🪣 Tintas Imobiliárias', kw: ['tinta', 'esmalte', 'latex', 'látex', 'acrilic', 'acrílic', 'verniz', 'primer', 'seladora', 'fundo preparador', 'base coat', 'suvinil', 'coral', 'sherwin'] },
  { key: 'tintas_auto', label: '🚘 Tintas Automotivas', kw: ['automotiv', 'automotiva', 'esmalte automotiv', 'tinta automotiv', 'basecoat', 'base coat auto', 'clear coat', 'primer automotiv'] },
  { key: 'texturas', label: '🧱 Texturas & Massas', kw: ['textura', 'grafiato', 'massa corrida', 'massa acrilic', 'massa pva', 'reboco', 'chapisco'] },
  { key: 'epoxi', label: '⚗️ Epóxi & Poliuretano', kw: ['epoxi', 'epóxi', 'poliuretano', ' pu '] },
  { key: 'solventes', label: '💧 Solventes & Aditivos', kw: ['thinner', 'solvente', 'diluente', 'aguarras', 'aguarrás', 'acelerador', 'secante', 'catalisador', 'endurecedor', 'aditivo', 'redutor', 'removedor'] },
  { key: 'adesivos', label: '🧪 Adesivos & Colas', kw: ['adesivo', 'cola', 'silicone', 'vedante', 'veda calha', 'rejunte', 'massa epox', 'durepoxi'] },
  { key: 'ferramentas', label: '🧰 Ferramentas', kw: ['alicate', 'tesoura', 'chave', 'martelo', 'abre trinca', 'espatula', 'espátula', 'desempenadeira', 'colher de pedreiro', 'trena', 'serra', 'furadeira', 'broca', 'lixadeira', 'estilete', 'formao', 'formão', 'grosa', 'lima', 'torques'] },
  { key: 'pintura', label: '🖌️ Acessórios de Pintura', kw: ['rolo', 'pincel', 'trincha', 'bandeja', 'fita crepe', 'fita', 'lixa', 'cabo extensor', 'extensor', 'gaiola', 'luva', 'mascara', 'máscara', 'respirador', 'oculos', 'óculos', 'lona', 'plastico', 'plástico', 'crepe'] },
  { key: 'eletrica', label: '🔌 Elétrica', kw: ['tomada', 'adaptador', 'extens', 'lampada', 'lâmpada', 'disjuntor', 'filtro de linha', 'benjamim', 'fio ', 'interruptor'] },
  { key: 'equipamentos', label: '⚙️ Máquinas', kw: ['aerografo', 'aerógrafo', 'compressor', 'pistola', 'maquina', 'máquina', 'pulverizador', 'airless'] },
  { key: 'estetica_automotiva', label: '🚗 Estética Automotiva', kw: ['vonixx', 'polidor', 'polimento', 'cera automotiva', 'cristalizacao', 'cristalização', 'revitalizador', 'renovador automotiv', 'shampoo automotiv', 'limpa vidro', 'desengraxante automotiv', 'pretinho', 'silicon automotiv', 'autoshine', 'autodetailing', 'auto detailing'] },
  { key: 'epi', label: '🦺 EPI', kw: ['epi ', 'equipamento de proteção', 'proteção individual', 'capacete', 'bota de segurança', 'avental proteção', 'abafador', 'protetor auricular'] },
];

export const MKT_MENU_LABEL: Record<string, string> = {
  outros: '📦 Outros',
  ...Object.fromEntries(MKT_MENUS.map((m) => [m.key, m.label])),
};

/**
 * Classifica um produto numa categoria do menu pelo nome. Espelha o vanilla
 * incluindo as exceções (vonixx → outros, metalatex/novacor → tintas).
 */
export function mktClassify(p: Pick<Product, 'name' | 'code'> | null | undefined): MktCategory {
  const n = ' ' + String((p && p.name) || '').toLowerCase() + ' ';
  const code = String((p && p.code) || '').toLowerCase().trim();
  // Overrides por código (prioridade máxima)
  if (['803', '804', '805', '1205', '1206'].includes(code)) return 'arte_urbana';
  if (['1222', '1227', '1989'].includes(code)) return 'pintura';
  if (code === '1661') return 'tintas_auto';
  if (['1974', '1975'].includes(code)) return 'estetica_automotiva';
  // Overrides por nome (prioridade sobre keyword loop)
  if (n.includes('vonixx') || n.includes('arominha')) return 'estetica_automotiva';
  if (n.includes('lubrificante') || n.includes('desengripante') || n.includes('poliestes')) return 'epoxi';
  if (n.includes('nc esm') || n.includes('nc acr') || n.includes('nc lat')) return 'tintas';
  if (n.includes('metalatex') || n.includes('novacor')) return 'tintas';
  // Tinta auto PU (poliuretano industrial) → epoxi
  if (n.includes('tinta') && n.includes('auto') && n.includes(' pu ')) return 'epoxi';
  // Primers de uso exclusivamente automotivo
  if (n.includes(' primer pu ') || (n.includes('primer universal') && n.includes(' auto'))) return 'tintas_auto';
  // Seladoras para plástico → tintas automotivas
  if ((n.includes('seladora') || n.includes('selador')) && (n.includes('plástico') || n.includes('plastico'))) return 'tintas_auto';
  // Barniz (varnish automotivo em espanhol) → tintas_auto
  if (n.includes('barniz')) return 'tintas_auto';
  // Vernizes automotivos (PU / poliuretano / lazzudur / códigos HG / HT)
  if (n.includes('verniz') && (n.includes(' pu ') || n.includes('poliuretano') || n.includes('lazzudur') || n.includes(' hg ') || n.includes(' ht '))) return 'tintas_auto';
  // Esmalte anti ferrugem → arte urbana & spray
  if (n.includes('anti ferrugem') || n.includes('antiferrugem')) return 'arte_urbana';
  // Base poliester → tintas automotivas
  if (n.startsWith(' base poliester')) return 'tintas_auto';
  // Batida pedra → tintas automotivas (complementos)
  if (n.includes('batida pedra')) return 'tintas_auto';
  // Colordur / Colorsteel → epoxi & poliuretano
  if (n.includes('colordur') || n.includes('colorsteel')) return 'epoxi';
  // Corante xadrez → tintas imobiliárias (complementos tier)
  if (n.includes('corante') || n.includes('xadrez')) return 'tintas';
  // Estética automotiva: boinas, clay bar, auge, microfibra, escova roda, pinceis detalhamento
  if (n.includes('boina') || n.includes(' clay ') || n.includes('clay bar')) return 'estetica_automotiva';
  if (n.includes('auge ')) return 'estetica_automotiva';
  if (n.includes('removedor') && n.includes('cimento')) return 'estetica_automotiva';
  if (n.includes('microfibra')) return 'estetica_automotiva';
  if (n.includes('escova') && (n.includes('roda') || n.includes('furo'))) return 'estetica_automotiva';
  if (n.includes('pincel') && n.includes('detalh')) return 'estetica_automotiva';
  // Solventes: desengraxante não-automotivo
  if (n.includes('desengraxante') && !n.includes('automotiv')) return 'solventes';
  // Tintas automotivas: chapinha
  if (n.includes('chapinha')) return 'tintas_auto';
  // Texturas & massas: efeitos decorativos
  if (n.includes('efeito')) return 'texturas';
  // Arte urbana & spray: cavalete p/ tela, produtos PC-
  if (n.includes('cavalete')) return 'arte_urbana';
  if (n.startsWith(' pc-')) return 'arte_urbana';
  // Ferramentas: aspirador, bateria, bits, bolsa+conjunto, coador
  if (n.includes('aspirador')) return 'equipamentos';
  if (n.includes('bateria')) return 'ferramentas';
  if (n.includes('bits')) return 'ferramentas';
  if (n.includes('bolsa') && n.includes('conjunto')) return 'ferramentas';
  if (n.includes('coador')) return 'ferramentas';
  // Spray caps → arte urbana
  if (n.startsWith(' cap ')) return 'arte_urbana';
  // Acessórios de pintura: trinchas, broxa, caçamba, caixa plástica, luvas, misturador, garfo
  if (n.includes('trincha')) return 'pintura';
  if (n.includes('broxa')) return 'pintura';
  if (/ca[cç]amba/.test(n)) return 'pintura';
  if (n.includes('caixa') && (n.includes('plast') || n.includes('plás'))) return 'pintura';
  if (n.includes('luva') && (n.includes('latex') || n.includes('látex') || n.includes('latéx'))) return 'pintura';
  if (n.includes('misturador')) return 'pintura';
  if (n.includes('garfo')) return 'pintura';
  // Massa acrílica → texturas (keyword 'acrilic' em tintas bate antes do loop)
  if (n.includes('massa acril')) return 'texturas';
  for (const m of MKT_MENUS) {
    if (m.kw.some((k) => n.includes(k))) return m.key;
  }
  return 'outros';
}

// Regex pra esconder bases tinturométricas (nomes "BASE VY", "BASE Z" etc.)
// que aparecem no catálogo mas não devem ser vendidas direto pro consumidor.
const MKT_HIDDEN = /\bbase\s+(vy|z|xy|w|ly|e|f)\b|seladora?\s+acr[íi]l.*\btextura|antip[ií]cha[cç]|hs785|ultrabase|^lazzumix|^lm[\s-]|^mixing\s+fleet/i;

export function isMktHidden(p: Pick<Product, 'name'> | null | undefined): boolean {
  return MKT_HIDDEN.test((p && p.name) || '');
}

// Cores de leque (COR SUVINIL S-A-..., COR CORAL ..., COR SHERWIN ...) são
// SKUs individuais de tintometria — escondidos do catálogo geral e acessíveis
// pela aba "Cores personalizadas" dentro do detalhe de cada tinta.
// S-A … S-Z = séries de cores tintométricas Suvinil — ocultas do catálogo
// principal (acessíveis via aba "Cores personalizadas" dentro de cada tinta).
const LEQUE_RE = /(\bleque\b)|(^cor\s+(suvinil|coral|sherwin))|(^s-[a-z]\b)/i;
// Prefixos de código tintométrico: s- (Suvinil), c- (Coral), sw- (Sherwin).
const LEQUE_CODE_RE = /^(sw-|s-|c-)/i;

export function isLequeColor(p: Pick<Product, 'name' | 'code'> | null | undefined): boolean {
  if (LEQUE_RE.test((p && p.name) || '')) return true;
  return LEQUE_CODE_RE.test(((p && p.code) || '').trim());
}

// Produtos complementares — catalisadores e endurecedores que não aparecem no
// catálogo principal mas são exibidos dentro do produto pai ao qual pertencem.
const COMPANION_RE = /^(catalisador|endurecedor)\b/i;

export function isCompanionProduct(p: Pick<Product, 'name'> | null | undefined): boolean {
  return COMPANION_RE.test(((p && p.name) || '').trim());
}

// Palavras genéricas ignoradas na extração de keywords do produto pai.
const COMPANION_SKIP = new Set([
  'de', 'do', 'da', 'dos', 'das', 'em', 'com', 'para', 'por', 'que',
  'um', 'uma', 'uns', 'umas', 'ou', 'e', 'a', 'o', 'as', 'os',
  'tinta', 'esmalte', 'verniz', 'primer', 'seladora', 'fundo', 'base',
  'cor', 'acrilica', 'acrilico', 'latex', 'pva', 'stand', 'lata', 'galao',
]);

/**
 * Busca catalisadores e endurecedores relacionados a um produto pai.
 * Extrai palavras-chave do nome do pai (prioriza códigos alfanuméricos como
 * "KP350") e filtra os companions que contêm ao menos uma dessas palavras.
 */
export async function fetchCompanionsForProduct(parent: Pick<Product, 'id' | 'name'>): Promise<Product[]> {
  const sb = getSupabase();

  const words = (parent.name || '')
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length >= 2 && !COMPANION_SKIP.has(w));

  // Prefere códigos (contêm dígitos) para evitar falsos positivos.
  const codes = words.filter((w) => /\d/.test(w));
  const keywords = codes.length > 0 ? codes : words.slice(0, 3);

  if (!keywords.length) return [];

  const { data, error } = await sb
    .from('products')
    .select(PRODUCT_COLS)
    .or('name.ilike.catalisador%,name.ilike.endurecedor%')
    .eq('active', true)
    .limit(100);

  if (error || !data) return [];

  return (data as Product[]).filter((c) => {
    const cn = (c.name || '').toLowerCase();
    return keywords.some((kw) => cn.includes(kw));
  });
}

// Shape mínimo de uma cor de leque pra o seletor de tintometria.
export interface LequeColor {
  id: string;
  name: string;
  code: string | null;
  color_hex: string | null;
}

/**
 * Busca as cores de leque de uma marca específica filtrando pelo prefixo do
 * código tintométrico:
 *   Suvinil  → code ILIKE 's-%'  (exclui 'sw-%' que é Sherwin)
 *   Coral    → code ILIKE 'c-%'
 *   Sherwin  → code ILIKE 'sw-%'
 */
export async function fetchLequeColors(
  brand: 'suvinil' | 'coral' | 'sherwin',
): Promise<LequeColor[]> {
  const sb = getSupabase();
  let query = sb
    .from('products')
    .select('id, name, code, color_hex')
    .not('code', 'is', null);

  if (brand === 'sherwin') {
    query = query.ilike('code', 'sw-%');
  } else if (brand === 'coral') {
    query = query.ilike('code', 'c-%');
  } else {
    // suvinil: starts with s- but NOT sw-
    query = query.ilike('code', 's-%').not('code', 'ilike', 'sw-%');
  }

  const { data, error } = await query.order('code').limit(500);
  if (error) throw new NetworkError(error.message, error);
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    code: string | null;
    color_hex: string | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name ?? '',
    code: r.code ?? null,
    color_hex: r.color_hex ?? null,
  }));
}

// Tier de qualidade da tinta — usado pelo sub-filtro da categoria Tintas.
export type PaintTier = 'economica' | 'standard' | 'premium' | 'primer' | 'complementos';

export function paintTierClassify(
  p: Pick<Product, 'name'> | null | undefined,
): PaintTier {
  if (!p) return 'economica';
  const txt = (p.name || '').toLowerCase();
  if (/\bprimer\b|fundo preparador|wash primer|kp\d|fundo epox|fundo pva|fundo nivelador|\bseladora?\b/.test(txt)) return 'primer';
  if (/metalatex elastic|metalatex eco|super secagem|sherwin|linha premium|cor e proteção|cor e protecao/.test(txt)) return 'premium';
  if (/sintelux|alkylux|suvinil|coral|novacor|nc esm|nc acr|nc lat/.test(txt)) return 'standard';
  if (/corante|xadrez/.test(txt)) return 'complementos';
  return 'economica';
}

// Sub-tier da categoria Tintas Automotivas.
export type AutoTier = 'primer' | 'tinta' | 'verniz' | 'complementos' | 'solventes';

export function autoTierClassify(
  p: Pick<Product, 'name'> | null | undefined,
): AutoTier {
  if (!p) return 'tinta';
  const txt = (p.name || '').toLowerCase();
  if (/\bprimer\b|fundo preparador|wash primer|fundo automotiv|fundo nivelador|\bseladora?\b/.test(txt)) return 'primer';
  if (/\bverniz\b|clear coat|\bclear\b/.test(txt)) return 'verniz';
  if (/thinner|solvente|diluente|reducer|redutor|aguarras|aguarrás/.test(txt)) return 'solventes';
  if (/massa|chapinha|batida pedra|batida|complemento|kit reparo|adesivo/.test(txt)) return 'complementos';
  return 'tinta';
}

// ─── agrupamento por nome base ────────────────────────────────────────────
// Produtos que diferem apenas pelo sufixo de tamanho são agrupados num único
// card no catálogo; o seletor de tamanho aparece dentro do detalhe do produto.

// Sufixos de volume/peso reconhecidos no final do nome.
const SIZE_SUFFIX_RE = /\s+(\d[\d,.]*\s*(?:kg|g|ml|l|lt|litros?))\s*$/i;

export function normalizeProductName(name: string): string {
  return (name || '').replace(SIZE_SUFFIX_RE, '').trim();
}

function extractSizeSuffix(name: string): string | null {
  const m = (name || '').match(SIZE_SUFFIX_RE);
  return m ? m[1].trim().toUpperCase() : null;
}

/**
 * Agrupa produtos com o mesmo nome base (sem sufixo de tamanho).
 * O representante do grupo recebe `_groupVariants` com todos os membros
 * ordenados por preço crescente.
 */
export function groupProductsByName(products: Product[]): Product[] {
  const groups = new Map<string, Product[]>();
  const noSize: Product[] = [];

  for (const p of products) {
    const sizeLabel = extractSizeSuffix(p.name);
    if (!sizeLabel) {
      noSize.push(p);
      continue;
    }
    const key = normalizeProductName(p.name).toUpperCase();
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  }

  const result: Product[] = [...noSize];

  for (const [baseName, members] of groups) {
    const sorted = [...members].sort(
      (a, b) => Number(a.price || 0) - Number(b.price || 0),
    );
    // Representante: cópia do menor preço com nome normalizado.
    const rep: Product = { ...sorted[0], name: baseName };
    rep._groupVariants = sorted.map((p) => ({
      sizeLabel: extractSizeSuffix(p.name)!,
      product: p,
    }));
    result.push(rep);
  }

  return result;
}

// ─── catálogo: fetch + filtro ─────────────────────────────────────────────

// Colunas COMPLETAS — usadas só na página de detalhe (fetchProduct).
const PRODUCT_COLS =
  'id, name, code, category, volume, price, color_hex, color_gradient, stock, badge, description, line, rendimento, demaos, secagem, active, image_url, created_at';

// Colunas LEVES pra listagem — só o que ProductCard/filtro/classify usam.
// Tira description (texto longo), badge, line, rendimento, demaos, secagem,
// created_at, volume — payload cai ~50% pra ~4k produtos. Detalhe puxa o
// resto sob demanda via fetchProduct(id).
const PRODUCT_LIST_COLS =
  'id, name, code, category, price, color_hex, color_gradient, stock, active, image_url';

/**
 * Busca produtos do catálogo. Aceita filtro opcional por categoria/busca.
 * Filtro server-side só na categoria via classify, mas como mktClassify
 * roda em JS (regex sobre o nome), filtra client-side depois do fetch —
 * mesmo trade-off do vanilla.
 *
 * Esconde produtos com `_isMktHidden` (bases tinturométricas).
 *
 * Estratégia de pagination: PostgREST cap de 1000 rows por request, e o
 * catálogo tem ~4000+ produtos. Antes era sequencial (4-5 round-trips em
 * série, ~3-8s no mobile). Agora pega a 1ª página + count exato em 1
 * round-trip, depois dispara TODAS as páginas restantes EM PARALELO —
 * tempo total ≈ max(página) em vez de soma.
 */
export async function fetchProducts(filter: ProductFilter = {}): Promise<Product[]> {
  const sb = getSupabase();
  const PAGE = 1000;
  const cap = filter.limit;

  function buildQuery(from: number, to: number, withCount: boolean) {
    const opts = withCount ? { count: 'exact' as const } : undefined;
    const q = sb
      .from('products')
      .select(PRODUCT_LIST_COLS, opts)
      .order('name')
      .range(from, to);
    return filter.signal
      ? (q as unknown as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(filter.signal)
      : q;
  }

  // 1ª página + count em 1 round-trip. PostgREST devolve `count` quando
  // passamos { count: 'exact' } no .select().
  const firstResp = await buildQuery(0, PAGE - 1, true);
  if (firstResp.error) {
    throw new NetworkError(firstResp.error.message, firstResp.error);
  }
  const all: Product[] = ((firstResp.data ?? []) as Product[]).slice();
  const total = firstResp.count ?? all.length;

  // Páginas restantes — todas em paralelo.
  if (total > PAGE) {
    const totalPages = Math.min(Math.ceil(total / PAGE), 10); // cap defensivo
    const pagePromises: Promise<Product[]>[] = [];
    for (let page = 1; page < totalPages; page += 1) {
      const from = page * PAGE;
      const to = from + PAGE - 1;
      pagePromises.push(
        (async () => {
          const resp = await buildQuery(from, to, false);
          if (resp.error) throw new NetworkError(resp.error.message, resp.error);
          return (resp.data ?? []) as Product[];
        })(),
      );
    }
    const batches = await Promise.all(pagePromises);
    for (const batch of batches) all.push(...batch);
  }

  let rows = all.filter((p) => !isMktHidden(p) && !isLequeColor(p) && !isCompanionProduct(p));
  if (cap) rows = rows.slice(0, cap);

  if (filter.category) {
    rows = rows.filter((p) => mktClassify(p) === filter.category);
  }
  if (filter.search) {
    const q = filter.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (p) =>
          (p.name || '').toLowerCase().includes(q) ||
          String(p.code || '').toLowerCase().includes(q)
      );
    }
  }
  return rows;
}

/**
 * Busca um produto por id. Retorna null se não existe (em vez de throw)
 * pra que a página de detalhe possa renderizar uma tela "produto removido"
 * ao invés de error boundary.
 */
export async function fetchProduct(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<Product | null> {
  if (!id) return null;
  const sb = getSupabase();
  const q = sb
    .from('products')
    .select(PRODUCT_COLS)
    .eq('id', id)
    .maybeSingle();
  const qFinal = options?.signal
    ? (q as unknown as { abortSignal: (s: AbortSignal) => typeof q }).abortSignal(options.signal)
    : q;
  const { data, error } = await qFinal;
  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data as Product) ?? null;
}

// ─── variantes (Wave 25) ──────────────────────────────────────────────────

/**
 * Lista variantes de um produto, já ordenadas por sort_order + size_label.
 * Retorna [] se o produto não tem variantes — caller deve cair pro price
 * de products.price (modelo legacy).
 */
export async function fetchProductVariants(
  productId: string,
  options?: { signal?: AbortSignal },
): Promise<ProductVariant[]> {
  if (!productId) return [];
  const sb = getSupabase();
  // Cast `from` por unknown porque product_variants ainda não está no
  // schema TS gerado (Wave 25 criou a tabela). Quando rodar `supabase
  // gen types`, dá pra remover.
  const sbAny = sb as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => {
            order: (col: string, opts: { ascending: boolean }) => PromiseLike<{
              data: Array<Record<string, unknown>> | null;
              error: { message: string } | null;
            }> & { abortSignal: (s: AbortSignal) => PromiseLike<{
              data: Array<Record<string, unknown>> | null;
              error: { message: string } | null;
            }> };
          };
        };
      };
    };
  };
  const q = sbAny
    .from('product_variants')
    .select('id, product_id, size_label, volume_ml, price, stock, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('size_label', { ascending: true });
  const { data, error } = await (options?.signal ? q.abortSignal(options.signal) : q);
  if (error) throw new NetworkError(error.message, error);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    product_id: r.product_id as string,
    size_label: r.size_label as string,
    volume_ml: (r.volume_ml as number | null) ?? null,
    price: Number(r.price ?? 0),
    stock: (r.stock as number | null) ?? null,
    sort_order: (r.sort_order as number | null) ?? 0,
  }));
}

// ─── variantes: mutations admin (Wave 25) ────────────────────────────────
// RLS no banco gateia tudo pra is_portal_admin() — sem token de admin, retorna
// erro. Cast manual em `sb.from` igual ao fetchProductVariants.

interface VariantAdminClient {
  from: (t: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => PromiseLike<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
    delete: () => {
      eq: (col: string, val: string) => PromiseLike<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
}

function variantClient(): VariantAdminClient {
  return getSupabase() as unknown as VariantAdminClient;
}

/** Cria uma variante. Retorna o id criado. */
export async function createVariant(
  productId: string,
  input: { size_label: string; volume_ml?: number | null; price: number; stock?: number | null; sort_order?: number },
): Promise<string> {
  const { data, error } = await variantClient()
    .from('product_variants')
    .insert({
      product_id: productId,
      size_label: input.size_label,
      volume_ml: input.volume_ml ?? null,
      price: input.price,
      stock: input.stock ?? null,
      sort_order: input.sort_order ?? 0,
    })
    .select('id')
    .single();
  if (error) throw new NetworkError(error.message, error);
  return data!.id;
}

/** Atualiza campos de uma variante. */
export async function updateVariant(
  id: string,
  patch: Partial<Pick<ProductVariant, 'size_label' | 'volume_ml' | 'price' | 'stock' | 'sort_order'>>,
): Promise<void> {
  const { error } = await variantClient()
    .from('product_variants')
    .update({ ...patch })
    .eq('id', id);
  if (error) throw new NetworkError(error.message, error);
}

/** Remove uma variante (CASCADE não aplica — só ela). */
export async function deleteVariant(id: string): Promise<void> {
  const { error } = await variantClient()
    .from('product_variants')
    .delete()
    .eq('id', id);
  if (error) throw new NetworkError(error.message, error);
}

/**
 * Gera as 3 variantes default (Quartinho 900ml, Galão 3.6L, Lata 18L) pra
 * um produto. Calcula preço por proporção partindo do products.price atual
 * (assumido como preço da lata 18L). Quartinho = ÷14, Galão = ÷4.
 * Idempotente: se já existe variante com o mesmo size_label, o INSERT
 * estoura UNIQUE — caller deve apagar antes ou checar antes.
 */
export async function generateDefaultVariants(
  productId: string,
  basePrice: number,
): Promise<void> {
  const lata = basePrice;
  const galao = +(basePrice / 4).toFixed(2);
  const quartinho = +(basePrice / 14).toFixed(2);
  const sb = variantClient() as unknown as {
    from: (t: string) => {
      insert: (rows: Array<Record<string, unknown>>) => PromiseLike<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
  const { error } = await sb.from('product_variants').insert([
    { product_id: productId, size_label: 'Quartinho 900ml', volume_ml: 900,   price: quartinho, sort_order: 1 },
    { product_id: productId, size_label: 'Galão 3.6L',     volume_ml: 3600,  price: galao,     sort_order: 2 },
    { product_id: productId, size_label: 'Lata 18L',       volume_ml: 18000, price: lata,      sort_order: 3 },
  ]);
  if (error) throw new NetworkError(error.message, error);
}

// ─── carrinho: persistência em profiles.cart ──────────────────────────────

/**
 * Lê o array de items do carrinho persistido em `profiles.cart` (jsonb).
 * Retorna [] se userId vazio ou se o perfil ainda não tem cart (coluna null).
 */
export async function fetchCart(userId: string): Promise<CartItem[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('cart')
    .eq('id', userId)
    .single();
  if (error) {
    throw new NetworkError(error.message, error);
  }
  const raw = (data as { cart?: unknown } | null)?.cart;
  if (!Array.isArray(raw)) return [];
  // Defensivo: filtra items sem id/price (corruption protection).
  return raw.filter(
    (it): it is CartItem =>
      !!it && typeof it === 'object' && typeof (it as CartItem).id === 'string'
  );
}

/**
 * Grava o array completo do carrinho em `profiles.cart`. Idempotente:
 * passar [] limpa o carrinho. RLS de UPDATE em profiles já restringe ao
 * dono (`auth.uid() = id`); .eq('id', userId) é defesa em profundidade.
 */
export async function saveCart(userId: string, items: CartItem[]): Promise<void> {
  if (!userId) throw new ValidationError('Faça login.');
  const sb = getSupabase();
  // jsonb column: CartItem[] não tem index-signature `[string]: Json`, então
  // precisa de cast `unknown` (mesmo padrão que `supabase gen types` força em
  // qualquer payload tipado). Runtime serialização é JSON.stringify normal.
  const { error } = await sb
    .from('profiles')
    .update({ cart: items as unknown as Json })
    .eq('id', userId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

// ─── pedido: cria order no Supabase + dispara checkout ────────────────────

/**
 * Cria uma order em status 'pending' a partir dos items do carrinho. Retorna
 * `{ orderId, total }`. Espelha a 1ª metade de `submitCartOrder()` do vanilla
 * (modules/mkt.js linhas 252-260) — a parte de chamar /api/mp-checkout-loja
 * fica no hook pra que `window.location.href` seja decisão da UI.
 *
 * `address` é opcional — schema atual (supabase_init.sql linha 425) não tem
 * coluna shipping_address. O param fica aceito pra quando essa coluna for
 * adicionada por migration; até lá, ignorado.
 */
export async function submitOrder(
  userId: string,
  items: CartItem[],
  _address?: Record<string, string> | null
): Promise<OrderSubmitResult> {
  if (!userId) throw new AuthorizationError('Faça login para finalizar a compra.');
  if (!items.length) throw new ValidationError('Carrinho vazio.');

  const total = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * (item.qty || 1),
    0
  );

  const sb = getSupabase();
  const { data, error } = await sb
    .from('orders')
    .insert({
      user_id: userId,
      items: items as unknown as Json, // jsonb column — mesmo padrão de saveCart
      total,
      status: 'pending',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new NetworkError(error.message, error);
  }
  const orderId = (data as { id?: string } | null)?.id;
  if (!orderId) {
    throw new NetworkError('Pedido criado sem ID (Supabase retornou vazio).');
  }
  return { orderId, total };
}

// ─── camisetas personalizadas ─────────────────────────────────────────────
// Catálogo hardcoded — não há tabela `shirts` no banco; o vanilla também
// hardcodava (modules/mkt.js: buyShirt sempre usa 'shirt-personalizada').
// Quando virar produto real (mais modelos, estampas), migrar pra tabela.

const SHIRTS: ReadonlyArray<Shirt> = [
  {
    id: 'shirt-personalizada',
    name: 'Camiseta Personalizada (com seu logo)',
    basePrice: 39.9,
    colors: ['#ffffff', '#1a1a2e', '#000000', '#e63946', '#8338ec', '#ffbe0b', '#3a86ff', '#06d6a0'],
    sizes: ['P', 'M', 'G', 'GG', 'XGG'],
    image: '/shirts/personalizada.webp',
  },
];

/**
 * Lista as camisetas disponíveis. Hoje é catálogo estático; retorno é
 * Promise<Shirt[]> pra preservar o contrato quando virar tabela.
 */
export async function fetchShirts(): Promise<Shirt[]> {
  return [...SHIRTS];
}

/**
 * "Compra" de camiseta = adiciona ao carrinho persistido. Espelha
 * `buyShirt()` do vanilla. Aplica desconto de 15% pra qty >= 5
 * (regra do vanilla, modules/mkt.js linha 714: `disc = qty >= 5 ? 0.85 : 1`).
 *
 * Não bate no Mercado Pago aqui — o cliente vai pro checkout do carrinho
 * (submitOrder) quando finalizar.
 */
export async function buyShirt(
  userId: string,
  customization: ShirtCustomization & { qty: number; shirtId?: string }
): Promise<CartItem[]> {
  if (!userId) throw new AuthorizationError('Faça login.');
  const qty = Math.max(1, parseInt(String(customization.qty), 10) || 1);
  const shirt = SHIRTS.find((s) => s.id === (customization.shirtId ?? 'shirt-personalizada'));
  if (!shirt) throw new ValidationError('Camiseta não encontrada.');

  const unit = qty >= 5 ? shirt.basePrice * 0.85 : shirt.basePrice;
  const current = await fetchCart(userId);
  const next: CartItem[] = [
    ...current,
    {
      id: shirt.id,
      name: `${shirt.name} (${customization.size}, ${customization.color})`,
      price: unit,
      qty,
      customization: {
        color: customization.color,
        size: customization.size,
        logoUrl: customization.logoUrl ?? null,
      },
    },
  ];
  await saveCart(userId, next);
  return next;
}

// ─── helpers de carrinho (puros, usados no hook) ──────────────────────────

/**
 * Adiciona um produto ao array de items. Se já existe, soma qty.
 * Função pura — devolve array novo, não muta o input. Usada pelo hook
 * em `onMutate` pra update otimista.
 */
export function addItemToCart(
  items: CartItem[],
  product: Pick<Product, 'id' | 'name' | 'price' | 'color_hex' | 'color_gradient' | 'volume'>,
  qty: number,
  // Wave 25: variante opcional. Quando preenchida, o id do CartItem é
  // composto pra que tamanhos diferentes do mesmo produto contem como
  // linhas separadas no carrinho.
  variant?: ProductVariant | null,
): CartItem[] {
  const safeQty = Math.max(1, parseInt(String(qty), 10) || 1);
  const cartId = variant ? `${product.id}:${variant.id}` : product.id;
  const existing = items.find((it) => it.id === cartId);
  if (existing) {
    return items.map((it) =>
      it.id === cartId ? { ...it, qty: (it.qty || 1) + safeQty } : it
    );
  }
  return [
    ...items,
    {
      id: cartId,
      name: product.name,
      price: variant ? variant.price : Number(product.price || 0),
      color_hex: product.color_hex ?? null,
      color_gradient: product.color_gradient ?? null,
      volume: variant?.size_label ?? product.volume ?? null,
      variant_id: variant?.id ?? null,
      variant_label: variant?.size_label ?? null,
      qty: safeQty,
    },
  ];
}

/**
 * Remove um item por id. Pura — devolve array novo sem o item.
 */
export function removeItemFromCart(items: CartItem[], id: string): CartItem[] {
  return items.filter((it) => it.id !== id);
}

/**
 * Muda qty de um item por id. Aplica delta (+1, -1) — se cair pra 0 ou
 * negativo, remove o item.
 */
export function changeItemQty(items: CartItem[], id: string, delta: number): CartItem[] {
  const next = items
    .map((it) => (it.id === id ? { ...it, qty: (it.qty || 1) + delta } : it))
    .filter((it) => (it.qty || 0) > 0);
  return next;
}

/**
 * Soma do total do carrinho em R$. Determinístico, usado no hook + checkout.
 */
export function cartTotal(items: CartItem[]): number {
  return items.reduce(
    (sum, item) => sum + Number(item.price || 0) * (item.qty || 1),
    0
  );
}

/**
 * Contagem total de unidades (não de itens distintos) — usado no badge.
 */
export function cartCount(items: CartItem[]): number {
  return items.reduce((s, c) => s + (c.qty || 1), 0);
}

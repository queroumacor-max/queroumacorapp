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
  // Suporta produtos sintéticos (camiseta personalizada com customização).
  customization?: ShirtCustomization | null;
}

// Categoria do menu lateral — espelha MKT_MENUS keys do vanilla.
export type MktCategory =
  | 'arte_urbana'
  | 'tintas'
  | 'texturas'
  | 'epoxi'
  | 'solventes'
  | 'adesivos'
  | 'ferramentas'
  | 'pintura'
  | 'eletrica'
  | 'equipamentos'
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
  { key: 'tintas', label: '🪣 Tintas', kw: ['tinta', 'esmalte', 'latex', 'látex', 'acrilic', 'acrílic', 'verniz', 'primer', 'seladora', 'fundo preparador', 'base coat', 'automotiva', 'suvinil', 'coral', 'sherwin'] },
  { key: 'texturas', label: '🧱 Texturas & Massas', kw: ['textura', 'grafiato', 'massa corrida', 'massa acrilic', 'massa pva', 'reboco', 'chapisco'] },
  { key: 'epoxi', label: '⚗️ Epóxi & Poliuretano', kw: ['epoxi', 'epóxi', 'poliuretano', ' pu '] },
  { key: 'solventes', label: '💧 Solventes & Aditivos', kw: ['thinner', 'solvente', 'diluente', 'aguarras', 'aguarrás', 'acelerador', 'secante', 'catalisador', 'endurecedor', 'aditivo', 'redutor', 'removedor'] },
  { key: 'adesivos', label: '🧪 Adesivos & Colas', kw: ['adesivo', 'cola', 'silicone', 'vedante', 'veda calha', 'rejunte', 'massa epox', 'durepoxi'] },
  { key: 'ferramentas', label: '🧰 Ferramentas', kw: ['alicate', 'tesoura', 'chave', 'martelo', 'abre trinca', 'espatula', 'espátula', 'desempenadeira', 'colher de pedreiro', 'trena', 'serra', 'furadeira', 'broca', 'lixadeira', 'estilete', 'formao', 'formão', 'grosa', 'lima', 'torques'] },
  { key: 'pintura', label: '🖌️ Acessórios de Pintura', kw: ['rolo', 'pincel', 'trincha', 'bandeja', 'fita crepe', 'fita', 'lixa', 'cabo extensor', 'extensor', 'gaiola', 'luva', 'mascara', 'máscara', 'respirador', 'oculos', 'óculos', 'lona', 'plastico', 'plástico', 'crepe'] },
  { key: 'eletrica', label: '🔌 Elétrica', kw: ['tomada', 'adaptador', 'extens', 'lampada', 'lâmpada', 'disjuntor', 'filtro de linha', 'benjamim', 'fio ', 'interruptor'] },
  { key: 'equipamentos', label: '🛠️ Equipamentos', kw: ['aerografo', 'aerógrafo', 'compressor', 'pistola', 'maquina', 'máquina', 'pulverizador', 'airless'] },
];

export const MKT_MENU_LABEL: Record<string, string> = {
  outros: '📦 Outros',
  ...Object.fromEntries(MKT_MENUS.map((m) => [m.key, m.label])),
};

/**
 * Classifica um produto numa categoria do menu pelo nome. Espelha o vanilla
 * incluindo as exceções (vonixx → outros, metalatex/novacor → tintas).
 */
export function mktClassify(p: Pick<Product, 'name'> | null | undefined): MktCategory {
  const n = ' ' + String((p && p.name) || '').toLowerCase() + ' ';
  if (n.includes('vonixx')) return 'outros';
  if (n.includes('metalatex') || n.includes('novacor')) return 'tintas';
  for (const m of MKT_MENUS) {
    if (m.kw.some((k) => n.includes(k))) return m.key;
  }
  return 'outros';
}

// Regex pra esconder bases tinturométricas (nomes "BASE VY", "BASE Z" etc.)
// que aparecem no catálogo mas não devem ser vendidas direto pro consumidor.
const MKT_HIDDEN = /\bbase\s+(vy|z|xy|w|ly|e|f)\b/i;

export function isMktHidden(p: Pick<Product, 'name'> | null | undefined): boolean {
  return MKT_HIDDEN.test((p && p.name) || '');
}

// ─── catálogo: fetch + filtro ─────────────────────────────────────────────

const PRODUCT_COLS =
  'id, name, code, category, volume, price, color_hex, color_gradient, stock, badge, description, line, rendimento, demaos, secagem, active, image_url, created_at';

/**
 * Busca produtos do catálogo. Aceita filtro opcional por categoria/busca.
 * Filtro server-side só na categoria via classify, mas como mktClassify
 * roda em JS (regex sobre o nome), filtra client-side depois do fetch —
 * mesmo trade-off do vanilla. Limit default = 1000 (catálogo ~300 itens).
 *
 * Esconde produtos com `_isMktHidden` (bases tinturométricas).
 */
export async function fetchProducts(filter: ProductFilter = {}): Promise<Product[]> {
  const limit = filter.limit ?? 1000;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('products')
    .select(PRODUCT_COLS)
    .order('name')
    .limit(limit);
  if (error) {
    throw new NetworkError(error.message, error);
  }
  let rows = ((data ?? []) as Product[]).filter((p) => !isMktHidden(p));

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
export async function fetchProduct(id: string): Promise<Product | null> {
  if (!id) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('products')
    .select(PRODUCT_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data as Product) ?? null;
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
  qty: number
): CartItem[] {
  const safeQty = Math.max(1, parseInt(String(qty), 10) || 1);
  const existing = items.find((it) => it.id === product.id);
  if (existing) {
    return items.map((it) =>
      it.id === product.id ? { ...it, qty: (it.qty || 1) + safeQty } : it
    );
  }
  return [
    ...items,
    {
      id: product.id,
      name: product.name,
      price: Number(product.price || 0),
      color_hex: product.color_hex ?? null,
      color_gradient: product.color_gradient ?? null,
      volume: product.volume ?? null,
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

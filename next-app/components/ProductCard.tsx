// ProductCard — card visual de um produto no catálogo da loja Cali Colors.
// Espelha o markup de `renderProductRow` em modules/mkt.js (linhas 424-450).
//
// Layout: ícone com cor/imagem (esquerda) + nome/código/preço (meio) +
// botão "+ Carrinho" (direita). Click no card todo abre detalhe; click no
// botão dispara onAdd direto (sem abrir detalhe).
//
// Componente puro: recebe `product` + handlers como props, não faz fetch
// nem mutation. Separação clara entre dados/visual.

'use client';

import { productBg, resolveColorHex, type Product } from '@/lib/services/mkt';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function categoryEmoji(cat: string | null | undefined): string {
  switch (cat) {
    case 'texturas':
      return '🖌️';
    case 'epoxi':
      return '⚗️';
    case 'acessorios':
      return '🎭';
    default:
      return '🪣';
  }
}

export interface ProductCardProps {
  product: Product;
  /** Click no botão "+ Carrinho". No fluxo novo, abre o detail sheet
   *  pra o user escolher quantidade (era um quick-add antes). */
  onAdd?: (product: Product) => void;
  /** Click no row inteiro (imagem/nome/preço). Abre o detail sheet. */
  onOpen?: (product: Product) => void;
  isAdding?: boolean;
}

export function ProductCard({ product, onAdd, onOpen, isAdding }: ProductCardProps) {
  const bg = productBg(product);
  const emoji = categoryEmoji(product.category);
  const hasColor = !!(product.color_gradient || resolveColorHex(product));
  const inactive = product.active === false;
  const price = BRL.format(Number(product.price || 0));
  const stock =
    product.stock != null && product.stock !== undefined
      ? ` · ${product.stock} un`
      : '';

  return (
    <article
      className={
        'flex items-center gap-3 p-3 bg-white rounded-xl border border-[color:var(--color-border)] hover:shadow-sm transition-shadow ' +
        (inactive ? 'opacity-50' : '')
      }
      data-product-id={product.id}
    >
      <button
        type="button"
        onClick={() => onOpen?.(product)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer"
        aria-label={`Ver detalhes de ${product.name}`}
      >
        <div
          className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden text-2xl"
          style={{
            background: product.image_url ? '#f5f5f5' : bg,
          }}
          aria-hidden="true"
        >
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : hasColor ? null : (
            emoji
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-[color:var(--color-ink)] truncate">
            {product.name}
            {inactive ? (
              <span className="ml-2 text-[10px] text-[color:var(--color-muted)]">
                (inativo)
              </span>
            ) : null}
          </div>
          <div className="text-xs text-[color:var(--color-muted)] truncate">
            {product.code ? `Cód ${product.code}` : ''}
            {stock}
          </div>
          <div className="text-sm font-bold text-[color:var(--color-ink)] mt-0.5">
            {price}
          </div>
        </div>
      </button>
      {onAdd ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(product);
          }}
          disabled={isAdding || inactive}
          className="px-3 py-2 text-xs font-semibold bg-[color:var(--color-ink)] text-white rounded-lg disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity flex-shrink-0"
          aria-label={`Adicionar ${product.name} ao carrinho`}
        >
          {isAdding ? '...' : '+ Carrinho'}
        </button>
      ) : null}
    </article>
  );
}

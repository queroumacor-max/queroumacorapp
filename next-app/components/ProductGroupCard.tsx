// ProductGroupCard — card unificado de uma família de produtos que só difere
// no tamanho (2026-06-16). A base da Cali Colors repete o mesmo produto em
// várias linhas com o tamanho embutido no nome ("... 18L", "... 3,6L"); aqui
// mostramos UM card com o nome-base + os tamanhos como chips. Tocar num chip
// abre o detalhe daquele tamanho.
//
// Sem preço: o catálogo virou fluxo de orçamento (cliente não vê valor).

'use client';

import {
  productBg,
  resolveColorHex,
  parseProductSize,
  type Product,
  type ProductGroup,
} from '@/lib/services/mkt';

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

export interface ProductGroupCardProps {
  group: ProductGroup;
  /** Abre o detalhe de um tamanho específico (chip) ou do representante. */
  onOpen: (product: Product) => void;
}

export function ProductGroupCard({ group, onOpen }: ProductGroupCardProps) {
  const rep = group.products[0];
  const bg = productBg(rep);
  const emoji = categoryEmoji(rep.category);
  const hasColor = !!(rep.color_gradient || resolveColorHex(rep));

  return (
    <article
      className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[color:var(--color-border)] hover:shadow-sm transition-shadow"
      data-product-group={group.key}
    >
      <button
        type="button"
        onClick={() => onOpen(rep)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer"
        aria-label={`Ver ${group.base}`}
      >
        <div
          className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden text-2xl"
          style={{ background: rep.image_url ? '#f5f5f5' : bg }}
          aria-hidden="true"
        >
          {rep.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={rep.image_url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : hasColor ? null : (
            emoji
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-semibold text-[color:var(--color-ink)] leading-tight"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {group.base}
          </div>
          <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
            {group.products.length} tamanhos
          </div>
        </div>
      </button>

      {/* Chips de tamanho — toca pra abrir o detalhe daquele tamanho. */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0 max-w-[46%]">
        <div className="flex flex-wrap gap-1 justify-end">
          {group.products.map((p) => {
            const { size } = parseProductSize(p.name);
            const outOfStock = p.stock != null && p.stock <= 0;
            return (
              <button
                key={p.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(p);
                }}
                className={
                  'px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ' +
                  (outOfStock
                    ? 'border-[color:var(--color-border)] text-[color:var(--color-muted)] line-through'
                    : 'border-[color:var(--color-ink)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-ink)] hover:text-white')
                }
                aria-label={`${group.base} ${size ?? ''}`.trim()}
              >
                {size ?? 'Ver'}
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}

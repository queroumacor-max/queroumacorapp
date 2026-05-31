// CartItem — card de um item no carrinho. Espelha o markup de
// `renderCartModal` em modules/mkt.js (linhas 209-228).
//
// Layout: ícone com cor (esquerda) + nome/volume + controles de qty (meio)
// + subtotal + botão de remover (direita).
//
// Componente puro: recebe `item` + handlers; não conhece TanStack/Supabase.

'use client';

import { productBg, type CartItem as CartItemModel } from '@/lib/services/mkt';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export interface CartItemProps {
  item: CartItemModel;
  onChangeQty: (delta: number) => void;
  onRemove: () => void;
  disabled?: boolean;
}

export function CartItem({ item, onChangeQty, onRemove, disabled }: CartItemProps) {
  const qty = item.qty || 1;
  const subtotal = Number(item.price || 0) * qty;
  const bg = productBg({
    id: item.id,
    name: item.name,
    price: item.price,
    color_hex: item.color_hex ?? null,
    color_gradient: item.color_gradient ?? null,
  });

  return (
    <div
      className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[color:var(--color-border)]"
      data-cart-item-id={item.id}
    >
      <div
        className="w-12 h-12 rounded-lg flex-shrink-0"
        style={{ background: bg }}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-[color:var(--color-ink)] truncate">
          {item.name}
        </div>
        {item.volume ? (
          <div className="text-xs text-[color:var(--color-muted)]">{item.volume}</div>
        ) : null}
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => onChangeQty(-1)}
            disabled={disabled}
            className="w-7 h-7 rounded-full bg-[color:var(--color-bg)] text-sm font-bold disabled:opacity-50"
            aria-label="Diminuir quantidade"
          >
            −
          </button>
          <span className="text-sm font-semibold min-w-[1.5rem] text-center">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => onChangeQty(1)}
            disabled={disabled}
            className="w-7 h-7 rounded-full bg-[color:var(--color-bg)] text-sm font-bold disabled:opacity-50"
            aria-label="Aumentar quantidade"
          >
            +
          </button>
        </div>
      </div>
      <div className="text-sm font-bold text-[color:var(--color-ink)] whitespace-nowrap">
        {BRL.format(subtotal)}
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="w-8 h-8 rounded-full text-[color:var(--color-muted)] hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
        aria-label={`Remover ${item.name}`}
      >
        ×
      </button>
    </div>
  );
}

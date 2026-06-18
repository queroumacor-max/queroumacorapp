// ProductDetail — client component que renderiza detalhe de um produto
// + qty picker + botão "Adicionar ao carrinho". Espelha o conteúdo do
// modal `openProductDetail` do vanilla, mas como página.
//
// Estados: loading → skeleton; not-found → empty state com link de volta;
// default → hero + descrição + specs + qty picker + CTA.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useProduct } from '@/lib/hooks/useProducts';
import { useCart } from '@/lib/hooks/useCart';
import { productBg, resolveColorHex } from '@/lib/services/mkt';

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

export function ProductDetail({ id }: { id: string }) {
  const { product, loading, error } = useProduct(id);
  const { add, isMutating } = useCart();
  const [qty, setQty] = useState(1);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-40 bg-[color:var(--color-border)] rounded-xl" />
        <div className="h-6 w-2/3 bg-[color:var(--color-border)] rounded" />
        <div className="h-4 w-1/3 bg-[color:var(--color-border)] rounded" />
        <div className="h-20 bg-[color:var(--color-border)] rounded" />
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📦
        </div>
        <h2 className="font-semibold mb-2">Produto não encontrado</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Esse produto pode ter sido removido ou está fora de estoque.
        </p>
        <Link
          href="/loja"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Voltar pra loja
        </Link>
      </div>
    );
  }

  const bg = productBg(product);
  const hasColor = !!(product.color_gradient || resolveColorHex(product));
  const emoji = categoryEmoji(product.category);
  const unit = Number(product.price || 0);
  const totalLabel = BRL.format(unit * qty);

  return (
    <div className="space-y-4">
      <Link
        href="/loja"
        className="inline-block text-xs font-semibold text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
      >
        ← Voltar
      </Link>

      <div
        className="h-48 rounded-2xl flex items-center justify-center overflow-hidden"
        style={{ background: product.image_url ? '#f5f5f5' : bg }}
      >
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : hasColor ? null : (
          <span className="text-7xl" aria-hidden="true">
            {emoji}
          </span>
        )}
      </div>

      <div>
        <h1
          className="text-2xl font-bold mb-1"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {product.name}
        </h1>
        <div className="text-xs text-[color:var(--color-muted)]">
          {product.code ? `Cód. ${product.code} · ` : ''}
          {product.line || ''}
        </div>
      </div>

      {product.description ? (
        <p className="text-sm text-[color:var(--color-ink)] leading-relaxed">
          {product.description}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {product.rendimento ? (
          <div className="text-center bg-[color:var(--color-bg)] rounded-xl p-3">
            <div className="text-[10px] uppercase text-[color:var(--color-muted)] mb-1">
              Rendimento
            </div>
            <div className="text-sm font-bold">{product.rendimento}</div>
          </div>
        ) : null}
        {product.demaos ? (
          <div className="text-center bg-[color:var(--color-bg)] rounded-xl p-3">
            <div className="text-[10px] uppercase text-[color:var(--color-muted)] mb-1">
              Demãos
            </div>
            <div className="text-sm font-bold">{product.demaos}</div>
          </div>
        ) : null}
        {product.secagem ? (
          <div className="text-center bg-[color:var(--color-bg)] rounded-xl p-3">
            <div className="text-[10px] uppercase text-[color:var(--color-muted)] mb-1">
              Secagem
            </div>
            <div className="text-sm font-bold">{product.secagem}</div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div
          className="text-2xl font-bold"
          style={{ color: 'var(--color-p1)', fontFamily: 'var(--font-display)' }}
        >
          {BRL.format(unit)}
        </div>
        <div className="flex items-center gap-3 bg-white border border-[color:var(--color-border)] rounded-full px-3 py-1">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="w-7 h-7 rounded-full bg-[color:var(--color-bg)] text-sm font-bold"
            aria-label="Diminuir quantidade"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-12 text-center bg-transparent text-sm font-semibold focus:outline-none"
            aria-label="Quantidade"
          />
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="w-7 h-7 rounded-full bg-[color:var(--color-bg)] text-sm font-bold"
            aria-label="Aumentar quantidade"
          >
            +
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => add({ product, qty })}
        disabled={isMutating || product.active === false}
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        + Selecionar item · {totalLabel}
      </button>

      <p className="text-xs text-[color:var(--color-muted)] text-center leading-relaxed">
        A loja Cali Colors entrará em contato para confirmar disponibilidade e
        valores do seu pedido.
      </p>

      <Link
        href="/loja/carrinho"
        className="block text-center text-xs font-semibold text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)]"
      >
        Ver minha lista →
      </Link>
    </div>
  );
}

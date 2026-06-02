// ProductsList — client component que renderiza a tela inteira da /loja:
// header dark sticky (logo "Loja Cali Colors" + carrinho + tabs + busca) +
// body light com grid de produtos. Espelha o `#screen-mkt` do vanilla
// (index.html linha 1505+ + styles.css `.mkt-*` linha 677+).
//
// Estados:
//   - loading → skeleton de cards
//   - error → mensagem inline
//   - vazio (após filtro) → empty state com CTA de limpar filtros
//   - default → tabs + busca + grid

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  MKT_MENU_LABEL,
  MKT_MENUS,
  type MktCategory,
} from '@/lib/services/mkt';
import {
  useProducts,
  type ProductCategoryFilter,
} from '@/lib/hooks/useProducts';
import { useCart } from '@/lib/hooks/useCart';
import { ProductCard } from '@/components/ProductCard';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[color:var(--color-border)] animate-pulse">
      <div className="w-16 h-16 rounded-lg bg-[color:var(--color-border)] flex-shrink-0" />
      <div className="flex-1">
        <div className="h-3 w-1/2 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded" />
      </div>
      <div className="h-9 w-24 bg-[color:var(--color-border)] rounded-lg" />
    </div>
  );
}

export function ProductsList() {
  const {
    all,
    filtered,
    byCategory,
    loading,
    error,
    category,
    setCategory,
    search,
    setSearch,
  } = useProducts();
  const { add, items: cartItems } = useCart();
  // Track *qual* produto está sendo adicionado pra que só o botão clicado
  // mostre "...", não todos. (Bug anterior: isMutating do useCart é global
  // — qualquer mutation pendente travava o grid inteiro.)
  const [addingId, setAddingId] = useState<string | null>(null);

  function handleAdd(prod: { id: string }) {
    if (addingId) return; // double-click guard
    setAddingId(prod.id);
    add({ product: prod as Parameters<typeof add>[0]['product'], qty: 1 });
    // Optimistic — useCart já faz optimistic update via TanStack onMutate.
    // Damos uma janela de 400ms só pra o feedback visual ficar perceptível.
    setTimeout(() => setAddingId(null), 400);
  }

  const cartCount = cartItems.reduce((acc, it) => acc + (it.qty || 0), 0);

  const tabs = useMemo<Array<{ value: ProductCategoryFilter; label: string; count: number }>>(() => {
    const out: Array<{ value: ProductCategoryFilter; label: string; count: number }> = [
      { value: 'todos', label: '📦 Todos', count: all.length },
    ];
    for (const m of MKT_MENUS) {
      const items = byCategory[m.key] ?? [];
      if (items.length > 0) {
        out.push({ value: m.key, label: m.label, count: items.length });
      }
    }
    const outros = byCategory['outros'] ?? [];
    if (outros.length > 0) {
      out.push({ value: 'outros' as MktCategory, label: MKT_MENU_LABEL.outros, count: outros.length });
    }
    return out;
  }, [all, byCategory]);

  return (
    <>
      {/* mkt-header dark — sticky com logo + cart + tabs + busca */}
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'var(--color-ink)',
          padding: '14px 16px 0',
        }}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div
            className="font-extrabold text-white"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
            }}
          >
            Loja <span style={{ color: 'var(--color-p1)' }}>Cali Colors</span>
          </div>
          <Link
            href="/loja/carrinho"
            aria-label="Carrinho"
            className="relative flex items-center justify-center"
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(255,255,255,.1)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              stroke="#fff"
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            {cartCount > 0 ? (
              <span
                className="absolute font-bold text-white flex items-center justify-center"
                style={{
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  background: 'var(--color-p1)',
                  fontSize: 10,
                  padding: '0 5px',
                }}
              >
                {cartCount}
              </span>
            ) : null}
          </Link>
        </div>

        {/* Dropdown de categoria (substitui as tabs horizontais scrolláveis).
            Vanilla usa tabs mas em telas estreitas isso vira scroll horizontal
            que estoura o layout. Select nativo é mais compacto e acessível. */}
        <div className="relative" style={{ paddingBottom: 14 }}>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as ProductCategoryFilter)}
            aria-label="Filtrar por categoria"
            className="w-full text-white outline-none appearance-none"
            style={{
              padding: '12px 40px 12px 16px',
              borderRadius: 26,
              border: '1.5px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.07)',
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            {tabs.map((tab) => (
              <option
                key={tab.value}
                value={tab.value}
                style={{ color: 'var(--color-ink)' }}
              >
                {tab.label} ({tab.count})
              </option>
            ))}
          </select>
          {/* Chevron decorativo (select nativo não estiliza o arrow padrão). */}
          <span
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{ right: 14, top: 12 }}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="var(--color-p1)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </div>

        {/* Busca — input estilo vanilla (dark com ícone laranja absoluto) */}
        <div className="relative" role="search" style={{ paddingBottom: 14 }}>
          <span
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{ left: 14, top: '50%', transform: 'translateY(calc(-50% - 7px))' }}
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="var(--color-p1)"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produto ou código..."
            className="w-full text-white outline-none"
            aria-label="Buscar produtos"
            style={{
              padding: '12px 16px 12px 42px',
              borderRadius: 26,
              border: '1.5px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.07)',
              fontSize: 14,
            }}
          />
        </div>
      </header>

      {/* mkt-body — cards */}
      <div className="px-3 pt-3">
        {loading ? (
          <div className="space-y-3" aria-label="Carregando produtos">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
            <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
            <p className="text-sm text-[color:var(--color-muted)]">
              Não foi possível carregar os produtos. Tente de novo em instantes.
            </p>
          </div>
        ) : all.length === 0 ? (
          <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
            <div className="text-5xl mb-3" aria-hidden="true">📦</div>
            <h2 className="font-semibold mb-2">Sem produtos cadastrados</h2>
            <p className="text-sm text-[color:var(--color-muted)]">
              O catálogo ainda está vazio. Volte em breve.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
            <p className="text-sm text-[color:var(--color-muted)] mb-3">
              Nenhum produto bate com o filtro atual.
            </p>
            <button
              type="button"
              onClick={() => {
                setCategory('todos');
                setSearch('');
              }}
              className="text-xs font-semibold text-[color:var(--color-p1)]"
            >
              Limpar filtros
            </button>
          </div>
        ) : (
          <ul className="space-y-2 pb-4">
            {filtered.map((p) => (
              <li key={p.id}>
                <ProductCard
                  product={p}
                  onAdd={(prod) => handleAdd(prod)}
                  isAdding={addingId === p.id}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

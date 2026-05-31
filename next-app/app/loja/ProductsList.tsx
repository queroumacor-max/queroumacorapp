// ProductsList — client component que renderiza filtros + grid do catálogo.
// Substitui o trio vanilla `renderMktUI` + `mktTab` + `mktSearch` por
// state React (useProducts hook).
//
// Estados:
//   - loading → skeleton de cards
//   - error → mensagem inline
//   - vazio (após filtro) → empty state com CTA de limpar filtros
//   - default → tabs + busca + grid

'use client';

import { useMemo } from 'react';
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
  const { add, isMutating } = useCart();

  // Tabs visíveis: todos + categorias com pelo menos 1 produto. Mesma
  // lógica do `renderMktUI` vanilla (orderedKeys).
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

  if (loading) {
    return (
      <div className="space-y-3" aria-label="Carregando produtos">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar os produtos. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📦
        </div>
        <h2 className="font-semibold mb-2">Sem produtos cadastrados</h2>
        <p className="text-sm text-[color:var(--color-muted)]">
          O catálogo ainda está vazio. Volte em breve.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Busca */}
      <div className="mb-3">
        <input
          type="search"
          placeholder="Buscar por nome ou código…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-2 bg-white border border-[color:var(--color-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
          aria-label="Buscar produtos"
        />
      </div>

      {/* Tabs de categoria */}
      <div
        className="flex gap-2 overflow-x-auto mb-4 pb-1"
        role="tablist"
        aria-label="Filtrar por categoria"
      >
        {tabs.map((tab) => {
          const active = tab.value === category;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(tab.value)}
              className={
                'px-3 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ' +
                (active
                  ? 'bg-[color:var(--color-ink)] text-white'
                  : 'bg-white border border-[color:var(--color-border)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-bg)]')
              }
            >
              {tab.label} ({tab.count})
            </button>
          );
        })}
      </div>

      {/* Resultado */}
      {filtered.length === 0 ? (
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
        <ul className="space-y-2">
          {filtered.map((p) => (
            <li key={p.id}>
              <ProductCard
                product={p}
                onAdd={(prod) => add({ product: prod, qty: 1 })}
                isAdding={isMutating}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

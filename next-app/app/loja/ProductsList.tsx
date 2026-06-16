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
import { useMemo, useState, useEffect, useRef } from 'react';
import { ProductDetailSheet } from './ProductDetailSheet';
import type { Product, ProductVariant } from '@/lib/services/mkt';
import {
  MKT_MENU_LABEL,
  MKT_MENUS,
  autoTierClassify,
  paintTierClassify,
  type AutoTier,
  type MktCategory,
  type PaintTier,
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

// Threshold de drill-down: só ativa o agrupamento por linha quando a
// categoria tem pelo menos N produtos distribuídos em M+ linhas. Senão
// fica como lista flat (não tem ganho UX em listas curtas).
// MIN_LINES=2 porque a base do queroumacor tem hoje 2 linhas grandes
// (Sherwin-Williams 2719 + Linha Premium 1452), e abrir os 4k SKUs flat
// é exatamente o problema reportado.
const DRILL_MIN_PRODUCTS = 30;
const DRILL_MIN_LINES = 2;

// Renderização em janela: começa mostrando RENDER_PAGE cards e cresce o
// mesmo tanto quando o sentinel entra em vista. Antes a lista flat ("Todos"
// = 4171 itens, ou uma linha grande como Sherwin = 2719) montava TODOS os
// <ProductCard> de uma vez — milhares de nós no DOM = trava no scroll e na
// abertura. Com a janela, só ~40 nós existem inicialmente.
const RENDER_PAGE = 40;

function normalizeLineKey(line: string | null | undefined): string {
  return (line ?? '').trim();
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
  // Produto aberto no detail-sheet. Quando o user clica num row, abre o
  // sheet com qty picker em vez de adicionar 1 unidade direto.
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  // Drill-down: linha selecionada dentro da categoria atual. null = mostra
  // grid de linhas. Reseta quando categoria muda OU quando busca começa.
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  // Sub-filtro de qualidade dentro de Tintas Imobiliárias (null = todas).
  const [paintTier, setPaintTier] = useState<PaintTier | null>(null);
  // Sub-filtro de tipo dentro de Tintas Automotivas (null = todas).
  const [autoTier, setAutoTier] = useState<AutoTier | null>(null);

  // Agrupa os products do filter atual por `line` (pula campo vazio: "Outros").
  // Computa antes do early-return pra useMemo manter ordem estável de hooks.
  const lineGroups = useMemo(() => {
    const groups = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = normalizeLineKey(p.line) || 'Outros';
      const arr = groups.get(key);
      if (arr) arr.push(p);
      else groups.set(key, [p]);
    }
    // Ordena alfabético pra estabilidade — "Outros" sempre por último.
    return Array.from(groups.entries()).sort((a, b) => {
      if (a[0] === 'Outros') return 1;
      if (b[0] === 'Outros') return -1;
      return a[0].localeCompare(b[0], 'pt-BR');
    });
  }, [filtered]);

  // Heurística: drill-down só vale quando tem >= DRILL_MIN_LINES linhas
  // E >= DRILL_MIN_PRODUCTS produtos. Em busca aberta, sempre flat.
  const drillEligible =
    !search.trim() &&
    lineGroups.length >= DRILL_MIN_LINES &&
    filtered.length >= DRILL_MIN_PRODUCTS;
  const showLineGrid = drillEligible && selectedLine === null;
  const visibleProducts = useMemo(() => {
    let rows =
      !drillEligible || selectedLine === null
        ? filtered
        : filtered.filter((p) => (normalizeLineKey(p.line) || 'Outros') === selectedLine);
    if (category === 'tintas' && paintTier !== null) {
      rows = rows.filter((p) => paintTierClassify(p) === paintTier);
    }
    if (category === 'tintas_auto' && autoTier !== null) {
      rows = rows.filter((p) => autoTierClassify(p) === autoTier);
    }
    return rows;
  }, [drillEligible, selectedLine, filtered, category, paintTier, autoTier]);

  // Janela de renderização — quantos produtos da lista atual estão montados.
  const [renderLimit, setRenderLimit] = useState(RENDER_PAGE);
  const loadMoreRef = useRef<HTMLLIElement | null>(null);

  // Sempre que a lista visível MUDA (filtro/categoria/linha/tier/busca), volta
  // a janela pro começo — senão um filtro novo herdaria um limit inflado.
  useEffect(() => {
    setRenderLimit(RENDER_PAGE);
  }, [category, selectedLine, paintTier, autoTier, search]);

  const renderedProducts = useMemo(
    () => visibleProducts.slice(0, renderLimit),
    [visibleProducts, renderLimit],
  );
  const hasMoreToRender = renderLimit < visibleProducts.length;

  // IntersectionObserver no sentinel — cresce a janela quando o user chega
  // perto do fim. rootMargin 600px pra crescer antes de bater no fim (sem
  // flash de "buraco"). Mesmo padrão do feed.
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting && hasMoreToRender) {
            setRenderLimit((n) => n + RENDER_PAGE);
          }
        }
      },
      { rootMargin: '600px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMoreToRender]);

  // Reseta a linha selecionada quando o user troca de categoria ou começa
  // a buscar — drill-down não faz sentido fora do escopo da categoria atual.
  useEffect(() => {
    setSelectedLine(null);
  }, [category, search]);

  // Reseta tiers ao trocar de categoria.
  useEffect(() => {
    if (category !== 'tintas') setPaintTier(null);
    if (category !== 'tintas_auto') setAutoTier(null);
  }, [category]);

  function handleAddFromSheet(
    prod: Product,
    qty: number,
    variant?: ProductVariant | null,
  ) {
    add({ product: prod, qty, variant: variant ?? null });
  }

  const cartCount = cartItems.reduce((acc, it) => acc + (it.qty || 0), 0);

  const tabs = useMemo<Array<{ value: ProductCategoryFilter; label: string; count: number }>>(() => {
    const out: Array<{ value: ProductCategoryFilter; label: string; count: number }> = [
      { value: 'todos', label: '📦 Todos', count: all.length },
    ];
    for (const m of MKT_MENUS) {
      const items = byCategory[m.key] ?? [];
      // EPI aparece sempre (mesmo vazio) pois é categoria nova sendo populada
      if (items.length > 0 || m.key === 'epi') {
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
          background: 'var(--color-ink-fixed)',
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

        {/* Sub-filtro de tier — só aparece quando categoria = Tintas e sem busca ativa */}
        {category === 'tintas' && !search.trim() ? (
          <div
            style={{
              display: 'flex',
              gap: 8,
              paddingBottom: 12,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {([null, 'primer', 'economica', 'standard', 'premium', 'complementos'] as const).map((tier) => {
              const active = paintTier === tier;
              const labels: Record<string, string> = {
                primer: 'Fundos & Primer',
                economica: 'Econômica',
                standard: 'Standard',
                premium: 'Premium',
                complementos: 'Complementos',
              };
              const label = tier === null ? 'Todas' : labels[tier]!;
              return (
                <button
                  key={tier ?? 'todas'}
                  type="button"
                  onClick={() => setPaintTier(tier)}
                  className="font-semibold"
                  style={{
                    flexShrink: 0,
                    padding: '8px 14px',
                    borderRadius: 10,
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    background: active ? 'var(--color-p1)' : 'rgba(255,255,255,.07)',
                    color: active ? '#fff' : 'rgba(255,255,255,.6)',
                    border: active
                      ? '1.5px solid var(--color-p1)'
                      : '1.5px solid rgba(255,255,255,.14)',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Sub-filtro de tipo — só aparece quando categoria = Tintas Automotivas e sem busca */}
        {category === 'tintas_auto' && !search.trim() ? (
          <div
            style={{
              display: 'flex',
              gap: 8,
              paddingBottom: 12,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {([null, 'primer', 'tinta', 'verniz', 'complementos', 'solventes'] as const).map((tier) => {
              const active = autoTier === tier;
              const labels: Record<string, string> = {
                primer: 'Primer',
                tinta: 'Tinta',
                verniz: 'Verniz',
                complementos: 'Complementos',
                solventes: 'Solventes',
              };
              const label = tier === null ? 'Todas' : labels[tier]!;
              return (
                <button
                  key={tier ?? 'todas'}
                  type="button"
                  onClick={() => setAutoTier(tier)}
                  className="font-semibold"
                  style={{
                    flexShrink: 0,
                    padding: '8px 14px',
                    borderRadius: 10,
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                    background: active ? 'var(--color-p1)' : 'rgba(255,255,255,.07)',
                    color: active ? '#fff' : 'rgba(255,255,255,.6)',
                    border: active
                      ? '1.5px solid var(--color-p1)'
                      : '1.5px solid rgba(255,255,255,.14)',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}

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
        ) : showLineGrid ? (
          // Drill-down nível 1: mostra um card por LINHA dentro da categoria.
          // Click numa linha entra no nível 2 (lista de produtos da linha).
          <ul className="space-y-2 pb-4" aria-label="Linhas disponíveis">
            {lineGroups.map(([line, items]) => (
              <li key={line}>
                <button
                  type="button"
                  onClick={() => setSelectedLine(line)}
                  className="w-full flex items-center justify-between p-4 bg-white rounded-xl border border-[color:var(--color-border)] hover:shadow-sm transition-shadow text-left"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[color:var(--color-ink)]">
                      {line}
                    </div>
                    <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                      {items.length} {items.length === 1 ? 'opção' : 'opções'}
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="var(--color-muted)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            {/* Breadcrumb "← Voltar" só aparece quando o user entrou numa
                linha específica (nível 2 do drill). */}
            {drillEligible && selectedLine !== null ? (
              <button
                type="button"
                onClick={() => setSelectedLine(null)}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--color-p1)] mb-3"
                aria-label="Voltar pra lista de linhas"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                {selectedLine} ({visibleProducts.length})
              </button>
            ) : null}
            <ul className="space-y-2 pb-4">
              {renderedProducts.map((p) => (
                <li key={p.id}>
                  <ProductCard
                    product={p}
                    // Click no row OU no "+ Carrinho" abre o detail sheet
                    // pra escolher quantidade (vanilla openProductDetail).
                    onAdd={(prod) => setDetailProduct(prod)}
                    onOpen={(prod) => setDetailProduct(prod)}
                  />
                </li>
              ))}
              {/* Sentinel da janela de renderização — cresce a lista ao rolar. */}
              {hasMoreToRender ? (
                <li ref={loadMoreRef} aria-hidden="true" className="h-8" />
              ) : null}
            </ul>
          </>
        )}
      </div>

      <ProductDetailSheet
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        onAdd={handleAddFromSheet}
      />
    </>
  );
}

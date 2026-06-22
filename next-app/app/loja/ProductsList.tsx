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
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
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

// Paginação: quantos produtos por página.
const PAGE_SIZE = 40;

function normalizeLineKey(line: string | null | undefined): string {
  return (line ?? '').trim();
}

// Tiles dos sub-filtros (tier) de Tintas Imobiliárias — emoji + rótulo.
// Mesmos valores dos chips, agora também como grid de ícones dentro da
// categoria.
const PAINT_TIER_TILES: ReadonlyArray<{ tier: PaintTier; emoji: string; label: string }> = [
  { tier: 'primer', emoji: '🛡️', label: 'Fundos & Primer' },
  { tier: 'economica', emoji: '💰', label: 'Econômica' },
  { tier: 'standard', emoji: '🪣', label: 'Standard' },
  { tier: 'premium', emoji: '⭐', label: 'Premium' },
  { tier: 'complementos', emoji: '➕', label: 'Complementos' },
];

// Tiles dos sub-filtros (tipo) de Tintas Automotivas.
const AUTO_TIER_TILES: ReadonlyArray<{ tier: AutoTier; emoji: string; label: string }> = [
  { tier: 'primer', emoji: '🛡️', label: 'Primer' },
  { tier: 'tinta', emoji: '🚗', label: 'Tinta' },
  { tier: 'verniz', emoji: '✨', label: 'Verniz' },
  { tier: 'complementos', emoji: '➕', label: 'Complementos' },
  { tier: 'solventes', emoji: '💧', label: 'Solventes' },
];

function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  // Gera array de números/elipses: ex. [1, '…', 4, 5, 6, '…', 10]
  function pages(): (number | '…')[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (page <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (page >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', page - 1, page, page + 1, '…', total];
  }
  return (
    <div
      className="flex items-center justify-center gap-1 py-5"
      role="navigation"
      aria-label="Paginação"
    >
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label="Página anterior"
        style={{
          width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--color-border)',
          background: 'white', cursor: page <= 1 ? 'not-allowed' : 'pointer',
          opacity: page <= 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      {pages().map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} style={{ width: 28, textAlign: 'center', fontSize: 13, color: 'var(--color-muted)' }}>…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPage(p as number)}
            aria-label={`Página ${p}`}
            aria-current={p === page ? 'page' : undefined}
            style={{
              width: 36, height: 36, borderRadius: 10, fontSize: 13, fontWeight: p === page ? 700 : 500,
              border: `1.5px solid ${p === page ? 'var(--color-p1)' : 'var(--color-border)'}`,
              background: p === page ? 'var(--color-p1)' : 'white',
              color: p === page ? '#fff' : 'var(--color-ink)',
              cursor: 'pointer',
            }}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= total}
        aria-label="Próxima página"
        style={{
          width: 36, height: 36, borderRadius: 10, border: '1.5px solid var(--color-border)',
          background: 'white', cursor: page >= total ? 'not-allowed' : 'pointer',
          opacity: page >= total ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
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
  // Tela inicial da loja: grid de ícones de categoria (true) vs lista de
  // produtos de uma categoria (false). Clicar num ícone entra na categoria;
  // o botão "Categorias" volta pro grid. Busca ativa sempre mostra produtos.
  const [showGrid, setShowGrid] = useState(true);
  // Dropdown de categoria — custom (botão + lista) em vez de <select> nativo
  // (BUG43): o select nativo abre um overlay do SO que não respondia/abria de
  // forma confiável em alguns contextos (PWA/iOS/testes automatizados).
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const catMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!catMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (catMenuRef.current && !catMenuRef.current.contains(e.target as Node)) {
        setCatMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [catMenuOpen]);

  // Entra numa categoria a partir do grid de ícones.
  function openCategory(value: ProductCategoryFilter) {
    setCategory(value);
    setShowGrid(false);
    setSelectedLine(null);
    setPaintTier(null);
    setAutoTier(null);
  }
  // Volta pro grid de categorias (tela inicial).
  function backToGrid() {
    setShowGrid(true);
    setCategory('todos');
    setSelectedLine(null);
    setPaintTier(null);
    setAutoTier(null);
    setSearch('');
  }

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

  // Paginação clássica — página atual (1-indexed).
  const [page, setPage] = useState(1);
  const listTopRef = useRef<HTMLDivElement | null>(null);

  // Volta pra página 1 sempre que o filtro muda.
  useEffect(() => {
    setPage(1);
  }, [category, selectedLine, paintTier, autoTier, search]);

  const totalPages = Math.max(1, Math.ceil(visibleProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pagedProducts = useMemo(
    () => visibleProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [visibleProducts, safePage],
  );

  // Scroll pro topo da lista ao mudar de página.
  const goToPage = useCallback((p: number) => {
    setPage(p);
    listTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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
      // EPI e madeiras_metais aparecem sempre (categorias novas sendo populadas)
      if (items.length > 0 || m.key === 'epi' || m.key === 'madeiras_metais') {
        out.push({ value: m.key, label: m.label, count: items.length });
      }
    }
    const outros = byCategory['outros'] ?? [];
    if (outros.length > 0) {
      out.push({ value: 'outros' as MktCategory, label: MKT_MENU_LABEL.outros, count: outros.length });
    }
    return out;
  }, [all, byCategory]);

  // Tela inicial = grid de ícones. Busca ativa força a lista de produtos.
  const gridVisible = showGrid && !search.trim();

  // Rótulo da categoria atual pro botão do dropdown custom (BUG43).
  const currentCatLabel = useMemo(() => {
    const t = tabs.find((x) => x.value === category);
    return t ? `${t.label} (${t.count})` : 'Categoria';
  }, [tabs, category]);

  // Contagem por tier pra mostrar no tile (e esconder tier vazio).
  const paintTierCounts = useMemo(() => {
    const m: Record<PaintTier, number> = {
      primer: 0, economica: 0, standard: 0, premium: 0, complementos: 0,
    };
    for (const p of byCategory['tintas'] ?? []) m[paintTierClassify(p)]++;
    return m;
  }, [byCategory]);
  const autoTierCounts = useMemo(() => {
    const m: Record<AutoTier, number> = {
      primer: 0, tinta: 0, verniz: 0, complementos: 0, solventes: 0,
    };
    for (const p of byCategory['tintas_auto'] ?? []) m[autoTierClassify(p)]++;
    return m;
  }, [byCategory]);

  // Dentro de Tintas / Tintas Automotivas, sem tier escolhido e sem busca,
  // mostramos um grid de ícones dos tiers (em vez da lista direto).
  const paintTierGridVisible =
    !gridVisible && category === 'tintas' && paintTier === null && !search.trim()
    && (byCategory['tintas']?.length ?? 0) > 0;
  const autoTierGridVisible =
    !gridVisible && category === 'tintas_auto' && autoTier === null && !search.trim()
    && (byCategory['tintas_auto']?.length ?? 0) > 0;

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
            aria-label="Minha lista de pedido"
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

        {/* Dropdown de categoria (custom) — escondido na tela inicial (grid de
            ícones); aparece ao entrar numa categoria pra trocar rápido. */}
        {!gridVisible ? (
        <div className="relative" style={{ paddingBottom: 14 }} ref={catMenuRef}>
          <button
            type="button"
            onClick={() => setCatMenuOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={catMenuOpen}
            aria-label="Filtrar por categoria"
            className="w-full text-white outline-none flex items-center justify-between gap-2"
            style={{
              padding: '12px 16px',
              borderRadius: 26,
              border: '1.5px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.07)',
              fontSize: 14,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            <span className="truncate">{currentCatLabel}</span>
            <span
              aria-hidden="true"
              className="flex-shrink-0"
              style={{ transform: catMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
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
          </button>
          {catMenuOpen ? (
            <ul
              role="listbox"
              aria-label="Categorias"
              className="absolute left-0 right-0 z-30 overflow-y-auto bg-white shadow-xl"
              style={{
                top: 'calc(100% - 6px)',
                maxHeight: '60vh',
                borderRadius: 16,
                border: '1px solid var(--color-border)',
                padding: 6,
              }}
            >
              {tabs.map((tab) => {
                const active = tab.value === category;
                return (
                  <li key={tab.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        setCategory(tab.value);
                        setCatMenuOpen(false);
                      }}
                      className="w-full text-left rounded-xl"
                      style={{
                        padding: '11px 12px',
                        fontSize: 14,
                        fontWeight: active ? 700 : 500,
                        color: active ? 'var(--color-p1)' : 'var(--color-ink)',
                        background: active ? 'rgba(255,107,53,.08)' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {tab.label} ({tab.count})
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
        ) : null}

        {/* Sub-filtro de tier (chips) — só depois de escolher um tier no grid,
            pra trocar rápido. No grid de tiers ficam escondidos. */}
        {category === 'tintas' && !search.trim() && paintTier !== null ? (
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

        {/* Sub-filtro de tipo (chips) — só depois de escolher um tipo no grid. */}
        {category === 'tintas_auto' && !search.trim() && autoTier !== null ? (
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
      <div className="px-3 pt-3" ref={listTopRef}>
        {/* Voltar pro grid de categorias (só dentro de uma categoria/busca). */}
        {!gridVisible && !loading && !error && all.length > 0 ? (
          <button
            type="button"
            onClick={backToGrid}
            className="inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--color-p1)] mb-3"
            aria-label="Voltar pras categorias"
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
            Categorias
          </button>
        ) : null}
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
        ) : gridVisible ? (
          // Tela inicial: grid de ícones de categoria preenchendo a tela.
          // Click num ícone entra na categoria (openCategory).
          <ul className="grid grid-cols-2 gap-3 pb-4" aria-label="Categorias da loja">
            {tabs.map((tab) => {
              const sp = tab.label.indexOf(' ');
              const emoji = sp > 0 ? tab.label.slice(0, sp) : '📦';
              const text = sp > 0 ? tab.label.slice(sp + 1) : tab.label;
              return (
                <li key={tab.value}>
                  <button
                    type="button"
                    onClick={() => openCategory(tab.value)}
                    className="w-full h-full flex flex-col items-center justify-center text-center gap-2 bg-white rounded-2xl border border-[color:var(--color-border)] hover:shadow-md transition-shadow"
                    style={{ padding: '22px 12px', minHeight: 128 }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 38, lineHeight: 1 }}>
                      {emoji}
                    </span>
                    <span className="text-sm font-semibold text-[color:var(--color-ink)] leading-tight">
                      {text}
                    </span>
                    <span className="text-xs text-[color:var(--color-muted)]">
                      {tab.count} {tab.count === 1 ? 'item' : 'itens'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : paintTierGridVisible || autoTierGridVisible ? (
          // Dentro de Tintas: grid de ícones dos tiers (Fundos, Econômica, …).
          // Click num tile filtra os produtos daquele tier.
          <ul className="grid grid-cols-2 gap-3 pb-4" aria-label="Tipos de tinta">
            {(paintTierGridVisible ? PAINT_TIER_TILES : AUTO_TIER_TILES)
              .filter((t) =>
                ((paintTierGridVisible ? paintTierCounts : autoTierCounts) as Record<string, number>)[
                  t.tier
                ] > 0,
              )
              .map((t) => {
                const count = (
                  (paintTierGridVisible ? paintTierCounts : autoTierCounts) as Record<string, number>
                )[t.tier];
                return (
                  <li key={t.tier}>
                    <button
                      type="button"
                      onClick={() =>
                        paintTierGridVisible
                          ? setPaintTier(t.tier as PaintTier)
                          : setAutoTier(t.tier as AutoTier)
                      }
                      className="w-full h-full flex flex-col items-center justify-center text-center gap-2 bg-white rounded-2xl border border-[color:var(--color-border)] hover:shadow-md transition-shadow"
                      style={{ padding: '22px 12px', minHeight: 128 }}
                    >
                      <span aria-hidden="true" style={{ fontSize: 38, lineHeight: 1 }}>
                        {t.emoji}
                      </span>
                      <span className="text-sm font-semibold text-[color:var(--color-ink)] leading-tight">
                        {t.label}
                      </span>
                      <span className="text-xs text-[color:var(--color-muted)]">
                        {count} {count === 1 ? 'item' : 'itens'}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
            <p className="text-sm text-[color:var(--color-muted)] mb-3">
              Nenhum produto bate com o filtro atual.
            </p>
            <button
              type="button"
              onClick={backToGrid}
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
            <ul className="space-y-2">
              {pagedProducts.map((p) => (
                <li key={p.id}>
                  <ProductCard
                    product={p}
                    onAdd={(prod) => setDetailProduct(prod)}
                    onOpen={(prod) => setDetailProduct(prod)}
                  />
                </li>
              ))}
            </ul>
            {/* Paginação */}
            {totalPages > 1 ? (
              <Pagination page={safePage} total={totalPages} onPage={goToPage} />
            ) : null}
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

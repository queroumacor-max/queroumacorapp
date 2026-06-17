// ProductDetailSheet — bottom-sheet de detalhe do produto da loja.
// Espelha o `openProductDetail` do vanilla (modules/mkt.js linha 496+):
//   - hero com imagem ou cor sólida 140px;
//   - nome em Syne 20px + "Cód. NNN · Linha Premium";
//   - descrição (opcional);
//   - 3 info-cards: Rendimento / Demãos / Secagem (cream bg);
//   - preço grande laranja + qty picker (- N +);
//   - botão "+ Adicionar ao Carrinho · R$NN,NN" full-width laranja.
'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/lib/toast';
import {
  fetchCompanionsForProduct,
  fetchLequeColors,
  mktClassify,
  productBg,
  resolveColorHex,
  type GroupVariant,
  type LequeColor,
  type MktCategory,
  type Product,
  type ProductVariant,
} from '@/lib/services/mkt';
import { useProductVariants } from '@/lib/hooks/useProductVariants';
import { useAuthGate } from '@/components/AuthGate';
import { WallARView } from './WallARView';

// Categorias onde "Ver na parede" faz sentido — tinta/textura/epoxi/arte.
// Resto (adaptador, pincel, rolo, eletrica) não tem o que pintar.
const AR_PAINTABLE: ReadonlySet<MktCategory> = new Set([
  'tintas',
  'texturas',
  'epoxi',
  'arte_urbana',
]);

// Extrai o nome legível da cor a partir do nome do produto do leque.
// Formato atual do banco: "S-A 001 - Pérola Aveludada" → "Pérola Aveludada".
// Formato legado: "COR SUVINIL S-A-150 AMARELO CANÁRIO" → "AMARELO CANÁRIO".
function extractColorLabel(
  c: LequeColor,
  brand: 'suvinil' | 'coral' | 'sherwin' | 'outros',
): string {
  const prefixMap: Record<string, string> = {
    suvinil: 'COR SUVINIL ',
    coral: 'COR CORAL ',
    sherwin: 'COR SHERWIN-WILLIAMS ',
  };
  let rest = (c.name || '').trim();

  // Remove o prefixo "COR <MARCA> " (formato legado), quando houver.
  const prefix = (prefixMap[brand] || '').toLowerCase();
  if (prefix && rest.toLowerCase().startsWith(prefix)) rest = rest.slice(prefix.length).trim();

  // Formato atual "S-A 001 - Pérola Aveludada": o nome legível vem depois do
  // primeiro separador " - ". Pega tudo após ele.
  const dashIdx = rest.indexOf(' - ');
  if (dashIdx !== -1) return rest.slice(dashIdx + 3).trim();

  // Sem " - " o produto não tem nome distinto do código (ex: "Q1-10F",
  // "RAL 1002") — devolve vazio pra UI mostrar só o código.
  return '';
}

// Código pra exibição: tira o prefixo técnico de roteamento do leque usado só
// pra filtrar por marca/grupo. Ex: "sw-p-150" → "P-150"; "c-c-00bb 06/017" →
// "C-00BB 06/017"; "tm-tmc 0001" → "TMC 0001". Suvinil ("s-...") passa intacto.
function displayCode(code: string | null | undefined): string {
  const c = (code ?? '').trim();
  return c.replace(/^(?:sw|ral|rio|tm|ib|re|ml|lk|np|c|l|p|q|x)-/i, '').toUpperCase();
}

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

export interface ProductDetailSheetProps {
  product: Product | null;
  onClose: () => void;
  // Wave 25: assinatura ganha `variant` opcional. Caller que ignora
  // variant cai no comportamento legado (produto plano sem variante).
  onAdd: (product: Product, qty: number, variant?: ProductVariant | null) => void;
}

export function ProductDetailSheet({ product, onClose, onAdd }: ProductDetailSheetProps) {
  const [qty, setQty] = useState(1);
  const [arOpen, setArOpen] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  // Aba de cores: "fabrica" (padrão) ou "personalizadas" (tintometria).
  // Só relevante pra produtos da categoria Tintas.
  const [colorTab, setColorTab] = useState<'fabrica' | 'personalizadas'>('fabrica');
  // Seletores da aba "Cores personalizadas"
  const [lequeBrand, setLequeBrand] = useState<'suvinil' | 'coral' | 'sherwin' | 'outros'>('suvinil');
  const [customSize, setCustomSize] = useState<'quartinho' | 'galao' | 'lata'>('lata');
  const [selectedLequeColor, setSelectedLequeColor] = useState<LequeColor | null>(null);
  const [lequeSearch, setLequeSearch] = useState('');
  // Seletor de variante de tamanho gerado automaticamente por agrupamento de nomes.
  const [selectedGroupVariant, setSelectedGroupVariant] = useState<GroupVariant | null>(null);

  // Busca as cores do leque da marca selecionada (só quando aba personalizadas aberta).
  const { data: lequeColors, isLoading: lequeLoading } = useQuery({
    queryKey: ['lequeColors', lequeBrand],
    queryFn: () => fetchLequeColors(lequeBrand),
    enabled: colorTab === 'personalizadas',
    staleTime: 10 * 60 * 1000,
  });

  // Wave 25: busca variantes do produto aberto. Se vazio, UI cai no preço
  // base (products.price) — sem seletor.
  const { variants } = useProductVariants(product?.id ?? null);

  // Companions: catalisadores/endurecedores vinculados ao produto pai.
  const { data: companions } = useQuery({
    queryKey: ['companions', product?.id],
    queryFn: () => fetchCompanionsForProduct(product!),
    enabled: !!product,
    staleTime: 5 * 60 * 1000,
  });

  const { requireAuth } = useAuthGate();

  // Quando variantes carregam, seleciona a primeira (sort_order menor) por
  // default. Quando product muda, reseta a seleção.
  useEffect(() => {
    if (variants.length === 0) {
      setSelectedVariantId(null);
      return;
    }
    const first = variants[0]!;
    setSelectedVariantId(first.id);
  }, [variants, product?.id]);

  // Reseta abas ao trocar de produto.
  useEffect(() => {
    setColorTab('fabrica');
    setLequeBrand('suvinil');
    setCustomSize('lata');
    setSelectedLequeColor(null);
    setLequeSearch('');
    setQty(1);
    // Auto-seleciona a primeira variante de grupo (menor preço).
    setSelectedGroupVariant(product?._groupVariants?.[0] ?? null);
  }, [product?.id]);

  // Reseta cor selecionada e busca ao trocar de marca.
  useEffect(() => {
    setSelectedLequeColor(null);
    setLequeSearch('');
  }, [lequeBrand]);

  const selectedVariant =
    variants.find((v) => v.id === selectedVariantId) ?? null;

  // Produto ativo: grupo variant (auto-agrupamento) tem prioridade.
  const activeGroupProduct = selectedGroupVariant?.product ?? null;
  const hasGroupVariants = !!(product?._groupVariants && product._groupVariants.length > 1);

  // Esgotado: grupo variant manda quando disponível; senão Wave 25; senão base.
  const outOfStock = activeGroupProduct
    ? !!(activeGroupProduct.stock != null && activeGroupProduct.stock <= 0)
    : selectedVariant
      ? selectedVariant.stock != null && selectedVariant.stock <= 0
      : !!product && product.stock != null && product.stock <= 0;

  function handleAdd() {
    if (!product || outOfStock) return;
    if (!requireAuth('comprar')) return; // visitante: abre cadastro
    const productToAdd = activeGroupProduct ?? product;
    onAdd(productToAdd, qty, selectedVariant);
    showToast('Adicionado ao carrinho!', 'success');
    onClose();
    setQty(1);
  }

  if (!product) {
    // Sheet fechado — não renderiza nada.
    return null;
  }

  const bg = productBg(product);
  const solidHex = resolveColorHex(product);
  const hasColor = !!(product.color_gradient || solidHex);
  const productCat = mktClassify(product);
  // AR só aparece pra produtos que (a) tem cor sólida resolvível E
  // (b) caem numa categoria pintável. Sem isso o botão aparecia em
  // adaptador de tomada, pincel etc. e tingia nada visível.
  const arEligible = !!solidHex && AR_PAINTABLE.has(productCat);
  // Aba de cores personalizadas só aparece pra tintas.
  const showColorTabs = productCat === 'tintas';
  // Preço derivado pra tintometria: usado no addItem quando user confirma cor.
  const basePrice = Number(product.price || 0);
  const customPrice =
    customSize === 'quartinho'
      ? Math.max(1, +(basePrice / 14).toFixed(2))
      : customSize === 'galao'
        ? Math.max(1, +(basePrice / 4).toFixed(2))
        : basePrice;

  const BRAND_LABELS: Record<typeof lequeBrand, string> = {
    suvinil: 'Suvinil',
    coral: 'Coral',
    sherwin: 'Sherwin-Williams',
    outros: 'Outros',
  };
  const SIZE_LABELS: Record<typeof customSize, string> = {
    quartinho: 'Quartinho 900ml',
    galao: 'Galão 3,6L',
    lata: 'Lata 18L',
  };

  function handleAddCustom() {
    if (!product) return;
    const colorLabel = selectedLequeColor
      ? ` ${displayCode(selectedLequeColor.code)} ${extractColorLabel(selectedLequeColor, lequeBrand)}`.trimEnd()
      : '';
    const syntheticProduct: Product = {
      ...product,
      name: `${product.name} – Tintometria ${BRAND_LABELS[lequeBrand]}${colorLabel}`,
      price: customPrice,
      color_hex: selectedLequeColor?.color_hex ?? null,
      color_gradient: null,
    };
    const syntheticVariant: ProductVariant = {
      id: `leque-${lequeBrand}-${customSize}-${selectedLequeColor?.id ?? 'sem-cor'}`,
      product_id: product.id,
      size_label: SIZE_LABELS[customSize],
      volume_ml: customSize === 'quartinho' ? 900 : customSize === 'galao' ? 3600 : 18000,
      price: customPrice,
      stock: null,
      sort_order: 0,
    };
    onAdd(syntheticProduct, qty, syntheticVariant);
    showToast('Adicionado ao carrinho!', 'success');
    onClose();
    setQty(1);
  }

  return (
    <BottomSheet
      open={!!product}
      onClose={() => {
        onClose();
        setQty(1);
      }}
      ariaLabel={`Detalhe — ${product.name}`}
    >
      {/* Hero: foto ou cor sólida */}
      <div
        style={{
          height: 140,
          background: product.image_url ? '#f5f5f5' : bg,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 60,
          marginBottom: 16,
          overflow: 'hidden',
        }}
      >
        {product.image_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={product.image_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : hasColor ? null : (
          <span aria-hidden="true">{categoryEmoji(product.category)}</span>
        )}
      </div>

      {/* Nome */}
      <div
        style={{
          fontSize: 20,
          fontWeight: 800,
          fontFamily: 'var(--font-display)',
          color: 'var(--color-ink)',
          textTransform: 'uppercase',
          lineHeight: 1.15,
        }}
      >
        {product.name}
      </div>
      {/* Código + linha */}
      {(product.code || product.line) ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-muted)',
            marginTop: 4,
            marginBottom: 12,
          }}
        >
          {product.code ? `Cód. ${product.code}` : ''}
          {product.code && product.line ? ' · ' : ''}
          {product.line ?? ''}
        </div>
      ) : (
        <div style={{ marginBottom: 12 }} />
      )}

      {/* Tab switcher: Cores de fábrica / Cores personalizadas — só pra Tintas */}
      {showColorTabs ? (
        <div
          className="flex gap-2"
          style={{
            marginBottom: 16,
            background: 'var(--color-cream)',
            borderRadius: 12,
            padding: 4,
          }}
        >
          {(['fabrica', 'personalizadas'] as const).map((tab) => {
            const active = colorTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setColorTab(tab)}
                className="flex-1 font-semibold"
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  fontSize: 12.5,
                  background: active ? '#fff' : 'transparent',
                  color: active ? 'var(--color-ink)' : 'var(--color-muted)',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
                  transition: 'background .15s',
                }}
              >
                {tab === 'fabrica' ? '🏭 Cores de fábrica' : '🎨 Cores personalizadas'}
              </button>
            );
          })}
        </div>
      ) : null}

      {colorTab === 'fabrica' || !showColorTabs ? (
        <>
          {/* Descrição opcional */}
          {product.description ? (
            <div
              style={{
                fontSize: 13.5,
                color: '#555',
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              {product.description}
            </div>
          ) : null}

          {/* 3 info-cards */}
          {product.rendimento || product.demaos || product.secagem ? (
            <div className="flex gap-2.5" style={{ marginBottom: 14 }}>
              {product.rendimento ? (
                <InfoCard label="Rendimento" value={product.rendimento} />
              ) : null}
              {product.demaos ? (
                <InfoCard label="Demãos" value={product.demaos} />
              ) : null}
              {product.secagem ? (
                <InfoCard label="Secagem" value={product.secagem} />
              ) : null}
            </div>
          ) : null}

          {/* AR: "Ver na parede" */}
          {arEligible ? (
            <button
              type="button"
              onClick={() => setArOpen(true)}
              className="w-full font-bold"
              style={{
                padding: 12,
                background: 'var(--color-cream)',
                border: '2px solid var(--color-border)',
                borderRadius: 12,
                fontSize: 13,
                color: 'var(--color-ink)',
                cursor: 'pointer',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <span aria-hidden="true">👁</span>
              <span>Ver na parede (AR)</span>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: solidHex,
                  border: '1.5px solid rgba(0,0,0,.15)',
                  marginLeft: 4,
                }}
              />
            </button>
          ) : null}

          {/* Produtos complementares (catalisadores/endurecedores) */}
          {companions && companions.length > 0 ? (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 8,
                }}
              >
                🧪 Produtos complementares
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {companions.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3"
                    style={{
                      padding: '10px 12px',
                      background: 'var(--color-cream)',
                      border: '1.5px solid var(--color-border)',
                      borderRadius: 12,
                    }}
                  >
                    <span style={{ fontSize: 20 }}>⚗️</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: 'var(--color-ink)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!requireAuth('comprar')) return;
                        onAdd(c, 1, null);
                        showToast(`${c.name} adicionado!`, 'success');
                      }}
                      style={{
                        padding: '6px 12px',
                        background: 'var(--color-p1)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 10,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      + Carrinho
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Seletor de tamanho — grupo automático (tem prioridade sobre Wave 25) */}
          {hasGroupVariants ? (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 8,
                }}
              >
                Tamanho
              </div>
              <div role="radiogroup" aria-label="Tamanho" className="flex flex-wrap gap-2">
                {product._groupVariants!.map((gv) => {
                  const active = selectedGroupVariant?.product.id === gv.product.id;
                  const outStock = gv.product.stock != null && gv.product.stock <= 0;
                  return (
                    <button
                      key={gv.product.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelectedGroupVariant(gv)}
                      disabled={outStock}
                      className="text-left"
                      style={{
                        flex: '1 1 calc(33.333% - 8px)',
                        minWidth: 88,
                        padding: '10px 12px',
                        background: active ? 'var(--color-p1)' : 'var(--color-cream)',
                        color: active ? '#fff' : outStock ? 'var(--color-muted)' : 'var(--color-ink)',
                        border: `2px solid ${active ? 'var(--color-p1)' : 'var(--color-border)'}`,
                        borderRadius: 12,
                        cursor: outStock ? 'not-allowed' : 'pointer',
                        opacity: outStock ? 0.6 : 1,
                        transition: 'background .15s, border-color .15s',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{gv.sizeLabel}</div>
                      {outStock ? (
                        <div style={{ fontSize: 10, color: active ? 'rgba(255,255,255,.8)' : '#ef4444', marginTop: 2 }}>
                          Sem estoque
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Seletor de variante (Wave 25) — só exibe em tintas sem grupo automático */}
          {variants.length > 0 && showColorTabs && !hasGroupVariants ? (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--color-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: 8,
                }}
              >
                Tamanho
              </div>
              <div role="radiogroup" aria-label="Tamanho" className="flex flex-wrap gap-2">
                {variants.map((v) => {
                  const active = v.id === selectedVariantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelectedVariantId(v.id)}
                      className="text-left"
                      style={{
                        flex: '1 1 calc(33.333% - 8px)',
                        minWidth: 96,
                        padding: '10px 12px',
                        background: active ? 'var(--color-p1)' : 'var(--color-cream)',
                        color: active ? '#fff' : 'var(--color-ink)',
                        border: `2px solid ${active ? 'var(--color-p1)' : 'var(--color-border)'}`,
                        borderRadius: 12,
                        cursor: 'pointer',
                        transition: 'background .15s, border-color .15s',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{v.size_label}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Qty picker + CTA */}
          <div className="flex items-center justify-end" style={{ marginBottom: 16 }}>
            <QtyPicker qty={qty} onChange={setQty} />
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock}
            className="w-full text-white font-bold"
            style={{
              padding: 14,
              background: outOfStock ? 'var(--color-muted)' : 'var(--color-p1)',
              borderRadius: 14,
              fontSize: 15,
              border: 'none',
              cursor: outOfStock ? 'not-allowed' : 'pointer',
              opacity: outOfStock ? 0.7 : 1,
              boxShadow: outOfStock ? 'none' : '0 4px 12px rgba(255,107,53,.3)',
            }}
          >
            {outOfStock ? 'Sem estoque' : '+ Adicionar ao Carrinho'}
          </button>
        </>
      ) : (
        /* ─── Cores personalizadas (tintometria) ─── */
        <>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14, lineHeight: 1.5 }}>
            Escolha o sistema de tintometria e o tamanho. A cor será misturada na loja conforme o leque.
          </p>

          {/* Seletor de leque / marca */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
              }}
            >
              Leque de cores
            </div>
            <div className="flex flex-wrap gap-2">
              {(['suvinil', 'coral', 'sherwin', 'outros'] as const).map((brand) => {
                const active = lequeBrand === brand;
                const label = BRAND_LABELS[brand];
                return (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => setLequeBrand(brand)}
                    className="flex-1 font-semibold"
                    style={{
                      padding: '10px 8px',
                      borderRadius: 12,
                      fontSize: 12.5,
                      background: active ? 'var(--color-p1)' : 'var(--color-cream)',
                      color: active ? '#fff' : 'var(--color-ink)',
                      border: `2px solid ${active ? 'var(--color-p1)' : 'var(--color-border)'}`,
                      cursor: 'pointer',
                      transition: 'background .15s, border-color .15s',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Grade de cores do leque da marca selecionada */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
              }}
            >
              Cor
            </div>

            {/* Campo de busca por nome ou código */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--color-cream)',
                border: '1.5px solid var(--color-border)',
                borderRadius: 10,
                padding: '7px 10px',
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--color-muted)' }}>🔍</span>
              <input
                type="text"
                value={lequeSearch}
                onChange={(e) => setLequeSearch(e.target.value)}
                placeholder="Buscar por nome ou código…"
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  fontSize: 13,
                  color: 'var(--color-ink)',
                  outline: 'none',
                }}
              />
              {lequeSearch ? (
                <button
                  type="button"
                  onClick={() => setLequeSearch('')}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 13,
                    color: 'var(--color-muted)',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>

            {lequeLoading ? (
              <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>Carregando cores…</span>
              </div>
            ) : !lequeColors || lequeColors.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                Nenhuma cor cadastrada para esta marca.
              </p>
            ) : (() => {
              const q = lequeSearch.trim().toLowerCase();
              const filteredLeque = q
                ? lequeColors.filter(
                    (c) =>
                      (c.name || '').toLowerCase().includes(q) ||
                      (c.code || '').toLowerCase().includes(q),
                  )
                : lequeColors;
              // A busca roda sobre a lista completa, mas só renderizamos um
              // teto de linhas pra não montar milhares de nós (Suvinil ~2.7k).
              const RENDER_CAP = 300;
              const shown = filteredLeque.slice(0, RENDER_CAP);
              const truncated = filteredLeque.length > RENDER_CAP;
              return filteredLeque.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                  Nenhuma cor encontrada para "{lequeSearch}".
                </p>
              ) : (
              <>
                {/* Cor selecionada — nome completo */}
                {selectedLequeColor ? (
                  <div
                    className="flex items-center gap-2"
                    style={{
                      marginBottom: 8,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: 'var(--color-cream)',
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--color-ink)',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: selectedLequeColor.color_hex || '#ccc',
                        border: '1px solid rgba(0,0,0,.12)',
                        flexShrink: 0,
                      }}
                    />
                    {selectedLequeColor.code ? `${displayCode(selectedLequeColor.code)} · ` : ''}
                    {extractColorLabel(selectedLequeColor, lequeBrand)}
                    <button
                      type="button"
                      onClick={() => setSelectedLequeColor(null)}
                      style={{
                        marginLeft: 'auto',
                        fontSize: 11,
                        color: 'var(--color-muted)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 8 }}>
                    Toque numa cor para selecionar
                  </p>
                )}

                {/* Lista de cores: círculo + código + nome legível */}
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: 'auto',
                    borderRadius: 10,
                    border: '1px solid var(--color-border)',
                    padding: 4,
                  }}
                >
                  {shown.map((c) => {
                    const active = selectedLequeColor?.id === c.id;
                    const hex = c.color_hex || '#ccc';
                    const label = extractColorLabel(c, lequeBrand);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedLequeColor(active ? null : c)}
                        title={`${displayCode(c.code)} ${label}`.trim()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          textAlign: 'left',
                          padding: '7px 8px',
                          borderRadius: 8,
                          border: active
                            ? '2px solid var(--color-p1)'
                            : '2px solid transparent',
                          background: active ? 'rgba(255,107,53,.08)' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: hex,
                            border: '1px solid rgba(0,0,0,.12)',
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ minWidth: 0, flex: 1, lineHeight: 1.25 }}>
                          {label ? (
                            <span
                              style={{
                                display: 'block',
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: 'var(--color-ink)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {label}
                            </span>
                          ) : null}
                          <span
                            style={{
                              display: 'block',
                              fontSize: 11,
                              color: 'var(--color-muted)',
                            }}
                          >
                            {displayCode(c.code)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  {truncated ? (
                    <p
                      style={{
                        fontSize: 11,
                        color: 'var(--color-muted)',
                        textAlign: 'center',
                        padding: '8px 4px 4px',
                        margin: 0,
                      }}
                    >
                      Mostrando {RENDER_CAP} de {filteredLeque.length} cores — refine pela
                      busca pra encontrar a sua.
                    </p>
                  ) : null}
                </div>
              </>
              );
            })()}
          </div>

          {/* Seletor de tamanho */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 8,
              }}
            >
              Tamanho
            </div>
            <div className="flex gap-2">
              {([
                { key: 'quartinho', label: 'Quartinho', sub: '900ml' },
                { key: 'galao', label: 'Galão', sub: '3,6L' },
                { key: 'lata', label: 'Lata', sub: '18L' },
              ] as const).map(({ key, label, sub }) => {
                const active = customSize === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCustomSize(key)}
                    className="flex-1 text-left"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: active ? 'var(--color-p1)' : 'var(--color-cream)',
                      color: active ? '#fff' : 'var(--color-ink)',
                      border: `2px solid ${active ? 'var(--color-p1)' : 'var(--color-border)'}`,
                      cursor: 'pointer',
                      transition: 'background .15s, border-color .15s',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: 11, opacity: active ? 0.95 : 0.65, marginTop: 2 }}>{sub}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Qty picker + CTA */}
          <div className="flex items-center justify-end" style={{ marginBottom: 16 }}>
            <QtyPicker qty={qty} onChange={setQty} />
          </div>

          {/* CTA */}
          <button
            type="button"
            onClick={handleAddCustom}
            className="w-full text-white font-bold"
            style={{
              padding: 14,
              background: 'var(--color-p1)',
              borderRadius: 14,
              fontSize: 15,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(255,107,53,.3)',
            }}
          >
            + Adicionar ao Carrinho
          </button>
        </>
      )}

      {/* Visualizador AR */}
      {arEligible && solidHex ? (
        <WallARView
          open={arOpen}
          color={solidHex}
          productName={product.name}
          onClose={() => setArOpen(false)}
        />
      ) : null}
    </BottomSheet>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex-1 text-center"
      style={{
        background: 'var(--color-cream)',
        borderRadius: 12,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-ink)' }}>
        {value}
      </div>
    </div>
  );
}

function QtyPicker({ qty, onChange }: { qty: number; onChange: (n: number) => void }) {
  return (
    <div
      className="flex items-center"
      style={{
        background: 'var(--color-cream)',
        border: '2px solid var(--color-border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(1, qty - 1))}
        aria-label="Diminuir"
        style={{
          width: 38,
          height: 38,
          border: 'none',
          background: 'transparent',
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--color-ink)',
          cursor: 'pointer',
        }}
      >
        −
      </button>
      <input
        type="number"
        min={1}
        value={qty}
        onChange={(e) => onChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
        className="text-center"
        style={{
          width: 48,
          height: 38,
          border: 'none',
          background: 'transparent',
          fontSize: 15,
          fontWeight: 700,
          color: 'var(--color-ink)',
          outline: 'none',
          MozAppearance: 'textfield',
        }}
      />
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        aria-label="Aumentar"
        style={{
          width: 38,
          height: 38,
          border: 'none',
          background: 'transparent',
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--color-ink)',
          cursor: 'pointer',
        }}
      >
        +
      </button>
    </div>
  );
}

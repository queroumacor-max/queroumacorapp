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

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

// Extrai o nome legível da cor a partir do nome do produto do leque.
// Ex: "COR SUVINIL S-A-150 AMARELO CANÁRIO" → "AMARELO CANÁRIO"
function extractColorLabel(c: LequeColor, brand: 'suvinil' | 'coral' | 'sherwin'): string {
  const prefixMap = {
    suvinil: 'COR SUVINIL ',
    coral: 'COR CORAL ',
    sherwin: 'COR SHERWIN-WILLIAMS ',
  };
  let rest = c.name;
  const prefix = prefixMap[brand].toLowerCase();
  if (rest.toLowerCase().startsWith(prefix)) rest = rest.slice(prefix.length);
  if (c.code && rest.toLowerCase().startsWith(c.code.toLowerCase())) {
    rest = rest.slice(c.code.length).trim();
  }
  return rest.trim();
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
  const [lequeBrand, setLequeBrand] = useState<'suvinil' | 'coral' | 'sherwin'>('suvinil');
  const [customSize, setCustomSize] = useState<'quartinho' | 'galao' | 'lata'>('lata');
  const [selectedLequeColor, setSelectedLequeColor] = useState<LequeColor | null>(null);
  const [lequeSearch, setLequeSearch] = useState('');

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
  }, [product?.id]);

  // Reseta cor selecionada e busca ao trocar de marca.
  useEffect(() => {
    setSelectedLequeColor(null);
    setLequeSearch('');
  }, [lequeBrand]);

  const selectedVariant =
    variants.find((v) => v.id === selectedVariantId) ?? null;

  // Esgotado: variante selecionada (se houver) manda; senão o produto base.
  // stock ≤ 0 bloqueia a adição ao carrinho (BUG-05).
  const outOfStock = selectedVariant
    ? selectedVariant.stock != null && selectedVariant.stock <= 0
    : !!product && product.stock != null && product.stock <= 0;

  function handleAdd() {
    if (!product || outOfStock) return;
    if (!requireAuth('comprar')) return; // visitante: abre cadastro
    onAdd(product, qty, selectedVariant);
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
  // Quando há variante selecionada, preço dela substitui o de products.
  const price = selectedVariant ? selectedVariant.price : Number(product.price || 0);
  const total = price * qty;

  // Preço derivado pra tintometria (lata = base, galão = /4, quartinho = /14).
  const basePrice = Number(product.price || 0);
  const customPrice =
    customSize === 'quartinho'
      ? Math.max(1, +(basePrice / 14).toFixed(2))
      : customSize === 'galao'
        ? Math.max(1, +(basePrice / 4).toFixed(2))
        : basePrice;
  const customTotal = customPrice * qty;

  const BRAND_LABELS: Record<typeof lequeBrand, string> = {
    suvinil: 'Suvinil',
    coral: 'Coral',
    sherwin: 'Sherwin-Williams',
  };
  const SIZE_LABELS: Record<typeof customSize, string> = {
    quartinho: 'Quartinho 900ml',
    galao: 'Galão 3,6L',
    lata: 'Lata 18L',
  };

  function handleAddCustom() {
    if (!product) return;
    const colorLabel = selectedLequeColor
      ? ` ${selectedLequeColor.code ?? ''} ${extractColorLabel(selectedLequeColor, lequeBrand)}`.trimEnd()
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
                      <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                        {c.price ? BRL.format(Number(c.price)) : 'Consulte'}
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

          {/* Seletor de variante (Wave 25) — só exibe em tintas (litragem) */}
          {variants.length > 0 && showColorTabs ? (
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
                      <div style={{ fontSize: 11, opacity: active ? 0.95 : 0.7, marginTop: 2 }}>
                        {BRL.format(v.price)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Preço + qty picker */}
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: 'var(--color-p1)',
                fontFamily: 'var(--font-display)',
              }}
            >
              {BRL.format(price)}
            </div>
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
            {outOfStock ? 'Sem estoque' : `+ Adicionar ao Carrinho · ${BRL.format(total)}`}
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
            <div className="flex gap-2">
              {(['suvinil', 'coral', 'sherwin'] as const).map((brand) => {
                const active = lequeBrand === brand;
                const label = brand === 'suvinil' ? 'Suvinil' : brand === 'coral' ? 'Coral' : 'Sherwin-Williams';
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
                    {selectedLequeColor.code ? `${selectedLequeColor.code} · ` : ''}
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

                {/* Grid de chips de cor */}
                <div
                  style={{
                    maxHeight: 180,
                    overflowY: 'auto',
                    borderRadius: 10,
                    border: '1px solid var(--color-border)',
                    padding: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(6, 1fr)',
                      gap: 6,
                    }}
                  >
                    {filteredLeque.map((c) => {
                      const active = selectedLequeColor?.id === c.id;
                      const hex = c.color_hex || '#ccc';
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedLequeColor(active ? null : c)}
                          title={`${c.code ?? ''} ${extractColorLabel(c, lequeBrand)}`.trim()}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 3,
                            padding: 4,
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
                              width: 30,
                              height: 30,
                              borderRadius: '50%',
                              background: hex,
                              border: '1px solid rgba(0,0,0,.12)',
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: 8,
                              color: 'var(--color-muted)',
                              lineHeight: 1.2,
                              textAlign: 'center',
                              maxWidth: 36,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {c.code ?? ''}
                          </span>
                        </button>
                      );
                    })}
                  </div>
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
                const sizePrice =
                  key === 'quartinho'
                    ? Math.max(1, +(basePrice / 14).toFixed(2))
                    : key === 'galao'
                      ? Math.max(1, +(basePrice / 4).toFixed(2))
                      : basePrice;
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
                    <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4, opacity: active ? 1 : 0.8 }}>
                      {BRL.format(sizePrice)}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preço + qty picker */}
          <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: 'var(--color-p1)',
                fontFamily: 'var(--font-display)',
              }}
            >
              {BRL.format(customPrice)}
            </div>
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
            {`+ Adicionar ao Carrinho · ${BRL.format(customTotal)}`}
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

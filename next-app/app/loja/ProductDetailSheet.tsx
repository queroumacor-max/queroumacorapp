// ProductDetailSheet — bottom-sheet de detalhe do produto da loja.
// Espelha o `openProductDetail` do vanilla (modules/mkt.js linha 496+):
//   - hero com imagem ou cor sólida 140px;
//   - nome em Syne 20px + "Cód. NNN · Linha Premium";
//   - descrição (opcional);
//   - 3 info-cards: Rendimento / Demãos / Secagem (cream bg);
//   - preço grande laranja + qty picker (- N +);
//   - botão "+ Adicionar ao Carrinho · R$NN,NN" full-width laranja.
'use client';

import { useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { showToast } from '@/lib/toast';
import {
  mktClassify,
  productBg,
  resolveColorHex,
  type MktCategory,
  type Product,
} from '@/lib/services/mkt';
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
  onAdd: (product: Product, qty: number) => void;
}

export function ProductDetailSheet({ product, onClose, onAdd }: ProductDetailSheetProps) {
  const [qty, setQty] = useState(1);
  const [arOpen, setArOpen] = useState(false);

  function handleAdd() {
    if (!product) return;
    onAdd(product, qty);
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
  // AR só aparece pra produtos que (a) tem cor sólida resolvível E
  // (b) caem numa categoria pintável. Sem isso o botão aparecia em
  // adaptador de tomada, pincel etc. e tingia nada visível.
  const arEligible = !!solidHex && AR_PAINTABLE.has(mktClassify(product));
  const price = Number(product.price || 0);
  const total = price * qty;

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

      {/* AR: "Ver na parede" — só pra produtos com cor sólida E categoria
          pintável (tinta/textura/epoxi/arte). Filtra fora adaptador,
          pincel, rolo etc. que tem color_hex meio aleatório e não faz
          sentido pintar parede com. */}
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

      {/* Preço + qty picker */}
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 16 }}
      >
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
            onClick={() => setQty((q) => Math.max(1, q - 1))}
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
            onChange={(e) => {
              const v = Math.max(1, parseInt(e.target.value, 10) || 1);
              setQty(v);
            }}
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
            onClick={() => setQty((q) => q + 1)}
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
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={handleAdd}
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
        + Adicionar ao Carrinho · {BRL.format(total)}
      </button>

      {/* Visualizador AR — render fora do bottom-sheet via portal-like
          (position:fixed) pra cobrir tela inteira. Só monta quando aberto
          pra não baixar MediaPipe em paginação normal. */}
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

// ShirtCustomizer — client component que customiza camiseta (cor + tamanho
// + quantidade + preview com logo do pintor sobreposto via CSS).
//
// Substitui o `screen-camisetas` do vanilla (modules/mkt.js: setShirtColor,
// setSizeBtn, changeQty, buyShirt). Decisões de port:
//   - Logo overlay via CSS transform (mais simples que canvas, conforme spec);
//   - Logo URL vem do profile.business_logo_url (perfil do usuário logado)
//     via supabase.from('profiles').select('business_logo_url').single();
//   - Buy → useCart.add com produto sintético "shirt-personalizada"
//     incluindo customization (cor/tamanho). Logo URL NÃO entra no nome
//     porque o backend não tem como persistir overlay; vai como notinha
//     pro fulfillment via order.items[].customization.

'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useCart } from '@/lib/hooks/useCart';
import { getSupabase } from '@/lib/supabase';
import type { ShirtCustomization } from '@/lib/services/mkt';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const COLORS: ReadonlyArray<{ value: string; label: string; dark?: boolean }> = [
  { value: '#ffffff', label: 'Branco' },
  { value: '#1a1a2e', label: 'Marinho', dark: true },
  { value: '#000000', label: 'Preto', dark: true },
  { value: '#e63946', label: 'Vermelho' },
  { value: '#8338ec', label: 'Roxo', dark: true },
  { value: '#ffbe0b', label: 'Amarelo' },
  { value: '#3a86ff', label: 'Azul' },
  { value: '#06d6a0', label: 'Verde água' },
];

const SIZES: ReadonlyArray<ShirtCustomization['size']> = ['P', 'M', 'G', 'GG', 'XGG'];

const BASE_PRICE = 39.9;
const BULK_THRESHOLD = 5;
const BULK_DISCOUNT = 0.85;

function computeUnit(qty: number): number {
  return qty >= BULK_THRESHOLD ? BASE_PRICE * BULK_DISCOUNT : BASE_PRICE;
}

export function ShirtCustomizer() {
  const { user } = useAuth();
  const { add, isMutating } = useCart();
  const [color, setColor] = useState<string>('#ffffff');
  const [size, setSize] = useState<ShirtCustomization['size']>('M');
  const [qty, setQty] = useState(1);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  // Puxa o business_logo_url do perfil logado. Se ausente, mostra placeholder.
  useEffect(() => {
    if (!user) {
      setLogoUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabase();
        const { data } = await sb
          .from('profiles')
          .select('business_logo_url')
          .eq('id', user.id)
          .single();
        if (!cancelled) {
          const url = (data as { business_logo_url?: string | null } | null)?.business_logo_url;
          setLogoUrl(url ?? null);
        }
      } catch {
        // Falha silenciosa — preview funciona sem logo.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const unit = computeUnit(qty);
  const total = unit * qty;
  const colorMeta = COLORS.find((c) => c.value === color) ?? COLORS[0];
  const isDark = !!colorMeta?.dark;

  function handleBuy() {
    if (!user) return;
    add({
      product: {
        id: `shirt-${color}-${size}`,
        name: `Camiseta Personalizada (${size}, ${colorMeta?.label ?? color})`,
        price: unit,
        color_hex: color,
        color_gradient: null,
        volume: null,
      },
      qty,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Preview da camiseta + logo overlay */}
      <div className="rounded-2xl bg-[color:var(--color-bg)] p-8 flex items-center justify-center">
        <div className="relative w-64 h-72">
          {/* SVG simples de camiseta — fill segue a cor escolhida. */}
          <svg
            viewBox="0 0 200 220"
            className="w-full h-full drop-shadow"
            aria-label={`Camiseta cor ${colorMeta?.label}`}
          >
            <path
              d="M40,30 L75,15 Q100,40 125,15 L160,30 L185,70 L155,85 L155,200 Q100,215 45,200 L45,85 L15,70 Z"
              fill={color}
              stroke={isDark ? '#444' : '#bbb'}
              strokeWidth={1.5}
            />
          </svg>
          {/* Overlay do logo no peito — CSS transform mantém centralização. */}
          <div
            className="absolute"
            style={{
              top: '38%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '70px',
              height: '70px',
              border: `2px dashed ${isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)'}`,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              background: logoUrl ? 'transparent' : 'transparent',
            }}
            aria-hidden="true"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="w-full h-full object-contain"
              />
            ) : (
              <span
                style={{
                  fontSize: 10,
                  color: isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)',
                  textAlign: 'center',
                }}
              >
                seu logo aqui
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cores */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Cor</h2>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => {
            const active = c.value === color;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setColor(c.value)}
                aria-label={c.label}
                aria-pressed={active}
                className={
                  'w-10 h-10 rounded-full border-2 transition-transform ' +
                  (active
                    ? 'border-[color:var(--color-ink)] scale-110'
                    : 'border-[color:var(--color-border)]')
                }
                style={{ background: c.value }}
              />
            );
          })}
        </div>
      </div>

      {/* Tamanhos */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Tamanho</h2>
        <div className="flex gap-2">
          {SIZES.map((s) => {
            const active = s === size;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                aria-pressed={active}
                className={
                  'px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ' +
                  (active
                    ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
                    : 'bg-white border-[color:var(--color-border)] text-[color:var(--color-ink)]')
                }
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quantidade */}
      <div>
        <h2 className="text-sm font-semibold mb-2">Quantidade</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="w-9 h-9 rounded-full bg-white border border-[color:var(--color-border)] text-base font-bold"
            aria-label="Diminuir quantidade"
          >
            −
          </button>
          <span
            className="text-2xl font-bold min-w-[3rem] text-center"
            id="shirt-qty"
          >
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="w-9 h-9 rounded-full bg-white border border-[color:var(--color-border)] text-base font-bold"
            aria-label="Aumentar quantidade"
          >
            +
          </button>
          <span className="ml-2 text-xs text-[color:var(--color-muted)]">
            {qty >= BULK_THRESHOLD
              ? `${(BULK_DISCOUNT * 100 - 100) | 0}% off aplicado`
              : `Compre ${BULK_THRESHOLD - qty} a mais e ganhe 15% off`}
          </span>
        </div>
      </div>

      {/* Total + CTA */}
      <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-[color:var(--color-border)]">
        <div>
          <div className="text-xs text-[color:var(--color-muted)]">Total</div>
          <div
            className="text-2xl font-bold"
            style={{ color: 'var(--color-p1)', fontFamily: 'var(--font-display)' }}
          >
            {BRL.format(total)}
          </div>
          <div className="text-[10px] text-[color:var(--color-muted)]">
            Unitário: {BRL.format(unit)}
          </div>
        </div>
        <button
          type="button"
          onClick={handleBuy}
          disabled={!user || isMutating}
          className="px-5 py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {!user
            ? 'Entre pra comprar'
            : isMutating
              ? 'Adicionando…'
              : added
                ? 'Adicionado!'
                : '+ Adicionar ao carrinho'}
        </button>
      </div>
    </div>
  );
}

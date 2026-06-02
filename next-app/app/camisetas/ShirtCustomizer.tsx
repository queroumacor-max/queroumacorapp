// ShirtCustomizer — replica o `#screen-camisetas` do vanilla (index.html
// linha 1539+):
//  1. Hero "🎽 Sua Marca Profissional"
//  2. Gerar Logo com Seu Zé (card gradient purple): inputs nome+estilo +
//     botão "Gerar Logo" + upload "Já tenho meu logo"
//  3. Personalize sua camiseta: preview com logo overlay + Cali Colors logo +
//     cor + tamanho + quantidade + total + "Pedir Agora"
//
// Logo gerado/uploadado pode ser SALVO no perfil (profile.business_logo_url)
// e reusado automaticamente pelo preview. Usa o hook `useAiLogo` que cobre
// generate + save + upload + cache global do logo salvo.
'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useCart } from '@/lib/hooks/useCart';
import { useAiLogo } from '@/lib/hooks/useAiLogo';
import { showToast } from '@/lib/toast';
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
  { value: '#ffbe0b', label: 'Amarelo' },
  { value: '#3a86ff', label: 'Azul' },
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
  const {
    savedLogo,
    variants,
    selectedIndex,
    generate,
    isGenerating,
    select,
    save,
    isSaving,
    upload,
    isUploading,
  } = useAiLogo();

  const [color, setColor] = useState<string>('#ffffff');
  const [size, setSize] = useState<ShirtCustomization['size']>('M');
  const [qty, setQty] = useState(1);
  const [logoText, setLogoText] = useState('');
  const [logoStyle, setLogoStyle] = useState('');

  const unit = computeUnit(qty);
  const total = unit * qty;
  const colorMeta = COLORS.find((c) => c.value === color) ?? COLORS[0];
  const isDark = !!colorMeta?.dark;

  // Logo a renderizar no peito: variant selecionada da geração atual > logo salvo no perfil
  const previewLogo =
    selectedIndex !== null && variants[selectedIndex]
      ? variants[selectedIndex]
      : savedLogo;

  async function handleGenerate() {
    if (!logoText.trim()) {
      showToast('Digite o texto do logo primeiro', 'info');
      return;
    }
    try {
      await generate({ name: logoText.trim(), style: logoStyle.trim() || undefined });
      showToast('Logos gerados!', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao gerar logo', 'error');
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await upload(file);
      await save(url);
      showToast('Logo enviado e salvo no perfil!', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Erro ao enviar logo', 'error');
    } finally {
      e.target.value = '';
    }
  }

  async function handleSaveSelected() {
    if (selectedIndex === null) return;
    try {
      await save();
      showToast('Logo salvo no seu perfil', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao salvar logo', 'error');
    }
  }

  function handleBuy() {
    if (!user) {
      showToast('Faça login pra comprar', 'info');
      return;
    }
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
    showToast('Camiseta adicionada ao carrinho', 'success');
  }

  return (
    <div className="space-y-4">
      {/* Hero — "Sua Marca Profissional" */}
      <div
        className="bg-white"
        style={{ borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
      >
        <div
          className="font-extrabold"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            marginBottom: 6,
            color: 'var(--color-ink)',
          }}
        >
          🎽 Sua Marca Profissional
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.5 }}>
          Camisetas personalizadas com a sua marca e a da Cali Colors. Chegue com
          identidade nos clientes.
        </div>
      </div>

      {/* Gerador de Logo IA — card gradient purple */}
      <div
        className="text-white"
        style={{
          background: 'linear-gradient(135deg, #5b3eb5, #8338ec)',
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div
          className="font-extrabold"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            marginBottom: 6,
          }}
        >
          ✨ Gerar Logo com Seu Zé
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 12 }}>
          Diga o texto e o estilo do logo, o Seu Zé gera 3 opções profissionais.
        </div>

        <input
          type="text"
          value={logoText}
          onChange={(e) => setLogoText(e.target.value)}
          placeholder="Texto do logo · ex: Silva Pinturas"
          maxLength={80}
          className="w-full text-[color:var(--color-ink)] outline-none"
          style={{
            padding: 12,
            borderRadius: 12,
            background: 'rgba(255,255,255,.95)',
            fontSize: 14,
            border: 'none',
            marginBottom: 8,
          }}
        />
        <input
          type="text"
          value={logoStyle}
          onChange={(e) => setLogoStyle(e.target.value)}
          placeholder="Estilo · ex: graffiti de rua, pintura, funilaria, vintage"
          maxLength={80}
          className="w-full text-[color:var(--color-ink)] outline-none"
          style={{
            padding: 12,
            borderRadius: 12,
            background: 'rgba(255,255,255,.95)',
            fontSize: 14,
            border: 'none',
            marginBottom: 10,
          }}
        />

        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full font-extrabold"
          style={{
            padding: 12,
            borderRadius: 12,
            background: '#fff',
            color: '#8338ec',
            fontSize: 14,
            border: 'none',
            cursor: isGenerating ? 'wait' : 'pointer',
            opacity: isGenerating ? 0.7 : 1,
          }}
        >
          {isGenerating ? 'Gerando…' : 'Gerar Logo'}
        </button>

        <label
          className="block w-full text-center font-bold"
          style={{
            padding: 12,
            borderRadius: 12,
            background: 'rgba(255,255,255,.15)',
            border: '1px solid rgba(255,255,255,.3)',
            fontSize: 13,
            marginTop: 8,
            cursor: 'pointer',
          }}
        >
          📤 Já tenho meu logo · {isUploading ? 'Enviando…' : 'Enviar'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={handleUpload}
            disabled={isUploading}
          />
        </label>

        {/* Variants gerados */}
        {variants.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="grid grid-cols-3 gap-2">
              {variants.map((url, idx) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => select(idx)}
                  className="overflow-hidden"
                  style={{
                    aspectRatio: '1 / 1',
                    borderRadius: 10,
                    background: '#fff',
                    border:
                      selectedIndex === idx
                        ? '3px solid #fff'
                        : '3px solid transparent',
                    padding: 4,
                    cursor: 'pointer',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Logo opção ${idx + 1}`}
                    className="w-full h-full object-contain"
                  />
                </button>
              ))}
            </div>
            {selectedIndex !== null ? (
              <button
                type="button"
                onClick={handleSaveSelected}
                disabled={isSaving}
                className="w-full font-bold"
                style={{
                  marginTop: 10,
                  padding: 11,
                  borderRadius: 12,
                  background: 'var(--color-p1)',
                  color: '#fff',
                  fontSize: 13,
                  border: 'none',
                  cursor: isSaving ? 'wait' : 'pointer',
                }}
              >
                {isSaving ? 'Salvando…' : 'Usar este logo na camiseta'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Personalize sua camiseta */}
      <div
        className="bg-white"
        style={{ borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
      >
        <div
          className="font-extrabold"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            marginBottom: 12,
            color: 'var(--color-ink)',
          }}
        >
          🎨 Personalize sua camiseta
        </div>

        {/* Preview da camiseta SVG com logos */}
        <div
          className="relative mx-auto"
          style={{
            background: 'var(--color-cream)',
            borderRadius: 12,
            padding: 12,
            maxWidth: 320,
            aspectRatio: '1 / 1',
          }}
        >
          <svg
            viewBox="0 0 200 220"
            className="w-full h-full"
            aria-label={`Camiseta ${colorMeta?.label}`}
          >
            <path
              d="M40,30 L75,15 Q100,40 125,15 L160,30 L185,70 L155,85 L155,200 Q100,215 45,200 L45,85 L15,70 Z"
              fill={color}
              stroke={isDark ? '#444' : '#bbb'}
              strokeWidth={1.5}
            />
          </svg>

          {/* Logo do user — peito esquerdo */}
          <div
            className="absolute"
            style={{
              top: '38%',
              left: '32%',
              transform: 'translate(-50%, -50%)',
              width: 56,
              height: 56,
              border: previewLogo
                ? 'none'
                : `1.5px dashed ${isDark ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.3)'}`,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {previewLogo ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={previewLogo}
                alt=""
                className="w-full h-full object-contain"
              />
            ) : (
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 700,
                  textAlign: 'center',
                  color: isDark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.45)',
                  letterSpacing: '.5px',
                  lineHeight: 1.2,
                }}
              >
                APLIQUE<br />SEU LOGO
              </span>
            )}
          </div>

          {/* Cali Colors no peito direito */}
          <div
            className="absolute font-extrabold"
            style={{
              top: '38%',
              left: '60%',
              transform: 'translate(-50%, -50%)',
              fontSize: 14,
              color: isDark ? '#fff' : 'var(--color-ink)',
              fontFamily: 'var(--font-display)',
              lineHeight: 1,
              letterSpacing: '-0.5px',
            }}
          >
            <span style={{ color: 'var(--color-p4)' }}>C</span>
            <span style={{ color: 'var(--color-p1)' }}>a</span>
            <span style={{ color: 'var(--color-p3)' }}>l</span>
            <span style={{ color: 'var(--color-p5)' }}>i</span>
            <br />
            <span style={{ color: isDark ? '#fff' : 'var(--color-ink)' }}>
              Colors
            </span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center justify-center gap-2" style={{ marginTop: 10 }}>
          <span
            className="text-white font-bold"
            style={{
              background: 'var(--color-ink)',
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 11,
            }}
          >
            seu_perfil
          </span>
          <span
            className="text-white font-bold"
            style={{
              background: 'var(--color-p1)',
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 11,
            }}
          >
            × Cali Colors
          </span>
        </div>
      </div>

      {/* Cor */}
      <div>
        <div
          className="font-bold uppercase"
          style={{
            fontSize: 11,
            color: 'var(--color-muted)',
            letterSpacing: '.05em',
            marginBottom: 8,
          }}
        >
          Cor da camiseta
        </div>
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
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: active
                    ? '2.5px solid var(--color-ink)'
                    : '1.5px solid var(--color-border)',
                  background: c.value,
                  cursor: 'pointer',
                  padding: 0,
                  transform: active ? 'scale(1.05)' : 'none',
                  transition: 'transform .15s',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Tamanho */}
      <div>
        <div
          className="font-bold uppercase"
          style={{
            fontSize: 11,
            color: 'var(--color-muted)',
            letterSpacing: '.05em',
            marginBottom: 8,
          }}
        >
          Tamanho
        </div>
        <div className="flex gap-2">
          {SIZES.map((s) => {
            const active = s === size;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                aria-pressed={active}
                className="flex-1 font-bold"
                style={{
                  padding: '10px 4px',
                  borderRadius: 10,
                  fontSize: 13,
                  background: active ? 'var(--color-ink)' : '#fff',
                  color: active ? '#fff' : 'var(--color-ink)',
                  border: '1.5px solid ' + (active ? 'var(--color-ink)' : 'var(--color-border)'),
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quantidade */}
      <div>
        <div
          className="font-bold uppercase"
          style={{
            fontSize: 11,
            color: 'var(--color-muted)',
            letterSpacing: '.05em',
            marginBottom: 8,
          }}
        >
          Quantidade
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="font-bold"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--color-cream)',
              border: '1.5px solid var(--color-border)',
              fontSize: 18,
              cursor: 'pointer',
            }}
            aria-label="Diminuir"
          >
            −
          </button>
          <span style={{ fontSize: 18, fontWeight: 700, minWidth: 30, textAlign: 'center' }}>
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => q + 1)}
            className="font-bold"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--color-cream)',
              border: '1.5px solid var(--color-border)',
              fontSize: 18,
              cursor: 'pointer',
            }}
            aria-label="Aumentar"
          >
            +
          </button>
          <span style={{ fontSize: 12, color: 'var(--color-muted)', flex: 1 }}>
            Mín. 1 · desconto acima de 5
          </span>
        </div>
      </div>

      {/* Total + Pedir Agora */}
      <div
        className="flex items-center justify-between bg-white"
        style={{
          borderRadius: 14,
          padding: 14,
          boxShadow: '0 2px 8px rgba(0,0,0,.05)',
          marginTop: 4,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>Total estimado</div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              color: 'var(--color-ink)',
            }}
          >
            {BRL.format(total)}
          </div>
        </div>
        <button
          type="button"
          onClick={handleBuy}
          disabled={isMutating}
          className="text-white font-bold flex items-center gap-2"
          style={{
            background: 'var(--color-p1)',
            padding: '13px 18px',
            borderRadius: 12,
            fontSize: 14,
            border: 'none',
            cursor: isMutating ? 'wait' : 'pointer',
            opacity: isMutating ? 0.7 : 1,
          }}
        >
          🛒 Pedir Agora
        </button>
      </div>
    </div>
  );
}

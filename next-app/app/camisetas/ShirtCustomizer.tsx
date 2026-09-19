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
    history,
  } = useAiLogo();

  const [color, setColor] = useState<string>('#ffffff');
  const [size, setSize] = useState<ShirtCustomization['size']>('M');
  const [qty, setQty] = useState(1);
  const [logoText, setLogoText] = useState('');
  const [logoStyle, setLogoStyle] = useState('');

  const unit = computeUnit(qty);
  const total = unit * qty;
  const colorMeta = COLORS.find((c) => c.value === color) ?? COLORS[0];

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
      const { urls, archived } = await generate({
        name: logoText.trim(),
        style: logoStyle.trim() || undefined,
      });
      // `archived` diz quantas o servidor guardou no acervo (o que a loja vê).
      // -1 = backend antigo, que não informa; aí não prometemos nada.
      if (archived >= 0 && archived < urls.length) {
        showToast(
          `${urls.length} logos gerados, mas não deu pra salvar no acervo. Use agora e avise a loja.`,
          'info',
        );
      } else {
        showToast('Logos gerados e salvos!', 'success');
      }
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

  // Reusar um logo do histórico = torná-lo o logo do perfil de novo. Um
  // clique só; o preview segue `savedLogo`, então atualiza sozinho.
  async function handleReuse(url: string) {
    try {
      await save(url);
      showToast('Logo aplicado na camiseta', 'success');
    } catch (e) {
      showToast((e as Error).message || 'Erro ao usar logo', 'error');
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

      {/* Meus logos — histórico persistido em `brand_logos`. Some quando
          o pintor ainda não gerou/enviou nenhum. */}
      {history.length > 0 ? (
        <div
          className="bg-white"
          style={{ borderRadius: 16, padding: 16, boxShadow: '0 2px 8px rgba(0,0,0,.05)' }}
        >
          <div
            className="font-extrabold"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              marginBottom: 4,
              color: 'var(--color-ink)',
            }}
          >
            🗂️ Meus logos
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 10 }}>
            Tudo que você já gerou ou enviou fica salvo aqui e na Cali Colors.
            Toque pra usar na camiseta.
          </div>
          <div className="grid grid-cols-4 gap-2">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleReuse(item.image_url)}
                disabled={isSaving}
                title={item.prompt_name || 'Logo enviado'}
                className="relative overflow-hidden"
                style={{
                  aspectRatio: '1 / 1',
                  borderRadius: 10,
                  background: 'var(--color-cream)',
                  border:
                    savedLogo === item.image_url
                      ? '2px solid var(--color-p1)'
                      : '1px solid rgba(0,0,0,.08)',
                  padding: 4,
                  cursor: isSaving ? 'wait' : 'pointer',
                }}
              >
                <img
                  src={item.image_url}
                  alt={item.prompt_name || 'Logo'}
                  loading="lazy"
                  className="w-full h-full object-contain"
                />
                <span
                  className="absolute"
                  style={{
                    left: 3,
                    top: 3,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 6,
                    background: item.source === 'ai' ? '#8338ec' : 'rgba(0,0,0,.55)',
                    color: '#fff',
                  }}
                >
                  {item.source === 'ai' ? 'IA' : 'MEU'}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

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

        {/* Preview da camiseta — foto real (vanilla `shirt-photo`) + logos
            posicionados em left:30% / right:30% / top:22% / width:14%
            (vanilla styles.css `.shirt-chest-logo` / `.shirt-cali-logo`).
            Tint da cor: aplica filter quando cor != branco. */}
        <div
          className="relative mx-auto"
          style={{
            background: 'var(--color-cream)',
            borderRadius: 14,
            padding: '16px 16px 56px',
            minHeight: 320,
            maxWidth: 360,
          }}
        >
          <div
            className="relative mx-auto"
            style={{
              width: '100%',
              maxWidth: 300,
              aspectRatio: '1 / 1',
            }}
          >
            <img
              src="/img/shirt-white.webp"
              alt={`Camiseta ${colorMeta?.label}`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full"
              style={{
                objectFit: 'contain',
                filter:
                  color === '#ffffff'
                    ? 'drop-shadow(0 6px 12px rgba(0,0,0,.08))'
                    : `drop-shadow(0 6px 12px rgba(0,0,0,.08))`,
                // Cor aplicada via mask: para cores diferentes de branco,
                // multiply preserva sombras da foto. Implementação simples:
                // overlay com mix-blend-mode multiply.
              }}
            />
            {/* Overlay de cor multiply pra tingir a camiseta */}
            {color !== '#ffffff' ? (
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background: color,
                  mixBlendMode: 'multiply',
                  WebkitMaskImage: 'url(/img/shirt-white.webp)',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskPosition: 'center',
                  WebkitMaskSize: 'contain',
                  maskImage: 'url(/img/shirt-white.webp)',
                  maskRepeat: 'no-repeat',
                  maskPosition: 'center',
                  maskSize: 'contain',
                  opacity: 0.85,
                }}
              />
            ) : null}

            {/* Logo do user — peito esquerdo (vanilla left:30% top:22% width:14%) */}
            {previewLogo ? (
              <img
                src={previewLogo}
                alt=""
                className="absolute"
                style={{
                  left: '30%',
                  top: '22%',
                  width: '14%',
                  height: 'auto',
                  maxHeight: '14%',
                  objectFit: 'contain',
                  borderRadius: 3,
                }}
              />
            ) : (
              <div
                aria-hidden="true"
                className="absolute flex items-center justify-center text-center"
                style={{
                  left: '28%',
                  top: '21%',
                  width: '18%',
                  height: '15%',
                  border: '1.5px dashed rgba(0,0,0,.3)',
                  borderRadius: 5,
                  fontSize: 8,
                  color: 'rgba(0,0,0,.5)',
                  fontWeight: 600,
                  lineHeight: 1.1,
                  padding: 3,
                  textTransform: 'uppercase',
                  letterSpacing: '.3px',
                  background: 'rgba(255,255,255,.4)',
                }}
              >
                APLIQUE
                <br />
                SEU LOGO
              </div>
            )}

            {/* Cali Colors — peito direito (vanilla right:30% top:22% width:14%) */}
            <img
              src="/img/cali-colors-logo.webp"
              alt="Cali Colors"
              loading="lazy"
              decoding="async"
              className="absolute pointer-events-none"
              style={{
                right: '30%',
                top: '22%',
                width: '14%',
                height: 'auto',
                maxHeight: '14%',
                objectFit: 'contain',
              }}
            />
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
            + Cali Colors
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

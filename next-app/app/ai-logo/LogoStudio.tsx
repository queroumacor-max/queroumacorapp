// LogoStudio — client component que orquestra o gerador de logo IA.
// Espelha o modal `#ai-logo-modal` do vanilla (modules/ai-logo.js gerarLogoIA
// + grid de variants + ações). Diferenças:
//   - sem modal: rota dedicada, layout single-column;
//   - state via useAiLogo (TanStack Query + mutations) em vez de globals;
//   - "Aplicar à camiseta" gera preview canvas client-side via
//     applyLogoToShirt (não mexe direto no DOM da camiseta mockup);
//   - estados loading/empty/error consistentes com QualsSection / PedidosList.
//
// Fluxo:
//   1. Usuário entra com nome (+ slogan + estilo opcionais);
//   2. Clica "Gerar" → /api/generate-logo retorna 4 URLs;
//   3. UI mostra grid 2x2, primeira selecionada por padrão;
//   4. Clica em outra → re-renderiza preview da camiseta;
//   5. "Salvar no perfil" persiste em profiles.business_logo_url;
//   6. "Aplicar à camiseta" mostra preview canvas + download;
//   7. "Trocar meu logo" abre file picker (upload manual sem IA).

'use client';

import { useRef, useState, type FormEvent, type ChangeEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/components/AuthProvider';
import {
  useAiLogo,
  AI_LOGO_REGEN_PRICE_BRL,
} from '@/lib/hooks/useAiLogo';
import { applyLogoToShirt } from '@/lib/services/aiLogo';

// URL do mockup de camiseta — public asset. No vanilla, era um <img> no DOM
// (#shirt-chest-placeholder); aqui usamos uma URL externa pra o canvas
// compor por cima. Caller pode trocar pra outro mockup futuramente.
const SHIRT_MOCKUP_URL = '/shirt-mockup.png';

// Formata BRL (1.99 → "R$ 1,99"). Equivalente a _aiLogoFmtBRL do vanilla.
function fmtBRL(v: number): string {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

export function LogoStudio() {
  const { user, loading: authLoading } = useAuth();
  const {
    savedLogo,
    variants,
    selectedIndex,
    isFirstFree,
    genCount,
    loadingSaved,
    generate,
    isGenerating,
    generateError,
    select,
    save,
    isSaving,
    saveError,
    upload,
    isUploading,
    uploadError,
  } = useAiLogo();

  // State local da composição na camiseta (gerada por applyLogoToShirt).
  // Não vai pra cache porque é puramente visual (e o canvas re-gera barato).
  const [shirtPreview, setShirtPreview] = useState<string | null>(null);
  const [shirtError, setShirtError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // Ref pro file input de upload manual — preferimos abrir programaticamente
  // a partir do botão custom pra UI consistente (sem o input nativo "feio").
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleGenerate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setShirtPreview(null);
    setShirtError(null);
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;

    // Gate visual da 2ª+ geração (paga). Backend já valida tudo, mas evita
    // o usuário ser surpreendido pelo charge.
    if (!isFirstFree) {
      const ok = window.confirm(
        `Gerar mais 4 opções de logo custa ${fmtBRL(AI_LOGO_REGEN_PRICE_BRL)}.\n\n` +
          'Esse valor cobre o custo do Seu Zé + processamento.\n\n' +
          'Deseja prosseguir?',
      );
      if (!ok) return;
    }

    const slogan = String(fd.get('slogan') || '').trim() || undefined;
    const style = String(fd.get('style') || '').trim() || undefined;
    try {
      await generate({ name, slogan, style });
    } catch {
      // Erro fica disponível em generateError pro render mostrar inline.
    }
  }

  async function handleApplyToShirt() {
    if (selectedIndex === null || !variants[selectedIndex]) return;
    setShirtError(null);
    setIsApplying(true);
    try {
      const dataUrl = await applyLogoToShirt(
        SHIRT_MOCKUP_URL,
        variants[selectedIndex]!,
      );
      setShirtPreview(dataUrl);
    } catch (e) {
      setShirtError(
        e instanceof Error
          ? e.message
          : 'Não foi possível aplicar o logo na camiseta',
      );
    } finally {
      setIsApplying(false);
    }
  }

  function handleDownload() {
    const url =
      shirtPreview ??
      (selectedIndex !== null ? variants[selectedIndex] : null);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `logo-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleUploadClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-upload do mesmo arquivo depois
    if (!file) return;
    try {
      await upload(file);
    } catch {
      // Erro vai pra uploadError do hook.
    }
  }

  if (authLoading) {
    return (
      <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-6 animate-pulse">
        <div className="h-4 w-1/3 bg-[color:var(--color-border)] rounded mb-3" />
        <div className="h-10 bg-[color:var(--color-border)] rounded" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🎨
        </div>
        <h2 className="font-semibold mb-2">Entre pra gerar seu logo</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          O gerador de logo IA é exclusivo pra contas PRO logadas.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Logo atual salvo no perfil (se existir) */}
      {!loadingSaved && savedLogo ? (
        <section
          className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 flex items-center gap-4"
          aria-label="Logo atual salvo no perfil"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={savedLogo}
            alt="Seu logo atual"
            className="w-16 h-16 object-contain rounded-lg bg-[color:var(--color-bg)]"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[color:var(--color-muted)]">
              Logo atual no seu perfil
            </p>
            <p className="text-sm font-semibold truncate">Branding ativo</p>
          </div>
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={isUploading}
            className="text-xs font-semibold px-3 py-2 border border-[color:var(--color-border)] rounded-lg disabled:opacity-50"
          >
            {isUploading ? 'Enviando...' : 'Trocar'}
          </button>
        </section>
      ) : null}

      {/* Form de geração */}
      <form
        onSubmit={handleGenerate}
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 space-y-3"
      >
        <div>
          <label htmlFor="logo-name" className="block text-xs font-semibold mb-1">
            Nome da marca *
          </label>
          <input
            id="logo-name"
            name="name"
            type="text"
            required
            maxLength={40}
            placeholder="Ex.: Cali Colors"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label htmlFor="logo-slogan" className="block text-xs font-semibold mb-1">
            Slogan (opcional)
          </label>
          <input
            id="logo-slogan"
            name="slogan"
            type="text"
            maxLength={60}
            placeholder="Ex.: cores que vivem"
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm"
          />
        </div>
        <div>
          <label htmlFor="logo-style" className="block text-xs font-semibold mb-1">
            Estilo (opcional)
          </label>
          <select
            id="logo-style"
            name="style"
            defaultValue=""
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm bg-white"
          >
            <option value="">Padrão (vibrante)</option>
            <option value="minimalista">Minimalista</option>
            <option value="vintage">Vintage</option>
            <option value="moderno">Moderno</option>
            <option value="urbano">Urbano</option>
          </select>
        </div>

        {generateError ? (
          <p className="text-xs text-red-600">
            {generateError.message || 'Erro ao gerar logo.'}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isGenerating}
          className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold disabled:opacity-50"
        >
          {isGenerating
            ? 'Gerando com Seu Zé...'
            : isFirstFree
              ? 'Gerar logo (grátis)'
              : `Gerar novamente · ${fmtBRL(AI_LOGO_REGEN_PRICE_BRL)}`}
        </button>
        {genCount > 0 ? (
          <p className="text-[10px] text-[color:var(--color-muted)] text-center">
            Gerações nesta sessão: {genCount}
          </p>
        ) : null}
      </form>

      {/* Grid de variants */}
      {variants.length > 0 ? (
        <section
          className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
          aria-label="Variantes geradas"
        >
          <h3 className="text-sm font-semibold mb-3">Escolha um variante</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {variants.map((url, i) => {
              const active = i === selectedIndex;
              return (
                <button
                  type="button"
                  key={url + i}
                  onClick={() => {
                    select(i);
                    setShirtPreview(null);
                  }}
                  aria-pressed={active}
                  className={
                    'rounded-xl p-2 border-2 transition-colors ' +
                    (active
                      ? 'border-[color:var(--color-p1)] bg-[color:var(--color-bg)]'
                      : 'border-[color:var(--color-border)] hover:border-[color:var(--color-p1)]/50')
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Variante ${i + 1}`}
                    className="w-full h-32 object-contain rounded-lg bg-white"
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>

          {saveError ? (
            <p className="text-xs text-red-600 mb-2">
              {saveError.message || 'Erro ao salvar.'}
            </p>
          ) : null}
          {shirtError ? (
            <p className="text-xs text-red-600 mb-2">{shirtError}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => save()}
              disabled={isSaving || selectedIndex === null}
              className="py-2 bg-[color:var(--color-ink)] text-white rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {isSaving ? 'Salvando...' : 'Salvar no perfil'}
            </button>
            <button
              type="button"
              onClick={handleApplyToShirt}
              disabled={isApplying || selectedIndex === null}
              className="py-2 border border-[color:var(--color-border)] rounded-xl text-sm font-semibold disabled:opacity-50"
            >
              {isApplying ? 'Aplicando...' : 'Aplicar à camiseta'}
            </button>
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={selectedIndex === null}
            className="w-full mt-2 py-2 border border-[color:var(--color-border)] rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            Baixar logo
          </button>
        </section>
      ) : null}

      {/* Preview da camiseta */}
      {shirtPreview ? (
        <section
          className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
          aria-label="Preview da camiseta"
        >
          <h3 className="text-sm font-semibold mb-3">Camiseta personalizada</h3>
          {/* Usamos Image do next pra otimização CDN em runtime; o src é data URL */}
          <Image
            src={shirtPreview}
            alt="Camiseta com seu logo"
            width={512}
            height={512}
            unoptimized
            className="w-full h-auto rounded-xl"
          />
        </section>
      ) : null}

      {/* Upload manual (sem IA) */}
      <section
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
        aria-label="Upload de logo próprio"
      >
        <h3 className="text-sm font-semibold mb-2">Já tem seu logo?</h3>
        <p className="text-xs text-[color:var(--color-muted)] mb-3">
          Envie um arquivo (PNG, JPG ou SVG até 5 MB) e ele vai pro seu perfil
          direto, sem passar pela IA.
        </p>
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={isUploading}
          className="w-full py-2 border border-[color:var(--color-border)] rounded-xl text-sm font-semibold disabled:opacity-50"
        >
          {isUploading ? 'Enviando...' : 'Enviar meu logo'}
        </button>
        {uploadError ? (
          <p className="text-xs text-red-600 mt-2">
            {uploadError.message || 'Erro ao enviar.'}
          </p>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />
      </section>
    </div>
  );
}

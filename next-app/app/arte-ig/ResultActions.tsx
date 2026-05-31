// ResultActions — bloco de ações após a arte ter sido gerada.
// Espelha o `#ai-art-result` do vanilla com: preview da imagem, textarea
// editável de legenda, toggle "aplicar minha logo", e os 3 CTAs: Download,
// Postar no Feed, Refazer. Suporta logo overlay client-side via
// applyLogoToImage (canvas compose com posição configurável).

'use client';

import { useCallback, useEffect, useState } from 'react';
import { applyLogoToImage, type LogoPosition } from '@/lib/services/aiArt';

interface ResultActionsProps {
  imageDataUrl: string;
  initialCaption: string;
  // Logo do profile do usuário (`profiles.business_logo_url`); null se não tem.
  logoUrl: string | null;
  // Quando o usuário clica "Postar" — pai dispara post.
  onPost: (caption: string, finalImageDataUrl: string) => void;
  isPosting: boolean;
  postError: Error | null;
  // Quando o usuário clica "Refazer" — pai limpa estado e volta pro form.
  onReset: () => void;
}

export function ResultActions({
  imageDataUrl,
  initialCaption,
  logoUrl,
  onPost,
  isPosting,
  postError,
  onReset,
}: ResultActionsProps) {
  const [caption, setCaption] = useState(initialCaption);
  // imageDataUrl é "original sem logo"; displayUrl é o que mostra (pode ter
  // logo aplicada). Quando user desmarca o toggle, volta pro original.
  const [displayUrl, setDisplayUrl] = useState(imageDataUrl);
  const [withLogo, setWithLogo] = useState(false);
  const [logoPos, setLogoPos] = useState<LogoPosition>('top-right');
  const [applyError, setApplyError] = useState<string | null>(null);

  // Quando user gera nova arte, props mudam — recompõe o estado local.
  useEffect(() => {
    setCaption(initialCaption);
    setDisplayUrl(imageDataUrl);
    setWithLogo(false);
    setApplyError(null);
  }, [imageDataUrl, initialCaption]);

  // Re-aplica logo quando user troca posição com o toggle ligado, ou liga
  // o toggle. Desligado → volta pro original sem custo.
  useEffect(() => {
    let cancelled = false;
    if (!withLogo) {
      setDisplayUrl(imageDataUrl);
      setApplyError(null);
      return;
    }
    if (!logoUrl) {
      setApplyError(
        'Você ainda não cadastrou sua logo. Sobe no seu perfil profissional.',
      );
      setWithLogo(false);
      return;
    }
    applyLogoToImage(imageDataUrl, logoUrl, logoPos)
      .then((composed) => {
        if (!cancelled) {
          setDisplayUrl(composed);
          setApplyError(null);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setApplyError('Não consegui aplicar a logo: ' + msg);
        setWithLogo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [withLogo, logoUrl, imageDataUrl, logoPos]);

  const handleDownload = useCallback(() => {
    if (typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = displayUrl;
    a.download = `arte-ig-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [displayUrl]);

  const handlePost = useCallback(() => {
    onPost(caption, displayUrl);
  }, [caption, displayUrl, onPost]);

  return (
    <section
      aria-label="Arte pronta"
      className="bg-white rounded-2xl border border-[color:var(--color-border)] p-4 mt-4"
    >
      <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
        Sua arte
      </h3>

      <img
        src={displayUrl}
        alt="Arte gerada"
        className="w-full rounded-xl mb-3 border border-[color:var(--color-border)]"
      />

      {/* Logo toggle + posição */}
      <div className="space-y-2 mb-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={withLogo}
            onChange={(e) => setWithLogo(e.target.checked)}
            className="cursor-pointer"
          />
          <span>Aplicar minha logo</span>
        </label>
        {withLogo ? (
          <div className="flex gap-1 flex-wrap">
            {(['top-right', 'top-left', 'bottom-right', 'bottom-left'] as LogoPosition[]).map(
              (pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => setLogoPos(pos)}
                  className="px-2 py-1 rounded-md text-[11px] font-semibold transition-colors"
                  style={{
                    background:
                      pos === logoPos ? 'var(--color-p1)' : 'var(--color-bg)',
                    color: pos === logoPos ? '#fff' : 'var(--color-ink)',
                  }}
                >
                  {posLabel(pos)}
                </button>
              ),
            )}
          </div>
        ) : null}
        {applyError ? (
          <div
            role="alert"
            className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2"
          >
            {applyError}
          </div>
        ) : null}
      </div>

      {/* Legenda editável */}
      <label className="block text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-1">
        Legenda
      </label>
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        rows={3}
        className="w-full p-2 border border-[color:var(--color-border)] rounded-lg text-sm mb-3"
        placeholder="Sua legenda..."
      />

      {/* Erro do post */}
      {postError ? (
        <div
          role="alert"
          className="mb-2 p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800"
        >
          {postError.message || 'Erro ao publicar.'}
        </div>
      ) : null}

      {/* Botões de ação */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleDownload}
          className="flex-1 px-4 py-2 bg-[color:var(--color-bg)] border border-[color:var(--color-border)] rounded-xl text-sm font-semibold"
        >
          📥 Baixar
        </button>
        <button
          type="button"
          onClick={handlePost}
          disabled={isPosting}
          className="flex-1 px-4 py-2 bg-[color:var(--color-p1)] text-white rounded-xl text-sm font-semibold disabled:opacity-60"
        >
          {isPosting ? 'Publicando...' : '📤 Postar no Feed'}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="flex-1 px-4 py-2 bg-white border border-[color:var(--color-border)] rounded-xl text-sm font-semibold"
        >
          🔄 Refazer
        </button>
      </div>
    </section>
  );
}

function posLabel(pos: LogoPosition): string {
  switch (pos) {
    case 'top-right':
      return 'Sup. Dir.';
    case 'top-left':
      return 'Sup. Esq.';
    case 'bottom-right':
      return 'Inf. Dir.';
    case 'bottom-left':
      return 'Inf. Esq.';
  }
}

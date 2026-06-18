// CaptionInput — textarea de legenda + botão "Gerar legenda IA". Quando o
// botão é clicado, o pai (Composer) precisa orquestrar:
//   1. subir a primeira mídia (se ainda não subiu)
//   2. chamar generateCaption com a URL
//   3. setar o texto no state
// Por isso o componente apenas EMITE onGenerate() — não chama o service
// diretamente. Mantém o componente puro/testável e a lógica de side-effects
// concentrada no pai.

'use client';

import type { ChangeEvent } from 'react';
import { showToast } from '@/lib/toast';

export interface CaptionInputProps {
  value: string;
  onChange: (next: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  canGenerate: boolean;       // false se não há mídia selecionada
  disabled?: boolean;
  maxLength?: number;
}

export function CaptionInput({
  value,
  onChange,
  onGenerate,
  isGenerating,
  canGenerate,
  disabled,
  maxLength = 2000,
}: CaptionInputProps) {
  const len = value.length;
  const near = len > maxLength * 0.9;

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    // Clamp client-side; backend também valida.
    const next = e.target.value.slice(0, maxLength);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="post-caption" className="text-sm font-semibold">
        Legenda
      </label>
      <textarea
        id="post-caption"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder="Conte um pouco sobre o trabalho..."
        rows={5}
        maxLength={maxLength}
        className="w-full p-3 rounded-xl border border-[color:var(--color-border)] bg-white text-sm resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
        data-testid="caption-input"
      />
      <div className="flex items-center justify-between gap-3">
        {/* Botão fica habilitado mesmo sem mídia pra poder dar FEEDBACK no
            clique (antes ficava disabled e o tap não retornava nada — BUG 6).
            Sem mídia, o clique mostra um toast orientando a selecionar. */}
        <button
          type="button"
          onClick={() => {
            if (!canGenerate) {
              showToast('Selecione uma foto ou vídeo antes de gerar a legenda.', 'info');
              return;
            }
            onGenerate();
          }}
          disabled={disabled || isGenerating}
          aria-label="Gerar legenda com IA"
          aria-disabled={!canGenerate}
          className="px-3 py-2 text-sm rounded-xl bg-white border border-[color:var(--color-border)] font-semibold hover:bg-[color:var(--color-p1)]/5 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            canGenerate
              ? 'Usa a IA pra escrever uma legenda a partir da imagem'
              : 'Selecione uma mídia antes de gerar a legenda'
          }
        >
          {isGenerating ? 'Gerando…' : '✨ Gerar legenda (IA)'}
        </button>
        <span
          className={
            'text-xs ' +
            (near
              ? 'text-[color:var(--color-p1)] font-semibold'
              : 'text-[color:var(--color-muted)]')
          }
          aria-live="polite"
        >
          {len}/{maxLength}
        </span>
      </div>
      {!canGenerate ? (
        <p className="text-xs text-[color:var(--color-muted)] -mt-1">
          Selecione uma foto ou vídeo primeiro para gerar a legenda com IA.
        </p>
      ) : null}
    </div>
  );
}

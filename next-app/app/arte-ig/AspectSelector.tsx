// AspectSelector — 3 pílulas pra escolher a proporção de saída.
// Espelha `#ai-art-aspects` do vanilla. Aspect ratio CSS no preview ajuda o
// usuário a ver no que vai dar antes de gerar.

'use client';

import type { ArtAspect } from '@/lib/services/aiArt';

interface AspectOption {
  key: ArtAspect;
  label: string;
  ratio: string; // pra CSS aspect-ratio
  hint: string;
}

const ASPECTS: readonly AspectOption[] = [
  { key: 'square', label: '1:1', ratio: '1/1', hint: 'Feed' },
  { key: 'vertical', label: '4:5', ratio: '4/5', hint: 'Reels/Stories' },
  { key: 'horizontal', label: '16:9', ratio: '16/9', hint: 'Capa/Banner' },
] as const;

interface AspectSelectorProps {
  value: ArtAspect;
  onChange: (aspect: ArtAspect) => void;
}

export function AspectSelector({ value, onChange }: AspectSelectorProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
        3. Formato
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {ASPECTS.map((a) => {
          const selected = a.key === value;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => onChange(a.key)}
              aria-pressed={selected}
              className="rounded-2xl p-2 text-center transition-all"
              style={{
                border: selected
                  ? '2px solid var(--color-p1)'
                  : '2px solid var(--color-border)',
                background: selected ? 'rgba(255,107,53,.08)' : '#fff',
              }}
            >
              <div
                className="mx-auto mb-1 bg-[color:var(--color-bg)] rounded-md w-12"
                style={{ aspectRatio: a.ratio }}
                aria-hidden="true"
              />
              <div className="font-bold text-sm">{a.label}</div>
              <div className="text-[10px] text-[color:var(--color-muted)]">
                {a.hint}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

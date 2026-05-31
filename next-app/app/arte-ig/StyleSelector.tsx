// StyleSelector — grid 2x2 dos 4 estilos suportados. Espelha o bloco
// `#ai-art-styles` do vanilla (4 tiles com preview do template). Cada tile
// busca o thumbnail via fetchTemplates() do service; se falhar, mostra
// fallback CSS-gradient com emoji (igual ao .ai-art-fallback do vanilla).
//
// `data-photos="2"` no vanilla virou prop `needsTwo` do estilo `antesdepois`
// — o pai (AiArtStudio) reage mostrando/escondendo o slot 2 de foto.

'use client';

import { useEffect, useState } from 'react';
import { fetchTemplates, type ArtStyle } from '@/lib/services/aiArt';

interface StyleOption {
  key: ArtStyle;
  label: string;
  hint: string;
  needsTwo: boolean;
  // Emoji fallback usado quando o template não carrega.
  emoji: string;
  // Gradient de fallback pra deixar o tile lindo mesmo sem template.
  gradient: string;
}

const STYLES: readonly StyleOption[] = [
  {
    key: 'profissional',
    label: 'Profissional',
    hint: 'Você no trabalho, post de marketing',
    needsTwo: false,
    emoji: '👨‍🎨',
    gradient: 'linear-gradient(135deg,#FFB347,#FF6B35)',
  },
  {
    key: 'trabalho',
    label: 'Trabalho finalizado',
    hint: 'Só o ambiente recém-pintado',
    needsTwo: false,
    emoji: '🏠',
    gradient: 'linear-gradient(135deg,#A8E6CF,#56C596)',
  },
  {
    key: 'antesdepois',
    label: 'Antes / Depois',
    hint: 'Comparação lado a lado (2 fotos)',
    needsTwo: true,
    emoji: '↔️',
    gradient: 'linear-gradient(135deg,#FFD93D,#FF6B6B)',
  },
  {
    key: 'criativo',
    label: 'Criativo',
    hint: 'Retrato cinematográfico estilo capa',
    needsTwo: false,
    emoji: '✨',
    gradient: 'linear-gradient(135deg,#667EEA,#764BA2)',
  },
] as const;

interface StyleSelectorProps {
  value: ArtStyle;
  onChange: (style: ArtStyle, needsTwo: boolean) => void;
}

export function StyleSelector({ value, onChange }: StyleSelectorProps) {
  // Map de templates carregados — key (estilo) → URL (ou null se falhou).
  // useState pra cada estilo seria N hooks; um único objeto evita isso e
  // dá update batched naturalmente.
  const [templates, setTemplates] = useState<Record<string, string | null>>({});

  useEffect(() => {
    // Best-effort: carrega templates de cada estilo em paralelo. Falha de um
    // não bloqueia os outros — fetchTemplates já é silenciosa.
    let cancelled = false;
    Promise.all(
      STYLES.map(async (s) => {
        const url = await fetchTemplates(s.key);
        return [s.key, url] as const;
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        const next: Record<string, string | null> = {};
        for (const [k, v] of entries) next[k] = v;
        setTemplates(next);
      })
      .catch(() => {
        /* templates ficam vazios → fallback gradient/emoji */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-2">
        1. Estilo
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {STYLES.map((s) => {
          const selected = s.key === value;
          const tplUrl = templates[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key, s.needsTwo)}
              aria-pressed={selected}
              className="rounded-2xl p-3 text-left transition-all bg-white"
              style={{
                border: selected
                  ? '2px solid var(--color-p1)'
                  : '2px solid var(--color-border)',
                background: selected
                  ? 'rgba(255,107,53,.08)'
                  : '#fff',
              }}
            >
              <div
                className="w-full aspect-[4/5] rounded-xl mb-2 bg-cover bg-center flex items-center justify-center"
                style={{
                  backgroundImage: tplUrl ? `url('${tplUrl}')` : undefined,
                  background: tplUrl ? undefined : s.gradient,
                }}
              >
                {!tplUrl ? (
                  <span className="text-4xl" aria-hidden="true">
                    {s.emoji}
                  </span>
                ) : null}
              </div>
              <div className="font-semibold text-sm">{s.label}</div>
              <div className="text-xs text-[color:var(--color-muted)] mt-0.5">
                {s.hint}
              </div>
              {s.needsTwo ? (
                <div className="text-[10px] font-bold text-[color:var(--color-p1)] uppercase mt-1">
                  Precisa de 2 fotos
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

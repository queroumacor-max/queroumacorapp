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

// Mock ilustrativo do resultado pra cada estilo — usado quando o template
// real (bucket style-refs) ainda não foi uploadado pelo admin. SVG inline
// pra evitar requests extras e dar visual claro do que cada estilo gera.
function StyleMock({ styleKey }: { styleKey: ArtStyle }) {
  switch (styleKey) {
    case 'profissional':
      // Silhueta do pintor segurando rolo + tinta caindo. Marketing IG.
      return (
        <svg viewBox="0 0 100 125" width="80%" height="80%" aria-hidden="true">
          <rect x="0" y="0" width="100" height="125" fill="none" />
          <circle cx="50" cy="35" r="13" fill="#fff" />
          <rect x="38" y="48" width="24" height="40" rx="3" fill="#fff" />
          <rect x="62" y="30" width="6" height="38" rx="2" fill="#fff" />
          <rect x="58" y="62" width="14" height="8" rx="2" fill="#fff" />
          <text x="50" y="108" textAnchor="middle" fontSize="9" fill="#fff" fontWeight="800" fontFamily="sans-serif">PINTOR</text>
          <text x="50" y="118" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,.85)" fontFamily="sans-serif">@seu_perfil</text>
        </svg>
      );
    case 'trabalho':
      // Ambiente recém-pintado: parede + janela + plantinha. Sem pessoas.
      return (
        <svg viewBox="0 0 100 125" width="85%" height="85%" aria-hidden="true">
          <rect x="10" y="20" width="80" height="55" fill="#fff" opacity=".95" />
          <rect x="18" y="28" width="28" height="22" fill="rgba(135,200,255,.55)" stroke="#fff" strokeWidth="1.5" />
          <rect x="54" y="28" width="28" height="22" fill="rgba(135,200,255,.55)" stroke="#fff" strokeWidth="1.5" />
          <line x1="32" y1="28" x2="32" y2="50" stroke="#fff" strokeWidth="1" />
          <line x1="68" y1="28" x2="68" y2="50" stroke="#fff" strokeWidth="1" />
          <rect x="12" y="74" width="76" height="3" fill="#fff" />
          <ellipse cx="78" cy="84" rx="5" ry="3" fill="#fff" opacity=".6" />
          <rect x="74" y="65" width="8" height="14" fill="#fff" opacity=".8" />
          <text x="50" y="108" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="800" fontFamily="sans-serif">AMBIENTE</text>
          <text x="50" y="118" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,.85)" fontFamily="sans-serif">recém pintado</text>
        </svg>
      );
    case 'antesdepois':
      // Split antes/depois — esquerda escura/desbotada, direita clara.
      return (
        <svg viewBox="0 0 100 125" width="90%" height="90%" aria-hidden="true">
          <rect x="5" y="10" width="42" height="80" fill="rgba(60,40,30,.7)" />
          <rect x="53" y="10" width="42" height="80" fill="#fff" opacity=".95" />
          <text x="26" y="55" textAnchor="middle" fontSize="9" fill="#fff" fontWeight="800" fontFamily="sans-serif">ANTES</text>
          <text x="74" y="55" textAnchor="middle" fontSize="9" fill="#333" fontWeight="800" fontFamily="sans-serif">DEPOIS</text>
          <line x1="50" y1="10" x2="50" y2="90" stroke="#fff" strokeWidth="2" />
          <text x="50" y="108" textAnchor="middle" fontSize="7" fill="#fff" fontWeight="800" fontFamily="sans-serif">COMPARAÇÃO</text>
          <text x="50" y="118" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,.85)" fontFamily="sans-serif">lado a lado</text>
        </svg>
      );
    case 'criativo':
      // Retrato cinematográfico capa — silhueta com luz dramática.
      return (
        <svg viewBox="0 0 100 125" width="80%" height="80%" aria-hidden="true">
          <defs>
            <radialGradient id="spotlight" cx="50%" cy="35%" r="50%">
              <stop offset="0%" stopColor="rgba(255,200,100,.45)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width="100" height="125" fill="url(#spotlight)" />
          <ellipse cx="50" cy="35" rx="11" ry="13" fill="#fff" />
          <path d="M28 75 Q50 55 72 75 L72 95 L28 95 Z" fill="#fff" />
          <text x="50" y="108" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="800" fontFamily="sans-serif">CINEMATOGRÁFICO</text>
          <text x="50" y="118" textAnchor="middle" fontSize="6" fill="rgba(255,255,255,.85)" fontFamily="sans-serif">estilo capa</text>
        </svg>
      );
    default:
      return <span className="text-4xl">✨</span>;
  }
}

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
                className="w-full aspect-[4/5] rounded-xl mb-2 bg-cover bg-center flex items-center justify-center overflow-hidden relative"
                style={{
                  backgroundImage: tplUrl ? `url('${tplUrl}')` : undefined,
                  background: tplUrl ? undefined : s.gradient,
                }}
              >
                {!tplUrl ? (
                  // Mock visual ilustrativo do estilo final (placeholder
                  // enquanto admin não sobe template real via /api/upload-
                  // style-ref). Cada estilo tem um SVG diferente representando
                  // a composição esperada do resultado.
                  <StyleMock styleKey={s.key} />
                ) : null}
                {/* Badge "exemplo" sobreposto pra deixar claro que é mock */}
                <span
                  aria-hidden="true"
                  className="absolute font-bold text-white"
                  style={{
                    top: 6,
                    left: 6,
                    fontSize: 9,
                    padding: '2px 6px',
                    borderRadius: 999,
                    background: 'rgba(0,0,0,.55)',
                    letterSpacing: '.05em',
                  }}
                >
                  EXEMPLO
                </span>
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

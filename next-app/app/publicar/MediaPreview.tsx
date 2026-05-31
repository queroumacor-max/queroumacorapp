// MediaPreview — grid de thumbnails das mídias selecionadas. Cada item tem
// botão X pra remover. Pra vídeo, mostra <video> sem controles (poster nativo
// já dá preview do primeiro frame); pra imagem, <img> com objectURL.
//
// ObjectURLs vivem enquanto o componente existir; createObjectURL é cacheado
// num useMemo keyed por (file.name + size + lastModified) pra não estourar
// reuso quando o pai re-renderiza por outros motivos. Cleanup acontece no
// useEffect cleanup pra evitar leak de memória.

'use client';

import { useEffect, useMemo } from 'react';
import { getMediaType } from '@/lib/utils';

export interface MediaPreviewProps {
  files: File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

interface PreviewItem {
  file: File;
  url: string;
  type: 'image' | 'video';
}

export function MediaPreview({ files, onRemove, disabled }: MediaPreviewProps) {
  // useMemo recria URLs apenas quando a lista de files muda de identidade.
  // O Composer trata files como imutável (slice/spread em cada update), então
  // a key por referência é suficiente.
  const items: PreviewItem[] = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        type: getMediaType(file),
      })),
    [files]
  );

  // Cleanup: ao desmontar (ou quando a lista trocar e o useMemo recriar),
  // revoga as URLs antigas pra liberar memória. O cleanup roda DEPOIS da
  // próxima renderização, então os <img>/<video> já trocaram de src.
  useEffect(() => {
    return () => {
      for (const it of items) {
        try {
          URL.revokeObjectURL(it.url);
        } catch {
          /* ignore */
        }
      }
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div
      className="grid grid-cols-3 gap-2"
      aria-label="Mídias selecionadas"
      data-testid="media-preview"
    >
      {items.map((it, i) => (
        <div
          key={`${it.file.name}-${it.file.size}-${i}`}
          className="relative rounded-xl overflow-hidden bg-[color:var(--color-border)] aspect-square"
        >
          {it.type === 'video' ? (
            <video
              src={it.url}
              className="w-full h-full object-cover"
              muted
              playsInline
              preload="metadata"
              aria-label={`Vídeo ${i + 1}`}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={it.url}
              alt={`Mídia ${i + 1}`}
              className="w-full h-full object-cover"
            />
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            disabled={disabled}
            aria-label={`Remover mídia ${i + 1}`}
            className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/70 text-white text-sm font-bold flex items-center justify-center hover:bg-black/90 disabled:opacity-50"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

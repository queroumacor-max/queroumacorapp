// Skeletons — placeholders cinza com pulse animation, padrão em apps
// modernos (IG, Twitter) pra reduzir CLS e dar sensação de "carregando
// progressivo" vs spinner ou texto "Carregando…".
//
// Reutilizáveis. Não acoplam a layout — quem usa decide width/altura
// via className/style. Animação `animate-pulse` é Tailwind nativa.

import type { CSSProperties } from 'react';

interface SkelProps {
  className?: string;
  style?: CSSProperties;
}

// Linha de texto. Default 12px altura. Caller passa width via className
// (ex.: "w-1/3", "w-full").
export function LineSkeleton({ className = '', style }: SkelProps) {
  return (
    <div
      className={`h-3 bg-[color:var(--color-border)] rounded animate-pulse ${className}`}
      style={style}
    />
  );
}

// Card retangular genérico — pra produto, post, nota etc.
export function BlockSkeleton({ className = '', style }: SkelProps) {
  return (
    <div
      className={`bg-[color:var(--color-border)] rounded animate-pulse ${className}`}
      style={style}
    />
  );
}

// Lista de N itens com altura fixa — usar pra notes, products, busca, etc.
export function ListSkeleton({
  count = 4,
  itemHeight = 72,
  gap = 12,
}: {
  count?: number;
  itemHeight?: number;
  gap?: number;
}) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <BlockSkeleton key={i} style={{ height: itemHeight }} className="w-full" />
      ))}
    </div>
  );
}

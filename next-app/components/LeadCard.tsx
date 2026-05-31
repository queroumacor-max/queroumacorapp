// LeadCard — card visual de um lead na lista /leads. Componente puro:
// recebe `lead`, `onComprar` e `isComprarando` como props e não faz fetch
// nem mutation própria (separação clara entre dados/visual, igual o pattern
// das outras telas portadas).
//
// Layout: media (foto/preview do vídeo) topo, descrição truncada + meta
// (tipo de arte) no meio, valor em BRL + botão "Comprar contato" no rodapé.
// Quando isComprarando=true, botão desabilita e troca pra "Comprando..."
// (replica setButtonLoading do vanilla — feedback imediato sem spinner extra).

'use client';

import type { Lead } from '@/lib/types';

// Formatter de moeda BR — instância singleton, evita recriar em cada render
// (Intl é caro). Currency BRL fixo: produto é só Brasil.
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatPrice(price?: number | null): string {
  if (price == null || price <= 0) return 'A combinar';
  return BRL.format(price);
}

// Trunca caption mantendo legibilidade. CSS line-clamp seria ideal, mas
// truncate por chars é determinístico e funciona sem Tailwind plugin.
function truncate(text: string, max = 140): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}

export interface LeadCardProps {
  lead: Lead;
  onComprar: () => void;
  isComprarando: boolean;
}

export function LeadCard({ lead, onComprar, isComprarando }: LeadCardProps) {
  const isVideo = lead.media_type === 'video';
  const caption = lead.caption ? truncate(lead.caption) : 'Sem descrição';

  return (
    <article className="bg-white rounded-2xl border border-[color:var(--color-border)] overflow-hidden shadow-sm">
      {/* Media: img pra foto, video tag (sem autoplay) pra vídeo. Aspect 4:3
          pra grid uniforme — posts originais podem ter qualquer ratio. */}
      {lead.media_url ? (
        isVideo ? (
          <video
            src={lead.media_url}
            className="w-full aspect-[4/3] object-cover bg-[color:var(--color-border)]"
            controls={false}
            muted
            playsInline
            preload="metadata"
            aria-label="Prévia do vídeo do lead"
          />
        ) : (
          // next/image precisaria de allowlist de domínios no next.config —
          // usamos <img> nativa pra simplificar até a config existir.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={lead.media_url}
            alt={lead.art_type || 'Lead'}
            className="w-full aspect-[4/3] object-cover bg-[color:var(--color-border)]"
            loading="lazy"
          />
        )
      ) : (
        <div className="w-full aspect-[4/3] bg-[color:var(--color-border)] flex items-center justify-center text-4xl">
          🎨
        </div>
      )}

      <div className="p-4">
        {lead.art_type ? (
          <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-p1)] mb-2">
            {lead.art_type}
          </span>
        ) : null}
        <p className="text-sm text-[color:var(--color-ink)] mb-3 min-h-[2.5rem]">
          {caption}
        </p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-base font-bold text-[color:var(--color-ink)]">
            {formatPrice(lead.price)}
          </span>
          <button
            type="button"
            onClick={onComprar}
            disabled={isComprarando}
            className="px-4 py-2 bg-[color:var(--color-ink)] text-white rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            aria-label="Comprar contato deste lead"
          >
            {isComprarando ? 'Comprando…' : 'Comprar contato'}
          </button>
        </div>
      </div>
    </article>
  );
}

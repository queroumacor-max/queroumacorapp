// AvisosDaLoja — os avisos que a Cali Colors publica pelo portal (aba
// "Avisos"), no topo da tela de notificações. Com foto ou vídeo opcional
// (2026-11-06). Falha ao carregar não derruba a lista de notificações: a
// seção só some.

'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchAvisos, type Aviso } from '@/lib/services/announcements';
import { isVideoPost } from '@/lib/utils';

function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function MidiaDoAviso({ a }: { a: Aviso }) {
  if (!a.media_url) return null;
  if (isVideoPost(a.media_url, a.media_type)) {
    return (
      <video
        src={a.media_url}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-lg bg-black mt-2"
        style={{ maxHeight: 360 }}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={a.media_url}
      alt={a.title || 'Imagem do aviso'}
      loading="lazy"
      className="w-full rounded-lg mt-2 object-contain bg-[color:var(--color-bg)]"
      style={{ maxHeight: 360 }}
    />
  );
}

export function AvisosDaLoja() {
  const { data } = useQuery({
    queryKey: ['avisos-loja'],
    queryFn: fetchAvisos,
    staleTime: 60_000,
  });
  const avisos = data || [];
  if (avisos.length === 0) return null;

  return (
    <section className="mb-4" aria-label="Avisos da Cali Colors">
      <h2 className="text-xs font-bold uppercase tracking-wide text-[color:var(--color-muted)] mb-2">
        📢 Avisos da Cali Colors
      </h2>
      <ul className="space-y-2">
        {avisos.map((a) => (
          <li
            key={a.id}
            className="p-3 rounded-xl bg-white border border-[color:var(--color-p1)]/30"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-sm break-words min-w-0">{a.title}</span>
              <span className="text-xs text-[color:var(--color-muted)] shrink-0">
                {dataCurta(a.created_at)}
              </span>
            </div>
            {a.message ? (
              <p className="text-sm text-[color:var(--color-muted)] mt-1 break-words whitespace-pre-wrap">
                {a.message}
              </p>
            ) : null}
            <MidiaDoAviso a={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

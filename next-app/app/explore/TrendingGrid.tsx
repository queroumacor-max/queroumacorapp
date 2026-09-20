'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchTrendingPosts, type TrendingPost } from '@/lib/services/trending';
import { cfImg } from '@/lib/cfImg';
import { isVideoPost } from '@/lib/utils';
import { ListSkeleton } from '@/components/Skeletons';

export function TrendingGrid() {
  const query = useQuery<TrendingPost[], Error>({
    queryKey: ['trending-posts', 7],
    queryFn: () => fetchTrendingPosts(30, 7),
    staleTime: 5 * 60_000,
    // Falha rápido (1 tentativa) em vez dos 3 retries default — evita o
    // skeleton "infinito" de ~7s quando a RPC erra; o fallback do service
    // já cobre o caso comum (posts recentes).
    retry: 1,
  });

  if (query.isLoading) return <ListSkeleton count={3} itemHeight={120} />;
  if (query.error) {
    return <p className="text-sm text-red-600">Erro: {query.error.message}</p>;
  }
  if (!query.data || query.data.length === 0) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">
          Sem posts em alta esta semana. Volte em alguns dias.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1">
      {query.data.map((p) => (
        <Link
          key={p.id}
          href={`/post/${p.id}`}
          className="relative block aspect-square overflow-hidden bg-[color:var(--color-border)]"
          title={`${p.score} pontos`}
        >
          {p.media_url ? (
            // Post de VÍDEO em <img> é ícone de imagem quebrada — foi o que
            // a tela mostrava (2026-09-05): metade do grid vinha quebrada e
            // uma miniatura exibia a legenda como texto do `alt`.
            //
            // A detecção olha os DOIS sinais, como no `PostMedia`: extensão
            // da URL e `media_type`. Só o `media_type` não basta — ele marca
            // que o post é STORY, não se a mídia é foto ou vídeo (ver
            // `StoryViewer`), então vídeo com `media_type` nulo ou 'story'
            // escaparia. E só a extensão também não: upload legado pode não
            // ter extensão conhecida na URL.
            isVideoPost(p.media_url, p.media_type) ? (
              <video
                src={p.media_url}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  // WebView Android não pinta o primeiro quadro de um vídeo
                  // parado — fica o play cinza do sistema (mesmo bug do feed,
                  // corrigido em PostMedia.tsx). Um seek mínimo força a
                  // pintura; aqui o vídeo nunca toca sozinho (sem autoplay),
                  // então sem isso a miniatura ficava eternamente no
                  // placeholder do sistema.
                  const v = e.currentTarget;
                  try {
                    if (v.currentTime === 0) v.currentTime = 0.001;
                  } catch { /* seek indisponível — segue sem poster */ }
                }}
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={cfImg(p.media_url, { width: 280, fit: 'cover' })}
                alt={p.caption ?? ''}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  // Fallback: se a URL reescrita pelo cfImg falhar (toggle CF
                  // Image Resizing OFF), tenta a URL original do Supabase.
                  const img = e.currentTarget;
                  if (p.media_url && img.src !== p.media_url) {
                    img.src = p.media_url;
                  }
                }}
                className="w-full h-full object-cover"
              />
            )
          ) : null}
          {isVideoPost(p.media_url, p.media_type) ? (
            <span
              aria-hidden
              className="absolute top-1 left-1 text-[11px] leading-none"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,.6)' }}
            >
              ▶
            </span>
          ) : null}
          <span
            className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-white"
            style={{ background: 'rgba(0,0,0,.55)' }}
          >
            {p.score}
          </span>
        </Link>
      ))}
    </div>
  );
}

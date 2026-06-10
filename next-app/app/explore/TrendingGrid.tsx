'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchTrendingPosts, type TrendingPost } from '@/lib/services/trending';
import { cfImg } from '@/lib/cfImg';
import { ListSkeleton } from '@/components/Skeletons';

export function TrendingGrid() {
  const query = useQuery<TrendingPost[], Error>({
    queryKey: ['trending-posts', 7],
    queryFn: () => fetchTrendingPosts(30, 7),
    staleTime: 5 * 60_000,
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

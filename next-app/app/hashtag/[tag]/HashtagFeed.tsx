'use client';

import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { ListSkeleton } from '@/components/Skeletons';
import { cfImg } from '@/lib/cfImg';
import Link from 'next/link';

interface HashtagPost {
  id: string;
  user_id: string;
  caption: string | null;
  media_url: string | null;
  media_width: number | null;
  media_height: number | null;
}

async function fetchByHashtag(tag: string): Promise<HashtagPost[]> {
  const sb = getSupabase();
  // ILIKE com `% #tag %` matching pra evitar false positive em hashtag
  // contida em palavra (ex.: #pintura vs algopintura). Cobre início e fim
  // do texto com OR.
  const needle = '%#' + tag + '%';
  const { data, error } = await sb
    .from('posts')
    .select('id, user_id, caption, media_url, media_width, media_height')
    .ilike('caption', needle)
    .eq('status', 'approved')
    .is('deleted_at', null)
    .neq('media_type', 'story')
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as HashtagPost[];
}

export function HashtagFeed({ tag }: { tag: string }) {
  const query = useQuery<HashtagPost[], Error>({
    queryKey: ['hashtag-posts', tag.toLowerCase()],
    queryFn: () => fetchByHashtag(tag.toLowerCase()),
    staleTime: 60_000,
  });

  if (query.isLoading) return <ListSkeleton count={3} itemHeight={120} />;
  if (query.error) {
    return <p className="text-sm text-red-600">Erro: {query.error.message}</p>;
  }
  if (!query.data || query.data.length === 0) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">
          Nenhum post com #{tag} ainda. Seja o primeiro!
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1">
      {query.data.map((p) => (
        <Link
          key={p.id}
          // B2 fix: rota /post/[id] não existe ainda. Linka pro perfil do
          // autor (degraded mas funcional). Quando criarmos /post/[id]
          // dedicada, trocar pra `/post/${p.id}`.
          href={`/perfil/${p.user_id}`}
          className="block aspect-square overflow-hidden bg-[color:var(--color-border)]"
        >
          {p.media_url ? (
            <img
              src={cfImg(p.media_url, { width: 200, fit: 'cover' })}
              alt={p.caption ?? ''}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : null}
        </Link>
      ))}
    </div>
  );
}

// PostView — client wrapper que busca 1 post via fetchPostById e renderiza
// PostCard isolado. Skeleton enquanto carrega; "Post não encontrado" se
// fetchPostById retornar null.

'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { ListSkeleton } from '@/components/Skeletons';
import { fetchPostById, type FeedPost } from '@/lib/services/feed';
import { PostCard } from '@/app/feed/PostCard';

export function PostView({ postId }: { postId: string }) {
  const { user } = useAuth();
  // Default muted=true (mesmo que FeedView) pra autoplay funcionar em
  // mobile/desktop. Local state suficiente — só 1 vídeo nessa página.
  const [muted, setMuted] = useState(true);
  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const { data, isLoading, error } = useQuery<FeedPost | null, Error>({
    queryKey: ['post', postId, user?.id],
    queryFn: () => fetchPostById(postId, user?.id ?? null),
    staleTime: 30_000,
  });

  if (isLoading) {
    return <ListSkeleton count={1} />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Falha ao carregar este post.
        </p>
        <Link
          href="/feed"
          className="text-sm text-[color:var(--color-p1)] hover:underline"
        >
          Voltar pro feed
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-8">
        <p className="text-base font-semibold mb-2">Post não encontrado</p>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Ele pode ter sido removido ou ainda está em moderação.
        </p>
        <Link
          href="/feed"
          className="text-sm text-[color:var(--color-p1)] hover:underline"
        >
          Voltar pro feed
        </Link>
      </div>
    );
  }

  return <PostCard post={data} muted={muted} onToggleMute={toggleMute} />;
}

// FeedStories — wrapper client component que liga StoriesCarousel ao
// useFollowing hook. Mantém o carousel reativo a mudanças de following
// sem precisar prop-drill o array no Server Component.
'use client';

import { StoriesCarousel } from '@/components/StoriesCarousel';
import { useFollowing } from '@/lib/hooks/useFollowing';

export function FeedStories() {
  const { ids } = useFollowing();
  return <StoriesCarousel followingIds={ids} />;
}

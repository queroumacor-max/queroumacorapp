// FeedStories — wrapper client component que liga StoriesCarousel ao
// useFollowing hook. Quando o user clica em "Seu story" (sem story
// próprio), abre um BottomSheet com o Composer (Story/Post tabs) —
// match vanilla #post-modal que abre como overlay.
'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { StoriesCarousel } from '@/components/StoriesCarousel';
import { BottomSheet } from '@/components/BottomSheet';
import { Composer } from '@/app/publicar/Composer';
import { useAuth } from '@/components/AuthProvider';
import { useFollowing } from '@/lib/hooks/useFollowing';

export function FeedStories() {
  const { ids } = useFollowing();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);

  function handleClose() {
    setComposerOpen(false);
    // Invalida feed + stories pra refletir o post recém-criado (se publicou).
    qc.invalidateQueries({ queryKey: ['feed'] });
    qc.invalidateQueries({ queryKey: ['stories', user?.id] });
  }

  return (
    <>
      <StoriesCarousel
        followingIds={ids}
        onCreateStory={() => setComposerOpen(true)}
      />
      <BottomSheet
        open={composerOpen}
        onClose={handleClose}
        ariaLabel="Nova publicação"
      >
        <h2
          className="text-center font-extrabold"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            color: 'var(--color-ink)',
            marginBottom: 14,
          }}
        >
          Nova Publicação
        </h2>
        <Composer onPublishSuccess={handleClose} embedded />
      </BottomSheet>
    </>
  );
}

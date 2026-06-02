// Página /feed — Server Component shell envolto pelo AppShell (TopNav +
// BottomNav). FeedView carrega posts via TanStack; StoriesCarousel fica
// acima do feed espelhando o vanilla (stories-row em screen-home).

import type { Metadata } from 'next';
import { FeedView } from './FeedView';
import { FeedStories } from './FeedStories';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Feed | QueroUmaCor',
  description:
    'Timeline de posts dos pintores, grafiteiros e estudios que voce segue.',
};

export default function FeedPage() {
  return (
    <AppShell>
      <FeedStories />
      <FeedView />
    </AppShell>
  );
}

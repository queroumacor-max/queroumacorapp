// Página /feed — Server Component shell envolto pelo AppShell (TopNav +
// BottomNav). FeedView orquestra Stories + filtros + posts, com
// Stories+filtros num único container sticky no topo do main rolável
// (só os posts rolam).

import type { Metadata } from 'next';
import { FeedView } from './FeedView';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Feed | QueroUmaCor',
  description:
    'Timeline de posts dos pintores, grafiteiros e estudios que voce segue.',
};

export default function FeedPage() {
  return (
    <AppShell>
      <FeedView />
    </AppShell>
  );
}

// /post/[id] — página dedicada de um post (linkada por /hashtag e /explore).
// Server Component shell com metadata estática; PostView (client) busca via
// fetchPostById + renderiza PostCard isolado.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { PostView } from './PostView';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages, que exigia o
// contrário; ver ADR 0006 e docs/adr/0006-workers-migration-artifacts.md).
export const runtime = 'nodejs';

interface Params { id: string }

export const metadata: Metadata = {
  title: 'Post | QueroUmaCor',
};

export default async function PostPage({
  params,
}: { params: Promise<Params> }) {
  const { id } = await params;
  return (
    <AppShell>
      <div className="p-4">
        <PostView postId={id} />
      </div>
    </AppShell>
  );
}

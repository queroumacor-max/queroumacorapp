// /post/[id] — página dedicada de um post (linkada por /hashtag e /explore).
// Server Component shell com metadata estática; PostView (client) busca via
// fetchPostById + renderiza PostCard isolado.

import type { Metadata } from 'next';
import { PostView } from './PostView';

// Cloudflare Pages (next-on-pages) exige edge runtime explícito por rota.
export const runtime = 'edge';

interface Params { id: string }

export const metadata: Metadata = {
  title: 'Post | QueroUmaCor',
};

export default async function PostPage({
  params,
}: { params: Promise<Params> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen p-4 max-w-2xl mx-auto">
      <PostView postId={id} />
    </main>
  );
}

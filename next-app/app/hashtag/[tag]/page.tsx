// /hashtag/[tag] — busca posts cuja caption contém #tag (case-insensitive).
// Não há índice GIN em caption pra ILIKE, mas search_vector (Wave 6 FTS)
// cobre. Por simplicidade, ILIKE no client pra cobrir caption — adequado
// pra volume médio. Quando virar gargalo, índice GIN trigram em caption.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { HashtagFeed } from './HashtagFeed';

// Cloudflare Pages (next-on-pages) exige edge runtime explícito por rota.
export const runtime = 'edge';

interface Params { tag: string }

export async function generateMetadata({
  params,
}: { params: Promise<Params> }): Promise<Metadata> {
  const { tag } = await params;
  return {
    title: `#${tag} | QueroUmaCor`,
  };
}

export default async function HashtagPage({
  params,
}: { params: Promise<Params> }) {
  const { tag } = await params;
  return (
    <AppShell>
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          #{decodeURIComponent(tag)}
        </h1>
        <HashtagFeed tag={decodeURIComponent(tag)} />
      </div>
    </AppShell>
  );
}

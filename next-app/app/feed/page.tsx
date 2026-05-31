// Página /feed — Server Component shell.
// Equivalente à tela `#screen-home` do vanilla (rendered por loadFeed em
// modules/feed.js). Aqui o RSC só monta o layout estático; toda a parte
// interativa (fetch via TanStack useInfiniteQuery, filtro por role, infinite
// scroll, autoplay de vídeo, mute compartilhado) vive em FeedView, que é
// client-side.
//
// Por que separar? Mesmo padrão de notificacoes/pedidos: RSC dá HTML pronto
// pra crawler/preview e o client component só hidrata o conteúdo dinâmico.

import type { Metadata } from 'next';
import { FeedView } from './FeedView';

export const metadata: Metadata = {
  title: 'Feed | QueroUmaCor',
  description:
    'Timeline de posts dos pintores, grafiteiros e estudios que voce segue.',
};

export default function FeedPage() {
  return (
    <main className="min-h-screen max-w-2xl mx-auto bg-[color:var(--color-bg)]">
      <FeedView />
    </main>
  );
}

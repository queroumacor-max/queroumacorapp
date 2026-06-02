// Página /search — Server Component shell. Todo o layout fica no
// SearchResults (header dark sticky com input + sugestões + grupos).

import type { Metadata } from 'next';
import { SearchResults } from './SearchResults';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Buscar | QueroUmaCor',
  description:
    'Encontre pintores, posts e produtos da loja com busca por palavra-chave.',
};

export default function SearchPage() {
  return (
    <AppShell>
      <SearchResults />
    </AppShell>
  );
}

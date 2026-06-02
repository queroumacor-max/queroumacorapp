// Página /search — Server Component shell.
// Full-text search agregado (profiles + posts + products) via RPC search_all.
// Equivalente à barra "🔎" do vanilla, mas centralizado numa página dedicada
// (suporta deeplink ?q=foo). RSC só monta o layout; toda a parte interativa
// (input debounced + fetch + render dos grupos) vive em SearchResults.

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
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Buscar
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Pintores, posts e produtos — tudo num lugar só.
      </p>
      <SearchResults />
    </div></AppShell>
  );
}

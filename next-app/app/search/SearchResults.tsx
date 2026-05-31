// SearchResults — client component que orquestra a busca full-text.
//
// Espelha o output esperado do RPC search_all: 3 grupos (Pintores, Posts,
// Produtos) ordenados pelo `score` do ts_rank. O hook useSearch já faz o
// debounce (300ms) + cache TanStack; aqui o componente só:
//  - controla o input (estado local, sem URL syncing por enquanto);
//  - agrupa results por result_type pra exibição em seções;
//  - mostra empty/loading/error states amigáveis.
//
// Link de cada resultado:
//  - profile → /perfil/<id> (rota já existe; se ainda não tiver dynamic
//    route, o link cai num 404 controlado pelo Next, sem quebrar o app);
//  - post → /feed (sem rota individual por post hoje; volta pro feed);
//  - product → /loja/<id> (rota /loja/[id] já existe).
//
// Decisão: usamos `dangerouslySetInnerHTML` no snippet porque `ts_headline`
// envolve os hits em `<b>...</b>` por default. Antes de renderizar, sanitizamos
// removendo qualquer tag que NÃO seja <b>/</b> — protege contra um futuro
// caption malicioso que tenha HTML cru no banco.

'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearch } from '@/lib/hooks/useSearch';
import type { SearchResult, SearchResultType } from '@/lib/services/search';

// Whitelist mínima — só <b> (e </b>) é permitido. Qualquer outra tag vira
// texto plano. Robusto pra ts_headline + defensivo contra HTML injection.
const SNIPPET_TAG_RX = /<\/?([a-z][a-z0-9]*)[^>]*>/gi;
function sanitizeSnippet(raw: string): string {
  if (!raw) return '';
  return raw.replace(SNIPPET_TAG_RX, (full, tag) =>
    String(tag).toLowerCase() === 'b' ? full : '',
  );
}

const TYPE_LABEL: Record<SearchResultType, string> = {
  profile: 'Pintores',
  post: 'Posts',
  product: 'Produtos',
};

const TYPE_ICON: Record<SearchResultType, string> = {
  profile: '👤',
  post: '🖼️',
  product: '🪣',
};

function hrefFor(r: SearchResult): string {
  switch (r.result_type) {
    case 'profile':
      return `/perfil/${r.id}`;
    case 'product':
      return `/loja/${r.id}`;
    case 'post':
    default:
      return '/feed';
  }
}

function ResultCard({ r }: { r: SearchResult }) {
  const snippet = useMemo(() => sanitizeSnippet(r.snippet || ''), [r.snippet]);
  return (
    <Link
      href={hrefFor(r)}
      className="flex items-start gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] hover:bg-[color:var(--color-bg)] transition-colors"
    >
      <span
        className="w-9 h-9 rounded-full bg-[color:var(--color-ink)] text-white flex items-center justify-center flex-shrink-0 text-lg"
        aria-hidden="true"
      >
        {TYPE_ICON[r.result_type]}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-sm truncate">
          {r.title || '(sem título)'}
        </span>
        {snippet ? (
          <span
            className="block text-xs text-[color:var(--color-muted)] line-clamp-2"
            dangerouslySetInnerHTML={{ __html: snippet }}
          />
        ) : null}
      </span>
    </Link>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)] animate-pulse">
      <div className="w-9 h-9 rounded-full bg-[color:var(--color-border)]" />
      <div className="flex-1">
        <div className="h-3 w-2/3 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
      </div>
    </div>
  );
}

export function SearchResults() {
  const [query, setQuery] = useState('');
  const { results, loading, error, debouncedQuery } = useSearch(query);

  // Agrupa results por type. Mantém a ordem original (já vem por score DESC
  // do banco) — só separa pra renderizar em seções.
  const grouped = useMemo(() => {
    const out: Record<SearchResultType, SearchResult[]> = {
      profile: [],
      post: [],
      product: [],
    };
    for (const r of results) {
      if (r.result_type in out) out[r.result_type].push(r);
    }
    return out;
  }, [results]);

  const hasAnyResult = results.length > 0;
  const tooShort = query.trim().length > 0 && query.trim().length < 2;

  return (
    <div>
      <label className="block mb-4">
        <span className="sr-only">Buscar</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar pintores, posts, produtos..."
          autoFocus
          className="w-full px-4 py-3 rounded-xl border border-[color:var(--color-border)] bg-white text-base focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
          aria-label="Buscar"
        />
      </label>

      {tooShort ? (
        <p className="text-sm text-[color:var(--color-muted)] py-8 text-center">
          Digite pelo menos 2 letras pra começar.
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2" aria-label="Buscando">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-4xl mb-3" aria-hidden="true">
            ⚠️
          </div>
          <p className="text-sm text-[color:var(--color-muted)]">
            Não foi possível buscar agora. Tente de novo.
          </p>
        </div>
      ) : null}

      {!loading && !error && debouncedQuery.length >= 2 && !hasAnyResult ? (
        <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-5xl mb-3" aria-hidden="true">
            🔎
          </div>
          <h2 className="font-semibold mb-2">Nada encontrado</h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            Não achamos nada pra <span className="font-mono">{debouncedQuery}</span>.
            Tente outras palavras ou veja o feed completo.
          </p>
        </div>
      ) : null}

      {!loading && !error && hasAnyResult ? (
        <div className="space-y-6">
          {(['profile', 'post', 'product'] as SearchResultType[]).map((type) =>
            grouped[type].length > 0 ? (
              <section key={type} aria-label={TYPE_LABEL[type]}>
                <h2 className="text-sm font-semibold mb-2 text-[color:var(--color-muted)]">
                  {TYPE_LABEL[type]} ({grouped[type].length})
                </h2>
                <ul className="space-y-2">
                  {grouped[type].map((r) => (
                    <li key={`${r.result_type}-${r.id}`}>
                      <ResultCard r={r} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      ) : null}

      {!query.trim() ? (
        <div className="text-center py-12 px-4 rounded-xl bg-white/40 border border-[color:var(--color-border)] mt-4">
          <div className="text-5xl mb-3" aria-hidden="true">
            🔎
          </div>
          <p className="text-sm text-[color:var(--color-muted)]">
            Comece digitando uma palavra-chave acima.
          </p>
        </div>
      ) : null}
    </div>
  );
}

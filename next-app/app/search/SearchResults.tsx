// SearchResults — client component que orquestra a busca + sugestões.
//
// Quando o input está vazio: mostra "SUGESTÕES PARA VOCÊ" (lista de
// perfis pra seguir) — espelha o `loadPeopleSuggestions()` do vanilla
// (head.js linha 1230+). Usa `fetchSuggestedProfiles` (filtra próprio
// user + quem já segue) e exibe avatar + nome + tag + botão Seguir.
//
// Com input ≥ 2 letras: chama o RPC `search_all` (3 grupos: Pintores,
// Posts, Produtos) ordenado por ts_rank, igual ao vanilla searchPeople
// só que mais rico (vanilla só buscava profiles).
//
// Header dark sticky com input + ícone de lupa absoluto, igual o
// `.mkt-search` do vanilla (styles.css linha 691+).

'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useFollowing } from '@/lib/hooks/useFollowing';
import { DB } from '@/lib/db';
import { useSearch } from '@/lib/hooks/useSearch';
import { fetchSuggestedProfiles } from '@/lib/services/suggestedProfiles';
import { Avatar } from '@/components/Avatar';
import { showToast } from '@/lib/toast';
import type { SearchResult, SearchResultType } from '@/lib/services/search';
import type { Profile } from '@/lib/types';

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

// ─── SUGGESTIONS ──────────────────────────────────────────────────────────

function SuggestionCard({
  profile,
  isFollowing,
  onFollow,
  onUnfollow,
}: {
  profile: Profile;
  isFollowing: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
}) {
  const name = profile.name || (profile.tag ? '@' + profile.tag : 'Usuário');
  const city = profile.city ? profile.city : '';
  const isPintor = profile.role === 'pintor' || profile.role === 'grafiteiro' || profile.role === 'automotivo';

  return (
    <div
      className="flex items-center gap-3 bg-white"
      style={{
        padding: '12px 16px',
        borderRadius: 14,
        boxShadow: '0 1px 4px rgba(0,0,0,.04)',
      }}
    >
      <Link href={`/perfil/${profile.id}`} className="flex-shrink-0">
        <Avatar profile={profile} size={48} />
      </Link>
      <Link href={`/perfil/${profile.id}`} className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className="font-bold truncate"
            style={{ fontSize: 14, color: 'var(--color-ink)' }}
          >
            {name}
          </span>
          {isPintor ? (
            <span
              className="font-extrabold"
              style={{
                background: 'var(--color-ink)',
                color: 'var(--color-p1)',
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                letterSpacing: '.05em',
              }}
            >
              {profile.role === 'pintor' ? 'PINTOR' : profile.role === 'grafiteiro' ? 'GRAFITEIRO' : 'AUTO'}
            </span>
          ) : null}
        </div>
        {profile.tag ? (
          <div
            className="truncate"
            style={{ fontSize: 12, color: 'var(--color-muted)' }}
          >
            @{profile.tag}
            {city ? ' · ' + city : ''}
          </div>
        ) : city ? (
          <div className="truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {city}
          </div>
        ) : null}
      </Link>
      <button
        type="button"
        onClick={isFollowing ? onUnfollow : onFollow}
        className="font-bold flex-shrink-0"
        style={{
          padding: '7px 16px',
          borderRadius: 10,
          fontSize: 12,
          background: isFollowing ? 'transparent' : 'var(--color-ink)',
          color: isFollowing ? 'var(--color-ink)' : '#fff',
          border: isFollowing ? '1.5px solid var(--color-border)' : 'none',
          cursor: 'pointer',
        }}
      >
        {isFollowing ? 'Seguindo' : 'Seguir'}
      </button>
    </div>
  );
}

function SuggestionsList() {
  const { user } = useAuth();
  const { ids: followingIds, invalidate: invalidateFollowing } = useFollowing();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Optimistic state local — evita esperar refetch da network depois do toggle.
  const [localFollowing, setLocalFollowing] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setError(null);
    fetchSuggestedProfiles(user?.id ?? null, 18)
      .then((rows) => {
        if (cancel) return;
        setProfiles(rows);
      })
      .catch((e) => {
        if (cancel) return;
        setError(e?.message || 'Erro ao carregar sugestões');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [user?.id]);

  useEffect(() => {
    setLocalFollowing(new Set(followingIds));
  }, [followingIds]);

  async function handleFollow(profileId: string) {
    if (!user) {
      showToast('Faça login pra seguir', 'error');
      return;
    }
    setLocalFollowing((s) => new Set(s).add(profileId));
    const r = await DB.follows.follow(user.id, profileId);
    if (!r.ok) {
      setLocalFollowing((s) => {
        const n = new Set(s);
        n.delete(profileId);
        return n;
      });
      showToast(
        `Não foi possível seguir: ${r.message || r.code || 'erro desconhecido'}`,
        'error',
      );
      return;
    }
    invalidateFollowing();
  }

  async function handleUnfollow(profileId: string) {
    if (!user) return;
    setLocalFollowing((s) => {
      const n = new Set(s);
      n.delete(profileId);
      return n;
    });
    const r = await DB.follows.unfollow(user.id, profileId);
    if (!r.ok) {
      setLocalFollowing((s) => new Set(s).add(profileId));
      showToast(
        `Não foi possível deixar de seguir: ${r.message || r.code || 'erro desconhecido'}`,
        'error',
      );
      return;
    }
    invalidateFollowing();
  }

  if (loading) {
    return (
      <div className="space-y-2" aria-label="Carregando sugestões">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (error || !profiles || profiles.length === 0) {
    return (
      <div className="text-center py-8 px-4 rounded-xl bg-white/50">
        <div className="text-3xl mb-2" aria-hidden="true">👥</div>
        <p className="text-sm text-[color:var(--color-muted)]">
          {error || 'Sem sugestões agora — tente buscar pelo nome.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {profiles.map((p) => (
        <SuggestionCard
          key={p.id}
          profile={p}
          isFollowing={localFollowing.has(p.id)}
          onFollow={() => handleFollow(p.id)}
          onUnfollow={() => handleUnfollow(p.id)}
        />
      ))}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────

export function SearchResults() {
  const [query, setQuery] = useState('');
  const { results, loading, error, debouncedQuery } = useSearch(query);

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
  const showSuggestions = !query.trim();

  return (
    <>
      {/* Header dark sticky com input + ícone lupa */}
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'var(--color-ink)',
          padding: '14px 16px',
        }}
      >
        <label className="relative block" role="search">
          <span className="sr-only">Buscar</span>
          <span
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{ left: 14, top: '50%', transform: 'translateY(-50%)' }}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="var(--color-p1)"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.5" y2="16.5" />
            </svg>
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar pintores, posts, produtos..."
            autoFocus
            className="w-full text-white outline-none"
            aria-label="Buscar"
            style={{
              padding: '12px 16px 12px 42px',
              borderRadius: 26,
              border: '1.5px solid rgba(255,255,255,.14)',
              background: 'rgba(255,255,255,.07)',
              fontSize: 14,
            }}
          />
        </label>
      </header>

      <div className="px-3 pt-3 pb-4">
        {/* Sugestões — só quando input vazio */}
        {showSuggestions ? (
          <section aria-label="Sugestões para você">
            <h2
              className="font-bold uppercase mb-3"
              style={{
                fontSize: 12,
                color: 'var(--color-muted)',
                letterSpacing: '.05em',
                paddingLeft: 4,
              }}
            >
              Sugestões para você
            </h2>
            <SuggestionsList />
          </section>
        ) : null}

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
            <div className="text-4xl mb-3" aria-hidden="true">⚠️</div>
            <p className="text-sm text-[color:var(--color-muted)]">
              Não foi possível buscar agora. Tente de novo.
            </p>
          </div>
        ) : null}

        {!loading && !error && debouncedQuery.length >= 2 && !hasAnyResult ? (
          <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
            <div className="text-5xl mb-3" aria-hidden="true">🔎</div>
            <h2 className="font-semibold mb-2">Nada encontrado</h2>
            <p className="text-sm text-[color:var(--color-muted)]">
              Não achamos nada pra <span className="font-mono">{debouncedQuery}</span>.
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
      </div>
    </>
  );
}

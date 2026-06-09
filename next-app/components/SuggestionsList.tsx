// SuggestionsList — bloco "Sugestões pra você seguir" (S2). Lista
// pintores próximos / bem avaliados que o user ainda não segue. Usa RPC
// suggest_to_follow (servidor já exclui blocked + seguidos + admin).

'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { Avatar } from '@/components/Avatar';
import { ListSkeleton } from '@/components/Skeletons';
import { useFollow } from '@/lib/hooks/useFollow';
import { fetchSuggestions, type SuggestionRow } from '@/lib/services/suggestions';

export function SuggestionsList({ limit = 8 }: { limit?: number }) {
  const { user } = useAuth();
  const query = useQuery<SuggestionRow[], Error>({
    queryKey: ['suggestions', user?.id, limit],
    queryFn: () => fetchSuggestions(limit),
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  if (!user) return null;
  if (query.isLoading) return <ListSkeleton count={3} itemHeight={68} />;
  if (query.error || !query.data || query.data.length === 0) return null;

  return (
    <div className="px-3 mb-4">
      <h2 className="text-sm font-bold mb-2 text-[color:var(--color-ink)]">
        Sugestões pra você seguir
      </h2>
      <div className="space-y-2">
        {query.data.map((s) => (
          <SuggestionRowItem key={s.id} row={s} />
        ))}
      </div>
    </div>
  );
}

function SuggestionRowItem({ row }: { row: SuggestionRow }) {
  const follow = useFollow(row.id);
  const showBadge = row.verified || row.is_pro;
  const subtitle = [row.city, row.state].filter(Boolean).join(' / ');

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)]">
      <Link href={`/perfil/${row.id}`} className="flex-shrink-0">
        <Avatar
          profile={{ id: row.id, name: row.name, tag: row.tag, avatar_url: row.avatar_url }}
          size={40}
        />
      </Link>
      <Link href={`/perfil/${row.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate flex items-center gap-1">
          {row.name || row.tag || 'Usuário'}
          {showBadge ? (
            <span
              aria-label="Verificado"
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{ width: 12, height: 12, borderRadius: '50%', background: '#1d9bf0' }}
            >
              <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          ) : null}
        </p>
        {subtitle ? (
          <p className="text-xs text-[color:var(--color-muted)] truncate">{subtitle}</p>
        ) : null}
      </Link>
      <button
        type="button"
        disabled={follow.isToggling}
        onClick={follow.toggle}
        className={
          'text-xs px-3 py-1.5 rounded-full font-semibold disabled:opacity-50 ' +
          (follow.isFollowing
            ? 'bg-[color:var(--color-border)] text-[color:var(--color-ink)]'
            : 'bg-[color:var(--color-p1)] text-white')
        }
      >
        {follow.isFollowing ? 'Seguindo' : 'Seguir'}
      </button>
    </div>
  );
}

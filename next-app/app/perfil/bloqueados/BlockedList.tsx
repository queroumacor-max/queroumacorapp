'use client';

import { useBlockedList, useBlockMutations } from '@/lib/hooks/useBlocks';
import { useAuth } from '@/components/AuthProvider';
import { Avatar } from '@/components/Avatar';
import { ListSkeleton } from '@/components/Skeletons';
import { showToast } from '@/lib/toast';

export function BlockedList() {
  const { user, loading: authLoading } = useAuth();
  const { data, isLoading, error } = useBlockedList();
  const { unblock, isUnblocking } = useBlockMutations();

  if (authLoading) return <ListSkeleton count={3} itemHeight={68} />;
  if (!user) return <p className="text-sm text-[color:var(--color-muted)]">Faça login.</p>;
  if (isLoading) return <ListSkeleton count={3} itemHeight={68} />;
  if (error) return <p className="text-sm text-red-600">Erro ao carregar lista.</p>;
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <p className="text-sm text-[color:var(--color-muted)]">
          Você não bloqueou ninguém.
        </p>
      </div>
    );
  }

  async function handleUnblock(blockedId: string, name: string) {
    try {
      await unblock(blockedId);
      showToast(`${name} desbloqueado.`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Falha ao desbloquear.', 'error');
    }
  }

  return (
    <div className="space-y-2">
      {data.map((row) => {
        const blocked = row.blocked;
        const name = blocked?.name || blocked?.tag || 'Usuário';
        return (
          <div
            key={row.id}
            className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[color:var(--color-border)]"
          >
            <Avatar
              profile={{
                id: row.blocked_id,
                name: blocked?.name ?? null,
                tag: blocked?.tag ?? null,
                avatar_url: blocked?.avatar_url ?? null,
              }}
              size={40}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{name}</p>
              {blocked?.tag ? (
                <p className="text-xs text-[color:var(--color-muted)] truncate">
                  @{blocked.tag}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={isUnblocking}
              onClick={() => handleUnblock(row.blocked_id, name)}
              className="text-xs px-3 py-1.5 rounded-full bg-[color:var(--color-border)] text-[color:var(--color-ink)] font-semibold disabled:opacity-50"
            >
              Desbloquear
            </button>
          </div>
        );
      })}
    </div>
  );
}

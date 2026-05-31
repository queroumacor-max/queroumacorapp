// NewChatModal — modal pra iniciar nova conversa (busca + lista de usuários).
// Equivalente ao bloco `#new-chat-users-list` + showNewChatModal do vanilla.
//
// Debounce manual (250ms) — não usamos lib externa, useEffect com setTimeout
// + clearTimeout é trivial e zero-dep.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNewChat, useSearchUsers } from '@/lib/hooks/useChat';
import type { UserMini } from '@/lib/services/chat';

export interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  /** IDs já em conversa (pra excluir da busca — evita duplicação). */
  excludeIds?: string[];
}

export function NewChatModal({ open, onClose, excludeIds = [] }: NewChatModalProps) {
  const router = useRouter();
  const [rawQuery, setRawQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const { start, creating, error: startError } = useNewChat();
  const { users, loading, error: searchError } = useSearchUsers(
    debouncedQuery,
    excludeIds,
  );

  // Debounce do input (250ms) — alinhado com vanilla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery), 250);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Reset state ao fechar.
  useEffect(() => {
    if (!open) {
      setRawQuery('');
      setDebouncedQuery('');
    }
  }, [open]);

  if (!open) return null;

  async function handleSelect(user: UserMini): Promise<void> {
    const convId = await start({ otherId: user.id });
    if (convId) {
      onClose();
      router.push(`/chat/${encodeURIComponent(convId)}`);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Nova conversa"
    >
      <div
        className="bg-white w-full max-w-md max-h-[80vh] rounded-t-2xl sm:rounded-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[color:var(--color-border,#e5e5e5)]">
          <h2 className="font-bold text-lg">Nova conversa</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none px-2"
            aria-label="Fechar"
          >
            &times;
          </button>
        </div>

        <div className="p-4 border-b border-[color:var(--color-border,#e5e5e5)]">
          <input
            type="search"
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Buscar por nome ou @tag..."
            className="w-full px-3 py-2 border border-[color:var(--color-border,#e5e5e5)] rounded-lg text-sm"
            autoFocus
            aria-label="Buscar usuário"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {creating ? (
            <p className="text-center py-6 text-sm text-[color:var(--color-muted,#666)]">
              Abrindo conversa...
            </p>
          ) : null}
          {startError ? (
            <p className="text-center py-4 text-sm text-red-600" role="alert">
              {startError.message}
            </p>
          ) : null}

          {debouncedQuery.length < 2 ? (
            <p className="text-center py-6 text-sm text-[color:var(--color-muted,#666)]">
              Digite pelo menos 2 letras para buscar.
            </p>
          ) : loading ? (
            <p className="text-center py-6 text-sm text-[color:var(--color-muted,#666)]">
              Buscando...
            </p>
          ) : searchError ? (
            <p className="text-center py-6 text-sm text-red-600" role="alert">
              Erro ao buscar usuários.
            </p>
          ) : users.length === 0 ? (
            <p className="text-center py-6 text-sm text-[color:var(--color-muted,#666)]">
              Nenhum usuário encontrado.
            </p>
          ) : (
            <ul className="space-y-1">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(u)}
                    disabled={creating}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-[color:var(--color-bg,#f8f8f8)] text-left disabled:opacity-50"
                  >
                    <span className="w-10 h-10 rounded-full overflow-hidden bg-[color:var(--color-border,#e5e5e5)] flex items-center justify-center text-sm font-bold flex-shrink-0">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatarUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (u.name ?? '?').charAt(0).toUpperCase()
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">
                        {u.name ?? 'Sem nome'}
                      </span>
                      {u.tag ? (
                        <span className="block text-xs text-[color:var(--color-muted,#666)] truncate">
                          @{u.tag}
                        </span>
                      ) : null}
                    </span>
                    {u.isProfessional ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[color:var(--color-ink,#111)] text-[color:var(--color-p1,#ff6a00)]">
                        PINTOR
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

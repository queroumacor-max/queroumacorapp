// ConnectionsView — abas Seguidores/Seguindo com busca e ação por linha.
// Espelha o layout do Instagram: contagem na aba, campo de busca, e cada
// linha com avatar + @tag em destaque + nome embaixo + botão à direita
// (Seguir / Seguindo / Mensagem quando já é mútuo ou é o próprio viewer).

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { Avatar } from '@/components/Avatar';
import { DB } from '@/lib/db';
import { showToast } from '@/lib/toast';
import { buildDirectConvId } from '@/lib/services/chat-types';
import {
  fetchConnections,
  filterConnections,
  type ConnectionProfile,
  type ConnectionTab,
} from '@/lib/services/connections';

const TABS: ReadonlyArray<{ key: ConnectionTab; label: string }> = [
  { key: 'seguidores', label: 'seguidores' },
  { key: 'seguindo', label: 'seguindo' },
];

export function ConnectionsView({ profileId }: { profileId: string }) {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ConnectionTab>(() => {
    // Aba inicial pela query — o header manda ?tab= conforme o número tocado.
    if (typeof window === 'undefined') return 'seguidores';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'seguindo' ? 'seguindo' : 'seguidores';
  });
  const [search, setSearch] = useState('');
  // Otimista: o botão responde no toque, sem esperar o refetch.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [override, setOverride] = useState<Record<string, boolean>>({});

  const query = useQuery<ConnectionProfile[], Error>({
    queryKey: ['connections', profileId, tab, user?.id ?? null],
    queryFn: () => fetchConnections({ profileId, tab, viewerId: user?.id ?? null }),
    enabled: !!profileId,
    staleTime: 60_000,
  });

  const list = useMemo(
    () => filterConnections(query.data ?? [], search),
    [query.data, search],
  );

  const dono = query.data;
  const counts = { atual: dono?.length ?? 0 };

  async function toggleFollow(p: ConnectionProfile) {
    if (!user) {
      showToast('Faça login pra seguir.', 'info');
      return;
    }
    const current = override[p.id] ?? p.followedByViewer;
    setPending((s) => ({ ...s, [p.id]: true }));
    setOverride((s) => ({ ...s, [p.id]: !current })); // otimista
    const r = current
      ? await DB.follows.unfollow(user.id, p.id)
      : await DB.follows.follow(user.id, p.id);
    setPending((s) => ({ ...s, [p.id]: false }));
    if (!r.ok) {
      setOverride((s) => ({ ...s, [p.id]: current })); // desfaz
      showToast(r.message || 'Não consegui completar a ação.', 'error');
      return;
    }
    // Contagens do perfil e listas dependentes mudaram.
    qc.invalidateQueries({ queryKey: ['profile'] });
    qc.invalidateQueries({ queryKey: ['connections'] });
  }

  function openChat(p: ConnectionProfile) {
    if (!user) {
      showToast('Faça login pra conversar.', 'info');
      return;
    }
    router.push(`/chat/${encodeURIComponent(buildDirectConvId(user.id, p.id))}`);
  }

  return (
    <div className="px-3 pt-3 pb-6">
      {/* Abas */}
      <div className="flex border-b" style={{ borderColor: 'var(--color-border)' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setSearch('');
              }}
              className="flex-1 font-bold"
              style={{
                padding: '12px 8px',
                background: 'none',
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--color-ink)'
                  : '2px solid transparent',
                color: active ? 'var(--color-ink)' : 'var(--color-muted)',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              {active ? `${counts.atual} ` : ''}
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Busca */}
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar"
        aria-label="Buscar nesta lista"
        className="w-full outline-none"
        style={{
          margin: '12px 0',
          padding: '10px 14px',
          borderRadius: 12,
          border: '1.5px solid var(--color-border)',
          background: 'var(--color-white)',
        }}
      />

      {query.isLoading ? (
        <ul className="space-y-3" aria-label="Carregando">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-11 h-11 rounded-full bg-[color:var(--color-border)]" />
              <div className="flex-1">
                <div className="h-3 w-1/3 bg-[color:var(--color-border)] rounded mb-2" />
                <div className="h-2 w-1/2 bg-[color:var(--color-border)] rounded" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {query.error ? (
        <p className="text-sm text-red-600 py-6 text-center">
          Não consegui carregar: {query.error.message}
        </p>
      ) : null}

      {query.data && list.length === 0 ? (
        <p className="text-sm text-[color:var(--color-muted)] py-10 text-center">
          {search
            ? 'Ninguém encontrado com esse nome.'
            : tab === 'seguidores'
              ? 'Ainda sem seguidores por aqui.'
              : 'Ainda não está seguindo ninguém.'}
        </p>
      ) : null}

      <ul className="space-y-1">
        {list.map((p) => {
          const following = override[p.id] ?? p.followedByViewer;
          const busy = !!pending[p.id];
          return (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <Link href={`/perfil/${p.id}`} className="flex-shrink-0">
                <Avatar
                  profile={{
                    id: p.id,
                    name: p.name,
                    tag: p.tag,
                    avatar_url: p.avatarUrl,
                  }}
                  size={44}
                />
              </Link>
              <Link href={`/perfil/${p.id}`} className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">
                  {p.tag ? '@' + p.tag : p.name || 'Usuário'}
                </div>
                <div className="text-xs text-[color:var(--color-muted)] truncate">
                  {p.name || ''}
                  {p.city ? ` · ${p.city}` : ''}
                </div>
              </Link>
              {p.isViewer ? (
                <span className="text-xs text-[color:var(--color-muted)] flex-shrink-0">
                  você
                </span>
              ) : following ? (
                // Já segue: o atalho útil é conversar (como no IG). O
                // "Seguindo" fica como toque secundário pra deixar de seguir.
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => openChat(p)}
                    className="font-bold"
                    style={{
                      padding: '7px 14px',
                      borderRadius: 10,
                      fontSize: 12,
                      background: 'var(--color-cream)',
                      color: 'var(--color-ink)',
                      border: '1px solid var(--color-border)',
                      cursor: 'pointer',
                    }}
                  >
                    Mensagem
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFollow(p)}
                    disabled={busy}
                    aria-label={`Deixar de seguir ${p.tag || p.name || ''}`}
                    title="Toque para deixar de seguir"
                    className="font-bold"
                    style={{
                      padding: '7px 10px',
                      borderRadius: 10,
                      fontSize: 12,
                      background: 'transparent',
                      color: 'var(--color-muted)',
                      border: '1px solid var(--color-border)',
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.6 : 1,
                    }}
                  >
                    {busy ? '…' : 'Seguindo'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleFollow(p)}
                  disabled={busy}
                  className="font-bold text-white flex-shrink-0"
                  style={{
                    padding: '7px 16px',
                    borderRadius: 10,
                    fontSize: 12,
                    background: 'var(--color-p1)',
                    border: 'none',
                    cursor: busy ? 'wait' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? '…' : 'Seguir'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

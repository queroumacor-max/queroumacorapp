// MediaReviewAdmin — client component que lista a fila de revisão de
// mídia com filtro por status e botões Aprovar / Bloquear / Escalar NCMEC.
// RLS no banco barra escrita de não-admin; gate aqui é cosmético (UX) e
// segue o pattern do ReportsAdmin.
//
// Ações:
//   - Aprovar: marca como reviewed (não bloqueia mídia)
//   - Bloquear permanente: adiciona hash em blocklist (categoria
//     'reported') + soft-delete do post
//   - Escalar NCMEC: marca hash como csam + reported_to_ncmec, soft-delete
//     do post. Envio formal pra NCMEC é manual (ver docs/CSAM_POLICY.md).

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { isAdmin } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { getTimeAgo } from '@/lib/utils';
import { ListSkeleton } from '@/components/Skeletons';
import {
  fetchMediaReviewQueue,
  approveMediaReview,
  blockMediaPermanent,
  escalateToNcmec,
  dismissMediaReview,
  type MediaReviewRow,
  type MediaReviewStatus,
  type MediaReviewSeverity,
} from '@/lib/services/mediaReviewAdmin';

type Filter = MediaReviewStatus | 'all';
const FILTERS: { label: string; value: Filter }[] = [
  { label: 'Pendentes', value: 'pending' },
  { label: 'Revisadas', value: 'reviewed' },
  { label: 'Dispensadas', value: 'dismissed' },
  { label: 'Escaladas NCMEC', value: 'escalated_ncmec' },
  { label: 'Todas', value: 'all' },
];

export function MediaReviewAdmin() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const admin = isAdmin(policyUser);
  const [filter, setFilter] = useState<Filter>('pending');
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['admin-media-review', filter],
    queryFn: () => fetchMediaReviewQueue({ status: filter, limit: 50 }),
    enabled: !!user && admin,
    staleTime: 30_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['admin-media-review'] });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveMediaReview(id),
    onSuccess: invalidate,
  });
  const dismissMut = useMutation({
    mutationFn: (id: string) => dismissMediaReview(id),
    onSuccess: invalidate,
  });
  const blockMut = useMutation({
    mutationFn: (row: MediaReviewRow) =>
      blockMediaPermanent({
        reviewId: row.id,
        hash: row.media_hash || '',
        postId: row.post_id,
        category: 'reported',
        notes: row.reason,
      }),
    onSuccess: invalidate,
  });
  const escalateMut = useMutation({
    mutationFn: (row: MediaReviewRow) =>
      escalateToNcmec({
        reviewId: row.id,
        hash: row.media_hash || '',
        postId: row.post_id,
        notes: row.reason,
      }),
    onSuccess: invalidate,
  });

  if (authLoading) {
    return <ListSkeleton count={3} itemHeight={140} />;
  }
  if (!user) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">Faça login.</p>
    );
  }
  if (!admin) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Sem acesso. Esta área é restrita ao painel admin.
      </p>
    );
  }

  const isUpdating =
    approveMut.isPending ||
    dismissMut.isPending ||
    blockMut.isPending ||
    escalateMut.isPending;

  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-3 hide-scrollbar">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors flex-shrink-0 ' +
                (active
                  ? 'bg-[color:var(--color-ink)] text-white border-[color:var(--color-ink)]'
                  : 'bg-white text-[color:var(--color-ink)] border-[color:var(--color-border)]')
              }
              aria-pressed={active}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {query.isLoading ? (
        <ListSkeleton count={4} itemHeight={140} />
      ) : query.error ? (
        <p className="text-sm text-red-600">
          Erro: {(query.error as Error).message || 'falha ao carregar'}
        </p>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-4xl mb-3" aria-hidden="true">
            ✅
          </div>
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhuma mídia {filter === 'all' ? '' : `com status "${filter}"`} na fila.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {query.data!.items.map((r) => (
            <ReviewRow
              key={r.id}
              row={r}
              isUpdating={isUpdating}
              onApprove={() => approveMut.mutate(r.id)}
              onDismiss={() => dismissMut.mutate(r.id)}
              onBlock={() => {
                if (
                  window.confirm(
                    'Bloquear permanente este hash + soft-deletar o post? Mídias com esse hash futuras serão bloqueadas automaticamente.',
                  )
                ) {
                  blockMut.mutate(r);
                }
              }}
              onEscalate={() => {
                if (
                  window.confirm(
                    'CONFIRMAR escalada NCMEC?\n\nIsso adiciona o hash à blocklist como CSAM e marca pra report manual via SaferNet/CyberTipline. Veja docs/CSAM_POLICY.md pro procedimento legal completo.',
                  )
                ) {
                  escalateMut.mutate(r);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const severityBadgeClass: Record<MediaReviewSeverity, string> = {
  low: 'bg-gray-100 text-gray-700',
  med: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

const statusBadgeClass: Record<MediaReviewStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  reviewed: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-700',
  escalated_ncmec: 'bg-red-200 text-red-900',
};

function ReviewRow({
  row,
  isUpdating,
  onApprove,
  onDismiss,
  onBlock,
  onEscalate,
}: {
  row: MediaReviewRow;
  isUpdating: boolean;
  onApprove: () => void;
  onDismiss: () => void;
  onBlock: () => void;
  onEscalate: () => void;
}) {
  const userName = row.user?.name || row.user?.tag || 'Usuário';
  const captionSnippet = row.post?.caption
    ? row.post.caption.slice(0, 120) +
      (row.post.caption.length > 120 ? '…' : '')
    : null;
  const hashShort = row.media_hash ? row.media_hash.slice(0, 12) + '…' : '(sem hash)';
  const isImage = /\.(jpe?g|png|webp|gif|heic|heif)(\?|$)/i.test(row.media_url);

  return (
    <div className="p-4 rounded-xl bg-white border border-[color:var(--color-border)]">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass[row.status]}`}
            >
              {row.status}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-semibold ${severityBadgeClass[row.severity]}`}
            >
              {row.severity}
            </span>
            <span className="text-xs text-[color:var(--color-muted)]">
              {getTimeAgo(row.created_at)}
            </span>
          </div>
          <p className="text-sm font-semibold mb-1">{userName}</p>
          <p className="text-xs text-[color:var(--color-muted)] mb-2">
            Motivo: {row.reason}
          </p>
          <p
            className="text-xs text-[color:var(--color-muted)] mb-2 font-mono break-all"
            title={row.media_hash || ''}
          >
            hash: {hashShort}
          </p>
          <div className="flex gap-3 items-start p-2 rounded-lg bg-[color:var(--color-bg)]">
            {isImage ? (
              // Imagem da mídia em quarentena — abre nova aba ao clicar.
              // Evita Next/Image porque a URL é externa do Supabase e
              // mídias suspeitas podem ser pesadas; preferimos lazy + tag bruta.
              // eslint-disable-next-line @next/next/no-img-element
              <a href={row.media_url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.media_url}
                  alt="mídia em revisão"
                  width={64}
                  height={64}
                  loading="lazy"
                  className="rounded object-cover flex-shrink-0"
                  style={{ width: 64, height: 64 }}
                />
              </a>
            ) : (
              <a
                href={row.media_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline flex-shrink-0"
              >
                Abrir mídia
              </a>
            )}
            <div className="flex-1 min-w-0">
              {captionSnippet ? (
                <p className="text-xs text-[color:var(--color-muted)] break-words">
                  {captionSnippet}
                </p>
              ) : (
                <p className="text-xs text-[color:var(--color-muted)] italic">
                  (post sem legenda{!row.post_id ? ' / post deletado' : ''})
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {row.status === 'pending' ? (
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            type="button"
            disabled={isUpdating}
            onClick={onApprove}
            className="text-xs px-3 py-1.5 rounded-full bg-green-600 text-white font-semibold disabled:opacity-50"
          >
            Aprovar
          </button>
          <button
            type="button"
            disabled={isUpdating}
            onClick={onDismiss}
            className="text-xs px-3 py-1.5 rounded-full bg-gray-300 text-gray-800 font-semibold disabled:opacity-50"
          >
            Dispensar
          </button>
          <button
            type="button"
            disabled={isUpdating || !row.media_hash}
            onClick={onBlock}
            className="text-xs px-3 py-1.5 rounded-full bg-orange-600 text-white font-semibold disabled:opacity-50"
            title={
              !row.media_hash ? 'Sem hash — não dá pra bloquear permanente' : ''
            }
          >
            Bloquear permanente
          </button>
          <button
            type="button"
            disabled={isUpdating || !row.media_hash}
            onClick={onEscalate}
            className="text-xs px-3 py-1.5 rounded-full bg-red-700 text-white font-semibold disabled:opacity-50"
            title={
              !row.media_hash ? 'Sem hash — não dá pra escalar' : 'Escalar pro NCMEC (CSAM)'
            }
          >
            Escalar NCMEC
          </button>
        </div>
      ) : null}
    </div>
  );
}

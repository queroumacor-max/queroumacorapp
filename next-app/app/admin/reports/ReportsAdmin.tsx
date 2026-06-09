// ReportsAdmin — client component que lista denúncias com filtro por
// status e botões Resolver/Dispensar/Reabrir. RLS no banco barra escrita
// de não-admin; gate aqui é cosmético (UX) e segue o pattern do FlagsAdmin.

'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { isAdmin } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { getTimeAgo } from '@/lib/utils';
import { ListSkeleton } from '@/components/Skeletons';
import {
  fetchAdminReports,
  updateReportStatus,
  type AdminReportRow,
  type ReportStatus,
} from '@/lib/services/adminReports';

type Filter = ReportStatus | 'all';
const FILTERS: { label: string; value: Filter }[] = [
  { label: 'Pendentes', value: 'pending' },
  { label: 'Revisadas', value: 'reviewed' },
  { label: 'Resolvidas', value: 'resolved' },
  { label: 'Dispensadas', value: 'dismissed' },
  { label: 'Todas', value: 'all' },
];

export function ReportsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const admin = isAdmin(policyUser);
  const [filter, setFilter] = useState<Filter>('pending');
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['admin-reports', filter],
    queryFn: () => fetchAdminReports({ status: filter, limit: 50 }),
    enabled: !!user && admin,
    staleTime: 30_000,
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<ReportStatus, 'pending'> }) =>
      updateReportStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-reports'] });
    },
  });

  if (authLoading) {
    return <ListSkeleton count={3} itemHeight={120} />;
  }
  if (!user) {
    return <p className="text-sm text-[color:var(--color-muted)]">Faça login.</p>;
  }
  if (!admin) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Sem acesso. Esta área é restrita ao painel admin.
      </p>
    );
  }

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
        <ListSkeleton count={4} itemHeight={120} />
      ) : query.error ? (
        <p className="text-sm text-red-600">
          Erro: {(query.error as Error).message || 'falha ao carregar'}
        </p>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-4xl mb-3" aria-hidden="true">✅</div>
          <p className="text-sm text-[color:var(--color-muted)]">
            Nenhuma denúncia {filter === 'all' ? '' : `com status "${filter}"`} no momento.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {query.data!.items.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              onUpdate={(status) => updateMut.mutate({ id: r.id, status })}
              isUpdating={updateMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportRow({
  report,
  onUpdate,
  isUpdating,
}: {
  report: AdminReportRow;
  onUpdate: (status: Exclude<ReportStatus, 'pending'>) => void;
  isUpdating: boolean;
}) {
  const reporterName = report.reporter?.name || report.reporter?.tag || 'Usuário';
  const targetName = report.target?.name || report.target?.tag || null;
  const postSnippet = report.post?.caption
    ? report.post.caption.slice(0, 120) + (report.post.caption.length > 120 ? '…' : '')
    : '(post sem legenda)';

  const statusBadgeClass: Record<ReportStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    reviewed: 'bg-blue-100 text-blue-800',
    resolved: 'bg-green-100 text-green-800',
    dismissed: 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="p-4 rounded-xl bg-white border border-[color:var(--color-border)]">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusBadgeClass[report.status]}`}>
              {report.status}
            </span>
            <span className="text-xs text-[color:var(--color-muted)]">
              {getTimeAgo(report.created_at)}
            </span>
          </div>
          <p className="text-sm font-semibold mb-1">
            {reporterName} denunciou{targetName ? ` ${targetName}` : ''}
          </p>
          <p className="text-xs text-[color:var(--color-muted)] mb-2">
            Motivo: {report.reason}
          </p>
          {report.post ? (
            <div className="flex gap-3 items-start p-2 rounded-lg bg-[color:var(--color-bg)]">
              {report.post.media_url ? (
                <img
                  src={report.post.media_url}
                  alt=""
                  width={56}
                  height={56}
                  className="rounded object-cover flex-shrink-0"
                  style={{ width: 56, height: 56 }}
                />
              ) : null}
              <p className="text-xs text-[color:var(--color-muted)] flex-1 min-w-0 break-words">
                {postSnippet}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {report.status === 'pending' || report.status === 'reviewed' ? (
        <div className="flex gap-2 mt-3">
          {report.status === 'pending' ? (
            <button
              type="button"
              disabled={isUpdating}
              onClick={() => onUpdate('reviewed')}
              className="text-xs px-3 py-1.5 rounded-full bg-blue-600 text-white font-semibold disabled:opacity-50"
            >
              Marcar como revisado
            </button>
          ) : null}
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => onUpdate('resolved')}
            className="text-xs px-3 py-1.5 rounded-full bg-green-600 text-white font-semibold disabled:opacity-50"
          >
            Resolver
          </button>
          <button
            type="button"
            disabled={isUpdating}
            onClick={() => onUpdate('dismissed')}
            className="text-xs px-3 py-1.5 rounded-full bg-gray-300 text-gray-800 font-semibold disabled:opacity-50"
          >
            Dispensar
          </button>
        </div>
      ) : null}
    </div>
  );
}

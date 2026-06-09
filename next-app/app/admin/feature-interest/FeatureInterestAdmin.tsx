// FeatureInterestAdmin — client component que mostra resumo agregado
// por feature + drill-down em lista de cliques recentes. RLS no banco
// já barra leitura de não-admin; gate aqui é cosmético.

'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { isAdmin } from '@/lib/policies';
import { usePolicyUser } from '@/lib/hooks/usePolicyUser';
import { getTimeAgo } from '@/lib/utils';
import { ListSkeleton } from '@/components/Skeletons';
import {
  fetchFeatureInterestSummary,
  fetchFeatureInterestRows,
} from '@/lib/services/adminFeatureInterest';

export function FeatureInterestAdmin() {
  const { user, loading: authLoading } = useAuth();
  const policyUser = usePolicyUser();
  const admin = isAdmin(policyUser);
  const [selected, setSelected] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['admin-feature-interest-summary'],
    queryFn: fetchFeatureInterestSummary,
    enabled: !!user && admin,
    staleTime: 60_000,
  });

  const rowsQuery = useQuery({
    queryKey: ['admin-feature-interest-rows', selected],
    queryFn: () => fetchFeatureInterestRows(selected!),
    enabled: !!user && admin && !!selected,
    staleTime: 60_000,
  });

  if (authLoading) return <ListSkeleton count={3} itemHeight={80} />;
  if (!user) return <p className="text-sm text-[color:var(--color-muted)]">Faça login.</p>;
  if (!admin) {
    return (
      <p className="text-sm text-[color:var(--color-muted)]">
        Sem acesso. Esta área é restrita ao painel admin.
      </p>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-3">Resumo por feature</h2>
      {summaryQuery.isLoading ? (
        <ListSkeleton count={4} itemHeight={64} />
      ) : summaryQuery.error ? (
        <p className="text-sm text-red-600">
          Erro: {(summaryQuery.error as Error).message || 'falha ao carregar'}
        </p>
      ) : (summaryQuery.data?.length ?? 0) === 0 ? (
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)]">
            Sem cliques registrados ainda.
          </p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {summaryQuery.data!.map((s) => (
            <button
              key={s.feature}
              type="button"
              onClick={() => setSelected(s.feature)}
              className={
                'w-full flex items-center justify-between p-4 rounded-xl bg-white border transition-colors text-left ' +
                (selected === s.feature
                  ? 'border-[color:var(--color-p1)]'
                  : 'border-[color:var(--color-border)]')
              }
            >
              <div>
                <p className="font-semibold text-sm">{s.feature}</p>
                {s.lastAt ? (
                  <p className="text-xs text-[color:var(--color-muted)]">
                    Último: {getTimeAgo(s.lastAt)}
                  </p>
                ) : null}
              </div>
              <span className="text-xl font-bold text-[color:var(--color-p1)]">
                {s.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <>
          <h2 className="text-lg font-bold mb-3">
            Cliques em <code className="text-sm font-mono">{selected}</code>
          </h2>
          {rowsQuery.isLoading ? (
            <ListSkeleton count={3} itemHeight={64} />
          ) : (rowsQuery.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-[color:var(--color-muted)]">Sem registros.</p>
          ) : (
            <div className="space-y-2">
              {rowsQuery.data!.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-xl bg-white border border-[color:var(--color-border)] flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {r.reporter?.name || r.reporter?.tag || 'Anônimo'}
                    </p>
                    <p className="text-xs text-[color:var(--color-muted)] truncate">
                      {r.action}{r.contact ? ` · ${r.contact}` : ''}
                    </p>
                  </div>
                  <span className="text-xs text-[color:var(--color-muted)] flex-shrink-0">
                    {getTimeAgo(r.created_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

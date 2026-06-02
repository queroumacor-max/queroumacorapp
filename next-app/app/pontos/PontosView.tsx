// PontosView — client component pra /pontos. Lista pontos + saldo via
// useQuery; troca chama RPC `redeem_pro_with_points`.
'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  computeBalance,
  listPoints,
  redeemProWithPoints,
  type PointEntry,
} from '@/lib/services/points';

export function PontosView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [redeeming, setRedeeming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const userId = user?.id ?? '';
  const query = useQuery<PointEntry[], Error>({
    queryKey: ['points', userId],
    queryFn: () => listPoints(userId),
    enabled: !!userId,
    staleTime: 30_000,
  });

  const points = query.data ?? [];
  const balance = useMemo(() => computeBalance(points), [points]);
  const canRedeem = balance >= 100;

  async function handleRedeem() {
    if (!canRedeem || redeeming) return;
    if (!window.confirm('Trocar 100 pts por 1 mês PRO extra?')) return;
    setRedeeming(true);
    setFeedback(null);
    try {
      await redeemProWithPoints(100);
      setFeedback('1 mês PRO liberado! 🎉');
      qc.invalidateQueries({ queryKey: ['points', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    } catch (e) {
      setFeedback((e as Error).message || 'Erro ao trocar pontos');
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className="px-3.5 pt-4 pb-8">
      <h1
        className="font-extrabold"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          marginBottom: 14,
          color: 'var(--color-ink)',
        }}
      >
        🎁 Meus Pontos
      </h1>

      {/* Card saldo gradient */}
      <div
        className="text-white text-center"
        style={{
          background: 'linear-gradient(135deg, var(--color-p1), var(--color-p4))',
          borderRadius: 14,
          padding: 20,
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.7 }}>SALDO DISPONÍVEL</div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 800,
            fontFamily: 'var(--font-display)',
          }}
        >
          {query.isLoading ? '…' : `${balance} pts`}
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
          100 pts = 1 mês PRO extra ⚡
        </div>
      </div>

      <button
        type="button"
        onClick={handleRedeem}
        disabled={!canRedeem || redeeming}
        className="w-full text-white font-bold"
        style={{
          padding: 14,
          marginBottom: 16,
          background: 'linear-gradient(135deg, var(--color-p5), var(--color-p1))',
          borderRadius: 12,
          fontSize: 14,
          cursor: canRedeem ? 'pointer' : 'not-allowed',
          opacity: canRedeem ? 1 : 0.5,
          border: 'none',
        }}
      >
        {canRedeem
          ? '⚡ Trocar 100 pts por 1 mês PRO'
          : `⚡ Faltam ${Math.max(0, 100 - balance)} pts pra liberar 1 mês PRO`}
      </button>

      {feedback ? (
        <p
          className="text-center"
          style={{
            fontSize: 13,
            color: 'var(--color-ink)',
            marginBottom: 12,
            padding: 10,
            background: 'rgba(46,196,182,.12)',
            borderRadius: 10,
          }}
        >
          {feedback}
        </p>
      ) : null}

      <div
        className="font-bold uppercase mb-2"
        style={{ fontSize: 13, color: 'var(--color-muted)' }}
      >
        Como Ganhar
      </div>
      {(
        [
          ['🛒 Compra na loja', '+1 pt'],
          ['⭐ Avaliar pintor', '+10 pts'],
          ['🤝 Indicar pintor', '+50 pts'],
          ['👥 Convidar amigo', '+20 pts'],
        ] as const
      ).map(([label, value]) => (
        <div
          key={label}
          className="bg-white flex justify-between"
          style={{
            borderRadius: 12,
            padding: 12,
            marginBottom: 6,
            boxShadow: '0 2px 6px rgba(0,0,0,.04)',
            fontSize: 12,
          }}
        >
          <span>{label}</span>
          <span style={{ fontWeight: 700, color: 'var(--color-p1)' }}>{value}</span>
        </div>
      ))}

      <div
        className="font-bold uppercase mb-2"
        style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 14 }}
      >
        Histórico
      </div>
      {query.isLoading ? (
        <p className="text-center text-sm text-[color:var(--color-muted)] py-3">
          Carregando…
        </p>
      ) : points.length === 0 ? (
        <p className="text-center text-sm text-[color:var(--color-muted)] py-3">
          Nenhuma movimentação
        </p>
      ) : (
        <div>
          {points.map((p) => (
            <div
              key={p.id}
              className="flex justify-between"
              style={{
                padding: '8px 0',
                borderBottom: '1px solid var(--color-border)',
                fontSize: 12,
              }}
            >
              <span>{p.source || (p.type === 'earned' ? 'Crédito' : 'Débito')}</span>
              <span
                style={{
                  color: p.type === 'earned' ? 'var(--color-p3)' : 'var(--color-p1)',
                  fontWeight: 700,
                }}
              >
                {p.type === 'earned' ? '+' : '-'}{p.amount} pts
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

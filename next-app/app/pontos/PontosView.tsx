// PontosView — client component pra /pontos. Lista pontos + saldo via
// useQuery; troca tem 3 opções a 1000 pts cada:
//   - 1 mês PRO extra (atômico via RPC redeem_pro_with_points)
//   - Camiseta personalizada (WhatsApp pra Cali Colors processar)
//   - R$30 cashback na próxima compra (WhatsApp pra Cali Colors processar)
//
// Por que WhatsApp pras 2 últimas: fulfillment é manual (alguém envia camiseta
// ou aplica o desconto na loja física). Mais honesto que mostrar "resgatado!"
// sem o pintor saber quando vai chegar. PRO já é instantâneo via RPC.
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

const REDEEM_COST = 1000;
const SUPPORT_WA = '5511959765031';

type RedeemKind = 'pro' | 'tshirt' | 'cashback';

interface RedeemOption {
  kind: RedeemKind;
  emoji: string;
  title: string;
  subtitle: string;
}

const OPTIONS: readonly RedeemOption[] = [
  {
    kind: 'pro',
    emoji: '⚡',
    title: '1 mês PRO extra',
    subtitle: 'Liberado na hora — Seu Zé, CRM, agenda…',
  },
  {
    kind: 'tshirt',
    emoji: '👕',
    title: 'Camiseta personalizada',
    subtitle: 'Cali Colors envia com sua arte/logo',
  },
  {
    kind: 'cashback',
    emoji: '💰',
    title: 'R$ 30 na próxima compra',
    subtitle: 'Cashback aplicado pela loja',
  },
];

export function PontosView() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [redeeming, setRedeeming] = useState<RedeemKind | null>(null);
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
  const canRedeem = balance >= REDEEM_COST;
  const userName =
    (user?.user_metadata as { name?: string } | undefined)?.name || 'Pintor';

  async function redeemPro() {
    setRedeeming('pro');
    setFeedback(null);
    try {
      await redeemProWithPoints(REDEEM_COST);
      setFeedback('1 mês PRO liberado! 🎉');
      qc.invalidateQueries({ queryKey: ['points', userId] });
      qc.invalidateQueries({ queryKey: ['profile', userId] });
    } catch (e) {
      setFeedback((e as Error).message || 'Erro ao trocar pontos');
    } finally {
      setRedeeming(null);
    }
  }

  function redeemReward(kind: 'tshirt' | 'cashback') {
    const label =
      kind === 'tshirt' ? 'camiseta personalizada' : 'R$ 30 de cashback';
    const msg =
      `Olá Cali Colors! Sou *${userName}* e quero trocar *${REDEEM_COST} pontos* por *${label}*.\n\n` +
      `Meu ID no app: ${userId}`;
    const url = `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setFeedback(
      kind === 'tshirt'
        ? 'Mensagem aberta no WhatsApp. Cali Colors confirma + envia 👕'
        : 'Mensagem aberta no WhatsApp. Cashback aplicado na próxima compra 💰',
    );
  }

  function handleRedeem(kind: RedeemKind) {
    if (!canRedeem || redeeming) return;
    const opt = OPTIONS.find((o) => o.kind === kind)!;
    if (!window.confirm(`Trocar ${REDEEM_COST} pts por ${opt.title}?`)) return;
    if (kind === 'pro') {
      void redeemPro();
    } else {
      redeemReward(kind);
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
          1000 pts = recompensa à sua escolha 🎁
        </div>
      </div>

      {/* 3 opções de resgate */}
      <div
        className="font-bold uppercase mb-2"
        style={{ fontSize: 13, color: 'var(--color-muted)' }}
      >
        Resgatar 1000 pts por
      </div>
      <div className="flex flex-col gap-2 mb-3">
        {OPTIONS.map((opt) => {
          const isBusy = redeeming === opt.kind;
          const disabled = !canRedeem || !!redeeming;
          return (
            <button
              key={opt.kind}
              type="button"
              onClick={() => handleRedeem(opt.kind)}
              disabled={disabled}
              className="flex items-center gap-3 text-left bg-white"
              style={{
                padding: '12px 14px',
                borderRadius: 14,
                border: '1.5px solid var(--color-border)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.55 : 1,
                boxShadow: canRedeem
                  ? '0 2px 8px rgba(0,0,0,.05)'
                  : 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: 26,
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background:
                    'linear-gradient(135deg, rgba(255,107,53,.08), rgba(131,56,236,.08))',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {opt.emoji}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className="font-bold"
                  style={{ fontSize: 14, color: 'var(--color-ink)' }}
                >
                  {opt.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-muted)',
                    marginTop: 1,
                  }}
                >
                  {opt.subtitle}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--color-p1)',
                  whiteSpace: 'nowrap',
                }}
              >
                {isBusy ? '…' : '1000 pts'}
              </span>
            </button>
          );
        })}
      </div>

      {!canRedeem ? (
        <p
          className="text-center"
          style={{
            fontSize: 12,
            color: 'var(--color-muted)',
            marginBottom: 10,
          }}
        >
          Faltam {Math.max(0, REDEEM_COST - balance)} pts pra liberar
        </p>
      ) : null}

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
        style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 14 }}
      >
        Como Ganhar
      </div>
      {(
        [
          ['🛒 Compra na loja', '+1 pt a cada R$ 10'],
          ['👥 Convidar amigo', '+1 pt'],
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

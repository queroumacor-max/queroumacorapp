// QuoteCard — card de um orçamento no kanban. Componente puro: recebe quote
// + callbacks por ação, sem fetch nem mutation própria (PipelineKanban faz).
//
// Espelha `renderPipelineCard` do vanilla (modules/pipeline.js linha 146)
// num componente React tipado. Diferenças:
//   - status badge usa QUOTE_STATUS do service (única fonte de cor/label);
//   - botões de ação são por status (igual vanilla), mas tipados via union
//     PipelineCardAction — o pai decide o que fazer com cada um;
//   - "Sugerir preço" desabilita durante loading global de suggest (UX da
//     spec: feedback claro de "IA processando").

'use client';

import Link from 'next/link';
import type { Quote } from '@/lib/types';
import { QUOTE_STATUS, type PipelineStatus } from '@/lib/services/pipeline';

// Formatter BRL singleton — Intl é caro de instanciar, alinhado com
// OrderCard/LeadCard.
const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatPrice(price: number | null | undefined): string {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return 'Sem valor';
  return BRL.format(n);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  } catch {
    return '';
  }
}

function resolveStatus(raw: string | null | undefined): PipelineStatus {
  // 'aceito' (rótulo legado) cai em aprovado pra mostrar o card no lugar
  // certo do kanban; status null cai em rascunho (default do vanilla).
  if (!raw) return 'rascunho';
  if (raw in QUOTE_STATUS) return raw as PipelineStatus;
  if (raw === 'aceito') return 'aprovado';
  return 'rascunho';
}

export interface QuoteCardProps {
  quote: Quote;
  onSend: (id: string) => void;
  onSuggestPrice: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAdvance: (id: string, status: 'em_execucao' | 'concluido') => void;
  isSuggesting: boolean;
  // Flag global de qualquer mutation pendente — desabilita ações pra evitar
  // double-click enquanto a request anterior tá rolando.
  isBusy: boolean;
}

export function QuoteCard({
  quote,
  onSend,
  onSuggestPrice,
  onApprove,
  onReject,
  onAdvance,
  isSuggesting,
  isBusy,
}: QuoteCardProps) {
  const status = resolveStatus(quote.status);
  const meta = QUOTE_STATUS[status];
  const cli =
    quote.client_name || quote.client?.name || 'Cliente';
  const priceLabel = formatPrice(quote.price);
  const dateLabel = formatDate(quote.created_at);
  // Frozen = escopo congelado pós-aprovação. Mostra cadeado + método.
  const frozen =
    status === 'aprovado' ||
    status === 'em_execucao' ||
    status === 'concluido';
  const isAppClient = !!quote.client_id;

  return (
    <article
      className="bg-white rounded-2xl border border-[color:var(--color-border)] p-3 shadow-sm flex flex-col gap-2"
      data-status={status}
    >
      {/* Header: nome + serviço + badge de status */}
      <header className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <Link
            href={`/orcamentos/${quote.id}`}
            className="block hover:opacity-80 transition-opacity"
          >
            <div className="text-sm font-bold text-[color:var(--color-ink)] truncate">
              {cli}
            </div>
            <div className="text-xs text-[color:var(--color-muted)] truncate">
              {quote.service_type || quote.title || 'Orçamento'}
            </div>
          </Link>
        </div>
        <span
          className="text-[10px] font-extrabold uppercase tracking-wider whitespace-nowrap"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
      </header>

      {/* Preço + badge "cliente do app" + data */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-extrabold text-[color:var(--color-ink)]">
          {priceLabel}
        </span>
        <span
          className={
            'text-[10px] font-bold px-2 py-0.5 rounded-full ' +
            (isAppClient
              ? 'text-[#3a86ff] bg-[rgba(58,134,255,0.1)]'
              : 'text-[color:var(--color-muted)] bg-[color:var(--color-bg)]')
          }
        >
          {isAppClient ? 'Cliente do app' : 'Cliente externo'}
        </span>
        <span className="ml-auto text-[11px] text-[color:var(--color-muted)]">
          {dateLabel}
        </span>
      </div>

      {/* Linha de escopo congelado, quando aplicável */}
      {frozen ? (
        <div className="text-[11px] text-[color:var(--color-muted)]">
          🔒 Escopo congelado
          {quote.approved_at ? ` em ${formatDate(quote.approved_at)}` : ''}
          {quote.approval_method === 'manual'
            ? ' · registro manual'
            : quote.approval_method === 'app'
              ? ' · aprovado pelo cliente'
              : ''}
        </div>
      ) : null}

      {/* Ações por status — mesmo conjunto do vanilla, sem o botão "Ver
          escopo" inline (movido pra tela de detalhe via Link no header). */}
      <div className="flex gap-2 flex-wrap pt-1">
        {status === 'pending' || status === 'rascunho' ? (
          <>
            <button
              type="button"
              onClick={() => onSend(quote.id)}
              disabled={isBusy}
              className="flex-1 px-3 py-2 bg-[color:var(--color-p1)] text-white rounded-lg text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Enviar
            </button>
            <button
              type="button"
              onClick={() => onSuggestPrice(quote.id)}
              disabled={isBusy || isSuggesting}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background:
                  'linear-gradient(135deg,#8338ec,var(--color-p1))',
              }}
              aria-label="Sugerir preço com IA"
            >
              {isSuggesting ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"
                    aria-hidden="true"
                  />
                  Calculando…
                </span>
              ) : (
                '🤖 Sugerir preço'
              )}
            </button>
          </>
        ) : null}

        {status === 'enviado' ? (
          <>
            <button
              type="button"
              onClick={() => onApprove(quote.id)}
              disabled={isBusy}
              className="flex-1 px-3 py-2 bg-[#2ec4b6] text-white rounded-lg text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Marcar aceito
            </button>
            <button
              type="button"
              onClick={() => onReject(quote.id)}
              disabled={isBusy}
              className="flex-1 px-3 py-2 bg-[color:var(--color-bg)] text-[color:var(--color-muted)] rounded-lg text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Recusado
            </button>
          </>
        ) : null}

        {status === 'aprovado' ? (
          <button
            type="button"
            onClick={() => onAdvance(quote.id, 'em_execucao')}
            disabled={isBusy}
            className="flex-1 px-3 py-2 bg-[#3a86ff] text-white rounded-lg text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Iniciar execução
          </button>
        ) : null}

        {status === 'em_execucao' ? (
          <button
            type="button"
            onClick={() => onAdvance(quote.id, 'concluido')}
            disabled={isBusy}
            className="flex-1 px-3 py-2 bg-[#16a34a] text-white rounded-lg text-xs font-bold disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Concluir
          </button>
        ) : null}

        {status === 'concluido' || status === 'recusado' ? (
          <Link
            href={`/orcamentos/${quote.id}`}
            className="flex-1 px-3 py-2 bg-[color:var(--color-bg)] text-[color:var(--color-ink)] rounded-lg text-xs font-bold text-center"
          >
            Ver escopo
          </Link>
        ) : null}
      </div>
    </article>
  );
}

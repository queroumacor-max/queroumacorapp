// OrderCard — card de um pedido da loja Cali Colors.
// Reusável em /pedidos (lista do usuário) e futuramente em admin (lista
// de todas as orders pra moderação/suporte).
//
// Espelha o markup do `pedido-card` vanilla (modules/pedidos.js linhas 58-65)
// num Component React tipado. Diferenças:
//   - usa CSS tokens (var(--color-*)) em vez dos inline-styles do vanilla;
//   - status badge usa Map em vez do dict statusLabels/statusClasses inline,
//     o que facilita extensão e teste unitário;
//   - render condicional do tracking só aparece se a coluna existir (no schema
//     atual ainda não tem, mas o type já carrega o campo opcional pro futuro).
//
// Formato BRL (Intl.NumberFormat) e data PT-BR (toLocaleDateString) seguem
// o spec — `BRL_FMT` é memoizado no escopo do módulo pra evitar recriar o
// formatter a cada render (ele é caro de construir).

'use client';

import type { Order, OrderStatus } from '@/lib/types';

// Formatador BRL ao nível de módulo — Intl.NumberFormat é caro de instanciar
// e o resultado é determinístico por locale/options, então faz sentido cachear.
const BRL_FMT = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatBRL(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return BRL_FMT.format(value);
}

function formatDate(iso: string): string {
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

// Map por status pra UI. Aceita rótulos em PT (rascunho/pago/enviado/…) E
// inglês (pending/paid/shipped/…) porque o banco tem ambos: o schema atual
// usa `pending|paid|amount_mismatch|refunded|canceled` (linha 1128 do
// supabase_init.sql), mas mocks/legacy gravaram rótulos em PT. Fallback "🔔"
// + "Pendente" pra qualquer status desconhecido.
interface StatusMeta {
  icon: string;
  label: string;
  bg: string;
  fg: string;
}

const STATUS_MAP: Record<string, StatusMeta> = {
  // PT (spec atual)
  rascunho: { icon: '📝', label: 'Rascunho', bg: '#e5e7eb', fg: '#374151' },
  pendente: { icon: '⏳', label: 'Pendente', bg: '#fef3c7', fg: '#92400e' },
  pago: { icon: '💰', label: 'Pago', bg: '#d1fae5', fg: '#065f46' },
  enviado: { icon: '📦', label: 'Enviado', bg: '#dbeafe', fg: '#1e40af' },
  entregue: { icon: '✅', label: 'Entregue', bg: '#d1fae5', fg: '#065f46' },
  cancelado: { icon: '❌', label: 'Cancelado', bg: '#fee2e2', fg: '#991b1b' },
  // EN (schema real). Mantidos pra exibir corretamente linhas legacy/atuais.
  pending: { icon: '⏳', label: 'Pendente', bg: '#fef3c7', fg: '#92400e' },
  paid: { icon: '💰', label: 'Pago', bg: '#d1fae5', fg: '#065f46' },
  shipped: { icon: '📦', label: 'Enviado', bg: '#dbeafe', fg: '#1e40af' },
  delivered: { icon: '✅', label: 'Entregue', bg: '#d1fae5', fg: '#065f46' },
  canceled: { icon: '❌', label: 'Cancelado', bg: '#fee2e2', fg: '#991b1b' },
  refunded: { icon: '↩️', label: 'Reembolsado', bg: '#fee2e2', fg: '#991b1b' },
  amount_mismatch: {
    icon: '⚠️',
    label: 'Valor divergente',
    bg: '#fef3c7',
    fg: '#92400e',
  },
};

function statusMetaFor(status: OrderStatus | string | undefined): StatusMeta {
  if (!status) {
    return { icon: '⏳', label: 'Pendente', bg: '#fef3c7', fg: '#92400e' };
  }
  return (
    STATUS_MAP[status] ?? {
      icon: '🔔',
      label: status,
      bg: '#e5e7eb',
      fg: '#374151',
    }
  );
}

export interface OrderCardProps {
  order: Order;
}

export function OrderCard({ order }: OrderCardProps) {
  const meta = statusMetaFor(order.status);
  const items = Array.isArray(order.items) ? order.items : [];
  const itemCount = items.reduce((sum, i) => sum + (i.qty || 0), 0);
  // Os 3 primeiros nomes pra preview, igual ao vanilla (modules/pedidos.js).
  const itemNames = items
    .slice(0, 3)
    .map((i) => i.name)
    .filter(Boolean)
    .join(', ');
  const moreLabel = items.length > 3 ? ` +${items.length - 3}` : '';
  const totalLabel = formatBRL(order.total);
  const dateLabel = formatDate(order.created_at);
  const tracking = order.tracking_code?.trim();

  return (
    <article
      className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 flex flex-col gap-3"
      data-status={order.status || 'pending'}
    >
      <header className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex items-center justify-center rounded-lg w-10 h-10 flex-shrink-0"
          style={{ background: 'var(--color-ink)' }}
        >
          <span
            className="text-[10px] font-extrabold"
            style={{ color: 'var(--color-p1)', fontFamily: 'var(--font-display)' }}
          >
            CC
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">Cali Colors — Loja</div>
          <div className="text-xs text-[color:var(--color-muted)] truncate">
            {itemNames || 'Compra'}
            {moreLabel}
          </div>
        </div>
        <span
          className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
          style={{ background: meta.bg, color: meta.fg }}
        >
          <span aria-hidden="true">{meta.icon}</span> {meta.label}
        </span>
      </header>

      <div className="flex items-center justify-between text-xs text-[color:var(--color-muted)]">
        <span className="font-semibold text-[color:var(--color-ink)]">
          {totalLabel}
        </span>
        <span>
          {itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item' : 'itens'} · ` : ''}
          {dateLabel}
        </span>
      </div>

      {tracking ? (
        <a
          href={`https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(tracking)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[color:var(--color-p1)] underline self-start"
        >
          Rastrear: {tracking}
        </a>
      ) : null}
    </article>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import type { CartItem } from '@/lib/services/mkt';

interface OrderData {
  id: string;
  items: CartItem[];
  created_at: string;
  delivery_address?: string | null;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function buildWhatsAppText(order: OrderData): string {
  const date = formatDate(order.created_at);
  const lines = order.items.map(
    (it) => `• ${it.name}${it.volume ? ` (${it.volume})` : ''} — qtd: ${it.qty || 1}`
  );
  const addr = order.delivery_address ? `\n📍 *Endereço:* ${order.delivery_address}` : '';
  return (
    `Olá! Acabei de enviar minha lista de pedido pelo app *QueroUmaCor*:\n\n` +
    `📋 *Lista de Pedido — Cali Colors*\n` +
    `📅 Data: ${date}\n\n` +
    `🛒 *Itens:*\n${lines.join('\n')}` +
    addr +
    `\n\n🔖 ID do pedido: ${order.id}`
  );
}

export function OrderConfirmView({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderData | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<CartItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    sb.from('orders')
      .select('id, items, created_at, status, delivery_address')
      .eq('id', orderId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError('Não foi possível carregar o pedido.');
        } else {
          const parsed: OrderData = {
            id: data.id,
            items: Array.isArray(data.items) ? (data.items as unknown as CartItem[]) : [],
            created_at: data.created_at ?? new Date().toISOString(),
            delivery_address: (data as Record<string, unknown>).delivery_address as string | null,
          };
          setOrder(parsed);
          setStatus(data.status ?? 'pending');
          setEditItems(parsed.items.map((it) => ({ ...it })));
        }
        setLoading(false);
      });
  }, [orderId]);

  function changeQty(idx: number, delta: number) {
    setEditItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = Math.max(1, (it.qty || 1) + delta);
        return { ...it, qty: next };
      })
    );
  }

  function removeItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }

  async function saveEdit() {
    if (!order) return;
    if (editItems.length === 0) {
      setSaveMsg('Adicione pelo menos 1 item antes de salvar.');
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    const sb = getSupabase();
    const { error: err } = await sb
      .from('orders')
      .update({ items: editItems as unknown as never } as never)
      .eq('id', order.id);
    if (err) {
      setSaveMsg('Não foi possível salvar. Tente de novo.');
    } else {
      setOrder({ ...order, items: editItems });
      setEditing(false);
      setSaveMsg('Pedido atualizado com sucesso!');
    }
    setSaving(false);
  }

  function handlePrint() {
    window.print();
  }

  function handleWhatsApp() {
    if (!order) return;
    const text = buildWhatsAppText(order);
    const url = `https://wa.me/5511959765031?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-16 rounded-xl bg-[color:var(--color-border)]" />
        <div className="h-32 rounded-xl bg-[color:var(--color-border)]" />
        <div className="h-12 rounded-xl bg-[color:var(--color-border)]" />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="text-center py-12">
        <div className="text-4xl mb-3">⚠️</div>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">{error}</p>
        <Link href="/loja" className="text-sm font-semibold text-[color:var(--color-p1)]">
          Voltar à loja
        </Link>
      </div>
    );
  }

  const isPending = !status || status === 'pending' || status === 'pendente';
  const displayItems = editing ? editItems : order.items;
  const itemCount = displayItems.reduce((s, i) => s + (i.qty || 1), 0);

  return (
    <>
      {/* ── estilo só pra impressão ── */}
      <style>{`
        @media print {
          body > *:not(#order-print-root) { display: none !important; }
          #order-print-root { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="order-print-root">
        {/* Cabeçalho */}
        <div className="flex flex-col items-center text-center mb-6 no-print">
          <div className="text-5xl mb-2">{isPending ? '⏳' : '✅'}</div>
          <h2 className="text-lg font-bold mb-1">
            {isPending ? 'Pedido pendente' : 'Pedido confirmado'}
          </h2>
          <p className="text-sm text-[color:var(--color-muted)]">
            A equipe da Cali Colors entrará em contato via WhatsApp em breve.
          </p>
        </div>

        {/* Aviso de salvamento */}
        {saveMsg ? (
          <div className={`mb-4 p-3 rounded-xl text-sm no-print ${saveMsg.includes('sucesso') ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-amber-50 border border-amber-200 text-amber-800'}`}>
            {saveMsg}
          </div>
        ) : null}

        {/* Cabeçalho do PDF */}
        <div className="hidden print:block mb-4 text-center">
          <div className="text-xl font-bold">Cali Colors — Lista de Pedido</div>
          <div className="text-sm text-gray-500">{formatDate(order.created_at)}</div>
        </div>

        {/* Card de itens */}
        <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">
              Itens ({itemCount} {itemCount === 1 ? 'unidade' : 'unidades'})
            </span>
            {isPending && !editing ? (
              <button
                type="button"
                onClick={() => { setEditing(true); setSaveMsg(null); }}
                className="no-print text-xs font-semibold text-[color:var(--color-p1)] border border-[color:var(--color-p1)] px-3 py-1 rounded-full"
              >
                Editar pedido
              </button>
            ) : null}
            {editing ? (
              <span className="text-xs text-[color:var(--color-muted)]">Modo edição</span>
            ) : (
              <span className="text-xs text-[color:var(--color-muted)]">{formatDate(order.created_at)}</span>
            )}
          </div>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {displayItems.map((item, idx) => (
              <li key={`${item.id}-${idx}`} className="py-2 flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{item.name}</div>
                  {item.volume ? (
                    <div className="text-xs text-[color:var(--color-muted)]">{item.volume}</div>
                  ) : null}
                </div>
                {editing ? (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button type="button" onClick={() => changeQty(idx, -1)}
                      className="w-7 h-7 rounded-full bg-[color:var(--color-bg)] text-sm font-bold">−</button>
                    <span className="text-sm font-semibold w-5 text-center">{item.qty || 1}</span>
                    <button type="button" onClick={() => changeQty(idx, 1)}
                      className="w-7 h-7 rounded-full bg-[color:var(--color-bg)] text-sm font-bold">+</button>
                    <button type="button" onClick={() => removeItem(idx)}
                      className="w-7 h-7 rounded-full text-red-400 hover:bg-red-50 text-base font-bold ml-1">×</button>
                  </div>
                ) : (
                  <span className="text-sm font-semibold whitespace-nowrap">Qtd: {item.qty || 1}</span>
                )}
              </li>
            ))}
          </ul>

          {/* Botões salvar/cancelar edição */}
          {editing ? (
            <div className="flex gap-2 mt-4 no-print">
              <button type="button" onClick={() => { setEditing(false); setEditItems(order.items.map(it => ({...it}))); setSaveMsg(null); }}
                disabled={saving}
                className="flex-1 py-2 rounded-xl border border-[color:var(--color-border)] text-sm font-semibold disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={saveEdit} disabled={saving}
                className="flex-1 py-2 rounded-xl bg-[color:var(--color-p1)] text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </button>
            </div>
          ) : null}
        </div>

        {/* Endereço (se informado) */}
        {order.delivery_address ? (
          <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 mb-4">
            <div className="text-xs font-semibold text-[color:var(--color-muted)] mb-1">
              Endereço de entrega
            </div>
            <div className="text-sm">{order.delivery_address}</div>
          </div>
        ) : null}

        {/* ID do pedido */}
        <div className="text-center text-xs text-[color:var(--color-muted)] mb-6">
          ID do pedido: {order.id}
        </div>

        {/* Botões de ação */}
        <div className="space-y-3 no-print">
          <button
            type="button"
            onClick={handleWhatsApp}
            className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2"
            style={{ background: '#25D366' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Enviar por WhatsApp
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="w-full py-3 rounded-xl font-semibold border border-[color:var(--color-border)] bg-white text-[color:var(--color-ink)] flex items-center justify-center gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="18" x2="12" y2="12"/>
              <line x1="9" y1="15" x2="15" y2="15"/>
            </svg>
            Baixar PDF
          </button>

          <Link
            href="/loja"
            className="block w-full py-3 rounded-xl text-center text-sm font-semibold text-[color:var(--color-p1)]"
          >
            Continuar comprando
          </Link>
        </div>
      </div>
    </>
  );
}

// CartView — client component que renderiza o carrinho + botão de
// "Solicitar orçamento para a loja".
//
// Fluxo de orçamento (2026-06-16): o cliente não vê preço. Ao solicitar,
// `useCart.checkout()` grava a order como 'orcamento' e devolve o orderId;
// abrimos o WhatsApp da loja com itens + dados do cliente já preenchidos e
// mostramos confirmação ("solicitação enviada, será respondida rapidamente").

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useCart } from '@/lib/hooks/useCart';
import { CartItem } from '@/components/CartItem';
import { Config } from '@/lib/config';
import type { CartItem as CartItemModel } from '@/lib/services/mkt';

// Monta a mensagem de WhatsApp com os dados do pedido + cliente. A loja
// responde com o preço (catálogo não exibe valor pro cliente).
function buildQuoteMessage(
  items: CartItemModel[],
  clientName: string,
  clientContact: string,
  orderId: string,
): string {
  const lines = items.map((it) => {
    const vol = it.volume ? ` (${it.volume})` : '';
    return `• ${it.qty || 1}x ${it.name}${vol}`;
  });
  return [
    '🎨 *Solicitação de orçamento — QueroUmaCor*',
    '',
    `Cliente: ${clientName || 'Não informado'}`,
    clientContact ? `Contato: ${clientContact}` : '',
    `Pedido: #${orderId}`,
    '',
    'Itens:',
    ...lines,
    '',
    'Aguardo o orçamento, por favor. 🙏',
  ]
    .filter(Boolean)
    .join('\n');
}

function SkeletonItem() {
  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-[color:var(--color-border)] animate-pulse">
      <div className="w-12 h-12 rounded-lg bg-[color:var(--color-border)]" />
      <div className="flex-1">
        <div className="h-3 w-1/2 bg-[color:var(--color-border)] rounded mb-2" />
        <div className="h-3 w-1/4 bg-[color:var(--color-border)] rounded" />
      </div>
      <div className="h-5 w-16 bg-[color:var(--color-border)] rounded" />
    </div>
  );
}

export function CartView() {
  const { user, loading: authLoading } = useAuth();
  const {
    items,
    count,
    loading,
    error,
    remove,
    changeQty,
    checkout,
    isMutating,
    mutationError,
    isCheckingOut,
    checkoutError,
  } = useCart();
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  // Após enviar a solicitação, guarda o link do WhatsApp pra reabrir caso o
  // popup tenha sido bloqueado, e troca a tela pela confirmação.
  const [sentWaUrl, setSentWaUrl] = useState<string | null>(null);

  const clientName = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as { name?: string | null };
    return meta.name || user?.email || '';
  }, [user]);

  async function handleRequestQuote() {
    setCheckoutMsg(null);
    // Snapshot dos itens ANTES do checkout (o sucesso limpa o carrinho).
    const snapshot = items;
    try {
      const { orderId } = await checkout();
      const msg = buildQuoteMessage(
        snapshot,
        clientName,
        user?.email ?? '',
        orderId,
      );
      const waUrl = `https://wa.me/${Config.support.whatsapp}?text=${encodeURIComponent(msg)}`;
      // Abre o WhatsApp da loja já preenchido. Se o navegador bloquear o
      // popup, o link fica disponível na tela de confirmação.
      if (typeof window !== 'undefined') {
        window.open(waUrl, '_blank', 'noopener,noreferrer');
      }
      setSentWaUrl(waUrl);
    } catch (err) {
      setCheckoutMsg(
        (err as Error).message || 'Não foi possível enviar a solicitação.'
      );
    }
  }

  if (authLoading) {
    return (
      <div className="space-y-3" aria-label="Carregando">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonItem key={i} />
        ))}
      </div>
    );
  }

  // Confirmação pós-envio: "solicitação enviada, será respondida rapidamente".
  if (sentWaUrl) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          ✅
        </div>
        <h2 className="font-semibold mb-2">Solicitação enviada!</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-5">
          A loja recebeu o seu pedido de orçamento e vai responder rapidamente.
          Se o WhatsApp não abriu, toque no botão abaixo.
        </p>
        <a
          href={sentWaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-5 py-2.5 bg-[#25D366] text-white rounded-xl font-semibold mb-3"
        >
          Abrir WhatsApp da loja
        </a>
        <div>
          <Link
            href="/loja"
            className="inline-block text-sm font-semibold text-[color:var(--color-p1)] mt-2"
          >
            Voltar pra loja
          </Link>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🛒
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver o seu carrinho</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Faça login pra salvar e finalizar suas compras.
        </p>
        <Link
          href="/login"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Entrar
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-label="Carregando carrinho">
        {Array.from({ length: 2 }).map((_, i) => (
          <SkeletonItem key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)]">
          Não foi possível carregar o carrinho. Tente de novo em instantes.
        </p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          🛒
        </div>
        <h2 className="font-semibold mb-2">Carrinho vazio</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Adicione produtos pra começar.
        </p>
        <Link
          href="/loja"
          className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold"
        >
          Ver loja
        </Link>
      </div>
    );
  }

  return (
    <div>
      {mutationError ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {mutationError.message || 'Não foi possível atualizar o carrinho.'}
        </div>
      ) : null}
      {checkoutError ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800"
        >
          {checkoutError.message || 'Não foi possível criar o pedido.'}
        </div>
      ) : null}
      {checkoutMsg ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800"
        >
          {checkoutMsg}
        </div>
      ) : null}

      <ul className="space-y-3 mb-4">
        {items.map((item) => (
          <li key={item.id}>
            <CartItem
              item={item}
              onChangeQty={(delta) => changeQty({ id: item.id, delta })}
              onRemove={() => remove(item.id)}
              disabled={isMutating || isCheckingOut}
            />
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between bg-white rounded-xl p-4 border border-[color:var(--color-border)] mb-4">
        <span className="text-sm font-semibold">
          {count} {count === 1 ? 'item' : 'itens'}
        </span>
        <span className="text-xs text-[color:var(--color-muted)]">
          A loja envia o orçamento
        </span>
      </div>

      <button
        type="button"
        onClick={handleRequestQuote}
        disabled={isCheckingOut || items.length === 0}
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        {isCheckingOut ? 'Enviando…' : 'Solicitar orçamento para a loja'}
      </button>
      <p className="text-xs text-[color:var(--color-muted)] text-center mt-3">
        Você será levado ao WhatsApp da loja com o pedido já preenchido.
      </p>
    </div>
  );
}

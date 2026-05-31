// CartView — client component que renderiza o carrinho + total + botão de
// checkout. Espelha o conteúdo do `cart-modal` do vanilla.
//
// Checkout: dispara submitOrder via useCart.checkout(), pega o orderId
// e POSTa em /api/mp-checkout-loja pra gerar o init_point do Mercado Pago,
// e finalmente faz `window.location.href = init_point` (vanilla parity).
// Em caso de fallback 503 (MP indisponível), mostra mensagem orientando
// o usuário a aguardar contato da loja.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useCart } from '@/lib/hooks/useCart';
import { CartItem } from '@/components/CartItem';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

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
    total,
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

  async function handleCheckout() {
    setCheckoutMsg(null);
    try {
      const { orderId } = await checkout();
      // 2ª fase: chama /api/mp-checkout-loja pra obter o init_point.
      const res = await fetch('/api/mp-checkout-loja', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { init_point?: string; error?: string }
        | null;
      if (!res.ok || !data || !data.init_point) {
        if (res.status === 503) {
          setCheckoutMsg(
            'Pedido recebido! A loja entrará em contato (pagamento online em breve).'
          );
          return;
        }
        setCheckoutMsg(
          (data && data.error) || `Erro ${res.status}: tente de novo.`
        );
        return;
      }
      window.location.href = data.init_point;
    } catch (err) {
      setCheckoutMsg(
        (err as Error).message || 'Não foi possível finalizar a compra.'
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
        <span className="text-sm font-semibold">Total</span>
        <span
          className="text-xl font-bold"
          style={{ color: 'var(--color-p1)', fontFamily: 'var(--font-display)' }}
        >
          {BRL.format(total)}
        </span>
      </div>

      <button
        type="button"
        onClick={handleCheckout}
        disabled={isCheckingOut || items.length === 0}
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        {isCheckingOut ? 'Criando pedido…' : 'Finalizar compra'}
      </button>
    </div>
  );
}

// CartView — client component que renderiza a lista de pedido + total + botão
// de envio. Espelha o conteúdo do `cart-modal` do vanilla.
//
// Compliance Apple 3.1.3(e): a loja NÃO processa pagamentos no app. "Enviar
// Lista" só registra o pedido no Supabase (submitOrder grava a order com
// status 'pending') e mostra mensagem de sucesso — a equipe da Cali Colors
// entra em contato via WhatsApp pra confirmar itens/valores e fechar a venda.
// NÃO há checkout do Mercado Pago nem redirect pra URL externa de pagamento.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useCart } from '@/lib/hooks/useCart';
import { CartItem } from '@/components/CartItem';

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
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const {
    items,
    loading,
    error,
    remove,
    changeQty,
    checkout,
    clearCart,
    isMutating,
    mutationError,
    isCheckingOut,
    checkoutError,
  } = useCart();
  const [checkoutMsg, setCheckoutMsg] = useState<string | null>(null);
  const [cep, setCep] = useState('');
  const [rua, setRua] = useState('');
  const [numero, setNumero] = useState('');
  const [cidade, setCidade] = useState('');
  const [estado, setEstado] = useState('');

  function buildAddress(): string | null {
    const parts = [rua.trim(), numero.trim(), cep.trim(), cidade.trim(), estado.trim()].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  async function handleSendList() {
    setCheckoutMsg(null);
    try {
      const result = await checkout(buildAddress() ?? undefined);
      await clearCart().catch(() => {});
      router.push(`/loja/pedido-confirmado/${result.orderId}`);
    } catch (err) {
      setCheckoutMsg(
        (err as Error).message || 'Não foi possível enviar a lista. Tente de novo.'
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
        <h2 className="font-semibold mb-2">Entre pra ver sua lista de pedido</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Faça login pra salvar e enviar sua lista.
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
      <div>
        {checkoutMsg ? (
          <div role="alert" className="mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
            {checkoutMsg}
          </div>
        ) : null}
        <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <div className="text-5xl mb-3" aria-hidden="true">🛒</div>
          <h2 className="font-semibold mb-2">Lista vazia</h2>
          <p className="text-sm text-[color:var(--color-muted)] mb-4">Selecione produtos pra começar.</p>
          <Link href="/loja" className="inline-block px-5 py-2 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold">
            Ver loja
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200 text-sm text-blue-900">
        Ao enviar sua lista, a equipe da Cali Colors entrará em contato via
        WhatsApp para confirmar os itens e valores. A compra não é finalizada
        automaticamente.
      </div>
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

      <div className="bg-white rounded-xl p-4 border border-[color:var(--color-border)] mb-4 space-y-3">
        <p className="text-sm font-semibold">Endereço de entrega <span className="font-normal text-[color:var(--color-muted)]">(opcional)</span></p>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="addr-cep" className="block text-xs text-[color:var(--color-muted)] mb-1">CEP</label>
            <input
              id="addr-cep"
              type="text"
              inputMode="numeric"
              placeholder="00000-000"
              value={cep}
              onChange={(e) => setCep(e.target.value)}
              disabled={isCheckingOut}
              maxLength={9}
              className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
            />
          </div>
        </div>
        <div>
          <label htmlFor="addr-rua" className="block text-xs text-[color:var(--color-muted)] mb-1">Rua / Avenida</label>
          <input
            id="addr-rua"
            type="text"
            placeholder="Ex.: Rua das Flores"
            value={rua}
            onChange={(e) => setRua(e.target.value)}
            disabled={isCheckingOut}
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
          />
        </div>
        <div>
          <label htmlFor="addr-numero" className="block text-xs text-[color:var(--color-muted)] mb-1">Número / Complemento</label>
          <input
            id="addr-numero"
            type="text"
            placeholder="Ex.: 123, Apto 4"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            disabled={isCheckingOut}
            className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="addr-cidade" className="block text-xs text-[color:var(--color-muted)] mb-1">Cidade</label>
            <input
              id="addr-cidade"
              type="text"
              placeholder="Ex.: Guarulhos"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              disabled={isCheckingOut}
              className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
            />
          </div>
          <div className="w-20">
            <label htmlFor="addr-estado" className="block text-xs text-[color:var(--color-muted)] mb-1">Estado</label>
            <input
              id="addr-estado"
              type="text"
              placeholder="SP"
              value={estado}
              onChange={(e) => setEstado(e.target.value.toUpperCase())}
              disabled={isCheckingOut}
              maxLength={2}
              className="w-full px-3 py-2 rounded-lg border border-[color:var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-p1)]"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSendList}
        disabled={isCheckingOut || items.length === 0}
        className="w-full py-3 bg-[color:var(--color-p1)] text-white rounded-xl font-semibold disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        {isCheckingOut ? 'Enviando lista…' : 'Enviar Lista'}
      </button>
    </div>
  );
}

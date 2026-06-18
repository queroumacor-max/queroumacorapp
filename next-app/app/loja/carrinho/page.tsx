// /loja/carrinho — Server Component shell pra o carrinho.
// Equivalente ao modal `cart-modal` do vanilla (index.html linha 2444+).
// Como rota dedicada, dá link compartilhável e navegação browser (back/fwd
// funciona). O conteúdo dinâmico (lista + total + checkout) vive em
// CartView (client) que consome useCart.
//
// Envolve em <AppShell> pra ter o mesmo modelo do app (TopNav no topo +
// BottomNav embaixo) — sem ele a página ficava "solta", sem cabeçalho nem
// barra inferior.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { CartView } from './CartView';

export const metadata: Metadata = {
  title: 'Minha Lista de Pedido | Loja Cali Colors',
  description: 'Revise seus itens e envie sua lista para a Cali Colors.',
};

export default function CarrinhoPage() {
  return (
    <AppShell>
      <div className="p-4">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Minha Lista de Pedido
        </h1>
        <p className="text-sm text-[color:var(--color-muted)] mb-6">
          Revise os itens antes de enviar sua lista
        </p>
        <CartView />
      </div>
    </AppShell>
  );
}

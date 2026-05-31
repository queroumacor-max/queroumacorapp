// /loja/carrinho — Server Component shell pra o carrinho.
// Equivalente ao modal `cart-modal` do vanilla (index.html linha 2444+).
// Como rota dedicada, dá link compartilhável e navegação browser (back/fwd
// funciona). O conteúdo dinâmico (lista + total + checkout) vive em
// CartView (client) que consome useCart.

import type { Metadata } from 'next';
import { CartView } from './CartView';

export const metadata: Metadata = {
  title: 'Carrinho | Loja Cali Colors',
  description: 'Revise seus itens e finalize a compra.',
};

export default function CarrinhoPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Carrinho
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Revise antes de finalizar a compra
      </p>
      <CartView />
    </main>
  );
}

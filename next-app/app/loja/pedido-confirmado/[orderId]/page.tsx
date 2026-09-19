import type { Metadata } from 'next';
import { OrderConfirmView } from './OrderConfirmView';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';
export const metadata: Metadata = {
  title: 'Pedido Confirmado — Cali Colors',
  // Página autenticada — fora do índice de busca.
  robots: { index: false, follow: false },
};

export default async function OrderConfirmPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  return (
    <main className="min-h-screen bg-[color:var(--color-bg)] pb-24">
      <header className="bg-[color:var(--color-ink)] text-white px-4 pt-12 pb-4">
        <h1
          className="text-lg font-bold"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Pedido Confirmado
        </h1>
      </header>
      <div className="px-4 py-6 max-w-lg mx-auto">
        <OrderConfirmView orderId={orderId} />
      </div>
    </main>
  );
}

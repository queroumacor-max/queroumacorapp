// Página /pedidos — Server Component shell.
// Equivalente à tela `#screen-pedidos` do vanilla (rendered por loadPedidos
// em modules/pedidos.js). Aqui o RSC só monta o layout estático (heading +
// subtítulo + main); toda a parte interativa (fetch, filtros, render por
// status) vive em PedidosList, que é client-side e usa usePedidos().
//
// Por que separar? Mesmo padrão de notificacoes/page.tsx: RSC dá HTML pronto
// pra crawler/preview, e o client component só hidrata o conteúdo dinâmico.
// O título e subtítulo aparecem imediatamente enquanto o fetch dos pedidos
// roda em background.
//
// Diferença vs vanilla: o port só renderiza pedidos da loja (tabela `orders`).
// Os orçamentos (`quotes`) que o vanilla agregava na mesma tela ficam pra
// outra rota quando essa feature for portada.

import type { Metadata } from 'next';
import { PedidosList } from './PedidosList';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Pedidos | QueroUmaCor',
  description: 'Suas compras na loja Cali Colors — status, total e rastreio.',
};

export default function PedidosPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Meus Pedidos
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Compras da loja Cali Colors
      </p>
      <PedidosList />
    </div></AppShell>
  );
}

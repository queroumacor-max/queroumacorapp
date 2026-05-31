// PedidosList — client component que renderiza a lista de pedidos da loja.
// Espelha o output de `loadPedidos()` em modules/pedidos.js (skeleton enquanto
// carrega, empty state quando vazio, card-por-linha quando tem dados, error
// state quando estoura).
//
// Diferenças vs vanilla:
//  - filtros são state React (não mutação DOM em filterPedidos) — quando
//    usuário troca tab, a lista re-renderiza derivada do filtro;
//  - skeleton e empty seguem o mesmo padrão visual de NotificationsList pra
//    UI consistente entre as telas do app;
//  - tabs default escondem rascunho/pendente/cancelado, expondo só os estados
//    que importam pro usuário no dia-a-dia (Pago/Enviado/Entregue). Os
//    cancelados/pendentes ainda aparecem em "Todos" — não escondemos
//    dado, só economizamos cliques nas tabs.

'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { usePedidos, type PedidoFilter } from '@/lib/hooks/usePedidos';
import { OrderCard } from '@/components/OrderCard';

// Tabs visíveis no header. Mantemos só os 4 estados que o usuário acessa
// com mais frequência. "Todos" inclui rascunho/pendente/cancelado/refunded
// — quem quiser ver pode rolar pelo grupo. Adicionar mais tabs depois é
// trivial: só pluga aqui que o hook já cobre todo OrderStatus.
const TABS: Array<{ value: PedidoFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'pago', label: 'Pago' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'entregue', label: 'Entregue' },
];

// Skeleton reflete altura/forma do OrderCard real (~100px) pra que o layout
// não pule quando os dados chegam (CLS = 0). Mesmo padrão do
// NotificationsList: animate-pulse + cores via tokens.
function SkeletonRow() {
  return (
    <div className="bg-white rounded-xl border border-[color:var(--color-border)] p-4 flex flex-col gap-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[color:var(--color-border)] flex-shrink-0" />
        <div className="flex-1">
          <div className="h-3 w-1/2 bg-[color:var(--color-border)] rounded mb-2" />
          <div className="h-2 w-3/4 bg-[color:var(--color-border)] rounded" />
        </div>
        <div className="h-5 w-16 bg-[color:var(--color-border)] rounded-full" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-16 bg-[color:var(--color-border)] rounded" />
        <div className="h-3 w-24 bg-[color:var(--color-border)] rounded" />
      </div>
    </div>
  );
}

function FilterTabs({
  filter,
  setFilter,
}: {
  filter: PedidoFilter;
  setFilter: (f: PedidoFilter) => void;
}) {
  return (
    <div
      className="flex gap-2 overflow-x-auto mb-4 pb-1"
      role="tablist"
      aria-label="Filtrar por status"
    >
      {TABS.map((tab) => {
        const active = tab.value === filter;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setFilter(tab.value)}
            className={
              'px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ' +
              (active
                ? 'bg-[color:var(--color-ink)] text-white'
                : 'bg-white border border-[color:var(--color-border)] text-[color:var(--color-ink)] hover:bg-[color:var(--color-bg)]')
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function PedidosList() {
  const { user, loading: authLoading } = useAuth();
  const { pedidos, allPedidos, loading, error, filter, setFilter } = usePedidos();

  // AuthProvider expõe `loading` enquanto a sessão tá sendo restaurada do
  // storage — durante essa janela mostramos skeleton pra não piscar "faça
  // login" pro usuário já logado. Mesmo pattern do NotificationsList.
  if (authLoading) {
    return (
      <div className="space-y-3" aria-label="Carregando">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📦
        </div>
        <h2 className="font-semibold mb-2">Entre pra ver seus pedidos</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Suas compras da loja Cali Colors aparecem aqui depois que você faz login.
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
      <>
        <FilterTabs filter={filter} setFilter={setFilter} />
        <div className="space-y-3" aria-label="Carregando pedidos">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-4xl mb-3" aria-hidden="true">
          ⚠️
        </div>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Não foi possível carregar os pedidos. Tente de novo.
        </p>
      </div>
    );
  }

  // Empty global (sem pedidos nenhum). Mostramos CTA pra loja — não
  // adianta mostrar tabs aqui porque não tem nada pra filtrar.
  if (allPedidos.length === 0) {
    return (
      <div className="text-center py-12 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
        <div className="text-5xl mb-3" aria-hidden="true">
          📦
        </div>
        <h2 className="font-semibold mb-2">Sem pedidos da loja ainda</h2>
        <p className="text-sm text-[color:var(--color-muted)] mb-4">
          Quando comprar tintas, EPI ou ferramentas, seus pedidos aparecem aqui.
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

  // Tem pedidos mas o filtro escondeu todos — mensagem específica pro caso,
  // sugerindo a tab "Todos" pra resetar.
  if (pedidos.length === 0) {
    return (
      <>
        <FilterTabs filter={filter} setFilter={setFilter} />
        <div className="text-center py-10 px-4 rounded-xl bg-white border border-[color:var(--color-border)]">
          <p className="text-sm text-[color:var(--color-muted)] mb-3">
            Nenhum pedido nesse status.
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="text-xs font-semibold text-[color:var(--color-p1)]"
          >
            Ver todos
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <FilterTabs filter={filter} setFilter={setFilter} />
      <ul className="space-y-3">
        {pedidos.map((o) => (
          <li key={o.id}>
            <OrderCard order={o} />
          </li>
        ))}
      </ul>
    </>
  );
}

// PintorRequestsSection — espelha o `#pintor-requests` do vanilla
// (index.html linha 932+). Mostra "Nenhum pedido ainda" como empty state
// pra pintor sem solicitações de orçamento. Versão estática (sem fetch)
// pra MVP — quando a feature de pipeline server-side estiver wired no
// next-app, troca por hook real.

export function PintorRequestsSection() {
  return (
    <div className="px-3.5 pt-4 pb-2">
      <div className="text-[13px] font-bold uppercase tracking-wider text-[color:var(--color-muted)] mb-3">
        Pedidos de Orçamento
      </div>
      <div
        className="bg-white text-center"
        style={{
          borderRadius: 14,
          padding: 20,
          boxShadow: '0 2px 8px rgba(0,0,0,.05)',
        }}
      >
        <div className="text-3xl mb-2" aria-hidden="true">📥</div>
        <div
          className="font-bold"
          style={{ fontSize: 14, color: 'var(--color-ink)' }}
        >
          Nenhum pedido ainda
        </div>
        <div
          className="mt-1"
          style={{ fontSize: 12, color: 'var(--color-muted)' }}
        >
          Ative o PRO para receber pedidos de clientes
        </div>
      </div>
    </div>
  );
}

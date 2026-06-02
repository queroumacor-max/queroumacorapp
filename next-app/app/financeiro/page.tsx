// Página /financeiro — Server Component shell.
// Equivalente à tela `#screen-financeiro` do vanilla (rendered por
// loadFinanceiro em modules/financeiro.js). Aqui o RSC só monta o layout
// estático (heading + subtítulo + main); toda a parte interativa (fetch,
// agregação, IA, mutations de criar/apagar lançamento) vive em Dashboard,
// que é client-side e usa useFinanceiro().
//
// Por que separar? Mesmo padrão de notificacoes/page.tsx, pedidos/page.tsx,
// leads/page.tsx: RSC dá HTML pronto pra crawler/preview, e o client
// component só hidrata o conteúdo dinâmico. O título e subtítulo aparecem
// imediatamente enquanto o fetch dos lançamentos roda em background.

import type { Metadata } from 'next';
import { Dashboard } from './Dashboard';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Financeiro | QueroUmaCor',
  description:
    'Controle de lucro do pintor — entradas, custos, lucro mensal e análise IA.',
};

export default function FinanceiroPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Financeiro
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Lucro, custos e análise dos últimos meses
      </p>
      <Dashboard />
    </div></AppShell>
  );
}

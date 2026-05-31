// Página /agenda — Server Component shell ("Minha Agenda").
// Equivalente à tela `#screen-agenda` do vanilla (renderizada por loadAgenda
// em modules/agenda.js). Aqui o RSC só monta o layout estático (heading +
// subtítulo + main); toda a parte interativa (calendário, lista do dia, modal
// de criar/editar, otimização IA) vive em AgendaCalendar — client-side.
//
// Mesmo padrão dos outros shells (pedidos/notificacoes/leads): RSC dá HTML
// pronto pra crawler/preview, e o client component só hidrata o conteúdo
// dinâmico. O título e subtítulo aparecem imediatamente enquanto o fetch dos
// jobs do mês roda em background.

import type { Metadata } from 'next';
import { AgendaCalendar } from './AgendaCalendar';

export const metadata: Metadata = {
  title: 'Minha Agenda | QueroUmaCor',
  description:
    'Calendário de obras agendadas — gerencie projetos por dia, status e otimize sua rota.',
};

export default function AgendaPage() {
  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Minha Agenda
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Calendário de projetos e obras agendadas
      </p>
      <AgendaCalendar />
    </main>
  );
}

// Página /checklist — espelha o `#checklist-modal` do vanilla
// (index.html linha 1874+ + modules/checklist.js).

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { ChecklistView } from './ChecklistView';

export const metadata: Metadata = {
  title: 'Checklist de Obra | QueroUmaCor',
  description: 'Lista de tarefas pra organizar sua obra.',
};

export default function ChecklistPage() {
  return (
    <AppShell>
      <ChecklistView />
    </AppShell>
  );
}

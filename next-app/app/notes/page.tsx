// Página /notes — espelha o `#notes-modal` do vanilla (index.html linha
// 1890+ + modules/notes.js). Lista anotações + textarea pra criar + soft
// delete com botão de undo.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { NotesView } from './NotesView';

export const metadata: Metadata = {
  title: 'Anotações | QueroUmaCor',
  description: 'Lembretes, medidas e recados de obra.',
};

export default function NotesPage() {
  return (
    <AppShell>
      <NotesView />
    </AppShell>
  );
}

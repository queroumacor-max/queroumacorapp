// Página /publicar — Server Component shell.
// Equivalente ao "post-modal" do vanilla (openPortfolioComposer abre o modal
// de criação). Aqui virou tela dedicada — composer fica visível direto, sem
// estado de "modal aberto/fechado". O wrapper RSC entrega heading + main pro
// crawler/preview; a parte interativa (state local, upload, mutation) vive
// no Composer (client component).

import type { Metadata } from 'next';
import { Composer } from './Composer';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Publicar | QueroUmaCor',
  description:
    'Compartilhe seu trabalho — foto ou vídeo + legenda. Use a IA pra ganhar tempo.',
};

export default function PublicarPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-2xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Publicar
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Mostre seu trabalho — foto ou vídeo + legenda.
      </p>
      <Composer />
    </div></AppShell>
  );
}

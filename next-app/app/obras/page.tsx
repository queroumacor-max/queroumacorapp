// /obras — Gestão de Obras em tela cheia. Os avisos de convite e de escala
// caem aqui (?aba=agenda): o FUNCIONÁRIO pode não ser pintor e, então, não
// tem o tile em Meu Negócio.
import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { GestaoObras, type AbaObras } from './GestaoObras';

export const metadata: Metadata = {
  title: 'Gestão de Obras | QueroUmaCor',
  robots: { index: false, follow: false },
};

const ABAS: readonly AbaObras[] = ['obras', 'equipe', 'escala', 'agenda'];

export default async function ObrasPage({ searchParams }: { searchParams: Promise<{ aba?: string | string[] }> }) {
  const { aba } = await searchParams;
  const inicial = ABAS.find((a) => a === aba) ?? 'obras';
  return (
    <AppShell>
      <div className="min-h-full p-4 max-w-2xl mx-auto">
        <GestaoObras abaInicial={inicial} />
      </div>
    </AppShell>
  );
}

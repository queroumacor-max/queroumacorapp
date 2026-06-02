// Página /perfil/[id] — perfil público de qualquer usuário (não o próprio).
// Equivalente a `openUserProfile(userId)` do vanilla, que renderizava
// #screen-profile.
//
// Edge runtime obrigatório no CF Pages pra rotas dinâmicas (next-on-pages).
//
// Decisão: aceita tanto user_id (UUID) quanto tag (`@jackson_matos`) como
// parâmetro — facilita deeplink. Search/Stories passam id; share button do
// header usa tag. Resolvido no client view.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { PublicProfileView } from './PublicProfileView';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Perfil | QueroUmaCor',
  description: 'Perfil público de um usuário do QueroUmaCor.',
};

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppShell>
      <PublicProfileView idOrTag={id} />
    </AppShell>
  );
}

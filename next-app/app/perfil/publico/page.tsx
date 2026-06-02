// Página /perfil/publico — preview do próprio perfil público.
// Espelha `previewPublicProfile()` → `openUserProfile(userId, true)` do
// vanilla. Mostra avatar, nome, bio, role badge, stats (posts/seguidores/
// seguindo, rating) e grid de portfólio — exatamente como outro user
// veria ao abrir /profissional/<tag>.
//
// Sem botão de seguir (não faz sentido seguir a si mesmo); em vez disso
// botão "Voltar pra edição" → /perfil/editar.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { PreviewView } from './PreviewView';

export const metadata: Metadata = {
  title: 'Pré-visualização do perfil | QueroUmaCor',
  description: 'Veja como outros usuários veem seu perfil público.',
};

export default function PerfilPublicoPage() {
  return (
    <AppShell>
      <PreviewView />
    </AppShell>
  );
}

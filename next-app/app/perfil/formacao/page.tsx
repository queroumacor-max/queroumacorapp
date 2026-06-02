// Página /perfil/formacao — Server Component shell.
// Equivalente aos modais `manage-quals-modal` + `manage-courses-modal` do
// vanilla (renderizados por openManageQuals/openManageCourses em
// modules/quals-courses.js). Aqui consolidamos as duas features numa única
// tela "Formação & Cursos" — o vanilla mantinha modais separados porque a
// origem era um perfil scroll-único; em rota dedicada faz mais sentido
// agrupar pra evitar uma navegação extra.
//
// Por que separar shell + section? Mesmo padrão de /pedidos e /notificacoes:
// RSC dá HTML pronto pra crawler/preview, e os client components (Quals/
// CoursesSection) só hidratam o conteúdo dinâmico que precisa de
// session/Supabase.

import type { Metadata } from 'next';
import { QualsSection } from './QualsSection';
import { CoursesSection } from './CoursesSection';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Formação & Cursos | QueroUmaCor',
  description:
    'Cadastre suas formações, especializações e cursos pra mostrar no seu perfil.',
};

export default function FormacaoPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-2xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Formação &amp; Cursos
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Suas qualificações aparecem no perfil público.
      </p>
      <div className="space-y-8">
        <QualsSection />
        <CoursesSection />
      </div>
    </div></AppShell>
  );
}

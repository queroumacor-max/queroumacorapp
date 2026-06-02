// Página /perfil/editar — Server Component shell.
// Equivalente ao modal `#edit-profile-modal` do vanilla (openEditProfile em
// modules/profile-edit.js). Aqui o RSC só monta o layout estático (heading +
// subtítulo + main com as três sub-features); toda a parte interativa
// (forms, fetch, mutate, upload) vive nos client components abaixo.
//
// As três features (perfil base, especialidades, raio) ficam empilhadas como
// "cartões" porque no vanilla cada uma vira um modal separado — aqui
// transformamos em seções da mesma página pra que o usuário veja tudo de
// uma vez sem precisar abrir/fechar 3 modais.

import type { Metadata } from 'next';
import { EditProfileForm } from './EditProfileForm';
import { EditEspecialidadesForm } from './EditEspecialidadesForm';
import { EditRaioForm } from './EditRaioForm';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Editar perfil | QueroUmaCor',
  description:
    'Edite seus dados, foto, especialidades e raio de atendimento.',
};

export default function EditarPerfilPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-2xl mx-auto space-y-6">
      <header>
        <h1
          className="text-3xl font-bold mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Editar perfil
        </h1>
        <p className="text-sm text-[color:var(--color-muted)]">
          Mantenha seus dados atualizados pra clientes te encontrarem.
        </p>
      </header>

      <section
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
        aria-labelledby="profile-section-title"
      >
        <h2 id="profile-section-title" className="text-lg font-semibold mb-3">
          Seus dados
        </h2>
        <EditProfileForm />
      </section>

      <section
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
        aria-labelledby="specs-section-title"
      >
        <h2 id="specs-section-title" className="text-lg font-semibold mb-3">
          Especialidades
        </h2>
        <EditEspecialidadesForm />
      </section>

      <section
        className="bg-white rounded-xl border border-[color:var(--color-border)] p-4"
        aria-labelledby="radius-section-title"
      >
        <h2 id="radius-section-title" className="text-lg font-semibold mb-3">
          Raio de atendimento
        </h2>
        <EditRaioForm />
      </section>
    </div></AppShell>
  );
}

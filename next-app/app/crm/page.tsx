// Página /crm — Server Component shell ("Reativar Clientes").
// Equivalente à tela `#screen-crm` do vanilla (rendered por loadCrm em
// modules/crm.js). Aqui o RSC só monta o layout estático (heading +
// subtítulo + main); a parte interativa (lista, input de intervalo,
// gerar mensagem, enviar WhatsApp) vive em CrmList, que é client-side.
//
// Mesmo padrão de /pedidos, /leads, /notificacoes: RSC dá HTML pronto
// pra crawler/preview enquanto o cliente hidrata o conteúdo dinâmico.
//
// Gating PRO acontece dentro de CrmList — RSC não conhece auth/profile
// ainda (sessão é client-side). Quando rolar SSR auth (cookies do
// Supabase), o paywall pode subir pra cá.

import type { Metadata } from 'next';
import { CrmList } from './CrmList';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Reativar Clientes | QueroUmaCor',
  description:
    'Lembre clientes antigos com mensagens personalizadas — recurso PRO.',
};

export default function CrmPage() {
  return (
    <AppShell><div className="min-h-screen p-4 max-w-3xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Reativar Clientes
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Clientes que sumiram há um tempo aparecem aqui. O Seu Zé escreve, você revisa e envia.
      </p>
      <CrmList />
    </div></AppShell>
  );
}

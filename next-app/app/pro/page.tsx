// Página /pro — espelha o `#pro-modal` do vanilla (index.html linha 1719+).
// Lista os 8 benefícios + ativação EXCLUSIVA por troca de pontos
// (1000 pts = 1 mês PRO, via /pontos → RPC redeem_pro_with_points). NÃO há
// preço/checkout in-app: o PRO é gratuito, obtido só com pontos.
//
// 4 lugares linkam pra /pro: ProfileHeader banner, SeuZeChat paywall,
// CrmList paywall, QuoteWizard paywall. Antes esses links davam 404.

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { ProView } from './ProView';

export const metadata: Metadata = {
  title: 'Plano PRO | QueroUmaCor',
  description:
    'Apareça no topo, desbloqueie o Seu Zé e arte pra Instagram, e receba mais clientes.',
};

export default function ProPage() {
  return (
    <AppShell>
      <ProView />
    </AppShell>
  );
}

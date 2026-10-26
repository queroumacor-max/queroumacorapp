// Página /pro — espelha o `#pro-modal` do vanilla (index.html linha 1719+).
// Lista os benefícios + "Assinar o PRO" (assinatura na loja via RevenueCat,
// só no app instalado; o preço vem da loja).
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

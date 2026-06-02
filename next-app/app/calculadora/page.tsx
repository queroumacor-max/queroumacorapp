// Página /calculadora — espelha o `#screen-calc` do vanilla (index.html
// linha 1313+ + modules/calc.js). Estimativa de tinta a partir de área +
// fator de superfície + nº de demãos. Botão "Estimar por foto" exposto
// como TODO (precisa porta da rota /api/area-from-photo + gate PRO).

import type { Metadata } from 'next';
import { AppShell } from '@/components/AppShell';
import { CalcView } from './CalcView';

export const metadata: Metadata = {
  title: 'Calculadora de Tinta | QueroUmaCor',
  description: 'Calcule quantos litros de tinta sua obra precisa.',
};

export default function CalculadoraPage() {
  return (
    <AppShell>
      <CalcView />
    </AppShell>
  );
}

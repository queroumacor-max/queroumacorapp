// Abrir a tela de compra (paywall) de qualquer lugar do app, sem importar
// o componente: quem escuta é o <PaywallHost> montado no AppShell.

export type MotivoPaywall = 'quote' | 'obra' | 'ia' | 'planos';
export const PAYWALL_EVENT = 'quc:paywall';

export function abrirPaywall(motivo: MotivoPaywall = 'planos'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PAYWALL_EVENT, { detail: { motivo } }));
}

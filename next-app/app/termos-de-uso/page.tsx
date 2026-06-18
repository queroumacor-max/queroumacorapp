// Rota pública /termos-de-uso — alias estável dos Termos de Uso, exigido
// pela Google Play Store e Apple App Store (URL pública acessível sem
// login). Renderiza exatamente o mesmo conteúdo de /info/termos pra manter
// fonte única de verdade. Não há gate de auth: /info/* já é público (o
// AuthGate é só client-side e o middleware só toca /api/*).
import type { Metadata } from 'next';
import TermosPage, { metadata as termosMetadata } from '../info/termos/page';

export const metadata: Metadata = termosMetadata;

export default function TermosDeUsoPage() {
  return <TermosPage />;
}

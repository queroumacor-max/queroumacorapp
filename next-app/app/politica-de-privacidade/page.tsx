// Rota pública /politica-de-privacidade — alias estável da Política de
// Privacidade, exigido pela Google Play Store e Apple App Store (URL
// pública acessível sem login). Renderiza exatamente o mesmo conteúdo de
// /info/privacidade pra manter fonte única de verdade. Não há gate de
// auth: /info/* já é público (o AuthGate é só client-side e o middleware
// só toca /api/*).
import type { Metadata } from 'next';
import PrivacidadePage, {
  metadata as privacidadeMetadata,
} from '../info/privacidade/page';

export const metadata: Metadata = privacidadeMetadata;

export default function PoliticaDePrivacidadePage() {
  return <PrivacidadePage />;
}

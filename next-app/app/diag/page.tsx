// /diag — diagnóstico do PRÓPRIO aparelho. Existe porque o dashboard
// /admin/errors depende de ADMIN_EMAILS no servidor, e enquanto essa env
// não estiver certa não dá pra ler nada por lá — ficamos sem saber, por
// exemplo, se o wrapper Android entra no gate do scroll pin ou se o
// service worker está no ar (as duas defesas do "500 ao retomar").
//
// Só mostra dados do navegador de quem abre (user-agent, service worker,
// viewport, rede). Nenhum dado de outro usuário, nenhuma env, nenhuma
// consulta ao banco — por isso é pública e sem gate.

import type { Metadata } from 'next';
import { DiagView } from './DiagView';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Diagnóstico | QueroUmaCor',
  description: 'Informações técnicas deste aparelho pra suporte.',
};

export default function DiagPage() {
  return (
    <main className="min-h-screen p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
        Diagnóstico
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-5">
        Dados técnicos deste aparelho. Toque em copiar e mande pro suporte.
      </p>
      <DiagView />
    </main>
  );
}

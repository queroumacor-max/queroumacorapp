// Página /orcamentos — Server Component shell.
// Equivalente à tela `#screen-pipeline` do vanilla (modules/pipeline.js
// loadPipeline + renderPipeline). Aqui o RSC só monta layout estático
// (heading + subtítulo + main); toda parte interativa (fetch, kanban,
// mutations, realtime) vive em PipelineKanban (client-side).
//
// Padrão alinhado com /pedidos, /leads e /notificacoes: RSC dá HTML pronto
// pra crawler/preview enquanto o client component hidrata o conteúdo.

import type { Metadata } from 'next';
import { PipelineKanban } from './PipelineKanban';

export const metadata: Metadata = {
  title: 'Meus Orçamentos | QueroUmaCor',
  description:
    'Pipeline de orçamentos do pintor — kanban de status: a orçar, enviado, aprovado, em execução, concluído.',
};

export default function OrcamentosPage() {
  return (
    <main className="min-h-screen p-4 max-w-6xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Meus Orçamentos
      </h1>
      <p className="text-sm text-[color:var(--color-muted)] mb-6">
        Pipeline dos seus orçamentos. Cada cliente vira um card que vai do
        rascunho até a conclusão.
      </p>
      <PipelineKanban />
    </main>
  );
}

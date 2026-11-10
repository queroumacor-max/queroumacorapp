// vagas.ts — lê as vagas ATIVAS da tabela `oportunidades`
// (migrations/2026-11-10-b-oportunidades.sql). A RLS já só deixa o usuário
// comum ver `tipo='vaga' AND status='ativa'`; os filtros aqui repetem a regra
// pra o admin (que enxerga tudo) ver no app o mesmo que os outros.
//
// Tabela ausente (SQL pendente) → lista vazia: recurso novo não derruba o
// perfil por causa de migration que ainda não rodou.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';
import type { Vaga } from '@/lib/vagas';

const COLUNAS =
  'id, titulo, empresa, cidade, bairro, descricao, remuneracao, contato, contato_whatsapp, contato_obs, fonte, fonte_url, anuncio_em, created_at';

interface Resposta {
  data: Vaga[] | null;
  error: { message: string; code?: string } | null;
}

// Cast manual — tabela nova, fora do schema TS gerado (mesmo padrão de stores).
function cliente() {
  return getSupabase() as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (c: string, v: string) => {
          eq: (c: string, v: string) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => PromiseLike<Resposta>;
            };
          };
        };
      };
    };
  };
}

export function ehTabelaAusente(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /oportunidades.*(does not exist|schema cache)/i.test(error.message ?? '');
}

export async function fetchVagasAtivas(): Promise<Vaga[]> {
  const { data, error } = await cliente()
    .from('oportunidades')
    .select(COLUNAS)
    .eq('tipo', 'vaga')
    .eq('status', 'ativa')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    if (ehTabelaAusente(error)) return [];
    throw new NetworkError('Não consegui carregar as vagas.', error);
  }
  return data ?? [];
}

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

const COLUNAS_BASE =
  'id, titulo, empresa, cidade, bairro, descricao, remuneracao, contato, contato_whatsapp, contato_obs, fonte, fonte_url, anuncio_em, created_at';
const COLUNAS = `${COLUNAS_BASE}, regime, conferido_em`;

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

function consultar(colunas: string) {
  return cliente()
    .from('oportunidades')
    .select(colunas)
    .eq('tipo', 'vaga')
    .eq('status', 'ativa')
    .order('created_at', { ascending: false })
    .limit(100);
}

export async function fetchVagasAtivas(): Promise<Vaga[]> {
  let { data, error } = await consultar(COLUNAS);
  // `regime`/`conferido_em` vieram num ALTER depois: sem eles (42703) a lista
  // sai sem o selo, em vez de a tela inteira falhar por SQL pendente.
  if (error && (error.code === '42703' || /regime|conferido_em/.test(error.message ?? ''))) {
    ({ data, error } = await consultar(COLUNAS_BASE));
  }
  if (error) {
    if (ehTabelaAusente(error)) return [];
    throw new NetworkError('Não consegui carregar as vagas.', error);
  }
  return data ?? [];
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Incidente 2026-09-25: o app pedia client_id no retorno antes do SQL que
// cria a coluna rodar. O PostgREST faz INSERT + SELECT num comando só, então
// o 42703 desfazia o INSERT — e o código supunha "já gravou", buscava a
// última obra e mostrava "Obra não encontrada ou sem permissão".
const chamadas: { op: string; cols: string }[] = [];
let respostas: { data: unknown; error: unknown }[] = [];

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      let op = '';
      const q = {
        insert: () => { op = 'insert'; return q; },
        update: () => { op = 'update'; return q; },
        eq: () => q,
        select: (cols: string) => {
          chamadas.push({ op: op || 'select', cols });
          return Promise.resolve(respostas.shift());
        },
      };
      return q;
    },
  }),
}));

import { salvarObra } from '@/lib/services/obras';

beforeEach(() => { chamadas.length = 0; });

describe('salvarObra com client_id ausente (42703)', () => {
  it('refaz o INSERT sem client_id em vez de supor que já gravou', async () => {
    respostas = [
      { data: null, error: { code: '42703', message: 'column obras.client_id does not exist' } },
      { data: [{ id: 'o1', nome: 'Joao' }], error: null },
    ];
    const obra = await salvarObra('u1', { nome: 'Joao' });
    expect(obra).toMatchObject({ id: 'o1', client_id: null });
    expect(chamadas.map((c) => c.op)).toEqual(['insert', 'insert']);
    expect(chamadas[1].cols).not.toContain('client_id');
  });

  it('segunda falha mostra o erro real, não "não encontrada"', async () => {
    respostas = [
      { data: null, error: { code: '42703', message: 'x' } },
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ];
    await expect(salvarObra('u1', { nome: 'Joao' })).rejects.not.toThrow(/não encontrada/);
  });
});

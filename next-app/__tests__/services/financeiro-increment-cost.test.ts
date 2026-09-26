// incrementCost: caminho atômico pela RPC `increment_material_cost` e
// fallback pro ler-e-regravar antigo quando a função ainda não existe no
// banco (42883/PGRST202). Migration: 2026-09-26-financeiro-increment-cost.sql.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { __resetSupabaseForTests, __setSupabaseForTests } from '../../lib/supabase';
import { incrementCost } from '../../lib/services/financeiro';
import { NetworkError, ValidationError } from '../../lib/errors';

interface Fake {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function fake(opts: {
  rpc: { data?: unknown; error?: unknown };
  select?: { data?: unknown; error?: unknown };
  update?: { error?: unknown };
}): Fake {
  const update = vi.fn();
  const from = vi.fn(() => {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.single = vi.fn(async () => ({ data: opts.select?.data ?? null, error: opts.select?.error ?? null }));
    b.update = vi.fn((row: unknown) => {
      update(row);
      const u: Record<string, unknown> = {};
      let n = 0;
      u.eq = vi.fn(() => {
        n += 1;
        return n >= 2 ? Promise.resolve({ error: opts.update?.error ?? null }) : u;
      });
      return u;
    });
    return b;
  });
  const rpc = vi.fn(async () => ({ data: opts.rpc.data ?? null, error: opts.rpc.error ?? null }));
  __setSupabaseForTests({ rpc, from } as never);
  return { rpc, from, update };
}

afterEach(() => {
  __resetSupabaseForTests();
});

describe('incrementCost', () => {
  it('usa a RPC atômica e não lê/regrava a tabela', async () => {
    const f = fake({ rpc: { data: 150 } });
    await incrementCost('job-1', 'painter-1', 50);
    expect(f.rpc).toHaveBeenCalledWith('increment_material_cost', { p_id: 'job-1', p_delta: 50 });
    expect(f.from).not.toHaveBeenCalled();
  });

  it('RPC sem linha (lançamento inexistente/alheio) estoura', async () => {
    fake({ rpc: { data: null } });
    await expect(incrementCost('job-x', 'painter-1', 10)).rejects.toBeInstanceOf(NetworkError);
  });

  it('erro real da RPC estoura sem cair no fallback', async () => {
    const f = fake({ rpc: { error: { code: '42501', message: 'permission denied' } } });
    await expect(incrementCost('job-1', 'painter-1', 10)).rejects.toBeInstanceOf(NetworkError);
    expect(f.from).not.toHaveBeenCalled();
  });

  it.each(['PGRST202', '42883'])('função ausente (%s) → cai no ler-e-regravar', async (code) => {
    const f = fake({
      rpc: { error: { code, message: 'function not found' } },
      select: { data: { material_cost: 40 } },
    });
    await incrementCost('job-1', 'painter-1', 25);
    expect(f.from).toHaveBeenCalledWith('jobs');
    expect(f.update).toHaveBeenCalledWith({ material_cost: 65 });
  });

  it('fallback nunca deixa custo negativo', async () => {
    const f = fake({
      rpc: { error: { code: 'PGRST202', message: 'x' } },
      select: { data: { material_cost: 10 } },
    });
    await incrementCost('job-1', 'painter-1', -50);
    expect(f.update).toHaveBeenCalledWith({ material_cost: 0 });
  });

  it('valida entrada antes de qualquer rede', async () => {
    const f = fake({ rpc: { data: 1 } });
    await expect(incrementCost('', 'p', 1)).rejects.toBeInstanceOf(ValidationError);
    await expect(incrementCost('j', 'p', 0)).rejects.toBeInstanceOf(ValidationError);
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

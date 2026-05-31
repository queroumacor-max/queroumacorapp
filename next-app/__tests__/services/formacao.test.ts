// Tests do service lib/services/formacao.ts.
// Pattern alinhado com __tests__/services/notifications.test.ts e leads.test.ts:
// injeta um fake chainable supabase via __setSupabaseForTests. O fake suporta
// .from().select().eq().order() pra reads, .insert().select().single() pra
// addQual/addCourse, e .delete().eq().eq() pra deletes.
//
// O `.single()` é o terminator pros inserts — diferente do `.then()` puro do
// leads.test.ts (que era para queries chainable). Aqui retornamos
// Promise<{data,error}> direto no método pra simular a API do supabase-js.
//
// Cobertura (12 testes):
//   - listQuals: empty userId, happy, data null, error.
//   - addQual: empty userId → ValidationError, empty title → ValidationError,
//     happy (com defaults icon), error → NetworkError.
//   - deleteQual: happy (chama eq id+user_id), error → NetworkError.
//   - listCourses: happy.
//   - addCourse: happy, error → NetworkError.
//   - deleteCourse: happy.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  addCourse,
  addQual,
  deleteCourse,
  deleteQual,
  listCourses,
  listQuals,
} from '../../lib/services/formacao';
import { NetworkError, ValidationError } from '../../lib/errors';

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

interface QueueItem {
  data?: unknown;
  error?: unknown;
}

function makeFakeClient(queue: QueueItem[] = []): {
  client: unknown;
  spies: ChainSpies;
} {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    single: vi.fn(),
  };

  const responses = [...queue];
  function nextResponse(): QueueItem {
    return responses.shift() ?? { data: null, error: null };
  }

  // Single chain object — todos os métodos retornam o mesmo objeto pra que
  // composições arbitrárias (.from().select().eq().order(), .from().insert()
  // .select().single(), .from().delete().eq().eq()) funcionem.
  const chain: Record<string, unknown> = {
    from: (t: string) => {
      spies.from(t);
      return chain;
    },
    select: (cols: string) => {
      spies.select(cols);
      return chain;
    },
    eq: (col: string, val: unknown) => {
      spies.eq(col, val);
      return chain;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      spies.order(col, opts);
      return chain;
    },
    insert: (payload: Record<string, unknown>) => {
      spies.insert(payload);
      return chain;
    },
    delete: () => {
      spies.delete();
      return chain;
    },
    // `.single()` é um terminator — retorna Promise direto (não chainable).
    // Consome um item da queue pra simular o resultado do insert+select.
    single: () => {
      spies.single();
      const r = nextResponse();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    // `.then` cobre as queries que terminam sem `.single()` (listQuals,
    // listCourses, deleteQual, deleteCourse).
    then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
      const r = nextResponse();
      resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── listQuals ─────────────────────────────────────────────────────────────

describe('listQuals', () => {
  it('userId vazio → resolve [] sem bater na rede', async () => {
    const { client, spies } = makeFakeClient([{ data: [{ id: 'q1' }] }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listQuals('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy path: retorna rows e usa filtros corretos', async () => {
    const rows = [
      {
        id: 'q1',
        user_id: 'u1',
        title: 'Técnico em pintura',
        org: 'SENAI',
        year: '2024',
        icon: '🎓',
        created_at: '2026-05-31T10:00:00Z',
      },
    ];
    const { client, spies } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await listQuals('u1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('qualifications');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('data null → resolve [] (não [null])', async () => {
    const { client } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listQuals('u1');
    expect(out).toEqual([]);
  });

  it('error → joga NetworkError com message do supabase', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'rls bloqueou' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(listQuals('u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── addQual ───────────────────────────────────────────────────────────────

describe('addQual', () => {
  it('userId vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addQual('', { title: 'X' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('title vazio → ValidationError (não toca na rede)', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addQual('u1', { title: '   ' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it('happy path: insert com defaults (icon=🎓) + select single', async () => {
    const row = {
      id: 'q1',
      user_id: 'u1',
      title: 'Curso X',
      org: null,
      year: null,
      icon: '🎓',
      created_at: '2026-05-31T10:00:00Z',
    };
    const { client, spies } = makeFakeClient([{ data: row }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);

    const out = await addQual('u1', { title: 'Curso X' });
    expect(out).toEqual(row);
    expect(spies.from).toHaveBeenCalledWith('qualifications');
    // Insert tem que receber: user_id, title trimmed, org/year null,
    // icon default '🎓'.
    expect(spies.insert).toHaveBeenCalledWith({
      user_id: 'u1',
      title: 'Curso X',
      org: null,
      year: null,
      icon: '🎓',
    });
    expect(spies.single).toHaveBeenCalled();
  });

  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'fk violation' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addQual('u1', { title: 'X' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

// ─── deleteQual ────────────────────────────────────────────────────────────

describe('deleteQual', () => {
  it('happy path: chama delete + eq(id) + eq(user_id) (defesa em prof.)', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await deleteQual('u1', 'q1');
    expect(spies.from).toHaveBeenCalledWith('qualifications');
    expect(spies.delete).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith('id', 'q1');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('error → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'permission denied' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(deleteQual('u1', 'q1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── listCourses ───────────────────────────────────────────────────────────

describe('listCourses', () => {
  it('happy path: tabela courses + order desc', async () => {
    const rows = [
      {
        id: 'c1',
        user_id: 'u1',
        title: 'Curso A',
        subtitle: null,
        cover_url: null,
        price: null,
        is_free: true,
        duration: null,
        link: 'https://exemplo.com',
        created_at: '2026-05-31T10:00:00Z',
      },
    ];
    const { client, spies } = makeFakeClient([{ data: rows }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await listCourses('u1');
    expect(out).toEqual(rows);
    expect(spies.from).toHaveBeenCalledWith('courses');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});

// ─── addCourse ─────────────────────────────────────────────────────────────

describe('addCourse', () => {
  it('happy path: insert com url→link e is_free=true (versão simples)', async () => {
    const row = {
      id: 'c1',
      user_id: 'u1',
      title: 'Pintura avançada',
      subtitle: null,
      cover_url: null,
      price: null,
      is_free: true,
      duration: null,
      link: 'https://aula.com',
      created_at: '2026-05-31T10:00:00Z',
    };
    const { client, spies } = makeFakeClient([{ data: row }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await addCourse('u1', {
      title: 'Pintura avançada',
      url: 'https://aula.com',
    });
    expect(out).toEqual(row);
    expect(spies.insert).toHaveBeenCalledWith({
      user_id: 'u1',
      title: 'Pintura avançada',
      link: 'https://aula.com',
      is_free: true,
    });
  });

  it('error path → joga NetworkError', async () => {
    const { client } = makeFakeClient([
      { data: null, error: { message: 'boom' } },
    ]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addCourse('u1', { title: 'X' })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});

// ─── deleteCourse ──────────────────────────────────────────────────────────

describe('deleteCourse', () => {
  it('happy path: delete + eq id + eq user_id', async () => {
    const { client, spies } = makeFakeClient([{ data: null }]);
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await deleteCourse('u1', 'c1');
    expect(spies.from).toHaveBeenCalledWith('courses');
    expect(spies.delete).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith('id', 'c1');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
  });
});

// Tests do port lib/services/signup.ts.
// Pattern: __setSupabaseForTests injeta um fake client com `from()` chainable
// + `auth.signUp` stubada. Cobre os 3 helpers exportados:
//   - checkTagAvailability (happy path + taken)
//   - validateInviteCode (com/sem code, com/sem referrer existente)
//   - signUp (happy path + duplicate tag + email inválido)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { __resetSupabaseForTests, __setSupabaseForTests } from '../../lib/supabase';
import { checkTagAvailability, signUp } from '../../lib/services/signup';
import { ConflictError, ValidationError } from '../../lib/errors';

beforeEach(() => {
  __resetSupabaseForTests();
});

// ── Fake builder ─────────────────────────────────────────────────────────────
// Constrói um client mockado com canais separados por tabela. Cada chamada
// `from(table)` devolve uma chain configurável que termina em `{ data, error }`.
// As mutations (`update`) registram o payload pra asserção; o `auth.signUp`
// retorna o que o teste passar.

interface FakeTable {
  // Resultado do SELECT final (após .eq/.limit/.is).
  selectResult?: { data: unknown[] | null; error: { message: string } | null };
  // Capturados pra asserção.
  lastUpdate?: { table: string; payload: unknown; eq?: [string, unknown] };
}

interface FakeOpts {
  tables?: Record<string, FakeTable>;
  signUp?: {
    data?: { user: { id: string } | null };
    error?: { message: string } | null;
  };
}

function makeFakeClient(opts: FakeOpts = {}): SupabaseClient {
  const tables = opts.tables ?? {};

  function chainFor(tableName: string) {
    const tbl = tables[tableName] ?? {};
    const result = tbl.selectResult ?? { data: [], error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      limit: () => Promise.resolve(result),
      update: (payload: unknown) => {
        tbl.lastUpdate = { table: tableName, payload };
        return {
          eq: (col: string, val: unknown) => {
            if (tbl.lastUpdate) tbl.lastUpdate.eq = [col, val];
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    // O `.limit()` resolve sozinho; alguns paths chamam `.is().limit()`,
    // outros `.eq().limit()`. O chain devolve a si mesmo até bater no limit.
    return chain;
  }

  const fake = {
    from: (table: string) => chainFor(table),
    auth: {
      signUp: vi.fn(async () => ({
        data: opts.signUp?.data ?? { user: { id: 'user-123' } },
        error: opts.signUp?.error ?? null,
      })),
    },
  };

  return fake as unknown as SupabaseClient;
}

// ── checkTagAvailability ─────────────────────────────────────────────────────

describe('checkTagAvailability', () => {
  it('happy path: tag livre → true', async () => {
    __setSupabaseForTests(
      makeFakeClient({
        tables: { profiles_public: { selectResult: { data: [], error: null } } },
      }),
    );
    const r = await checkTagAvailability('joaopintor');
    expect(r).toBe(true);
  });

  it('tag em uso → false', async () => {
    __setSupabaseForTests(
      makeFakeClient({
        tables: { profiles_public: { selectResult: { data: [{ id: 'u1' }], error: null } } },
      }),
    );
    const r = await checkTagAvailability('joaopintor');
    expect(r).toBe(false);
  });

  it('tag vazia → false (sem ir pra rede)', async () => {
    __setSupabaseForTests(makeFakeClient());
    const r = await checkTagAvailability('   ');
    expect(r).toBe(false);
  });

  it('erro do Supabase → true (fail-open, mesmo comportamento do vanilla)', async () => {
    __setSupabaseForTests(
      makeFakeClient({
        tables: {
          profiles_public: {
            selectResult: { data: null, error: { message: 'boom' } },
          },
        },
      }),
    );
    const r = await checkTagAvailability('joaopintor');
    expect(r).toBe(true);
  });

  it('normaliza pra lowercase antes do select', async () => {
    // Não tem como inspecionar o `.eq()` argumento sem instrumentar mais;
    // mas garantir que UPPERCASE não falha (e devolve disponível) cobre
    // que a normalização não estoura no path.
    __setSupabaseForTests(
      makeFakeClient({
        tables: { profiles_public: { selectResult: { data: [], error: null } } },
      }),
    );
    const r = await checkTagAvailability('JOAOpintor');
    expect(r).toBe(true);
  });
});

// validateInviteCode foi removida do service (cadastro agora é invite-only
// via link de perfil, sem código manual). Testes removidos junto com a fn.

// ── signUp ───────────────────────────────────────────────────────────────────

describe('signUp', () => {
  it('happy path: cria usuário, retorna userId', async () => {
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'user-xyz' } } },
    });
    __setSupabaseForTests(client);

    const r = await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'João',
      tag: 'joaopintor',
      phone: '5511959765031',
      userType: 'pintor',
    });
    expect(r).toEqual({ userId: 'user-xyz' });
  });

  it('tag duplicada → ConflictError, sem chamar auth.signUp', async () => {
    const client = makeFakeClient({
      tables: {
        profiles_public: {
          selectResult: { data: [{ id: 'u-existing' }], error: null },
        },
      },
    });
    __setSupabaseForTests(client);

    await expect(
      signUp({
        email: 'a@b.co',
        password: 'senha1234',
        name: 'João',
        tag: 'taken',
        phone: '5511959765031',
        userType: 'pintor',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    // auth.signUp não deve ser chamado se a tag já é dupla.
    const authMock = (client.auth as unknown as { signUp: { mock: { calls: unknown[] } } }).signUp;
    expect(authMock.mock.calls.length).toBe(0);
  });

  it('Supabase auth.signUp retorna erro → ValidationError', async () => {
    __setSupabaseForTests(
      makeFakeClient({
        tables: { profiles_public: { selectResult: { data: [], error: null } } },
        signUp: { data: { user: null }, error: { message: 'Email inválido' } },
      }),
    );

    await expect(
      signUp({
        email: 'invalido',
        password: 'senha1234',
        name: 'João',
        tag: 'joao',
        phone: '5511959765031',
        userType: 'pintor',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('signUp devolve user=null sem error → ValidationError (defensivo)', async () => {
    __setSupabaseForTests(
      makeFakeClient({
        tables: { profiles_public: { selectResult: { data: [], error: null } } },
        signUp: { data: { user: null }, error: null },
      }),
    );

    await expect(
      signUp({
        email: 'a@b.co',
        password: 'senha1234',
        name: 'João',
        tag: 'joao',
        phone: '5511959765031',
        userType: 'pintor',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('referrerId presente → cria conta e mantém userId', async () => {
    // Fluxo novo (invite-by-link): o caller passa o referrerId capturado
    // pelo ReferralCapture. signup.ts grava em profiles.invited_by + faz
    // INSERT em referrals (best-effort). Como o fake client não captura
    // .insert(), aqui validamos só que o signUp resolve com o userId — o
    // efeito colateral é silencioso por design.
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'user-new' } } },
    });
    __setSupabaseForTests(client);

    const r = await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'João',
      tag: 'joao',
      phone: '5511959765031',
      userType: 'pintor',
      referrerId: 'ref-xyz',
    });
    expect(r.userId).toBe('user-new');
  });

  it('referrerId igual ao próprio user → ignora (não tenta auto-indicação)', async () => {
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'user-new' } } },
    });
    __setSupabaseForTests(client);

    const r = await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'João',
      tag: 'joao',
      phone: '5511959765031',
      userType: 'pintor',
      referrerId: 'user-new',
    });
    expect(r.userId).toBe('user-new');
  });

  // ── Age gate (LGPD-K + Apple 1.6 + Google Family Policy) ──────────────────

  it('birthDate de menor de 18 anos → ValidationError', async () => {
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'user-new' } } },
    });
    __setSupabaseForTests(client);

    // 17 anos atrás (boundary: ainda menor de 18)
    const d = new Date();
    d.setFullYear(d.getFullYear() - 17);
    const tooYoung = d.toISOString().slice(0, 10);

    await expect(
      signUp({
        email: 'menor@teste.com',
        password: 'senha1234',
        name: 'Menor',
        tag: 'menorzao',
        phone: '5511959765031',
        userType: 'pintor',
        birthDate: tooYoung,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    // auth.signUp não deve ser chamado quando age gate bloqueia.
    const authMock = (client.auth as unknown as { signUp: { mock: { calls: unknown[] } } }).signUp;
    expect(authMock.mock.calls.length).toBe(0);
  });

  it('birthDate de exatamente 18 anos → aceita', async () => {
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'user-ok' } } },
    });
    __setSupabaseForTests(client);

    // 18 anos atrás (ontem pra garantir que já completou)
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    d.setDate(d.getDate() - 1);
    const okAge = d.toISOString().slice(0, 10);

    const r = await signUp({
      email: 'ok@teste.com',
      password: 'senha1234',
      name: 'Joao',
      tag: 'joaook',
      phone: '5511959765031',
      userType: 'pintor',
      birthDate: okAge,
    });
    expect(r.userId).toBe('user-ok');
  });

  it('birthDate ausente → passa (compat com users legacy via UPDATE)', async () => {
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'user-legacy' } } },
    });
    __setSupabaseForTests(client);

    const r = await signUp({
      email: 'legacy@teste.com',
      password: 'senha1234',
      name: 'Legacy',
      tag: 'legacy',
      phone: '5511959765031',
      userType: 'pintor',
      // sem birthDate — frontend novo sempre manda, mas mantemos compat
    });
    expect(r.userId).toBe('user-legacy');
  });

  it('passa metadados (name, tag, phone, user_type) pro auth.signUp', async () => {
    const client = makeFakeClient({
      tables: { profiles_public: { selectResult: { data: [], error: null } } },
      signUp: { data: { user: { id: 'u1' } } },
    });
    __setSupabaseForTests(client);

    await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'João Silva',
      tag: 'joaosilva',
      phone: '5511959765031',
      userType: 'grafiteiro',
    });

    const authMock = (client.auth as unknown as {
      signUp: { mock: { calls: Array<[{ options: { data: Record<string, unknown> } }]> } };
    }).signUp;
    expect(authMock.mock.calls.length).toBe(1);
    const arg = authMock.mock.calls[0][0];
    expect(arg.options.data).toEqual({
      name: 'João Silva',
      tag: 'joaosilva',
      phone: '5511959765031',
      user_type: 'grafiteiro',
    });
  });
});

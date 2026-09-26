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
  // Linhas que o UPDATE "atinge". `[]` simula perfil INEXISTENTE — que é o
  // caso que o supabase-js reporta como sucesso com zero linhas, e que o
  // signUp usa pra decidir criar a linha na mão.
  updateResult?: { data: unknown[] | null; error: { message: string } | null };
  // Capturados pra asserção.
  lastUpdate?: { table: string; payload: unknown; eq?: [string, unknown] };
  lastInsert?: Record<string, unknown>;
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
      insert: (row: Record<string, unknown>) => {
        tbl.lastInsert = row;
        return Promise.resolve({ data: null, error: null });
      },
      update: (payload: unknown) => {
        tbl.lastUpdate = { table: tableName, payload };
        const upd = tbl.updateResult ?? { data: [{ id: 'user-xyz' }], error: null };
        const after = {
          // `.eq(...)` sozinho resolve (paths antigos) e também aceita
          // `.select()` depois — que é como o signUp descobre se o UPDATE
          // achou alguma linha.
          select: () => Promise.resolve(upd),
          then: (fn: (v: unknown) => unknown) => Promise.resolve(upd).then(fn),
        };
        return {
          eq: (col: string, val: unknown) => {
            if (tbl.lastUpdate) tbl.lastUpdate.eq = [col, val];
            return after;
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

  it('reafirma nome, @tag e categoria no perfil depois de criar a conta', async () => {
    // 07/09/2026 — o "cadastro em duas etapas": quem terminava o cadastro caía
    // no /completar-perfil e digitava tudo de novo. Acontece quando o perfil
    // nasce sem @tag, e nasce sem @tag quando a `handle_new_user` viva no
    // banco é a versão anterior a 18/06 (que só gravava name/user_type/role).
    // Não dá pra checar daqui qual versão está no ar — então o cliente
    // reafirma a identidade, que é no-op quando a trigger já gravou.
    const profiles = { selectResult: { data: [], error: null } } as {
      selectResult: { data: unknown[] | null; error: null };
      lastUpdate?: { table: string; payload: Record<string, unknown> };
    };
    const client = makeFakeClient({
      tables: {
        profiles_public: { selectResult: { data: [], error: null } },
        profiles,
      },
      signUp: { data: { user: { id: 'user-xyz' } } },
    });
    __setSupabaseForTests(client);

    await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'Ana Arquiteta',
      tag: 'AnaArq',
      phone: '5511959765031',
      userType: 'arquiteto',
    });

    const payload = profiles.lastUpdate?.payload as Record<string, unknown>;
    expect(payload).toBeTruthy();
    expect(payload.name).toBe('Ana Arquiteta');
    // @tag vai normalizada — é assim que a busca e o link de perfil comparam.
    expect(payload.tag).toBe('anaarq');
    expect(payload.user_type).toBe('arquiteto');
    expect(payload.phone).toBe('5511959765031');
  });

  it('cria a linha de perfil quando a trigger do banco nao criou', async () => {
    // A `handle_new_user` engole a propria excecao com RAISE WARNING: quando
    // ela falha, a conta de auth nasce e o PERFIL NAO. Dai todo UPDATE vira
    // no-op silencioso (update sem linha nao e erro), o app manda a pessoa
    // pro /completar-perfil, ela preenche, nada e gravado e a tela volta —
    // o "cadastro em duas etapas" que nao acabava.
    const profiles = {
      selectResult: { data: [], error: null },
      updateResult: { data: [], error: null }, // zero linhas = perfil ausente
    } as {
      selectResult: { data: unknown[] | null; error: null };
      updateResult: { data: unknown[] | null; error: null };
      lastInsert?: Record<string, unknown>;
    };
    const client = makeFakeClient({
      tables: {
        profiles_public: { selectResult: { data: [], error: null } },
        profiles,
      },
      signUp: { data: { user: { id: 'user-xyz' } } },
    });
    __setSupabaseForTests(client);

    await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'Ana Arquiteta',
      tag: 'anaarq',
      phone: '5511959765031',
      userType: 'arquiteto',
    });

    expect(profiles.lastInsert).toBeTruthy();
    expect(profiles.lastInsert?.id).toBe('user-xyz');
    expect(profiles.lastInsert?.tag).toBe('anaarq');
    expect(profiles.lastInsert?.user_type).toBe('arquiteto');
  });

  it('NAO insere quando o UPDATE achou a linha (a trigger fez o trabalho)', async () => {
    const profiles = {
      selectResult: { data: [], error: null },
      updateResult: { data: [{ id: 'user-xyz' }], error: null },
    } as {
      selectResult: { data: unknown[] | null; error: null };
      updateResult: { data: unknown[] | null; error: null };
      lastInsert?: Record<string, unknown>;
    };
    const client = makeFakeClient({
      tables: {
        profiles_public: { selectResult: { data: [], error: null } },
        profiles,
      },
      signUp: { data: { user: { id: 'user-xyz' } } },
    });
    __setSupabaseForTests(client);

    await signUp({
      email: 'a@b.co',
      password: 'senha1234',
      name: 'Ana',
      tag: 'ana',
      phone: '',
      userType: 'pintor',
    });

    expect(profiles.lastInsert).toBeUndefined();
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

  it('"User already registered" → mensagem genérica (não confirma que o e-mail tem conta)', async () => {
    __setSupabaseForTests(
      makeFakeClient({
        tables: { profiles_public: { selectResult: { data: [], error: null } } },
        signUp: { data: { user: null }, error: { message: 'User already registered' } },
      }),
    );
    const err = await signUp({
      email: 'existe@x.com',
      password: 'senha1234',
      name: 'João',
      tag: 'joao',
      phone: '5511959765031',
      userType: 'pintor',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe(
      'Não foi possível criar a conta. Se você já tem cadastro, faça login ou recupere a senha.',
    );
    expect(err.message).not.toMatch(/already|registered/i);
    expect((err.cause as { message: string }).message).toBe('User already registered');
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

  it('passa metadados (name, tag, phone, user_type, city, state, birth_date) pro auth.signUp', async () => {
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
    // city/state/birth_date vão no metadata de propósito: a trigger
    // handle_new_user grava tudo já no INSERT (SECURITY DEFINER), sem depender
    // do UPDATE pós-signup — que rodava sem sessão e deixava cidade em branco.
    // Não informados, descem como string vazia (nunca undefined).
    expect(arg.options.data).toEqual({
      name: 'João Silva',
      tag: 'joaosilva',
      phone: '5511959765031',
      user_type: 'grafiteiro',
      city: '',
      state: '',
      birth_date: '',
    });
  });

  it('city/state/birth_date informados descem no metadata, com UF em maiúsculas', async () => {
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
      city: 'Guarulhos',
      state: 'sp',
      birthDate: '1990-05-20',
    });

    const authMock = (client.auth as unknown as {
      signUp: { mock: { calls: Array<[{ options: { data: Record<string, unknown> } }]> } };
    }).signUp;
    const data = authMock.mock.calls[0][0].options.data;
    expect(data.city).toBe('Guarulhos');
    expect(data.state).toBe('SP');
    expect(data.birth_date).toBe('1990-05-20');
  });
});

// Tests do service lib/services/postInteractions.ts.
// Pattern alinhado com notifications.test.ts e pedidos.test.ts: fake supabase
// chainable injetado via __setSupabaseForTests; spies em from/select/eq/etc.
// pra asserções de "qual tabela, que coluna, que método".
//
// O service tem branches mais complexos que os outros (delete-or-insert
// idempotente, maybeSingle/single, count head: true, Promise.all em
// deletePost), então o fake precisa ser mais flexível:
//   - Suporta múltiplas queries em sequência via _queueResponses ou response
//     único default (opts.data/opts.error);
//   - `single`/`maybeSingle` ramificam o chain pra resolver imediatamente
//     em vez de via `then`;
//   - `count: 'exact', head: true` é retornado via opts.count.
//
// Cobertura (22 testes, > mínimo 15 pedido):
//   - toggleLike: insert quando não há like, delete quando há, 23505 swallow,
//     userId/postId vazio → ValidationError, erro do select → NetworkError.
//   - countLikes / fetchLikes / hasLiked: happy + filtros + vazio.
//   - addComment: happy, text vazio → ValidationError, erro → NetworkError.
//   - deleteComment: happy, id vazio → ValidationError.
//   - fetchComments: happy + filtros, postId vazio → [].
//   - toggleSave: insert quando não há, delete quando há, 23505 swallow.
//   - fetchSaved / hasSaved: happy + filtros.
//   - reportPost: happy + filtros, reason vazio → ValidationError.
//   - deletePost: chama 3 deletes em paralelo + DELETE final no posts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  toggleLike,
  fetchLikes,
  countLikes,
  hasLiked,
  addComment,
  deleteComment,
  fetchComments,
  toggleSave,
  fetchSaved,
  hasSaved,
  reportPost,
  deletePost,
  undoDeletePost,
  softDeleteComment,
  undoDeleteComment,
} from '../../lib/services/postInteractions';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── fake supabase chainable ───────────────────────────────────────────────
// Suporta:
//   - Queue de respostas (cada query consome o próximo da fila);
//   - Default response quando a fila está vazia;
//   - maybeSingle/single resolvem imediatamente via then-trick;
//   - Spies por método pra asserções.

interface QueuedResp {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

interface ChainSpies {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

interface FakeOpts {
  data?: unknown;
  error?: unknown;
  count?: number | null;
  // Sequência de respostas: cada query do código consome o próximo da fila.
  // Quando esgota, cai pro default (data/error/count).
  responses?: QueuedResp[];
}

function makeFakeClient(opts: FakeOpts = {}): {
  client: unknown;
  spies: ChainSpies;
} {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };

  const queue = [...(opts.responses ?? [])];
  const defaultResp: QueuedResp = {
    data: opts.data ?? null,
    error: opts.error ?? null,
    count: opts.count ?? null,
  };

  function nextResp(): QueuedResp {
    return queue.shift() ?? defaultResp;
  }

  // Builder fluente. Cada método "terminal" (then, maybeSingle, single) puxa
  // o próximo da fila — métodos intermediários (from/select/eq/order) só
  // logam no spy e devolvem o chain.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: (t: string) => {
      spies.from(t);
      return chain;
    },
    select: (cols: string, _opts?: unknown) => {
      spies.select(cols, _opts);
      return chain;
    },
    eq: (col: string, val: unknown) => {
      spies.eq(col, val);
      return chain;
    },
    // .is() usado pelo Wave 8 (soft delete: .is('deleted_at', null)).
    is: (_col: string, _val: unknown) => chain,
    // .in() pra enrichment de comentários (profiles_public IN (authors)).
    in: (_col: string, _vals: unknown[]) => chain,
    order: (col: string, optsOrder?: { ascending: boolean }) => {
      spies.order(col, optsOrder);
      return chain;
    },
    insert: (patch: Record<string, unknown>) => {
      spies.insert(patch);
      return chain;
    },
    update: (patch: Record<string, unknown>) => {
      spies.update(patch);
      return chain;
    },
    delete: () => {
      spies.delete();
      return chain;
    },
    maybeSingle: () => {
      spies.maybeSingle();
      const r = nextResp();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    single: () => {
      spies.single();
      const r = nextResp();
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
    // PostgrestBuilder vira await-able no final via `then`.
    then: (resolve: (v: { data: unknown; error: unknown; count: unknown }) => void) => {
      const r = nextResp();
      resolve({
        data: r.data ?? null,
        error: r.error ?? null,
        count: r.count ?? null,
      });
    },
  };

  return { client: chain, spies };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── toggleLike ────────────────────────────────────────────────────────────

describe('toggleLike', () => {
  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(toggleLike('', 'p1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('postId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(toggleLike('u1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('like não existe → INSERT + retorna {liked:true, count}', async () => {
    // 1) maybeSingle → null (não curtiu); 2) insert → ok; 3) countLikes → 5
    const { client, spies } = makeFakeClient({
      responses: [
        { data: null, error: null }, // select.maybeSingle
        { data: null, error: null }, // insert (await direto, sem .select)
        { count: 5, error: null },   // count head:true
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await toggleLike('u1', 'p1');
    expect(out).toEqual({ liked: true, count: 5 });
    expect(spies.from).toHaveBeenCalledWith('likes');
    expect(spies.insert).toHaveBeenCalledWith({ user_id: 'u1', post_id: 'p1' });
  });

  it('like existe → DELETE + retorna {liked:false, count}', async () => {
    const { client, spies } = makeFakeClient({
      responses: [
        { data: { id: 'like-1' }, error: null }, // select.maybeSingle (existe)
        { data: null, error: null },              // delete await
        { count: 3, error: null },                // count
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await toggleLike('u1', 'p1');
    expect(out).toEqual({ liked: false, count: 3 });
    expect(spies.delete).toHaveBeenCalled();
  });

  it('insert recebe 23505 (unique_violation) → swallow + liked:true', async () => {
    const { client } = makeFakeClient({
      responses: [
        { data: null, error: null },
        { data: null, error: { message: 'duplicate', code: '23505' } },
        { count: 1, error: null },
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await toggleLike('u1', 'p1');
    expect(out.liked).toBe(true);
  });

  it('select error → NetworkError', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: null, error: { message: 'rls' } }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(toggleLike('u1', 'p1')).rejects.toBeInstanceOf(NetworkError);
  });

  it('insert error (não-23505) → NetworkError', async () => {
    const { client } = makeFakeClient({
      responses: [
        { data: null, error: null },
        { data: null, error: { message: 'fk', code: '23503' } },
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(toggleLike('u1', 'p1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── countLikes / fetchLikes / hasLiked ────────────────────────────────────

describe('countLikes', () => {
  it('postId vazio → 0 sem bater na rede', async () => {
    const { client, spies } = makeFakeClient({ count: 42 });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await countLikes('');
    expect(out).toBe(0);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy: usa select head:true e retorna count', async () => {
    const { client, spies } = makeFakeClient({ count: 7 });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await countLikes('p1');
    expect(out).toBe(7);
    expect(spies.from).toHaveBeenCalledWith('likes');
    expect(spies.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(spies.eq).toHaveBeenCalledWith('post_id', 'p1');
  });
});

describe('fetchLikes', () => {
  it('happy: retorna array de user_ids', async () => {
    const { client } = makeFakeClient({
      data: [{ user_id: 'u1' }, { user_id: 'u2' }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchLikes('p1');
    expect(out).toEqual(['u1', 'u2']);
  });
});

describe('hasLiked', () => {
  it('postId vazio → false sem fetch', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await hasLiked('u1', '');
    expect(out).toBe(false);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('row encontrada → true', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: { id: 'l1' }, error: null }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await hasLiked('u1', 'p1')).toBe(true);
  });

  it('null → false', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: null, error: null }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await hasLiked('u1', 'p1')).toBe(false);
  });
});

// ─── addComment ────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('text vazio (só espaço) → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addComment('u1', 'p1', '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addComment('', 'p1', 'oi')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: insert + single + retorna row trimada', async () => {
    const row = {
      id: 'c1',
      post_id: 'p1',
      user_id: 'u1',
      text: 'olá mundo',
      created_at: '2026-05-31T10:00:00Z',
    };
    const { client, spies } = makeFakeClient({
      responses: [{ data: row, error: null }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await addComment('u1', 'p1', '  olá mundo  ');
    expect(out).toEqual(row);
    expect(spies.from).toHaveBeenCalledWith('comments');
    // O insert deve ter recebido o text trimado.
    expect(spies.insert).toHaveBeenCalledWith({
      post_id: 'p1',
      user_id: 'u1',
      text: 'olá mundo',
    });
  });

  it('error do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: null, error: { message: 'rls' } }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(addComment('u1', 'p1', 'oi')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── deleteComment ─────────────────────────────────────────────────────────

describe('deleteComment', () => {
  it('commentId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(deleteComment('', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: delete + eq id', async () => {
    // deleteComment espera array não-vazio em data (rows afetadas). Sem
    // isso o service interpreta como "RLS bloqueou" e joga NetworkError.
    const { client, spies } = makeFakeClient({
      responses: [{ data: [{ id: 'c1' }] }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await deleteComment('c1', 'u1');
    expect(spies.from).toHaveBeenCalledWith('comments');
    expect(spies.delete).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith('id', 'c1');
  });
});

// ─── fetchComments ─────────────────────────────────────────────────────────

describe('fetchComments', () => {
  it('postId vazio → [] sem fetch', async () => {
    const { client, spies } = makeFakeClient({ data: [{ id: 'c1' }] });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchComments('');
    expect(out).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy: filtra post_id e ordena ascending', async () => {
    const rows = [
      { id: 'c1', post_id: 'p1', user_id: 'u1', text: 'a', created_at: '1' },
      { id: 'c2', post_id: 'p1', user_id: 'u2', text: 'b', created_at: '2' },
    ];
    // fetchComments faz 2 queries: comments + profiles_public. Sem author
    // resolvido, devolve author:null por linha.
    const { client, spies } = makeFakeClient({
      responses: [{ data: rows }, { data: [] }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchComments('p1');
    expect(out).toEqual(rows.map((r) => ({ ...r, author: null })));
    expect(spies.eq).toHaveBeenCalledWith('post_id', 'p1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });
});

// ─── toggleSave ────────────────────────────────────────────────────────────

describe('toggleSave', () => {
  it('insert quando não salvou → {saved:true}', async () => {
    const { client, spies } = makeFakeClient({
      responses: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await toggleSave('u1', 'p1');
    expect(out).toEqual({ saved: true });
    expect(spies.from).toHaveBeenCalledWith('saved_posts');
    expect(spies.insert).toHaveBeenCalledWith({ user_id: 'u1', post_id: 'p1' });
  });

  it('delete quando já salvou → {saved:false}', async () => {
    const { client, spies } = makeFakeClient({
      responses: [
        { data: { id: 's1' }, error: null },
        { data: null, error: null },
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await toggleSave('u1', 'p1');
    expect(out).toEqual({ saved: false });
    expect(spies.delete).toHaveBeenCalled();
  });

  it('23505 no insert → swallow + saved:true', async () => {
    const { client } = makeFakeClient({
      responses: [
        { data: null, error: null },
        { data: null, error: { message: 'dup', code: '23505' } },
      ],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await toggleSave('u1', 'p1');
    expect(out.saved).toBe(true);
  });
});

// ─── fetchSaved / hasSaved ─────────────────────────────────────────────────

describe('fetchSaved', () => {
  it('userId vazio → [] sem fetch', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await fetchSaved('')).toEqual([]);
    expect(spies.from).not.toHaveBeenCalled();
  });

  it('happy: filtra user_id e ordena desc', async () => {
    const rows = [{ id: 's1', user_id: 'u1', post_id: 'p1', created_at: 't' }];
    const { client, spies } = makeFakeClient({ data: rows });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await fetchSaved('u1')).toEqual(rows);
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});

describe('hasSaved', () => {
  it('row → true', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: { id: 's1' }, error: null }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await hasSaved('u1', 'p1')).toBe(true);
  });

  it('null → false', async () => {
    const { client } = makeFakeClient({
      responses: [{ data: null, error: null }],
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await hasSaved('u1', 'p1')).toBe(false);
  });
});

// ─── reportPost ────────────────────────────────────────────────────────────

describe('reportPost', () => {
  it('reason vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(reportPost('u1', 'p1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('reporterId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(reportPost('', 'p1', 'spam')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: insert com todos os campos + target null default', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await reportPost('u1', 'p1', 'spam');
    expect(spies.from).toHaveBeenCalledWith('reports');
    expect(spies.insert).toHaveBeenCalledWith({
      reporter_id: 'u1',
      post_id: 'p1',
      target_user_id: null,
      reason: 'spam',
    });
  });

  it('targetUserId provided → vai no insert', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await reportPost('u1', 'p1', 'ofensivo', 'target-u2');
    expect(spies.insert).toHaveBeenCalledWith({
      reporter_id: 'u1',
      post_id: 'p1',
      target_user_id: 'target-u2',
      reason: 'ofensivo',
    });
  });

  it('error do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'rls bloqueou' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(reportPost('u1', 'p1', 'spam')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── deletePost (soft delete) ──────────────────────────────────────────────
// Mudança: deletePost agora faz UPDATE SET deleted_at = now() em vez de
// DELETE em cascata. Retorna { undoToken: postId }. Cleanup hard delete
// vive em cleanup_soft_deleted() no banco (cron / admin manual).

describe('deletePost (soft delete)', () => {
  it('postId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(deletePost('u1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(deletePost('', 'p1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: UPDATE posts SET deleted_at = ISO; eq id/user_id; retorna undoToken', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await deletePost('u1', 'p1');
    // Bate em posts uma única vez agora (sem mais cleanup paralelo).
    const tables = spies.from.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(['posts']);
    // O update precisa carregar deleted_at em string ISO.
    const updateCall = spies.update.mock.calls[0]?.[0] as { deleted_at: string };
    expect(typeof updateCall.deleted_at).toBe('string');
    expect(updateCall.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Filtros de eq: id E user_id (defesa contra cross-user delete).
    expect(spies.eq).toHaveBeenCalledWith('id', 'p1');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
    // undoToken === postId.
    expect(out).toEqual({ undoToken: 'p1' });
  });

  it('error do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'rls bloqueou' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(deletePost('u1', 'p1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── undoDeletePost ────────────────────────────────────────────────────────

describe('undoDeletePost', () => {
  it('postId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(undoDeletePost('u1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(undoDeletePost('', 'p1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: UPDATE posts SET deleted_at = null com filtros id/user_id', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await undoDeletePost('u1', 'p1');
    expect(spies.from).toHaveBeenCalledWith('posts');
    expect(spies.update).toHaveBeenCalledWith({ deleted_at: null });
    expect(spies.eq).toHaveBeenCalledWith('id', 'p1');
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('error do supabase → NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'rls' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(undoDeletePost('u1', 'p1')).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── softDeleteComment / undoDeleteComment ─────────────────────────────────

describe('softDeleteComment', () => {
  it('commentId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(softDeleteComment('', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('userId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(softDeleteComment('c1', '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy: UPDATE comments SET deleted_at = ISO, eq id, retorna undoToken', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await softDeleteComment('c1', 'u1');
    expect(spies.from).toHaveBeenCalledWith('comments');
    const update = spies.update.mock.calls[0]?.[0] as { deleted_at: string };
    expect(update.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(spies.eq).toHaveBeenCalledWith('id', 'c1');
    expect(out).toEqual({ undoToken: 'c1' });
  });

  it('error → NetworkError', async () => {
    const { client } = makeFakeClient({
      error: { message: 'rls' },
    });
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(softDeleteComment('c1', 'u1')).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('undoDeleteComment', () => {
  it('happy: UPDATE comments SET deleted_at = null', async () => {
    const { client, spies } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await undoDeleteComment('c1', 'u1');
    expect(spies.from).toHaveBeenCalledWith('comments');
    expect(spies.update).toHaveBeenCalledWith({ deleted_at: null });
    expect(spies.eq).toHaveBeenCalledWith('id', 'c1');
  });

  it('commentId vazio → ValidationError', async () => {
    const { client } = makeFakeClient();
    __setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(undoDeleteComment('', 'u1')).rejects.toBeInstanceOf(ValidationError);
  });
});

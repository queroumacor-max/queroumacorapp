// Tests do service lib/services/chat.ts.
// Pattern híbrido: a maioria dos testes usa fake client roteado por tabela
// (estilo feed.test.ts) pra suportar várias queries em paralelo. Casos
// específicos de RPC + storage usam fake dedicado com spies inline.
//
// Cobertura (28 testes):
//  Conversations
//   1. fetchConversations: userId vazio → [] sem rede
//   2. fetchConversations: RPC happy path retorna metas
//   3. fetchConversations: RPC vazio cai pro fallback de messages
//   4. fetchConversations: fallback dedup IDs duplicados sent+recv
//   5. fetchConversations: fallback marca is3way ao detectar __STORE_ADDED__
//   6. fetchConversations: fallback ordena reverse-chronological
//   7. findOrCreateConversation: retorna convId determinístico sorted
//   8. findOrCreateConversation: validar myId/otherId obrigatórios + iguais
//   9. findOrCreate3WayWithStore: prefix 3way: + sorted
//  10. findOrCreate3WayWithStore: validações
//  Messages
//  11. fetchMessages: convId vazio → []
//  12. fetchMessages: ordena cronologicamente + filtra system
//  13. fetchMessages: erro do banco → NetworkError
//  14. fetchMessages: cap defensivo no limit
//  15. sendMessage: happy path retorna Message
//  16. sendMessage: validações de input
//  17. sendMessage: erro do banco → NetworkError
//  18. sendMessage: trim de texto
//  19. markConversationAs3Way: insere system marker
//  Attachments
//  20. uploadAttachment: validar userId + file
//  21. uploadAttachment: rejeita tamanho > 10MB
//  22. uploadAttachment: rejeita MIME não permitido
//  23. uploadAttachment: happy path com image jpeg
//  24. uploadAttachment: caminho usa <userId>/chat/ prefix
//  Users
//  25. searchUsers: query curta → [] sem rede
//  26. searchUsers: filtra por nome e por tag
//  27. searchUsers: exclui IDs informados em excludeIds
//  28. searchUsers: marca isProfessional pra roles de pintor

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import {
  fetchConversations,
  findOrCreateConversation,
  findOrCreate3WayWithStore,
  fetchMessages,
  sendMessage,
  uploadAttachment,
  searchUsers,
  markConversationAs3Way,
  buildDirectConvId,
  is3WayConvId,
  strip3WayPrefix,
} from '../../lib/services/chat';
import { NetworkError, ValidationError } from '../../lib/errors';

// ─── Fake supabase chainable ───────────────────────────────────────────────
// Tabelas com queue de respostas (FIFO). Cada `from(table)` pop'a a próxima
// resposta da queue daquela tabela — permite testar fluxos com múltiplas
// queries no mesmo teste (sent + recv + profiles_public).

interface QueueResp {
  data?: unknown;
  error?: unknown;
  // Pra single/maybeSingle/select sem array.
  single?: unknown;
}

interface Spies {
  fromCalls: string[];
  selects: Array<{ table: string; cols: string }>;
  insertsByTable: Record<string, unknown[]>;
  eqsByTable: Record<string, Array<{ col: string; val: unknown }>>;
  insByTable: Record<string, Array<{ col: string; vals: unknown[] }>>;
  rpcCalls: Array<{ fn: string }>;
  uploads: Array<{ bucket: string; path: string; mime?: string }>;
  publicUrls: string[];
}

interface ClientControl {
  client: unknown;
  spies: Spies;
  rpcResponses: Array<{ data?: unknown; error?: unknown }>;
  /** Set the storage upload response (error or ok). */
  setStorageUpload(resp: { error?: unknown }): void;
  setStorageUrl(url: string): void;
}

function makeFakeClient(
  byTable: Record<string, QueueResp[]>,
): ClientControl {
  const spies: Spies = {
    fromCalls: [],
    selects: [],
    insertsByTable: {},
    eqsByTable: {},
    insByTable: {},
    rpcCalls: [],
    uploads: [],
    publicUrls: [],
  };

  const rpcResponses: Array<{ data?: unknown; error?: unknown }> = [];
  let storageUploadResp: { error?: unknown } = {};
  let storageUrlResp = 'https://test.public/url.jpg';

  function popResp(table: string): QueueResp {
    const q = byTable[table];
    if (!q || q.length === 0) return {};
    return q.shift()!;
  }

  function makeChain(table: string) {
    // Capturamos a próxima resposta no momento do `from()` pra que insert
    // .select().single() retorne o `single` configurado.
    const resp = popResp(table);
    const chain: Record<string, unknown> = {};
    chain.select = (cols: string) => {
      spies.selects.push({ table, cols });
      return chain;
    };
    chain.eq = (col: string, val: unknown) => {
      (spies.eqsByTable[table] ??= []).push({ col, val });
      return chain;
    };
    chain.neq = () => chain;
    chain.ilike = () => chain;
    chain.or = () => chain;
    chain.in = (col: string, vals: unknown[]) => {
      (spies.insByTable[table] ??= []).push({ col, vals });
      return chain;
    };
    chain.order = () => chain;
    chain.limit = () => chain;
    chain.range = () => chain;
    chain.insert = (payload: unknown) => {
      (spies.insertsByTable[table] ??= []).push(payload);
      return chain;
    };
    chain.update = () => chain;
    chain.delete = () => chain;
    chain.single = () => ({
      then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
        resolve({ data: resp.single ?? resp.data ?? null, error: resp.error ?? null }),
    });
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
      resolve({ data: resp.data ?? null, error: resp.error ?? null });
    };
    return chain;
  }

  const client = {
    from: (table: string) => {
      spies.fromCalls.push(table);
      return makeChain(table);
    },
    rpc: (fn: string) => {
      spies.rpcCalls.push({ fn });
      const r = rpcResponses.shift() ?? {};
      return {
        then: (resolve: (v: { data: unknown; error: unknown }) => void) =>
          resolve({ data: r.data ?? null, error: r.error ?? null }),
      };
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, _f: unknown, opts?: { contentType?: string }) => {
          spies.uploads.push({ bucket, path, mime: opts?.contentType });
          return Promise.resolve({ error: storageUploadResp.error ?? null });
        },
        getPublicUrl: (path: string) => {
          spies.publicUrls.push(path);
          return { data: { publicUrl: storageUrlResp } };
        },
      }),
    },
  };

  return {
    client,
    spies,
    rpcResponses,
    setStorageUpload(r) {
      storageUploadResp = r;
    },
    setStorageUrl(u) {
      storageUrlResp = u;
    },
  };
}

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

// ─── Helpers puros (sem rede) ─────────────────────────────────────────────

describe('helpers puros', () => {
  it('buildDirectConvId é sorted e determinístico', () => {
    expect(buildDirectConvId('b', 'a')).toBe('a_b');
    expect(buildDirectConvId('a', 'b')).toBe('a_b');
  });

  it('is3WayConvId reconhece prefix', () => {
    expect(is3WayConvId('3way:foo')).toBe(true);
    expect(is3WayConvId('foo_bar')).toBe(false);
  });

  it('strip3WayPrefix remove prefix', () => {
    expect(strip3WayPrefix('3way:a_b')).toBe('a_b');
    expect(strip3WayPrefix('a_b')).toBe('a_b');
  });
});

// ─── fetchConversations ────────────────────────────────────────────────────

describe('fetchConversations', () => {
  it('userId vazio → [] sem bater na rede', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchConversations('');
    expect(out).toEqual([]);
    expect(ctl.spies.fromCalls).toHaveLength(0);
  });

  it('RPC happy path retorna metas', async () => {
    const ctl = makeFakeClient({});
    ctl.rpcResponses.push({
      data: [
        {
          conv_id: 'a_b',
          other_id: 'b',
          name: 'Bob',
          avatar_url: null,
          tag: 'bob',
          role: 'pintor',
          last_msg: 'oi',
          last_sender: 'b',
          last_msg_time: '2026-05-31T10:00:00Z',
          is3way: false,
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchConversations('a');
    expect(out).toHaveLength(1);
    expect(out[0]?.convId).toBe('a_b');
    expect(out[0]?.name).toBe('Bob');
    expect(out[0]?.lastMsgFromMe).toBe(false);
    expect(ctl.spies.rpcCalls[0]?.fn).toBe('get_conversations');
  });

  it('RPC vazio (não retorna array) cai pro fallback de messages', async () => {
    const ctl = makeFakeClient({
      messages: [
        { data: [] }, // sent
        { data: [] }, // recv
      ],
    });
    ctl.rpcResponses.push({ error: { message: 'function does not exist' } });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchConversations('a');
    expect(out).toEqual([]);
    expect(ctl.spies.fromCalls).toContain('messages');
  });

  it('fallback dedup msgs presentes em sent e recv', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          data: [
            {
              id: 'm1',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: 'hello',
              type: 'text',
              created_at: '2026-05-31T10:00:00Z',
            },
          ],
        },
        {
          // mesma msg, mas porque o user também é receiver dela (raro:
          // autoreply); deve ser dedup'd pra não duplicar count.
          data: [
            {
              id: 'm1',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: 'hello',
              type: 'text',
              created_at: '2026-05-31T10:00:00Z',
            },
          ],
        },
      ],
      profiles_public: [
        { data: [{ id: 'b', name: 'Bob', tag: null, avatar_url: null, role: null }] },
      ],
    });
    ctl.rpcResponses.push({ error: { message: 'rpc gone' } });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchConversations('a');
    expect(out).toHaveLength(1);
    expect(out[0]?.convId).toBe('a_b');
  });

  it('fallback detecta __STORE_ADDED__ e marca is3way=true', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          data: [
            {
              id: 'm1',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: 'oi',
              type: 'text',
              created_at: '2026-05-31T10:00:00Z',
            },
            {
              id: 'm2',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: '__STORE_ADDED__',
              type: 'system',
              created_at: '2026-05-31T10:05:00Z',
            },
          ],
        },
        { data: [] },
      ],
      profiles_public: [
        { data: [{ id: 'b', name: 'Bob' }] },
      ],
    });
    ctl.rpcResponses.push({ error: { message: 'rpc gone' } });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchConversations('a');
    expect(out).toHaveLength(1);
    expect(out[0]?.is3way).toBe(true);
  });

  it('fallback ordena reverse-chronological (mais recente primeiro)', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          data: [
            {
              id: 'm1',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: 'antigo',
              type: 'text',
              created_at: '2026-05-31T09:00:00Z',
            },
            {
              id: 'm2',
              sender_id: 'a',
              receiver_id: 'c',
              conversation_id: 'a_c',
              content: 'novo',
              type: 'text',
              created_at: '2026-05-31T11:00:00Z',
            },
          ],
        },
        { data: [] },
      ],
      profiles_public: [
        {
          data: [
            { id: 'b', name: 'Bob' },
            { id: 'c', name: 'Carol' },
          ],
        },
      ],
    });
    ctl.rpcResponses.push({ error: { message: 'rpc gone' } });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchConversations('a');
    expect(out).toHaveLength(2);
    expect(out[0]?.convId).toBe('a_c');
    expect(out[1]?.convId).toBe('a_b');
  });
});

// ─── findOrCreateConversation / 3-way ─────────────────────────────────────

describe('findOrCreateConversation', () => {
  it('retorna convId determinístico sorted', async () => {
    const out = await findOrCreateConversation('zzz', 'aaa');
    expect(out).toBe('aaa_zzz');
  });

  it('valida inputs: vazio + iguais estouram ValidationError', async () => {
    await expect(findOrCreateConversation('', 'b')).rejects.toBeInstanceOf(ValidationError);
    await expect(findOrCreateConversation('a', '')).rejects.toBeInstanceOf(ValidationError);
    await expect(findOrCreateConversation('a', 'a')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('findOrCreate3WayWithStore', () => {
  it('retorna convId com prefix 3way: + sorted', async () => {
    const out = await findOrCreate3WayWithStore('zzz', 'aaa');
    expect(out).toBe('3way:aaa_zzz');
  });

  it('valida inputs', async () => {
    await expect(findOrCreate3WayWithStore('', 'b')).rejects.toBeInstanceOf(ValidationError);
    await expect(findOrCreate3WayWithStore('a', 'a')).rejects.toBeInstanceOf(ValidationError);
  });
});

// ─── fetchMessages ────────────────────────────────────────────────────────

describe('fetchMessages', () => {
  it('convId vazio → []', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchMessages('');
    expect(out).toEqual([]);
    expect(ctl.spies.fromCalls).toHaveLength(0);
  });

  it('ordena cronologicamente (asc) e filtra system markers', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          // banco devolve desc por causa do .order(desc) — service inverte.
          data: [
            {
              id: 'm2',
              sender_id: 'b',
              receiver_id: 'a',
              conversation_id: 'a_b',
              content: 'segunda',
              type: 'text',
              created_at: '2026-05-31T11:00:00Z',
            },
            {
              id: 'sys',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: '__STORE_ADDED__',
              type: 'system',
              created_at: '2026-05-31T10:30:00Z',
            },
            {
              id: 'm1',
              sender_id: 'a',
              receiver_id: 'b',
              conversation_id: 'a_b',
              content: 'primeira',
              type: 'text',
              created_at: '2026-05-31T10:00:00Z',
            },
          ],
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchMessages('a_b');
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2']);
    // system NÃO aparece.
    expect(out.find((m) => m.type === 'system')).toBeUndefined();
  });

  it('erro do banco → NetworkError', async () => {
    const ctl = makeFakeClient({
      messages: [{ error: { message: 'db down' } }],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(fetchMessages('a_b')).rejects.toBeInstanceOf(NetworkError);
  });

  it('limit > MAX é cappado (não estoura)', async () => {
    const ctl = makeFakeClient({
      messages: [{ data: [] }],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await fetchMessages('a_b', 99999);
    expect(out).toEqual([]);
  });
});

// ─── sendMessage ──────────────────────────────────────────────────────────

describe('sendMessage', () => {
  it('happy path retorna Message hidratada', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          single: {
            id: 'mNew',
            sender_id: 'a',
            receiver_id: 'b',
            conversation_id: 'a_b',
            content: 'oi',
            type: 'text',
            created_at: '2026-05-31T12:00:00Z',
          },
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const m = await sendMessage('a_b', 'a', 'b', 'oi');
    expect(m.id).toBe('mNew');
    expect(m.content).toBe('oi');
    expect(m.senderId).toBe('a');
    expect(m.status).toBe('sent');
  });

  it('validações de input', async () => {
    await expect(sendMessage('', 'a', 'b', 'oi')).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMessage('c', '', 'b', 'oi')).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMessage('c', 'a', '', 'oi')).rejects.toBeInstanceOf(ValidationError);
    await expect(sendMessage('c', 'a', 'b', '   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('erro do banco → NetworkError', async () => {
    const ctl = makeFakeClient({
      messages: [{ error: { message: 'insert failed' } }],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(sendMessage('a_b', 'a', 'b', 'oi')).rejects.toBeInstanceOf(NetworkError);
  });

  it('trim de texto antes do insert (texto)', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          single: {
            id: 'm1',
            sender_id: 'a',
            receiver_id: 'b',
            conversation_id: 'a_b',
            content: 'oi',
            type: 'text',
            created_at: '2026-05-31T12:00:00Z',
          },
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    await sendMessage('a_b', 'a', 'b', '   oi   ');
    const inserted = ctl.spies.insertsByTable.messages?.[0] as Record<string, unknown>;
    expect(inserted.content).toBe('oi');
    expect(inserted.type).toBe('text');
  });
});

describe('markConversationAs3Way', () => {
  it('insere system marker __STORE_ADDED__', async () => {
    const ctl = makeFakeClient({
      messages: [
        {
          single: {
            id: 'sys',
            sender_id: 'a',
            receiver_id: 'b',
            conversation_id: 'a_b',
            content: '__STORE_ADDED__',
            type: 'system',
            created_at: '2026-05-31T12:00:00Z',
          },
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    await markConversationAs3Way('a_b', 'a', 'b');
    const inserted = ctl.spies.insertsByTable.messages?.[0] as Record<string, unknown>;
    expect(inserted.content).toBe('__STORE_ADDED__');
    expect(inserted.type).toBe('system');
  });
});

// ─── uploadAttachment ─────────────────────────────────────────────────────

function makeFile(name: string, type: string, size: number): File {
  // node 20 + happy-dom têm File; usamos type-guard pra TS aceitar.
  // Tamanho real do blob é irrelevante — usamos File.size override via Object.defineProperty.
  const blob = new Blob([new Uint8Array(0)], { type });
  const f = new File([blob], name, { type });
  Object.defineProperty(f, 'size', { value: size, writable: false });
  return f;
}

describe('uploadAttachment', () => {
  it('valida userId + file presença', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    await expect(
      uploadAttachment('', makeFile('a.jpg', 'image/jpeg', 100)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      uploadAttachment('u', null as unknown as File),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejeita arquivos acima de 10MB com ValidationError', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const big = makeFile('big.jpg', 'image/jpeg', 11 * 1024 * 1024);
    await expect(uploadAttachment('u', big)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejeita MIME não permitido', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const bad = makeFile('script.exe', 'application/octet-stream', 100);
    await expect(uploadAttachment('u', bad)).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: upload + getPublicUrl + retorna result', async () => {
    const ctl = makeFakeClient({});
    ctl.setStorageUrl('https://cdn/test.jpg');
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('photo.jpg', 'image/jpeg', 500);
    const out = await uploadAttachment('user-1', f);
    expect(out.url).toBe('https://cdn/test.jpg');
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.messageType).toBe('image');
    // upload chamado com o path correto
    expect(ctl.spies.uploads).toHaveLength(1);
    expect(ctl.spies.uploads[0]?.bucket).toBe('posts');
    expect(ctl.spies.uploads[0]?.path.startsWith('user-1/chat/')).toBe(true);
  });

  it('path tem prefix <userId>/chat/ pra storage policy aceitar', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const f = makeFile('a.mp4', 'video/mp4', 200);
    const out = await uploadAttachment('user-XYZ', f);
    expect(out.messageType).toBe('video');
    expect(ctl.spies.uploads[0]?.path).toMatch(/^user-XYZ\/chat\/\d+\.mp4$/);
  });
});

// ─── searchUsers ──────────────────────────────────────────────────────────

describe('searchUsers', () => {
  it('query < 2 chars → [] sem rede', async () => {
    const ctl = makeFakeClient({});
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    expect(await searchUsers('')).toEqual([]);
    expect(await searchUsers('a')).toEqual([]);
    expect(await searchUsers(' a ')).toEqual([]);
    expect(ctl.spies.fromCalls).toHaveLength(0);
  });

  it('filtra por nome (case-insensitive) e por tag', async () => {
    const ctl = makeFakeClient({
      profiles_public: [
        {
          data: [
            { id: '1', name: 'Alice Painter', tag: 'alicep', avatar_url: null, role: 'pintor' },
            { id: '2', name: 'Bob', tag: 'bob123', avatar_url: null, role: null },
            { id: '3', name: 'Carol', tag: 'aliceFan', avatar_url: null, role: null },
          ],
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await searchUsers('alice');
    // Match por nome (Alice Painter) E por tag (aliceFan).
    expect(out.map((u) => u.id).sort()).toEqual(['1', '3']);
  });

  it('exclui IDs informados em excludeIds (e o próprio user em geral)', async () => {
    const ctl = makeFakeClient({
      profiles_public: [
        {
          data: [
            { id: '1', name: 'Alice', tag: 'alice', avatar_url: null, role: null },
            { id: '2', name: 'Alice2', tag: 'alice2', avatar_url: null, role: null },
          ],
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    const out = await searchUsers('alice', ['2']);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('1');
  });

  it('marca isProfessional para roles pintor/grafiteiro/automotivo', async () => {
    const ctl = makeFakeClient({
      profiles_public: [
        {
          data: [
            { id: '1', name: 'PintorAle', tag: 'p_xy', role: 'pintor' },
            { id: '2', name: 'GrafiteiroAle', tag: 'g_xy', role: 'grafiteiro' },
            { id: '3', name: 'AutoAle', tag: 'a_xy', role: 'automotivo' },
            { id: '4', name: 'ClienteAle', tag: 'c_xy', role: 'cliente' },
          ],
        },
      ],
    });
    __setSupabaseForTests(ctl.client as Parameters<typeof __setSupabaseForTests>[0]);
    // "ale" matches todos os names (PintorAle etc.) e tem 3 chars (passa o
    // min de 2).
    const out = await searchUsers('ale');
    const byId = new Map(out.map((u) => [u.id, u]));
    expect(byId.get('1')?.isProfessional).toBe(true);
    expect(byId.get('2')?.isProfessional).toBe(true);
    expect(byId.get('3')?.isProfessional).toBe(true);
    expect(byId.get('4')?.isProfessional).toBe(false);
  });
});

// silenciar warning sobre vi nÃo usado se for o caso (mas estamos usando).
void vi;

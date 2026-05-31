// Tests do service lib/services/aiChat.ts.
// Pattern: mock direto de globalThis.fetch (esse service é 100% HTTP, não
// toca em supabase). Tipagem do fetch via vi.fn assinada pra `mock.calls`
// vir com tuple-type correto.
//
// Cobertura (12 cenários — passa do mín 10):
//   sendChatMessage:
//     1. mensagem vazia → ValidationError
//     2. happy path → reply do backend (sem disclaimer)
//     3. erro de rede → fallback knowledge base (com disclaimer)
//     4. backend !ok → fallback knowledge base
//     5. AbortError propaga (não vira fallback)
//   suggestScope:
//     6. happy path → reply trimmed + sem disclaimer
//     7. backend erro → NetworkError com mensagem
//   transcribeAudio:
//     8. blob vazio → ValidationError (sem fetch)
//     9. happy path → text
//    10. backend erro → NetworkError com mensagem do JSON
//   textToSpeech:
//    11. texto vazio → ValidationError
//    12. happy path → objectURL via mock
//   suggestPrice:
//    13. input completamente vazio → ValidationError
//    14. happy path → { price, justification }
//   lookupKnowledge + helpers:
//    15. lookupKnowledge ('preço', 'rendimento'...) match correto

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sendChatMessage,
  suggestScope,
  transcribeAudio,
  textToSpeech,
  suggestPrice,
  lookupKnowledge,
  withDisclaimer,
  trimHistory,
  aiKnowledge,
  MAX_HISTORY,
  type ChatMessage,
} from '../../lib/services/aiChat';
import { ValidationError, NetworkError } from '../../lib/errors';

// Helper: fábrica de fetch mock tipada pra que `.calls[0]` venha como
// `[input, init]` tuple. Usa `RequestInfo|URL` pra abraçar todos os call sites.
function makeFetchMock(
  impl: (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => Promise<Response>
): typeof globalThis.fetch {
  return vi.fn(impl) as unknown as typeof globalThis.fetch;
}

let originalFetch: typeof globalThis.fetch | undefined;
let originalCreateObjectURL:
  | typeof URL.createObjectURL
  | undefined;
let originalRevokeObjectURL:
  | typeof URL.revokeObjectURL
  | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  originalCreateObjectURL = URL.createObjectURL;
  originalRevokeObjectURL = URL.revokeObjectURL;
});
afterEach(() => {
  if (originalFetch !== undefined) globalThis.fetch = originalFetch;
  // Restore só se foi reatribuído num teste (jsdom expõe sempre).
  if (originalCreateObjectURL) {
    URL.createObjectURL = originalCreateObjectURL;
  }
  if (originalRevokeObjectURL) {
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});

// ─── sendChatMessage ──────────────────────────────────────────────────────

describe('sendChatMessage', () => {
  it('mensagem vazia → ValidationError', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    await expect(sendChatMessage([], '')).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(sendChatMessage([], '   ')).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('happy path: devolve reply do backend (sem disclaimer)', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ reply: 'Use tinta acrílica acetinada.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    const out = await sendChatMessage([], 'que tinta uso?');
    expect(out).toBe('Use tinta acrílica acetinada.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // O history e a message vão no body como JSON.
    const init = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ message: 'que tinta uso?', history: [] });
  });

  it('erro de rede → fallback knowledge base com disclaimer', async () => {
    const fetchMock = makeFetchMock(async () => {
      throw new TypeError('Network down');
    });
    globalThis.fetch = fetchMock;
    const out = await sendChatMessage([], 'quanto cobrar pintura?');
    // Match em "preço" via heurística regex (quanto|cobr).
    expect(out).toContain(aiKnowledge.preco);
    expect(out).toMatch(/^Sou o Seu Zé/);
  });

  it('backend !ok → fallback knowledge base', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ error: 'IA não configurada' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    // Usamos "como aplicar epoxi" sem mencionar "tinta" pra evitar match
    // prematuro pela chave 'tinta' no dict (iteração de chaves vence regex).
    const out = await sendChatMessage([], 'como aplicar epoxi no piso?');
    expect(out).toContain(aiKnowledge.epoxi);
  });

  it('AbortError propaga (não vira fallback)', async () => {
    const fetchMock = makeFetchMock(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });
    globalThis.fetch = fetchMock;
    await expect(
      sendChatMessage([], 'oi')
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ─── suggestScope ─────────────────────────────────────────────────────────

describe('suggestScope', () => {
  it('happy path: devolve reply trimmed sem disclaimer', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({
          reply:
            'Sou o Seu Zé (assistente virtual). Texto x.\n\nPreparação: lixar parede...',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    globalThis.fetch = fetchMock;
    const out = await suggestScope('pintura interna 80m²');
    // O disclaimer "Sou o Seu Zé..." é stripado.
    expect(out).not.toMatch(/^Sou o Seu Zé/);
    expect(out).toContain('Preparação');
  });

  it('descrição vazia → ValidationError (sem fetch)', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    await expect(suggestScope('')).rejects.toBeInstanceOf(ValidationError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('backend não-ok → NetworkError com mensagem', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ error: 'rate limit' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    await expect(suggestScope('pintura interna')).rejects.toBeInstanceOf(
      NetworkError
    );
    await expect(suggestScope('pintura interna')).rejects.toMatchObject({
      message: 'rate limit',
    });
  });
});

// ─── transcribeAudio ──────────────────────────────────────────────────────

describe('transcribeAudio', () => {
  it('blob vazio → ValidationError (sem fetch)', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    const empty = new Blob([], { type: 'audio/webm' });
    await expect(transcribeAudio(empty)).rejects.toBeInstanceOf(ValidationError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('happy path: devolve text do backend', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ text: 'oi seu zé' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    const blob = new Blob(['fakeaudio'], { type: 'audio/webm' });
    const out = await transcribeAudio(blob);
    expect(out).toBe('oi seu zé');
    // Sanity: mandou multipart (FormData), não JSON.
    const init = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('backend não-ok → NetworkError com mensagem do JSON', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ error: 'transcribe falhou' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    const blob = new Blob(['fakeaudio'], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).rejects.toBeInstanceOf(NetworkError);
    await expect(transcribeAudio(blob)).rejects.toMatchObject({
      message: 'transcribe falhou',
    });
  });
});

// ─── textToSpeech ─────────────────────────────────────────────────────────

describe('textToSpeech', () => {
  it('texto vazio → ValidationError', async () => {
    await expect(textToSpeech('')).rejects.toBeInstanceOf(ValidationError);
    await expect(textToSpeech('   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('happy path: devolve objectURL', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(new Blob(['fake-audio-bytes'], { type: 'audio/mpeg' }), {
        status: 200,
      })
    );
    globalThis.fetch = fetchMock;
    // Mock createObjectURL — jsdom às vezes não expõe ou retorna formato
    // inconsistente. Aqui forçamos retorno estável pro assert.
    URL.createObjectURL = vi.fn(() => 'blob:mock-url-123');
    const out = await textToSpeech('Olá');
    expect(out).toBe('blob:mock-url-123');
  });

  it('backend !ok com JSON error → NetworkError', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ error: 'tts indisponível' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    await expect(textToSpeech('oi')).rejects.toMatchObject({
      message: 'tts indisponível',
    });
  });
});

// ─── suggestPrice ─────────────────────────────────────────────────────────

describe('suggestPrice', () => {
  it('input completamente vazio → ValidationError', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof globalThis.fetch;
    await expect(suggestPrice({})).rejects.toBeInstanceOf(ValidationError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('happy path: devolve { price, justification }', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({
          price: 2400,
          justification: '80m² × R$30/m² + extras',
          area_m2: 80,
          rate_brl_per_m2: 30,
          extras_brl: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    globalThis.fetch = fetchMock;
    const out = await suggestPrice({
      service_type: 'Pintura interna',
      area_m2: 80,
    });
    expect(out).toEqual({
      price: 2400,
      justification: '80m² × R$30/m² + extras',
    });
  });

  it('preço inválido (zero) no response → NetworkError', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ price: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;
    await expect(
      suggestPrice({ service_type: 'Pintura', area_m2: 50 })
    ).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── Helpers puros ────────────────────────────────────────────────────────

describe('lookupKnowledge', () => {
  it('match direto pela chave (substring)', () => {
    expect(lookupKnowledge('quanto custa tinta epoxi?')).toBe(
      aiKnowledge.tinta
    );
    expect(lookupKnowledge('como aplicar epoxi no chão')).toBe(
      aiKnowledge.epoxi
    );
  });

  it('match por regex heurística (quanto cobrar → preco)', () => {
    expect(lookupKnowledge('quanto cobrar pela mão de obra?')).toBe(
      aiKnowledge.preco
    );
    // 'lixar parede antes' bate a regex de preparo (lixa|massa|antes|prepar)
    // sem disparar a regex de preco (quanto|valor|cobr|preci) que vem antes.
    expect(lookupKnowledge('como lixar a parede antes')).toBe(
      aiKnowledge.preparo
    );
  });

  it('sem match → null', () => {
    expect(lookupKnowledge('lalala blah')).toBe(null);
    expect(lookupKnowledge('')).toBe(null);
  });
});

describe('withDisclaimer', () => {
  it('prepend disclaimer quando ausente', () => {
    expect(withDisclaimer('algo')).toMatch(/^Sou o Seu Zé/);
  });

  it('idempotente quando já tem disclaimer', () => {
    const already = 'Sou o Seu Zé (assistente virtual). texto';
    expect(withDisclaimer(already)).toBe(already);
  });
});

describe('trimHistory', () => {
  it('não trunca quando <= MAX_HISTORY', () => {
    const msgs: ChatMessage[] = Array.from({ length: 5 }, (_, i) => ({
      role: 'user' as const,
      content: String(i),
    }));
    expect(trimHistory(msgs)).toBe(msgs); // mesma ref
  });

  it('trunca pras últimas MAX_HISTORY msgs', () => {
    const msgs: ChatMessage[] = Array.from(
      { length: MAX_HISTORY + 5 },
      (_, i) => ({ role: 'user' as const, content: String(i) })
    );
    const out = trimHistory(msgs);
    expect(out.length).toBe(MAX_HISTORY);
    expect(out[0].content).toBe(String(5)); // primeiras 5 foram cortadas
    expect(out[out.length - 1].content).toBe(String(MAX_HISTORY + 4));
  });
});

// Auditoria de vazamento de informação (2026-09-26).
//
// H1: services fazem `throw new NetworkError(error.message, error)` e ~60
// telas mostram `err.message` direto. As classes de lib/errors.ts agora
// trocam a mensagem VISÍVEL quando ela é crua de backend (Postgres/
// PostgREST/GoTrue) — a crua fica em `raw` e em `cause` pro log.
// M1: `callAIText` não devolve mais o corpo do provedor nem nome de env.
// M4: log do Dualhook trunca o corpo e mascara sequência longa de dígitos.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { NetworkError, ValidationError, AppError, toAppError, errorToJson } from '../../lib/errors';
import {
  toFriendlyError,
  safeErrorMessage,
  looksLikeRawBackendError,
} from '../../lib/errors-friendly';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AppError — mensagem crua de backend nunca é a visível', () => {
  const RLS = 'new row violates row-level security policy for table "messages"';

  it('RLS vira texto VAGO (não diz bloqueio nem e-mail); a crua fica em raw/cause', () => {
    const pg = { message: RLS, code: '42501' };
    const e = new NetworkError(pg.message, pg);
    expect(e.message).toBe('Não foi possível concluir. Essa ação não pôde ser feita agora.');
    expect(e.message).not.toMatch(/messages|row-level|policy|bloque|e-mail/i);
    expect(e.raw).toBe(RLS);
    expect(e.cause).toBe(pg);
  });

  it('sem cause explícito, a crua vira a causa (reportFailure anexa "| causa:")', () => {
    const e = new ValidationError('duplicate key value violates unique constraint "x_pkey"');
    expect(e.message).not.toContain('x_pkey');
    expect(e.message).toContain('Já existe');
    expect((e.cause as Error).message).toContain('x_pkey');
  });

  it('coluna/relação/função inexistente → genérico, sem nome de objeto', () => {
    for (const raw of [
      'column profiles.foo does not exist',
      'relation "public.obras" does not exist',
      'Could not find the function public.x in the schema cache',
      'null value in column "username" of relation "profiles" violates not-null constraint',
    ]) {
      const e = new NetworkError(raw, { message: raw });
      expect(e.message).not.toMatch(/profiles|obras|public\.|username/);
      expect(e.raw).toBe(raw);
    }
  });

  it('mensagem nossa em português passa intacta (raw = null)', () => {
    const e = new NetworkError('Obra não encontrada ou sem permissão.');
    expect(e.message).toBe('Obra não encontrada ou sem permissão.');
    expect(e.raw).toBeNull();
    const u = new NetworkError('Falha de rede ao enviar a mídia (1.3 MB). Verifique a conexão e tente de novo.', {
      message: 'Failed to fetch',
    });
    expect(u.message).toContain('1.3 MB');
  });

  it('RAISE em português de trigger (texto de produto) não é trocado', () => {
    const pg = { message: 'Convite exige e-mail confirmado.', code: 'P0001' };
    expect(new NetworkError(pg.message, pg).message).toBe('Convite exige e-mail confirmado.');
  });

  it('toAppError/errorToJson não serializam a crua', () => {
    const json = errorToJson(new Error('permission denied for table profiles'));
    expect(json.error).not.toContain('profiles');
    const e = toAppError(new Error('JWT expired'));
    expect(e.message).toContain('Sessão expirada');
  });

  it('toFriendlyError casa pela crua (raw), não pelo texto já traduzido', () => {
    const e = new AppError('rate limit exceeded for messages');
    expect(toFriendlyError(e).title).toBe('Muitas tentativas');
  });
});

describe('safeErrorMessage (telas que leem erro do Supabase direto)', () => {
  it('traduz crua, preserva texto nosso', () => {
    expect(safeErrorMessage({ message: 'Invalid login credentials' })).toContain('incorretos');
    expect(safeErrorMessage('User already registered')).not.toMatch(/already/i);
    expect(safeErrorMessage(new Error('Senha curta demais'))).toBe('Senha curta demais');
  });

  it('detector reconhece os formatos do Postgres/GoTrue', () => {
    expect(looksLikeRawBackendError('new row violates row-level security policy')).toBe(true);
    expect(looksLikeRawBackendError('Email not confirmed')).toBe(true);
    expect(looksLikeRawBackendError('Essa @tag já está em uso.')).toBe(false);
    expect(looksLikeRawBackendError('')).toBe(false);
  });
});

describe('reportFailure ainda recebe a mensagem crua', () => {
  beforeEach(() => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('navigator', { userAgent: 'test' });
    vi.stubGlobal('location', { href: 'https://x/y' });
  });

  it('anexa "| causa: <crua>" ao que vai pro /api/log-error', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const { reportFailure } = await import('../../lib/utils/reportFailure');
    const raw = 'new row violates row-level security policy for table "posts"';
    reportFailure('publish-fail', new NetworkError(raw, { message: raw }));
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.msg).toContain(`| causa: ${raw}`);
  });
});

describe('callAIText (M1) — nada do provedor chega ao chamador', () => {
  it('sem chaves: erro genérico, sem nome de env', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const envMod = await import('../../lib/api/env');
    vi.spyOn(envMod, 'getRuntimeEnv').mockReturnValue(undefined as unknown as string);
    const { callAIText, AI_UNAVAILABLE_MESSAGE } = await import('../../lib/api/_ai');
    const r = await callAIText({ systemPrompt: 's', userMessage: 'u' });
    expect(r.text).toBe('');
    expect(r.error).toBe(AI_UNAVAILABLE_MESSAGE);
    expect(r.error).not.toMatch(/_KEY|OpenAI|Gemini/);
  });

  it('provedor devolve 401 com corpo: corpo só no log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const envMod = await import('../../lib/api/env');
    vi.spyOn(envMod, 'getRuntimeEnv').mockImplementation((k: string) =>
      k === 'OPENAI_API_KEY' ? 'sk-test' : (undefined as unknown as string),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"Incorrect API key sk-xxxx"}', { status: 401 })),
    );
    const { callAIText } = await import('../../lib/api/_ai');
    const r = await callAIText({ systemPrompt: 's', userMessage: 'u' });
    expect(r.error).not.toMatch(/401|Incorrect|sk-/);
    expect(JSON.stringify(warn.mock.calls)).toContain('401');
  });
});

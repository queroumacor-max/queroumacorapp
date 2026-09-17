// Testes de lib/services/moderateMedia.ts — gate de moderação compartilhado
// por publish (posts), avatar e biblioteca de artes (AR Grafite).
//
// Cobre em isolamento os 2 achados do Codex na revisão da PR #325 que
// motivaram extrair este helper:
//   1. 429 (rate limit/cota de moderação) tem que BLOQUEAR, não fail-open
//      — senão o próprio limite anti-abuso vira bypass.
//   2. É esta mesma função (não um hash mandado pelo cliente) que dá a
//      checagem autoritativa reusada por avatar/art-references.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@/lib/services/fetchGated', () => ({
  fetchGated: (...a: unknown[]) => fetchMock(...a),
}));

import { assertMediaApproved } from '../../lib/services/moderateMedia';
import { ValidationError } from '../../lib/errors';

function jsonRes(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('assertMediaApproved', () => {
  it('resolve sem lançar quando aprovado (flagged:false, approved:true)', async () => {
    fetchMock.mockResolvedValue(jsonRes({ flagged: false, approved: true }));
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).resolves.toBeUndefined();
  });

  it('lança ValidationError quando flagged:true', async () => {
    fetchMock.mockResolvedValue(jsonRes({ flagged: true, approved: false }));
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('lança ValidationError quando approved:false mesmo sem flagged explícito', async () => {
    fetchMock.mockResolvedValue(jsonRes({ approved: false }));
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('FAIL-CLOSED: 429 lança ValidationError (nunca fail-open)', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'rate limit' }, false, 429));
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('FAIL-OPEN: 503 (Gemini indisponível) resolve sem lançar', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'sem GEMINI_API_KEY' }, false, 503));
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).resolves.toBeUndefined();
  });

  it('FAIL-OPEN: erro de rede (fetch rejeita) resolve sem lançar', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).resolves.toBeUndefined();
  });

  it('FAIL-OPEN: resposta ok mas JSON que não parseia resolve sem lançar', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('bad json');
      },
    } as unknown as Response);
    await expect(assertMediaApproved({ mediaUrl: 'https://x/y.jpg' })).resolves.toBeUndefined();
  });

  it('manda mediaUrl e text (quando presente) no corpo do POST', async () => {
    fetchMock.mockResolvedValue(jsonRes({ flagged: false, approved: true }));
    await assertMediaApproved({ mediaUrl: 'https://x/avatar.jpg', text: 'legenda' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/moderate',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.mediaUrl).toBe('https://x/avatar.jpg');
    expect(body.text).toBe('legenda');
  });

  it('omite text quando não fornecido (avatar/art-reference não têm legenda)', async () => {
    fetchMock.mockResolvedValue(jsonRes({ flagged: false, approved: true }));
    await assertMediaApproved({ mediaUrl: 'https://x/avatar.jpg' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toBeUndefined();
  });
});

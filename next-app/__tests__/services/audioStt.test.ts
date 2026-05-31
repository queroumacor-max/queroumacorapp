// Tests do service lib/services/audioStt.ts.
// Pattern: spy em global fetch retornando Response com JSON. Não precisa de
// supabase fake porque o service só bate em /api/transcribe (HTTP).
//
// Cobertura (5 testes):
//   - blob ausente → ValidationError (não toca na rede);
//   - blob vazio → ValidationError;
//   - happy path: monta FormData com `audio` field e retorna text;
//   - HTTP 4xx/5xx com error body → NetworkError com a mensagem do backend;
//   - resposta sem text → NetworkError;
//   - fetch joga (rede caiu) → NetworkError com cause.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { transcribeAudio } from '../../lib/services/audioStt';
import { NetworkError, ValidationError } from '../../lib/errors';

// Helper: mocka fetch global. Vitest precisa `vi.spyOn` em vez de overwrite
// direto pra que restoreAllMocks limpe sem manter ref velha.
let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

// Importante: cada call do fetch precisa devolver Response NOVO porque
// Response.json() só pode ser consumido uma vez (alguns testes assertam
// 2x — `rejects.toBeInstanceOf` + `rejects.toMatchObject`).
function mockFetchJSON(body: unknown, status = 200): void {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<
    typeof vi.spyOn
  >;
  (
    fetchSpy as unknown as {
      mockImplementation: (fn: () => Promise<Response>) => void;
    }
  ).mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

function mockFetchError(error: Error): void {
  if (fetchSpy) fetchSpy.mockRestore();
  fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<
    typeof vi.spyOn
  >;
  (
    fetchSpy as unknown as { mockRejectedValue: (e: Error) => void }
  ).mockRejectedValue(error);
}

beforeEach(() => {
  fetchSpy = null;
});

afterEach(() => {
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
});

describe('transcribeAudio', () => {
  it('blob ausente → ValidationError (não toca na rede)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // cast pra null contornar o tipo estrito de assinatura.
    await expect(
      transcribeAudio(null as unknown as Blob),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('blob vazio (size=0) → ValidationError', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const emptyBlob = new Blob([], { type: 'audio/webm' });
    await expect(transcribeAudio(emptyBlob)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('happy path: posta multipart e retorna text', async () => {
    mockFetchJSON({ text: 'olá mundo' });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: 'audio/webm',
    });
    const out = await transcribeAudio(blob, { language: 'pt' });
    expect(out).toBe('olá mundo');

    // Verifica que o fetch foi chamado com /api/transcribe + FormData.
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/transcribe',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    );
    // Confirma que o FormData carrega o audio field.
    const call = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0];
    const init = call[1] as { body: FormData };
    expect(init.body.get('audio')).toBeInstanceOf(Blob);
    expect(init.body.get('language')).toBe('pt');
  });

  it('HTTP 503 com error body → NetworkError com a message do backend', async () => {
    mockFetchJSON({ error: 'Transcrição não configurada' }, 503);
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).rejects.toBeInstanceOf(NetworkError);
    await expect(transcribeAudio(blob)).rejects.toMatchObject({
      message: 'Transcrição não configurada',
    });
  });

  it('resposta 200 sem text → NetworkError', async () => {
    mockFetchJSON({});
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).rejects.toBeInstanceOf(NetworkError);
  });

  it('fetch rejeita (rede caiu) → NetworkError', async () => {
    mockFetchError(new Error('network down'));
    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).rejects.toBeInstanceOf(NetworkError);
    await expect(transcribeAudio(blob)).rejects.toMatchObject({
      message: 'Falha de rede ao transcrever áudio',
    });
  });
});

// publicacaoFila — publicar em segundo plano (04/11/2026). A tela fecha na
// hora; o envio, o progresso, a falha e o "tentar de novo" vivem aqui.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const executar = vi.fn();
vi.mock('@/lib/services/publicarPost', () => ({
  executarPublicacao: (...a: unknown[]) => executar(...a),
}));

import {
  iniciarPublicacao,
  tentarDeNovo,
  descartarPublicacao,
  estadoPublicacao,
  PRONTO_MS,
} from '@/lib/publicacaoFila';

const ctx = { userId: 'u1', emailVerified: true };
const input = (n = 2) => ({
  files: Array.from({ length: n }, (_, i) => new File(['x'], `f${i}.jpg`, { type: 'image/jpeg' })),
  caption: '',
  mediaType: 'story' as const,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  executar.mockReset();
  descartarPublicacao();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('publicação em segundo plano', () => {
  it('mostra o andamento e vira "pronto", depois volta ao normal', async () => {
    let soltar!: () => void;
    executar.mockImplementation(async (_i, c) => {
      c.aoProgredir({ enviados: 1, total: 2, aprovando: false });
      await new Promise<void>((r) => (soltar = r));
      return { id: 'p1' };
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    expect(iniciarPublicacao(input(), ctx)).toBe(true);
    expect(estadoPublicacao()).toMatchObject({ status: 'enviando', enviados: 1, total: 2 });
    soltar();
    await vi.waitFor(() => expect(estadoPublicacao().status).toBe('pronto'));
    vi.advanceTimersByTime(PRONTO_MS + 10);
    expect(estadoPublicacao().status).toBe('ocioso');
  });

  it('recusa uma segunda publicação com outra em andamento', async () => {
    let soltar!: () => void;
    executar.mockImplementation(() => new Promise<void>((r) => (soltar = r)));
    expect(iniciarPublicacao(input(), ctx)).toBe(true);
    expect(iniciarPublicacao(input(1), ctx)).toBe(false);
    expect(executar).toHaveBeenCalledTimes(1);
    soltar();
    await vi.waitFor(() => expect(estadoPublicacao().status).toBe('pronto'));
  });

  it('falhou: guarda o pedido e "tentar de novo" reenvia AS MESMAS fotos', async () => {
    executar.mockRejectedValueOnce(new Error('Falha de rede ao enviar a mídia (0.8 MB)'));
    const pedido = input(5);
    iniciarPublicacao(pedido, ctx);
    await tick();
    expect(estadoPublicacao()).toMatchObject({
      status: 'erro',
      mensagem: 'Falha de rede ao enviar a mídia (0.8 MB)',
    });
    executar.mockResolvedValueOnce({ id: 'p2' });
    expect(tentarDeNovo()).toBe(true);
    await tick();
    expect(executar).toHaveBeenCalledTimes(2);
    expect(executar.mock.calls[1][0]).toBe(pedido);
    expect(estadoPublicacao().status).toBe('pronto');
  });

  it('descartar a falha limpa o pedido guardado', async () => {
    executar.mockRejectedValueOnce(new Error('x'));
    iniciarPublicacao(input(), ctx);
    await tick();
    descartarPublicacao();
    expect(estadoPublicacao().status).toBe('ocioso');
    expect(tentarDeNovo()).toBe(false);
  });
});

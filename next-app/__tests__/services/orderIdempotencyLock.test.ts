import { describe, it, expect, afterEach } from 'vitest';
import { comTravaEntreAbas } from '../../lib/services/orderIdempotency';

// Trava falsa com a mesma semântica da Web Locks API: pedidos pelo mesmo nome
// rodam um de cada vez, na ordem de chegada.
function instalarLocksFalsos() {
  const filas = new Map<string, Promise<unknown>>();
  const locks = {
    request<T>(nome: string, cb: () => Promise<T>): Promise<T> {
      const anterior = filas.get(nome) ?? Promise.resolve();
      const atual = anterior.then(cb, cb);
      filas.set(nome, atual.catch(() => undefined));
      return atual;
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { locks },
    configurable: true,
    writable: true,
  });
}

const navOriginal = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (navOriginal) Object.defineProperty(globalThis, 'navigator', navOriginal);
  else delete (globalThis as { navigator?: unknown }).navigator;
});

describe('comTravaEntreAbas', () => {
  it('serializa duas execuções com o mesmo nome (a 2ª só começa após a 1ª)', async () => {
    instalarLocksFalsos();
    const eventos: string[] = [];
    const tarefa = (id: string) => async () => {
      eventos.push(`inicio-${id}`);
      await new Promise((r) => setTimeout(r, 10));
      eventos.push(`fim-${id}`);
      return id;
    };
    const [a, b] = await Promise.all([
      comTravaEntreAbas('order-submit:u1', tarefa('a')),
      comTravaEntreAbas('order-submit:u1', tarefa('b')),
    ]);
    expect([a, b]).toEqual(['a', 'b']);
    expect(eventos).toEqual(['inicio-a', 'fim-a', 'inicio-b', 'fim-b']);
  });

  it('sem Web Locks, roda direto', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
    await expect(comTravaEntreAbas('x', async () => 42)).resolves.toBe(42);
  });
});

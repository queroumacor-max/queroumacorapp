/** @vitest-environment jsdom */

// Trava de clique duplo: duas chamadas síncronas → a função roda UMA vez;
// depois de resolver (ou rejeitar) a trava solta e dá pra rodar de novo.

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createSingleFlight, useSingleFlight } from '../../lib/hooks/useSingleFlight';

function adiado<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSingleFlight', () => {
  it('duas chamadas síncronas → fn roda uma vez só', async () => {
    const f = createSingleFlight();
    const d = adiado<string>();
    const fn = vi.fn(() => d.promise);
    const p1 = f.run(fn);
    const p2 = f.run(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(f.isLocked()).toBe(true);
    await expect(p2).resolves.toBeUndefined();
    d.resolve('ok');
    await expect(p1).resolves.toBe('ok');
    expect(f.isLocked()).toBe(false);
  });

  it('depois de resolver, pode rodar de novo', async () => {
    const f = createSingleFlight();
    const fn = vi.fn(async () => 1);
    await f.run(fn);
    await f.run(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rejeição repassa o erro e solta a trava', async () => {
    const f = createSingleFlight();
    const boom = new Error('boom');
    await expect(f.run(() => Promise.reject(boom))).rejects.toBe(boom);
    expect(f.isLocked()).toBe(false);
    const fn = vi.fn(async () => 2);
    await expect(f.run(fn)).resolves.toBe(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('erro síncrono também solta a trava', async () => {
    const f = createSingleFlight();
    await expect(
      f.run(() => {
        throw new Error('sync');
      }),
    ).rejects.toThrow('sync');
    expect(f.isLocked()).toBe(false);
  });
});

describe('useSingleFlight', () => {
  it('trava pela ref (sem esperar render) e expõe busy', async () => {
    const { result } = renderHook(() => useSingleFlight());
    const d = adiado();
    const fn = vi.fn(() => d.promise);
    let p1: Promise<unknown> | undefined;
    act(() => {
      p1 = result.current.run(fn);
      void result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      d.resolve();
      await p1;
    });
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('run é estável entre renders', () => {
    const { result, rerender } = renderHook(() => useSingleFlight());
    const r1 = result.current.run;
    rerender();
    expect(result.current.run).toBe(r1);
  });
});

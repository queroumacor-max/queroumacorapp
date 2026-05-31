// Tests do hook useAutosave (UX#6 — autosave de forms em localStorage).
//
// Cobre as garantias críticas:
//   1) restore — onMount, se houver draft válido, dispara onRestore.
//   2) save throttle — write só acontece após `intervalMs` (default 5s).
//   3) clear() — apaga o draft do localStorage e zera lastSavedAt.
//   4) TTL — draft com savedAt > ttlMs é descartado e removido.
//   5) quota — payload > 50KB é silenciosamente descartado (não escreve).
//
// Por que jsdom? O hook em si é puro do lado React, mas precisa de
// `localStorage` (que `environment: 'node'` no vitest.config.ts não expõe).
// O bloco abaixo polyfilla localStorage globalmente, mantendo compat com
// o restante dos testes em modo node.

/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  useAutosave,
  readDraft,
  writeDraft,
  clearDraft,
} from '../../lib/hooks/useAutosave';

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  localStorage.clear();
});

describe('useAutosave — restore', () => {
  it('chama onRestore com o draft persistido no mount', () => {
    // Pré-popula um draft válido (envelope v=1, dentro do TTL).
    writeDraft('profile_edit', { name: 'João', city: 'SP' });

    const onRestore = vi.fn();
    renderHook(() =>
      useAutosave({
        key: 'profile_edit',
        values: { name: '', city: '' },
        onRestore,
      })
    );

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith({ name: 'João', city: 'SP' });
  });

  it('não chama onRestore quando não há draft', () => {
    const onRestore = vi.fn();
    renderHook(() =>
      useAutosave({
        key: 'nada',
        values: { foo: 'bar' },
        onRestore,
      })
    );
    expect(onRestore).not.toHaveBeenCalled();
  });
});

describe('useAutosave — save throttle', () => {
  it('persiste mudanças após o intervalo e ignora writes muito próximos', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const { rerender } = renderHook(
      ({ values }: { values: { caption: string } }) =>
        useAutosave({
          key: 'post_composer',
          values,
          intervalMs: 5000,
        }),
      { initialProps: { values: { caption: 'a' } } }
    );

    // Primeiro tick após mount já passa do throttle (lastSavedRef=0).
    expect(readDraft<{ caption: string }>('post_composer')).toEqual({
      caption: 'a',
    });

    // Update imediato (1s depois) NÃO escreve — throttle (5s).
    vi.setSystemTime(now + 1_000);
    act(() => {
      rerender({ values: { caption: 'ab' } });
    });
    expect(readDraft<{ caption: string }>('post_composer')).toEqual({
      caption: 'a',
    });

    // Após 5s+ a próxima mudança é escrita.
    vi.setSystemTime(now + 6_000);
    act(() => {
      rerender({ values: { caption: 'abc' } });
    });
    expect(readDraft<{ caption: string }>('post_composer')).toEqual({
      caption: 'abc',
    });
  });
});

describe('useAutosave — clear()', () => {
  it('apaga o draft persistido e impede restauro futuro', () => {
    writeDraft('profile_edit', { name: 'antigo' });

    const { result } = renderHook(() =>
      useAutosave({
        key: 'profile_edit',
        values: { name: 'novo' },
      })
    );

    act(() => result.current.clear());

    expect(localStorage.getItem('autosave_profile_edit')).toBeNull();
    expect(readDraft('profile_edit')).toBeNull();
  });
});

describe('useAutosave — TTL', () => {
  it('descarta draft expirado (savedAt > 7d) no restore', () => {
    // Escreve manualmente um envelope com savedAt antigo (>7d).
    const stale = {
      v: 1 as const,
      savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      values: { name: 'expirado' },
    };
    localStorage.setItem('autosave_old', JSON.stringify(stale));

    const restored = readDraft('old');
    expect(restored).toBeNull();
    // Reading o expirado limpa o slot — sweep silencioso.
    expect(localStorage.getItem('autosave_old')).toBeNull();
  });
});

describe('useAutosave — quota', () => {
  it('retorna false e não escreve quando payload > 50KB', () => {
    const huge = { blob: 'x'.repeat(60 * 1024) }; // >50KB
    const ok = writeDraft('big', huge);
    expect(ok).toBe(false);
    expect(localStorage.getItem('autosave_big')).toBeNull();
  });

  it('escreve payloads pequenos normalmente', () => {
    const small = { caption: 'oi', forSale: false };
    expect(writeDraft('small', small)).toBe(true);
    expect(readDraft('small')).toEqual(small);
    clearDraft('small');
    expect(localStorage.getItem('autosave_small')).toBeNull();
  });
});

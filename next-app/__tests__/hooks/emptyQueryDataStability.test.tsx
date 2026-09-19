// @vitest-environment jsdom
//
// Regressão do "Algo deu errado" ao abrir /loja (item do produto) e /search
// (sugestões de quem seguir), 2026-09-19.
//
// Causa: `useProductVariants`/`useFollowing` devolviam `query.data ?? []` —
// uma referência de array NOVA em todo render enquanto `query.data` é
// undefined (loading, ou query desabilitada). `ProductDetailSheet` e
// `SearchResults` comparam esse array por IDENTIDADE
// (`variants !== variantsVisto` / `followingIds !== followingIdsVisto`)
// pra ajustar state DURANTE o render (idiom oficial do React, introduzido
// no PR #337 de lint react-hooks/*) — com uma referência nova a cada
// render, a comparação nunca estabiliza, o setState dispara em todo
// render, e o React derruba com "Too many re-renders", capturado pelo
// error boundary mais próximo ("Algo deu errado").
//
// Fix: as duas hooks agora caem numa constante `EMPTY_*` de módulo em vez
// de um array literal novo — este teste trava que a referência devolvida
// fica ESTÁVEL entre renders enquanto não há dado.

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockAuth = { user: { id: 'user-1' } as { id: string } | null };
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => mockAuth }));

// queryFn que nunca resolve — mantém `query.data === undefined` por toda a
// vida do teste, exatamente a janela em que o bug se manifestava.
vi.mock('@/lib/db', () => ({
  DB: { follows: { listFollowingIds: () => new Promise<string[]>(() => {}) } },
}));
vi.mock('@/lib/services/mkt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/mkt')>();
  return { ...actual, fetchProductVariants: () => new Promise<never>(() => {}) };
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('estabilidade referencial do fallback vazio (regressão loop infinito)', () => {
  it('useProductVariants().variants mantém a MESMA referência entre renders enquanto carrega', async () => {
    const { useProductVariants } = await import('@/lib/hooks/useProductVariants');
    const { result, rerender } = renderHook(() => useProductVariants('prod-1'), { wrapper });

    const first = result.current.variants;
    expect(first).toEqual([]);
    rerender();
    rerender();
    expect(result.current.variants).toBe(first);
  });

  it('useFollowing().ids mantém a MESMA referência entre renders enquanto carrega', async () => {
    const { useFollowing } = await import('@/lib/hooks/useFollowing');
    const { result, rerender } = renderHook(() => useFollowing(), { wrapper });

    const first = result.current.ids;
    expect(first).toEqual([]);
    rerender();
    rerender();
    expect(result.current.ids).toBe(first);
  });
});

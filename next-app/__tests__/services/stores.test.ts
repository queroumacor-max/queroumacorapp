// Testes do service lib/services/stores.ts — catálogo de lojas do
// StoreSelector. Cobre o caminho feliz e os dois casos que caem no
// FALLBACK_STORES: tabela ainda não migrada (42P01) e tabela vazia.

import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';
import { fetchStores, FALLBACK_STORES } from '../../lib/services/stores';
import { NetworkError } from '../../lib/errors';

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    then: (resolve: (v: typeof result) => void) => resolve(result),
  };
  return chain as unknown as Parameters<typeof __setSupabaseForTests>[0];
}

describe('fetchStores', () => {
  afterEach(() => {
    __resetSupabaseForTests();
  });

  it('mapeia as linhas ativas ordenadas', async () => {
    __setSupabaseForTests(
      fakeSupabase({
        data: [
          { id: 'calicolors', name: 'Cali Colors', subtitle: 'Tintas', emoji: '🎨', active: true, sort_order: 0 },
        ],
        error: null,
      }),
    );
    const stores = await fetchStores();
    expect(stores).toEqual([
      { id: 'calicolors', name: 'Cali Colors', subtitle: 'Tintas', emoji: '🎨', active: true, sort_order: 0 },
    ]);
  });

  it('cai no fallback quando a tabela ainda não existe (42P01)', async () => {
    __setSupabaseForTests(
      fakeSupabase({ data: null, error: { message: 'relation "stores" does not exist', code: '42P01' } }),
    );
    expect(await fetchStores()).toEqual(FALLBACK_STORES);
  });

  it('cai no fallback quando a tabela existe mas está vazia', async () => {
    __setSupabaseForTests(fakeSupabase({ data: [], error: null }));
    expect(await fetchStores()).toEqual(FALLBACK_STORES);
  });

  it('propaga erro de rede genuíno (não é 42P01)', async () => {
    __setSupabaseForTests(
      fakeSupabase({ data: null, error: { message: 'timeout', code: '57014' } }),
    );
    await expect(fetchStores()).rejects.toBeInstanceOf(NetworkError);
  });

  it('emoji ausente cai no ícone genérico de loja', async () => {
    __setSupabaseForTests(
      fakeSupabase({
        data: [{ id: 'outra', name: 'Outra Loja', subtitle: null, emoji: null, active: true, sort_order: 1 }],
        error: null,
      }),
    );
    const [store] = await fetchStores();
    expect(store!.emoji).toBe('🏪');
  });
});

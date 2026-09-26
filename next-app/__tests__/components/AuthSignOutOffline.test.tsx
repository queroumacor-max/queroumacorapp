// @vitest-environment jsdom
//
// Auditoria 2026-09-26: no supabase-js v2, signOut() sem rede devolve
// { error } e NÃO apaga a sessão local. "Sair" offline em aparelho
// compartilhado deixava a próxima pessoa na conta de quem saiu. O logout
// agora cai pro scope:'local' e varre os dois armazéns sempre.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const signOutSb = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: (...a: unknown[]) => signOutSb(...a),
    },
  }),
}));
vi.mock('@/lib/services/pushTokens', () => ({ clearDeviceTokenOnLogout: async () => {} }));
vi.mock('@/lib/utils/reportFailure', () => ({
  FAILURE_TYPE_LABELS: {},
  reportFailure: () => {},
}));

import { AuthProvider, useAuth } from '@/components/AuthProvider';
import { hybridAuthStorage, readSessionCookie } from '@/lib/sessionStorageHybrid';

const KEY = 'sb-uwq-auth-token';

function Botao() {
  const { signOut } = useAuth();
  return <button onClick={() => void signOut()}>sair</button>;
}

async function sair() {
  render(
    <AuthProvider>
      <Botao />
    </AuthProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByText('sair'));
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  cleanup();
  signOutSb.mockReset();
  window.localStorage.clear();
  for (const part of document.cookie.split('; ')) {
    const n = part.split('=')[0];
    if (n) document.cookie = `${n}=; path=/; max-age=0`;
  }
  vi.unstubAllGlobals();
});

describe('signOut offline', () => {
  it('signOut devolve erro de rede → cai pro scope local e apaga os dois armazéns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    hybridAuthStorage.setItem(KEY, JSON.stringify({ access_token: 'x'.repeat(5000) }));
    signOutSb.mockImplementation(async (opts?: { scope?: string }) =>
      opts?.scope === 'local' ? { error: null } : { error: { message: 'Failed to fetch' } },
    );

    await sair();

    expect(signOutSb).toHaveBeenCalledTimes(2);
    expect(signOutSb.mock.calls[1]?.[0]).toEqual({ scope: 'local' });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readSessionCookie(KEY)).toBeNull();
  });

  it('signOut que LANÇA também não deixa sessão pra trás', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    hybridAuthStorage.setItem(KEY, '{"a":1}');
    signOutSb.mockImplementation(async (opts?: { scope?: string }) => {
      if (opts?.scope === 'local') throw new Error('boom');
      throw new Error('rede');
    });

    await sair();

    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(readSessionCookie(KEY)).toBeNull();
  });

  it('sucesso online: uma chamada só, e a varredura roda mesmo assim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    hybridAuthStorage.setItem(KEY, '{"a":1}');
    signOutSb.mockResolvedValue({ error: null });

    await sair();

    expect(signOutSb).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

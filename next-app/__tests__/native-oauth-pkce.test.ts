// native-oauth-pkce.test.ts — o login social da casca usa PKCE, e o deep
// link NÃO consegue injetar sessão (auditoria de autenticação 2026-09-11).
//
// Antes: fluxo implicit — `access_token` + `refresh_token` no fragment do
// deep link `br.com.queroumacor.app://…`. Custom scheme não tem verificação
// de domínio; no Android qualquer app registra o mesmo scheme e recebe o
// callback com a sessão inteira. E um link forjado com o token do ATACANTE
// logava a vítima na conta dele. Estes testes falham se qualquer uma das
// duas portas reabrir.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn();
const exchangeMock = vi.fn();
const pkceSignInMock = vi.fn();
const mainSetSessionMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock('@/lib/supabase', () => ({
  resolveBrowserSupabaseEnv: () => ({ url: 'https://test.supabase.co', key: 'anon' }),
  getSupabase: () => ({ auth: { setSession: mainSetSessionMock } }),
}));

import {
  nativeSignInWithOAuth,
  NATIVE_OAUTH_REDIRECT,
  __resetNativeOAuthForTests,
} from '../lib/native/auth';

type Listener = (ev: { url: string }) => void;
let listener: Listener | null = null;
const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';

function armarCasca() {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: {
      Browser: { open: async () => {}, close: async () => {} },
      App: {
        addListener: (_ev: string, cb: Listener) => {
          listener = cb;
          return { remove() {} };
        },
      },
    },
  };
}

beforeEach(() => {
  __resetNativeOAuthForTests();
  listener = null;
  createClientMock.mockReset();
  exchangeMock.mockReset();
  pkceSignInMock.mockReset();
  mainSetSessionMock.mockReset();
  createClientMock.mockImplementation(() => ({
    auth: { signInWithOAuth: pkceSignInMock, exchangeCodeForSession: exchangeMock },
  }));
  pkceSignInMock.mockResolvedValue({
    data: { url: 'https://test.supabase.co/auth/v1/authorize?provider=google&code_challenge=x' },
    error: null,
  });
  exchangeMock.mockResolvedValue({
    data: { session: { access_token: 'AT', refresh_token: 'RT' } },
    error: null,
  });
  mainSetSessionMock.mockResolvedValue({ error: null });
  armarCasca();
});

afterEach(() => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
});

describe('nativeSignInWithOAuth — PKCE', () => {
  it('cria o cliente do handshake com flowType pkce, sem persistir sessão', async () => {
    const p = nativeSignInWithOAuth('google');
    await Promise.resolve();
    expect(createClientMock).toHaveBeenCalledTimes(1);
    const opts = createClientMock.mock.calls[0][2] as { auth: Record<string, unknown> };
    expect(opts.auth.flowType).toBe('pkce');
    expect(opts.auth.persistSession).toBe(false);
    expect(opts.auth.detectSessionInUrl).toBe(false);
    expect(pkceSignInMock).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true },
    });
    // encerra o fluxo pra não deixar promessa pendurada
    await vi.waitFor(() => expect(listener).not.toBeNull());
    listener!({ url: `${NATIVE_OAUTH_REDIRECT}?code=${CODE}` });
    await p;
  });

  it('callback com code → troca pela sessão e grava no cliente principal', async () => {
    const p = nativeSignInWithOAuth('apple');
    await vi.waitFor(() => expect(listener).not.toBeNull());
    listener!({ url: `${NATIVE_OAUTH_REDIRECT}?code=${CODE}` });
    await expect(p).resolves.toEqual({});
    expect(exchangeMock).toHaveBeenCalledWith(CODE);
    expect(mainSetSessionMock).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' });
  });

  it('deep link com access_token/refresh_token NÃO grava sessão (login CSRF barrado)', async () => {
    const p = nativeSignInWithOAuth('google');
    await vi.waitFor(() => expect(listener).not.toBeNull());
    listener!({ url: `${NATIVE_OAUTH_REDIRECT}#access_token=DO_ATACANTE&refresh_token=RT` });
    // Ignorado: o fluxo segue esperando o callback de verdade.
    await new Promise((r) => setTimeout(r, 20));
    expect(mainSetSessionMock).not.toHaveBeenCalled();
    expect(exchangeMock).not.toHaveBeenCalled();
    listener!({ url: `${NATIVE_OAUTH_REDIRECT}?error=access_denied&error_description=cancelado` });
    await expect(p).resolves.toEqual({ error: 'cancelado' });
    expect(mainSetSessionMock).not.toHaveBeenCalled();
  });

  it('code forjado/interceptado sem o verifier → GoTrue recusa → erro, sem sessão', async () => {
    exchangeMock.mockResolvedValue({ data: { session: null }, error: { message: 'invalid grant' } });
    const p = nativeSignInWithOAuth('google');
    await vi.waitFor(() => expect(listener).not.toBeNull());
    listener!({ url: `${NATIVE_OAUTH_REDIRECT}?code=${CODE}` });
    await expect(p).resolves.toEqual({ error: 'invalid grant' });
    expect(mainSetSessionMock).not.toHaveBeenCalled();
  });
});

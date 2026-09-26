// @vitest-environment jsdom
// Auditoria 2026-09-26: max-age do cookie de sessão caiu de 400 pra 30 dias,
// e clearAllStoredSessions apaga a sessão nos DOIS armazéns (usado no logout
// quando o signOut do supabase-js falha sem rede e deixa a sessão local).
import { afterEach, describe, expect, it } from 'vitest';
import {
  COOKIE_MAX_AGE,
  clearAllStoredSessions,
  hasStoredSession,
  hybridAuthStorage,
  readSessionCookie,
  writeSessionCookie,
} from '../lib/sessionStorageHybrid';

function wipeAllCookies() {
  for (const part of document.cookie.split('; ')) {
    const name = part.split('=')[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

afterEach(() => {
  window.localStorage.clear();
  wipeAllCookies();
});

describe('COOKIE_MAX_AGE', () => {
  it('é 30 dias (não mais 400)', () => {
    expect(COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });
});

describe('clearAllStoredSessions', () => {
  it('apaga localStorage E todas as fatias de cookie, sem tocar em outras chaves', () => {
    const key = 'sb-abc-auth-token';
    const big = JSON.stringify({ access_token: 'x'.repeat(7000), user: { id: 'u' } });
    hybridAuthStorage.setItem(key, big);
    window.localStorage.setItem('sb-abc-auth-token-code-verifier', 'v');
    window.localStorage.setItem('theme', 'dark');
    expect(document.cookie).toContain(`${key}.2=`);

    clearAllStoredSessions();

    expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem('sb-abc-auth-token-code-verifier')).toBeNull();
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(readSessionCookie(key)).toBeNull();
    expect(document.cookie).not.toMatch(/sb-abc-auth-token\.\d=/);
    expect(hasStoredSession()).toBe(false);
  });

  it('acha a sessão só pelo cookie (localStorage já apagado pelo wrapper)', () => {
    const key = 'sb-xyz-auth-token';
    writeSessionCookie(key, '{"a":1}');
    expect(hasStoredSession()).toBe(true);
    clearAllStoredSessions();
    expect(readSessionCookie(key)).toBeNull();
    expect(hasStoredSession()).toBe(false);
  });
});

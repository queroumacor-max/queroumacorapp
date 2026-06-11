// Tests do service lib/services/pushSubscriptions.ts (Release C8).
// Mockamos navigator.serviceWorker + PushManager + Notification + atob/btoa
// pra simular o ambiente browser. Supabase client é injetado via
// __setSupabaseForTests com fake chainable.
//
// Cobertura:
//   - getPushPermissionState: SSR-safe ('unsupported' sem window/Notification)
//   - urlBase64ToUint8Array: round-trip básico
//   - isPushSubscribed: true quando registration tem subscription, false quando não
//   - subscribeToPush: pede permission, chama subscribe, upserta na tabela
//   - subscribeToPush: VAPID ausente → throw com mensagem direcionada
//   - unsubscribeFromPush: chama subscription.unsubscribe() e delete na tabela

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetSupabaseForTests,
  __setSupabaseForTests,
} from '../../lib/supabase';

// ─── Mocks globais (browser APIs) ──────────────────────────────────────────

interface MockSubscription {
  endpoint: string;
  getKey: (name: string) => ArrayBuffer | null;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface MockPushManager {
  subscribe: ReturnType<typeof vi.fn>;
  getSubscription: ReturnType<typeof vi.fn>;
}

interface MockRegistration {
  pushManager: MockPushManager;
}

// Helper pra construir mock subscription com keys válidas (32 bytes each).
function makeMockSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc'): MockSubscription {
  const p256dhBytes = new Uint8Array(65);
  for (let i = 0; i < 65; i++) p256dhBytes[i] = i;
  const authBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) authBytes[i] = i + 100;
  return {
    endpoint,
    getKey: (name: string) => {
      if (name === 'p256dh') return p256dhBytes.buffer;
      if (name === 'auth') return authBytes.buffer;
      return null;
    },
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

function installBrowserMocks(opts: {
  permission?: NotificationPermission;
  existingSubscription?: MockSubscription | null;
  hasPushManager?: boolean;
  hasServiceWorker?: boolean;
  hasNotification?: boolean;
}): {
  pushManager: MockPushManager;
  registration: MockRegistration;
  requestPermission: ReturnType<typeof vi.fn>;
} {
  const requestPermission = vi.fn().mockResolvedValue(opts.permission ?? 'granted');
  if (opts.hasNotification !== false) {
    (globalThis as unknown as { Notification: unknown }).Notification = {
      permission: opts.permission ?? 'default',
      requestPermission,
    };
  } else {
    // SSR/IE-style: sem Notification.
    delete (globalThis as unknown as { Notification?: unknown }).Notification;
  }

  const pushManager: MockPushManager = {
    subscribe: vi.fn().mockResolvedValue(makeMockSubscription()),
    getSubscription: vi.fn().mockResolvedValue(opts.existingSubscription ?? null),
  };
  const registration: MockRegistration = { pushManager };

  // Setup navigator.serviceWorker se hasServiceWorker !== false.
  if (opts.hasServiceWorker !== false) {
    const swMock = {
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        serviceWorker: swMock,
        userAgent: 'vitest/0.0',
      },
    });
  } else {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: { userAgent: 'vitest/0.0' },
    });
  }

  // window: precisa ter PushManager pra contar como suportado.
  const win: Record<string, unknown> = { ...(globalThis as unknown as Record<string, unknown>) };
  if (opts.hasPushManager !== false) {
    win.PushManager = function PushManager() { /* noop */ };
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: win,
  });

  return { pushManager, registration, requestPermission };
}

function uninstallBrowserMocks() {
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
  delete (globalThis as unknown as { window?: unknown }).window;
  // navigator está set via defineProperty; recriar como undefined.
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  } catch {
    // ignora
  }
}

// ─── Fake Supabase chainable (espelha o pattern de notes.test.ts) ──────────

interface FakeOpts {
  upsertError?: unknown;
  deleteError?: unknown;
}

interface SupabaseSpies {
  from: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
}

function makeFakeSupabase(opts: FakeOpts = {}): { client: unknown; spies: SupabaseSpies } {
  const spies: SupabaseSpies = {
    from: vi.fn(),
    upsert: vi.fn(),
    deleteFn: vi.fn(),
    eq: vi.fn(),
  };

  const chainAfterDelete = {
    eq: (col: string, val: unknown) => {
      spies.eq(col, val);
      return {
        eq: (col2: string, val2: unknown) => {
          spies.eq(col2, val2);
          return Promise.resolve({ error: opts.deleteError ?? null });
        },
      };
    },
  };

  const chain = {
    from: (t: string) => {
      spies.from(t);
      return chain;
    },
    upsert: (row: unknown, conflictOpts: { onConflict: string }) => {
      spies.upsert(row, conflictOpts);
      return Promise.resolve({ error: opts.upsertError ?? null });
    },
    delete: () => {
      spies.deleteFn();
      return chainAfterDelete;
    },
  };

  return { client: chain, spies };
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

beforeEach(() => {
  __resetSupabaseForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
});

afterEach(() => {
  uninstallBrowserMocks();
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe('getPushPermissionState', () => {
  it('SSR (sem window) retorna unsupported', async () => {
    // Garante que window não está no globalThis.
    uninstallBrowserMocks();
    const { getPushPermissionState } = await import('../../lib/services/pushSubscriptions');
    expect(getPushPermissionState()).toBe('unsupported');
  });

  it('browser sem PushManager retorna unsupported', async () => {
    installBrowserMocks({ hasPushManager: false });
    vi.resetModules();
    const { getPushPermissionState } = await import('../../lib/services/pushSubscriptions');
    expect(getPushPermissionState()).toBe('unsupported');
  });

  it('browser suportado + permission granted retorna granted', async () => {
    installBrowserMocks({ permission: 'granted' });
    vi.resetModules();
    const { getPushPermissionState } = await import('../../lib/services/pushSubscriptions');
    expect(getPushPermissionState()).toBe('granted');
  });

  it('browser suportado + permission default retorna default', async () => {
    installBrowserMocks({ permission: 'default' });
    vi.resetModules();
    const { getPushPermissionState } = await import('../../lib/services/pushSubscriptions');
    expect(getPushPermissionState()).toBe('default');
  });
});

describe('urlBase64ToUint8Array', () => {
  it('converte base64url típico de VAPID public key em bytes', async () => {
    const { urlBase64ToUint8Array } = await import('../../lib/services/pushSubscriptions');
    // 'AAAA' base64 = [0,0,0]; sem padding, com - _ trocados.
    const out = urlBase64ToUint8Array('AAAA');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(3);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});

describe('isPushSubscribed', () => {
  it('retorna false em SSR', async () => {
    uninstallBrowserMocks();
    vi.resetModules();
    const { isPushSubscribed } = await import('../../lib/services/pushSubscriptions');
    const out = await isPushSubscribed();
    expect(out).toBe(false);
  });

  it('retorna true quando registration tem subscription', async () => {
    installBrowserMocks({ existingSubscription: makeMockSubscription() });
    vi.resetModules();
    const { isPushSubscribed } = await import('../../lib/services/pushSubscriptions');
    const out = await isPushSubscribed();
    expect(out).toBe(true);
  });

  it('retorna false quando registration existe mas sem subscription', async () => {
    installBrowserMocks({ existingSubscription: null });
    vi.resetModules();
    const { isPushSubscribed } = await import('../../lib/services/pushSubscriptions');
    const out = await isPushSubscribed();
    expect(out).toBe(false);
  });
});

describe('subscribeToPush', () => {
  it('joga erro quando VAPID ausente', async () => {
    installBrowserMocks({ permission: 'granted' });
    vi.resetModules();
    const { subscribeToPush } = await import('../../lib/services/pushSubscriptions');
    await expect(subscribeToPush('user-1')).rejects.toThrow(/VAPID_PUBLIC_KEY/);
  });

  it('joga erro quando permission negada', async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'AAAA';
    installBrowserMocks({ permission: 'denied' });
    vi.resetModules();
    const { subscribeToPush } = await import('../../lib/services/pushSubscriptions');
    await expect(subscribeToPush('user-1')).rejects.toThrow(/negada/);
  });

  it('happy path: subscribe + upsert na tabela', async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'AAAA';
    installBrowserMocks({ permission: 'granted' });
    vi.resetModules();
    // Mock após resetModules pra que `__setSupabaseForTests` afete o módulo
    // que o `await import()` vai carregar (o singleton vive no módulo
    // re-importado).
    const sbMod = await import('../../lib/supabase');
    const { client, spies } = makeFakeSupabase();
    sbMod.__setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const { subscribeToPush } = await import('../../lib/services/pushSubscriptions');
    await subscribeToPush('user-1');

    expect(spies.from).toHaveBeenCalledWith('push_subscriptions');
    expect(spies.upsert).toHaveBeenCalled();
    const [row, conflictOpts] = spies.upsert.mock.calls[0] as [
      Record<string, unknown>,
      { onConflict: string },
    ];
    expect(row.user_id).toBe('user-1');
    expect(typeof row.endpoint).toBe('string');
    expect(typeof row.p256dh).toBe('string');
    expect(typeof row.auth).toBe('string');
    expect(conflictOpts.onConflict).toBe('endpoint');
  });
});

describe('unsubscribeFromPush', () => {
  it('chama unsubscribe local + delete na tabela', async () => {
    const sub = makeMockSubscription();
    installBrowserMocks({ existingSubscription: sub });
    vi.resetModules();
    const sbMod = await import('../../lib/supabase');
    const { client, spies } = makeFakeSupabase();
    sbMod.__setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const { unsubscribeFromPush } = await import('../../lib/services/pushSubscriptions');
    await unsubscribeFromPush('user-1');

    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(spies.from).toHaveBeenCalledWith('push_subscriptions');
    expect(spies.deleteFn).toHaveBeenCalled();
    expect(spies.eq).toHaveBeenCalledWith('endpoint', sub.endpoint);
    expect(spies.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('sem subscription ativa → no-op silencioso', async () => {
    installBrowserMocks({ existingSubscription: null });
    vi.resetModules();
    const sbMod = await import('../../lib/supabase');
    const { client, spies } = makeFakeSupabase();
    sbMod.__setSupabaseForTests(client as Parameters<typeof __setSupabaseForTests>[0]);
    const { unsubscribeFromPush } = await import('../../lib/services/pushSubscriptions');
    await unsubscribeFromPush('user-1');

    expect(spies.from).not.toHaveBeenCalled();
  });
});

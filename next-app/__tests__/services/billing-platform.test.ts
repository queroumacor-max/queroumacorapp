// Tests do lib/services/billing-platform.ts. Pattern: stubGlobal pra
// window/navigator/PaymentRequest (vitest node env não tem nada disso por
// padrão). Mock @/lib/toast pra capturar feedback sem renderizar.
//
// Cobertura (10 testes):
//   detectBillingPlatform:
//     1. SSR (sem window) → 'unknown'
//     2. browser sem Capacitor/TWA → 'web'
//     3. Capacitor iOS → 'ios-wrapper'
//     4. Capacitor Android → 'android-wrapper'
//     5. TWA Android (Digital Goods API) → 'android-wrapper'
//     6. UA "wv) Android" sem Digital Goods → 'android-wrapper'
//   billingProvider:
//     7. web → 'mercado-pago'
//     8. iOS wrapper → 'apple-iap'
//     9. TWA Android → 'google-play-billing'
//     10. SSR/unknown → 'mercado-pago' (default web)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock toast antes do import do módulo testado pra capturar showToast calls.
vi.mock('@/lib/toast', () => ({
  showToast: vi.fn(),
}));

import {
  detectBillingPlatform,
  billingProvider,
} from '../../lib/services/billing-platform';

// ─── helpers de stub do window/navigator ───────────────────────────────────

interface FakeWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
    Plugins?: Record<string, unknown>;
  };
  getDigitalGoodsService?: (paymentMethod: string) => Promise<unknown>;
}

interface FakeNavigator {
  userAgent?: string;
}

function setupBrowser(opts: {
  window?: FakeWindow;
  navigator?: FakeNavigator;
} = {}): void {
  // stubGlobal substitui o global durante o teste e restaura via
  // vi.unstubAllGlobals() no afterEach. Ideal pra simular browser sem
  // mexer no environment global do node.
  if (opts.window !== undefined) {
    vi.stubGlobal('window', opts.window);
  }
  if (opts.navigator !== undefined) {
    vi.stubGlobal('navigator', opts.navigator);
  }
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── detectBillingPlatform ─────────────────────────────────────────────────

describe('detectBillingPlatform', () => {
  it('SSR (sem window) → "unknown"', () => {
    // node env não tem `window` por padrão — não precisamos stub.
    expect(detectBillingPlatform()).toBe('unknown');
  });

  it('browser sem Capacitor / TWA → "web"', () => {
    setupBrowser({
      window: {},
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel) Safari/605' },
    });
    expect(detectBillingPlatform()).toBe('web');
  });

  it('Capacitor iOS → "ios-wrapper"', () => {
    setupBrowser({
      window: {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios',
          Plugins: {},
        },
      },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit Mobile' },
    });
    expect(detectBillingPlatform()).toBe('ios-wrapper');
  });

  it('Capacitor Android → "android-wrapper"', () => {
    setupBrowser({
      window: {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'android',
          Plugins: {},
        },
      },
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14)' },
    });
    expect(detectBillingPlatform()).toBe('android-wrapper');
  });

  it('TWA Android com Digital Goods API → "android-wrapper"', () => {
    setupBrowser({
      window: {
        getDigitalGoodsService: async () => ({}),
      },
      navigator: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0',
      },
    });
    expect(detectBillingPlatform()).toBe('android-wrapper');
  });

  it('UA "wv) Android" sem Digital Goods → fallback "android-wrapper"', () => {
    // Legacy webview embarcado em TWA: sem Digital Goods API mas com UA wv.
    setupBrowser({
      window: {},
      navigator: {
        userAgent:
          'Mozilla/5.0 (Linux; Android 12; wv) AppleWebKit/537.36 Chrome/110.0',
      },
    });
    expect(detectBillingPlatform()).toBe('android-wrapper');
  });
});

// ─── billingProvider ───────────────────────────────────────────────────────

describe('billingProvider', () => {
  it('web → "mercado-pago"', () => {
    setupBrowser({
      window: {},
      navigator: { userAgent: 'Mozilla/5.0 (Macintosh) Safari/605' },
    });
    expect(billingProvider()).toBe('mercado-pago');
  });

  it('iOS wrapper → "apple-iap"', () => {
    setupBrowser({
      window: {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => 'ios',
          Plugins: {},
        },
      },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone) Mobile' },
    });
    expect(billingProvider()).toBe('apple-iap');
  });

  it('TWA Android → "google-play-billing"', () => {
    setupBrowser({
      window: {
        getDigitalGoodsService: async () => ({}),
      },
      navigator: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0',
      },
    });
    expect(billingProvider()).toBe('google-play-billing');
  });

  it('SSR / unknown → "mercado-pago" (default web)', () => {
    // Sem window — node env padrão.
    expect(billingProvider()).toBe('mercado-pago');
  });
});

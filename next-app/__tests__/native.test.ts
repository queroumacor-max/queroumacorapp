// native.test.ts — trava o contrato da fronteira lib/native:
//   1. Fora da casca (sem window.Capacitor) TUDO reporta indisponível e os
//      helpers devolvem o valor de fallback — nunca throw. É a garantia de
//      que browser puro/PWA/casca velha continuam funcionando.
//   2. parseAuthCallbackUrl (pura) extrai tokens/erro do deep link do OAuth
//      — o coração do fluxo A; regressão aqui = login social quebrado no app.
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import {
  isNativePlatform,
  getNativePlatform,
  isNativeOAuthAvailable,
  isNativeCameraAvailable,
  isNativePushAvailable,
  parseAuthCallbackUrl,
  takePhotoNative,
  registerNativePush,
  routeFromNotificationData,
  shareNative,
  NATIVE_OAUTH_REDIRECT,
  hapticImpact,
  hapticNotify,
  hapticSelection,
  applyStatusBar,
  hideSplash,
  initKeyboard,
  onAppResume,
  isNativePickerAvailable,
  pickImagesNative,
  isNativeFilesystemAvailable,
  saveFileNative,
  isOnlineNow,
  onNetworkChange,
  copyToClipboard,
  openExternal,
  abrirLinkExterno,
  listNativePlugins,
  getDeviceInfo,
  setAppBadge,
} from '../lib/native';

type CapacitorMock = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

function setCapacitor(mock: CapacitorMock | undefined) {
  (window as unknown as { Capacitor?: CapacitorMock }).Capacitor = mock;
}

afterEach(() => {
  setCapacitor(undefined);
  // jsdom expõe navigator.share? Não por default — garantimos ausência.
});

describe('lib/native — fora da casca (browser puro)', () => {
  it('detecção reporta web/false em tudo', () => {
    expect(isNativePlatform()).toBe(false);
    expect(getNativePlatform()).toBe('web');
    expect(isNativeOAuthAvailable()).toBe(false);
    expect(isNativeCameraAvailable()).toBe(false);
    expect(isNativePushAvailable()).toBe(false);
  });

  it('helpers devolvem fallback, nunca throw', async () => {
    await expect(takePhotoNative()).resolves.toEqual({ status: 'unavailable' });
    await expect(registerNativePush()).resolves.toBeNull();
    await expect(shareNative({ url: 'https://x' })).resolves.toBe(false);
  });

  it('Capacitor presente mas isNativePlatform()=false (SDK carregado no browser) segue web', () => {
    setCapacitor({ isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(isNativePlatform()).toBe(false);
    expect(getNativePlatform()).toBe('web');
  });
});

describe('lib/native — dentro da casca', () => {
  it('plataforma ios/android detectada', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'ios' });
    expect(isNativePlatform()).toBe(true);
    expect(getNativePlatform()).toBe('ios');
  });

  it('casca SEM os plugins de OAuth → indisponível (fallback web obrigatório)', () => {
    setCapacitor({ isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} });
    expect(isNativeOAuthAvailable()).toBe(false);
  });

  it('casca COM Browser+App → OAuth nativo disponível', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { Browser: { open: async () => {} }, App: { addListener: () => ({ remove() {} }) } },
    });
    expect(isNativeOAuthAvailable()).toBe(true);
  });

  it('câmera nativa: cancelamento do usuário NÃO vira erro nem fallback', async () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        Camera: {
          getPhoto: async () => {
            throw new Error('User cancelled photos app');
          },
        },
      },
    });
    await expect(takePhotoNative()).resolves.toEqual({ status: 'cancelled' });
  });

  it('câmera nativa: base64 vira File com mime/format corretos', async () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        Camera: { getPhoto: async () => ({ base64String: btoa('fake-bytes'), format: 'png' }) },
      },
    });
    const res = await takePhotoNative('CAMERA');
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.file.type).toBe('image/png');
      expect(res.file.size).toBeGreaterThan(0);
    }
  });
});

describe('parseAuthCallbackUrl (PKCE — só `code` entra pelo deep link)', () => {
  const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';

  it('extrai o authorization code da query (fluxo PKCE do Supabase)', () => {
    expect(parseAuthCallbackUrl(`${NATIVE_OAUTH_REDIRECT}?code=${CODE}`)).toEqual({ code: CODE });
  });

  it('aceita o code também no fragment (provedor que degrade)', () => {
    expect(parseAuthCallbackUrl(`${NATIVE_OAUTH_REDIRECT}#code=${CODE}`)).toEqual({ code: CODE });
  });

  it('IGNORA access_token/refresh_token no deep link — token de fora nunca vira sessão', () => {
    // Custom scheme pode ser registrado por qualquer app no Android: um
    // link forjado com token do atacante não pode logar a vítima nele.
    const url = `${NATIVE_OAUTH_REDIRECT}#access_token=AT123&refresh_token=RT456&expires_in=3600`;
    const out = parseAuthCallbackUrl(url) as Record<string, unknown>;
    expect(out).toEqual({});
    expect(out.accessToken).toBeUndefined();
    expect(out.refreshToken).toBeUndefined();
  });

  it('code com formato estranho é descartado', () => {
    expect(parseAuthCallbackUrl(`${NATIVE_OAUTH_REDIRECT}?code=../../x`)).toEqual({});
    expect(parseAuthCallbackUrl(`${NATIVE_OAUTH_REDIRECT}?code=`)).toEqual({});
  });

  it('extrai erro (usuário negou no provedor)', () => {
    const url = `${NATIVE_OAUTH_REDIRECT}#error=access_denied&error_description=denied`;
    expect(parseAuthCallbackUrl(url).errorDescription).toBe('denied');
  });

  it('URL alheia (outro deep link) → objeto vazio, nunca throw', () => {
    expect(parseAuthCallbackUrl(`br.com.queroumacor.app://outro/caminho?code=${CODE}`)).toEqual({});
    expect(parseAuthCallbackUrl(`https://queroumacor.com.br/?code=${CODE}`)).toEqual({});
    expect(parseAuthCallbackUrl('')).toEqual({});
  });
});

describe('routeFromNotificationData (toque na push → rota)', () => {
  it('aceita path relativo do data.url', () => {
    expect(routeFromNotificationData({ url: '/chat' })).toBe('/chat');
    expect(routeFromNotificationData({ url: '/perfil/abc' })).toBe('/perfil/abc');
  });
  it('recusa URL externa / protocol-relative (anti open-redirect)', () => {
    expect(routeFromNotificationData({ url: 'https://evil.com' })).toBeNull();
    expect(routeFromNotificationData({ url: '//evil.com' })).toBeNull();
    expect(routeFromNotificationData({ url: 'javascript:alert(1)' })).toBeNull();
  });
  it('sem url / tipo errado → null', () => {
    expect(routeFromNotificationData(undefined)).toBeNull();
    expect(routeFromNotificationData({})).toBeNull();
    expect(routeFromNotificationData({ url: 42 as unknown as string })).toBeNull();
  });
});

describe('lib/native Onda A — chrome/haptics fora da casca (no-op, nunca throw)', () => {
  it('haptics não lançam sem Capacitor', () => {
    expect(() => hapticImpact('light')).not.toThrow();
    expect(() => hapticNotify('success')).not.toThrow();
    expect(() => hapticSelection()).not.toThrow();
  });
  it('statusBar/keyboard/splash são no-op silencioso', () => {
    expect(() => applyStatusBar({ iconsLight: true })).not.toThrow();
    expect(() => initKeyboard()).not.toThrow();
    expect(() => hideSplash()).not.toThrow();
  });
  it('onAppResume devolve unsubscribe no-op fora da casca', () => {
    const off = onAppResume(() => {});
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
});

describe('lib/native Onda A — dentro da casca', () => {
  it('haptics chamam o plugin Haptics', () => {
    const calls: string[] = [];
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Haptics: {
          impact: async () => { calls.push('impact'); },
          notification: async () => { calls.push('notification'); },
          selectionChanged: async () => { calls.push('selection'); },
        },
      },
    });
    hapticImpact('medium');
    hapticNotify('success');
    hapticSelection();
    expect(calls).toEqual(['impact', 'notification', 'selection']);
  });

  it('applyStatusBar usa o plugin StatusBar', () => {
    let styled = false;
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        StatusBar: {
          setStyle: async () => { styled = true; },
          setBackgroundColor: async () => {},
          setOverlaysWebView: async () => {},
        },
      },
    });
    applyStatusBar({ iconsLight: true });
    expect(styled).toBe(true);
  });

  it('onAppResume registra listener no plugin App e a limpeza remove', async () => {
    let removed = false;
    let handler: ((d: unknown) => void) | undefined;
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        App: {
          addListener: (_e: string, cb: (d: unknown) => void) => {
            handler = cb;
            return { remove() { removed = true; } };
          },
        },
      },
    });
    let resumes = 0;
    const off = onAppResume(() => { resumes += 1; });
    handler?.({ isActive: true });
    handler?.({ isActive: false }); // background — não conta
    expect(resumes).toBe(1);
    off();
    expect(removed).toBe(true);
  });
});

describe('lib/native Onda B — picker + filesystem fora da casca', () => {
  it('picker/filesystem indisponíveis e helpers devolvem unavailable', async () => {
    expect(isNativePickerAvailable()).toBe(false);
    expect(isNativeFilesystemAvailable()).toBe(false);
    await expect(pickImagesNative(5)).resolves.toEqual({ status: 'unavailable' });
    await expect(saveFileNative('x.pdf', 'YQ==')).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('lib/native Onda B — dentro da casca', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('pickImagesNative baixa webPath e monta File[]', async () => {
    globalThis.fetch = (async () =>
      ({ blob: async () => new Blob(['xx'], { type: 'image/jpeg' }) })) as unknown as typeof fetch;
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Camera: {
          getPhoto: async () => ({}),
          pickImages: async () => ({
            photos: [{ webPath: 'cap://a', format: 'jpg' }, { webPath: 'cap://b', format: 'jpg' }],
          }),
        },
      },
    });
    expect(isNativePickerAvailable()).toBe(true);
    const r = await pickImagesNative(5);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.files).toHaveLength(2);
      expect(r.files[0].type).toBe('image/jpeg');
    }
  });

  it('pickImagesNative sem escolha → cancelled', async () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { Camera: { getPhoto: async () => ({}), pickImages: async () => ({ photos: [] }) } },
    });
    await expect(pickImagesNative()).resolves.toEqual({ status: 'cancelled' });
  });

  it('saveFileNative grava via plugin Filesystem e devolve uri', async () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Filesystem: { writeFile: async () => ({ uri: 'file:///Documents/x.pdf' }) },
      },
    });
    expect(isNativeFilesystemAvailable()).toBe(true);
    const r = await saveFileNative('x.pdf', 'YQ==');
    expect(r).toEqual({ status: 'ok', uri: 'file:///Documents/x.pdf' });
  });
});

describe('lib/native Onda C — utilidades fora da casca', () => {
  it('device info web = não-nativo', async () => {
    const d = await getDeviceInfo();
    expect(d.isNative).toBe(false);
    expect(d.platform).toBe('web');
    expect(d.model).toBeNull();
  });
  it('setAppBadge é no-op silencioso', () => {
    expect(() => setAppBadge(3)).not.toThrow();
    expect(() => setAppBadge(0)).not.toThrow();
  });
  it('openExternal recusa não-http e aceita http (window.open)', async () => {
    const orig = window.open;
    let opened = '';
    // @ts-expect-error mock
    window.open = (u: string) => { opened = u; return {}; };
    await expect(openExternal('javascript:alert(1)')).resolves.toBe(false);
    await expect(openExternal('https://x.com')).resolves.toBe(true);
    expect(opened).toBe('https://x.com');
    window.open = orig;
  });
  it('copyToClipboard usa navigator.clipboard quando existe', async () => {
    let copied = '';
    const nav = navigator as unknown as { clipboard?: { writeText?: (s: string) => Promise<void> } };
    const orig = nav.clipboard;
    nav.clipboard = { writeText: async (s: string) => { copied = s; } };
    await expect(copyToClipboard('#FF0000')).resolves.toBe(true);
    expect(copied).toBe('#FF0000');
    nav.clipboard = orig;
  });
  it('onNetworkChange devolve unsubscribe (eventos web)', () => {
    const off = onNetworkChange(() => {});
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });
  it('isOnlineNow reflete navigator.onLine', () => {
    expect(typeof isOnlineNow()).toBe('boolean');
  });
});

describe('lib/native Onda C — dentro da casca', () => {
  it('copyToClipboard usa o plugin Clipboard', async () => {
    let written = '';
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { Clipboard: { write: async (o: { string: string }) => { written = o.string; } } },
    });
    await expect(copyToClipboard('abc')).resolves.toBe(true);
    expect(written).toBe('abc');
  });
  it('openExternal usa o plugin Browser', async () => {
    let url = '';
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: { Browser: { open: async (o: { url: string }) => { url = o.url; } } },
    });
    await expect(openExternal('https://loja.com')).resolves.toBe(true);
    expect(url).toBe('https://loja.com');
  });
  it('getDeviceInfo agrega Device + App', async () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        Device: { getInfo: async () => ({ model: 'SM-X', platform: 'android', osVersion: '14' }) },
        App: { getInfo: async () => ({ version: '1.2.1', build: '10201' }) },
      },
    });
    const d = await getDeviceInfo();
    expect(d).toMatchObject({ isNative: true, model: 'SM-X', osVersion: '14', appVersion: '1.2.1', appBuild: '10201' });
  });
  it('setAppBadge chama set/clear do plugin Badge', () => {
    const calls: string[] = [];
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { Badge: { set: async () => { calls.push('set'); }, clear: async () => { calls.push('clear'); } } },
    });
    setAppBadge(5);
    setAppBadge(0);
    expect(calls).toEqual(['set', 'clear']);
  });
});

describe('abrirLinkExterno — nunca navega a WebView na casca', () => {
  // Regra nascida da rejeição da App Review (06/09/2026): `location.href` pra
  // fora do app é CANCELADO pelo Capacitor, e o cancelamento faz a WebView
  // carregar a errorPath — a pessoa vê "Sem conexão" com internet.
  const abertos: Array<string | undefined> = [];
  let hrefEscrito = '';

  function armar(nativo: boolean, janelaAbre: boolean) {
    abertos.length = 0;
    hrefEscrito = '';
    setCapacitor(
      nativo ? { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} } : undefined,
    );
    (window as unknown as { open: unknown }).open = (u?: string) => {
      abertos.push(u);
      return janelaAbre ? ({} as Window) : null;
    };
    // jsdom recusa navegação de verdade; interceptamos a escrita.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        get href() {
          return hrefEscrito;
        },
        set href(v: string) {
          hrefEscrito = v;
        },
      },
    });
  }

  it('na casca usa window.open e NUNCA location.href', () => {
    armar(true, false); // o delegate do Capacitor devolve null mesmo dando certo
    expect(abrirLinkExterno('https://wa.me/5511999999999')).toBe(true);
    expect(abertos).toEqual(['https://wa.me/5511999999999']);
    expect(hrefEscrito).toBe('');
  });

  it('mailto: também sai pelo window.open na casca', () => {
    armar(true, false);
    expect(abrirLinkExterno('mailto:x@y.com')).toBe(true);
    expect(hrefEscrito).toBe('');
  });

  it('fora da casca, pop-up bloqueado cai pra location.href (comportamento web)', () => {
    armar(false, false);
    expect(abrirLinkExterno('https://exemplo.com')).toBe(true);
    expect(hrefEscrito).toBe('https://exemplo.com');
  });
});

describe('listNativePlugins — diagnóstico', () => {
  it('devolve os nomes visíveis, ordenados', () => {
    setCapacitor({
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: { Browser: {}, App: {} },
    });
    expect(listNativePlugins()).toEqual(['App', 'Browser']);
  });

  it('fora da casca é lista vazia, nunca throw', () => {
    setCapacitor(undefined);
    expect(listNativePlugins()).toEqual([]);
  });
});

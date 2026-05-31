// Integration tests for /shims.js — verifies that the migration shim
// correctly republishes window.Modules.* and window.Utils.* as bare globals
// so HTML inline handlers + legacy bare calls in app.js keep working.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadScript(path, fakeWindow){
  const src = readFileSync(join(root, path), 'utf8');
  // The script body uses `window` and `document` lexically; we expose only
  // window. Anything that touches document/location returns undefined and the
  // load-time code in the IIFEs simply skips DOM wiring.
  new Function('window', 'document', 'history', 'location', 'setTimeout',
    src.replace(/'use strict'\s*;?/g, '')  // strip strict so noop assigns don't blow up in test
  )(fakeWindow,
    fakeWindow.document || { readyState: 'complete', addEventListener: ()=>{}, querySelectorAll: ()=>[] },
    fakeWindow.history || { replaceState: ()=>{}, pushState: ()=>{} },
    fakeWindow.location || { pathname: '/' },
    fakeWindow.setTimeout || (fn => fn)
  );
}

describe('shims.js — wires Modules.* and Utils.* to window.*', () => {
  let win;

  beforeEach(() => {
    // Fake window where loadScript can hang things.
    win = {
      addEventListener: () => {},
      document: { readyState: 'complete', addEventListener: () => {}, querySelectorAll: () => [] },
      history: { replaceState: () => {}, pushState: () => {} },
      location: { pathname: '/' },
      setTimeout: (fn) => fn,
    };
    // Pre-populate Modules + Utils with sentinels so we can verify shim mapping.
    win.Modules = {
      ranking: { loadRanking: () => 'rk' },
      info: { SUPPORT: { mail: 'x@y' }, openInfoPage: () => 'op', infoBack: () => 'ib', supportWhatsApp: () => 'sw', supportEmail: () => 'se', requestAccountDeletion: () => 'rad', baixarMeusDados: () => 'bm' },
      calc: { setD: () => 'sd', calcTinta: () => 'ct', estimarAreaPorFoto: () => 'eap' },
      nav: { showScreen: () => 'ss' },
      notif: { notify: () => 'nt', loadNotifications: () => 'ln', updateNotifBadge: () => 'unb', setupNotifSubscription: () => 'sns' },
      mkt: { addToCart: () => 'ac', updateCartBadge: () => 'ucb', resolveColorHex: () => 'rch', productBg: () => 'pb', hasProductColor: () => 'hpc', mktClassify: () => 'mc', loadUserState: () => 'lus', saveCart: () => 'sc', changeCartQty: () => 'ccq', renderCartModal: () => 'rcm', removeFromCart: () => 'rfc', submitCartOrder: () => 'sco', getCategoryEmoji: () => 'gce', getProductImage: () => 'gpi', renderProductRow: () => 'rpr', openProductDetail: () => 'opd', mktTab: () => 'mt', mktSearch: () => 'ms', renderMktUI: () => 'rmu', loadMktProducts: () => 'lmp', changeQty: () => 'cq', setSizeBtn: () => 'ssb', setShirtColor: () => 'ssc', openShirtZoom: () => 'osz', closeShirtZoom: () => 'csz', buyShirt: () => 'bs' },
      // Provide stubs for every other module so expose() doesn't warn-out
    };
    win.Utils = {
      parseBRL: () => 0,
      fmtBRL: () => {},
      toast: () => {},
      showModal: () => {},
      closeModals: () => {},
      hideModal: () => {},
      escapeHtml: (s) => s,
      escapeJsArg: (s) => s,
      getTimeAgo: () => 'agora',
      stripEmail: (s) => s,
      cleanHandle: (s) => s,
      getMediaType: () => 'image',
      _compressImageFile: () => null,
      isVideoUrl: () => false,
      _extractVideoFrame: () => null,
      _normTxt: (s) => s,
      _hashStr: () => 0,
      _starStr: () => '',
      _agYmd: () => '2026-05-31',
      crmNormName: (s) => s,
      crmMonthsSince: () => 0,
    };
    // Suppress missing-module warnings for the modules we didn't stub above.
    win.Modules = new Proxy(win.Modules, {
      get(target, prop){
        if(prop in target) return target[prop];
        // Return a minimal stub object so expose() reports each key as undefined
        return undefined;
      }
    });
    // Quiet expected warnings during test
    const originalWarn = console.warn;
    console.warn = () => {};
    loadScript('shims.js', win);
    console.warn = originalWarn;
  });

  it('publishes ranking.loadRanking → window.loadRanking', () => {
    expect(typeof win.loadRanking).toBe('function');
    expect(win.loadRanking()).toBe('rk');
  });

  it('publishes info.SUPPORT → window.SUPPORT', () => {
    expect(win.SUPPORT).toEqual({ mail: 'x@y' });
  });

  it('publishes calc trio → window.setD / calcTinta / estimarAreaPorFoto', () => {
    expect(typeof win.setD).toBe('function');
    expect(typeof win.calcTinta).toBe('function');
    expect(typeof win.estimarAreaPorFoto).toBe('function');
    expect(win.setD()).toBe('sd');
  });

  it('publishes nav.showScreen → window.showScreen', () => {
    expect(typeof win.showScreen).toBe('function');
    expect(win.showScreen()).toBe('ss');
  });

  it('publishes Utils helpers → window globals (parseBRL, toast, escapeHtml, etc.)', () => {
    expect(typeof win.parseBRL).toBe('function');
    expect(typeof win.toast).toBe('function');
    expect(typeof win.escapeHtml).toBe('function');
    expect(typeof win.getTimeAgo).toBe('function');
    expect(typeof win.crmNormName).toBe('function');
    expect(win.getTimeAgo()).toBe('agora');
  });

  it('publishes mkt cart trio → window.addToCart / updateCartBadge / submitCartOrder', () => {
    expect(typeof win.addToCart).toBe('function');
    expect(typeof win.updateCartBadge).toBe('function');
    expect(typeof win.submitCartOrder).toBe('function');
  });

  it('publishes notif quartet → window.notify / loadNotifications / updateNotifBadge / setupNotifSubscription', () => {
    expect(typeof win.notify).toBe('function');
    expect(typeof win.loadNotifications).toBe('function');
    expect(typeof win.updateNotifBadge).toBe('function');
    expect(typeof win.setupNotifSubscription).toBe('function');
  });
});

describe('shims.js — defensive when Modules is missing', () => {
  it('warns and exits without throwing when window.Modules undefined', () => {
    const win = { addEventListener: () => {} };
    const warned = [];
    const oWarn = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    loadScript('shims.js', win);
    console.warn = oWarn;
    expect(warned.join('\n')).toMatch(/Modules indefinido/);
    // No globals should have leaked
    expect(win.loadRanking).toBeUndefined();
  });
});

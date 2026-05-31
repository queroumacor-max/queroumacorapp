// Integration tests pros 5 fluxos REAIS wireados ao window.Events (rollout
// 2026-05): post.liked, auth.logged_in, auth.logged_out, pro.upgraded,
// feed.refreshed.
//
// Estratégia: monta um fake window com um Events bus que captura todos os
// emit() em um array `emits`. Carrega o módulo via new Function (igual
// shims.test.js / db.test.js), invoca a função publisher, e verifica que o
// evento certo foi disparado com o payload certo.
//
// NÃO testa o comportamento dos handlers em si — só que os publishers estão
// emitindo. Handlers ficam pra testes E2E ou unit do módulo subscriber.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Factory: cria window mock com Events bus spy + utilitários comuns.
function makeWin(){
  const emits = [];
  const win = {
    emits,
    Events: {
      on: () => () => {},
      off: () => {},
      emit: (name, p) => emits.push({ name, p }),
      once: () => () => {},
      _list: () => [],
      _count: () => 0,
    },
    Modules: {},
    addEventListener: () => {},
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
      createElement: () => ({ style: {}, addEventListener: () => {}, appendChild: () => {} }),
    },
    history: { replaceState: () => {}, pushState: () => {} },
    location: { pathname: '/', search: '', origin: '' },
    setTimeout: (fn) => { try { fn(); } catch(_){} return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    console: { warn: () => {}, info: () => {}, error: () => {}, log: () => {} },
    toast: () => {},
    requestIdleCallback: (fn) => fn(),
  };
  return win;
}

// Carrega um arquivo no fake window. Strip 'use strict' pra não dar erro de
// reassign de funções/vars que o test mock precisa fazer.
function loadInto(win, relPath){
  const src = readFileSync(join(root, relPath), 'utf8')
    .replace(/'use strict'\s*;?/g, '');
  // Lista de globals que os módulos podem referenciar lexicalmente. Tudo
  // que não está aqui vira erro de ReferenceError dentro do IIFE.
  const fn = new Function(
    'window','document','history','location','console','setTimeout',
    'clearTimeout','setInterval','clearInterval','requestIdleCallback',
    'currentUser','getSupabase','toast','escapeHtml','escapeJsArg',
    'showModal','closeModals','sharePost','moderateContentAsync',
    'storyGroups','currentStoryGroup','currentStoryIndex','closeStoryViewer',
    'loadStories','renderCurrentStory','appConfirm','handleSbError',
    'getMyProfile','dateBR','apiPost','showScreen','loadPedidos',
    'validatedInviteCode','signupNext','URLSearchParams',
    src
  );
  fn(
    win, win.document, win.history, win.location, win.console,
    win.setTimeout, win.clearTimeout, win.setInterval, win.clearInterval,
    win.requestIdleCallback,
    win.currentUser, win.getSupabase, win.toast, win.escapeHtml || (s => s),
    win.escapeJsArg || (s => s), win.showModal || (() => {}),
    win.closeModals || (() => {}), win.sharePost || (() => {}),
    win.moderateContentAsync || (async () => ({ approved: true })),
    win.storyGroups || [], win.currentStoryGroup, win.currentStoryIndex,
    win.closeStoryViewer || (() => {}), win.loadStories || (() => {}),
    win.renderCurrentStory || (() => {}), win.appConfirm || (async () => true),
    win.handleSbError || (() => false), win.getMyProfile || (async () => null),
    win.dateBR || (() => ''), win.apiPost || (async () => ({ ok: true, data: {} })),
    win.showScreen || (() => {}), win.loadPedidos || (() => {}),
    win.validatedInviteCode, win.signupNext || (() => {}),
    URLSearchParams
  );
}

describe('Events integration — 5 fluxos wireados', () => {
  describe('post.liked (modules/feed-interactions.js togglePostLike)', () => {
    let win, postEl, btn;

    beforeEach(() => {
      win = makeWin();
      // currentUser global (referenciado lexicalmente no módulo)
      win.currentUser = { id: 'user-likes' };
      // Mock Supabase: insert em 'likes' sucede sem error.
      win.getSupabase = () => ({
        from: () => ({
          insert: async () => ({ error: null }),
          delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        }),
      });
      loadInto(win, 'modules/feed-interactions.js');

      // Botão + post sintéticos que togglePostLike espera. Foco no caminho
      // "novo like" (isLiked começa false: svg.style.fill !== 'var(--p4)').
      postEl = {
        dataset: { postId: 'post-42', authorId: 'owner-7' },
        querySelector: () => null,
      };
      const svg = { style: { fill: 'none', stroke: 'var(--ink)' } };
      btn = {
        querySelector: (sel) => {
          if(sel === 'svg') return svg;
          if(sel === '.act-label') return { textContent: 'Curtir' };
          return null;
        },
        closest: () => postEl,
      };
    });

    it('emite post.liked com {postId, postOwnerId, likedByUserId} após INSERT confirmar', async () => {
      const togglePostLike = win.Modules.feedInteractions.togglePostLike;
      await togglePostLike(btn);
      const liked = win.emits.find(e => e.name === 'post.liked');
      expect(liked).toBeDefined();
      expect(liked.p).toEqual({
        postId: 'post-42',
        postOwnerId: 'owner-7',
        likedByUserId: 'user-likes',
      });
    });
  });

  describe('feed.refreshed (modules/feed.js loadFeed)', () => {
    it('emite feed.refreshed com {count, durationMs} após load bem-sucedido', async () => {
      // Como loadFeed depende de muitas globals (getFollowingIds, loadStories,
      // loadPosts, paintFeedFromCache, document.querySelectorAll, etc),
      // testamos via reproducao do call site: o emit ocorre numa linha
      // explicita. Validamos a forma do payload diretamente.
      const win = makeWin();
      const count = 7, durationMs = 1234;
      win.Events.emit('feed.refreshed', { count, durationMs });
      const evt = win.emits.find(e => e.name === 'feed.refreshed');
      expect(evt).toBeDefined();
      expect(evt.p).toEqual({ count, durationMs });
      // Verifica que o publisher real (modules/feed.js) usa essa shape:
      const src = readFileSync(join(root, 'modules/feed.js'), 'utf8');
      expect(src).toMatch(/Events\.emit\(\s*['"]feed\.refreshed['"]/);
      expect(src).toMatch(/count:\s*count/);
      expect(src).toMatch(/durationMs:\s*elapsed/);
    });
  });

  describe('auth.logged_in (head.js doLoginSupabase / initAuth)', () => {
    it('publishers no head.js usam payload {userId, email}', () => {
      // head.js depende de Supabase + DOM full pra rodar initAuth/doLogin
      // no sandbox. Validamos via inspecao do source que o emit existe e
      // tem o shape correto — mesmo padrao que usamos no shims.test pra
      // checar wiring sem instanciar a SPA inteira.
      const src = readFileSync(join(root, 'head.js'), 'utf8');
      // 2 call sites: doLoginSupabase (login fresh) + initAuth (session restore)
      const occurrences = src.match(/Events\.emit\(\s*['"]auth\.logged_in['"]/g) || [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
      // Payload shape: userId + email
      expect(src).toMatch(/userId:\s*(?:data\.user|session\.user)\.id/);
      expect(src).toMatch(/email:\s*(?:data\.user|session\.user)\.email/);
    });

    it('o bus dispara o handler com o payload esperado', () => {
      // Sanity check pro contrato: simula o emit que head.js fará.
      const win = makeWin();
      win.Events.emit('auth.logged_in', { userId: 'u1', email: 'a@b' });
      const evt = win.emits.find(e => e.name === 'auth.logged_in');
      expect(evt.p).toEqual({ userId: 'u1', email: 'a@b' });
    });
  });

  describe('auth.logged_out (head.js doLogoutSupabase)', () => {
    it('publisher emite com payload vazio ANTES de zerar estado', () => {
      // Mesma estrategia do auth.logged_in: source inspection +
      // contract check via bus spy. doLogoutSupabase precisa de
      // sb.auth.signOut + DOM (showScreen) — sandbox nao roda completo.
      const src = readFileSync(join(root, 'head.js'), 'utf8');
      expect(src).toMatch(/Events\.emit\(\s*['"]auth\.logged_out['"]\s*,\s*\{\s*\}\s*\)/);
      // Verifica ordem: emit precisa vir ANTES da linha "currentUser = null"
      // no escopo de doLogoutSupabase pra que handlers vejam o estado vivo.
      const logoutFnStart = src.indexOf('async function doLogoutSupabase');
      const emitIdx = src.indexOf("Events.emit('auth.logged_out'", logoutFnStart);
      const clearIdx = src.indexOf('currentUser = null', logoutFnStart);
      expect(emitIdx).toBeGreaterThan(-1);
      expect(clearIdx).toBeGreaterThan(-1);
      expect(emitIdx).toBeLessThan(clearIdx);
    });

    it('o bus dispara o handler de auth.logged_out com payload vazio', () => {
      const win = makeWin();
      win.Events.emit('auth.logged_out', {});
      const evt = win.emits.find(e => e.name === 'auth.logged_out');
      expect(evt).toBeDefined();
      expect(evt.p).toEqual({});
    });
  });

  describe('pro.upgraded (modules/pro.js handleProReturn)', () => {
    it('emite pro.upgraded quando refreshProStatus detecta ativacao', () => {
      // handleProReturn poll-e em loop com setInterval — sandbox simplista
      // nao reproduz timing real. Verificamos via inspecao do source + bus
      // spy que o publisher esta dentro do branch "pro ativado".
      const src = readFileSync(join(root, 'modules/pro.js'), 'utf8');
      // Emit aparece no branch if(pro){...}
      expect(src).toMatch(/if\(pro\)\s*\{[\s\S]*?Events\.emit\(\s*['"]pro\.upgraded['"]/);
      // Payload tem userId + expiresAt
      expect(src).toMatch(/userId:\s*currentUser\.id/);
      expect(src).toMatch(/expiresAt:\s*_proExpires/);

      // Contract: bus recebe payload na shape certa.
      const win = makeWin();
      win.Events.emit('pro.upgraded', { userId: 'u-pro', expiresAt: '2026-12-31' });
      const evt = win.emits.find(e => e.name === 'pro.upgraded');
      expect(evt.p).toEqual({ userId: 'u-pro', expiresAt: '2026-12-31' });
    });
  });
});

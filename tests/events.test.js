// Tests for /events.js — in-process pub/sub bus on window.Events.
// Loads via new Function (same pattern as policies.test.js / db.test.js).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'events.js'), 'utf8');

function loadBus(){
  const win = {};
  new Function('window', src)(win);
  return win.Events;
}

describe('Events — basic on/emit/off', () => {
  let E;
  beforeEach(() => { E = loadBus(); });

  it('on() registers a handler and emit() invokes it with the payload', () => {
    const seen = [];
    E.on('post.liked', (p) => seen.push(p));
    E.emit('post.liked', { postId: 'p1' });
    expect(seen).toEqual([{ postId: 'p1' }]);
  });

  it('emit() with no payload passes undefined', () => {
    let received = 'sentinel';
    E.on('feed.refreshed', (p) => { received = p; });
    E.emit('feed.refreshed');
    expect(received).toBe(undefined);
  });

  it('on() returns an unsubscribe function', () => {
    const seen = [];
    const off = E.on('chat.message_received', (p) => seen.push(p));
    E.emit('chat.message_received', 1);
    off();
    E.emit('chat.message_received', 2);
    expect(seen).toEqual([1]);
  });

  it('off() removes a specific handler without touching the others', () => {
    const a = [], b = [];
    const hA = (p) => a.push(p);
    const hB = (p) => b.push(p);
    E.on('x.y', hA);
    E.on('x.y', hB);
    E.off('x.y', hA);
    E.emit('x.y', 'ping');
    expect(a).toEqual([]);
    expect(b).toEqual(['ping']);
  });

  it('emit() with no listeners is a no-op (does not throw)', () => {
    expect(() => E.emit('nobody.listening', { foo: 1 })).not.toThrow();
  });
});

describe('Events — multiple handlers + ordering', () => {
  let E;
  beforeEach(() => { E = loadBus(); });

  it('invokes handlers in registration order', () => {
    const order = [];
    E.on('e', () => order.push('a'));
    E.on('e', () => order.push('b'));
    E.on('e', () => order.push('c'));
    E.emit('e');
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('a throwing sync handler does not interrupt the chain', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order = [];
    E.on('e', () => order.push('a'));
    E.on('e', () => { throw new Error('boom'); });
    E.on('e', () => order.push('c'));
    E.emit('e');
    expect(order).toEqual(['a', 'c']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Events — once()', () => {
  let E;
  beforeEach(() => { E = loadBus(); });

  it('fires exactly once and auto-unsubscribes', () => {
    const seen = [];
    E.once('auth.logged_out', (p) => seen.push(p));
    E.emit('auth.logged_out', 'first');
    E.emit('auth.logged_out', 'second');
    expect(seen).toEqual(['first']);
    expect(E._count('auth.logged_out')).toBe(0);
  });

  it('once() returns an unsubscribe that prevents the only firing', () => {
    const seen = [];
    const off = E.once('e', () => seen.push(1));
    off();
    E.emit('e');
    expect(seen).toEqual([]);
  });
});

describe('Events — async handlers (fire-and-forget)', () => {
  let E;
  beforeEach(() => { E = loadBus(); });

  it('async handlers do not block the publisher (emit returns sync)', async () => {
    let asyncRan = false;
    E.on('e', async () => {
      await new Promise(r => setTimeout(r, 10));
      asyncRan = true;
    });
    E.emit('e');
    // Right after emit(), the async handler has NOT run yet.
    expect(asyncRan).toBe(false);
    await new Promise(r => setTimeout(r, 30));
    expect(asyncRan).toBe(true);
  });

  it('a rejecting async handler is caught (no unhandled rejection) and chain continues', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const order = [];
    E.on('e', async () => { throw new Error('async boom'); });
    E.on('e', () => order.push('next'));
    E.emit('e');
    // sync handler ran inline before the async one even scheduled its catch
    expect(order).toEqual(['next']);
    await new Promise(r => setTimeout(r, 5));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('Events — introspect (_list / _count)', () => {
  let E;
  beforeEach(() => { E = loadBus(); });

  it('_list returns registered event names, _count returns handler count', () => {
    E.on('a.b', () => {});
    E.on('a.b', () => {});
    E.on('c.d', () => {});
    expect(E._count('a.b')).toBe(2);
    expect(E._count('c.d')).toBe(1);
    expect(E._count('nope')).toBe(0);
    const list = E._list().sort();
    expect(list).toEqual(['a.b', 'c.d']);
  });

  it('cleans up the event entry when last handler is off()ed', () => {
    const h = () => {};
    E.on('e', h);
    expect(E._list()).toContain('e');
    E.off('e', h);
    expect(E._list()).not.toContain('e');
  });
});

describe('Events — safety against bad input', () => {
  let E;
  beforeEach(() => { E = loadBus(); });

  it('on() with non-string name or non-function handler is no-op', () => {
    E.on('', () => {});
    E.on(null, () => {});
    E.on('e', 'not-a-fn');
    expect(E._list()).toEqual([]);
  });

  it('handler that calls off() during emit() does not corrupt the iteration', () => {
    const order = [];
    const h1 = () => { order.push(1); E.off('e', h2); };
    const h2 = () => { order.push(2); };
    const h3 = () => { order.push(3); };
    E.on('e', h1);
    E.on('e', h2);
    E.on('e', h3);
    E.emit('e');
    // Snapshot is taken before iterating, so h2 still fires THIS emit.
    expect(order).toEqual([1, 2, 3]);
    // But subsequent emits skip h2.
    order.length = 0;
    E.emit('e');
    expect(order).toEqual([1, 3]);
  });
});

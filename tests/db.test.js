// Smoke tests do /db.js (camada de dados sobre Supabase).
// Carrega via new Function + fake window, igual validators.test.js.
// Sem mockar Supabase: getSupabase() retorna undefined no escopo de teste,
// então _sb() devolve null e cada função cai no caminho degradado seguro.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'db.js'), 'utf8');

/** @type {any} */
const fakeWindow = {};
new Function('window', src)(fakeWindow);
const DB = fakeWindow.DB;

describe('DB — shape', () => {
  it('expõe profiles/follows/posts', () => {
    expect(typeof DB).toBe('object');
    expect(typeof DB.profiles).toBe('object');
    expect(typeof DB.follows).toBe('object');
    expect(typeof DB.posts).toBe('object');
  });
  it('DB.profiles: getById, getMany, PUBLIC_COLS', () => {
    expect(typeof DB.profiles.getById).toBe('function');
    expect(typeof DB.profiles.getMany).toBe('function');
    expect(typeof DB.profiles.PUBLIC_COLS).toBe('string');
  });
  it('DB.follows: 7 métodos esperados', () => {
    const expected = ['countFollowers','countFollowing','listFollowingIds','listFollowerIds','isFollowing','follow','unfollow'];
    for (const fn of expected) expect(typeof DB.follows[fn]).toBe('function');
  });
  it('DB.posts: 4 métodos + COLS', () => {
    expect(typeof DB.posts.countByUser).toBe('function');
    expect(typeof DB.posts.getByUser).toBe('function');
    expect(typeof DB.posts.getFeedPosts).toBe('function');
    expect(typeof DB.posts.getStories).toBe('function');
    expect(typeof DB.posts.COLS).toBe('string');
  });
});

describe('DB — caminho degradado (sem Supabase)', () => {
  // _sb() retorna null quando getSupabase não está definida (igual no
  // ambiente de teste). Cada função tem que falhar com segurança.

  it('profiles.getById sem sb → null', async () => {
    expect(await DB.profiles.getById('any-id')).toBeNull();
  });
  it('profiles.getMany sem sb → []', async () => {
    expect(await DB.profiles.getMany(['a','b'])).toEqual([]);
  });
  it('profiles.getMany com ids vazio → [] (curto-circuita antes de _sb)', async () => {
    expect(await DB.profiles.getMany([])).toEqual([]);
  });
  it('follows.countFollowers sem sb → 0', async () => {
    expect(await DB.follows.countFollowers('u')).toBe(0);
  });
  it('follows.listFollowingIds sem sb → []', async () => {
    expect(await DB.follows.listFollowingIds('u')).toEqual([]);
  });
  it('follows.isFollowing sem sb → false', async () => {
    expect(await DB.follows.isFollowing('a','b')).toBe(false);
  });
  it('follows.follow sem sb → {ok:false, code:"no-client"}', async () => {
    const r = await DB.follows.follow('a','b');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no-client');
  });
  it('follows.follow com ids vazios → {ok:false, code:"bad-args"}', async () => {
    // _sb retorna null primeiro — então testa o caminho de bad-args num
    // ambiente onde sb seria truthy. Aqui só validamos que retorna {ok:false}.
    const r = await DB.follows.follow('', '');
    expect(r.ok).toBe(false);
  });
  it('follows.unfollow sem sb → {ok:false, code:"no-client"}', async () => {
    const r = await DB.follows.unfollow('a','b');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('no-client');
  });
  it('posts.countByUser sem sb → 0', async () => {
    expect(await DB.posts.countByUser('u')).toBe(0);
  });
  it('posts.getFeedPosts sem sb → resolve {data:[], error}', async () => {
    const r = await DB.posts.getFeedPosts({ feedIds:['u'], offset:0, limit:30 });
    expect(r.data).toEqual([]);
    expect(r.error).toBeTruthy();
  });
  it('posts.getStories sem sb → resolve {data:[], error}', async () => {
    const r = await DB.posts.getStories({ feedIds:['u'] });
    expect(r.data).toEqual([]);
    expect(r.error).toBeTruthy();
  });
});

describe('DB.profiles — colunas públicas', () => {
  it('PUBLIC_COLS contém colunas esperadas', () => {
    expect(DB.profiles.PUBLIC_COLS).toContain('id');
    expect(DB.profiles.PUBLIC_COLS).toContain('name');
    expect(DB.profiles.PUBLIC_COLS).toContain('avatar_url');
    expect(DB.profiles.PUBLIC_COLS).not.toContain('cart');           // pesado, fora
    expect(DB.profiles.PUBLIC_COLS).not.toContain('archived_conversations');
  });
});

describe('DB.posts — colunas', () => {
  it('COLS bate com POST_COLS de app.js (10 colunas)', () => {
    const cols = DB.posts.COLS.split(',').map(s => s.trim());
    expect(cols).toContain('id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('media_type');
    expect(cols).toContain('status');
    expect(cols.length).toBe(10);
  });
});

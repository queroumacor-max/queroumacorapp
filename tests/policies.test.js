// Tests for /policies.js — pure RBAC + ownership decisions.
// Pattern matches db/validators tests: new Function with fake window.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'policies.js'), 'utf8');
const fakeWindow = {};
new Function('window', src)(fakeWindow);
const P = fakeWindow.Policies;

describe('Policies — shape', () => {
  it('exposes all 11 documented APIs', () => {
    ['canEditProfile','canDeletePost','canEditQuote','canReplyToReview',
     'canModerateContent','canSeeProFeature','canFollowUser','canCreatePost',
     'canSendMessage','canViewAdminPanel','requireOrThrow']
      .forEach(k => expect(typeof P[k]).toBe('function'));
  });
});

describe('Policies — admin gating', () => {
  it('canModerateContent: only admins', () => {
    expect(P.canModerateContent(null)).toBe(false);
    expect(P.canModerateContent({ id: '1' })).toBe(false);
    expect(P.canModerateContent({ id: '1', role: 'pintor' })).toBe(false);
    expect(P.canModerateContent({ id: '1', is_admin: true })).toBe(true);
    expect(P.canModerateContent({ id: '1', role: 'admin' })).toBe(true);
  });
  it('canViewAdminPanel: only admins', () => {
    expect(P.canViewAdminPanel({ id: '1' })).toBe(false);
    expect(P.canViewAdminPanel({ id: '1', is_admin: true })).toBe(true);
  });
});

describe('Policies — ownership', () => {
  it('canEditProfile: self OR admin', () => {
    const me = { id: 'u1' };
    const other = { id: 'u2' };
    expect(P.canEditProfile(me, { id: 'u1' })).toBe(true);
    expect(P.canEditProfile(me, other)).toBe(false);
    expect(P.canEditProfile({ id: 'a1', is_admin: true }, other)).toBe(true);
  });
  it('canDeletePost: owner OR admin', () => {
    const me = { id: 'u1' };
    expect(P.canDeletePost(me, { id: 'p1', user_id: 'u1' })).toBe(true);
    expect(P.canDeletePost(me, { id: 'p1', user_id: 'u2' })).toBe(false);
    expect(P.canDeletePost({ id: 'a1', role: 'admin' }, { id: 'p1', user_id: 'u2' })).toBe(true);
  });
  it('canEditQuote: only own quote and only while alive', () => {
    const painter = { id: 'p1' };
    expect(P.canEditQuote(painter, { painter_id: 'p1', status: 'rascunho' })).toBe(true);
    expect(P.canEditQuote(painter, { painter_id: 'p1', status: 'aceito' })).toBe(false);
    expect(P.canEditQuote(painter, { painter_id: 'p2', status: 'rascunho' })).toBe(false);
    expect(P.canEditQuote({ id: 'a', is_admin: true }, { painter_id: 'p1', status: 'rascunho' })).toBe(false);
  });
  it('canReplyToReview: only the reviewed painter, NEVER admin', () => {
    expect(P.canReplyToReview({ id: 'p1' }, {}, 'p1')).toBe(true);
    expect(P.canReplyToReview({ id: 'p1' }, {}, 'p2')).toBe(false);
    expect(P.canReplyToReview({ id: 'a', is_admin: true }, {}, 'p1')).toBe(false);
  });
});

describe('Policies — PRO gating', () => {
  it('canSeeProFeature: PRO OR admin', () => {
    expect(P.canSeeProFeature(null)).toBe(false);
    expect(P.canSeeProFeature({ id: '1' })).toBe(false);
    expect(P.canSeeProFeature({ id: '1', is_pro: true })).toBe(true);
    expect(P.canSeeProFeature({ id: '1', is_admin: true })).toBe(true);
  });
});

describe('Policies — social', () => {
  it('canFollowUser: rejects self-follow + missing ids', () => {
    expect(P.canFollowUser(null, 'u2')).toBe(false);
    expect(P.canFollowUser({ id: 'u1' }, null)).toBe(false);
    expect(P.canFollowUser({ id: 'u1' }, 'u1')).toBe(false);
    expect(P.canFollowUser({ id: 'u1' }, 'u2')).toBe(true);
  });
  it('canCreatePost: only requires login', () => {
    expect(P.canCreatePost(null)).toBe(false);
    expect(P.canCreatePost({})).toBe(false);
    expect(P.canCreatePost({ id: 'u1' })).toBe(true);
  });
  it('canSendMessage: requires minimal profile (name/tag)', () => {
    expect(P.canSendMessage({ id: 'u1' })).toBe(false);
    expect(P.canSendMessage({ id: 'u1', name: 'João' })).toBe(true);
    expect(P.canSendMessage({ id: 'u1', tag: 'joao' })).toBe(true);
    expect(P.canSendMessage({ id: 'u1', display_name: 'João da Silva' })).toBe(true);
  });
});

describe('Policies — requireOrThrow', () => {
  it('no-op when allowed', () => {
    expect(() => P.requireOrThrow(true, 'msg')).not.toThrow();
  });
  it('throws with custom message', () => {
    expect(() => P.requireOrThrow(false, 'forbidden')).toThrow(/forbidden/);
  });
  it('throws default message', () => {
    expect(() => P.requireOrThrow(false)).toThrow(/Não autorizado/);
  });
});

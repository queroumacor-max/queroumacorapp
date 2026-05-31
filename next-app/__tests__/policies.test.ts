// Tests do port lib/policies.ts.
// Port direto de tests/policies.test.js — agora importa os símbolos como
// ESM funções tipadas. Mantém o mesmo casamento de casos pra que
// regressões na lógica vanilla apareçam aqui também.

import { describe, it, expect } from 'vitest';
import {
  canEditProfile,
  canDeletePost,
  canEditQuote,
  canReplyToReview,
  canModerateContent,
  canSeeProFeature,
  canFollowUser,
  canCreatePost,
  canSendMessage,
  canViewAdminPanel,
  requireOrThrow,
} from '../lib/policies';
import { AuthorizationError } from '../lib/errors';

describe('Policies — shape', () => {
  it('exposes all 11 documented APIs', () => {
    const fns = [
      canEditProfile,
      canDeletePost,
      canEditQuote,
      canReplyToReview,
      canModerateContent,
      canSeeProFeature,
      canFollowUser,
      canCreatePost,
      canSendMessage,
      canViewAdminPanel,
      requireOrThrow,
    ];
    for (const fn of fns) expect(typeof fn).toBe('function');
  });
});

describe('Policies — admin gating', () => {
  it('canModerateContent: only admins', () => {
    expect(canModerateContent(null)).toBe(false);
    expect(canModerateContent({ id: '1' })).toBe(false);
    expect(canModerateContent({ id: '1', role: 'pintor' })).toBe(false);
    expect(canModerateContent({ id: '1', is_admin: true })).toBe(true);
    expect(canModerateContent({ id: '1', role: 'admin' })).toBe(true);
  });
  it('canViewAdminPanel: only admins', () => {
    expect(canViewAdminPanel({ id: '1' })).toBe(false);
    expect(canViewAdminPanel({ id: '1', is_admin: true })).toBe(true);
  });
});

describe('Policies — ownership', () => {
  it('canEditProfile: self OR admin', () => {
    const me = { id: 'u1' };
    const other = { id: 'u2' };
    expect(canEditProfile(me, { id: 'u1' })).toBe(true);
    expect(canEditProfile(me, other)).toBe(false);
    expect(canEditProfile({ id: 'a1', is_admin: true }, other)).toBe(true);
  });
  it('canDeletePost: owner OR admin', () => {
    const me = { id: 'u1' };
    expect(canDeletePost(me, { id: 'p1', user_id: 'u1' })).toBe(true);
    expect(canDeletePost(me, { id: 'p1', user_id: 'u2' })).toBe(false);
    expect(canDeletePost({ id: 'a1', role: 'admin' }, { id: 'p1', user_id: 'u2' })).toBe(true);
  });
  it('canEditQuote: only own quote and only while alive', () => {
    const painter = { id: 'p1' };
    expect(canEditQuote(painter, { painter_id: 'p1', status: 'rascunho' })).toBe(true);
    expect(canEditQuote(painter, { painter_id: 'p1', status: 'aceito' })).toBe(false);
    expect(canEditQuote(painter, { painter_id: 'p2', status: 'rascunho' })).toBe(false);
    expect(
      canEditQuote({ id: 'a', is_admin: true }, { painter_id: 'p1', status: 'rascunho' })
    ).toBe(false);
  });
  it('canReplyToReview: only the reviewed painter, NEVER admin', () => {
    expect(canReplyToReview({ id: 'p1' }, {}, 'p1')).toBe(true);
    expect(canReplyToReview({ id: 'p1' }, {}, 'p2')).toBe(false);
    expect(canReplyToReview({ id: 'a', is_admin: true }, {}, 'p1')).toBe(false);
  });
});

describe('Policies — PRO gating', () => {
  it('canSeeProFeature: PRO OR admin', () => {
    expect(canSeeProFeature(null)).toBe(false);
    expect(canSeeProFeature({ id: '1' })).toBe(false);
    expect(canSeeProFeature({ id: '1', is_pro: true })).toBe(true);
    expect(canSeeProFeature({ id: '1', is_admin: true })).toBe(true);
  });
});

describe('Policies — social', () => {
  it('canFollowUser: rejects self-follow + missing ids', () => {
    expect(canFollowUser(null, 'u2')).toBe(false);
    expect(canFollowUser({ id: 'u1' }, null)).toBe(false);
    expect(canFollowUser({ id: 'u1' }, 'u1')).toBe(false);
    expect(canFollowUser({ id: 'u1' }, 'u2')).toBe(true);
  });
  it('canCreatePost: only requires login', () => {
    expect(canCreatePost(null)).toBe(false);
    expect(canCreatePost({})).toBe(false);
    expect(canCreatePost({ id: 'u1' })).toBe(true);
  });
  it('canSendMessage: requires minimal profile (name/tag)', () => {
    expect(canSendMessage({ id: 'u1' })).toBe(false);
    expect(canSendMessage({ id: 'u1', name: 'João' })).toBe(true);
    expect(canSendMessage({ id: 'u1', tag: 'joao' })).toBe(true);
    expect(canSendMessage({ id: 'u1', display_name: 'João da Silva' })).toBe(true);
  });
});

describe('Policies — requireOrThrow', () => {
  it('no-op when allowed', () => {
    expect(() => requireOrThrow(true, 'msg')).not.toThrow();
  });
  it('throws AuthorizationError com mensagem custom', () => {
    expect(() => requireOrThrow(false, 'forbidden')).toThrow(AuthorizationError);
    expect(() => requireOrThrow(false, 'forbidden')).toThrow(/forbidden/);
  });
  it('throws default message', () => {
    expect(() => requireOrThrow(false)).toThrow(/Acesso negado/);
  });
});

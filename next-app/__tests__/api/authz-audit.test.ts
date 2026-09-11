// __tests__/api/authz-audit.test.ts — regressão da auditoria de autorização
// de 2026-09-11. Cada bloco trava um achado: se a correção for desfeita, o
// teste correspondente falha (todos foram conferidos falhando sem o fix).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const CONFIRMED = '2026-01-01T00:00:00Z';

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(url).origin, ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function ok(json: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  process.env.ADMIN_EMAILS = 'boss@x.com';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

// ─── H-1: rate limit por IP era um no-op (chave decorada × RPC uuid) ────────
describe('checkRateLimit: chave que não é uuid vira uuid determinístico', () => {
  it('uuid puro passa intacto; string decorada vira uuid válido, estável e distinto', async () => {
    const { rateLimitKeyToUuid } = await import('@/lib/api/security');
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const pure = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(await rateLimitKeyToUuid(pure)).toBe(pure);
    const a = await rateLimitKeyToUuid('ip:198.51.100.1');
    const b = await rateLimitKeyToUuid('ip:198.51.100.1');
    const c = await rateLimitKeyToUuid('ip:198.51.100.2');
    expect(a).toMatch(UUID);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('a RPC recebe SEMPRE um uuid em p_user_id (antes o 400 abria o limite em silêncio)', async () => {
    let sent = '';
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/rpc/check_rate_limit')) {
        sent = (JSON.parse(String(init?.body)) as { p_user_id: string }).p_user_id;
        return ok({ allowed: false, count: 99, limit: 5, retry_after_seconds: 60 });
      }
      return ok([]);
    });
    const { enforceRateLimit } = await import('@/lib/api/security');
    const req = new Request('https://app.test/api/x', { headers: { 'cf-connecting-ip': '203.0.113.9' } });
    const res = await enforceRateLimit(req, { endpoint: 'x', limit: 5 });
    expect(res?.status).toBe(429);
    expect(sent).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ─── H-2: allowlist ADMIN_EMAILS só com e-mail CONFIRMADO ───────────────────
describe('allowlist exige e-mail confirmado', () => {
  function adminFetch(opts: { confirmed: boolean; portal?: boolean }) {
    return vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) {
        return ok({ id: 'caller', email: 'boss@x.com', email_confirmed_at: opts.confirmed ? CONFIRMED : null });
      }
      if (url.includes('/rpc/check_rate_limit')) return ok({ allowed: true });
      if (url.includes('/rest/v1/profiles')) return ok([{ id: 'u1', name: 'Foo', portal_access: !!opts.portal, role: 'cliente' }]);
      return ok([]);
    });
  }

  it('conta com o e-mail da allowlist mas SEM confirmação leva 403 em /api/admin/users', async () => {
    globalThis.fetch = adminFetch({ confirmed: false });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', query: 'foo' }));
    expect(res.status).toBe(403);
  });

  it('mesma conta com e-mail confirmado passa (200)', async () => {
    globalThis.fetch = adminFetch({ confirmed: true });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', query: 'foo' }));
    expect(res.status).toBe(200);
  });

  it('gateAiUsage: plano admin (cota 99999) só com e-mail confirmado', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/rpc/is_pro_active')) return ok(false);
      if (url.includes('/rpc/ai_usage_this_month')) return ok(0);
      return ok([]);
    });
    const { gateAiUsage } = await import('@/lib/api/security');
    const unconfirmed = await gateAiUsage({ userId: 'u', email: 'boss@x.com', emailConfirmed: false, feature: 'x' });
    const confirmed = await gateAiUsage({ userId: 'u', email: 'boss@x.com', emailConfirmed: true, feature: 'x' });
    const omitted = await gateAiUsage({ userId: 'u', email: 'boss@x.com', feature: 'x' });
    expect('plan' in unconfirmed && unconfirmed.plan).not.toBe('admin');
    expect('plan' in omitted && omitted.plan).not.toBe('admin');
    expect('plan' in confirmed && confirmed.plan).toBe('admin');
  });
});

// ─── M-3: /api/log-error não aceita user_id do corpo ─────────────────────────
describe('/api/log-error: identidade só pelo Bearer', () => {
  const VICTIM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  function logFetch(rows: unknown[], authOk: boolean) {
    return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/rpc/check_rate_limit')) return ok({ allowed: true });
      if (url.includes('/auth/v1/user')) {
        return authOk ? ok({ id: 'real-user', email: 'me@x.com', email_confirmed_at: CONFIRMED }) : ok({}, 401);
      }
      if (url.includes('/rest/v1/errors')) {
        rows.push(JSON.parse(String(init?.body)));
        return ok([], 201);
      }
      return ok([]);
    });
  }

  it('sem Bearer, user_id do corpo é descartado (linha anônima)', async () => {
    const rows: Array<{ user_id: string | null }> = [];
    globalThis.fetch = logFetch(rows, false);
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(jsonReq('https://app.test/api/log-error', { type: 'x', msg: 'oops', user_id: VICTIM }));
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBeNull();
  });

  it('com Bearer válido, grava o id VERIFICADO e ignora o do corpo', async () => {
    const rows: Array<{ user_id: string | null }> = [];
    globalThis.fetch = logFetch(rows, true);
    const { POST } = await import('@/app/api/log-error/route');
    const res = await POST(
      jsonReq('https://app.test/api/log-error', { type: 'x', msg: 'oops', user_id: VICTIM }, { authorization: 'Bearer tok' }),
    );
    expect(res.status).toBe(200);
    expect(rows[0].user_id).toBe('real-user');
  });
});

// ─── M-4: promovido não mexe em OUTRO admin ─────────────────────────────────
describe('/api/admin/users: ações contra conta privilegiada exigem admin da allowlist', () => {
  function tierFetch(caller: { email: string; confirmed: boolean; portal: boolean }, target: { portal: boolean; role?: string }, calls: string[]) {
    return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method || 'GET'} ${url}`);
      if (url.includes('/auth/v1/user')) {
        return ok({ id: 'caller', email: caller.email, email_confirmed_at: caller.confirmed ? CONFIRMED : null });
      }
      if (url.includes('/rpc/check_rate_limit')) return ok({ allowed: true });
      if (url.includes('/auth/v1/admin/users/')) return ok({ id: 'target', email: 'new@x.com' });
      if (url.includes('/rest/v1/profiles?id=eq.caller')) return ok([{ portal_access: caller.portal, role: 'cliente' }]);
      if (url.includes('/rest/v1/profiles?id=eq.target')) {
        if (init?.method === 'PATCH') return ok([{ id: 'target' }]);
        return ok([{ portal_access: target.portal, role: target.role ?? 'cliente', email: 'admin2@x.com' }]);
      }
      if (url.includes('/rest/v1/audit_log')) return ok([], 201);
      return ok([]);
    });
  }

  it('operador promovido (fora da allowlist) NÃO troca o login de outro admin → 403, sem PUT no GoTrue', async () => {
    const calls: string[] = [];
    globalThis.fetch = tierFetch({ email: 'op@x.com', confirmed: true, portal: true }, { portal: true }, calls);
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', action: 'set_email', userId: 'target', email: 'evil@x.com' }));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.startsWith('PUT') && c.includes('/auth/v1/admin/users/'))).toBe(false);
  });

  it('operador promovido NÃO revoga outro admin nem se auto-edita por essas ações', async () => {
    const calls: string[] = [];
    globalThis.fetch = tierFetch({ email: 'op@x.com', confirmed: true, portal: true }, { portal: false, role: 'admin' }, calls);
    const { POST } = await import('@/app/api/admin/users/route');
    const revoke = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', action: 'revoke', userId: 'target' }));
    expect(revoke.status).toBe(403);
    const selfRole = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', action: 'set_role', userId: 'caller', roleKey: 'pintor' }));
    expect(selfRole.status).toBe(403);
  });

  it('operador promovido segue podendo agir sobre conta COMUM (set_name)', async () => {
    const calls: string[] = [];
    globalThis.fetch = tierFetch({ email: 'op@x.com', confirmed: true, portal: true }, { portal: false }, calls);
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', action: 'set_name', userId: 'target', name: 'Novo Nome' }));
    expect(res.status).toBe(200);
  });

  it('admin da allowlist (confirmado) pode trocar o login de outro admin', async () => {
    const calls: string[] = [];
    globalThis.fetch = tierFetch({ email: 'boss@x.com', confirmed: true, portal: true }, { portal: true }, calls);
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', action: 'set_email', userId: 'target', email: 'novo@x.com' }));
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.startsWith('PUT') && c.includes('/auth/v1/admin/users/'))).toBe(true);
  });

  it('delete_user com a consulta do alvo FALHANDO não exclui (fail closed)', async () => {
    let deleted = false;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/auth/v1/user')) return ok({ id: 'caller', email: 'boss@x.com', email_confirmed_at: CONFIRMED });
      if (url.includes('/rpc/check_rate_limit')) return ok({ allowed: true });
      if (url.includes('/rest/v1/profiles?id=eq.caller')) return ok([{ portal_access: true, role: 'admin' }]);
      if (url.includes('/rest/v1/profiles?id=eq.target')) return ok('boom', 500);
      if (init?.method === 'DELETE') { deleted = true; return ok({}); }
      return ok([]);
    });
    const { POST } = await import('@/app/api/admin/users/route');
    const res = await POST(jsonReq('https://app.test/api/admin/users', { accessToken: 't', action: 'delete_user', userId: 'target' }));
    expect(res.status).toBe(502);
    expect(deleted).toBe(false);
  });
});

// ─── L-6: cookie de sessão só de chamada do próprio site ─────────────────────
describe('/api/auth/set-session-cookie: só JSON do próprio site', () => {
  it('text/plain (sem preflight) → 403; Origin de outro site → 403', async () => {
    const { POST } = await import('@/app/api/auth/set-session-cookie/route');
    const plain = new Request('https://app.test/api/auth/set-session-cookie', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ accessToken: 'a.b.c' }),
    }) as unknown as NextRequest;
    expect((await POST(plain)).status).toBe(403);
    const cross = new Request('https://app.test/api/auth/set-session-cookie', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ accessToken: 'a.b.c' }),
    }) as unknown as NextRequest;
    expect((await POST(cross)).status).toBe(403);
  });

  it('JSON do próprio site com token válido grava o cookie httpOnly', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/auth/v1/user')) return ok({ id: 'u1', email: 'me@x.com', email_confirmed_at: CONFIRMED });
      if (url.includes('/rpc/check_rate_limit')) return ok({ allowed: true });
      return ok([]);
    });
    const { POST } = await import('@/app/api/auth/set-session-cookie/route');
    const res = await POST(jsonReq('https://app.test/api/auth/set-session-cookie', { accessToken: 'a.b.c' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') || '').toMatch(/sb-session-token=a\.b\.c.*HttpOnly/i);
  });
});

// ─── cliente: allowlist de colunas do perfil ─────────────────────────────────
describe('pickProfilePatch (lib/services/profile.ts)', () => {
  it('descarta colunas privilegiadas e user_type=admin', async () => {
    const { pickProfilePatch } = await import('@/lib/services/profile');
    const dirty = {
      name: 'Zé', user_type: 'admin', is_pro: true, role: 'admin', portal_access: true,
      pro_expires_at: '2099-01-01', rating_avg: 5, email: 'x@y.com',
    } as unknown as Parameters<typeof pickProfilePatch>[0];
    const out = pickProfilePatch(dirty) as Record<string, unknown>;
    expect(out).toEqual({ name: 'Zé' });
    expect(pickProfilePatch({ user_type: 'pintor', city: 'SP' } as never)).toEqual({ user_type: 'pintor', city: 'SP' });
  });
});

// ─── guardas de fonte: o que o código NÃO pode voltar a fazer ────────────────
describe('guardas de fonte (auditoria 2026-09-11)', () => {
  const root = path.resolve(__dirname, '..', '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

  it('nenhuma rota admin chama ensurePortalAdmin/isPortalAdminUser sem emailConfirmed', () => {
    const dir = path.join(root, 'app', 'api');
    const files: string[] = [];
    const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.name === 'route.ts') files.push(p);
    });
    walk(dir);
    const bad: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(ensurePortalAdmin|isPortalAdminUser)\(\{[^}]*\}/g)) {
        if (!m[0].includes('emailConfirmed')) bad.push(`${path.relative(root, f)}: ${m[0]}`);
      }
      // gateAiUsage que informa `email` tem que informar `emailConfirmed`
      // (sem e-mail nenhum o plano admin já não entra — fail closed).
      for (const m of src.matchAll(/gateAiUsage\(\{[^}]*\}/g)) {
        if (m[0].includes('email:') && !m[0].includes('emailConfirmed')) bad.push(`${path.relative(root, f)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('o app não forja mensagem type=store nem manda bonus_points/status na indicação', () => {
    expect(read('app/chat/[convId]/ChatConversation.tsx')).not.toMatch(/type:\s*'store'/);
    const signup = read('lib/services/signup.ts');
    const ins = signup.slice(signup.indexOf("from('referrals').insert("));
    expect(ins.slice(0, 300)).not.toMatch(/bonus_points|status:/);
  });

  it('perfis de OUTRAS pessoas vêm de profiles_public (stories, reviews, orçamento)', () => {
    expect(read('lib/services/stories.ts')).toMatch(/from\('profiles_public'\)/);
    expect(read('lib/services/reviews.ts')).not.toMatch(/select\([^)]*profiles!painter_id/);
    expect(read('app/orcamentos/[id]/page.tsx')).toMatch(/quote_party_contact/);
  });

  it('portal: href de coluna escrita pelo usuário passa por hrefSeguro', () => {
    const jsx = read('public/portal/app.jsx');
    expect(jsx).not.toMatch(/href=\{item\.image_url\}/);
    expect(jsx).not.toMatch(/href=\{o\.receipt_url\}/);
    expect(jsx).toMatch(/const hrefSeguro = /);
  });

  it('migration da auditoria existe e cobre os blocos críticos', () => {
    const sql = read('../migrations/2026-09-11-auditoria-autorizacao.sql');
    for (const needle of [
      'DROP POLICY IF EXISTS "Profiles are viewable by everyone"',
      'CREATE POLICY profiles_select_own_or_admin',
      'security_invoker = false',
      'CREATE TRIGGER zz_protect_profile_columns',
      'DROP TRIGGER IF EXISTS trg_sync_role_from_user_type',
      'ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY',
      "COALESCE(type, 'text') <> 'store'",
      'zz_messages_guard_update',
      'zz_quotes_guard',
      'zz_orders_guard_update',
      'zz_posts_guard_update',
      "'upsert_invoice', 'check_rate_limit'",
      'quote_party_contact',
      'register_push_token',
      'referrals_one_per_referred',
    ]) {
      expect(sql, needle).toContain(needle);
    }
    // get_feed_v2: identidade é auth.uid(); o parâmetro do cliente é ignorado.
    const feed = sql.slice(sql.indexOf('FUNCTION public.get_feed_v2('));
    const body = feed.slice(feed.indexOf('AS $$'), feed.indexOf('$$;'));
    expect(body).not.toMatch(/\bp_user_id\b/);
  });
});

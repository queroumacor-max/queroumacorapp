// Rotas admin aceitam quem foi PROMOVIDO no portal (2026-09-10, decisão do
// usuário: "habilite pelo promover"). Antes toda rota exigia o e-mail em
// ADMIN_EMAILS; o "Promover" só gravava portal_access, e quem era promovido
// abria as telas mas levava 403 ao enviar WhatsApp. A regra passa a ser a
// mesma do guard RSC: allowlist OU portal_access OU role='admin'.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceError } from '@/lib/api/security';
import { __resetAdminEmailsCacheForTests } from '@/lib/api/admin-config';
import {
  ensurePortalAdmin,
  isPortalAdminUser,
  _resetPortalAdminCache,
} from '@/lib/api/_services/_admin-helpers';

const fetchMock = vi.fn();

function perfil(row: Record<string, unknown> | null, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: async () => (row ? [row] : []),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.ADMIN_EMAILS = 'dona@calicolors.com.br';
  process.env.SUPABASE_URL = 'https://abc.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  __resetAdminEmailsCacheForTests();
  _resetPortalAdminCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ADMIN_EMAILS;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe('ensurePortalAdmin', () => {
  it('e-mail na allowlist passa SEM consultar o banco', async () => {
    await expect(ensurePortalAdmin({ callerId: 'u1', email: 'Dona@calicolors.com.br', emailConfirmed: true })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('promovido no portal (portal_access=true) passa', async () => {
    perfil({ portal_access: true, role: 'pintor' });
    await expect(ensurePortalAdmin({ callerId: 'u2', email: 'joao@gmail.com' })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/v1/profiles?id=eq.u2&select=portal_access,role');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer service-key');
  });
  it("role='admin' também passa", async () => {
    perfil({ portal_access: false, role: 'admin' });
    await expect(ensurePortalAdmin({ callerId: 'u3', email: 'x@y.com' })).resolves.toBeUndefined();
  });
  it('sem allowlist e sem promoção → 403 dizendo os DOIS jeitos de liberar', async () => {
    perfil({ portal_access: false, role: 'pintor' });
    const err = await ensurePortalAdmin({ callerId: 'u4', email: 'joao@gmail.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('joao@gmail.com');
    expect(err.message).toContain('Promover');
    expect(err.message).toContain('ADMIN_EMAILS');
  });
  it('perfil inexistente → 403', async () => {
    perfil(null);
    await expect(ensurePortalAdmin({ callerId: 'u5', email: 'x@y.com' })).rejects.toMatchObject({ status: 403 });
  });
  it('sem callerId só a allowlist vale (não consulta com id vazio)', async () => {
    await expect(ensurePortalAdmin({ callerId: '', email: 'x@y.com' })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('banco respondeu erro → 502 (não 403: não é "não autorizado", é "não deu pra saber")', async () => {
    perfil(null, 500);
    await expect(ensurePortalAdmin({ callerId: 'u6', email: 'x@y.com' })).rejects.toMatchObject({ status: 502 });
  });
  it('fetch rejeitou (rede fora / timeout) → 502 com ServiceError, não erro cru', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    const err = await ensurePortalAdmin({ callerId: 'u9', email: 'x@y.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.status).toBe(502);
    expect(err.message).toContain('tempo esgotado');
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(ensurePortalAdmin({ callerId: 'u10', email: 'x@y.com' })).rejects.toMatchObject({ status: 502 });
  });
  it('sem chave de serviço configurada, cai na allowlist sozinha', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(ensurePortalAdmin({ callerId: 'u7', email: 'x@y.com' })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cache de 60s por caller: segunda chamada não vai ao banco', async () => {
    perfil({ portal_access: true });
    expect(await isPortalAdminUser({ callerId: 'u8', email: 'x@y.com', emailConfirmed: true })).toBe(true);
    expect(await isPortalAdminUser({ callerId: 'u8', email: 'x@y.com', emailConfirmed: true })).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('toda rota admin usa ensurePortalAdmin (nunca só a allowlist)', () => {
  const raiz = join(process.cwd(), 'app/api');
  const rotas: string[] = [];
  const andar = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) andar(p);
      else if (n === 'route.ts') rotas.push(p);
    }
  };
  andar(raiz);
  it('nenhuma rota chama ensureAdminEmail/isAdminEmail direto', () => {
    const culpadas = rotas.filter((p) => /\b(ensureAdminEmail|isAdminEmail)\(/.test(readFileSync(p, 'utf8')));
    expect(culpadas.map((p) => p.replace(raiz, ''))).toEqual([]);
  });
  it('as rotas que autenticam admin passam pelo helper', () => {
    const comToken = rotas.filter((p) => readFileSync(p, 'utf8').includes('verifyAdminToken('));
    expect(comToken.length).toBeGreaterThanOrEqual(11);
    const semHelper = comToken.filter((p) => !/ensurePortalAdmin\(|isPortalAdminUser\(/.test(readFileSync(p, 'utf8')));
    expect(semHelper.map((p) => p.replace(raiz, ''))).toEqual([]);
  });
});

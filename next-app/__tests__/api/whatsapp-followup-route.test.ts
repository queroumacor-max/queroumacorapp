// Testes de POST /api/whatsapp/followup — auditoria de webhooks 2026-09-17.
//
// Achado: a rota não tinha rate limit nenhum. Quem já conhece o segredo do
// cron (`WHATSAPP_WEBHOOK_URL_SECRET`, o MESMO do webhook) ou é admin do
// portal podia disparar a varredura em rajada — e como ela lê o banco,
// decide e SÓ DEPOIS marca `followed_up_at`/`followup_at`, rajada
// suficientemente rápida contornaria a trava por isolate (que só protege
// concorrência dentro do MESMO isolate) e mandaria a mesma cobrança/
// reengajamento pro cliente várias vezes. Este arquivo prova que a rota
// agora nega a 5ª chamada de verdade dentro da janela.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const URL_SECRET = 'segredo-de-url-para-teste';
const SUPA_URL = 'https://fake.supabase.co';

async function chamarPost(qs: string, body: unknown = {}) {
  const mod = await import('@/app/api/whatsapp/followup/route');
  const req = new NextRequest(`https://exemplo.com/api/whatsapp/followup?${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

beforeEach(() => {
  vi.resetModules();
  process.env.WHATSAPP_WEBHOOK_URL_SECRET = URL_SECRET;
  process.env.SUPABASE_URL = SUPA_URL;
  process.env.SUPABASE_SERVICE_ROLE = 'service-key-teste';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.WHATSAPP_WEBHOOK_URL_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** RPC `check_rate_limit` de verdade (via REST), controlável por teste. */
function stubBancoComContador(opts: { permiteAteEnvio: boolean }) {
  let chamadasDeLimite = 0;
  const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/rest/v1/rpc/check_rate_limit')) {
      chamadasDeLimite++;
      const allowed = opts.permiteAteEnvio ? chamadasDeLimite <= 4 : false;
      return new Response(
        JSON.stringify({ allowed, count: chamadasDeLimite, limit: 4, retry_after_seconds: 60 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    // whatsapp_ai_config: liga o follow-up mas fora do horário comercial —
    // sem `podeEnviar`, a varredura roda (ran:true) mas não manda nada, o
    // que já basta pra provar que o rate limit é conferido ANTES da
    // varredura (a chamada ao RPC acontece de qualquer forma).
    if (u.includes('/rest/v1/whatsapp_ai_config') && (init?.method || 'GET') === 'GET') {
      return new Response(
        JSON.stringify([{ hours: '0-1', followup_on: true, followup_hours: 3, nudge_hours: 1 }]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return { fetchSpy, contarChamadasDeLimite: () => chamadasDeLimite };
}

describe('POST /api/whatsapp/followup — rate limit da varredura de verdade', () => {
  it('a 5ª chamada (não-dryRun) dentro da janela leva 429', async () => {
    stubBancoComContador({ permiteAteEnvio: true });
    for (let i = 0; i < 4; i++) {
      const res = await chamarPost(`token=${URL_SECRET}`);
      expect(res.status).toBe(200);
    }
    const quinta = await chamarPost(`token=${URL_SECRET}`);
    expect(quinta.status).toBe(429);
  });

  it('dryRun NUNCA é limitado, mesmo depois de estourar o limite', async () => {
    stubBancoComContador({ permiteAteEnvio: false }); // RPC sempre nega
    const res = await chamarPost(`token=${URL_SECRET}`, { dryRun: true });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ran: boolean };
    expect(json.ran).toBe(true);
  });

  it('token de cron errado E sem sessão de admin → 401, nunca chega no rate limit', async () => {
    const { contarChamadasDeLimite } = stubBancoComContador({ permiteAteEnvio: true });
    const res = await chamarPost('token=token-errado');
    expect(res.status).toBe(401);
    expect(contarChamadasDeLimite()).toBe(0);
  });
});

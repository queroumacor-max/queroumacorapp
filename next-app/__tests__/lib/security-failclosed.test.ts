// security-failclosed.test.ts — CRIT-5 do audit 2026-06-12.
//
// Confirma que `requirePro` e `gateAiUsage` em `lib/api/security.ts` viram
// FAIL-CLOSED em produção quando `SUPABASE_SERVICE_ROLE_KEY` está ausente,
// e que `assertProductionEnvs` throws em prod sem envs críticas. Antes
// dessa mudança, misconfig de env em prod libera todos os features PRO +
// drain de quota IA — exatamente o que esses testes blindam.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Salva env vars que vamos mutar pra restaurar no final de cada teste.
const ENV_KEYS = [
  'NODE_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

type EnvSnapshot = Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (process.env as any)[k];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.env as any)[k] = snap[k];
    }
  }
}

function clearServiceKeys(): void {
  delete process.env.SUPABASE_SERVICE_ROLE;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// `NODE_ENV` em Node 20+ é definido como readonly no tipo NodeJS.ProcessEnv,
// mas em runtime é mutável. Cast pra any pra contornar o type check.
function setNodeEnv(value: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.env as any).NODE_ENV = value;
}

// Silencia console.warn/error nos testes pra não poluir output (esses testes
// disparam logs intencionalmente). Restaurado no afterEach via restoreAllMocks.
function silenceConsole(): void {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}

// ─── requirePro / gateAiUsage ───────────────────────────────────────────────
// Esses dois precisam ser importados DEPOIS da configuração de env, porque
// o módulo `security.ts` chama `assertProductionEnvs()` no top-level. Em
// teste dev (NODE_ENV !== 'production') o assert é no-op, então import é
// safe — mas mantemos o pattern pra consistência.

// Em todos os testes que importam `security.ts` em modo "production", as
// envs `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` +
// `SUPABASE_SERVICE_ROLE_KEY` precisam estar setadas (`assertProductionEnvs`
// roda no top-level). Os testes que validam ausência de service key:
//   - setam `NEXT_PUBLIC_*` (pra passar o env-check no import);
//   - mas removem as 3 variantes da service key (SUPABASE_SERVICE_ROLE /
//     _KEY / _ROLE_KEY) — `getServiceKey()` é chamado em runtime dentro
//     da função, então retorna undefined.
// Isso é coerente com a realidade: `NEXT_PUBLIC_SUPABASE_URL` está no env
// porque o frontend usa, mas a service-role key sumiu por misconfig.

function setupProdEnvForServiceKeyTest(): void {
  // Necessário pra assertProductionEnvs() passar no top-level do import.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-public-test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-pass-env-check';
  // Necessário pra `getSupabaseUrl()` (chamado dentro das funções) não throw.
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-test';
}

describe('requirePro — fail-closed em prod sem service key', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    setupProdEnvForServiceKeyTest();
    silenceConsole();
    // Garante import "fresh" em cada teste (pra que o top-level
    // assertProductionEnvs avalie o NODE_ENV setado pelo teste).
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it('NODE_ENV=production + service key ausente → { pro: false, error: "service_unavailable" }', async () => {
    setNodeEnv('production');
    const { requirePro } = await import('../../lib/api/security');
    // Agora sim apaga a service key (depois do import — env-check já passou).
    clearServiceKeys();
    const result = await requirePro('user-123');
    expect(result.pro).toBe(false);
    expect(result.checked).toBe(false);
    expect(result.error).toBe('service_unavailable');
  });

  it('NODE_ENV=development + service key ausente → fail-open ({ pro: true, checked: false })', async () => {
    setNodeEnv('development');
    const { requirePro } = await import('../../lib/api/security');
    clearServiceKeys();
    const result = await requirePro('user-123');
    expect(result.pro).toBe(true);
    expect(result.checked).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('userId vazio retorna fail-open mesmo em prod (gateProAI já barrou)', async () => {
    setNodeEnv('production');
    const { requirePro } = await import('../../lib/api/security');
    clearServiceKeys();
    const result = await requirePro(null);
    expect(result.pro).toBe(true);
    expect(result.checked).toBe(false);
  });
});

describe('gateAiUsage — fail-closed em prod sem service key', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    setupProdEnvForServiceKeyTest();
    silenceConsole();
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it('NODE_ENV=production + service key ausente → 503 NextResponse', async () => {
    setNodeEnv('production');
    const { gateAiUsage } = await import('../../lib/api/security');
    clearServiceKeys();
    const result = await gateAiUsage({
      userId: 'user-123',
      email: 'x@y.com',
      feature: 'chat-ai',
    });
    // É um NextResponse, não o objeto { allowed: true }.
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('service_unavailable');
  });

  it('NODE_ENV=development + service key ausente → allowed ({ plan: "free" })', async () => {
    setNodeEnv('development');
    const { gateAiUsage } = await import('../../lib/api/security');
    clearServiceKeys();
    const result = await gateAiUsage({
      userId: 'user-123',
      email: 'x@y.com',
      feature: 'chat-ai',
    });
    // Em dev é o objeto inline, não NextResponse.
    expect(result).not.toBeInstanceOf(Response);
    const obj = result as { allowed: true; plan: string; used: number; limit: number };
    expect(obj.allowed).toBe(true);
    expect(obj.plan).toBe('free');
    expect(obj.limit).toBe(30);
  });

  it('userId vazio → libera ({ plan: "free" }) mesmo em prod (defesa em profundidade)', async () => {
    setNodeEnv('production');
    const { gateAiUsage } = await import('../../lib/api/security');
    clearServiceKeys();
    const result = await gateAiUsage({
      userId: undefined,
      email: null,
      feature: 'chat-ai',
    });
    expect(result).not.toBeInstanceOf(Response);
    const obj = result as { allowed: true; plan: string };
    expect(obj.allowed).toBe(true);
    expect(obj.plan).toBe('free');
  });
});

// ─── assertProductionEnvs ───────────────────────────────────────────────────

describe('assertProductionEnvs', () => {
  let envSnap: EnvSnapshot;

  beforeEach(() => {
    envSnap = snapshotEnv();
    silenceConsole();
  });

  afterEach(() => {
    restoreEnv(envSnap);
    vi.restoreAllMocks();
  });

  it('NODE_ENV=production + env crítica faltando → throws', async () => {
    setNodeEnv('production');
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { assertProductionEnvs } = await import('../../lib/api/env-check');
    expect(() => assertProductionEnvs({ force: true })).toThrow(
      /Variáveis obrigatórias ausentes em produção/
    );
  });

  it('NODE_ENV=development + env crítica faltando → no-op (não throws)', async () => {
    setNodeEnv('development');
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { assertProductionEnvs } = await import('../../lib/api/env-check');
    expect(() => assertProductionEnvs()).not.toThrow();
  });

  it('NODE_ENV=production + todas as envs setadas → no-op', async () => {
    setNodeEnv('production');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';

    const { assertProductionEnvs } = await import('../../lib/api/env-check');
    expect(() => assertProductionEnvs()).not.toThrow();
  });

  it('mensagem do erro inclui o nome da env ausente', async () => {
    setNodeEnv('production');
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { assertProductionEnvs } = await import('../../lib/api/env-check');
    expect(() => assertProductionEnvs({ force: true })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

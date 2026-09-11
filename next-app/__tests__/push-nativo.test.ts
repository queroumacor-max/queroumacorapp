// Auditoria de notificação (2026-09-05): permissão concedida no aparelho e o
// push NÃO chegava, mensagem de um usuário pro outro.
//
// A corrente tem 6 elos — mensagem → trg_notify_on_message → `notifications`
// → trg_dispatch_push_notification → /api/push-notify → FCM → aparelho — e o
// que estava rompido era o ÚLTIMO pré-requisito: a tabela `push_device_tokens`
// nunca recebia o token deste aparelho.
//
// Causa: o card de opt-in passou a ler a permissão do SO (PR #188) e, com
// isso, escondia o botão "Ativar" quando ela já estava concedida — e esse
// botão era o ÚNICO lugar que gravava o token. O card dizia "Ativadas neste
// aparelho" com a tabela vazia; o servidor mandava o push pra ninguém.
//
// Estes testes travam o contrato que fecha isso: garantir sem prompt, seguir
// a rotação, e NUNCA pedir permissão sozinho no boot.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const permission = vi.fn();
const register = vi.fn();
const isAvailable = vi.fn();
const upsert = vi.fn();

vi.mock('@/lib/native', () => ({
  native: {
    push: {
      isAvailable: () => isAvailable(),
      permission: () => permission(),
      register: () => register(),
    },
    platform: () => 'android',
  },
}));
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    // RPC `register_push_token` ausente (migration não rodou) → cai no upsert.
    rpc: () => Promise.resolve({ error: { message: 'function not found' } }),
    from: () => ({ upsert: (...a: unknown[]) => upsert(...a) }),
  }),
}));

import {
  ensureDeviceToken,
  registerDeviceToken,
  saveDeviceToken,
} from '@/lib/services/pushTokens';

beforeEach(() => {
  vi.clearAllMocks();
  isAvailable.mockReturnValue(true);
  upsert.mockResolvedValue({ error: null });
});

describe('ensureDeviceToken: o token existe sem abrir prompt', () => {
  it('com permissão JÁ concedida, grava o token', async () => {
    // O caso do incidente: permissão dada, tabela vazia. Se isto não gravar,
    // o /api/push-notify não tem pra quem mandar e o push some em silêncio.
    permission.mockResolvedValue('granted');
    register.mockResolvedValue('tok-abc');

    const r = await ensureDeviceToken('u1');

    expect(r.ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [linha, opts] = upsert.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(linha.user_id).toBe('u1');
    expect(linha.token).toBe('tok-abc');
    expect(opts).toEqual({ onConflict: 'token' });
  });

  it('em "prompt" NÃO pede permissão — boot não sequestra a decisão', async () => {
    // Pedir push no boot, sem a pessoa ter pedido, é o caminho mais curto pra
    // ela negar pra sempre. Quem pergunta é o card, no gesto dela.
    permission.mockResolvedValue('prompt');

    const r = await ensureDeviceToken('u1');

    expect(register).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: false, reason: 'denied' });
  });

  it('com permissão negada, não tenta nada', async () => {
    permission.mockResolvedValue('denied');
    expect((await ensureDeviceToken('u1')).ok).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('fora da casca nativa é no-op', async () => {
    isAvailable.mockReturnValue(false);
    expect(await ensureDeviceToken('u1')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
    expect(permission).not.toHaveBeenCalled();
  });

  it('sem usuário não grava token órfão', async () => {
    expect((await ensureDeviceToken('')).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('saveDeviceToken: a rotação do token é seguida', () => {
  it('grava o token novo sem passar por permissão', async () => {
    // `tokenReceived` chega por evento; exigir permissão aqui perderia a
    // rotação e a linha do banco viraria lixo apontando pra device morto.
    const r = await saveDeviceToken('u1', 'tok-novo');

    expect(r.ok).toBe(true);
    expect(permission).not.toHaveBeenCalled();
    expect((upsert.mock.calls[0][0] as Record<string, unknown>).token).toBe(
      'tok-novo',
    );
  });

  it('erro do banco não lança — best-effort', async () => {
    upsert.mockResolvedValue({ error: { message: 'rls' } });
    await expect(saveDeviceToken('u1', 't')).resolves.toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('token vazio não vira linha', async () => {
    expect((await saveDeviceToken('u1', '')).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('registerDeviceToken: o caminho do BOTÃO ainda pede permissão', () => {
  it('chama register (que abre o prompt) e grava', async () => {
    register.mockResolvedValue('tok-1');
    const r = await registerDeviceToken('u1');
    expect(register).toHaveBeenCalled();
    expect(r.ok).toBe(true);
  });

  it('recusa do sistema vira "denied", sem gravar', async () => {
    register.mockResolvedValue(null);
    expect(await registerDeviceToken('u1')).toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

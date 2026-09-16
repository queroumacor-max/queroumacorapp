// Teste adversarial: teto diário do responder automático de WhatsApp
// (whatsapp-ai-runner.ts) tem que reservar o slot ATOMICAMENTE, ANTES de
// chamar a IA — não depois de enviar. Auditoria de negócio 2026-09-16
// (achado: TOCTOU — `bumpReplyCount` antigo lia o contador ANTES da IA e
// só gravava DEPOIS do envio, usando um `state` já desatualizado).
//
// Este teste prova duas coisas que o SQL sozinho não prova (aquele fica
// coberto em businessLogicSecurityAudit.test.ts):
//   1. a ORDEM real das chamadas: a reserva (rpc/bump_wa_ai_reply_count)
//      acontece ANTES de `generateAiReply` ser invocada — nunca depois.
//   2. quando a reserva nega (`allowed:false`), o runner NUNCA chama a IA
//      nem manda mensagem nenhuma — o teto bloqueia de verdade, não é só
//      decorativo.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api/security', () => ({
  getServiceKey: () => 'svc-test-key',
  getSupabaseUrl: () => 'https://example.supabase.co',
}));

const sendWhatsAppTextMock = vi.fn(async (..._args: unknown[]) => ({ messageId: 'wamid.test' }));
const persistWhatsAppMessageMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../../lib/api/_services/whatsapp', () => ({
  sendWhatsAppText: sendWhatsAppTextMock,
  persistWhatsAppMessage: persistWhatsAppMessageMock,
}));

const generateAiReplyMock = vi.fn(async (..._args: unknown[]) => ({
  reply: 'Oi! Como posso ajudar?',
  escalate: false,
}));
vi.mock('../../lib/api/_services/whatsapp-ai', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api/_services/whatsapp-ai')>(
    '../../lib/api/_services/whatsapp-ai',
  );
  return {
    ...actual,
    generateAiReply: generateAiReplyMock,
    isAiConfigured: () => true,
  };
});

/** Ordem em que os fetches acontecem, pra provar reserva-antes-de-IA. */
let callOrder: string[];
let reserveAllowed: boolean;

function jsonRes(body: unknown, ok = true): Response {
  return {
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function installFetchRouter(): void {
  callOrder = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('rpc/bump_wa_ai_reply_count')) {
      callOrder.push('reserve');
      return jsonRes({ allowed: reserveAllowed, count: reserveAllowed ? 1 : 31 });
    }
    if (url.includes('whatsapp_ai_state?wa_id=eq')) {
      // isAiEnabledFor: linha própria com enabled=true (não cai no default).
      return jsonRes([
        { wa_id: '5511999999999', enabled: true, replies_today: 0, replies_date: null, opted_out: false, away_at: null },
      ]);
    }
    if (url.includes('whatsapp_ai_config')) {
      // 0-24 pra não bloquear por horário comercial; away_on=false pra não
      // desviar pro fluxo de ausência.
      return jsonRes([{ hours: '0-24', default_on: true, away_on: false, away_text: null, prompt: null }]);
    }
    if (url.includes('whatsapp_ai_state?on_conflict=wa_id')) {
      // registrarDecisao/setAiEnabled — não relevantes pra este teste.
      return jsonRes({}, true);
    }
    if (url.includes('leads?phone=ilike')) {
      return jsonRes([]);
    }
    if (url.includes('whatsapp_messages')) {
      return jsonRes([]);
    }
    if (url.includes('portal_alerts')) {
      return jsonRes([]);
    }
    return jsonRes([]);
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  installFetchRouter();
});

describe('whatsapp-ai-runner — reserva atômica do teto diário', () => {
  it('reserva o slot ANTES de chamar generateAiReply (nunca depois)', async () => {
    reserveAllowed = true;
    const { maybeAutoReply } = await import('../../lib/api/_services/whatsapp-ai-runner');

    generateAiReplyMock.mockImplementationOnce(async () => {
      callOrder.push('generateAiReply');
      return { reply: 'Oi!', escalate: false };
    });

    const result = await maybeAutoReply({ waId: '5511999999999', text: 'Oi, tudo bem?' });

    expect(result.acted).toBe(true);
    expect(callOrder.indexOf('reserve')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('generateAiReply')).toBeGreaterThan(callOrder.indexOf('reserve'));
    expect(sendWhatsAppTextMock).toHaveBeenCalledTimes(1);
  });

  it('teto estourado (allowed:false) bloqueia de verdade — nunca chama a IA nem envia mensagem', async () => {
    reserveAllowed = false;
    const { maybeAutoReply } = await import('../../lib/api/_services/whatsapp-ai-runner');

    const result = await maybeAutoReply({ waId: '5511999999999', text: 'Oi, tudo bem?' });

    expect(result.acted).toBe(false);
    expect(result.why).toMatch(/teto diário/);
    expect(generateAiReplyMock).not.toHaveBeenCalled();
    expect(sendWhatsAppTextMock).not.toHaveBeenCalled();
  });
});

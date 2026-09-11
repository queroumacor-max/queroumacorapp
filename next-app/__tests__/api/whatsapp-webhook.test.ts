// Testes do route handler POST /api/whatsapp/webhook.
//
// Este arquivo nasceu de um incidente (2026-09-05): o webhook respondia
// **500** em produção. O log mostrava a mensagem já reconhecida
// ("msg de ... preview=\"oiii\"") e logo em seguida
// `TypeError: Illegal invocation: function called with incorrect `this``.
//
// A causa era `runAfterResponse` chamando `ctx.waitUntil` DESAMARRADO do
// `ctx` — o ExecutionContext do workerd é nativo e exige o `this` certo. E
// como o throw era síncrono, dentro do handler, ele derrubava a resposta em
// vez de ficar contido no trabalho de fundo.
//
// Os testes unitários de `runAfterResponse` cobrem o `this`; o que faltava —
// e é o que teria pego o 500 — é um teste NO NÍVEL DA ROTA: aconteça o que
// acontecer no processamento assíncrono, a Meta tem que receber 200. Se ela
// recebe erro, ela reenvia; e webhook que falha demais ela desativa.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const URL_SECRET = 'segredo-de-url-para-teste';
const WABA = '1320667299892030';
const PHONE = '1220273824510260';

const CF = Symbol.for('__cloudflare-request-context__');

// O runner da IA e a persistência batem no Supabase; aqui interessa só o
// contrato da rota, então ficam mockados. `persistWhatsAppMessage` é
// best-effort por design e o runner é o suspeito natural de lançar.
const persistMock = vi.fn(async () => true);
const autoReplyMock = vi.fn(async () => ({ acted: false, why: 'teste' }));

vi.mock('@/lib/api/_services/whatsapp-ai-runner', () => ({
  maybeAutoReply: (...args: unknown[]) => autoReplyMock(...(args as [])),
}));

function envelopeDeMensagem(texto = 'oiii') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE },
              contacts: [{ profile: { name: 'Cliente' }, wa_id: '5511988887777' }],
              messages: [
                {
                  from: '5511988887777',
                  id: 'wamid.teste',
                  timestamp: '1756100000',
                  type: 'text',
                  text: { body: texto },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function pedido(payload: unknown, token = URL_SECRET) {
  return new Request(`https://exemplo.com/api/whatsapp/webhook?token=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function chamarPost(req: Request) {
  const mod = await import('@/app/api/whatsapp/webhook/route');
  // O handler tipa como NextRequest, mas só usa `url` e `text()`.
  return mod.POST(req as never);
}

beforeEach(() => {
  vi.resetModules();
  persistMock.mockClear();
  autoReplyMock.mockClear();
  process.env.WHATSAPP_WEBHOOK_URL_SECRET = URL_SECRET;
  process.env.WHATSAPP_WABA_ID = WABA;
  process.env.WHATSAPP_PHONE_NUMBER_ID = PHONE;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CF];
  delete process.env.WHATSAPP_WEBHOOK_URL_SECRET;
  delete process.env.WHATSAPP_WABA_ID;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  vi.restoreAllMocks();
});

describe('POST /api/whatsapp/webhook', () => {
  it('mensagem válida → 200', async () => {
    const res = await chamarPost(pedido(envelopeDeMensagem()));
    expect(res.status).toBe(200);
  });

  // O incidente exato. Com o ctx nativo, um `waitUntil` chamado solto lança
  // Illegal invocation DENTRO do handler.
  it('200 mesmo com ctx.waitUntil nativo que exige o `this` certo', async () => {
    const ctx = {
      waitUntil(this: unknown, p: Promise<unknown>) {
        if (this !== ctx) {
          throw new TypeError(
            'Illegal invocation: function called with incorrect `this` reference',
          );
        }
        void p;
      },
    };
    (globalThis as Record<symbol, unknown>)[CF] = { env: process.env, ctx };

    const res = await chamarPost(pedido(envelopeDeMensagem()));
    expect(res.status).toBe(200);
  });

  it('200 mesmo se o waitUntil do runtime recusar o trabalho', async () => {
    (globalThis as Record<symbol, unknown>)[CF] = {
      env: process.env,
      ctx: {
        waitUntil() {
          throw new TypeError('Illegal invocation');
        },
      },
    };
    const res = await chamarPost(pedido(envelopeDeMensagem()));
    expect(res.status).toBe(200);
  });

  // A Meta reenvia o que não recebeu 200 e desativa webhook que falha
  // demais: um erro no trabalho de fundo não pode custar a resposta.
  it('200 mesmo se o atendimento automático lançar', async () => {
    autoReplyMock.mockRejectedValueOnce(new Error('IA explodiu'));
    const res = await chamarPost(pedido(envelopeDeMensagem()));
    expect(res.status).toBe(200);
  });

  it('evento que não é de mensagem → 200 e ignorado (não 403)', async () => {
    // 403 fazia a Meta REENVIAR pra sempre um evento que nunca íamos
    // processar. "Não me interessa" não é "não recebi".
    const statusDeTemplate = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA,
          changes: [
            {
              field: 'message_template_status_update',
              value: { event: 'APPROVED', message_template_name: 'followup' },
            },
          ],
        },
      ],
    };
    const res = await chamarPost(pedido(statusDeTemplate));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  // Antes da Wave 58 o envelope de status passava pela validação e era
  // descartado em silêncio — o portal registrava que a loja mandou e nunca
  // sabia se chegou.
  it('envelope de status → 200 (não pode ser recusado)', async () => {
    const statusEnv = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: PHONE },
                statuses: [
                  {
                    id: 'wamid.teste',
                    status: 'failed',
                    timestamp: '1757100000',
                    recipient_id: '16502701234',
                    errors: [{ code: 131026, title: 'Message undeliverable' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await chamarPost(pedido(statusEnv));
    expect(res.status).toBe(200);
  });

  it('token de URL errado → 403', async () => {
    const res = await chamarPost(pedido(envelopeDeMensagem(), 'token-errado'));
    expect(res.status).toBe(403);
  });

  it('envelope de outra conta → 403', async () => {
    const outro = envelopeDeMensagem();
    outro.entry[0].id = '999999999';
    const res = await chamarPost(pedido(outro));
    expect(res.status).toBe(403);
  });

  it('corpo que não é JSON → 403, sem lançar', async () => {
    const req = new Request(
      `https://exemplo.com/api/whatsapp/webhook?token=${URL_SECRET}`,
      { method: 'POST', body: 'isto não é json' }
    );
    const res = await chamarPost(req);
    expect(res.status).toBe(403);
  });
});

// ─── Status de entrega chega até o LEAD (2026-09-09) ────────────────────────
//
// O incidente: `failed` 131026 pousava em whatsapp_messages e o lead seguia
// "contactado". Aqui o contrato no nível da rota: o envelope de status
// dispara o PATCH no lead pelo wamid, e o `sent` num lead `novo` vira
// `contactado`. Se o vínculo ainda não pousou (corrida com a rota de envio),
// a rota tenta de novo uma vez.
describe('POST /api/whatsapp/webhook — status → lead', () => {
  const SUPA_URL = 'https://fake.supabase.co';

  function envelopeDeStatus(status: string) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: PHONE },
                statuses: [
                  { id: 'wamid.lead', status, timestamp: '1757100000', recipient_id: '5511988887777' },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  function resposta(status: number, json: unknown) {
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA_URL;
    process.env.SUPABASE_SERVICE_ROLE = 'service-key-teste';
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    vi.unstubAllGlobals();
  });

  it('sent → PATCH no lead pelo wamid e novo vira contactado', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/whatsapp_messages')) return resposta(204, {});
      if (url.includes('/rest/v1/leads?abordagem_message_id=eq.wamid.lead')) {
        return resposta(200, [{ id: 'lead-1', status: 'novo' }]);
      }
      if (url.includes('/rest/v1/leads?id=eq.lead-1')) return resposta(204, {});
      return resposta(404, {});
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await chamarPost(pedido(envelopeDeStatus('sent')));
    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      const flip = fetchSpy.mock.calls.find(([u]) => String(u).includes('/rest/v1/leads?id=eq.lead-1'));
      expect(flip).toBeTruthy();
      expect(JSON.parse((flip as unknown as [string, RequestInit])[1].body as string)).toEqual({ status: 'contactado' });
    });
  });

  it('vínculo ainda não pousou → tenta o lead de novo uma vez', async () => {
    vi.useFakeTimers();
    let vezes = 0;
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes('/rest/v1/whatsapp_messages')) return resposta(204, {});
      if (url.includes('/rest/v1/leads?abordagem_message_id=eq.wamid.lead')) {
        vezes += 1;
        return resposta(200, vezes === 1 ? [] : [{ id: 'lead-1', status: 'novo' }]);
      }
      if (url.includes('/rest/v1/leads?id=eq.lead-1')) return resposta(204, {});
      return resposta(404, {});
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await chamarPost(pedido(envelopeDeStatus('delivered')));
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(5000);
    vi.useRealTimers();
    expect(vezes).toBe(2);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/rest/v1/leads?id=eq.lead-1'))).toBe(true);
  });
});

// ─── Eco do celular vira 'out' com origem 'celular'; reação não acorda a IA ──
describe('POST /api/whatsapp/webhook — ecos e tipos sem conversa', () => {
  const SUPA_URL = 'https://fake.supabase.co';
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA_URL;
    process.env.SUPABASE_SERVICE_ROLE = 'service-key-teste';
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    vi.unstubAllGlobals();
  });

  function envelopeCom(field: string, value: Record<string, unknown>) {
    return {
      object: 'whatsapp_business_account',
      entry: [{ id: WABA, changes: [{ field, value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE }, ...value } }] }],
    };
  }

  it('smb_message_echoes → grava direction=out, origin=celular, sem IA', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await chamarPost(pedido(envelopeCom('smb_message_echoes', {
      message_echoes: [{ from: PHONE, to: '5511988887777', id: 'wamid.eco', timestamp: '1757100000', type: 'text', text: { body: 'Valorizamos muito o tempo de entrega' } }],
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    await vi.waitFor(() => {
      const grava = fetchSpy.mock.calls.find(([u]) => String(u).includes('/rest/v1/whatsapp_messages'));
      expect(grava).toBeTruthy();
      const row = JSON.parse(((grava as unknown as [string, RequestInit])[1].body as string));
      expect(row).toMatchObject({ direction: 'out', origin: 'celular', wa_id: '5511988887777', message_id: 'wamid.eco', body: 'Valorizamos muito o tempo de entrega' });
    });
    expect(autoReplyMock).not.toHaveBeenCalled();
  });

  it('reação → grava com o emoji e NÃO chama o atendimento automático', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const res = await chamarPost(pedido(envelopeCom('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.r', timestamp: '1757100000', type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } }],
    })));
    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      const grava = fetchSpy.mock.calls.find(([u]) => String(u).includes('/rest/v1/whatsapp_messages'));
      expect(grava).toBeTruthy();
      expect(JSON.parse(((grava as unknown as [string, RequestInit])[1].body as string))).toMatchObject({ direction: 'in', type: 'reaction', body: '👍' });
    });
    expect(autoReplyMock).not.toHaveBeenCalled();
  });
});

describe('auditoria 2026-09-11 — teto de corpo', () => {
  it('content-length acima de 2MB responde 413 sem ler o corpo', async () => {
    const req = new Request(`https://exemplo.com/api/whatsapp/webhook?token=${URL_SECRET}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) },
      body: '{}',
    });
    const res = await chamarPost(req);
    expect(res.status).toBe(413);
    expect(persistMock).not.toHaveBeenCalled();
  });
});

// Tests do service lib/api/_services/whatsapp.ts.
//
// O ENVIO passou pro Dualhook em 2026-09-05 (api.dualhook.com), porque o
// número em Coexistence é gerenciado pelo app Meta DELES — o access token do
// nosso app não tem permissão nesse phone_number_id. O contrato é o mesmo da
// Cloud API (path, corpo, forma do erro): muda a base e o Bearer.
//
// Sem rede: `fetch` é stubado via vi.stubGlobal. Env entra por
// `process.env` (fallback do getRuntimeEnv fora do edge — ver
// lib/api/env.ts).
//
// Cobertura:
//   normalizeBrPhone: máscaras BR, com/sem DDI, inválidos
//   buildTextPayload / buildTemplatePayload: shape exato do Graph
//   getWhatsAppConfig: 503 sem token; default do phone number id; override
//   sendWhatsAppText: happy path (URL + Bearer + payload), telefone
//     inválido 400, erro 131047 → 422, erro 190 → 502, network → 502
//   verifyMetaSignature: assinatura válida, corpo adulterado, header ausente
//   parseInboundMessages: envelope real da Meta, envelope de status (vazio)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildTemplatePayload,
  buildTextPayload,
  DEFAULT_PHONE_NUMBER_ID,
  DEFAULT_WABA_ID,
  DUALHOOK_API_BASE,
  GRAPH_API_VERSION,
  checkWebhookUrlSecret,
  getWebhookAuthMode,
  getWhatsAppConfig,
  classifyWebhookPayload,
  isExpectedWebhookPayload,
  isForaDaJanela24h,
  isWhatsAppConfigured,
  normalizeBrPhone,
  parseInboundMessages,
  persistWhatsAppMessage,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  verifyMetaSignature,
  filtroSoAvanca,
  parseEchoMessages,
  persistStatusDoLead,
  TIPOS_SEM_CONVERSA,
  vincularAbordagemAoLead,
} from '../../lib/api/_services/whatsapp';
import { ServiceError } from '../../lib/api/security';

const FAKE_TOKEN = 'EAAtest-token';

beforeEach(() => {
  process.env.DUALHOOK_API_KEY = FAKE_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
});

afterEach(() => {
  delete process.env.DUALHOOK_API_KEY;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_WEBHOOK_AUTH_MODE;
  vi.unstubAllGlobals();
});

// ─── normalizeBrPhone ───────────────────────────────────────────────────────

describe('normalizeBrPhone', () => {
  it('aceita celular com máscara e sem DDI', () => {
    expect(normalizeBrPhone('(11) 95976-5031')).toBe('5511959765031');
  });

  it('aceita celular já com DDI 55', () => {
    expect(normalizeBrPhone('5511959765031')).toBe('5511959765031');
  });

  it('aceita formato internacional com +', () => {
    expect(normalizeBrPhone('+55 11 95976-5031')).toBe('5511959765031');
  });

  it('aceita fixo (10 dígitos) prefixando 55', () => {
    expect(normalizeBrPhone('1133334444')).toBe('551133334444');
  });

  it('rejeita curto demais, vazio e não-numérico', () => {
    expect(normalizeBrPhone('959765031')).toBeNull();
    expect(normalizeBrPhone('')).toBeNull();
    expect(normalizeBrPhone('abc')).toBeNull();
  });

  it('rejeita comprimento inválido mesmo começando com 55', () => {
    expect(normalizeBrPhone('55119597650312345')).toBeNull();
  });
});

// ─── builders ───────────────────────────────────────────────────────────────

describe('payload builders', () => {
  it('buildTextPayload monta shape do Graph', () => {
    expect(buildTextPayload('5511959765031', 'olá')).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '5511959765031',
      type: 'text',
      text: { preview_url: false, body: 'olá' },
    });
  });

  it('buildTemplatePayload monta template com language e components', () => {
    const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Zé' }] }];
    const p = buildTemplatePayload('5511959765031', 'pedido_pronto', 'pt_BR', components);
    expect(p).toMatchObject({
      type: 'template',
      template: {
        name: 'pedido_pronto',
        language: { code: 'pt_BR' },
        components,
      },
    });
  });

  it('buildTemplatePayload omite components quando vazio', () => {
    const p = buildTemplatePayload('5511959765031', 'oi', 'pt_BR', []);
    expect((p.template as Record<string, unknown>).components).toBeUndefined();
  });
});

// ─── config ─────────────────────────────────────────────────────────────────

describe('getWhatsAppConfig', () => {
  it('throw ServiceError 503 sem DUALHOOK_API_KEY', () => {
    delete process.env.DUALHOOK_API_KEY;
    expect(isWhatsAppConfigured()).toBe(false);
    try {
      getWhatsAppConfig();
      expect.fail('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceError);
      expect((e as ServiceError).status).toBe(503);
    }
  });

  it('usa o phone number id default da Cali Colors', () => {
    expect(getWhatsAppConfig()).toEqual({
      token: FAKE_TOKEN,
      phoneNumberId: DEFAULT_PHONE_NUMBER_ID,
    });
  });

  it('env WHATSAPP_PHONE_NUMBER_ID sobrescreve o default', () => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = '999';
    expect(getWhatsAppConfig().phoneNumberId).toBe('999');
  });

  // Regressão 2026-09-05: os defaults apontavam pro registro ANTIGO do
  // número (cadastro direto da Cali Colors), e não pro emitido pela Meta
  // quando ele entrou em Coexistence via Dualhook. Sem as envs no painel, o
  // envio ia pra um phone_number_id que não é nosso e — pior — o webhook
  // recusava TODA entrega com 403, ou seja, silêncio total no portal.
  // Default errado não falha: ele mente. Por isso ficam travados aqui.
  it('os defaults são os IDs da conexão Dualhook, não os do registro antigo', () => {
    expect(DEFAULT_PHONE_NUMBER_ID).toBe('1220273824510260');
    expect(DEFAULT_WABA_ID).toBe('1320667299892030');
    expect(DEFAULT_PHONE_NUMBER_ID).not.toBe('109293361953640');
    expect(DEFAULT_WABA_ID).not.toBe('102067872689175');
  });
});

// ─── sendWhatsAppText ───────────────────────────────────────────────────────

function stubFetchOnce(status: number, json: unknown) {
  const spy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('sendWhatsAppText', () => {
  it('happy path: POST na URL certa com Bearer e payload de texto', async () => {
    const spy = stubFetchOnce(200, {
      messages: [{ id: 'wamid.abc' }],
      contacts: [{ wa_id: '5511959765031' }],
    });

    const res = await sendWhatsAppText({ to: '(11) 95976-5031', body: 'oi!' });
    expect(res).toEqual({ messageId: 'wamid.abc', waId: '5511959765031' });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${DUALHOOK_API_BASE}/${GRAPH_API_VERSION}/${DEFAULT_PHONE_NUMBER_ID}/messages`
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${FAKE_TOKEN}`
    );
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: '5511959765031',
      type: 'text',
    });
  });

  it('número ESTRANGEIRO passa verbatim — não ganha 55 na frente', async () => {
    // Regressão de 2026-08-28: `normalizeBrPhone` colava '55' em qualquer
    // coisa com 10-11 dígitos, e o contato dos EUA 16503154274 virava
    // 5516503154274 — inexistente. O Baileys pendurava tentando resolver o
    // JID e o envio morria em 502. Com o Dualhook virando canal ÚNICO, o
    // mesmo erro voltaria por aqui se o normalizador fosse o BR.
    const spy = stubFetchOnce(200, {
      messages: [{ id: 'wamid.x' }],
      contacts: [{ wa_id: '16503154274' }],
    });
    await sendWhatsAppText({ to: '16503154274', body: 'hi' });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).to).toBe('16503154274');
  });

  it('celular BR local ainda ganha o 55', async () => {
    const spy = stubFetchOnce(200, { messages: [{ id: 'w' }] });
    await sendWhatsAppText({ to: '(11) 95976-5031', body: 'oi' });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).to).toBe('5511959765031');
  });

  it('telefone inválido → 400 sem tocar na rede', async () => {
    const spy = stubFetchOnce(200, {});
    await expect(sendWhatsAppText({ to: '123', body: 'oi' })).rejects.toMatchObject({
      status: 400,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('erro 131047 (fora da janela 24h) → 422 acionável', async () => {
    stubFetchOnce(400, { error: { message: 'Re-engagement message', code: 131047 } });
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({ status: 422 });
  });

  it('erro 190 (credencial expirada) → 400 com dica de regenerar', async () => {
    // 400 porque o Dualhook devolveu 401 (4xx): a culpa é da nossa
    // credencial. Antes era 502 — e o corpo sumia na página do Cloudflare.
    stubFetchOnce(401, { error: { message: 'Error validating access token', code: 190 } });
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({
      status: 400,
      extra: { upstreamStatus: 401 },
      message: expect.stringContaining('regenerar'),
    });
  });

  it('401/403 SEM code também vira erro de credencial', async () => {
    // O Dualhook recusa a Outbound API key com um 401 próprio, que não
    // carrega o `code: 190` da Meta. Sem esta ramificação a mensagem cairia
    // no genérico "recusou o envio: HTTP 401" e mandaria quem depura olhar o
    // painel da Meta — que não é mais onde a credencial vive.
    stubFetchOnce(401, { error: { message: 'Invalid API key' } });
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Dualhook'),
    });

    stubFetchOnce(403, {});
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({ status: 400, extra: { upstreamStatus: 403 } });
  });

  it('falha de rede → 500 (nunca 502)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({ status: 500, extra: { upstreamStatus: 0 } });
  });

  // ── por que NUNCA 502/504 ────────────────────────────────────────────────
  // O Cloudflare SUBSTITUI o corpo dessas duas pela página de erro dele. A
  // mensagem que explica a falha — credencial, janela de 24h, número errado —
  // nunca chegaria na tela: o operador via só "502 Bad gateway". Erro 4xx do
  // Dualhook vira 400; o resto, 500. Os dois passam com o corpo intacto.

  it('4xx do Dualhook → 400, com o upstreamStatus no corpo', async () => {
    stubFetchOnce(422, { error: { message: 'Invalid recipient' } });
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({
      status: 400,
      extra: { upstreamStatus: 422 },
      message: expect.stringContaining('Invalid recipient'),
    });
  });

  it('5xx do Dualhook → 500, também com o status real no corpo', async () => {
    stubFetchOnce(503, { error: { message: 'upstream indisponível' } });
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({ status: 500, extra: { upstreamStatus: 503 } });
  });

  it('nenhuma falha responde 502 ou 504', async () => {
    // Trava a regra inteira de uma vez: qualquer status de falha que o
    // Dualhook devolva, o nosso nunca pode ser um dos dois que o Cloudflare
    // sequestra.
    for (const status of [400, 401, 403, 404, 422, 429, 500, 502, 503, 504]) {
      stubFetchOnce(status, { error: { message: 'x' } });
      const err = await sendWhatsAppText({ to: '11959765031', body: 'oi' }).catch(
        (e: ServiceError) => e,
      );
      expect([502, 504], `status ${status}`).not.toContain(
        (err as ServiceError).status,
      );
    }
  });

  it('corpo NÃO-JSON (HTML de proxy) ainda vira erro legível', async () => {
    // `res.json()` engoliria justamente o caso que mais precisa ser visto.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 })),
    );
    await expect(
      sendWhatsAppText({ to: '11959765031', body: 'oi' })
    ).rejects.toMatchObject({ status: 500, extra: { upstreamStatus: 502 } });
  });
});

// ─── verifyMetaSignature ────────────────────────────────────────────────────

// ─── sendWhatsAppTemplate ───────────────────────────────────────────────────
//
// É por aqui que sai a PRIMEIRA mensagem pra um lead — a única que a Meta
// aceita fora da janela de 24h. Não tinha teste nenhum até 2026-09-05.

describe('sendWhatsAppTemplate', () => {
  it('manda pro Dualhook com nome e idioma do template', async () => {
    const spy = stubFetchOnce(200, {
      messages: [{ id: 'wamid.t1' }],
      contacts: [{ wa_id: '5511988887777' }],
    });
    const r = await sendWhatsAppTemplate({
      to: '11988887777',
      template: 'calicolors',
      languageCode: 'pt_BR',
    });
    expect(r.messageId).toBe('wamid.t1');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${DUALHOOK_API_BASE}/${GRAPH_API_VERSION}/${DEFAULT_PHONE_NUMBER_ID}/messages`
    );
    const corpo = JSON.parse(String(init.body)) as {
      type: string;
      template: { name: string; language: { code: string } };
    };
    expect(corpo.type).toBe('template');
    expect(corpo.template.name).toBe('calicolors');
    expect(corpo.template.language.code).toBe('pt_BR');
  });

  // Regressão: usava `normalizeBrPhone`, que cola '55' em qualquer coisa com
  // 10-11 dígitos. Foi o que causou o 502 de 2026-08-28 com o contato dos
  // EUA — e o caminho de template é o da ABORDAGEM DE LEAD, onde número
  // estrangeiro aparece de verdade (a planilha importada tinha um).
  it('preserva número estrangeiro — não cola 55 na frente', async () => {
    const spy = stubFetchOnce(200, {
      messages: [{ id: 'wamid.t2' }],
      contacts: [{ wa_id: '16503154274' }],
    });
    await sendWhatsAppTemplate({ to: '16503154274', template: 'calicolors' });

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body)) as { to: string };
    expect(corpo.to).toBe('16503154274');
    expect(corpo.to).not.toBe('5516503154274');
  });

  it('idioma default é pt_BR', async () => {
    const spy = stubFetchOnce(200, { messages: [{ id: 'x' }], contacts: [] });
    await sendWhatsAppTemplate({ to: '11988887777', template: 'calicolors' });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const corpo = JSON.parse(String(init.body)) as {
      template: { language: { code: string } };
    };
    expect(corpo.template.language.code).toBe('pt_BR');
  });
});

describe('verifyMetaSignature', () => {
  const secret = 'app-secret-de-teste';
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  const sign = (b: string, s: string) =>
    'sha256=' + createHmac('sha256', s).update(b).digest('hex');

  it('aceita assinatura válida', async () => {
    expect(await verifyMetaSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('rejeita corpo adulterado e secret errado', async () => {
    expect(await verifyMetaSignature(body + 'x', sign(body, secret), secret)).toBe(false);
    expect(await verifyMetaSignature(body, sign(body, 'outro'), secret)).toBe(false);
  });

  it('rejeita header ausente ou sem prefixo sha256=', async () => {
    expect(await verifyMetaSignature(body, null, secret)).toBe(false);
    expect(await verifyMetaSignature(body, 'md5=abc', secret)).toBe(false);
  });
});

// ─── persistWhatsAppMessage (SQL Wave 38) ───────────────────────────────────

describe('persistWhatsAppMessage', () => {
  const SUPA_URL = 'https://fake.supabase.co';
  const SERVICE_KEY = 'service-key-teste';

  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA_URL;
    process.env.SUPABASE_SERVICE_ROLE = SERVICE_KEY;
  });

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
  });

  it('POST no REST com service key, on_conflict e ignore-duplicates', async () => {
    const spy = stubFetchOnce(201, {});
    const ok = await persistWhatsAppMessage({
      direction: 'in',
      waId: '16503154274',
      profileName: 'Jackson',
      messageId: 'wamid.abc',
      type: 'text',
      body: 'oi',
      waTimestamp: '1756100000',
    });
    expect(ok).toBe(true);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPA_URL}/rest/v1/whatsapp_messages?on_conflict=message_id`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(headers.Prefer).toContain('ignore-duplicates');
    const row = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(row).toMatchObject({
      direction: 'in',
      wa_id: '16503154274',
      message_id: 'wamid.abc',
      body: 'oi',
    });
    // Epoch em segundos vira ISO.
    expect(row.wa_timestamp).toBe(new Date(1756100000 * 1000).toISOString());
  });

  it('messageId vazio vira NULL (não colide no UNIQUE)', async () => {
    const spy = stubFetchOnce(201, {});
    await persistWhatsAppMessage({ direction: 'out', waId: '5511988887777', messageId: '' });
    const row = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(row.message_id).toBeNull();
  });

  it('best-effort: sem service key → false sem lançar', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    const spy = stubFetchOnce(201, {});
    expect(await persistWhatsAppMessage({ direction: 'in', waId: 'x' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('best-effort: REST 500 → false; network throw → false', async () => {
    stubFetchOnce(500, { message: 'boom' });
    expect(await persistWhatsAppMessage({ direction: 'in', waId: 'x' })).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    expect(await persistWhatsAppMessage({ direction: 'in', waId: 'x' })).toBe(false);
  });
});

// ─── isExpectedWebhookPayload (modo Dualhook) ───────────────────────────────

describe('isExpectedWebhookPayload', () => {
  const expected = { wabaId: '865837919828100', phoneNumberId: '1284183724779574' };
  const envelope = (overrides: Record<string, unknown> = {}) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '865837919828100',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511999990000', phone_number_id: '1284183724779574' },
              messages: [],
            },
          },
        ],
      },
    ],
    ...overrides,
  });

  it('aceita envelope do nosso WABA + número (inclusive só com statuses)', () => {
    expect(isExpectedWebhookPayload(envelope(), expected)).toBe(true);
  });

  it('rejeita WABA de outro cliente', () => {
    const p = envelope();
    p.entry[0].id = '102067872689175';
    expect(isExpectedWebhookPayload(p, expected)).toBe(false);
  });

  it('rejeita phone_number_id diferente', () => {
    const p = envelope();
    p.entry[0].changes[0].value.metadata.phone_number_id = '109293361953640';
    expect(isExpectedWebhookPayload(p, expected)).toBe(false);
  });

  // 2026-09-05: evento que não é de mensagem deixou de ser 403. A Meta manda
  // status de template e mudança de conta no MESMO webhook; 403 pra ela
  // significa "não entreguei", então ela reenviava pra sempre um evento que
  // nunca íamos processar.
  it('evento que não é de mensagem → ignorar (não rejeitar)', () => {
    const p = envelope();
    (p.entry[0].changes[0] as { field: string }).field = 'message_template_status_update';
    expect(classifyWebhookPayload(p, expected)).toBe('ignorar');
  });

  it('mensagem do nosso número → processar', () => {
    expect(classifyWebhookPayload(envelope(), expected)).toBe('processar');
  });

  it('envelope de outra conta → rejeitar, mesmo sem ser de mensagem', () => {
    const p = envelope();
    p.entry[0].id = '999999999';
    (p.entry[0].changes[0] as { field: string }).field = 'account_update';
    expect(classifyWebhookPayload(p, expected)).toBe('rejeitar');
  });

  it('mensagem endereçada a OUTRO número segue rejeitada', () => {
    // Aqui não é "evento que não me interessa" — é entrega no endereço
    // errado. Engolir com 200 esconderia erro de configuração.
    const p = envelope();
    p.entry[0].changes[0].value.metadata.phone_number_id = '109293361953640';
    expect(classifyWebhookPayload(p, expected)).toBe('rejeitar');
  });

  it('não processa field ≠ messages, entry vazio, object errado e não-objeto', () => {
    const p = envelope();
    (p.entry[0].changes[0] as { field: string }).field = 'account_update';
    // false aqui = "não é mensagem pra processar"; o 403 quem decide é o
    // veredito da rota, e pra este caso ele é 'ignorar'.
    expect(isExpectedWebhookPayload(p, expected)).toBe(false);
    expect(isExpectedWebhookPayload(envelope({ entry: [] }), expected)).toBe(false);
    expect(isExpectedWebhookPayload(envelope({ object: 'page' }), expected)).toBe(false);
    expect(isExpectedWebhookPayload(null, expected)).toBe(false);
    expect(isExpectedWebhookPayload('x', expected)).toBe(false);
  });
});

describe('checkWebhookUrlSecret', () => {
  const base = 'https://www.queroumacor.com.br/api/whatsapp/webhook';
  it('ok quando ?token= bate com a env', () => {
    expect(checkWebhookUrlSecret(new URL(`${base}?token=abc123`), 'abc123')).toBe('ok');
  });
  it('invalid com token errado, ausente ou de tamanho diferente', () => {
    expect(checkWebhookUrlSecret(new URL(`${base}?token=abc124`), 'abc123')).toBe('invalid');
    expect(checkWebhookUrlSecret(new URL(base), 'abc123')).toBe('invalid');
    expect(checkWebhookUrlSecret(new URL(`${base}?token=abc`), 'abc123')).toBe('invalid');
  });
  it('missing-config sem env (fail-closed)', () => {
    expect(checkWebhookUrlSecret(new URL(`${base}?token=abc123`), undefined)).toBe('missing-config');
    expect(checkWebhookUrlSecret(new URL(`${base}?token=abc123`), '')).toBe('missing-config');
  });
  it('convive com os params hub.* do GET de verificação', () => {
    const u = new URL(`${base}?token=abc123&hub.mode=subscribe&hub.challenge=1&hub.verify_token=v`);
    expect(checkWebhookUrlSecret(u, 'abc123')).toBe('ok');
  });
});

describe('getWebhookAuthMode', () => {
  it('default é payload; só "hmac" exato liga o HMAC', () => {
    expect(getWebhookAuthMode()).toBe('payload');
    process.env.WHATSAPP_WEBHOOK_AUTH_MODE = 'HMAC';
    expect(getWebhookAuthMode()).toBe('payload');
    process.env.WHATSAPP_WEBHOOK_AUTH_MODE = 'hmac';
    expect(getWebhookAuthMode()).toBe('hmac');
  });
});

// ─── parseInboundMessages ───────────────────────────────────────────────────

describe('parseInboundMessages', () => {
  it('extrai mensagem de texto do envelope real da Meta', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '102067872689175',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                contacts: [{ profile: { name: 'Zé Pintor' }, wa_id: '5511988887777' }],
                messages: [
                  {
                    from: '5511988887777',
                    id: 'wamid.xyz',
                    timestamp: '1756100000',
                    type: 'text',
                    text: { body: 'Quero um orçamento' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundMessages(payload)).toEqual([
      {
        from: '5511988887777',
        messageId: 'wamid.xyz',
        timestamp: '1756100000',
        type: 'text',
        text: 'Quero um orçamento',
        profileName: 'Zé Pintor',
        // Campos de mídia (2026-09-05): nulos em mensagem de texto. Ficam
        // no `toEqual` de propósito — se um dia vierem preenchidos aqui, o
        // parser está confundindo texto com mídia.
        mediaId: null,
        mediaMime: null,
        filename: null,
        // Idem pro rótulo de botão (2026-09-06): mensagem de texto não tem.
        replyPayload: null,
        // Recebida comum: não é eco do celular nem reação/edição (2026-09-09).
        echo: false,
        refMessageId: null,
      },
    ]);
  });

  it('envelope só de status (sem messages) → lista vazia', () => {
    const payload = {
      entry: [
        {
          changes: [
            { field: 'messages', value: { statuses: [{ id: 'wamid.a', status: 'delivered' }] } },
          ],
        },
      ],
    };
    expect(parseInboundMessages(payload)).toEqual([]);
    expect(parseInboundMessages(null)).toEqual([]);
    expect(parseInboundMessages({})).toEqual([]);
  });
});

// ─── isForaDaJanela24h ──────────────────────────────────────────────────────

describe('isForaDaJanela24h', () => {
  // Quem envia em LOTE (o follow-up) precisa separar "não dá pra enviar
  // nunca, só com template" de "deu erro, tenta de novo". Sem isso a
  // varredura martela o mesmo contato de hora em hora, pra sempre.
  it('reconhece o 422 da janela de 24h', () => {
    expect(isForaDaJanela24h(new ServiceError('fora da janela', 422))).toBe(true);
  });

  it('não confunde com outros erros', () => {
    expect(isForaDaJanela24h(new ServiceError('credencial', 400))).toBe(false);
    expect(isForaDaJanela24h(new ServiceError('upstream', 500))).toBe(false);
    expect(isForaDaJanela24h(new Error('qualquer'))).toBe(false);
    expect(isForaDaJanela24h(null)).toBe(false);
  });
});

// ─── Mídia recebida (Cloud API) ─────────────────────────────────────────────
//
// Na Cloud API o webhook NÃO traz o arquivo: vem só um `id`, e os bytes se
// buscam depois em dois passos. A Evolution mandava base64 no próprio
// evento — por isso este caminho é novo, e por isso a conversa mostrava
// "[audio]" e "[sticker]" secos: ninguém extraía o id.
//
// Detalhe que o parser tinha que acertar: o objeto da mídia vem numa chave
// com o NOME DO TIPO (`audio`, `image`, …), não numa chave fixa.

describe('parseInboundMessages — mídia', () => {
  const envelopeMidia = (msg: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1320667299892030',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '1220273824510260' },
              contacts: [{ profile: { name: 'Zé' }, wa_id: '5511988887777' }],
              messages: [{ from: '5511988887777', id: 'wamid.m1', timestamp: '1757100000', ...msg }],
            },
          },
        ],
      },
    ],
  });

  it('áudio: extrai id e mime', () => {
    const [m] = parseInboundMessages(
      envelopeMidia({
        type: 'audio',
        audio: { id: 'MEDIA_1', mime_type: 'audio/ogg; codecs=opus', voice: true },
      })
    );
    expect(m.type).toBe('audio');
    expect(m.mediaId).toBe('MEDIA_1');
    expect(m.mediaMime).toContain('audio/ogg');
  });

  it('figurinha: mesmo caminho (era o "[sticker]" seco da conversa)', () => {
    const [m] = parseInboundMessages(
      envelopeMidia({ type: 'sticker', sticker: { id: 'MEDIA_2', mime_type: 'image/webp' } })
    );
    expect(m.mediaId).toBe('MEDIA_2');
    expect(m.mediaMime).toBe('image/webp');
  });

  // Legenda de foto/vídeo vira o corpo: senão a mensagem apareceria sem o
  // texto que a pessoa escreveu junto.
  it('foto com legenda: a legenda vira o corpo', () => {
    const [m] = parseInboundMessages(
      envelopeMidia({
        type: 'image',
        image: { id: 'MEDIA_3', mime_type: 'image/jpeg', caption: 'olha a parede' },
      })
    );
    expect(m.text).toBe('olha a parede');
    expect(m.mediaId).toBe('MEDIA_3');
  });

  it('documento: guarda o nome original', () => {
    const [m] = parseInboundMessages(
      envelopeMidia({
        type: 'document',
        document: { id: 'MEDIA_4', mime_type: 'application/pdf', filename: 'orcamento.pdf' },
      })
    );
    expect(m.filename).toBe('orcamento.pdf');
  });

  it('texto puro continua sem mídia', () => {
    const [m] = parseInboundMessages(
      envelopeMidia({ type: 'text', text: { body: 'oi' } })
    );
    expect(m.text).toBe('oi');
    expect(m.mediaId).toBeNull();
    expect(m.mediaMime).toBeNull();
  });

  it('tipo desconhecido não inventa mídia', () => {
    const [m] = parseInboundMessages(envelopeMidia({ type: 'reaction', reaction: { emoji: '👍' } }));
    expect(m.mediaId).toBeNull();
  });
});

// ── Quick reply de template (2026-09-06) ────────────────────────────────
// A pessoa toca num botão do template e a Meta manda `type='button'` com
// `{text, payload}` — nada em `text.body`. Isso caía em corpo VAZIO: a
// bolha aparecia em branco na conversa e o atendimento automático pulava a
// mensagem (`if (!texto) continue`), então justamente quem demonstrou
// interesse ficava sem resposta.
describe('parseInboundMessages: resposta por botão', () => {
  function envelope(msg: Record<string, unknown>) {
    return {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5511999998888', profile: { name: 'Fabio' } }],
                messages: [{ from: '5511999998888', id: 'wamid.X', timestamp: '1757000000', ...msg }],
              },
            },
          ],
        },
      ],
    };
  }

  it('quick reply de template vira o texto do botão', () => {
    const [m] = parseInboundMessages(
      envelope({ type: 'button', button: { text: 'Não tenho interesse', payload: 'SEM_INTERESSE' } })
    );
    expect(m.text).toBe('Não tenho interesse');
    expect(m.type).toBe('button');
    expect(m.replyPayload).toBe('SEM_INTERESSE');
    expect(m.mediaId).toBeNull();
  });

  it('botão de mensagem interativa também', () => {
    const [m] = parseInboundMessages(
      envelope({
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'sim', title: 'Quero saber mais' } },
      })
    );
    expect(m.text).toBe('Quero saber mais');
    expect(m.replyPayload).toBe('sim');
  });

  it('item de lista interativa também', () => {
    const [m] = parseInboundMessages(
      envelope({
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'tinta', title: 'Tintas' } },
      })
    );
    expect(m.text).toBe('Tintas');
  });

  it('texto puro segue intocado, sem payload', () => {
    const [m] = parseInboundMessages(envelope({ type: 'text', text: { body: 'oi' } }));
    expect(m.text).toBe('oi');
    expect(m.replyPayload).toBeNull();
  });

  it('botão sem rótulo não inventa texto', () => {
    const [m] = parseInboundMessages(envelope({ type: 'button', button: { payload: 'X' } }));
    expect(m.text).toBe('');
  });
});

// ─── Abordagem de lead: confirmação da Meta gravada NO LEAD (2026-09-09) ───
//
// O incidente: a API aceitava, o portal marcava `contactado`, e o `failed`
// que a Meta mandava depois não desfazia nada. Estes testes travam o novo
// contrato: a rota amarra o wamid ao lead sem tocar no funil; o webhook
// grava o status e só ele muda `novo` → `contactado` (ou desfaz, no failed).

function stubFetchSequencia(respostas: Array<{ status: number; json: unknown }>) {
  const spy = vi.fn();
  for (const r of respostas) {
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify(r.json), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      })
    );
  }
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('abordagem de lead — filtroSoAvanca', () => {
  it('sent só passa por quem está nulo ou accepted', () => {
    expect(filtroSoAvanca('sent')).toBe(
      'or=(abordagem_status.is.null,abordagem_status.not.in.(sent,delivered,read,failed))'
    );
  });
  it('failed vence tudo menos outro failed', () => {
    expect(filtroSoAvanca('failed')).toBe(
      'or=(abordagem_status.is.null,abordagem_status.not.in.(failed))'
    );
  });
});

describe('abordagem de lead — vincularAbordagemAoLead (rota de envio)', () => {
  const SUPA_URL = 'https://fake.supabase.co';
  const SERVICE_KEY = 'service-key-teste';
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA_URL;
    process.env.SUPABASE_SERVICE_ROLE = SERVICE_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    vi.restoreAllMocks();
  });

  it('PATCH no lead com o wamid e accepted — e NUNCA mexe em status', async () => {
    const spy = stubFetchOnce(200, {});
    const ok = await vincularAbordagemAoLead({
      leadId: '0b0f4a1e-1111-4222-8333-444455556666',
      messageId: 'wamid.abc',
    });
    expect(ok).toBe(true);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SUPA_URL}/rest/v1/leads?id=eq.0b0f4a1e-1111-4222-8333-444455556666`);
    expect(init.method).toBe('PATCH');
    const row = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(row).toMatchObject({
      abordagem_message_id: 'wamid.abc',
      abordagem_status: 'accepted',
      abordagem_error: null,
    });
    // A regra inteira do incidente cabe nesta linha: aceito pela API não é
    // contactado.
    expect(row).not.toHaveProperty('status');
  });

  it('tolera a coluna ausente (400/42703) → false, sem lançar', async () => {
    stubFetchOnce(400, { code: '42703', message: 'column "abordagem_status" does not exist' });
    expect(await vincularAbordagemAoLead({ leadId: 'x', messageId: 'wamid.1' })).toBe(false);
  });

  it('sem leadId ou sem wamid → false sem chamar a rede', async () => {
    const spy = stubFetchOnce(200, {});
    expect(await vincularAbordagemAoLead({ leadId: '', messageId: 'wamid.1' })).toBe(false);
    expect(await vincularAbordagemAoLead({ leadId: 'x', messageId: '' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('abordagem de lead — persistStatusDoLead (webhook)', () => {
  const SUPA_URL = 'https://fake.supabase.co';
  const SERVICE_KEY = 'service-key-teste';
  const st = (status: 'sent' | 'delivered' | 'read' | 'failed', erro: string | null = null) => ({
    messageId: 'wamid.abc',
    status,
    timestamp: '1757100000',
    recipientId: '5511988887777',
    erro,
    erroCodigo: erro ? 131026 : null,
    erroTitulo: erro ? 'Message undeliverable' : null,
  });
  beforeEach(() => {
    process.env.SUPABASE_URL = SUPA_URL;
    process.env.SUPABASE_SERVICE_ROLE = SERVICE_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE;
    vi.restoreAllMocks();
  });

  it('sent num lead novo → grava o status E vira contactado', async () => {
    const spy = stubFetchSequencia([
      { status: 200, json: [{ id: 'lead-1', status: 'novo' }] },
      { status: 200, json: {} },
    ]);
    expect(await persistStatusDoLead(st('sent'))).toBe('contactado');
    const [url1, init1] = spy.mock.calls[0] as [string, RequestInit];
    expect(url1).toContain('/rest/v1/leads?abordagem_message_id=eq.wamid.abc');
    expect(url1).toContain('abordagem_status.not.in.(sent,delivered,read,failed)');
    expect(url1).toContain('select=id,status');
    expect(JSON.parse(init1.body as string)).toMatchObject({
      abordagem_status: 'sent',
      abordagem_error: null,
      abordagem_at: new Date(1757100000 * 1000).toISOString(),
    });
    const [url2, init2] = spy.mock.calls[1] as [string, RequestInit];
    expect(url2).toContain('/rest/v1/leads?id=eq.lead-1');
    expect(url2).toContain('status.eq.novo');
    expect(JSON.parse(init2.body as string)).toEqual({ status: 'contactado' });
  });

  it('delivered num lead já contactado → só atualiza o status (sem 2º PATCH)', async () => {
    const spy = stubFetchSequencia([{ status: 200, json: [{ id: 'lead-1', status: 'contactado' }] }]);
    expect(await persistStatusDoLead(st('delivered'))).toBe('atualizado');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sent num lead que o operador já moveu pra qualificado → não atropela', async () => {
    const spy = stubFetchSequencia([{ status: 200, json: [{ id: 'lead-1', status: 'qualificado' }] }]);
    expect(await persistStatusDoLead(st('sent'))).toBe('atualizado');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('failed num lead contactado → grava o motivo e DESFAZ o contactado', async () => {
    const spy = stubFetchSequencia([
      { status: 200, json: [{ id: 'lead-1', status: 'contactado' }] },
      { status: 200, json: {} },
    ]);
    expect(
      await persistStatusDoLead(st('failed', '131026 · Message undeliverable · Message Undeliverable.'))
    ).toBe('desfeito');
    expect(JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({
      abordagem_status: 'failed',
      abordagem_error: '131026 · Message undeliverable · Message Undeliverable.',
    });
    const [url2, init2] = spy.mock.calls[1] as [string, RequestInit];
    expect(url2).toContain('status=eq.contactado');
    expect(JSON.parse(init2.body as string)).toEqual({ status: 'novo' });
  });

  it('failed num lead que já era qualificado → registra, mas o funil fica', async () => {
    const spy = stubFetchSequencia([{ status: 200, json: [{ id: 'lead-1', status: 'qualificado' }] }]);
    expect(await persistStatusDoLead(st('failed', 'x'))).toBe('atualizado');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('nenhum lead com esse wamid → sem-lead (pra rota tentar de novo)', async () => {
    stubFetchSequencia([{ status: 200, json: [] }]);
    expect(await persistStatusDoLead(st('sent'))).toBe('sem-lead');
  });

  it('coluna ausente / REST 400 → falhou, sem lançar', async () => {
    stubFetchSequencia([{ status: 400, json: { code: '42703' } }]);
    expect(await persistStatusDoLead(st('sent'))).toBe('falhou');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')));
    expect(await persistStatusDoLead(st('sent'))).toBe('falhou');
  });
});

// ─── Ecos do celular, reação, edição, unsupported (2026-09-09) ──────────────
//
// O relato: "não está aparecendo as mensagens respondidas pelo celular, e
// reaction e edits". Três causas: o eco do aparelho vem em OUTRO campo do
// webhook (`smb_message_echoes`) e era ignorado; reação e edição não têm
// `text.body`, então o corpo saía vazio e o portal mostrava só o tipo.

function envelope(field: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1320667299892030',
        changes: [
          {
            field,
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '1220273824510260' },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

describe('ecos do celular (smb_message_echoes)', () => {
  const esperado = { wabaId: '1320667299892030', phoneNumberId: '1220273824510260' };

  it('classifyWebhookPayload: eco do NOSSO número → processar (antes: ignorar)', () => {
    const env = envelope('smb_message_echoes', {
      message_echoes: [{ from: '5511959765031', to: '5511988887777', id: 'wamid.eco', timestamp: '1757100000', type: 'text', text: { body: 'Valorizamos muito o tempo' } }],
    });
    expect(classifyWebhookPayload(env, esperado)).toBe('processar');
  });

  it('classifyWebhookPayload: eco de OUTRO número → rejeitar', () => {
    const env = envelope('smb_message_echoes', { message_echoes: [] });
    (env.entry[0].changes[0].value as { metadata: { phone_number_id: string } }).metadata.phone_number_id = '999';
    expect(classifyWebhookPayload(env, esperado)).toBe('rejeitar');
  });

  it('parseEchoMessages: a contraparte é o `to`, com echo=true', () => {
    const env = envelope('smb_message_echoes', {
      message_echoes: [{ from: '5511959765031', to: '5511988887777', id: 'wamid.eco', timestamp: '1757100000', type: 'text', text: { body: 'Valorizamos muito o tempo' } }],
    });
    const [m] = parseEchoMessages(env);
    expect(m).toMatchObject({ from: '5511988887777', echo: true, type: 'text', text: 'Valorizamos muito o tempo', messageId: 'wamid.eco' });
    // O parser de recebidas NÃO lê os ecos — senão a mesma mensagem
    // entraria duas vezes, uma como 'in'.
    expect(parseInboundMessages(env)).toEqual([]);
  });

  it('mensagem recebida comum tem echo=false', () => {
    const env = envelope('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.in', timestamp: '1', type: 'text', text: { body: 'oi' } }],
    });
    expect(parseInboundMessages(env)[0]).toMatchObject({ echo: false, from: '5511988887777' });
  });
});

describe('parseInboundMessages: reação, edição e unsupported', () => {
  it('reação: o emoji vira o corpo e o wamid alvo fica em refMessageId', () => {
    const env = envelope('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.r', timestamp: '1', type: 'reaction', reaction: { message_id: 'wamid.alvo', emoji: '👍' } }],
    });
    expect(parseInboundMessages(env)[0]).toMatchObject({ type: 'reaction', text: '👍', refMessageId: 'wamid.alvo' });
  });
  it('reação removida (emoji vazio) → corpo vazio, não "[reaction]"', () => {
    const env = envelope('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.r', timestamp: '1', type: 'reaction', reaction: { message_id: 'wamid.alvo', emoji: '' } }],
    });
    expect(parseInboundMessages(env)[0].text).toBe('');
  });
  it('edição: lê o texto novo de edit.text.body ou de text.body', () => {
    const a = envelope('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.e', timestamp: '1', type: 'edit', edit: { message_id: 'wamid.alvo', text: { body: 'próprio para área externa também?' } } }],
    });
    expect(parseInboundMessages(a)[0]).toMatchObject({ type: 'edit', text: 'próprio para área externa também?', refMessageId: 'wamid.alvo' });
    const b = envelope('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.e', timestamp: '1', type: 'edit', text: { body: 'texto editado' } }],
    });
    expect(parseInboundMessages(b)[0].text).toBe('texto editado');
  });
  it('unsupported: corpo vazio e tipo preservado (o portal explica)', () => {
    const env = envelope('messages', {
      messages: [{ from: '5511988887777', id: 'wamid.u', timestamp: '1', type: 'unsupported', errors: [{ code: 131051, title: 'Message type unknown' }] }],
    });
    expect(parseInboundMessages(env)[0]).toMatchObject({ type: 'unsupported', text: '' });
  });
  it('TIPOS_SEM_CONVERSA cobre os três (a IA não responde a um 👍)', () => {
    for (const t of ['reaction', 'edit', 'unsupported']) expect(TIPOS_SEM_CONVERSA.has(t)).toBe(true);
    expect(TIPOS_SEM_CONVERSA.has('text')).toBe(false);
    expect(TIPOS_SEM_CONVERSA.has('button')).toBe(false);
  });
});

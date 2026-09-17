// __tests__/api/push-notify-ssrf.test.ts — auditoria de webhooks 2026-09-17.
//
// Achado: `push_subscriptions.endpoint` é gravado pelo CLIENTE (a RLS só
// garante `user_id = auth.uid()`, nunca que o valor é um push service de
// verdade). `sendWebPush` fazia `fetch(sub.endpoint, …)` sem checar nada —
// qualquer usuário autenticado podia gravar um `endpoint` apontando pra
// QUALQUER URL (metadado de nuvem, serviço interno, terceiro arbitrário) e,
// ao disparar uma notificação pra si mesmo (like/comment/follow de uma
// segunda conta, por exemplo), o trigger do banco chamaria este handler —
// que roda no edge com credencial de serviço — e o `fetch` sairia pra onde
// o atacante escolheu, com um JWT VAPID assinado por NÓS no header
// Authorization. SSRF clássico via campo do provider.
//
// Corrigido com allowlist de HOSTNAME (não IP resolvido — evita DNS
// rebinding de graça, porque a checagem nunca depende de resolução).
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import type { NextRequest } from 'next/server';
import { isAllowedPushEndpoint } from '@/lib/api/_services/push-endpoint-guard';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const VALID_UID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function mkReq(body: unknown, secret = 'test-secret'): NextRequest {
  return new Request('https://app.test/api/push-notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── isAllowedPushEndpoint (função pura) ────────────────────────────────────

describe('isAllowedPushEndpoint', () => {
  it('aceita os 4 provedores reais de Web Push (https, hostname exato)', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123')).toBe(true);
    expect(isAllowedPushEndpoint('https://android.googleapis.com/gcm/send/xyz')).toBe(true);
    expect(
      isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'),
    ).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QGjw...')).toBe(true);
  });

  it('aceita subdomínio real do WNS (Edge/Windows)', () => {
    expect(isAllowedPushEndpoint('https://wns2-abc123.notify.windows.com/?token=x')).toBe(true);
  });

  // ─── payloads de SSRF que TÊM que ser recusados ───────────────────────────
  it('recusa localhost, loopback e link-local', () => {
    expect(isAllowedPushEndpoint('https://localhost/admin')).toBe(false);
    expect(isAllowedPushEndpoint('https://127.0.0.1/admin')).toBe(false);
    expect(isAllowedPushEndpoint('https://[::1]/admin')).toBe(false);
  });

  it('recusa o metadado de nuvem (169.254.169.254)', () => {
    expect(
      isAllowedPushEndpoint('http://169.254.169.254/latest/meta-data/iam/security-credentials/'),
    ).toBe(false);
    expect(isAllowedPushEndpoint('https://169.254.169.254/computeMetadata/v1/')).toBe(false);
  });

  it('recusa RFC1918 (rede interna)', () => {
    expect(isAllowedPushEndpoint('https://10.0.0.5/internal')).toBe(false);
    expect(isAllowedPushEndpoint('https://192.168.1.1/router')).toBe(false);
    expect(isAllowedPushEndpoint('https://172.16.0.1/svc')).toBe(false);
  });

  it('recusa domínio de terceiro arbitrário (o caso óbvio)', () => {
    expect(isAllowedPushEndpoint('https://evil.example.com/collect')).toBe(false);
  });

  // ─── confusão de subdomínio: "parece" um provedor mas não é ───────────────
  it('recusa domínio que só TERMINA parecido (typosquat/sufixo)', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://evilfcm.googleapis.com/x')).toBe(false);
    expect(isAllowedPushEndpoint('https://notfcm.googleapis.com/x')).toBe(false);
  });

  it('recusa userinfo/host confusion (https://fcm.googleapis.com@evil.com/)', () => {
    // O parser de URL do WHATWG resolve isso pro HOST real (evil.com); o
    // teste prova que confiamos no parser, não numa regex ingênua na string.
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com@evil.com/x')).toBe(false);
  });

  it('recusa esquema não-https (http, file, javascript, data)', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('file:///etc/passwd')).toBe(false);
    expect(isAllowedPushEndpoint('javascript:alert(1)')).toBe(false);
    expect(isAllowedPushEndpoint('data:text/plain,x')).toBe(false);
  });

  it('recusa URL malformada sem lançar', () => {
    expect(isAllowedPushEndpoint('não é uma url')).toBe(false);
    expect(isAllowedPushEndpoint('')).toBe(false);
  });
});

// ─── Integração: o endpoint malicioso NUNCA recebe fetch ────────────────────

describe('POST /api/push-notify — SSRF via push_subscriptions.endpoint', () => {
  let goodP256dh: string;
  let goodAuth: string;
  let vapidPrivateKeyB64: string;

  beforeAll(async () => {
    // EC point de verdade (P-256), senão a criptografia rejeita antes de
    // chegar no fetch e o teste não provaria nada sobre o endpoint bom.
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    goodP256dh = b64url(raw);
    goodAuth = b64url(crypto.getRandomValues(new Uint8Array(16)));

    // VAPID_PRIVATE_KEY também precisa ser um escalar P-256 válido de 32
    // bytes de verdade (`buildVapidJwt` lança antes de qualquer fetch se
    // não for) — outro par ECDH real só pra ter os 32 bytes do `d`.
    const vapidPair = (await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits'],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', vapidPair.privateKey)) as JsonWebKey;
    vapidPrivateKeyB64 = jwk.d as string; // já vem em base64url, 32 bytes
  });

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      PUSH_INTERNAL_SECRET: 'test-secret',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'svc-test',
      VAPID_PRIVATE_KEY: vapidPrivateKeyB64,
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'BPublicKeyDummy',
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('subscription com endpoint malicioso: NUNCA sai um fetch pra lá', async () => {
    const alvoMalicioso = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/rest/v1/rpc/check_rate_limit')) {
        return new Response(JSON.stringify({ allowed: true, count: 1, limit: 60 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/rest/v1/push_subscriptions')) {
        return new Response(
          JSON.stringify([
            {
              id: 'sub-malicioso',
              user_id: VALID_UID,
              endpoint: alvoMalicioso,
              p256dh: goodP256dh,
              auth: goodAuth,
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(mkReq({ userIds: [VALID_UID], title: 'oi', body: 'teste' }));
    expect(res.status).toBe(200);

    const chamouOAlvo = fetchMock.mock.calls.some(([u]) => String(u) === alvoMalicioso);
    expect(chamouOAlvo).toBe(false);

    const json = (await res.json()) as { web: { sent: number; total: number } };
    expect(json.web.total).toBe(1); // a linha existe...
    expect(json.web.sent).toBe(0); // ...mas nada foi enviado pra ela.
  });

  it('endpoint de provedor real de verdade RECEBE o fetch (allowlist não bloqueia tráfego legítimo)', async () => {
    const alvoLegitimo = 'https://fcm.googleapis.com/fcm/send/token-de-verdade';
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('/rest/v1/rpc/check_rate_limit')) {
        return new Response(JSON.stringify({ allowed: true, count: 1, limit: 60 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (u.includes('/rest/v1/push_subscriptions')) {
        return new Response(
          JSON.stringify([
            {
              id: 'sub-legitimo',
              user_id: VALID_UID,
              endpoint: alvoLegitimo,
              p256dh: goodP256dh,
              auth: goodAuth,
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (u === alvoLegitimo) {
        return new Response('', { status: 201 });
      }
      return new Response('{}', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const { POST } = await import('@/app/api/push-notify/route');
    const res = await POST(mkReq({ userIds: [VALID_UID], title: 'oi', body: 'teste' }));
    expect(res.status).toBe(200);

    const chamouOAlvo = fetchMock.mock.calls.some(([u]) => String(u) === alvoLegitimo);
    expect(chamouOAlvo).toBe(true);

    const json = (await res.json()) as { web: { sent: number; total: number } };
    expect(json.web.sent).toBe(1);
  });
});

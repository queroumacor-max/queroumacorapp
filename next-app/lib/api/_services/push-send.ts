// push-send — envio de push (Web Push VAPID + nativo FCM) pra uma lista de
// usuários. Saiu de dentro de app/api/push-notify/route.ts em 2026-11-06 pra
// ser reaproveitado pelo "Enviar push" dos Avisos do portal
// (app/api/admin/announce-push), que manda pra centenas de pessoas de uma vez.
// O comportamento do /api/push-notify não mudou: ele só chama enviarPush.

import {
  sendFcmToDeviceTokens,
  type DeviceTokenRow,
  type FcmServiceAccount,
} from '@/lib/api/_services/fcm';
import { isAllowedPushEndpoint } from '@/lib/api/_services/push-endpoint-guard';

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  icon?: string;
  tag?: string;
}

const ENDPOINT_TIMEOUT_MS = 8000;

// Teto de fan-out por usuário-alvo neste envio. Nada no INSERT de
// `push_subscriptions`/`push_device_tokens` limita QUANTAS linhas um usuário
// autenticado cria pra si mesmo (RLS só garante que são dele) — sem este
// teto, alguém que inserisse milhares de tokens/subscriptions falsos na
// própria conta faria QUALQUER notificação endereçada a ele (curtida,
// comentário, mensagem) virar milhares de fetches concorrentes daqui pro
// FCM/push service, no MESMO isolate. `order=...desc&limit=N` mantém só os
// dispositivos mais recentes — a pessoa continua recebendo push nos
// aparelhos de verdade, o resto nunca é buscado.
const MAX_RECIPIENTS_PER_SEND = 25;


export interface EnvioPushConfig {
  supabaseUrl: string;
  serviceKey: string;
  web: { publicKey: string; privateKey: string; subject: string } | null;
  fcm: FcmServiceAccount | null;
}

export interface ResultadoPush {
  sent: number;
  removed: number;
  total: number;
  web: { sent: number; removed: number; total: number };
  native: { sent: number; removed: number; total: number };
}

/** Envia o mesmo push pra todos os `userIds` (em qualquer quantidade; a consulta
 *  aos tokens é feita no lote que vier — quem chama corta em pedaços). */
export async function enviarPush(
  userIds: string[],
  payload: PushPayload,
  cfg: EnvioPushConfig,
): Promise<ResultadoPush> {
  const { supabaseUrl, serviceKey } = cfg;
  const webPushOn = !!cfg.web;
  const vapidPublic = cfg.web?.publicKey;
  const vapidPrivate = cfg.web?.privateKey;
  const vapidSubject = cfg.web?.subject || 'mailto:loja@calicolors.com.br';
  const fcmSa = cfg.fcm;
  // ─── 6a) Web Push (VAPID) ────────────────────────────────────────────────
  let webSent = 0;
  let webRemoved = 0;
  let webTotal = 0;
  if (webPushOn) {
    const todasSubs = await fetchSubscriptions(supabaseUrl, serviceKey, userIds);
    webTotal = todasSubs.length;
    // SSRF (auditoria de webhooks 2026-09-17): `endpoint` é gravado pelo
    // PRÓPRIO CLIENTE (`push_subscriptions_insert_own` só garante
    // `user_id = auth.uid()`, não que o valor seja um push service de
    // verdade). Qualquer usuário autenticado pode inserir uma linha com
    // `endpoint` apontando pra QUALQUER URL — e este handler, chamado pelo
    // trigger do banco com credencial de serviço, fazia `fetch(sub.endpoint,
    // …)` sem checar nada. Bastava a pessoa disparar uma notificação pra si
    // mesma (curtir/comentar/seguir usando uma segunda conta, por exemplo)
    // pra o edge da Cloudflare emitir um POST autenticado (JWT VAPID) pra
    // onde ela quisesse — metadado de nuvem, serviço interno, qualquer
    // terceiro. `subs` agora só inclui endpoint de um push service
    // CONHECIDO; o resto é ignorado (fica na tabela, só não é chamado).
    const subs = todasSubs.filter((sub) => isAllowedPushEndpoint(sub.endpoint));
    if (subs.length !== todasSubs.length) {
      console.warn(
        `[push-notify] ${todasSubs.length - subs.length} subscription(s) com endpoint fora do allowlist — ignoradas`,
      );
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const results = await Promise.all(
      subs.map((sub) =>
        sendWebPush({
          sub,
          payloadBytes,
          vapidPublic: vapidPublic as string,
          vapidPrivate: vapidPrivate as string,
          vapidSubject,
        }).catch((err) => ({ status: 'error' as const, statusCode: 0, sub, error: err })),
      ),
    );
    const expiredIds = results.filter((r) => r.status === 'expired').map((r) => r.sub.id);
    if (expiredIds.length > 0) {
      await deleteSubscriptionsByIds(supabaseUrl, serviceKey, expiredIds).catch(() => {});
    }
    webSent = results.filter((r) => r.status === 'sent').length;
    webRemoved = expiredIds.length;
  }

  // ─── 6b) Push nativo (FCM/APNs) ──────────────────────────────────────────
  let nativeSent = 0;
  let nativeRemoved = 0;
  let nativeTotal = 0;
  if (fcmSa) {
    const rows = await fetchDeviceTokens(supabaseUrl, serviceKey, userIds).catch(
      () => [] as DeviceTokenRow[],
    );
    nativeTotal = rows.length;
    const r = await sendFcmToDeviceTokens(fcmSa, rows, payload).catch(() => null);
    if (r) {
      nativeSent = r.sent;
      if (r.expiredIds.length > 0) {
        await deleteDeviceTokensByIds(supabaseUrl, serviceKey, r.expiredIds).catch(() => {});
      }
      nativeRemoved = r.expiredIds.length;
    }
  }

  return {
    sent: webSent + nativeSent,
    removed: webRemoved + nativeRemoved,
    total: webTotal + nativeTotal,
    web: { sent: webSent, removed: webRemoved, total: webTotal },
    native: { sent: nativeSent, removed: nativeRemoved, total: nativeTotal },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers: Supabase REST (sem SDK pra ficar leve)
// ════════════════════════════════════════════════════════════════════════════

async function fetchSubscriptions(
  url: string,
  serviceKey: string,
  userIds: string[],
): Promise<PushSubscriptionRow[]> {
  // PostgREST `in.()` filter espera lista entre parens, quoted se contiver
  // caractere especial — UUIDs não têm, então plain join basta.
  const inList = userIds.map((u) => `"${u}"`).join(',');
  const u = `${url.replace(/\/$/, '')}/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${inList})&order=last_seen_at.desc&limit=${MAX_RECIPIENTS_PER_SEND * Math.max(1, userIds.length)}`;
  const res = await fetch(u, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  try {
    const rows = (await res.json()) as PushSubscriptionRow[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function deleteSubscriptionsByIds(
  url: string,
  serviceKey: string,
  ids: string[],
): Promise<void> {
  const inList = ids.map((u) => `"${u}"`).join(',');
  const u = `${url.replace(/\/$/, '')}/rest/v1/push_subscriptions?id=in.(${inList})`;
  await fetch(u, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
  });
}

// ─── push_device_tokens (canal nativo FCM/APNs, Wave 39) ────────────────────

async function fetchDeviceTokens(
  url: string,
  serviceKey: string,
  userIds: string[],
): Promise<DeviceTokenRow[]> {
  const inList = userIds.map((u) => `"${u}"`).join(',');
  const u = `${url.replace(/\/$/, '')}/rest/v1/push_device_tokens?select=id,token&user_id=in.(${inList})&order=last_seen_at.desc&limit=${MAX_RECIPIENTS_PER_SEND * Math.max(1, userIds.length)}`;
  const res = await fetch(u, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
  });
  if (!res.ok) return [];
  return (await res.json()) as DeviceTokenRow[];
}

async function deleteDeviceTokensByIds(
  url: string,
  serviceKey: string,
  ids: string[],
): Promise<void> {
  const inList = ids.map((u) => `"${u}"`).join(',');
  const u = `${url.replace(/\/$/, '')}/rest/v1/push_device_tokens?id=in.(${inList})`;
  await fetch(u, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// Web Push protocol: RFC 8291 (aes128gcm) + RFC 8292 (VAPID)
// ════════════════════════════════════════════════════════════════════════════

interface SendArgs {
  sub: PushSubscriptionRow;
  payloadBytes: Uint8Array;
  vapidPublic: string;
  vapidPrivate: string;
  vapidSubject: string;
}

type SendResult =
  | { status: 'sent'; statusCode: number; sub: PushSubscriptionRow }
  | { status: 'expired'; statusCode: number; sub: PushSubscriptionRow }
  | { status: 'error'; statusCode: number; sub: PushSubscriptionRow; error?: unknown };

async function sendWebPush(args: SendArgs): Promise<SendResult> {
  const { sub, payloadBytes, vapidPublic, vapidPrivate, vapidSubject } = args;
  try {
    const endpointUrl = new URL(sub.endpoint);
    const aud = `${endpointUrl.protocol}//${endpointUrl.host}`;

    // 1) VAPID JWT (ES256)
    const vapidJwt = await buildVapidJwt(aud, vapidSubject, vapidPrivate);

    // 2) Encryption pro payload (aes128gcm content-encoding).
    const encrypted = await encryptAes128Gcm(payloadBytes, sub.p256dh, sub.auth);

    // 3) Request final.
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${vapidJwt}, k=${vapidPublic}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: bs(encrypted),
      signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
    });

    if (res.status === 404 || res.status === 410) {
      return { status: 'expired', statusCode: res.status, sub };
    }
    if (res.status >= 200 && res.status < 300) {
      return { status: 'sent', statusCode: res.status, sub };
    }
    return { status: 'error', statusCode: res.status, sub };
  } catch (e) {
    return { status: 'error', statusCode: 0, sub, error: e };
  }
}

// ─── VAPID JWT (ES256) ──────────────────────────────────────────────────────
//
// Header: {typ:"JWT", alg:"ES256"}
// Payload: {aud:"https://endpoint-origin", exp: now+12h, sub:"mailto:..."}
// Signature: ECDSA P-256 over base64url(header).base64url(payload).

async function buildVapidJwt(
  audience: string,
  subject: string,
  vapidPrivateB64: string,
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12h
  const payload = { aud: audience, exp, sub: subject };

  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const key = await importVapidPrivateKey(vapidPrivateB64);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    bs(new TextEncoder().encode(signingInput)),
  );
  // crypto.subtle.sign retorna IEEE-P1363 (r||s) — formato esperado por JWS.
  const encSig = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${encSig}`;
}

async function importVapidPrivateKey(privateB64: string): Promise<CryptoKey> {
  // VAPID private key gerada por `web-push generate-vapid-keys` vem em
  // base64url, 32 bytes (raw P-256 scalar `d`).
  const d = base64UrlDecode(privateB64);
  if (d.length !== 32) {
    throw new Error(`VAPID_PRIVATE_KEY com tamanho inválido (${d.length} bytes, esperado 32).`);
  }
  // Pra importar precisa do public key também (web crypto exige JWK
  // completo pra ECDSA). Derivamos o ponto público a partir do escalar.
  const { x, y } = await derivePublicKey(d);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: base64UrlEncode(d),
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
}

/**
 * Deriva o ponto público P-256 a partir do escalar privado `d`.
 *
 * Não temos primitiva direta em WebCrypto pra "scalar mul on base point", mas
 * `crypto.subtle.importKey('pkcs8', ...)` aceita uma chave privada PKCS8 e
 * sua `exportKey('jwk')` devolve `x` + `y`. Montamos um PKCS8 wrap mínimo do
 * `d` e extraímos o JWK.
 */
async function derivePublicKey(d: Uint8Array): Promise<{ x: Uint8Array; y: Uint8Array }> {
  // PKCS8 (DER) wrapper pra ECPrivateKey P-256 sem `publicKey` field:
  //   SEQUENCE {
  //     INTEGER 0,                               -- version
  //     SEQUENCE { OID 1.2.840.10045.2.1 (ecPublicKey),
  //                OID 1.2.840.10045.3.1.7 (prime256v1) },
  //     OCTET STRING (containing ECPrivateKey)
  //   }
  //
  // ECPrivateKey (RFC 5915):
  //   SEQUENCE {
  //     INTEGER 1,                                -- version
  //     OCTET STRING (32 bytes, the scalar)
  //   }

  // Auditoria de webhooks 2026-09-17 — BUG DE CORRETUDE achado escrevendo o
  // teste adversarial de SSRF (que precisou de uma VAPID_PRIVATE_KEY de
  // verdade pra provar que o endpoint PERMITIDO recebe o fetch): os dois
  // comprimentos DER abaixo estavam ERRADOS — cada um contava o comprimento
  // TOTAL da estrutura (header incluso) em vez do comprimento do CONTEÚDO
  // (que é o que o campo `length` do DER declara). Resultado: a importação
  // da chave falhava com `DataError: Invalid keyData` /
  // `asn1 encoding routines::too long` — não em todo `VAPID_PRIVATE_KEY`
  // (alguns parsers ASN.1 toleram declarar length maior que o disponível em
  // certas posições), mas de forma consistente com um parser estrito, que é
  // o caso do Node/OpenSSL usado aqui pra provar o bug e, por precaução,
  // pode ser o caso do BoringSSL do V8 nos Workers também. Sem log nenhum
  // (o catch de `sendWebPush` engole silenciosamente), então push nativo
  // via Web Push (VAPID) podia estar morto em produção sem ninguém notar —
  // toda notificação teria `sent:0` pra sempre, indistinguível de "endpoint
  // expirado" ou "sem inscritos".
  const ecPrivKey = concat(
    new Uint8Array([0x30, 0x25]), // SEQUENCE — conteúdo tem 37 bytes (3 + 2 + 32)
    new Uint8Array([0x02, 0x01, 0x01]), // INTEGER 1
    new Uint8Array([0x04, 0x20]), // OCTET STRING length 32
    d,
  );
  const pkcs8 = concat(
    new Uint8Array([0x30, 0x41]), // SEQUENCE, length 65 (este já batia)
    new Uint8Array([0x02, 0x01, 0x00]), // INTEGER 0
    // AlgorithmIdentifier: ecPublicKey + prime256v1
    new Uint8Array([
      0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86,
      0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
    ]),
    // OCTET STRING que embrulha `ecPrivKey` — este tem 39 bytes NO TOTAL
    // (2 de header + 37 de conteúdo), então a OCTET STRING declara 39
    // (0x27), não 41.
    new Uint8Array([0x04, 0x27]),
    ecPrivKey,
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    bs(pkcs8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', key)) as JsonWebKey & { x: string; y: string };
  if (!jwk.x || !jwk.y) {
    throw new Error('Não foi possível derivar a chave pública VAPID a partir da privada.');
  }
  return { x: base64UrlDecode(jwk.x), y: base64UrlDecode(jwk.y) };
}

// ─── aes128gcm encryption (RFC 8291) ────────────────────────────────────────
//
// 1) Gera salt 16-byte aleatório e ephemeral ECDH keypair (P-256).
// 2) Faz ECDH(receiver_p256dh, ephemeral_priv) → shared secret.
// 3) HKDF: PRK_key = HKDF(receiver_auth, ECDH_secret, info=key_info, 32B)
//          IKM    = PRK_key
//          PRK    = HKDF(salt, IKM, "", 32B) -- já é o salt-extract
//          CEK    = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16B)
//          NONCE  = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12B)
//
//    (Atalho: spec RFC8291 usa info encoding mais complexo; reproduzimos
//    exatamente o que web-push lib faz.)
//
// 4) Plaintext recebe padding-delimiter `0x02` (último record), encripta
//    AES-128-GCM com chave CEK e nonce NONCE.
// 5) Payload final: salt(16) || rs(4, big-endian = 4096) || idlen(1=65) ||
//                   keyid(65, ephemeral_public_uncompressed) || ciphertext.

async function encryptAes128Gcm(
  plaintext: Uint8Array,
  receiverP256dhB64: string,
  receiverAuthB64: string,
): Promise<Uint8Array> {
  const receiverP256dh = base64UrlDecode(receiverP256dhB64);
  const receiverAuth = base64UrlDecode(receiverAuthB64);
  if (receiverP256dh.length !== 65) {
    throw new Error(`p256dh tamanho inválido (${receiverP256dh.length}, esperado 65).`);
  }
  if (receiverAuth.length !== 16) {
    throw new Error(`auth secret tamanho inválido (${receiverAuth.length}, esperado 16).`);
  }

  // 1) Salt + ephemeral ECDH key.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ephemeralPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeralPair.publicKey),
  );
  if (ephemeralPubRaw.length !== 65) {
    throw new Error(`ephemeral pub key tamanho inválido (${ephemeralPubRaw.length}).`);
  }

  // 2) ECDH shared secret.
  const receiverPubKey = await crypto.subtle.importKey(
    'raw',
    bs(receiverP256dh),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: receiverPubKey },
      ephemeralPair.privateKey,
      256,
    ),
  );

  // 3) HKDF — duas etapas (web-push spec).
  //
  // key_info = "WebPush: info\0" || receiver_p256dh || ephemeral_pub
  const keyInfoLabel = new TextEncoder().encode('WebPush: info\0');
  const keyInfo = concat(keyInfoLabel, receiverP256dh, ephemeralPubRaw);
  // PRK_key = HMAC-SHA256(auth_secret, ecdh_secret); IKM = HKDF-Expand(PRK_key, key_info, 32)
  const prkKey = await hmacSha256(receiverAuth, ecdhSecret);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // PRK = HMAC-SHA256(salt, IKM)
  const prk = await hmacSha256(salt, ikm);

  // CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdfExpand(prk, cekInfo, 16);

  // NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdfExpand(prk, nonceInfo, 12);

  // 4) Encriptação. Plaintext recebe terminator byte 0x02 (= last record).
  const padded = concat(plaintext, new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey('raw', bs(cek), { name: 'AES-GCM' }, false, [
    'encrypt',
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(nonce) }, aesKey, bs(padded)),
  );

  // 5) Header || ciphertext.
  //    salt(16) | rs(4, 0x00001000 = 4096) | idlen(1=65) | keyid(65)
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]); // 4096
  const idlen = new Uint8Array([0x41]); // 65
  return concat(salt, rs, idlen, ephemeralPubRaw, ciphertext);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    bs(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bs(data)));
}

/**
 * HKDF-Expand simplificado pra outputs <= 32B (basta um bloco T(1)).
 * T(1) = HMAC(PRK, info || 0x01).
 */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  if (length > 32) {
    // 32B basta pra CEK (16) e NONCE (12); IKM (32) também cabe.
    throw new Error('hkdfExpand: length > 32 não suportado (não precisa pra Web Push).');
  }
  const t1 = await hmacSha256(prk, concat(info, new Uint8Array([0x01])));
  return t1.slice(0, length);
}

// ════════════════════════════════════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════════════════════════════════════

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Cast pra `BufferSource`. Em TS 5.7+, `Uint8Array<ArrayBufferLike>` (default
 * de `new Uint8Array(n)`) não é assignable diretamente a `BufferSource` quando
 * o ArrayBuffer subjacente é `SharedArrayBuffer`. Em runtime, todas as
 * Uint8Array que criamos têm ArrayBuffer normal, então um cast unknown é
 * seguro. Usar `bs(x)` em todas as call sites de crypto.subtle.* e fetch
 * body pra ficar centralizado.
 */
function bs(view: Uint8Array): BufferSource {
  return view as unknown as BufferSource;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const std = padded.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}


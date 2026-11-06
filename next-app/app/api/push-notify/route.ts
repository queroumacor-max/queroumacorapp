// app/api/push-notify/route.ts — envio server-side de Web Push notifications.
// Release C8.
//
// Recebe `{ userIds, title, body, url?, icon? }`. Itera os `userIds`, lê as
// subscriptions via service_role (RLS bypass) e envia POST encryptado pra
// cada `endpoint` seguindo RFC 8291 (aes128gcm) + RFC 8292 (VAPID).
//
// Auth: header `x-internal-secret` precisa bater com `PUSH_INTERNAL_SECRET`.
// Não há outra forma de chamar — endpoint é interno (chamado pelo trigger
// `dispatch_push_on_notification` via pg_net, ou por código server-side
// pra testes). Resposta sempre genérica pra não vazar info sobre quais
// userIds existem.
//
// Edge runtime: usa só `crypto.subtle` + `fetch` — zero deps. Implementa
// VAPID JWT (ES256) e aes128gcm encryption inline.
//
// Cleanup: endpoints com response 404 ou 410 são removidos da tabela
// (subscription expirou / user revogou).

import type { NextRequest } from 'next/server';
import { checkRateLimit, jsonResponse, rateLimitResponse } from '@/lib/api/security';
import { pushNotifySchema } from '@/lib/api/schemas/push-notify';
// No edge do Cloudflare os secrets do painel NÃO estão em `process.env` —
// só no request context. Ver lib/api/env.ts.
import { getRuntimeEnv } from '@/lib/api/env';
// `getSupabaseUrl` vem de security.ts — o resolvedor ÚNICO. Este arquivo
// importava a versão que existia em env.ts, que lia SÓ
// `NEXT_PUBLIC_SUPABASE_URL` e por isso precisava do `|| SUPABASE_URL`
// colado no call site (mais uma ordem própria, divergente das outras).
import { getServiceKey, getSupabaseUrl } from '@/lib/api/security';
import { verifyFcmCredentials, type FcmServiceAccount } from '@/lib/api/_services/fcm';
import { enviarPush, type PushPayload } from '@/lib/api/_services/push-send';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  // ─── 1) Auth interno (constant-time-ish compare) ─────────────────────────
  const internalSecret = getRuntimeEnv('PUSH_INTERNAL_SECRET');
  if (!internalSecret) {
    // Sem secret configurado — fail closed pra evitar abuso.
    return jsonResponse({ ok: false, error: 'push_disabled' }, 503);
  }
  const provided = request.headers.get('x-internal-secret') || '';
  if (!safeCompare(provided, internalSecret)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  // ─── 2) Rate limit por IP (defesa contra leak de PUSH_INTERNAL_SECRET) ──
  // Se o secret vazar, atacante pode chamar este endpoint pra spammar push;
  // cap por IP corta o abuso na origem mesmo com auth válida.
  // FAIL-OPEN: `checkRateLimit` retorna `{ allowed: true, skipped: true }`
  // quando DB indisponível — push interno continua funcionando em incidente.
  const ip = extractIp(request);
  const rl = await checkRateLimit({
    userId: `push-notify:${ip}`,
    endpoint: 'push-notify',
    limit: 60, // 60 chamadas/min por IP — gera headroom pro pg_net normal
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  // ─── 3) Parse + valida payload via Zod (R-H10) ──────────────────────────
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400);
  }

  // ─── 3b) Diagnóstico de config FCM (antes do AAB, sem device token) ──────
  // `{"diagnose":"fcm"}` só valida se a service account obtém access token do
  // FCM — não envia nada, não precisa de userIds. Mesmo gate (x-internal-
  // secret). Serve pra confirmar as 3 envs FCM em produção antes de existir
  // qualquer token registrado (quando o envio real nem chega a autenticar).
  if (raw && typeof raw === 'object' && (raw as { diagnose?: unknown }).diagnose === 'fcm') {
    const projectId = getRuntimeEnv('FCM_PROJECT_ID');
    const clientEmail = getRuntimeEnv('FCM_CLIENT_EMAIL');
    const privateKey = getRuntimeEnv('FCM_PRIVATE_KEY');
    if (!projectId || !clientEmail || !privateKey) {
      return jsonResponse(
        { ok: false, diagnose: 'fcm', configured: false, reason: 'missing_env' },
        200,
      );
    }
    const r = await verifyFcmCredentials({
      projectId,
      clientEmail,
      privateKeyPem: privateKey,
    });
    return jsonResponse({ diagnose: 'fcm', configured: true, ...r }, 200);
  }

  const parsed = pushNotifySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { ok: false, error: 'invalid_input', issues: parsed.error.issues },
      400,
    );
  }
  const userIds = parsed.data.userIds;

  // Sinal de potencial abuso: trigger pg_net normal manda 1 userId; chamadas
  // com volume alto em um shot são suspeitas. Log warning (Cloudflare/CF logs
  // capturam) — quando @sentry/nextjs estiver no edge, virar addBreadcrumb.
  if (userIds.length > 50) {
    console.warn(
      `[push-notify] high-volume call ip=${ip} userIds=${userIds.length}`,
    );
  }

  const payload: PushPayload = {
    title: parsed.data.title,
    body: parsed.data.body,
    url: parsed.data.url,
    icon: parsed.data.icon,
    tag: parsed.data.tag,
  };

  // ─── 4) VAPID config ──────────────────────────────────────────────────────
  const vapidPublic =
    getRuntimeEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY') || getRuntimeEnv('VAPID_PUBLIC_KEY');
  const vapidPrivate = getRuntimeEnv('VAPID_PRIVATE_KEY');
  const vapidSubject = getRuntimeEnv('VAPID_SUBJECT') || 'mailto:loja@calicolors.com.br';
  const webPushOn = !!vapidPublic && !!vapidPrivate;

  // ─── 4b) FCM config (canal NATIVO, independente do VAPID) ────────────────
  const fcmProjectId = getRuntimeEnv('FCM_PROJECT_ID');
  const fcmClientEmail = getRuntimeEnv('FCM_CLIENT_EMAIL');
  const fcmPrivateKey = getRuntimeEnv('FCM_PRIVATE_KEY');
  const fcmSa: FcmServiceAccount | null =
    fcmProjectId && fcmClientEmail && fcmPrivateKey
      ? { projectId: fcmProjectId, clientEmail: fcmClientEmail, privateKeyPem: fcmPrivateKey }
      : null;

  // Nenhum dos dois canais configurado → nada a fazer. Antes, VAPID ausente
  // dava 503 e bloqueava também o nativo; agora cada canal é independente.
  if (!webPushOn && !fcmSa) {
    return jsonResponse({ ok: false, error: 'push_not_configured' }, 503);
  }

  // ─── 5) Supabase config (necessário pros dois canais) ────────────────────
  // `getSupabaseUrl()` lança 503 quando não há nenhuma URL configurada; aqui
  // a ausência vira o `supabase_not_configured` abaixo, que é a resposta que
  // esta rota já dava.
  let supabaseUrl: string | null;
  try {
    supabaseUrl = getSupabaseUrl();
  } catch {
    supabaseUrl = null;
  }
  const serviceKey = getServiceKey();
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ ok: false, error: 'supabase_not_configured' }, 503);
  }

  // `payload` já foi montado acima (após o parse do Zod).

  const r = await enviarPush(userIds, payload, {
    supabaseUrl,
    serviceKey,
    web: webPushOn
      ? { publicKey: vapidPublic as string, privateKey: vapidPrivate as string, subject: vapidSubject }
      : null,
    fcm: fcmSa,
  });
  return jsonResponse({ ok: true, ...r });
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/**
 * Extrai IP do request usando os headers que o Cloudflare Pages popula.
 * `cf-connecting-ip` é a fonte canônica; `x-forwarded-for` é fallback pra
 * outros edges (Vercel/local). Retorna 'unknown' se nenhum bater — não
 * bloqueia o request mas o rate limit ainda funciona com a string fixa.
 */
function extractIp(request: NextRequest | Request): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf;
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

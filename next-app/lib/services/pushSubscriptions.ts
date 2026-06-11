// pushSubscriptions.ts — flow de Web Push API (subscribe/unsubscribe + table
// upsert). Release C8.
//
// Fluxo:
//   1) `getPushPermissionState()` — pré-checa se o ambiente (browser+SW+VAPID)
//      suporta push antes de mostrar UI.
//   2) `subscribeToPush(userId)` — pede permission, chama
//      `registration.pushManager.subscribe(applicationServerKey: VAPID public)`,
//      e UPSERTa em `push_subscriptions` (idempotente por `endpoint`).
//   3) `unsubscribeFromPush(userId)` — chama `subscription.unsubscribe()`
//      local + delete na tabela.
//   4) `isPushSubscribed()` — checa se já tem PushSubscription ativa no SW.
//
// SSR-safe: todas as funções que tocam `navigator`/`window` checam
// `typeof window !== 'undefined'` e retornam 'unsupported' / false durante
// build/server-side rendering.
//
// VAPID public key vem de `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (inlined no bundle
// durante build). Sem ela, `subscribeToPush` joga erro direcionando pra
// configurar a env var no Cloudflare Pages.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Lê a chave pública VAPID do ambiente. Retorna `undefined` quando não
 * setada — caller é responsável por barrar o fluxo de subscribe.
 */
export function getVapidPublicKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key || typeof key !== 'string') return undefined;
  return key.trim() || undefined;
}

/**
 * Converte VAPID public key (base64url) pra `Uint8Array` que o
 * `PushManager.subscribe({applicationServerKey})` aceita.
 *
 * Web Push spec usa base64url (URL-safe alphabet, sem padding). Convertemos
 * pra base64 padrão antes de `atob`, e preenchemos o padding `=` que falta.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  // atob existe em browser e em workers; em SSR pode não existir, mas o
  // caller só chama essa função client-side (subscribeToPush).
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Estado atual da permission API. Centraliza checagens de suporte (worker,
 * Notification, PushManager) num único ponto pro UI.
 *
 * - 'unsupported' = ambiente não tem as APIs (SSR, browser muito antigo,
 *   iOS Safari < 16.4, ou PWA não-standalone no iOS).
 * - 'default'     = usuário ainda não decidiu (toggle não foi clicado).
 * - 'granted'     = OK, pode subscrever.
 * - 'denied'      = bloqueado; UI mostra como "vá nas configs do navegador".
 */
export function getPushPermissionState(): PushPermissionState {
  if (typeof window === 'undefined') return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window)) return 'unsupported';
  const p = Notification.permission;
  if (p === 'granted' || p === 'denied' || p === 'default') return p;
  return 'unsupported';
}

/**
 * Há uma subscription ativa registrada no SW deste browser? Não distingue
 * entre "nunca subscribed" e "subscribed mas inválida" — chamador trata
 * ambos como "precisa re-subscribe".
 *
 * Retorna `false` em SSR.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

interface PushSubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  last_seen_at: string;
}

/**
 * Extrai keys p256dh + auth de uma PushSubscription. Browser entrega em
 * ArrayBuffer; o servidor precisa em base64url pra usar nos VAPID headers
 * e na criptografia AES128-GCM.
 */
function pushSubscriptionToRow(
  userId: string,
  sub: PushSubscription,
): PushSubscriptionRow {
  const rawP256 = sub.getKey('p256dh');
  const rawAuth = sub.getKey('auth');
  if (!rawP256 || !rawAuth) {
    throw new Error('PushSubscription sem chaves p256dh/auth — browser não suporta encryption padrão.');
  }
  return {
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: arrayBufferToBase64Url(rawP256),
    auth: arrayBufferToBase64Url(rawAuth),
    user_agent:
      typeof navigator !== 'undefined' && navigator.userAgent
        ? navigator.userAgent.slice(0, 500)
        : null,
    last_seen_at: new Date().toISOString(),
  };
}

function arrayBufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // base64url: troca + / por - _ e remove padding =.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Pede permission (se ainda 'default'), subscreve no PushManager e UPSERTa
 * a row em `push_subscriptions` (chave única = endpoint). Idempotente:
 * re-chamar com a mesma subscription só atualiza `last_seen_at`.
 *
 * Joga `Error` quando o user negar permissão ou o VAPID não estiver
 * configurado — caller deve mostrar mensagem clara.
 */
export async function subscribeToPush(userId: string): Promise<PushSubscription> {
  if (!userId) {
    throw new Error('subscribeToPush: userId obrigatório');
  }
  if (typeof window === 'undefined') {
    throw new Error('subscribeToPush: chamado em ambiente sem window (SSR).');
  }
  if (getPushPermissionState() === 'unsupported') {
    throw new Error('Seu navegador não suporta notificações push.');
  }

  const vapidKey = getVapidPublicKey();
  if (!vapidKey) {
    throw new Error(
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY não configurada. Configure no Cloudflare Pages → Environment Variables.',
    );
  }

  // Pede permission. Em browsers modernos, Notification.requestPermission()
  // retorna Promise; em alguns Safari antigos é callback-based — wrap.
  let permission: NotificationPermission;
  try {
    const res = Notification.requestPermission();
    if (res && typeof (res as Promise<NotificationPermission>).then === 'function') {
      permission = await (res as Promise<NotificationPermission>);
    } else {
      permission = res as unknown as NotificationPermission;
    }
  } catch {
    permission = Notification.permission;
  }

  if (permission !== 'granted') {
    throw new Error('Permissão de notificação negada.');
  }

  const reg = await navigator.serviceWorker.ready;

  // Reaproveita subscription existente quando válida (idempotente).
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // Cast pra `BufferSource`: em TS 5.7 `Uint8Array<ArrayBufferLike>` não
    // satisfaz o overload diretamente, mas runtime aceita.
    const appServerKey = urlBase64ToUint8Array(vapidKey) as unknown as BufferSource;
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey,
    });
  }

  // UPSERT na tabela. `onConflict: 'endpoint'` requer UNIQUE no schema (já
  // definido na migration).
  const row = pushSubscriptionToRow(userId, sub);
  const sb = getSupabase();
  // `push_subscriptions` ainda não está no Database types — cast manual via
  // `unknown`. Quando rodar `supabase gen types`, remover o cast.
  const { error } = await (
    sb as unknown as {
      from: (t: string) => {
        upsert: (
          row: PushSubscriptionRow,
          opts: { onConflict: string },
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .from('push_subscriptions')
    .upsert(row, { onConflict: 'endpoint' });

  if (error) {
    throw new NetworkError(error.message, error);
  }

  return sub;
}

/**
 * Cancela a subscription local (browser) e deleta a row na tabela.
 * Idempotente — chamadas extras quando nada tem são no-op.
 */
export async function unsubscribeFromPush(userId: string): Promise<void> {
  if (!userId) return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;

  // Cancela no browser primeiro pra UI ficar consistente mesmo se o DELETE
  // falhar.
  try {
    await sub.unsubscribe();
  } catch {
    // ignora — pode estar já cancelado.
  }

  const sb = getSupabase();
  // Mesmo cast manual da upsert.
  const { error } = await (
    sb as unknown as {
      from: (t: string) => {
        delete: () => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    }
  )
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', userId);

  if (error) {
    throw new NetworkError(error.message, error);
  }
}

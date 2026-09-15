// push.ts — push NATIVO via @capacitor-firebase/messaging (plugin global
// `FirebaseMessaging`). ESCOLHA DELIBERADA em vez de @capacitor/push-
// notifications: aquele, no iOS, devolve o token do APNs — mas nosso
// servidor (lib/api/_services/fcm.ts) envia por FCM HTTP v1, que espera um
// token FCM. O FirebaseMessaging devolve token FCM nos DOIS sistemas (no
// iOS o Firebase faz a ponte FCM→APNs, usando a APNs Auth Key configurada
// no console), então um sender só cobre Android e iPhone.
//
// ESCOPO: só o lado do device — permissão, token e o toque na notificação.
// A persistência (push_device_tokens) é pushTokens.ts; o envio é
// /api/push-notify. O web push (VAPID/PushOptIn) é outro canal, intocado.

import { getPlugin, isNativePlatform } from './platform';

interface ListenerHandle {
  remove: () => Promise<void> | void;
}
interface ActionEvent {
  // FirebaseMessaging.notificationActionPerformed: o `data` (que o fcm.ts
  // manda com `url`) vem em `notification.data`.
  notification?: { data?: Record<string, unknown> };
}
interface FirebaseMessagingPlugin {
  requestPermissions: () => Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  // checkPermissions NÃO abre prompt — só lê o estado atual. É o que o card
  // de opt-in usa pra saber, ao montar, se já foi ativado antes.
  checkPermissions: () => Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  getToken: () => Promise<{ token: string }>;
  addListener: (
    event: 'notificationActionPerformed' | 'tokenReceived' | 'notificationReceived',
    cb: (ev: ActionEvent | { token?: string }) => void,
  ) => Promise<ListenerHandle> | ListenerHandle;
}

const PLUGIN = 'FirebaseMessaging';
const TOKEN_TIMEOUT_MS = 15_000; // lição do WebView: nada pendura sem teto

/**
 * Extrai a rota interna de destino do `data` da notificação. Pura e
 * exportada pra teste. Só aceita path relativo que começa com "/" (anti
 * open-redirect: uma notificação forjada não deve navegar pra fora).
 */
export function routeFromNotificationData(
  data: Record<string, unknown> | undefined,
): string | null {
  const url = data?.url;
  if (typeof url !== 'string') return null;
  return url.startsWith('/') && !url.startsWith('//') ? url : null;
}

/** true quando o push nativo pode ser oferecido (casca + plugin presente). */
export function isNativePushAvailable(): boolean {
  return isNativePlatform() && !!getPlugin<FirebaseMessagingPlugin>(PLUGIN);
}

/**
 * Estado ATUAL da permissão de push, SEM abrir prompt. Usado pelo card de
 * opt-in pra saber, ao MONTAR, se o push já foi ativado neste aparelho —
 * senão ele mostraria "Ativar" toda vez que o app abre (o status vivia só
 * em memória e nascia sempre desligado). Null fora da casca/sem plugin.
 */
export async function nativePushPermission(): Promise<
  'granted' | 'denied' | 'prompt' | null
> {
  const fm = getPlugin<FirebaseMessagingPlugin>(PLUGIN);
  if (!isNativePlatform() || !fm) return null;
  try {
    const perm = await fm.checkPermissions();
    return perm?.receive ?? null;
  } catch {
    return null;
  }
}

/**
 * Pede permissão e devolve o token FCM (Android e iOS). Null quando: fora da
 * casca, plugin ausente, permissão negada, erro ou timeout. `getToken()`
 * resolve direto — não precisa do register + evento do plugin antigo.
 */
export async function registerNativePush(): Promise<string | null> {
  const fm = getPlugin<FirebaseMessagingPlugin>(PLUGIN);
  if (!isNativePlatform() || !fm) return null;
  try {
    const perm = await fm.requestPermissions();
    if (perm.receive !== 'granted') return null;
    const result = await Promise.race([
      fm.getToken(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS)),
    ]);
    return result?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Lê o token FCM ATUAL sem pedir permissão nem abrir prompt nenhum — só
 * quando a permissão já foi concedida antes. Existe pra logout/troca de
 * conta no MESMO aparelho: antes de encerrar a sessão, o app precisa saber
 * qual token desassociar de `push_device_tokens` (senão o dono anterior
 * continua recebendo push depois de sair — troca de conta no mesmo device
 * vazando notificação de quem saiu). Nunca abre o prompt do sistema: rodar
 * isso no meio do signOut não pode ser a primeira vez que a pessoa vê o
 * pedido de permissão de notificação.
 */
export async function currentNativePushToken(): Promise<string | null> {
  const fm = getPlugin<FirebaseMessagingPlugin>(PLUGIN);
  if (!isNativePlatform() || !fm) return null;
  try {
    const perm = await fm.checkPermissions();
    if (perm?.receive !== 'granted') return null;
    const result = await Promise.race([
      fm.getToken(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS)),
    ]);
    return result?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Escuta a ROTAÇÃO do token FCM. O token não é eterno: muda ao limpar os
 * dados do app, ao reinstalar, e quando o próprio Firebase decide renovar.
 * Sem este listener a linha em `push_device_tokens` vira lixo apontando pra
 * um device que não existe mais — o envio "funciona" (200 do FCM) e a
 * notificação não chega em lugar nenhum. Retorna cleanup; no-op fora da casca.
 */
export function onNativePushTokenRefresh(
  onToken: (token: string) => void,
): () => void {
  const fm = getPlugin<FirebaseMessagingPlugin>(PLUGIN);
  if (!isNativePlatform() || !fm) return () => {};
  let handle: ListenerHandle | undefined;
  Promise.resolve(
    fm.addListener('tokenReceived', (ev) => {
      const t = (ev as { token?: string }).token;
      if (typeof t === 'string' && t) onToken(t);
    }),
  )
    .then((h) => {
      handle = h;
    })
    .catch(() => {
      /* plugin recusou o listener — o token só é atualizado no próximo boot */
    });
  return () => {
    try {
      void handle?.remove();
    } catch {
      /* já removido */
    }
  };
}

/**
 * Registra o handler de TOQUE na notificação: ao tocar numa push (app aberto
 * ou fechado), navega pro `data.url` que o servidor mandou. Sem isto, o toque
 * abre o app SEMPRE na tela inicial. `onNavigate` é injetado por um componente
 * client (tem o router do Next). Retorna cleanup. No-op fora da casca.
 */
export function initNativePushTapRouting(
  onNavigate: (path: string) => void,
): () => void {
  const fm = getPlugin<FirebaseMessagingPlugin>(PLUGIN);
  if (!isNativePlatform() || !fm) return () => {};
  let handle: ListenerHandle | undefined;
  Promise.resolve(
    fm.addListener('notificationActionPerformed', (ev) => {
      const path = routeFromNotificationData((ev as ActionEvent).notification?.data);
      if (path) onNavigate(path);
    }),
  )
    .then((h) => {
      handle = h;
    })
    .catch(() => {
      /* plugin recusou o listener — toque cai na tela inicial (degradação ok) */
    });
  return () => {
    try {
      void handle?.remove();
    } catch {
      /* já removido */
    }
  };
}

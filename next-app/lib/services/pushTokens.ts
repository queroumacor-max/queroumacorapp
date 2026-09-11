// pushTokens.ts — persistência de device tokens de push NATIVO (FCM/APNs).
//
// Canal separado do web push (`push_subscriptions`/VAPID): o app empacotado
// (WebView) não tem Web Push, então a casca Capacitor registra via plugin e
// o token FCM/APNs fica em `push_device_tokens` (SQL Wave 39). Mesmo padrão
// RLS user-owned do web push: o client grava a própria linha; o ENVIO
// (server → FCM) lê via service_role e é a etapa seguinte do plano.
//
import { getSupabase } from '../supabase';
import { native } from '../native';

export interface RegisterDeviceTokenResult {
  ok: boolean;
  /** 'unavailable' = fora da casca/sem plugin; 'denied' = permissão negada
   *  ou registro falhou; 'error' = gravação no banco falhou. */
  reason?: 'unavailable' | 'denied' | 'error';
}

/**
 * Grava (ou atualiza) UM token já obtido. Separado do registro porque a
 * rotação do token do FCM chega por evento, sem passar por permissão nenhuma.
 * Idempotente: UNIQUE(token) no banco + upsert. Best-effort: nunca lança.
 */
export async function saveDeviceToken(
  userId: string,
  token: string,
): Promise<RegisterDeviceTokenResult> {
  if (!userId || !token) return { ok: false, reason: 'error' };
  try {
    const sb = getSupabase();
    // RPC `register_push_token` (SECURITY DEFINER): troca o dono do token
    // quando o aparelho mudou de conta. O UPDATE direto em linha alheia
    // deixou de ser permitido pela RLS (auditoria 2026-09-11). Enquanto a
    // migration não roda, cai no upsert antigo (só a própria linha).
    const { error: rpcErr } = await sb.rpc('register_push_token' as never, {
      p_token: token,
      p_platform: native.platform(),
    } as never);
    if (!rpcErr) return { ok: true };
    const { error } = await sb.from('push_device_tokens').upsert(
      {
        user_id: userId,
        token,
        platform: native.platform(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    if (error) return { ok: false, reason: 'error' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Pede permissão, registra o device no FCM/APNs e persiste o token na conta.
 * PODE ABRIR O PROMPT do sistema — só chamar a partir de um gesto da pessoa
 * (o botão "Ativar"). Best-effort: nunca lança.
 */
export async function registerDeviceToken(
  userId: string,
): Promise<RegisterDeviceTokenResult> {
  if (!userId || !native.push.isAvailable()) {
    return { ok: false, reason: 'unavailable' };
  }
  const token = await native.push.register();
  if (!token) return { ok: false, reason: 'denied' };
  return saveDeviceToken(userId, token);
}

/**
 * Garante que ESTE aparelho tem token gravado na conta, SEM abrir prompt.
 *
 * Existe por causa da regressão de 2026-09-04: o card de opt-in passou a
 * mostrar "Ativadas neste aparelho" lendo a permissão do SO
 * (`checkPermissions`) e, com isso, escondia o botão "Ativar" — que era o
 * ÚNICO lugar que gravava o token. Quem já tinha concedido a permissão via
 * um card dizendo "ativado" com `push_device_tokens` VAZIO: o servidor
 * mandava o push pra ninguém.
 *
 * Só age com a permissão JÁ concedida. Em 'prompt' devolve sem fazer nada —
 * pedir permissão no boot, sem a pessoa ter pedido, é o que faz o usuário
 * negar pra sempre.
 */
export async function ensureDeviceToken(
  userId: string,
): Promise<RegisterDeviceTokenResult> {
  if (!userId || !native.push.isAvailable()) {
    return { ok: false, reason: 'unavailable' };
  }
  const perm = await native.push.permission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  return registerDeviceToken(userId);
}

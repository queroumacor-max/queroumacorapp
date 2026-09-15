// pushTokens.ts — persistência de device tokens de push NATIVO (FCM/APNs).
//
// Canal separado do web push (`push_subscriptions`/VAPID): o app empacotado
// (WebView) não tem Web Push, então a casca Capacitor registra via plugin e
// o token FCM/APNs fica em `push_device_tokens` (SQL Wave 39). Mesmo padrão
// RLS user-owned do web push: o client grava a própria linha; o ENVIO
// (server → FCM) lê via service_role e é a etapa seguinte do plano.
//
// AUDITORIA FCM/PUSH (2026-09-13) — TOKEN OWNERSHIP: a reassociação de um
// token (aparelho compartilhado que troca de conta) upserta por conflito de
// `token` — e a linha em conflito pode pertencer a OUTRO usuário. Fazer isso
// via `.from(...).upsert()` direto exige que a policy de UPDATE de
// `push_device_tokens` aceite atualizar uma linha de dono diferente
// (USING(true)), o que também abre a porta pra qualquer usuário autenticado
// mandar um PATCH cru filtrando por `user_id=eq.<vítima>` e SEQUESTRAR a
// linha de outra pessoa (reatribuir pra si mesmo), sem precisar conhecer o
// token dela. `upsert_push_device_token` é uma RPC SECURITY DEFINER que faz
// a mesma reatribuição (por `token`, nunca por `user_id`) mas SEMPRE grava
// `user_id = auth.uid()` no corpo da função — não no que o cliente manda —
// então a policy de UPDATE da tabela pôde voltar a ser estritamente
// `auth.uid() = user_id` (ninguém edita linha alheia via REST cru).
// Fallback pro upsert antigo SÓ quando a RPC ainda não existe no banco
// (42883/PGRST202 — SQL da migration `2026-09-13-fcm-push-hardening.sql`
// pendente), mesmo padrão `ehFuncaoAusente` usado no resto do projeto:
// recurso novo não pode derrubar o registro de push por SQL não rodado.
import { getSupabase } from '../supabase';
import { native } from '../native';

export interface RegisterDeviceTokenResult {
  ok: boolean;
  /** 'unavailable' = fora da casca/sem plugin; 'denied' = permissão negada
   *  ou registro falhou; 'error' = gravação no banco falhou. */
  reason?: 'unavailable' | 'denied' | 'error';
}

function rpcAusente(error: { code?: string } | null | undefined): boolean {
  const code = error?.code;
  return code === 'PGRST202' || code === '42883';
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
    const platform = native.platform();

    // Caminho seguro: RPC SECURITY DEFINER, dono da linha sempre = quem
    // está autenticado nesta chamada (auth.uid() dentro da função — nunca
    // o `userId` do parâmetro, que aqui só serve pro fallback legado).
    const rpc = await sb.rpc('upsert_push_device_token' as never, {
      p_token: token,
      p_platform: platform,
    } as never);
    if (!rpc.error) return { ok: true };
    if (!rpcAusente(rpc.error as { code?: string })) {
      return { ok: false, reason: 'error' };
    }

    // Fallback: SQL da hardening ainda não rodou neste ambiente. Mesmo
    // comportamento de antes (RLS mais permissiva na tabela até a migration
    // rodar) — registrar push continua funcionando, só sem o reforço.
    const { error } = await sb.from('push_device_tokens').upsert(
      {
        user_id: userId,
        token,
        platform,
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

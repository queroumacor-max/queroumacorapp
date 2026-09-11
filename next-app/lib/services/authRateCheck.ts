// authRateCheck.ts — pré-checagem de rate limit dos formulários de auth.
//
// `/api/auth-rate-check` existia desde o port do vanilla e NENHUM formulário
// o chamava (auditoria de autenticação, 2026-09-11): o limite por IP de
// login/cadastro/reset era código morto. Aqui ele volta a valer — como
// camada ADVISORY, e é importante ser honesto sobre isso: quem ataca
// chamando o GoTrue direto não passa por aqui; a defesa real contra força
// bruta é o rate limit do próprio Supabase Auth (painel → Auth → Rate
// Limits) e o WAF do Cloudflare. Esta camada barra o abuso feito PELA UI e
// dá ao operador um contador por IP.
//
// FAIL-OPEN por construção: rede fora, 5xx, timeout → o formulário segue.
// Um blip nunca pode trancar o login de todo mundo. Só o 429 explícito
// bloqueia. Teto de 3s porque promessa pendurada em WebView não rejeita.

export type AuthAction = 'login' | 'signup' | 'reset';

export interface AuthRateVerdict {
  blocked: boolean;
  /** Segundos até poder tentar de novo (só quando `blocked`). */
  retryAfter?: number;
}

const TIMEOUT_MS = 3000;

export async function preCheckAuthRate(
  action: AuthAction,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthRateVerdict> {
  try {
    const res = await fetchImpl('/api/auth-rate-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
      credentials: 'same-origin',
      signal: typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
        ? AbortSignal.timeout(TIMEOUT_MS)
        : undefined,
    });
    if (res.status !== 429) return { blocked: false };
    let retryAfter = 60;
    try {
      const j = (await res.json()) as { retry_after?: unknown };
      if (typeof j?.retry_after === 'number' && j.retry_after > 0) retryAfter = j.retry_after;
    } catch {
      /* corpo não-JSON: fica o default */
    }
    return { blocked: true, retryAfter };
  } catch {
    return { blocked: false };
  }
}

/** Frase única pros três formulários. */
export function mensagemDeLimite(v: AuthRateVerdict): string {
  const s = v.retryAfter ?? 60;
  return `Muitas tentativas. Aguarde ${s}s e tente de novo.`;
}

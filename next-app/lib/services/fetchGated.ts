// fetchGated — fetch para as rotas protegidas por `gateProAI`/`gateProAIForm`,
// com UMA renovação de sessão em caso de 401.
//
// POR QUE (2026-09-04, diagnosticado em produção pelo `reason` do 401): o
// servidor respondia `Faça login (token_invalid)` com o usuario logado e o
// token sendo enviado. `token_invalid` significa que o GoTrue (/auth/v1/user)
// recusou o token — enquanto o MESMO token seguia valendo no PostgREST (feed e
// perfil carregavam normalmente).
//
// Isso e a assinatura da SESSAO ROTACIONADA, ja registrada no CLAUDE.md no
// incidente do PDF de orcamento: o PostgREST valida so assinatura + expiracao
// (aceita), o GoTrue valida a sessao no servidor (recusa). O remedio la foi o
// mesmo daqui — uma `refreshSession` com teto de tempo.
//
// Contrato: tenta; se vier 401, renova a sessao UMA vez e repete. Nunca entra
// em laco (uma tentativa extra, e so). Se a renovacao falhar, devolve a
// resposta 401 original — a tela mostra o mesmo que mostraria hoje.

import { getSupabase } from '../supabase';
import { authHeaders } from './authHeaders';
import { PRO_REQUIRED_CODE } from '../aiTrial';
import { abrirPaywall } from '../paywallEvents';

// Mesmo racional do authHeaders: no WebView promessa de rede pendurada nao
// rejeita, entao renovar tambem precisa de teto.
const REFRESH_TIMEOUT_MS = 6_000;

/** Renova a sessao. `true` se saiu token novo. Best-effort: nunca lanca. */
export async function refreshSessionOnce(): Promise<boolean> {
  try {
    const sb = getSupabase();
    const ok = await Promise.race([
      sb.auth
        .refreshSession()
        .then((r) => !!r?.data?.session?.access_token)
        .catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS)),
    ]);
    return ok;
  } catch {
    return false;
  }
}

/**
 * `fetch` que anexa o token e, no 401, renova a sessao e repete UMA vez.
 *
 * O body pode ser reenviado com seguranca nos casos daqui (string JSON ou
 * FormData — nenhum e stream de uso unico).
 */
export async function fetchGated(url: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...(await authHeaders()) },
    });

  const res = await attempt();
  if (res.status === 403) avisarSeProObrigatorio(res);
  if (res.status !== 401) return res;

  const renovou = await refreshSessionOnce();
  if (!renovou) return res; // sem sessao nova: devolve o 401 original
  const res2 = await attempt();
  if (res2.status === 403) avisarSeProObrigatorio(res2);
  return res2;
}

/**
 * 403 com `code: 'pro_required'` (teste gratis da IA acabou) abre a tela de
 * assinatura. Le um CLONE: a tela que chamou continua lendo a resposta e
 * mostrando o erro como sempre. Best-effort: nunca lanca.
 */
function avisarSeProObrigatorio(res: Response): void {
  try {
    res
      .clone()
      .json()
      .then((j: { code?: unknown } | null) => {
        if (j?.code === PRO_REQUIRED_CODE) abrirPaywall('ia');
      })
      .catch(() => {});
  } catch {
    /* corpo ja lido ou indisponivel */
  }
}

// reportFailure — manda pro `/api/log-error` uma falha que o usuário JÁ
// está vendo na tela.
//
// Motivo (2026-08-29): um pintor reportou que não conseguia trocar a foto
// nem publicar portfólio. A tabela `errors` estava vazia pra ele — e eu
// li isso como "não houve falha". Estava errado: erro CAPTURADO (o catch
// do upload, o `error` da mutation) vira faixa vermelha na tela e MORRE
// ali. Só erro não capturado chega no `/api/log-error`. Ou seja, a tabela
// vazia não dizia nada sobre esses fluxos.
//
// Agora as duas mãos que mais falham em celular (subir foto de perfil e
// publicar post) avisam o servidor, com o `user_id`. Assim dá pra ver em
// `/admin/errors` o que a pessoa viu, sem depender dela transcrever a
// mensagem.
//
// Best-effort de verdade: nunca lança, nunca espera. Se o log falhar, o
// usuário nem fica sabendo — ele já tem o erro na tela.

/**
 * Tipos usados hoje, com o rótulo que o /admin/errors mostra no filtro.
 *
 * É um `Record` de propósito: tipo novo aqui sem rótulo NÃO COMPILA, e é o
 * que impede o dashboard de envelhecer em silêncio. Ele já tinha: eram 12
 * tipos gravados e 2 filtros na tela, e o chip de destaque era de um
 * diagnóstico apagado em 30/08. Quem foi procurar um `publish-fail` não
 * tinha por onde.
 *
 * `type` do schema tem teto de 32 chars.
 */
export const FAILURE_TYPE_LABELS = {
  'publish-fail': '📤 Publicar',
  'avatar-fail': '🖼️ Foto de perfil',
  'video-fail': '🎬 Vídeo',
  'picker-fail': '📂 Seletor',
  'picker-restart': '♻️ App reiniciou',
  'camera-fail': '📷 Câmera',
  'pdf-link-fail': '📄 PDF do orçamento',
  'render-error': '💥 Tela quebrou',
  'profile-load-fail': '👤 Perfil',
  'feed-extras-fail': '📰 Feed',
  'consent-fail': '✍️ Consentimento',
  'sw-status': '⚙️ Service worker',
  'oauth-fail': '🔑 Login social',
  'profile-incomplete': '🪪 Perfil incompleto',
} as const satisfies Record<string, string>;

export type FailureType = keyof typeof FAILURE_TYPE_LABELS;

export function reportFailure(
  type: FailureType,
  err: unknown,
  opts?: { userId?: string | null; ctx?: string },
): void {
  if (typeof window === 'undefined') return;
  try {
    const e = err as
      | { message?: string; name?: string; stack?: string; cause?: unknown }
      | null;
    // A mensagem que o usuário vê costuma ser a TRADUZIDA ("Falha de rede ao
    // enviar a mídia (1,3 MB)") — boa pra ele, inútil pra quem depura: ela
    // apaga o texto do servidor, que é o que diz se foi RLS, mime recusado,
    // quota ou o TypeError cru do fetch. Anexamos a causa quando existe.
    const causa = e?.cause as { message?: string } | null | undefined;
    const causaMsg = causa && typeof causa === 'object' ? String(causa.message ?? '') : '';
    const msg = [
      e?.message || String(err) || 'erro sem mensagem',
      causaMsg ? `| causa: ${causaMsg}` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1000);
    const corpo = JSON.stringify({
      type,
      user_id: opts?.userId || null,
      msg: `${e?.name ? e.name + ': ' : ''}${msg}`,
      stack: e?.stack ? String(e.stack).slice(0, 5000) : undefined,
      ua: navigator.userAgent?.slice(0, 500),
      url: location.href.slice(0, 500),
      ctx: opts?.ctx?.slice(0, 500),
    });
    // O servidor só aceita `user_id` assinado pelo Bearer da sessão (rota
    // pública; sem isso qualquer um gravava em nome de qualquer um). O
    // token é lido com teto: sessão travada não pode segurar o log.
    void tokenDaSessao().then((token) =>
      fetch('/api/log-error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: corpo,
        keepalive: true,
      }).catch(() => {}),
    );
  } catch {
    /* logar nunca pode custar nada a quem já está com problema */
  }
}

const TOKEN_TIMEOUT_MS = 1500;

async function tokenDaSessao(): Promise<string | null> {
  try {
    const { getSupabase } = await import('@/lib/supabase');
    const sessao = getSupabase().auth.getSession();
    const teto = new Promise<null>((resolve) => setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS));
    const r = await Promise.race([sessao, teto]);
    return r && 'data' in r ? (r.data.session?.access_token ?? null) : null;
  } catch {
    return null;
  }
}

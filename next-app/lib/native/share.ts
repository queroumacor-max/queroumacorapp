// share.ts — share sheet nativo, com o Web Share API como fallback natural.
//
// Retorna true quando o compartilhamento foi ENTREGUE a alguma share sheet
// (nativa ou web) OU o usuário cancelou — nos dois casos o caller não deve
// mostrar mais nada por cima. false = nenhum mecanismo disponível OU o share
// falhou por outro motivo (ex.: `navigator.share` sem user-activation válida)
// — o caller cai pro fallback manual de sempre (copiar link / botão WhatsApp).
//
// 2026-09-19: `navigator.share()` espera interação do usuário com uma UI do
// sistema — em ambiente sem essa UI (ex.: browser controlado por automação,
// alguns WebViews antigos) a promessa pode nunca resolver NEM rejeitar,
// travando o botão pra sempre sem toast/modal/menu nenhum (mesma classe de
// bug já documentada em getSession/getUserMedia/OAuth neste projeto: "no
// WebView, promessa pendurada não rejeita"). `withTimeout` garante que o
// caller SEMPRE recebe uma resposta e cai pro fallback de copiar.

import { getPlugin, isNativePlatform } from './platform';

const SHARE_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('share timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

interface SharePlugin {
  share: (opts: {
    title?: string;
    text?: string;
    url?: string;
  }) => Promise<unknown>;
}

export interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
}

export async function shareNative(payload: SharePayload): Promise<boolean> {
  // 1º: share sheet da casca nativa.
  const plugin = getPlugin<SharePlugin>('Share');
  if (isNativePlatform() && plugin) {
    try {
      await withTimeout(plugin.share(payload), SHARE_TIMEOUT_MS);
      return true;
    } catch (e) {
      // Cancelamento do usuário conta como "entregue" (não cair pro fallback
      // e abrir OUTRO share em cima do cancelamento). Timeout NÃO conta —
      // cai pro fallback, que sempre dá algum feedback.
      const msg = e instanceof Error ? e.message : String(e);
      return /cancel/i.test(msg);
    }
  }
  // 2º: Web Share API (mobile browsers / PWA).
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await withTimeout(navigator.share(payload), SHARE_TIMEOUT_MS);
      return true;
    } catch (e) {
      // Só cancelamento conta como "entregue" — qualquer outro erro (sem
      // user-activation, timeout, não suportado) cai pro fallback de copiar.
      return e instanceof Error && e.name === 'AbortError';
    }
  }
  return false;
}

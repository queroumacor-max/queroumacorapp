// openInBrowser — tira a pessoa do app e joga no navegador do celular.
//
// Motivo (2026-08-30): quando a WebView do wrapper não abre a galeria, a
// única saída garantida é usar o site pelo Chrome. Até aqui o app mandava
// um toast pedindo pra DIGITAR "queroumacor.com.br" — some em 3s e cobra
// da pessoa justamente o que ela não vai fazer. Agora é um botão.
//
// Dentro de uma WebView, `window.open`/`target=_blank` normalmente abre
// outra WebView do MESMO app (ou nada). O que o Android entende como "vai
// pro navegador de verdade" é a URL `intent:` com `action=VIEW`: quem
// resolve é o sistema, e o app aparece na lista só se declarar o domínio
// (o nosso não declara).
//
// Falhar aqui é silencioso — igual ao seletor. Por isso reaproveitamos o
// `watchAppLeave`: se em ~1,8s a página não perdeu o foco, nada abriu e o
// chamador mostra o plano B (copiar o link).

import { watchAppLeave } from './filePickerWatch';

/** `https://x/y?z` → `intent://x/y?z#Intent;scheme=https;action=…;end` */
export function intentUrl(url: string): string {
  // Só http(s): outro esquema entraria inteiro no `intent://`. E o
  // fragmento sai — o Android lê o PRIMEIRO `#Intent;…;end`, então um `#`
  // na URL escolheria o pacote/esquema de destino (auditoria 2026-09-11).
  if (!/^https?:\/\//i.test(url)) throw new Error('intentUrl: só http(s)');
  const semEsquema = url.replace(/^https?:\/\//i, '').split('#')[0];
  return `intent://${semEsquema}#Intent;scheme=https;action=android.intent.action.VIEW;end`;
}

function ehAndroid(ua: string): boolean {
  return /Android/i.test(ua || '');
}

/**
 * Tenta abrir `url` fora do app. Chame DENTRO do gesto do toque.
 * `onNaoAbriu` roda quando nada aconteceu (aí é hora de copiar o link).
 */
export function abrirNoNavegador(
  url: string,
  opts?: { onNaoAbriu?: () => void; userAgent?: string },
): void {
  if (typeof window === 'undefined') return;
  const ua = opts?.userAgent ?? navigator.userAgent ?? '';
  const cancelar = watchAppLeave(() => opts?.onNaoAbriu?.(), { timeoutMs: 1800 });

  if (ehAndroid(ua)) {
    // `location.href` e não `window.open`: o open é bloqueado por
    // popup-blocker e, na WebView, costuma abrir outra aba do próprio app.
    try {
      window.location.href = intentUrl(url);
      return;
    } catch {
      /* cai pro caminho comum */
    }
  }

  const aba = window.open(url, '_blank', 'noopener,noreferrer');
  if (!aba) {
    cancelar();
    opts?.onNaoAbriu?.();
  }
}

/** Copiar o link é o último recurso — funciona até sem `navigator.clipboard`. */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* segue pro fallback */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

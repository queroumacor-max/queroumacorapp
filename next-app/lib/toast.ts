// toast.ts — pub/sub minimalista pra mensagens efêmeras (estilo `toast()`
// do vanilla em app.js). Sem provider/context — usa module-level
// EventTarget pra qualquer client component (ou service) disparar
// `showToast(msg)` e o ToastViewport renderiza/expira sozinho.
//
// Por que não dependency? Toast precisa zero estado global e zero
// re-render fora do viewport. Pub/sub é leve e desacoplado.

'use client';

import { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  // 'success' = check verde, 'error' = vermelho, 'info' = neutro
  variant?: 'success' | 'error' | 'info';
}

const target = new EventTarget();
let counter = 0;

export function showToast(text: string, variant: ToastMessage['variant'] = 'info') {
  if (typeof window === 'undefined') return; // SSR no-op
  counter += 1;
  const msg: ToastMessage = { id: counter, text, variant };
  target.dispatchEvent(new CustomEvent('toast', { detail: msg }));
}

// Hook pra ToastViewport — mantém a fila atual, escuta novos toasts,
// auto-dismiss em 3s cada (vanilla padrão).
export function useToastQueue(autoCloseMs = 3000): ToastMessage[] {
  const [queue, setQueue] = useState<ToastMessage[]>([]);

  useEffect(() => {
    function handle(e: Event) {
      const ce = e as CustomEvent<ToastMessage>;
      const msg = ce.detail;
      setQueue((q) => [...q, msg]);
      window.setTimeout(() => {
        setQueue((q) => q.filter((t) => t.id !== msg.id));
      }, autoCloseMs);
    }
    target.addEventListener('toast', handle);
    return () => target.removeEventListener('toast', handle);
  }, [autoCloseMs]);

  return queue;
}

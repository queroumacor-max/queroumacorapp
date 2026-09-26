'use client';

// Trava de "clique duplo" (double-submit) pra ações que gravam algo.
//
// Por que não basta `mutation.isPending`: no React Query v5 o isPending só
// chega no DOM (botão `disabled`) num render POSTERIOR ao `mutate()`. Um
// segundo toque rápido cai antes desse render e dispara a mutation de novo
// — pedido duplicado, lançamento em dobro, dois posts. A trava aqui é um
// `useRef` checado de forma SÍNCRONA no início da chamada: a segunda chamada
// vê o lock já armado e é ignorada, sem depender de render nenhum.
//
// O `isPending` continua valendo pro visual (botão cinza / "Salvando…"); a
// trava só garante que a ação roda UMA vez por vez.

import { useState } from 'react';

export interface SingleFlight {
  /** Roda `fn` se nada estiver em voo; senão ignora e devolve `undefined`.
   *  Erro de `fn` é repassado (a trava é solta no `finally` de todo jeito). */
  run: <T>(fn: () => Promise<T> | T) => Promise<T | undefined>;
  /** Leitura síncrona da trava (útil em handler que precisa decidir antes). */
  isLocked: () => boolean;
}

/**
 * Núcleo puro (sem React) — testável e reaproveitável fora de componente.
 * `onChange` é avisado quando a trava arma/solta (o hook usa pra `busy`).
 */
export function createSingleFlight(onChange?: (busy: boolean) => void): SingleFlight {
  let locked = false;
  return {
    isLocked: () => locked,
    run: async <T,>(fn: () => Promise<T> | T): Promise<T | undefined> => {
      if (locked) return undefined;
      locked = true;
      onChange?.(true);
      try {
        return await fn();
      } finally {
        locked = false;
        onChange?.(false);
      }
    },
  };
}

/**
 * Hook: `const { run, busy } = useSingleFlight();`
 *
 *   onSubmit={() => { run(() => mutation.mutateAsync(vars)).catch(() => {}) }}
 *
 * `run` é estável entre renders. `busy` é só informativo (visual); a
 * decisão de ignorar o 2º toque é SEMPRE pela ref, nunca pelo state.
 */
export function useSingleFlight(): SingleFlight & { busy: boolean } {
  const [busy, setBusy] = useState(false);
  // Criado UMA vez via inicializador do useState (ler/escrever ref durante o
  // render é proibido pelo react-hooks/refs). setState depois de desmontar é
  // no-op silencioso no React 18+, então não precisa de guarda de "montado".
  const [flight] = useState(() => createSingleFlight(setBusy));
  return { run: flight.run, isLocked: flight.isLocked, busy };
}

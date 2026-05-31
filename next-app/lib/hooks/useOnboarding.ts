// useOnboarding — controla a exibição do tutorial inicial (5 steps).
// Persistência em localStorage com fallback gracioso (try/catch) pra cobrir
// modo anônimo do Safari e contextos onde Storage lança SecurityError.
// Em SSR o hook devolve `show=false` no render inicial (estado padrão) e
// só consulta o storage no useEffect do client, evitando hydration mismatch.

'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'onboarding_seen_v1';

// Wrapper safe pro localStorage. Em incognito do Safari (e em iframes com
// storage bloqueado) o acesso lança — pega o erro e degrada pra mostrar
// o onboarding (não dá pra persistir, mas pelo menos não quebra a página).
function safeGetItem(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    // silencioso — sem storage, próximo carregamento mostra o onboarding
    // de novo, mas é melhor do que crashar.
  }
}

export interface UseOnboardingReturn {
  show: boolean;
  dismiss: () => void;
}

export function useOnboarding(): UseOnboardingReturn {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!safeGetItem(KEY)) setShow(true);
  }, []);

  const dismiss = useCallback(() => {
    safeSetItem(KEY, '1');
    setShow(false);
  }, []);

  return { show, dismiss };
}

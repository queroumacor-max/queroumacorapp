// useOfereceCamera — "mostro o botão de tirar foto?", sem quebrar a
// hidratação.
//
// `ofereceCamera()` olha `navigator.mediaDevices` e `matchMedia('(pointer:
// coarse)')` — no servidor nada disso existe, então chamar direto no render
// faz o HTML do servidor (sem botão) divergir do primeiro render do cliente
// (com botão) e o React reclama de hydration mismatch. Por isso a resposta
// só muda depois de montar.

'use client';

import { useEffect, useState } from 'react';
import { ofereceCamera } from '@/lib/utils/camera';

export function useOfereceCamera(): boolean {
  const [pode, setPode] = useState(false);
  useEffect(() => {
    // Sincroniza com sistema externo (navigator/matchMedia) — não é
    // derivável no render/SSR (comentário acima).
    setPode(ofereceCamera());
  }, []);
  return pode;
}

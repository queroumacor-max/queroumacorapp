// QueryProvider — wrapper do TanStack Query pra toda a árvore do Next.js.
// Vive como client component porque QueryClientProvider usa Context (browser
// only). É montado no layout.tsx DENTRO do AuthProvider, então qualquer hook
// que precise de `user` + cache (useNotifications, futuros useProfile, etc.)
// já tem ambos disponíveis.
//
// Por que `useState(() => new QueryClient(...))`?
//  - Garante que o mesmo QueryClient sobreviva entre re-renders do provider
//    (caso o pai re-renderize sem trocar). Se chamássemos `new QueryClient()`
//    direto, cada render do RootLayout zeraria o cache.
//  - O lazy initializer (`() => ...`) evita criar um client novo a cada render
//    pra descartar logo depois.
//
// staleTime: 30s — alinhado com useNotifications. Mesmo padrão pra todas as
// queries por enquanto; quando algum feature precisar de janela diferente,
// override por query (ver useNotifications que repete o 30_000 localmente
// como auto-documentação).
//
// retry: 1 — uma retentativa, suficiente pra absorver flakes de rede sem
// hammerizar o backend. Default do TanStack é 3, que é demais pra mobile.

'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

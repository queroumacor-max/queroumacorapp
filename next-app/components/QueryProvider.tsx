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

import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  hydrateQueryCache,
  installQueryPersistence,
} from '@/lib/queryPersistence';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const c = new QueryClient({
      defaultOptions: {
        queries: {
          // 60s default — snappy o suficiente pra navegação rápida não
          // refazer queries que acabaram de carregar, e curto o bastante
          // pra dados sociais (likes, comments) atualizarem em refocus.
          // Hooks específicos podem sobrescrever pra cima (ex.: perfil
          // próprio 5min) ou pra baixo (real-time chat 5s).
          staleTime: 60_000,
          // gcTime 10min: mantém queries inativas em memória pra navegação
          // back/forward não precisar refetch. Default TanStack é 5min.
          gcTime: 10 * 60 * 1000,
          retry: 1,
          refetchOnWindowFocus: false,
        },
      },
    });
    // Hidrata SÍNCRONO no init do client — antes do primeiro render dos
    // consumers. Isso é o que faz o refresh mostrar dados instantaneamente
    // (em vez de skeleton zerado por 2-7s). useEffect rodaria DEPOIS do
    // mount, perdendo o paint inicial.
    hydrateQueryCache(c);
    return c;
  });

  // Subscribe ao cache pra salvar em localStorage (throttle 1s). Cleanup
  // remove o listener quando provider desmonta.
  useEffect(() => {
    return installQueryPersistence(client);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

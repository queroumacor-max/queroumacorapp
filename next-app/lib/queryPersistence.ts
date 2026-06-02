// queryPersistence.ts — persiste o cache do TanStack Query em localStorage
// pra que refresh mostre os dados ANTERIORES instantaneamente enquanto
// refetch roda em background. Antes: cada refresh limpava o cache → user via
// 2-7s de skeleton/0/GRÁTIS antes do Supabase responder.
//
// Decisões:
//  - Sem dep nova (@tanstack/react-query-persist-client é a opção oficial mas
//    adiciona ~8kb; nosso caso é simples). 30 linhas de hand-rolled cobrem.
//  - Persiste só queries com `dataUpdatedAt` recente (último 1 dia) e que
//    sejam read-only / idempotentes (profile, feed, notifications, financeiro,
//    pipeline, points). Mutations/login não tocam aqui.
//  - Throttle de 1s pra escrita: tanstack dispara muitos events; salvar a
//    cada um faria localStorage.setItem virar bottleneck.
//  - Tamanho cap em 2MB pra não explodir quota; fila simples descarta queries
//    mais antigas quando passa.

import type { QueryClient, QueryCacheNotifyEvent } from '@tanstack/react-query';

const STORAGE_KEY = 'quc:tq-cache:v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const THROTTLE_MS = 1000;

// Lista de prefixos cuja primeira chave bate — só persistimos esses.
// Add aqui quando uma query nova for "vale persistir entre refreshes".
const PERSIST_PREFIXES = [
  'profile',
  'feed',
  'notifications',
  'financeiro',
  'pipeline',
  'points',
  'leads',
  'agenda',
  'crm',
  'pedidos',
  'post-comments',
  'art-listings',
];

interface PersistedEntry {
  queryKey: unknown[];
  state: {
    data: unknown;
    dataUpdatedAt: number;
    error: null;
    status: 'success';
  };
}

function shouldPersist(key: readonly unknown[]): boolean {
  const head = key[0];
  return typeof head === 'string' && PERSIST_PREFIXES.includes(head);
}

export function hydrateQueryCache(qc: QueryClient): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { entries: PersistedEntry[]; savedAt: number };
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return;
    const now = Date.now();
    if (now - parsed.savedAt > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    for (const entry of parsed.entries) {
      if (!shouldPersist(entry.queryKey)) continue;
      if (now - entry.state.dataUpdatedAt > MAX_AGE_MS) continue;
      qc.setQueryData(entry.queryKey, entry.state.data, {
        updatedAt: entry.state.dataUpdatedAt,
      });
    }
  } catch {
    // Cache corrompido — descarta e segue. Pior caso: refresh sem cache (=hoje).
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(qc: QueryClient) {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const cache = qc.getQueryCache();
      const entries: PersistedEntry[] = [];
      for (const q of cache.getAll()) {
        if (q.state.status !== 'success') continue;
        if (!shouldPersist(q.queryKey)) continue;
        if (q.state.data === undefined) continue;
        entries.push({
          queryKey: q.queryKey as unknown[],
          state: {
            data: q.state.data,
            dataUpdatedAt: q.state.dataUpdatedAt,
            error: null,
            status: 'success',
          },
        });
      }
      // Ordena por dataUpdatedAt desc — pra dropar os mais antigos se passar do cap.
      entries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
      let serialized = JSON.stringify({ entries, savedAt: Date.now() });
      while (serialized.length > MAX_BYTES && entries.length > 1) {
        entries.pop();
        serialized = JSON.stringify({ entries, savedAt: Date.now() });
      }
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // QuotaExceededError ou similar: limpa pra não ficar preso e segue.
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, THROTTLE_MS);
}

/** Subscribe ao cache pra salvar updates em localStorage. NÃO hidrata —
 *  o caller é responsável (queremos hidratar SÍNCRONO no init do QueryClient,
 *  antes do primeiro render; ver QueryProvider). */
export function installQueryPersistence(qc: QueryClient): () => void {
  if (typeof window === 'undefined') return () => {};
  const unsub = qc.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type === 'added' || event.type === 'updated' || event.type === 'removed') {
      scheduleSave(qc);
    }
  });
  return unsub;
}

export function clearQueryPersistence(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

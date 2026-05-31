// useNotifications — hook React que centraliza a leitura/escrita da tabela
// `notifications` via TanStack Query, com invalidação automática a partir de
// um channel Supabase Realtime.
//
// Substitui o trio vanilla (modules/notif.js: loadNotifications,
// updateNotifBadge, setupNotifSubscription) por um state management
// declarativo:
//   - useQuery faz o cache + revalidação, com staleTime de 30s pra não
//     bater no banco a cada navegação dentro da SPA;
//   - useEffect monta o channel Realtime e invalida a queryKey em INSERT
//     (o markRead/markAll também invalida via onSuccess das mutations);
//   - unreadCount é derivado em memória do array — não precisa de query
//     separada (ao contrário do vanilla que mantinha `_notifBadgeShown` como
//     state imperativo).
//
// O cleanup do channel via `removeChannel` é OBRIGATÓRIO: sem ele, navegar
// pra outra rota mantém a subscription pendurada e cada nova montagem
// adiciona uma duplicata (vazamento + double-invalidate).

'use client';

import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import {
  fetchNotifications,
  markAsRead,
  markAllAsRead,
  type NotificationsPage,
} from '@/lib/services/notifications';
import type { Notification } from '@/lib/types';

const NOTIF_PAGE_SIZE = 50;

export interface UseNotificationsResult {
  notifications: Notification[];
  loading: boolean;
  error: Error | null;
  unreadCount: number;
  markRead: (id: string) => void;
  markAll: () => void;
  isMarking: boolean;
  // Paginação (opt-in pro UI usar quando quiser scroll infinito).
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

export function useNotifications(): UseNotificationsResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  // queryKey inclui user.id pra isolar caches entre sessões diferentes (ex.:
  // troca de conta sem refresh) e pra que `enabled` desative com user null.
  // pageParam é cursor ISO timestamp (null = primeira página).
  const query = useInfiniteQuery<
    NotificationsPage,
    Error,
    InfiniteData<NotificationsPage, string | null>,
    readonly unknown[],
    string | null
  >({
    queryKey: ['notifications', user?.id],
    queryFn: ({ pageParam, signal }) =>
      fetchNotifications(user!.id, {
        cursor: pageParam,
        limit: NOTIF_PAGE_SIZE,
        signal,
      }),
    enabled: !!user,
    initialPageParam: null,
    getNextPageParam: (lastPage) => {
      if (!lastPage || !lastPage.hasMore || !lastPage.nextCursor) return undefined;
      return lastPage.nextCursor;
    },
    staleTime: 30_000,
  });

  // Realtime: revalida cache quando nova notif INSERT bate na publicação
  // `supabase_realtime` (configurada no SQL — supabase_init.sql linha 1047).
  // Filter por user_id pra não receber broadcast de outros usuários (o
  // channel já é per-user pelo nome, mas o filter blinda contra config drift).
  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();
    const channel = sb
      .channel('notifications:' + user.id)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['notifications', user.id] });
        }
      )
      .subscribe();

    return () => {
      // removeChannel desinscreve E remove o channel da pool interna —
      // unsubscribe() sozinho deixa o channel órfão.
      sb.removeChannel(channel);
    };
  }, [user, qc]);

  const markReadMutation = useMutation<void, Error, string>({
    mutationFn: (id: string) => markAsRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });

  const markAllMutation = useMutation<void, Error, void>({
    mutationFn: () => markAllAsRead(user!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });

  const notifications = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    loading: query.isLoading,
    error: query.error ?? null,
    unreadCount,
    markRead: markReadMutation.mutate,
    markAll: markAllMutation.mutate,
    isMarking: markReadMutation.isPending || markAllMutation.isPending,
    hasMore: !!query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        query.fetchNextPage();
      }
    },
  };
}

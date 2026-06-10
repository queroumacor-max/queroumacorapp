// useUnreadMessageCount — espelha useUnreadNotificationCount mas pra
// mensagens não lidas. Alimenta o badge do ícone de chat na TopNav.
//
// Backed por RPC unread_message_count (Wave 24). Realtime subscribe em
// messages filtrado por receiver_id pra invalidar quando msg chega ou
// quando o user marca como lida.

'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';
import { fetchUnreadMessageCount } from '@/lib/services/chat-messages';

const KEY_BASE = 'messages-unread-count' as const;

export function useUnreadMessageCount(): number {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [KEY_BASE, user?.id],
    enabled: !!user,
    queryFn: fetchUnreadMessageCount,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();
    const channel = sb
      .channel(`msg-count:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `receiver_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: [KEY_BASE, user.id] });
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [user, qc]);

  return query.data ?? 0;
}

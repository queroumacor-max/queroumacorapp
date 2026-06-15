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
    // 15s (era 60s): o badge precisa ficar fresco. Combina com
    // refetchOnWindowFocus pra reaparecer quando o user volta pro app.
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: [KEY_BASE, user.id] });
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
        invalidate,
      )
      // Piggyback no realtime de `notifications` (comprovadamente entregue —
      // é o que acende o sininho). Receber mensagem dispara o sininho; aqui
      // usamos o MESMO evento pra revalidar o contador de chat, garantindo
      // que o badge de mensagem acenda junto, mesmo se o realtime da tabela
      // `messages` não disparar (divergência de publication/RLS no DB).
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        invalidate,
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [user, qc]);

  return query.data ?? 0;
}

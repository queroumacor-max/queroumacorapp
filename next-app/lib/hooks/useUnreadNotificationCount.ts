// useUnreadNotificationCount — versão leve do useNotifications focada em só
// fornecer o contador de não-lidas pro badge do sininho na BottomNav.
//
// Por que não reusar useNotifications:
//   - useNotifications puxa 50 rows (infinite query) — caro pra rodar em toda
//     navegação (BottomNav renderiza em quase toda rota);
//   - aqui usamos COUNT exato com head:true → sem rows, só o número.
//
// Realtime: invalida o cache em qualquer mudança em notifications do user
// (INSERT pra nova notif, UPDATE pra mark_as_read). Também invalida o cache
// de useNotifications pra a lista ficar consistente quando o user abrir
// /notificacoes.

'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { getSupabase } from '@/lib/supabase';

const KEY_BASE = 'notifications-unread-count' as const;

export function useUnreadNotificationCount(): number {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [KEY_BASE, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const sb = getSupabase();
      const { count, error } = await sb
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('read', false);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!user) return;
    const sb = getSupabase();
    const channel = sb
      .channel(`notif-count:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: [KEY_BASE, user.id] });
          qc.invalidateQueries({ queryKey: ['notifications', user.id] });
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [user, qc]);

  return query.data ?? 0;
}

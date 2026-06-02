// useProfileRealtime — subscription Supabase Realtime que invalida a
// query ['profile', userId] sempre que a row do user em `profiles` muda
// (UPDATE/INSERT). Garante que features PRO destrancam na hora quando:
//  - webhook MP confirma pagamento → trigger handle_invoice_paid →
//    UPDATE profiles SET is_pro=true, pro_expires_at += 30d
//  - admin grant via /portal → UPDATE profiles SET is_pro=true
//  - RPC redeem_pro_with_points (100pts → PRO) → mesmo UPDATE
//
// Antes era polling via TanStack staleTime 60s — user pagava e ficava
// até 1min vendo "GRÁTIS" + paywalls trancados. Agora ~1-2s end-to-end.
//
// Padrão idempotente igual useChatRealtime: 1 channel por user, cleanup
// remove o channel no unmount. Mount-once no RootLayout (ou onde tiver
// sessão garantida) que cobra todas as telas.

'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export function useProfileRealtime(userId: string | null): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const sb = getSupabase();
    const channel = sb
      .channel('profile-' + userId)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        () => {
          // Qualquer UPDATE no row do user invalida a cache. Próximo
          // render dispara refetch e o badge/banner/paywall atualizam.
          qc.invalidateQueries({ queryKey: ['profile', userId] });
          // Bonus: invalida 'business-logo' (perfil pode ter mudado o
          // logo via /perfil/editar) e 'points' (saldo conta a renovação).
          qc.invalidateQueries({ queryKey: ['business-logo', userId] });
          qc.invalidateQueries({ queryKey: ['points', userId] });
        },
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };
  }, [userId, qc]);
}

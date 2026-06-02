// RealtimeBindings — monta as subscriptions globais que devem viver
// enquanto o user está autenticado:
//   - useProfileRealtime: profile UPDATE invalida cache (PRO destranca etc)
//   - useGlobalRealtime: posts/comments/likes/follows/jobs/points/stories
//     → invalidam queries relevantes pra sensação Instagram/TikTok instantânea
//
// Mount-once em AppShell (qualquer tela authenticated).
'use client';

import { useAuth } from '@/components/AuthProvider';
import { useProfileRealtime } from '@/lib/hooks/useProfileRealtime';
import { useGlobalRealtime } from '@/lib/hooks/useGlobalRealtime';

export function RealtimeBindings() {
  const { user } = useAuth();
  useProfileRealtime(user?.id ?? null);
  useGlobalRealtime(user?.id ?? null);
  return null;
}

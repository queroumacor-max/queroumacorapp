// RealtimeBindings — monta as subscriptions globais que devem viver
// enquanto o user está autenticado. Hoje cobre:
//   - useProfileRealtime: profile UPDATE invalida cache (PRO destranca,
//     avatar/bio refletem, etc).
//
// Mount-once em AppShell (qualquer tela authenticated). Componente
// retorna null — só efeito colateral. Usa useAuth pra pegar o user.id;
// hook é no-op se userId for null.
'use client';

import { useAuth } from '@/components/AuthProvider';
import { useProfileRealtime } from '@/lib/hooks/useProfileRealtime';

export function RealtimeBindings() {
  const { user } = useAuth();
  useProfileRealtime(user?.id ?? null);
  return null;
}

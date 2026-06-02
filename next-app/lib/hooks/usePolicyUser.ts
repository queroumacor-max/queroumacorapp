// usePolicyUser — hook que monta o PolicyUser combinando profile (banco)
// com user.user_metadata (JWT). Profile vence quando carregado — é a
// fonte da verdade. JWT metadata é fallback enquanto profile carrega
// (e cobre casos legacy onde gravávamos só no metadata).
//
// Bug que isso resolve: SeuZeChat/CrmList/QuoteWizard/AiArtStudio/
// AnalysisCard montavam o policyUser SÓ a partir de user.user_metadata.
// JWT metadata raramente tem is_pro/is_admin populados — o banco é que
// recebe esses flags via webhook/portal. Resultado: user PRO via portal
// via paywall mesmo com badge ADMIN no header.

'use client';

import { useAuth } from '@/components/AuthProvider';
import { useProfile } from '@/lib/hooks/useProfile';
import type { PolicyUser } from '@/lib/policies';

export function usePolicyUser(): PolicyUser | null {
  const { user } = useAuth();
  const { profile } = useProfile();
  if (!user) return null;

  const meta = (user.user_metadata as Record<string, unknown> | undefined) ?? {};
  const p = profile as
    | (typeof profile & {
        is_admin?: boolean | null;
        portal_access?: boolean | null;
        is_pro?: boolean | null;
        pro_expires_at?: string | null;
        pro_grace_until?: string | null;
        role?: string | null;
      })
    | null;

  // Coerce helpers: prefere profile, fallback metadata.
  const pickBool = (
    primary: boolean | null | undefined,
    fallback: unknown,
  ): boolean | null => {
    if (typeof primary === 'boolean') return primary;
    if (typeof fallback === 'boolean') return fallback;
    return null;
  };
  const pickStr = (
    primary: string | null | undefined,
    fallback: unknown,
  ): string | null => {
    if (typeof primary === 'string') return primary;
    if (typeof fallback === 'string') return fallback;
    return null;
  };

  return {
    id: user.id,
    is_pro: pickBool(p?.is_pro, meta['is_pro']),
    is_admin: pickBool(p?.is_admin, meta['is_admin']),
    role: pickStr(p?.role, meta['role']),
    name: p?.name ?? null,
    tag: p?.tag ?? null,
    pro_expires_at: pickStr(p?.pro_expires_at, meta['pro_expires_at']),
    pro_grace_until: pickStr(p?.pro_grace_until, meta['pro_grace_until']),
    // portal_access não está no shape oficial PolicyUser, mas isAdmin()
    // checa via cast. Adicionamos aqui pra que o cast funcione.
    ...(p?.portal_access === true ? { portal_access: true } : {}),
  } as PolicyUser;
}

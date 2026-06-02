'use client';
// ReferralCapture — captura `?ref=<userId>` em qualquer rota onde o link
// compartilhado pousar (/perfil/<id>, /, /login, /signup) e persiste em
// localStorage até o user concluir o cadastro. SignupFlow lê de lá no
// submit e chama signUp({ referrerId }) — vira linha em `referrals` +
// `profiles.invited_by`. Depois do cadastro, SignupFlow redireciona pra
// /perfil/<referrerId> (espelha o openUserProfile() do vanilla head.js linha 1188).
//
// Decisões:
//  - localStorage em vez de cookie pq o fluxo é client-only e sobrevive a
//    refreshes/aba nova sem precisar de SSR. Não conflita com Supabase Auth.
//  - Auto-limpa quando o user já está logado (não faz sentido manter ref
//    pra quem já tem conta).
//  - Não remove o param da URL — Next.js cuida via router; remoção manual
//    causaria re-render extra. Se o user voltar pelo botão do browser, o
//    valor já tá no storage, então o param fica como histórico inofensivo.

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

const REF_KEY = 'quc:ref';

export function ReferralCapture() {
  const params = useSearchParams();
  const { user } = useAuth();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Já logado → ignora ref (vanilla pro.js linha 187 faz o mesmo).
    if (user) {
      try { window.localStorage.removeItem(REF_KEY); } catch { /* ignore */ }
      return;
    }
    const ref = params?.get('ref');
    if (!ref) return;
    // Validação leve: UUIDs do Supabase têm 36 chars; só armazena se parecer um.
    if (ref.length < 8 || ref.length > 64) return;
    try {
      window.localStorage.setItem(REF_KEY, ref);
    } catch {
      // storage cheio / private mode — sem fallback (ref é opcional).
    }
  }, [params, user]);

  return null;
}

/** Lê o referrer pendente. Helper exportado pra SignupFlow consumir. */
export function readPendingReferrer(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

/** Limpa o referrer salvo. Chamado após signup completo. */
export function clearPendingReferrer(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REF_KEY);
  } catch {
    // ignore
  }
}

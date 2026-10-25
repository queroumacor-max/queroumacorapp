'use client';

// Saldo de orçamentos/obras + assinatura do usuário logado (RPC
// my_billing_balance). `data` null = o SQL ainda não rodou: aí nada é
// cobrado (o banco também não debita).

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { fetchBillingBalance } from '@/lib/services/billingPurchases';

export const BILLING_BALANCE_KEY = ['billing-balance'] as const;

export function useBillingBalance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: BILLING_BALANCE_KEY,
    queryFn: fetchBillingBalance,
    enabled: !!user?.id,
    staleTime: 10_000,
  });
}

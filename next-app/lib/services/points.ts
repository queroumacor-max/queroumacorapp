// points.ts — service layer pra feature "Pontos / Cashback". Espelha
// `modules/points-refs.js` do vanilla:
//   - listPoints: últimas 20 linhas da tabela `points` do user;
//   - balance: soma earned − spent;
//   - redeem: chama RPC `redeem_pro_with_points` (SECURITY DEFINER) que
//     valida saldo, debita pontos e estende `pro_expires_at` em uma
//     transação atômica (evita bypass via UPDATE direto em profiles).

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface PointEntry {
  id: string;
  type: 'earned' | 'spent';
  amount: number;
  source: string | null;
  reference_id: string | null;
  created_at: string;
}

export async function listPoints(userId: string): Promise<PointEntry[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('points')
    .select('id, type, amount, source, reference_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new NetworkError(error.message, error);
  return (data ?? []) as PointEntry[];
}

export function computeBalance(entries: PointEntry[]): number {
  return entries.reduce(
    (acc, p) => acc + (p.type === 'earned' ? p.amount : -p.amount),
    0,
  );
}

export async function redeemProWithPoints(cost = 1000): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('redeem_pro_with_points', { p_cost: cost });
  if (error) throw new NetworkError(error.message, error);
  return String(data ?? '');
}

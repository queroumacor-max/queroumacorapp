// points.ts — service layer pra feature "Pontos / Cashback". Espelha
// `modules/points-refs.js` do vanilla:
//   - listPoints: últimas 20 linhas da tabela `points` do user;
//   - balance: soma earned − spent.
// A troca de pontos por PRO saiu em 2026-10-26 (PRO é só assinatura na loja);
// a RPC `redeem_pro_with_points` teve o EXECUTE revogado no banco.

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

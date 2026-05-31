// featureFlags.ts — service layer para Feature Flags (Grande#4).
// Espelha o schema da migration 2026-05-31-feature-flags.sql:
//   - `feature_flags` table (key PK, enabled, rollout_percent 0..100,
//     rollout_users uuid[] whitelist, description, timestamps);
//   - `is_feature_enabled(p_key, p_user_id)` RPC — resolução do rollout
//     determinística (hashtext(uuid) % 100 vs rollout_percent), então o
//     mesmo usuário sempre cai no mesmo lado sem flap.
//
// Decisões:
//   - `fetchFlags`: lê todas as flags (não é uma operação quente — só admin
//     UI usa). Throw NetworkError em qualquer falha pra a UI mostrar retry.
//   - `isFlagEnabled`: usa RPC pra centralizar a lógica de rollout no banco.
//     Fail-CLOSED quando o RPC retorna erro (retorna `false` em vez de
//     throw) — flag indisponível deve esconder a feature, não quebrar a UI.
//   - `updateFlag`: patch parcial; o caller é admin via RLS (`is_portal_admin()`),
//     então não duplicamos check aqui. Erro → NetworkError pra reporting.
//
// O tipo `feature_flags` ainda não está em `database.types.ts` (a migration
// não foi rodada quando o types foi gerado). Usamos cast `from('feature_flags' as never)`
// pra não quebrar build até o próximo `npx supabase gen types`.

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  rollout_percent: number;
  rollout_users?: string[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface FeatureFlagPatch {
  enabled?: boolean;
  description?: string | null;
  rollout_percent?: number;
  rollout_users?: string[] | null;
}

/**
 * Lista todas as feature flags. Ordenadas por key alfabético — facilita
 * leitura no admin UI sem precisar de input control de sort.
 *
 * Throws NetworkError em qualquer erro do Supabase (RLS, rede, parse).
 */
export async function fetchFlags(): Promise<FeatureFlag[]> {
  const sb = getSupabase();
  // Cast `never` porque feature_flags ainda não está em database.types.ts.
  // Quando regenerar os types, remover o cast.
  const { data, error } = await sb
    .from('feature_flags' as never)
    .select('*')
    .order('key', { ascending: true });
  if (error) {
    throw new NetworkError((error as { message?: string }).message ?? 'falha ao carregar flags', error);
  }
  return (data ?? []) as unknown as FeatureFlag[];
}

/**
 * Resolve se uma flag está habilitada pra um usuário específico (ou anônimo).
 * Usa o RPC `is_feature_enabled` pra que a lógica de rollout fique 1:1 com
 * o SQL (determinismo do hash, whitelist `rollout_users`, etc.).
 *
 * Fail-CLOSED em qualquer erro — flag inacessível esconde a feature.
 */
export async function isFlagEnabled(key: string, userId?: string): Promise<boolean> {
  if (!key) return false;
  const sb = getSupabase();
  const { data, error } = await sb.rpc('is_feature_enabled' as never, {
    p_key: key,
    p_user_id: userId ?? null,
  } as never);
  if (error) return false;
  return Boolean(data);
}

/**
 * Aplica patch parcial em uma flag. Espera key existente (UPDATE, não UPSERT) —
 * criação de flags é feita pelo seed da migration ou manual via SQL Editor;
 * UI admin só edita as que já existem.
 *
 * Throws NetworkError quando o Supabase devolve erro (RLS denying não-admin).
 */
export async function updateFlag(key: string, updates: FeatureFlagPatch): Promise<void> {
  if (!key) throw new NetworkError('key obrigatório');
  const sb = getSupabase();
  const { error } = await sb
    .from('feature_flags' as never)
    .update(updates as never)
    .eq('key', key);
  if (error) {
    throw new NetworkError((error as { message?: string }).message ?? 'falha ao atualizar flag', error);
  }
}

// featureInterest — service pra registrar interesse em features futuras
// (ex.: maquininha de cartão). INSERT em tabela feature_interest com
// action='click' (ao abrir modal) e action='waitlist' (ao confirmar).

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

/** Log um click pra tracking de interesse. Silencioso (best-effort). */
export async function logFeatureClick(feature: string, userId: string): Promise<void> {
  if (!feature || !userId) return;
  const sb = getSupabase();
  await sb
    .from('feature_interest')
    .insert({
      user_id: userId,
      feature,
      action: 'click',
    })
    .then(() => {}, () => {});
}

/** Adiciona user à waitlist com contato. Throws em erro. */
export async function joinFeatureWaitlist(
  feature: string,
  userId: string,
  contact: string,
): Promise<void> {
  if (!feature || !userId) return;
  const sb = getSupabase();
  const { error } = await sb.from('feature_interest').insert({
    user_id: userId,
    feature,
    action: 'waitlist',
    contact: contact || null,
  });
  if (error) throw new NetworkError(error.message, error);
}

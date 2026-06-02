// checklist.ts — service layer pra feature "Checklist de Obra" (espelha
// modules/checklist.js). Persiste em `checklists` (tabela com RLS por
// user_id, schema { id, user_id, title, items jsonb }).
//
// Mantém apenas a linha mais recente do user (o vanilla também — usa
// `.limit(1)` e UPDATE quando existe).

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface ChecklistRow {
  id: string;
  items: ChecklistItem[];
}

export const CHECKLIST_TEMPLATES: Record<string, string[]> = {
  pintura: [
    'Proteger pisos com lona',
    'Fita crepe em rodapés e batentes',
    'Lixar paredes (lixa 150)',
    'Aplicar massa corrida',
    'Lixar massa (lixa 220)',
    'Aplicar selador',
    '1ª demão de tinta',
    '2ª demão de tinta',
    'Retoques finais',
    'Limpeza do local',
  ],
  textura: [
    'Proteger pisos e móveis',
    'Preparar massa texturizada',
    'Aplicar base/selador',
    'Aplicar textura com desempenadeira',
    'Aguardar secagem (4h)',
    'Pintar sobre textura',
    'Retoques',
    'Limpeza',
  ],
  epoxi: [
    'Lixar piso',
    'Limpar com desengraxante',
    'Aplicar primer epóxi',
    'Aguardar 12h secagem',
    '1ª demão epóxi',
    '2ª demão epóxi',
    'Aguardar 7 dias cura total',
    'Entrega',
  ],
};

export async function loadChecklist(
  userId: string,
): Promise<ChecklistRow | null> {
  if (!userId) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('checklists')
    .select('id, items')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new NetworkError(error.message, error);
  if (!data || data.length === 0) return null;
  const row = data[0] as { id: string; items: unknown };
  return {
    id: row.id,
    items: Array.isArray(row.items) ? (row.items as ChecklistItem[]) : [],
  };
}

export async function saveChecklist(
  userId: string,
  rowId: string | null,
  items: ChecklistItem[],
): Promise<string> {
  if (!userId) throw new NetworkError('userId obrigatório');
  const sb = getSupabase();
  // Cast items pra unknown — o DB types da supabase trata `items jsonb` como
  // Json[], mas as nossas ChecklistItem não satisfazem o index signature
  // (string -> Json). Em runtime é só JSON.stringify; é seguro.
  const itemsJson = items as unknown as never;
  if (rowId) {
    const { error } = await sb
      .from('checklists')
      .update({ items: itemsJson })
      .eq('id', rowId)
      .eq('user_id', userId);
    if (error) throw new NetworkError(error.message, error);
    return rowId;
  }
  const { data, error } = await sb
    .from('checklists')
    .insert({ user_id: userId, title: 'Checklist de Obra', items: itemsJson })
    .select('id')
    .single();
  if (error) throw new NetworkError(error.message, error);
  return (data as { id: string }).id;
}

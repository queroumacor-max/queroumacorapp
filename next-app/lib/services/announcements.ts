// announcements — avisos que a loja publica pelo portal (aba "Avisos").
//
// Até 2026-11-06 o app NÃO mostrava esses avisos em lugar nenhum: o vanilla
// juntava `announcements` na tela de notificações, e a migração pro Next só
// leu a tabela `notifications`. O portal dizia "aparecerá na aba de
// notificações" e não aparecia.
//
// Lê pela view `announcements_public` (esconde `created_by`). A RLS da
// tabela só deixa passar `active = true`, e o filtro aqui repete isso.
// `media_url`/`media_type` vieram em 2026-11-06 (foto/vídeo no aviso); sem o
// SQL, refaz a consulta sem as duas colunas em vez de esconder os avisos.

import { getSupabase } from '@/lib/supabase';

export interface Aviso {
  id: string;
  title: string;
  message: string;
  created_at: string;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
}

const COLS_BASE = 'id,title,message,created_at';
const COLS_MIDIA = COLS_BASE + ',media_url,media_type';
const LIMITE = 20;

function colunaAusente(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204' || /media_(url|type)/.test(e.message || '');
}

function tabelaAusente(e: { code?: string } | null): boolean {
  return !!e && (e.code === '42P01' || e.code === 'PGRST205');
}

type Linha = Record<string, unknown>;

export function avisoDeLinha(r: Linha): Aviso | null {
  const id = typeof r.id === 'string' ? r.id : null;
  if (!id) return null;
  const url = typeof r.media_url === 'string' && r.media_url.trim() ? r.media_url.trim() : null;
  const tipo = r.media_type === 'video' || r.media_type === 'image' ? r.media_type : null;
  return {
    id,
    title: typeof r.title === 'string' ? r.title : '',
    message: typeof r.message === 'string' ? r.message : '',
    created_at: typeof r.created_at === 'string' ? r.created_at : new Date(0).toISOString(),
    media_url: url,
    media_type: url ? tipo : null,
  };
}

export async function fetchAvisos(): Promise<Aviso[]> {
  const sb = getSupabase();
  const consulta = (cols: string) =>
    sb
      .from('announcements_public' as never)
      .select(cols)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(LIMITE);

  let { data, error } = await consulta(COLS_MIDIA);
  if (colunaAusente(error)) ({ data, error } = await consulta(COLS_BASE));
  if (tabelaAusente(error)) return [];
  if (error) throw error;
  return ((data as unknown as Linha[] | null) || [])
    .map(avisoDeLinha)
    .filter((a): a is Aviso => a !== null);
}

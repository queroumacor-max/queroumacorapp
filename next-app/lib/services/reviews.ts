// reviews — service pra submeter avaliação pós-obra (5 stars + criteria + comment).
// Backed por RPC submit_review (SECURITY DEFINER) — valida quote ownership,
// rating 1-5, sem duplicata. Lista quotes elegíveis (concluido/completed/accepted)
// pra o cliente avaliar.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

export interface ReviewableQuote {
  id: string;
  title: string | null;
  service_type: string | null;
  area_m2: number | null;
  created_at: string;
  painter: {
    id: string;
    name: string | null;
    avatar_url: string | null;
    city: string | null;
  } | null;
}

interface RawQuoteRow {
  id: string;
  title: string | null;
  service_type: string | null;
  area_m2: number | null;
  created_at: string | null;
  painter?: { id: string; name: string | null; avatar_url: string | null; city: string | null } | null;
}

/** Lista quotes concluídos do user logado pra avaliar (até 10 mais recentes). */
export async function listReviewableQuotes(userId: string): Promise<ReviewableQuote[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('quotes')
    .select('id, title, service_type, area_m2, created_at, painter:profiles!painter_id(id, name, avatar_url, city)')
    .eq('client_id', userId)
    .in('status', ['concluido', 'completed', 'accepted'])
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new NetworkError(error.message, error);
  return (data ?? []).map((q) => {
    const r = q as unknown as RawQuoteRow;
    return {
      id: r.id,
      title: r.title,
      service_type: r.service_type,
      area_m2: r.area_m2,
      created_at: r.created_at ?? '',
      painter: r.painter ?? null,
    };
  });
}

export interface SubmitReviewInput {
  quoteId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  comment?: string | null;
  criteria?: string[];
}

/** Submete review via RPC submit_review (SECURITY DEFINER). */
export async function submitReview(input: SubmitReviewInput): Promise<void> {
  if (!input.quoteId) throw new ValidationError('quoteId obrigatório');
  if (!input.rating || input.rating < 1 || input.rating > 5) {
    throw new ValidationError('rating deve ser 1-5');
  }
  const sb = getSupabase();
  const rpc = sb.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  const { error } = await rpc('submit_review', {
    p_quote_id: input.quoteId,
    p_painter_id: null,
    p_rating: input.rating,
    p_comment: input.comment ?? null,
    p_criteria: input.criteria ?? [],
  });
  if (error) throw new NetworkError(error.message, error);
}

// leads.ts — service layer pra feature de leads (oportunidades de obra
// disponíveis pra pintor PRO comprar acesso). Espelha o subset relevante de
// modules/leads.js do vanilla:
//
//   - fetchLeads: lista posts marcados `for_sale=true` que o pintor atual
//     ainda NÃO comprou (sem quote dele apontando pra esse post).
//   - comprarObra: o pintor "compra" o acesso ao lead → cria uma quote
//     (rascunho) com painter_id = auth.uid() via RPC SECURITY DEFINER.
//
// Decisão sobre RPC vs INSERT direto: usamos `create_painter_draft` (RPC) pra
// que o servidor force `painter_id = auth.uid()` — sem essa garantia, um
// cliente malicioso poderia tentar gravar painter_id arbitrário. A RPC é
// SECURITY DEFINER e impõe a coluna do lado do banco (supabase_init.sql
// linha 1241+).
//
// NOTA sobre divergência com schema atual: a assinatura real de
// `create_painter_draft` em supabase_init.sql aceita (client_name, service_type,
// title, area_m2, price, quote_data). O spec deste port pede chamar com
// `{ p_post_id: postId }` — esse param ainda não existe na RPC e precisará
// ser adicionado por migration (ou via overload) pra fechar o loop de
// "qual post originou o lead". Mantemos a assinatura do spec aqui porque (a)
// é o contrato pedido pela camada de UI deste port e (b) qualquer mudança
// fica isolada nesta função sem mexer no hook/componente. Quando a migration
// rodar, atualizar a chamada — os tests cobrem o shape pra detectar drift.

import { getSupabase } from '@/lib/supabase';
import {
  ValidationError,
  AuthorizationError,
  NetworkError,
} from '@/lib/errors';
import type { Lead } from '@/lib/types';

// Colunas mínimas que LeadCard renderiza. `art_type` e `price` opcionais —
// posts em legado podem ter NULL nessas colunas, o componente trata.
const LEAD_COLS =
  'id, user_id, caption, media_url, media_type, price, art_type, created_at';

// 30 alinhado com o spec — feed de leads não precisa ser gigante, pintor
// rola rápido. Paginação fica pra quando virar gargalo.
const DEFAULT_LIMIT = 30;

/**
 * Busca posts marcados como `for_sale=true` que ainda não foram comprados
 * pelo pintor atual. Strategy: 2 queries (posts + quotes do painter) e
 * filtra em memória — mais simples que um LEFT JOIN com NOT EXISTS no
 * supabase-js, e o conjunto é pequeno (30 posts no max).
 *
 * Retorna [] se painterId vazio (consistente com fetchPedidos/fetchNotifications)
 * pra que o caller não precise checar antes.
 */
export async function fetchLeads(painterId: string): Promise<Lead[]> {
  if (!painterId) return [];
  const sb = getSupabase();

  // 1) Posts em venda (approved + for_sale=true).
  const { data: posts, error: pErr } = await sb
    .from('posts')
    .select(LEAD_COLS)
    .eq('status', 'approved')
    .eq('for_sale', true)
    .order('created_at', { ascending: false })
    .limit(DEFAULT_LIMIT);

  if (pErr) {
    throw new NetworkError(pErr.message, pErr);
  }
  if (!posts || posts.length === 0) return [];

  // 2) Quotes que o pintor já comprou apontando pra esses posts — filtra fora.
  // Se o painter não tem nenhuma quote ainda, `bought` vira [] e nada é filtrado.
  // Cast via unknown: select(string runtime) devolve GenericStringError; o
  // domain type Lead é permissive e bate em runtime.
  const postsList = posts as unknown as Lead[];
  const postIds = postsList.map((p) => p.id);
  const { data: bought, error: qErr } = await sb
    .from('quotes')
    .select('post_id')
    .eq('painter_id', painterId)
    .in('post_id', postIds);

  // Erro aqui é não-fatal: prefere mostrar leads (com chance de duplicar
  // compra que a RPC vai rejeitar) a quebrar a tela inteira. Loga e segue.
  if (qErr) {
    // eslint-disable-next-line no-console
    console.warn('fetchLeads: bought filter failed:', qErr.message);
    return postsList;
  }

  const boughtSet = new Set(
    (bought ?? [])
      .map((q) => q.post_id)
      .filter((id): id is string => id !== null),
  );

  return postsList.filter((p) => !boughtSet.has(p.id));
}

/**
 * Pintor compra acesso ao lead. Cria quote em status 'rascunho' via RPC
 * `create_painter_draft` (SECURITY DEFINER força painter_id = auth.uid()).
 *
 * Erros tratados:
 *   - 23505 (unique violation) → ValidationError "já comprou este lead"
 *   - mensagem com "insufficient" → AuthorizationError (pontos ou PRO)
 *   - resto → NetworkError com cause
 *
 * Retorna o id da quote criada pra que o caller possa redirecionar pro chat
 * ou pra tela de orçamento.
 */
export async function comprarObra(
  postId: string,
  painterId: string
): Promise<{ quoteId: string }> {
  if (!postId) throw new ValidationError('Post inválido.');
  if (!painterId) throw new AuthorizationError('Faça login para comprar leads.');

  const sb = getSupabase();
  // Chamada conforme contrato do spec. Quando a RPC do banco for atualizada
  // pra aceitar p_post_id, esse call site já bate; até lá, a RPC ignora o
  // param desconhecido OU estoura "function does not exist" — capturamos via
  // `error.message` abaixo pra surfar mensagem legível.
  const { data, error } = await sb.rpc('create_painter_draft', {
    p_post_id: postId,
  });

  if (error) {
    if (error.code === '23505') {
      throw new ValidationError('Você já comprou este lead.');
    }
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('insufficient')) {
      throw new AuthorizationError(
        'Saldo de pontos insuficiente ou PRO inativo.'
      );
    }
    throw new NetworkError(error.message, error);
  }

  // RPC retorna o uuid da quote como scalar. Defensivo: se vier null/undef,
  // tratamos como erro lógico (não deveria acontecer com a RPC atual).
  if (!data) {
    throw new NetworkError('RPC create_painter_draft retornou vazio.');
  }
  return { quoteId: String(data) };
}

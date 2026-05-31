// chat-conversations.ts — fetch + criação de conversas.
//
// fetchConversations tenta a RPC `get_conversations` primeiro (1 round-trip)
// e cai pra agregação client-side se a RPC não existe (instância antiga).

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import {
  build3WayConvId,
  buildDirectConvId,
  type ConversationMeta,
  type RawMessageRow,
} from './chat-types';

/**
 * Lista as conversas do usuário em ordem reverse-chronological.
 *
 * Caminho preferido: RPC `get_conversations` (1 round-trip, agrega no PG).
 * Fallback: busca todas as mensagens onde o user é sender OU receiver e
 * agrupa no client + resolve perfis (replicação do loadChatList legado).
 */
export async function fetchConversations(
  userId: string,
): Promise<ConversationMeta[]> {
  if (!userId) return [];

  const sb = getSupabase();

  // 1) Tentativa via RPC. Se a função não existe, cai pro fallback. NÃO
  //    levantamos NetworkError aqui — agregação client é fallback válido.
  try {
    const { data: rows, error } = await sb.rpc('get_conversations');
    if (!error && Array.isArray(rows)) {
      return rows.map((r: Record<string, unknown>) => rpcRowToMeta(r, userId));
    }
  } catch {
    // RPC indisponível — segue pro fallback.
  }

  // 2) Fallback: messages onde sou sender OU receiver, agrupar por conv_id.
  const [sentRes, recvRes] = await Promise.all([
    sb
      .from('messages')
      .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
    sb
      .from('messages')
      .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  if (sentRes.error) throw new NetworkError(sentRes.error.message, sentRes.error);
  if (recvRes.error) throw new NetworkError(recvRes.error.message, recvRes.error);

  const allMsgs = [
    ...((sentRes.data ?? []) as RawMessageRow[]),
    ...((recvRes.data ?? []) as RawMessageRow[]),
  ];
  if (allMsgs.length === 0) return [];

  // Dedup por id (mensagens onde sou sender E receiver — autoreply etc.).
  const seen = new Set<string>();
  const dedup: RawMessageRow[] = [];
  for (const m of allMsgs) {
    if (m.id && !seen.has(m.id)) {
      seen.add(m.id);
      dedup.push(m);
    }
  }

  // Agrupa por conv_id, marca is3way se houver marker __STORE_ADDED__.
  interface ConvGroup {
    lastMsg: RawMessageRow;
    otherId: string | null;
    is3way: boolean;
  }
  const groups = new Map<string, ConvGroup>();
  for (const m of dedup) {
    const otherId = m.sender_id === userId ? m.receiver_id : m.sender_id;
    const key = m.conversation_id || otherId || m.id;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { lastMsg: m, otherId, is3way: false });
    } else if (
      new Date(m.created_at).getTime() >
      new Date(existing.lastMsg.created_at).getTime()
    ) {
      existing.lastMsg = m;
    }
    if (m.type === 'system' && m.content === '__STORE_ADDED__') {
      const g = groups.get(key);
      if (g) g.is3way = true;
    }
  }

  // Resolve perfis dos other_ids.
  const otherIds = Array.from(
    new Set(
      Array.from(groups.values())
        .map((g) => g.otherId)
        .filter((id): id is string => !!id),
    ),
  );
  const profMap = new Map<string, Record<string, unknown>>();
  if (otherIds.length > 0) {
    const { data: profs } = await sb
      .from('profiles_public')
      .select('id, name, avatar_url, tag, role, user_type')
      .in('id', otherIds);
    for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
      profMap.set(String(p.id), p);
    }
  }

  const metas: ConversationMeta[] = [];
  for (const [convId, g] of groups) {
    const prof = g.otherId ? profMap.get(g.otherId) ?? {} : {};
    const name = String(prof.name ?? '');
    const tag = (prof.tag as string | null) ?? null;
    const avatarUrl = (prof.avatar_url as string | null) ?? null;
    const role =
      (prof.role as string | null) ?? (prof.user_type as string | null) ?? null;
    const isStorePrefix = convId.startsWith('store_calicolors_');
    metas.push({
      convId,
      otherId: g.otherId,
      name,
      avatarUrl,
      tag,
      role,
      is3way: g.is3way,
      isStore: isStorePrefix || /cali\s*colors?/i.test(name),
      lastMsg: g.lastMsg.content,
      lastMsgFromMe: g.lastMsg.sender_id === userId,
      lastMsgTime: g.lastMsg.created_at,
    });
  }

  metas.sort((a, b) => {
    const ta = a.lastMsgTime ? new Date(a.lastMsgTime).getTime() : 0;
    const tb = b.lastMsgTime ? new Date(b.lastMsgTime).getTime() : 0;
    return tb - ta;
  });
  return metas;
}

/**
 * Converte uma linha da RPC get_conversations() pro shape ConversationMeta.
 * Colunas vêm em snake_case do PG.
 */
function rpcRowToMeta(
  r: Record<string, unknown>,
  myId: string,
): ConversationMeta {
  const convId = String(r.conv_id ?? r.other_id ?? '');
  const otherId = (r.other_id as string | null) ?? null;
  const name = String(r.name ?? '');
  const is3way = Boolean(r.is3way);
  return {
    convId,
    otherId,
    name,
    avatarUrl: (r.avatar_url as string | null) ?? null,
    tag: (r.tag as string | null) ?? null,
    role: (r.role as string | null) ?? (r.user_type as string | null) ?? null,
    is3way,
    isStore:
      !is3way &&
      (convId.startsWith('store_calicolors_') || /cali\s*colors?/i.test(name)),
    lastMsg: String(r.last_msg ?? ''),
    lastMsgFromMe: r.last_sender === myId,
    lastMsgTime: (r.last_msg_time as string | null) ?? null,
  };
}

/**
 * Devolve o convId canônico pra 1:1 entre myId e otherId. Não cria linha em
 * tabela `conversations` — o schema não tem essa tabela (cada msg carrega o
 * conv_id como text). Caller pode mandar a primeira mensagem direto.
 */
export async function findOrCreateConversation(
  myId: string,
  otherId: string,
): Promise<string> {
  if (!myId) throw new ValidationError('myId obrigatório');
  if (!otherId) throw new ValidationError('otherId obrigatório');
  if (myId === otherId) {
    throw new ValidationError('Não é possível conversar consigo mesmo');
  }
  return buildDirectConvId(myId, otherId);
}

/**
 * Devolve o convId canônico pra um 3-way (eu, pintor, loja). Mesma lógica de
 * findOrCreateConversation: convId é determinístico, a "criação" acontece
 * quando a 1ª mensagem é inserida. O system msg `__STORE_ADDED__` é o marker
 * que diferencia 3-way de 1:1 na listagem.
 */
export async function findOrCreate3WayWithStore(
  myId: string,
  painterId: string,
): Promise<string> {
  if (!myId) throw new ValidationError('myId obrigatório');
  if (!painterId) throw new ValidationError('painterId obrigatório');
  if (myId === painterId) {
    throw new ValidationError('Pintor e usuário precisam ser diferentes');
  }
  return build3WayConvId(myId, painterId);
}

/**
 * Resolve o user ID da loja Cali Colors. Necessário porque o app guarda só
 * o email no constant — o ID é descoberto via tag (`calicolorstintas`) ou
 * fallback por busca no nome (`ilike '%cali%'`).
 *
 * Retorna null se não achou — caller decide fallback.
 */
export async function resolveCalicolorsUserId(): Promise<string | null> {
  const sb = getSupabase();
  try {
    const { data } = await sb
      .from('profiles_public')
      .select('id')
      .eq('tag', 'calicolorstintas')
      .limit(1);
    if (data && data.length > 0 && data[0]) return String(data[0].id);
  } catch {
    // ignore, tenta fallback
  }
  try {
    const { data } = await sb
      .from('profiles_public')
      .select('id')
      .ilike('name', '%cali%')
      .limit(1);
    if (data && data.length > 0 && data[0]) return String(data[0].id);
  } catch {
    // ignore
  }
  return null;
}

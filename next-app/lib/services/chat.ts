// chat.ts — service layer da feature mais crítica do app: mensagens 1:1
// e 3-way entre cliente, pintor e a loja Cali Colors. Porta o subset I/O
// de modules/chat.js do vanilla (1175 linhas) sem DOM, sem localStorage
// cache, sem renderização — só I/O puro contra Supabase, com tipos inline.
//
// O que NÃO foi portado (intencional):
//  - Cache em localStorage (saveConvLocal/loadConvsLocal/saveMsgLocal):
//    TanStack Query (placeholderData/staleTime) cobre o paint-instant que
//    o vanilla resolvia com localStorage. Manter dois caches paralelos era
//    fonte conhecida de drift no vanilla.
//  - Auto-reply / addStoreToChat lógica de UI (banner, header avatars):
//    moveu pra componentes React; service só expõe findOrCreate3WayWithStore
//    e a inserção do system msg `__STORE_ADDED__`.
//  - Color rotation (_msgColors): pura função utility, vive em MessageBubble.
//  - Anti-duplicate _processedMsgIds Map: mora no hook useChatRealtime (estado
//    cross-render), não no service.
//  - Display name helpers (convDisplayName, stripEmail): viraram puros em
//    components/MessageBubble e ConversationItem.
//
// Schema do banco (supabase_init.sql):
//   messages: id uuid, sender_id uuid, receiver_id uuid, conversation_id text,
//             content text, type text DEFAULT 'text', created_at timestamptz
//   profiles_public: view com colunas seguras (sem email/phone)
//
// RPC: get_conversations() agrega conversas no postgres (1 round-trip) e
// devolve linhas com {conv_id, other_id, name, avatar_url, tag, email, role,
// last_msg, last_sender, last_msg_time, is3way}. Fallback aqui replica a
// agregação no client se a RPC não existir (compat com instâncias antigas).

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

// ─── Tipos inline (NÃO mexer em lib/types.ts) ────────────────────────────

/**
 * Metadados de uma conversa para a lista lateral.
 * O conv_id é text livre (1:1 = "uuidA_uuidB" sorted; 3-way mantém prefix
 * "3way:" no caller; chat com loja sem userId = "store_calicolors_<myId>").
 */
export interface ConversationMeta {
  convId: string;
  otherId: string | null;
  name: string;
  avatarUrl: string | null;
  tag: string | null;
  role: string | null;
  is3way: boolean;
  isStore: boolean;
  lastMsg: string;
  lastMsgFromMe: boolean;
  lastMsgTime: string | null;
}

/**
 * Mensagem individual numa conversa. type='text'|'image'|'video'|'audio'|
 * 'store' (Cali Colors falando no 3-way) | 'system' (markers tipo
 * __STORE_ADDED__ que não aparecem pro usuário).
 */
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'store' | 'system';
export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string | null;
  content: string;
  type: MessageType;
  createdAt: string;
  // Status só existe no client (otimistic UI). Banco não tem essa coluna.
  status?: MessageStatus;
}

/**
 * Perfil enxuto pra busca de usuários no modal "Nova conversa".
 */
export interface UserMini {
  id: string;
  name: string | null;
  tag: string | null;
  avatarUrl: string | null;
  role: string | null;
  isProfessional: boolean;
}

/**
 * Retorno de uploadAttachment — URL pública + tipo MIME canonicalizado
 * (image|video|audio) pra o caller decidir o `type` da Message.
 */
export interface AttachmentUploadResult {
  url: string;
  mimeType: string;
  messageType: 'image' | 'video' | 'audio';
}

// ─── Constantes ──────────────────────────────────────────────────────────

// Email canônico da loja oficial. Usado para resolver o ID quando a tag/nome
// dela mudou. Hardcoded porque o usuário verifica em CLAUDE.md.
export const CALICOLORS_EMAIL = 'calicolortintas@gmail.com';

// Limite default de mensagens carregadas por conversa. Vanilla usava 100
// (saveMsgLocal trimava em 100); aqui 50 é o ponto de partida — paginação
// pra histórico maior fica como follow-up.
const DEFAULT_MESSAGES_LIMIT = 50;

// Cap defensivo pra limite passado pelo caller (protege contra paginação
// abusiva que estouraria 10MB de response do Supabase).
const MESSAGES_LIMIT_MAX = 500;

// Tamanho máximo de attachment (10MB — alinhado com o spec do prompt; bucket
// `posts` aceita até 50MB mas pra chat 10MB é razoável e protege bandwidth).
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// MIMEs aceitos. Imagens + vídeo + áudio (voice notes do composer).
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'];
export const ALLOWED_ATTACHMENT_MIMES = [
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_VIDEO_MIMES,
  ...ALLOWED_AUDIO_MIMES,
];

// Min length pra busca de usuário (vanilla: `query.trim().length < 2` → vazio).
const SEARCH_MIN_QUERY_LENGTH = 2;

// ─── Helpers (puros, sem rede) ───────────────────────────────────────────

/**
 * Gera o conversation_id canônico pra um chat 1:1. Sorted+join pra que
 * (A,B) e (B,A) resolvam pro mesmo ID — sem isso, dois usuários abrindo
 * o chat simultaneamente criariam duas conversas paralelas.
 */
export function buildDirectConvId(myId: string, otherId: string): string {
  if (!myId || !otherId) throw new ValidationError('IDs obrigatórios');
  return [myId, otherId].sort().join('_');
}

/**
 * Prefixo 3-way pra distinguir conversas com loja inserida. O backend não
 * tem coluna `is3way` em conversations — usamos o system msg `__STORE_ADDED__`
 * pra detectar; o prefix no convId é só pro client roteador (ChatConversation
 * lê o prefix pra pintar o header 3-way mesmo antes do fetch das mensagens).
 */
export function build3WayConvId(myId: string, painterId: string): string {
  if (!myId || !painterId) throw new ValidationError('IDs obrigatórios');
  return '3way:' + [myId, painterId].sort().join('_');
}

/**
 * True se o convId começa com "3way:" (heurística de roteamento).
 */
export function is3WayConvId(convId: string): boolean {
  return typeof convId === 'string' && convId.startsWith('3way:');
}

/**
 * Strip do prefix 3way: pra recuperar os user IDs originais.
 */
export function strip3WayPrefix(convId: string): string {
  return is3WayConvId(convId) ? convId.slice(5) : convId;
}

/**
 * Heurística "papel profissional" — espelha isProfessionalRole do vanilla.
 * Vive aqui (não em utils) porque é usado em searchUsers pra setar a flag.
 */
function isProfessionalRole(role: string | null | undefined): boolean {
  if (!role) return false;
  const r = String(role).toLowerCase();
  return /pintor|grafit|automotiv|funile/.test(r);
}

// ─── Conversations ───────────────────────────────────────────────────────

/**
 * Lista as conversas do usuário em ordem reverse-chronological.
 *
 * Caminho preferido: RPC `get_conversations` (1 round-trip, agrega no PG).
 * Fallback: busca todas as mensagens onde o user é sender OU receiver e
 * agrupa no client + resolve perfis dos other_ids (replicação do
 * loadChatList legado de modules/chat.js).
 */
export async function fetchConversations(
  userId: string,
): Promise<ConversationMeta[]> {
  if (!userId) return [];

  const sb = getSupabase();

  // 1) Tentativa via RPC. Se a função não existe (instância sem migration),
  //    cai pro fallback. NÃO levantamos NetworkError aqui — agregação client
  //    é fallback válido.
  try {
    const { data: rows, error } = await sb.rpc('get_conversations');
    if (!error && Array.isArray(rows)) {
      return rows.map((r: Record<string, unknown>) => rpcRowToMeta(r, userId));
    }
  } catch {
    // RPC indisponível — segue pro fallback abaixo.
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
  if (sentRes.error) {
    throw new NetworkError(sentRes.error.message, sentRes.error);
  }
  if (recvRes.error) {
    throw new NetworkError(recvRes.error.message, recvRes.error);
  }

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

  // Agrupa por conv_id, marcando is3way se encontrar marker __STORE_ADDED__.
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
    } else {
      if (new Date(m.created_at).getTime() > new Date(existing.lastMsg.created_at).getTime()) {
        existing.lastMsg = m;
      }
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

  // Resolve loja se algum convId tem prefix store_calicolors_ ou o other é
  // o ID da loja (não temos acesso ao calicolorsUserId aqui sem mais um
  // round-trip — fica como heurística pelo prefix do convId).
  const metas: ConversationMeta[] = [];
  for (const [convId, g] of groups) {
    const prof = g.otherId ? profMap.get(g.otherId) ?? {} : {};
    const name = String(prof.name ?? '');
    const tag = (prof.tag as string | null) ?? null;
    const avatarUrl = (prof.avatar_url as string | null) ?? null;
    const role = (prof.role as string | null) ?? (prof.user_type as string | null) ?? null;
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

  // Sort reverse-chrono.
  metas.sort((a, b) => {
    const ta = a.lastMsgTime ? new Date(a.lastMsgTime).getTime() : 0;
    const tb = b.lastMsgTime ? new Date(b.lastMsgTime).getTime() : 0;
    return tb - ta;
  });
  return metas;
}

interface RawMessageRow {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  conversation_id: string;
  content: string;
  type: string | null;
  created_at: string;
}

/**
 * Converte uma linha da RPC get_conversations() pro shape ConversationMeta.
 * Mantida separada pra clareza — colunas vêm em snake_case do PG.
 */
function rpcRowToMeta(r: Record<string, unknown>, myId: string): ConversationMeta {
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
 * tabela `conversations` — o schema do app não tem essa tabela (cada msg
 * carrega o conv_id como text). Caller pode mandar a primeira mensagem
 * direto com esse convId.
 */
export async function findOrCreateConversation(
  myId: string,
  otherId: string,
): Promise<string> {
  if (!myId) throw new ValidationError('myId obrigatório');
  if (!otherId) throw new ValidationError('otherId obrigatório');
  if (myId === otherId) throw new ValidationError('Não é possível conversar consigo mesmo');
  return buildDirectConvId(myId, otherId);
}

/**
 * Devolve o convId canônico pra um 3-way (eu, pintor, loja).
 * Mesma lógica de findOrCreateConversation: convId é determinístico, a
 * "criação" só acontece quando a 1ª mensagem é inserida. O system msg
 * `__STORE_ADDED__` é o marker que diferencia 3-way de 1:1 na listagem.
 *
 * O usuário painterId precisa ser != myId. A loja é resolvida pelo caller
 * via calicolors helpers; aqui só montamos o convId+prefix.
 */
export async function findOrCreate3WayWithStore(
  myId: string,
  painterId: string,
): Promise<string> {
  if (!myId) throw new ValidationError('myId obrigatório');
  if (!painterId) throw new ValidationError('painterId obrigatório');
  if (myId === painterId) throw new ValidationError('Pintor e usuário precisam ser diferentes');
  return build3WayConvId(myId, painterId);
}

// ─── Messages ────────────────────────────────────────────────────────────

/**
 * Busca o histórico de mensagens de uma conversa (mais antigas primeiro,
 * estilo IG/WhatsApp). Filtra mensagens system (markers internos como
 * __STORE_ADDED__) pra UI não pintar bolha vazia.
 */
export async function fetchMessages(
  convId: string,
  limit: number = DEFAULT_MESSAGES_LIMIT,
): Promise<Message[]> {
  if (!convId) return [];
  const sb = getSupabase();
  const safeLimit = Math.min(Math.max(1, limit), MESSAGES_LIMIT_MAX);
  const { data, error } = await sb
    .from('messages')
    .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new NetworkError(error.message, error);
  const rows = (data ?? []) as RawMessageRow[];
  // Inverte pra ordem cronológica (asc) e filtra system markers.
  return rows
    .filter((m) => m.type !== 'system')
    .reverse()
    .map(rowToMessage);
}

function rowToMessage(r: RawMessageRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    receiverId: r.receiver_id,
    content: r.content,
    type: (r.type as MessageType) ?? 'text',
    createdAt: r.created_at,
    status: 'sent',
  };
}

/**
 * Insere uma mensagem. NÃO chama /api/moderate aqui — moderação é do caller
 * (hook useSendMessage chama antes do mutate). Service só faz I/O puro.
 *
 * receiverId é obrigatório no banco (NOT NULL). Pro 3-way com loja, o caller
 * pode passar o ID da loja ou o ID do pintor (ambos válidos como receiver
 * canônico). Em chat genuinamente 1:1 é sempre o outro participante.
 */
export async function sendMessage(
  convId: string,
  fromId: string,
  toId: string,
  content: string,
  type: MessageType = 'text',
): Promise<Message> {
  if (!convId) throw new ValidationError('convId obrigatório');
  if (!fromId) throw new ValidationError('fromId obrigatório');
  if (!toId) throw new ValidationError('toId obrigatório');
  const trimmed = (content ?? '').trim();
  if (!trimmed && type === 'text') throw new ValidationError('Mensagem vazia');

  const sb = getSupabase();
  const { data, error } = await sb
    .from('messages')
    .insert({
      sender_id: fromId,
      receiver_id: toId,
      conversation_id: convId,
      content: type === 'text' ? trimmed : content,
      type,
    })
    .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
    .single();
  if (error) throw new NetworkError(error.message, error);
  if (!data) throw new NetworkError('Mensagem não retornada');
  return rowToMessage(data as RawMessageRow);
}

/**
 * Insere o marker __STORE_ADDED__ que sinaliza promoção de 1:1 → 3-way.
 * Caller usa em findOrCreate3WayWithStore pra que fetchConversations
 * (no fallback) reconheça o convId como 3-way.
 */
export async function markConversationAs3Way(
  convId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  await sendMessage(convId, fromId, toId, '__STORE_ADDED__', 'system');
}

// ─── Attachments ─────────────────────────────────────────────────────────

/**
 * Faz upload de um attachment pro bucket `posts` (path
 * `<userId>/chat/<timestamp>.<ext>` — policy do bucket exige user_id como
 * 1º segmento). Retorna URL pública + tipo MIME pra caller mapear pra
 * MessageType.
 *
 * Validações:
 *  - Tipo MIME na allowlist (imagem/vídeo/áudio).
 *  - Tamanho ≤ MAX_ATTACHMENT_BYTES (10MB).
 *  - User autenticado (caller passa userId; service confia que veio do
 *    AuthProvider/useAuth — se não veio, ValidationError).
 */
export async function uploadAttachment(
  userId: string,
  file: File,
): Promise<AttachmentUploadResult> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('Arquivo obrigatório');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(
      `Arquivo muito grande (máx ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`,
    );
  }
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_ATTACHMENT_MIMES.includes(mime)) {
    throw new ValidationError('Tipo de arquivo não permitido');
  }

  const sb = getSupabase();
  // Path: user_id é OBRIGATÓRIO como 1º segmento pra storage policy aceitar.
  // ext: pega depois do último ponto; sanitiza pra não escapar do path.
  const rawName = file.name || 'arquivo';
  const dot = rawName.lastIndexOf('.');
  const ext = (dot >= 0 ? rawName.slice(dot + 1) : 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${userId}/chat/${Date.now()}.${ext || 'bin'}`;

  const { error } = await sb.storage.from('posts').upload(path, file, {
    upsert: true,
    contentType: mime,
  });
  if (error) throw new NetworkError(error.message, error);

  const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
  const url = urlData?.publicUrl ?? '';
  if (!url) throw new NetworkError('URL pública não disponível');

  let messageType: 'image' | 'video' | 'audio';
  if (ALLOWED_IMAGE_MIMES.includes(mime)) messageType = 'image';
  else if (ALLOWED_VIDEO_MIMES.includes(mime)) messageType = 'video';
  else messageType = 'audio';

  return { url, mimeType: mime, messageType };
}

// ─── User search ─────────────────────────────────────────────────────────

/**
 * Busca usuários por nome/tag pro modal "Nova conversa".
 *
 * Validações:
 *  - Query trim < 2 chars → [] (não bate na rede). Vanilla usava < 2 também.
 *  - Exclui IDs em excludeIds (normalmente: o próprio user + quem já tem
 *    conversa ativa pra evitar duplicação).
 *
 * Estratégia: pega top 200 de profiles_public e filtra no client (mesma
 * lógica do vanilla — RPC não existe ainda; full-text search seria upgrade
 * futuro). Caller faz debounce do textbox via useSearchUsers hook.
 */
export async function searchUsers(
  query: string,
  excludeIds: string[] = [],
): Promise<UserMini[]> {
  const q = (query ?? '').replace('@', '').trim().toLowerCase();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return [];

  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles_public')
    .select('id, name, tag, avatar_url, role, user_type')
    .limit(200);
  if (error) throw new NetworkError(error.message, error);

  const excludeSet = new Set(excludeIds);
  const filtered: UserMini[] = [];
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(raw.id ?? '');
    if (!id || excludeSet.has(id)) continue;
    const name = String(raw.name ?? '');
    const tag = (raw.tag as string | null) ?? null;
    const n = name.toLowerCase();
    const t = (tag ?? '').toLowerCase();
    if (!n.includes(q) && !t.includes(q)) continue;
    const role = (raw.role as string | null) ?? (raw.user_type as string | null) ?? null;
    filtered.push({
      id,
      name: name || null,
      tag,
      avatarUrl: (raw.avatar_url as string | null) ?? null,
      role,
      isProfessional: isProfessionalRole(role),
    });
  }
  return filtered;
}

/**
 * Resolve o user ID da loja Cali Colors. Necessário porque o app guarda só
 * o email no constant — o ID é descoberto via tag (`calicolorstintas`) ou
 * fallback por busca no nome (`ilike '%cali%'`).
 *
 * Retorna null se não achou — caller decide fallback (ex.: criar conversa
 * temporária sem persistir).
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

// chat-types.ts — tipos compartilhados pela feature chat.
// Vivem aqui (não em lib/types.ts) porque o spec proíbe mexer no types.ts
// global e porque o shape difere (snake_case do banco → camelCase no app).
// Re-exportados pelo barrel chat.ts.

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
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'store'
  | 'system';
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

/**
 * Linha bruta da tabela `messages` (snake_case do banco). Interna ao service,
 * mas exportada pra que helpers de subarquivos compartilhem o tipo sem
 * redeclarar.
 */
export interface RawMessageRow {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  conversation_id: string;
  content: string;
  type: string | null;
  created_at: string;
}

// ─── Constantes ──────────────────────────────────────────────────────────

// Email canônico da loja oficial. Usado para resolver o ID quando a tag/nome
// dela mudou. Hardcoded porque o usuário verifica em CLAUDE.md.
export const CALICOLORS_EMAIL = 'calicolortintas@gmail.com';

// Tamanho máximo de attachment (10MB — alinhado com o spec do prompt; bucket
// `posts` aceita até 50MB mas pra chat 10MB é razoável e protege bandwidth).
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

// MIMEs aceitos. Imagens + vídeo + áudio (voice notes do composer).
export const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
export const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const ALLOWED_AUDIO_MIMES = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
];
export const ALLOWED_ATTACHMENT_MIMES = [
  ...ALLOWED_IMAGE_MIMES,
  ...ALLOWED_VIDEO_MIMES,
  ...ALLOWED_AUDIO_MIMES,
];

// ─── Helpers puros (sem rede) ────────────────────────────────────────────

/**
 * Gera o conversation_id canônico pra um chat 1:1. Sorted+join pra que
 * (A,B) e (B,A) resolvam pro mesmo ID — sem isso, dois usuários abrindo o
 * chat simultaneamente criariam duas conversas paralelas.
 *
 * Throw é trivial — o caller é sempre nosso código, com user logado.
 */
export function buildDirectConvId(myId: string, otherId: string): string {
  if (!myId || !otherId) throw new Error('IDs obrigatórios');
  return [myId, otherId].sort().join('_');
}

/**
 * Prefixo 3-way pra distinguir conversas com loja inserida. O backend não tem
 * coluna `is3way` em conversations — usamos o system msg `__STORE_ADDED__`
 * pra detectar; o prefix no convId é só pro client roteador (ChatConversation
 * lê o prefix pra pintar o header 3-way mesmo antes do fetch das mensagens).
 */
export function build3WayConvId(myId: string, painterId: string): string {
  if (!myId || !painterId) throw new Error('IDs obrigatórios');
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
 * Vive aqui pra que searchUsers e qualquer caller futuro reaproveite.
 */
export function isProfessionalRole(
  role: string | null | undefined,
): boolean {
  if (!role) return false;
  const r = String(role).toLowerCase();
  return /pintor|grafit|automotiv|funile/.test(r);
}

/**
 * Converte uma linha bruta do banco em Message (camelCase + status default).
 * Compartilhado entre fetchMessages e sendMessage.
 */
export function rowToMessage(r: RawMessageRow): Message {
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

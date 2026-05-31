// chat.ts — barrel re-export da feature chat. Service principal foi splitado
// em arquivos focados (chat-conversations, chat-messages, chat-attachments,
// chat-users, chat-types) pra ficar abaixo do limite de 400 linhas por
// arquivo. Consumers (hooks, app pages, testes) importam daqui sem precisar
// saber da subdivisão.
//
// O que NÃO foi portado do vanilla (intencional):
//  - Cache em localStorage (saveConvLocal/loadConvsLocal/saveMsgLocal):
//    TanStack Query (placeholderData/staleTime) cobre o paint-instant que
//    o vanilla resolvia com localStorage. Manter dois caches paralelos era
//    fonte conhecida de drift no vanilla.
//  - Auto-reply / addStoreToChat lógica de UI (banner, header avatars):
//    moveu pra componentes React; service só expõe findOrCreate3WayWithStore
//    e a inserção do system msg `__STORE_ADDED__` via markConversationAs3Way.
//  - Color rotation (_msgColors): pura função utility, vive em MessageBubble.
//  - Anti-duplicate _processedMsgIds Map: mora no hook useChatRealtime
//    (estado cross-render), não no service.
//  - Display name helpers (convDisplayName, stripEmail): viraram puros em
//    components/MessageBubble e ConversationItem.

export type {
  ConversationMeta,
  Message,
  MessageType,
  MessageStatus,
  UserMini,
  AttachmentUploadResult,
  RawMessageRow,
} from './chat-types';

export {
  CALICOLORS_EMAIL,
  MAX_ATTACHMENT_BYTES,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  ALLOWED_AUDIO_MIMES,
  ALLOWED_ATTACHMENT_MIMES,
  buildDirectConvId,
  build3WayConvId,
  is3WayConvId,
  strip3WayPrefix,
  isProfessionalRole,
  rowToMessage,
} from './chat-types';

export {
  fetchConversations,
  findOrCreateConversation,
  findOrCreate3WayWithStore,
  resolveCalicolorsUserId,
} from './chat-conversations';

export {
  fetchMessages,
  sendMessage,
  markConversationAs3Way,
} from './chat-messages';

export { uploadAttachment } from './chat-attachments';

export { searchUsers } from './chat-users';

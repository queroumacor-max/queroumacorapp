// MessageBubble — bolha individual de mensagem. Equivalente ao `appendMsg`
// + `_msgColors` do vanilla (modules/chat.js). Toda formatação via JSX puro,
// sem dangerouslySetInnerHTML — content é text plain ou URL de imagem/vídeo,
// sanitizado por React por default.
//
// 3 kinds:
//  - 'me' → verde, alinhada à direita.
//  - 'other' → cor estável por sender (rotação de paleta).
//  - 'store' → roxo (Cali Colors), avatar "CC".

'use client';

import { memo } from 'react';
import type { Message } from '@/lib/services/chat';

export type BubbleKind = 'me' | 'other' | 'store';

export interface BubbleColors {
  fg: string;
  chip: string;
  bub: string;
  bd: string;
}

const ME_COLOR: BubbleColors = { fg: '#0f9d6b', chip: '#dff5ec', bub: '#e7f8f1', bd: '#bfe8d7' };
const STORE_COLOR: BubbleColors = { fg: '#7a30d6', chip: '#efe7fb', bub: '#f3edfb', bd: '#d9c7f5' };

// Paleta de cores rotacionada por sender — espelha _msgPalette do vanilla.
// 6 cores; sender_id N → palette[N % 6]. Estável por sender_id pra que cada
// participante mantenha a mesma cor através de re-renders.
const PALETTE: BubbleColors[] = [
  { fg: '#2563eb', chip: '#e8f0fe', bub: '#eef4ff', bd: '#cdddfb' }, // azul
  { fg: '#d2541f', chip: '#fff1e8', bub: '#fff3ec', bd: '#f6d4bf' }, // laranja
  { fg: '#be1e63', chip: '#fde8f1', bub: '#fef3f8', bd: '#f5c9dd' }, // rosa
  { fg: '#15803d', chip: '#e3f9ec', bub: '#ecfdf3', bd: '#b8e8cd' }, // verde
  { fg: '#a16207', chip: '#fdf6dd', bub: '#fffbeb', bd: '#f3e3a8' }, // amarelo
  { fg: '#4338ca', chip: '#e6ecff', bub: '#f0f5ff', bd: '#c7d2fe' }, // indigo
];

/**
 * Hash determinístico de uma string em [0, n). djb2 simplificado — suficiente
 * pra dispersar IDs em 6 buckets de cor. Não precisa de criptografia.
 */
function hashStringToInt(s: string, n: number): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % n;
}

export function getBubbleColors(kind: BubbleKind, senderId: string): BubbleColors {
  if (kind === 'me') return ME_COLOR;
  if (kind === 'store') return STORE_COLOR;
  return PALETTE[hashStringToInt(senderId, PALETTE.length)] ?? PALETTE[0]!;
}

// Detecta URL de imagem pelo path. NÃO suportamos query string com '?' pra
// não confundir com URLs de assinatura — basta hostname + ext.
function isImageUrl(s: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|heic|heif)(\?|$)/i.test(s);
}

function isVideoUrl(s: string): boolean {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(s);
}

function isAudioUrl(s: string): boolean {
  return /\.(mp3|m4a|ogg|webm)(\?|$)/i.test(s) && !isVideoUrl(s);
}

// Prefixo gravado pelo trigger de auto-resposta (Wave 39). É o CONTRATO
// anti-loop do banco — o conteúdo armazenado não muda; aqui só trocamos a
// APRESENTAÇÃO: em vez do texto cru com 🤖, uma etiqueta com o Seu Zé.
const AUTO_REPLY_PREFIX = '🤖 Resposta automática:';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export interface MessageBubbleProps {
  message: Message;
  kind: BubbleKind;
  senderName?: string | null;
  senderAvatar?: string | null;
  /** Recebe a própria mensagem — permite ao MessageList passar o handler do
   *  pai direto, sem criar uma arrow function nova por bolha a cada render. */
  onRetry?: (message: Message) => void;
}

function MessageBubbleInner({
  message,
  kind,
  senderName,
  senderAvatar,
  onRetry,
}: MessageBubbleProps) {
  const colors = getBubbleColors(kind, message.senderId);
  const isMe = kind === 'me';
  const isStore = kind === 'store';
  const time = formatTime(message.createdAt);
  const failed = message.status === 'failed';
  const sending = message.status === 'sending';

  // Conteúdo: text plain, ou attachment renderizado conforme tipo.
  let content: React.ReactNode;
  if (message.type === 'image' || (message.type === 'text' && isImageUrl(message.content))) {
    content = (
      <img
        src={message.content}
        alt="anexo"
        className="max-w-[240px] rounded-lg block"
        loading="lazy"
      />
    );
  } else if (message.type === 'video' || (message.type === 'text' && isVideoUrl(message.content))) {
    content = (
      <video
        src={message.content}
        controls
        className="max-w-[240px] rounded-lg block"
        preload="metadata"
      />
    );
  } else if (message.type === 'audio' || (message.type === 'text' && isAudioUrl(message.content))) {
    content = <audio src={message.content} controls className="max-w-[240px]" preload="metadata" />;
  } else if (message.type === 'text' && message.content.startsWith(AUTO_REPLY_PREFIX)) {
    // Auto-resposta: etiqueta com o Seu Zé no lugar do "🤖 Resposta
    // automática:" cru. O marcador segue no banco (anti-loop do trigger);
    // só a renderização muda.
    const rest = message.content.slice(AUTO_REPLY_PREFIX.length).replace(/^\n/, '');
    content = (
      <span className="block">
        <span className="flex items-center gap-1.5 mb-1" style={{ opacity: 0.8 }}>
          <img
            src="/img/seu-ze.webp"
            alt=""
            width={16}
            height={16}
            className="rounded-full flex-shrink-0"
            loading="lazy"
          />
          <span
            className="font-bold uppercase"
            style={{ fontSize: 9, letterSpacing: '.06em' }}
          >
            Resposta automática
          </span>
        </span>
        <span className="whitespace-pre-wrap break-words">{rest}</span>
      </span>
    );
  } else {
    // Texto plain — React escapa automaticamente. Mantemos newlines.
    content = <span className="whitespace-pre-wrap break-words">{message.content}</span>;
  }

  // Avatar pra non-me. Loja sempre mostra "CC"; outros usam imagem ou inicial.
  const avatarNode = !isMe
    ? (
      <span
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden"
        style={{ background: colors.chip, color: colors.fg }}
        aria-hidden="true"
      >
        {isStore ? (
          'CC'
        ) : senderAvatar ? (
          <img src={senderAvatar} alt="" className="w-full h-full object-cover" />
        ) : (
          (senderName ?? '?').charAt(0).toUpperCase()
        )}
      </span>
    )
    : null;

  const displayName = isStore ? 'Cali Colors' : (senderName ?? '');

  return (
    <div
      className={'flex gap-2 mb-3 ' + (isMe ? 'justify-end' : 'justify-start')}
    >
      {avatarNode}
      <div className={'flex flex-col max-w-[75%] ' + (isMe ? 'items-end' : 'items-start')}>
        {!isMe && displayName ? (
          <span
            className="text-[10px] font-semibold mb-0.5 px-2 py-0.5 rounded"
            style={{ color: colors.fg, background: colors.chip }}
          >
            {displayName}
          </span>
        ) : null}
        <div
          className={'rounded-2xl px-3 py-2 text-sm border ' + (sending ? 'opacity-60' : '')}
          style={{
            background: colors.bub,
            borderColor: colors.bd,
            // A bolha é sempre um pastel BEM claro, nos dois temas — preto
            // fixo, sem variável. `--color-ink-fixed` (#1a1a2e) ainda não
            // bastava pro usuário no dark mode; `--color-ink` puro (que
            // inverte pra creme claro no dark) é o que deixava ilegível.
            color: '#000',
          }}
        >
          {content}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-[color:var(--color-muted,#888)]">{time}</span>
          {sending ? (
            <span className="text-[10px] text-[color:var(--color-muted,#888)]">enviando…</span>
          ) : null}
          {failed ? (
            <button
              type="button"
              onClick={() => onRetry?.(message)}
              className="text-[10px] text-red-600 underline"
              aria-label="Tentar enviar novamente"
            >
              falhou — tentar de novo
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// memo: bolha renderizada em .map() na conversa — evita re-render de bolhas
// que não mudaram quando o pai atualiza por outro motivo (ex.: participantInfo
// resolvendo em outro sender). Efeito pleno depende de MessageList passar
// `onRetry` com referência estável (ver comentário lá).
export const MessageBubble = memo(MessageBubbleInner);


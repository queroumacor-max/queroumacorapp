// MessageList — render virtual da lista de mensagens. Auto-scroll pro fim
// quando muda o tamanho ou quando o user manda msg. Sem virtualização por
// enquanto (50 msgs default é tranquilo); se virar gargalo, react-virtuoso
// ou react-window resolvem.

'use client';

import { useEffect, useRef } from 'react';
import { MessageBubble, type BubbleKind } from '@/components/MessageBubble';
import type { Message } from '@/lib/services/chat';

export interface MessageListProps {
  messages: Message[];
  myId: string;
  /** ID da loja (resolvido por useCalicolorsId). null = não detectada. */
  storeId: string | null;
  /** Map sender_id → nome+avatar pra mensagens received. Vem do hook. */
  participantInfo: Map<string, { name: string | null; avatar: string | null }>;
  onRetry: (msg: Message) => void;
}

function kindFor(
  msg: Message,
  myId: string,
  storeId: string | null,
): BubbleKind {
  if (msg.type === 'store') return 'store';
  if (msg.senderId === myId) return 'me';
  if (storeId && msg.senderId === storeId) return 'store';
  return 'other';
}

export function MessageList({
  messages,
  myId,
  storeId,
  participantInfo,
  onRetry,
}: MessageListProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll pro fim toda vez que muda o tamanho da lista.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // Defer um tick pra deixar o DOM pintar.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div
        ref={scrollerRef}
        className="flex-1 flex items-center justify-center p-8 text-center text-sm text-[color:var(--color-muted,#666)]"
      >
        Sem mensagens ainda. Mande a primeira!
      </div>
    );
  }

  return (
    <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4">
      {messages.map((m) => {
        const kind = kindFor(m, myId, storeId);
        const info = participantInfo.get(m.senderId);
        return (
          <MessageBubble
            key={m.id}
            message={m}
            kind={kind}
            senderName={info?.name ?? null}
            senderAvatar={info?.avatar ?? null}
            onRetry={() => onRetry(m)}
          />
        );
      })}
    </div>
  );
}

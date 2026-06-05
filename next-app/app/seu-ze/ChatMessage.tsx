// ChatMessage — bubble visual de uma mensagem da thread. Espelha o markup
// inline de modules/ai-chat.js (sendAiChat linhas 61 e 121) mas como
// componente React.
//
// Direção do bubble:
//   - user: alinhado à direita, fundo escuro (var(--color-ink)), texto branco
//   - assistant: alinhado à esquerda, fundo creme, avatar do Seu Zé ao lado
//
// Renderização do texto:
//   - Quebras de linha (\n) viram <br/> (whitespace-pre-wrap no Tailwind)
//   - Markdown **bold** vira <strong> (regex simples, mesma do vanilla)
//   - Sem HTML cru — usamos texto puro + replace controlado
//
// Botão "🔊 Ouvir": só renderiza pra mensagens do assistente. Click chama o
// callback `onSpeak`. Spinner aparece se `isSpeaking` é true.

'use client';

import Image from 'next/image';

export interface AvatarConfig {
  /** ReactNode customizado pro avatar (ex.: imagem da Alice Codessi).
   *  Quando definido, ignora src/alt. */
  node?: React.ReactNode;
  /** Caminho da imagem (usado se node não for passado). */
  src?: string;
  /** Texto alternativo da imagem. */
  alt?: string;
  /** Label da typing-indicator (a11y). Default: "Seu Zé está digitando". */
  typingLabel?: string;
}

const DEFAULT_AVATAR: Required<Omit<AvatarConfig, 'node'>> = {
  src: '/img/seu-ze.webp',
  alt: 'Seu Zé',
  typingLabel: 'Seu Zé está digitando',
};

export interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  isSpeaking?: boolean;
  onSpeak?: () => void;
  avatar?: AvatarConfig;
}

// Renderiza markdown ULTRA básico (só **bold**). NÃO usa dangerouslySetInnerHTML
// — quebra o texto em segmentos e devolve um array de spans/strong tipados.
function renderBoldSegments(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={`b${i}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
    i++;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : [text];
}

function renderAvatar(avatar: AvatarConfig | undefined): React.ReactNode {
  if (avatar?.node) return avatar.node;
  const src = avatar?.src ?? DEFAULT_AVATAR.src;
  const alt = avatar?.alt ?? DEFAULT_AVATAR.alt;
  return (
    <Image
      src={src}
      alt={alt}
      width={28}
      height={28}
      className="rounded-full bg-[#1a1a2e] flex-shrink-0 object-cover object-top"
      unoptimized
    />
  );
}

export function ChatMessage({
  role,
  content,
  isSpeaking,
  onSpeak,
  avatar,
}: ChatMessageProps) {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 bg-[color:var(--color-ink)] text-white text-sm whitespace-pre-wrap break-words">
          {renderBoldSegments(content)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2 mb-3 items-start">
      {renderAvatar(avatar)}
      <div className="flex-1 min-w-0">
        <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 bg-[color:var(--color-bg)] text-[color:var(--color-ink)] text-sm leading-relaxed whitespace-pre-wrap break-words">
          {renderBoldSegments(content)}
        </div>
        {onSpeak ? (
          <button
            type="button"
            onClick={onSpeak}
            aria-label={isSpeaking ? 'Parar áudio' : 'Ouvir resposta'}
            className="mt-1 text-xs text-[color:var(--color-muted)] hover:text-[color:var(--color-ink)] transition-colors"
          >
            {isSpeaking ? '⏸ Parar' : '🔊 Ouvir'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Typing indicator (3 dots animado). Usado enquanto o assistente processa.
export function TypingIndicator({ avatar }: { avatar?: AvatarConfig } = {}) {
  const label = avatar?.typingLabel ?? DEFAULT_AVATAR.typingLabel;
  return (
    <div className="flex gap-2 mb-3 items-start" aria-label={label}>
      {renderAvatar(avatar)}
      <div className="rounded-2xl px-3.5 py-2.5 bg-[color:var(--color-bg)] text-[color:var(--color-muted)] text-sm">
        <span className="inline-block animate-pulse">•</span>
        <span className="inline-block animate-pulse" style={{ animationDelay: '0.15s' }}>
          •
        </span>
        <span className="inline-block animate-pulse" style={{ animationDelay: '0.3s' }}>
          •
        </span>
      </div>
    </div>
  );
}

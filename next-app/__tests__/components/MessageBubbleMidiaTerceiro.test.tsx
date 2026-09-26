// @vitest-environment jsdom
//
// Auditoria 2026-09-26: <img>/<video>/<audio> com URL de terceiro vazam o IP
// de quem abre a conversa. Mídia só renderiza quando vem do Storage do
// Supabase (anexos do chat) ou da própria origem; o resto vira link.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MessageBubble } from '@/components/MessageBubble';
import type { Message } from '@/lib/services/chat';

function msg(content: string, type: Message['type'] = 'text'): Message {
  return {
    id: 'm1',
    conversationId: 'a_b',
    senderId: 's',
    receiverId: 'r',
    content,
    type,
    createdAt: '2026-09-26T12:00:00Z',
    status: 'sent',
  };
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://uwq.supabase.co');
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('MessageBubble — mídia de terceiro', () => {
  it('anexo do Supabase vira <img>', () => {
    const url = 'https://uwq.supabase.co/storage/v1/object/public/posts/u/chat/1.jpg';
    const { container } = render(<MessageBubble message={msg(url, 'image')} kind="other" />);
    expect(container.querySelector(`img[src="${url}"]`)).toBeTruthy();
  });

  it('imagem de OUTRO projeto Supabase NÃO carrega (Codex #412)', () => {
    const url = 'https://attacker.supabase.co/functions/v1/pixel.jpg';
    const { container } = render(<MessageBubble message={msg(url, 'image')} kind="other" />);
    expect(container.querySelector('img[src*="attacker"]')).toBeNull();
  });

  it('imagem de host terceiro NÃO carrega — vira link', () => {
    const url = 'https://rastreador.example/pixel.png';
    const { container } = render(<MessageBubble message={msg(url, 'image')} kind="other" />);
    expect(container.querySelector('img[src*="rastreador"]')).toBeNull();
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe(url);
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('texto com cara de vídeo de terceiro também não carrega', () => {
    const url = 'https://rastreador.example/v.mp4';
    const { container } = render(<MessageBubble message={msg(url)} kind="other" />);
    expect(container.querySelector('video')).toBeNull();
  });

  it('javascript: com tipo image vira texto puro, sem href', () => {
    const { container } = render(
      <MessageBubble message={msg('javascript:alert(1)//x.png', 'image')} kind="other" />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});

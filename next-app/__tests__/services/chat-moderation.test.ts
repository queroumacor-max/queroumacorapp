import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/_services/moderate', () => ({ moderateContent: vi.fn() }));
vi.mock('@/lib/api/security', () => ({
  getSupabaseUrl: () => 'https://x.supabase.co',
  getServiceKey: () => 'svc',
}));

import { moderateContent } from '@/lib/api/_services/moderate';
import {
  moderarMensagemDeChat,
  participantesDaMensagem,
  mensagemReprovada,
} from '@/lib/api/_services/chat-moderation';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const msg = {
  id: '44444444-4444-4444-8444-444444444444',
  sender_id: A,
  receiver_id: B,
  conversation_id: `3way:${A}_${C}`,
  content: 'texto',
  type: 'text',
  deleted_at: null,
};

describe('chat-moderation', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('participantes = remetente + destinatário + UUIDs do convId (3-way)', () => {
    expect(participantesDaMensagem(msg).sort()).toEqual([A, B, C].sort());
  });

  it('qualquer flagged reprova', () => {
    expect(mensagemReprovada({ flagged: true, approved: true })).toBe(true);
    expect(mensagemReprovada({ flagged: false, approved: true })).toBe(false);
  });

  it('aprovada: não apaga nem avisa', async () => {
    vi.mocked(moderateContent).mockResolvedValue({ flagged: false, severity: 'none', reasons: [] } as never);
    expect(await moderarMensagemDeChat(msg)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reprovada: soft delete + broadcast pra cada participante', async () => {
    vi.mocked(moderateContent).mockResolvedValue({ flagged: true, severity: 'hard', reasons: ['x'] } as never);
    expect(await moderarMensagemDeChat(msg)).toBe(true);
    const [patchUrl, patchInit] = fetchMock.mock.calls[0];
    expect(String(patchUrl)).toContain(`/rest/v1/messages?id=eq.${msg.id}&deleted_at=is.null`);
    expect(patchInit.method).toBe('PATCH');
    const [bcUrl, bcInit] = fetchMock.mock.calls[1];
    expect(String(bcUrl)).toContain('/realtime/v1/api/broadcast');
    const topics = JSON.parse(bcInit.body).messages.map((m: { topic: string }) => m.topic).sort();
    expect(topics).toEqual([A, B, C].map((u) => `chat-global-${u}`).sort());
  });

  it('já apagada: não chama a IA', async () => {
    vi.mocked(moderateContent).mockClear();
    expect(await moderarMensagemDeChat({ ...msg, deleted_at: '2026-09-23T00:00:00Z' })).toBe(false);
    expect(moderateContent).not.toHaveBeenCalled();
  });
});

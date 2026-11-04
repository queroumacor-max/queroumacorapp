// @vitest-environment jsdom
//
// Composer — quem vê o "Marcar como venda" e onde o botão de legenda IA
// aparece. As duas regras dependem de estado que sobrevive a troca de aba
// (o toggle continua ligado depois de virar story), então o teste cobre
// tanto o que some da TELA quanto o que vai pro BANCO.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const mockAuth = { user: { id: 'u1' } as { id: string } | null, loading: false };
const mockPolicyUser = {
  value: { id: 'u1', role: 'pintor' } as Record<string, unknown> | null,
};
// A publicação roda em SEGUNDO PLANO (lib/publicacaoFila.ts): o Composer só
// entrega o pedido. `publishAsync` é o espião desse pedido.
const publishAsync = vi.fn<(input: Record<string, unknown>, ctx?: unknown) => boolean>(
  () => true,
);
const publicando = { valor: false };

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => mockAuth,
}));

vi.mock('@/lib/hooks/usePolicyUser', () => ({
  usePolicyUser: () => mockPolicyUser.value,
}));

vi.mock('@/lib/publicacaoFila', () => ({
  iniciarPublicacao: (input: Record<string, unknown>, ctx: unknown) => publishAsync(input, ctx),
  publicandoAgora: () => publicando.valor,
}));

vi.mock('@/lib/hooks/useAutosave', () => ({
  useAutosave: () => ({ clear: vi.fn(), lastSavedAt: 0 }),
}));

import { Composer } from '@/app/publicar/Composer';

/** Anexa uma foto ao composer (mídia é obrigatória pra publicar). */
function attachPhoto() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['x'], 'obra.jpg', { type: 'image/jpeg' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

function switchToStory() {
  fireEvent.click(screen.getByText('24h'));
}

beforeEach(() => {
  // jsdom não implementa object URLs (o MediaPreview usa pra thumbnail).
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
  publishAsync.mockClear();
  publicando.valor = false;
  mockAuth.user = { id: 'u1' };
  mockPolicyUser.value = { id: 'u1', role: 'pintor' };
});

afterEach(() => {
  cleanup();
});

describe('Composer — "Marcar como venda"', () => {
  it('aparece pra pintor', () => {
    render(<Composer />);
    expect(screen.queryByTestId('for-sale-toggle')).toBeTruthy();
  });

  it('NÃO aparece pra cliente', () => {
    mockPolicyUser.value = { id: 'u1', role: 'cliente' };
    render(<Composer />);
    expect(screen.queryByTestId('for-sale-toggle')).toBeNull();
  });

  it('NÃO aparece na aba Story', () => {
    render(<Composer />);
    switchToStory();
    expect(screen.queryByTestId('for-sale-toggle')).toBeNull();
  });

  it('publica com for_sale=false se o toggle foi ligado e depois virou story', async () => {
    render(<Composer />);
    fireEvent.click(screen.getByTestId('for-sale-toggle'));
    switchToStory();
    attachPhoto();

    await act(async () => {
      fireEvent.click(screen.getByText('Publicar'));
    });

    expect(publishAsync).toHaveBeenCalledTimes(1);
    const payload = publishAsync.mock.calls[0][0];
    expect(payload.mediaType).toBe('story');
    expect(payload.forSale).toBe(false);
    expect(payload.price).toBeNull();
    expect(payload.artType).toBeNull();
  });
});

// Story ficou sem legenda e sem link "ver mais" (decisão da loja,
// 01/09/2026): é conteúdo rápido que some em 24h, e pedir texto só atrasa
// quem quer postar a foto da obra e seguir trabalhando.
describe('Composer — Story é só a mídia', () => {
  it('a aba Story não mostra legenda nem link', () => {
    render(<Composer />);
    switchToStory();
    expect(screen.queryByPlaceholderText(/Conte um pouco/i)).toBeNull();
    expect(screen.queryByText(/Link "ver mais"/i)).toBeNull();
  });

  it('a aba Post continua com a legenda', () => {
    render(<Composer />);
    expect(screen.queryByPlaceholderText(/Conte um pouco/i)).toBeTruthy();
  });

  it('story publica sem legenda mesmo com texto digitado antes na aba Post', async () => {
    render(<Composer />);
    // Escreve na aba Post…
    fireEvent.change(screen.getByPlaceholderText(/Conte um pouco/i), {
      target: { value: 'texto que ficou pra trás' },
    });
    // …e troca pra Story, onde o campo nem existe mais.
    switchToStory();
    attachPhoto();
    await act(async () => {
      fireEvent.click(screen.getByText('Publicar'));
    });
    const payload = publishAsync.mock.calls[0][0];
    expect(payload.mediaType).toBe('story');
    expect(payload.caption).toBe('');
    expect(payload.linkUrl).toBeNull();
  });
});

describe('Composer — legenda por IA', () => {
  it('mostra o botão em post', () => {
    render(<Composer />);
    expect(screen.queryByLabelText('Gerar legenda com IA')).toBeTruthy();
  });

  // Antes o story mostrava o campo de legenda com o botão de IA escondido.
  // Desde 01/09/2026 o story não tem legenda nenhuma, então some tudo junto.
  it('em story não há legenda — logo, nem botão de IA nem contador', () => {
    render(<Composer />);
    switchToStory();
    expect(screen.queryByLabelText('Gerar legenda com IA')).toBeNull();
    expect(screen.queryByText('0/2000')).toBeNull();
  });

  it('volta a mostrar legenda e botão ao sair do story', () => {
    render(<Composer />);
    switchToStory();
    fireEvent.click(screen.getByText('Publicação'));
    expect(screen.queryByLabelText('Gerar legenda com IA')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Conte um pouco/i)).toBeTruthy();
  });
});

// Enquadramento (2026-09-07): a pessoa escolhe a proporção do post e o que
// fica dentro dela. "Original" é o padrão — quem não mexe publica como
// sempre, e o hook nem passa pelo canvas.
describe('Composer — Enquadramento', () => {
  it('aparece quando há foto na aba Publicação, com "Original" marcado', () => {
    render(<Composer />);
    expect(screen.queryByTestId('enquadramento')).toBeNull();
    attachPhoto();
    expect(screen.queryByTestId('enquadramento')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Original' }).getAttribute('aria-checked')).toBe('true');
  });

  it('NÃO aparece na aba 24h (story é tela cheia)', () => {
    render(<Composer />);
    switchToStory();
    attachPhoto();
    expect(screen.queryByTestId('enquadramento')).toBeNull();
  });

  it('publica com a proporção escolhida e a posição centralizada por padrão', async () => {
    render(<Composer />);
    attachPhoto();
    fireEvent.click(screen.getByRole('radio', { name: 'Quadrado' }));
    fireEvent.click(screen.getByRole('radio', { name: /Ajustar/ }));
    await act(async () => {
      fireEvent.click(screen.getByText('Publicar'));
    });
    const payload = publishAsync.mock.calls[0][0] as {
      enquadramento?: { proporcao: string; modo: string; deslocamentos: Array<{ x: number; y: number }> };
    };
    expect(payload.enquadramento?.proporcao).toBe('1:1');
    expect(payload.enquadramento?.modo).toBe('ajustar');
    expect(payload.enquadramento?.deslocamentos).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('story publica SEM enquadramento', async () => {
    render(<Composer />);
    switchToStory();
    attachPhoto();
    await act(async () => {
      fireEvent.click(screen.getByText('Publicar'));
    });
    const payload = publishAsync.mock.calls[0][0];
    expect(payload.enquadramento).toBeUndefined();
  });
});

describe('Composer — publicação em segundo plano (04/11/2026)', () => {
  it('entrega o pedido e LIMPA a tela na hora, sem ficar em "Publicando…"', async () => {
    const onDone = vi.fn();
    render(<Composer embedded onPublishSuccess={onDone} />);
    attachPhoto();
    await act(async () => {
      fireEvent.click(screen.getByTestId('publish-btn'));
    });
    expect(publishAsync).toHaveBeenCalledTimes(1);
    expect(publishAsync.mock.calls[0][1]).toMatchObject({ userId: 'u1' });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Publicando/)).toBeNull();
    expect(screen.getByTestId('publish-btn').textContent).toBe('Publicar');
  });

  it('com outra publicação enviando, não entrega um segundo pedido', async () => {
    publicando.valor = true;
    const onDone = vi.fn();
    render(<Composer embedded onPublishSuccess={onDone} />);
    attachPhoto();
    await act(async () => {
      fireEvent.click(screen.getByTestId('publish-btn'));
    });
    expect(publishAsync).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/Espere a publicação anterior/)).toBeTruthy();
  });

  it('e-mail não confirmado é barrado com a tela ainda aberta', async () => {
    (mockAuth as Record<string, unknown>).emailVerified = false;
    try {
      render(<Composer embedded onPublishSuccess={vi.fn()} />);
      attachPhoto();
      await act(async () => {
        fireEvent.click(screen.getByTestId('publish-btn'));
      });
      expect(publishAsync).not.toHaveBeenCalled();
      expect(screen.getByText(/Confirme seu email/)).toBeTruthy();
    } finally {
      delete (mockAuth as Record<string, unknown>).emailVerified;
    }
  });
});

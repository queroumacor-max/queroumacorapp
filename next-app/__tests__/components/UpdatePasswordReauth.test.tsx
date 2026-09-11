// @vitest-environment jsdom
//
// /update-password (auditoria de autenticação 2026-09-11):
//   - sessão COMUM nesta tela exige a senha atual antes de trocar (sessão
//     roubada não vira senha nova);
//   - sessão de RECOVERY (link do e-mail) troca direto;
//   - depois de trocar, as OUTRAS sessões são revogadas.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const updateUser = vi.fn();
const signInWithPassword = vi.fn();
const signOut = vi.fn();
let listeners: Array<(ev: string, sess: unknown) => void> = [];
const SESSAO = { user: { email: 'eu@x.com' }, access_token: 'a' };

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: SESSAO } }),
      onAuthStateChange: (cb: (ev: string, sess: unknown) => void) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      updateUser,
      signInWithPassword,
      signOut,
    },
  }),
}));

import { UpdatePasswordForm, urlDeRecuperacao } from '@/app/update-password/UpdatePasswordForm';

async function preencherESalvar(atual?: string) {
  await waitFor(() => screen.getByLabelText('Nova senha'));
  if (atual !== undefined) {
    fireEvent.change(screen.getByLabelText('Senha atual'), { target: { value: atual } });
  }
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'senhaNova123' } });
  fireEvent.change(screen.getByLabelText('Confirme a senha'), { target: { value: 'senhaNova123' } });
  await act(async () => {
    fireEvent.click(screen.getByText('Salvar nova senha'));
  });
}

beforeEach(() => {
  cleanup();
  listeners = [];
  updateUser.mockReset().mockResolvedValue({ error: null });
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  window.history.replaceState({}, '', '/update-password');
});

describe('urlDeRecuperacao', () => {
  it('reconhece type=recovery no fragment e na query', () => {
    expect(urlDeRecuperacao('https://x.com/update-password#access_token=a&type=recovery')).toBe(true);
    expect(urlDeRecuperacao('https://x.com/update-password?code=abc&type=recovery')).toBe(true);
    expect(urlDeRecuperacao('https://x.com/update-password')).toBe(false);
    expect(urlDeRecuperacao('https://x.com/update-password#type=signup')).toBe(false);
  });
});

describe('UpdatePasswordForm — sessão comum', () => {
  it('sem senha atual → não troca', async () => {
    render(<UpdatePasswordForm />);
    await preencherESalvar('');
    expect(updateUser).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toContain('Informe a senha atual');
  });

  it('senha atual errada (GoTrue recusa) → não troca', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<UpdatePasswordForm />);
    await preencherESalvar('errada');
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'eu@x.com', password: 'errada' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('senha atual certa → troca e revoga as outras sessões', async () => {
    render(<UpdatePasswordForm />);
    await preencherESalvar('certa');
    expect(updateUser).toHaveBeenCalledWith({ password: 'senhaNova123' });
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
  });
});

describe('UpdatePasswordForm — link de recuperação', () => {
  it('URL com type=recovery: não pede senha atual, troca direto e revoga as outras', async () => {
    window.history.replaceState({}, '', '/update-password#access_token=a&type=recovery');
    render(<UpdatePasswordForm />);
    await waitFor(() => screen.getByLabelText('Nova senha'));
    expect(screen.queryByLabelText('Senha atual')).toBeNull();
    await preencherESalvar();
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith({ password: 'senhaNova123' });
    expect(signOut).toHaveBeenCalledWith({ scope: 'others' });
  });

  it('evento PASSWORD_RECOVERY também liga o modo recovery', async () => {
    render(<UpdatePasswordForm />);
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));
    await act(async () => {
      listeners.forEach((cb) => cb('PASSWORD_RECOVERY', SESSAO));
    });
    await waitFor(() => screen.getByLabelText('Nova senha'));
    expect(screen.queryByLabelText('Senha atual')).toBeNull();
  });
});

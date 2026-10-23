// @vitest-environment jsdom
//
// Regras do passo 2 do cadastro pedidas em 07/09/2026. São de PRODUTO, não
// de estilo — por isso viram teste: sem elas o cadastro volta a deixar
// campo vazio passar, e foi campo vazio (a @tag) que originou o loop do
// /completar-perfil.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';

vi.mock('@/lib/hooks/useTagAvailability', () => ({
  useTagAvailability: () => 'available',
}));
vi.mock('@/lib/hooks/useOfereceCamera', () => ({ useOfereceCamera: () => false }));
vi.mock('@/lib/native', () => ({
  native: {
    camera: {
      isPickerAvailable: () => false,
      pickImages: vi.fn(),
      takePhoto: vi.fn(),
    },
  },
}));

const cidadesMock = vi.fn(async (_uf: string) => ['Guarulhos', 'São Paulo', 'Santos']);
vi.mock('@/lib/services/profile', () => ({
  getCidadesByUF: (uf: string) => cidadesMock(uf),
}));

import { SignupStep2 } from '@/app/signup/SignupStep2';

function montar(onNext = vi.fn()) {
  render(<SignupStep2 userType="pintor" onNext={onNext} onBack={vi.fn()} />);
  return onNext;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('nome', () => {
  it('vira Maiúscula Inicial enquanto digita, e recusa número e símbolo', () => {
    montar();
    const nome = screen.getByLabelText('Nome completo') as HTMLInputElement;
    fireEvent.change(nome, { target: { value: 'joão da silva 123' } });
    expect(nome.value).toBe('João da Silva ');
  });
});

describe('@tag', () => {
  it('a sugestão entra NO CAMPO, não num botão embaixo', async () => {
    montar();
    fireEvent.change(screen.getByLabelText('Nome completo'), {
      target: { value: 'Maria Souza' },
    });
    const tag = screen.getByLabelText('Seu apelido') as HTMLInputElement;
    await waitFor(() => expect(tag.value).toBe('mariasouza'));
    // O botão "Usar @..." não existe mais — a sugestão já está preenchida.
    expect(screen.queryByText(/Usar @/)).toBeNull();
  });

  it('não sobrescreve o que a pessoa digitou', async () => {
    montar();
    const tag = screen.getByLabelText('Seu apelido') as HTMLInputElement;
    fireEvent.change(tag, { target: { value: 'minhatag' } });
    fireEvent.change(screen.getByLabelText('Nome completo'), {
      target: { value: 'Outro Nome' },
    });
    await waitFor(() => expect(tag.value).toBe('minhatag'));
  });
});

describe('telefone', () => {
  it('o rótulo é Telefone, e não WhatsApp', () => {
    montar();
    expect(screen.getByLabelText('Telefone')).toBeTruthy();
    expect(screen.queryByLabelText(/WhatsApp/)).toBeNull();
  });

  it('é obrigatório até pro Cliente (antes era opcional pra ele)', () => {
    render(<SignupStep2 userType="cliente" onNext={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByLabelText(/opcional/i)).toBeNull();
  });
});

describe('estado e cidade', () => {
  it('estado aparece ANTES da cidade na ordem da tela', () => {
    const { container } = render(
      <SignupStep2 userType="pintor" onNext={vi.fn()} onBack={vi.fn()} />,
    );
    const html = container.innerHTML;
    expect(html.indexOf('id="state"')).toBeLessThan(html.indexOf('id="city"'));
  });

  it('cidade só libera depois do estado, e carrega as cidades daquela UF', async () => {
    montar();
    const cidade = screen.getByLabelText('Cidade') as HTMLInputElement;
    expect(cidade.disabled).toBe(true);

    const estado = screen.getByLabelText('Estado') as HTMLInputElement;
    fireEvent.focus(estado);
    fireEvent.change(estado, { target: { value: 'são pau' } });
    // Digitar filtra a lista; o clique escolhe.
    fireEvent.mouseDown(await screen.findByText('São Paulo'));

    await waitFor(() => expect(cidadesMock).toHaveBeenCalledWith('SP'));
    await waitFor(() => expect(cidade.disabled).toBe(false));

    fireEvent.focus(cidade);
    fireEvent.change(cidade, { target: { value: 'guaru' } });
    fireEvent.mouseDown(await screen.findByText('Guarulhos'));
    await waitFor(() => expect(cidade.value).toBe('Guarulhos'));
  });
});

describe('foto', () => {
  it('segue OPCIONAL — continuar sem ela não pode travar o cadastro', async () => {
    // Foi obrigatória por algumas horas em 07/09/2026 e voltou atrás no mesmo
    // dia: no Android, abrir a galeria pode fazer o sistema matar o processo
    // do app, e aí a foto obrigatória vira porta trancada (incidente de
    // 28/08). Este teste existe pra ela não voltar a ser porta sem querer.
    const onNext = montar();
    fireEvent.change(screen.getByLabelText('Nome completo'), {
      target: { value: 'Maria Souza' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'maria@exemplo.com' },
    });
    fireEvent.change(screen.getByLabelText('Telefone'), {
      target: { value: '(11) 99999-9999' },
    });
    fireEvent.change(screen.getByLabelText('Data de nascimento'), {
      target: { value: '10/10/1991' },
    });
    const estado = screen.getByLabelText('Estado') as HTMLInputElement;
    fireEvent.focus(estado);
    fireEvent.change(estado, { target: { value: 'são pau' } });
    fireEvent.mouseDown(await screen.findByText('São Paulo'));
    const cidade = screen.getByLabelText('Cidade') as HTMLInputElement;
    await waitFor(() => expect(cidade.disabled).toBe(false));
    fireEvent.focus(cidade);
    fireEvent.change(cidade, { target: { value: 'guaru' } });
    fireEvent.mouseDown(await screen.findByText('Guarulhos'));

    await act(async () => {
      fireEvent.click(screen.getByText('Continuar →'));
    });
    // Sem foto, e mesmo assim avança.
    await waitFor(() => expect(onNext).toHaveBeenCalled());
    expect(onNext.mock.calls[0][0].avatarFile).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Vaga } from '@/lib/vagas';

const fetchVagasAtivas = vi.fn();
const abrirLinkExterno = vi.fn();
vi.mock('@/lib/services/vagas', () => ({ fetchVagasAtivas: () => fetchVagasAtivas() }));
vi.mock('@/lib/native/browser', () => ({ abrirLinkExterno: (u: string) => abrirLinkExterno(u) }));

import { VagasView } from '@/app/vagas/VagasView';

const vaga: Vaga = {
  id: 'v1',
  titulo: 'Pintor predial (temporário)',
  empresa: 'Grupo VRS',
  cidade: 'Guarulhos',
  bairro: 'Vila Aeroporto',
  descricao: 'Pintura de paredes e tetos.',
  remuneracao: 'R$ 2.612,74/mês',
  contato: '(11) 96655-8012',
  contato_whatsapp: true,
  contato_obs: 'Citar "Pintor Predial #14024"',
  fonte: 'InfoJobs',
  fonte_url: 'https://www.infojobs.com.br/vaga',
  anuncio_em: '2026-11-05',
  created_at: '2026-11-10T00:00:00Z',
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VagasView />
    </QueryClientProvider>,
  );
}

describe('VagasView', () => {
  afterEach(cleanup);
  beforeEach(() => {
    fetchVagasAtivas.mockReset();
    abrirLinkExterno.mockReset();
  });

  it('mostra a vaga e abre o WhatsApp do anúncio pelo helper da casca', async () => {
    fetchVagasAtivas.mockResolvedValue([vaga]);
    montar();
    expect(await screen.findByText('Pintor predial (temporário)')).toBeTruthy();
    expect(screen.getByText('Grupo VRS · Vila Aeroporto, Guarulhos')).toBeTruthy();
    expect(screen.getByText('R$ 2.612,74/mês')).toBeTruthy();
    expect(screen.getByText(/Anúncio de 05\/11\/2026 · Fonte: InfoJobs/)).toBeTruthy();
    fireEvent.click(screen.getByText('Chamar no WhatsApp'));
    expect(abrirLinkExterno.mock.calls[0][0]).toMatch(/^https:\/\/wa\.me\/5511966558012/);
    fireEvent.click(screen.getByText('Ver anúncio'));
    expect(abrirLinkExterno.mock.calls[1][0]).toBe('https://www.infojobs.com.br/vaga');
  });

  it('sem vaga: diz que não há nenhuma aberta, sem erro', async () => {
    fetchVagasAtivas.mockResolvedValue([]);
    montar();
    expect(await screen.findByText(/Nenhuma vaga aberta agora/)).toBeTruthy();
  });

  it('contato que não é telefone válido aparece como texto, sem botão', async () => {
    fetchVagasAtivas.mockResolvedValue([{ ...vaga, contato: 'portaria do prédio', fonte_url: null }]);
    montar();
    expect(await screen.findByText('Contato: portaria do prédio')).toBeTruthy();
    expect(screen.queryByText('Chamar no WhatsApp')).toBeNull();
    expect(screen.queryByText('Ver anúncio')).toBeNull();
  });

  it('falha de rede: mostra o erro com "Tentar de novo"', async () => {
    fetchVagasAtivas.mockRejectedValue(new Error('rede'));
    montar();
    await waitFor(() => expect(screen.getByText('Tentar de novo')).toBeTruthy());
  });
});

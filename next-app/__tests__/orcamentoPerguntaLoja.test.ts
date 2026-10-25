// Trava o pedido de 2026-10-25: o botão "Enviar para a loja" saiu (abria a
// lista de conversas e perdia o texto) e toda ação do orçamento passa pela
// pergunta "mandar os itens pra Cali Colors?" antes de seguir.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'app', 'orcamento-ia', 'QuoteWizard.tsx'), 'utf8');

describe('QuoteWizard: pergunta da loja', () => {
  it('o botão "Enviar para a loja" não existe mais', () => {
    expect(SRC).not.toContain("📤 Enviar para a loja");
    expect(SRC).not.toMatch(/handleSendChat/);
  });

  it('Visualizar, PDF, Gravar e as 3 opções de compartilhar passam pela pergunta', () => {
    for (const acao of [
      'comPerguntaDaLoja(() => setPreviewOpen(true))',
      'comPerguntaDaLoja(() => void handlePdf())',
      'comPerguntaDaLoja(() => void handleSave())',
      'comPerguntaDaLoja(handleSendWhatsApp)',
      'comPerguntaDaLoja(handleSendEmail)',
      'comPerguntaDaLoja(handleShareNative)',
    ]) {
      expect(SRC).toContain(acao);
    }
  });

  it('o modal fica acima do BottomSheet (1000) e da prévia (1100)', () => {
    const modal = SRC.slice(SRC.indexOf('function PerguntaDaLojaModal'));
    const z = Number(/zIndex: (\d+)/.exec(modal)?.[1]);
    expect(z).toBeGreaterThan(1100);
    expect(modal).toContain('para que lhe enviem um orçamento');
  });

  it('a mensagem pra loja usa o texto sem dados do cliente', () => {
    expect(SRC).toMatch(/textoDosItensParaLoja\(form\.servicos/);
  });
});

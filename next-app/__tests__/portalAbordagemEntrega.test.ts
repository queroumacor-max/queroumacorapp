// Portal: "contactado" só depois que a Meta confirma (2026-09-09).
//
// O incidente: o portal marcava `status='contactado'` assim que a API
// aceitava o template; o `failed` 131026 que chegava minutos depois ficava
// só na conversa. Este arquivo lê o FONTE do portal (arquivo único, sem
// módulos) e trava: (1) o portal NÃO escreve mais `contactado` ao enviar;
// (2) manda o `leadId` pra rota nos três caminhos; (3) a descrição da
// abordagem que a tabela mostra sai de uma função pura, avaliada aqui.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let fonte = '';
let descreverAbordagem: (l: Record<string, unknown>) => null | {
  status: string; rotulo: string; cor: string; erro: string; titulo: string; quando: string;
};
let ABORDAGEM_GRUPOS: Record<string, (l: Record<string, unknown>) => boolean>;
let abordagemPendente: (l: Record<string, unknown>, agora: number) => boolean;

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  const inicio = fonte.indexOf('// [teste:abordagem-inicio]');
  const fim = fonte.indexOf('// [teste:abordagem-fim]');
  expect(inicio).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(inicio);
  ({ descreverAbordagem, ABORDAGEM_GRUPOS, abordagemPendente } = new Function(
    `${fonte.slice(inicio, fim)}; return { descreverAbordagem, ABORDAGEM_GRUPOS, abordagemPendente };`
  )());
});

describe('o envio não marca contactado; quem marca é o servidor', () => {
  it('enviarTemplateDaLoja não escreve status=contactado', () => {
    expect(fonte).not.toContain("update({ status:'contactado' })");
    expect(fonte).not.toContain("status: 'contactado' }).eq('id', leadId)");
  });
  it('a rota recebe o leadId (unitário, lote e aba WhatsApp)', () => {
    expect(fonte).toContain('body: pacote.registro, leadId: leadId || undefined,');
    expect(fonte).toContain('enviarTemplateDaLoja({ alvo, pacote, leadId: lead.id })');
    expect(fonte).toContain('pacote: pacoteDeTemplate(tpl, vars, x.valores), leadId: x.lead.id');
    expect(fonte).toContain('leadId: leadDoContatoAberto ? leadDoContatoAberto.id : undefined');
  });
  it('recusa da API fica registrada no lead como failed, com o motivo', () => {
    expect(fonte).toContain("update({ abordagem_status:'failed', abordagem_error: String(erro).slice(0,300)");
  });
  it('a tabela mostra a abordagem embaixo do status e tem o filtro Entrega', () => {
    expect(fonte).toContain('<AbordagemBadge lead={l} />');
    expect(fonte).toContain("out.filter(ABORDAGEM_GRUPOS[fEntrega])");
  });
});

describe('descreverAbordagem', () => {
  it('lead nunca abordado (ou coluna ausente) → null', () => {
    expect(descreverAbordagem({})).toBeNull();
    expect(descreverAbordagem({ abordagem_status: null })).toBeNull();
    expect(descreverAbordagem({ abordagem_status: 'xyz' })).toBeNull();
  });
  it('failed traz o motivo resumido (código · título) na linha', () => {
    const d = descreverAbordagem({
      abordagem_status: 'failed',
      abordagem_error: '131026 · Message undeliverable · Message Undeliverable.',
      abordagem_at: '2026-09-09T18:22:00Z',
    });
    expect(d).not.toBeNull();
    expect(d!.rotulo).toBe('⚠ não entregue');
    expect(d!.erro).toBe('131026 · Message undeliverable');
    expect(d!.titulo).toContain('131026');
    expect(d!.quando).toMatch(/09\/09/);
  });
  it('failed sem motivo não fica mudo', () => {
    expect(descreverAbordagem({ abordagem_status: 'failed' })!.erro).toBe('a Meta não detalhou');
  });
  it('accepted / sent / delivered / read têm rótulo próprio e sem erro', () => {
    expect(descreverAbordagem({ abordagem_status: 'accepted' })!.rotulo).toContain('aguardando');
    expect(descreverAbordagem({ abordagem_status: 'sent' })!.rotulo).toBe('✓ enviada');
    expect(descreverAbordagem({ abordagem_status: 'delivered' })!.rotulo).toBe('✓✓ entregue');
    expect(descreverAbordagem({ abordagem_status: 'read' })!.rotulo).toBe('✓✓ lida');
    expect(descreverAbordagem({ abordagem_status: 'sent' })!.erro).toBe('');
  });
});

describe('ABORDAGEM_GRUPOS (filtro Entrega)', () => {
  it('cada lead cai em exatamente um grupo além de Todas/enviada', () => {
    const exclusivos = ['falhou', 'entregue', 'aguardando', 'semAbordagem'];
    for (const st of [null, 'accepted', 'sent', 'delivered', 'read', 'failed']) {
      const l = { abordagem_status: st };
      const n = exclusivos.filter((k) => ABORDAGEM_GRUPOS[k](l)).length;
      // `sent` só está em "enviada" (o guarda-chuva) — não é entregue nem pendente.
      expect(n, String(st)).toBe(st === 'sent' ? 0 : 1);
      expect(ABORDAGEM_GRUPOS.Todas(l)).toBe(true);
    }
    expect(ABORDAGEM_GRUPOS.enviada({ abordagem_status: 'sent' })).toBe(true);
    expect(ABORDAGEM_GRUPOS.enviada({ abordagem_status: 'failed' })).toBe(false);
  });
});

describe('abordagemPendente (quando a lista se atualiza sozinha)', () => {
  const agora = Date.parse('2026-09-09T18:30:00Z');
  it('accepted há 2 min → pendente; há 1h → não; failed → não', () => {
    expect(abordagemPendente({ abordagem_status: 'accepted', abordagem_at: '2026-09-09T18:28:00Z' }, agora)).toBe(true);
    expect(abordagemPendente({ abordagem_status: 'accepted', abordagem_at: '2026-09-09T17:30:00Z' }, agora)).toBe(false);
    expect(abordagemPendente({ abordagem_status: 'failed', abordagem_at: '2026-09-09T18:28:00Z' }, agora)).toBe(false);
    expect(abordagemPendente({ abordagem_status: 'accepted' }, agora)).toBe(false);
  });
});

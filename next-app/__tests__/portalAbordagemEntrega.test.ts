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

// ── Status 'fixo' (2026-09-09) ──────────────────────────────────────────────
// Telefone fixo sem WhatsApp: a abordagem por template nunca chega. A lista
// de status é UMA (`LEADS_STATUS`) e alimenta o select da linha, o filtro
// do topo, o do cabeçalho e as contagens — status novo entra ali e em
// nenhum outro lugar.
describe("status 'fixo'", () => {
  it('existe na lista única e tem rótulo', () => {
    expect(fonte).toContain("const LEADS_STATUS = ['novo','contactado','qualificado','convertido','perdido','fixo'];");
    expect(fonte).toContain("fixo: 'Fixo (sem WhatsApp)'");
    // Nenhuma lista de status escrita à mão sobrou.
    expect(fonte).not.toContain("['novo','contactado','qualificado','convertido','perdido']");
    expect(fonte).not.toContain('<option value="perdido">Perdido</option>');
  });
  it('lead fixo sai da seleção em lote', () => {
    expect(fonte).toContain("l.status !== 'fixo' && !!normalizeLeadPhone(l.phone)");
  });
});

// Achado do review (2026-09-09): lead marcado no lote e DEPOIS mudado pra
// 'fixo' continuava em `sel` e recebia o template. A seleção efetiva passa
// por `abordavel` de novo, e o modal do lote rejeita 'fixo' sozinho.
describe("lead 'fixo' não passa pelo lote nem por seleção antiga", () => {
  it('a seleção efetiva reaplica abordavel e a barra conta por ela', () => {
    expect(fonte).toContain('const selecionados = leads.filter(l => sel.has(l.id) && abordavel(l));');
    expect(fonte).toContain('{selecionados.length > 0 ? (');
    expect(fonte).not.toContain('{sel.size > 0 ? (');
  });
  it('o modal do lote rejeita fixo por conta própria', () => {
    expect(fonte).toContain("l.status === 'fixo' ? 'marcado como fixo (sem WhatsApp)'");
  });
});

// ── Rótulos de reação / edição / unsupported na conversa (2026-09-09) ──────
describe('rotuloDeTipo (bolha e prévia da lista)', () => {
  let rotuloDeTipo: (m: Record<string, unknown>) => string | null;
  beforeAll(() => {
    const i = fonte.indexOf('// [teste:rotulo-tipo-inicio]');
    const f = fonte.indexOf('// [teste:rotulo-tipo-fim]');
    expect(i).toBeGreaterThan(0);
    expect(f).toBeGreaterThan(i);
    ({ rotuloDeTipo } = new Function(`${fonte.slice(i, f)}; return { rotuloDeTipo };`)());
  });
  it('reação mostra o emoji; sem emoji é remoção', () => {
    expect(rotuloDeTipo({ type: 'reaction', body: '👍' })).toBe('👍 reagiu a uma mensagem');
    expect(rotuloDeTipo({ type: 'reaction', body: '' })).toBe('removeu a reação');
  });
  it('edição mostra o texto novo quando veio', () => {
    expect(rotuloDeTipo({ type: 'edit', body: 'área externa?' })).toBe('✏️ editou: área externa?');
    expect(rotuloDeTipo({ type: 'edit' })).toBe('✏️ editou uma mensagem');
  });
  it('unsupported explica e manda olhar o celular; texto comum devolve null', () => {
    expect(rotuloDeTipo({ type: 'unsupported' })).toContain('veja no celular');
    expect(rotuloDeTipo({ type: 'text', body: 'oi' })).toBeNull();
  });
  it('a bolha e a prévia passam pelo rótulo', () => {
    expect(fonte).toContain('const especial = rotuloDeTipo(m);\n  if(especial) return <span');
    expect(fonte).toContain('const especial = rotuloDeTipo(m);\n  if(especial) return especial;');
  });
});

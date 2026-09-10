// {{3}} do template de abordagem: "trabalha com {{3}}".
//
// O modal de abordagem preenche as três variáveis sozinho — {{1}} nome,
// {{2}} cidade, {{3}} segmento (decisão de 2026-09-07). O {{3}} sai de
// `ramoDoLead`, que traduz a CATEGORIA da tabela ("Funilaria/Auto") pra
// uma frase que cabe no meio da mensagem ("funilaria e pintura
// automotiva"). Este teste lê o fonte do portal (arquivo único, sem
// módulos) e avalia o bloco entre os marcadores `[teste:ramo-*]`.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Lead = {
  category?: string | null;
  segment?: string | null;
  city?: string | null;
  address?: string | null;
  name?: string | null;
};

let LEAD_PITCH: Record<string, { ramo?: string; funil: string }>;
let ramoDoLead: (l: Lead | null | undefined) => string | null;
let cidadeDoLead: (l: Lead | null | undefined) => string | null;
let fonte = '';

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  const ini = fonte.indexOf('const LEAD_PITCH =');
  const fim = fonte.indexOf('// [teste:ramo-fim]');
  expect(ini, 'marcador de início do bloco de ramo sumiu').toBeGreaterThan(0);
  expect(fim, 'marcador // [teste:ramo-fim] sumiu').toBeGreaterThan(ini);
  const bloco = fonte.slice(ini, fim);
  // Bloco tem que ser JS puro — JSX aqui quebraria o `new Function` e o
  // vitest reportaria o arquivo como skipped (verde falso, 2026-09-05).
  expect(bloco, 'JSX dentro do bloco de ramo').not.toMatch(/<[A-Za-z/]/);
  const mod = new Function(bloco + '\nreturn { LEAD_PITCH, ramoDoLead, cidadeDoLead };')() as {
    LEAD_PITCH: typeof LEAD_PITCH;
    ramoDoLead: typeof ramoDoLead;
    cidadeDoLead: typeof cidadeDoLead;
  };
  LEAD_PITCH = mod.LEAD_PITCH;
  ramoDoLead = mod.ramoDoLead;
  cidadeDoLead = mod.cidadeDoLead;
});

describe('ramoDoLead ({{3}} do template de abordagem)', () => {
  // Categoria nova sem `ramo` cairia no rótulo cru da tabela ("trabalha
  // com Funilaria/Auto") — o teste obriga a decidir a frase junto.
  it('toda categoria do LEAD_PITCH tem ramo, em minúsculo e sem barra', () => {
    for (const [cat, p] of Object.entries(LEAD_PITCH)) {
      expect(p.ramo, `categoria sem ramo: ${cat}`).toBeTruthy();
      expect(p.ramo, cat).toBe(p.ramo!.toLowerCase());
      expect(p.ramo, cat).not.toMatch(/[/|]/);
    }
  });

  it('casos da tela: os leads do print', () => {
    expect(ramoDoLead({ category: 'Engenharia', segment: 'COMERCIAL' })).toBe('engenharia civil');
    expect(ramoDoLead({ category: 'Pintor', segment: 'RESIDENCIAL' })).toBe('pintura residencial');
    expect(ramoDoLead({ category: 'Funilaria/Auto', segment: 'AUTOMOTIVO' })).toBe('funilaria e pintura automotiva');
    expect(ramoDoLead({ category: 'Graffiti/Arte', segment: 'GRAFFITI' })).toBe('graffiti e arte urbana');
  });

  it('categoria desconhecida cai no segmento', () => {
    expect(ramoDoLead({ category: 'Closed', segment: 'RESIDENCIAL' })).toBe('pintura residencial');
    expect(ramoDoLead({ category: null, segment: 'automotivo' })).toBe('pintura automotiva');
  });

  it('sem segmento conhecido, usa a categoria em minúsculo', () => {
    expect(ramoDoLead({ category: 'Serralheria', segment: 'OUTROS' })).toBe('serralheria');
  });

  // Sem pista nenhuma o campo fica vazio e o botão trava — inventar um ramo
  // mandaria dado errado pro cliente.
  it('sem pista nenhuma, devolve null', () => {
    expect(ramoDoLead({ category: '', segment: '' })).toBeNull();
    expect(ramoDoLead({})).toBeNull();
    expect(ramoDoLead(null)).toBeNull();
  });
});

describe('EnvioDeTemplate preenche {{2}} cidade e {{3}} segmento', () => {
  // Não dá pra renderizar o componente (arquivo sem módulos), então o teste
  // trava o CONTRATO no fonte: o prefill lê `dadosContato`, e os dois
  // chamadores passam cidade + ramo.
  it('o componente aceita dadosContato e o usa nos índices 2 e 3', () => {
    expect(fonte).toMatch(/const EnvioDeTemplate = \(\{[^}]*dadosContato[^}]*\}\)/);
    expect(fonte).toMatch(/va\.indice === 2 \? cidade/);
    expect(fonte).toMatch(/va\.indice === 3 \? segmento/);
  });

  it('abordagem de lead e aba WhatsApp passam cidade + ramoDoLead', () => {
    expect(fonte).toContain('dadosContato={{ cidade: cidadeDoLead(lead), segmento: ramoDoLead(lead) }}');
    expect(fonte).toContain('dadosContato={dadosDoContatoAberto}');
    expect(fonte).toContain('{ cidade: cidadeDoLead(leadDoContatoAberto), segmento: ramoDoLead(leadDoContatoAberto) }');
    // Ninguém volta a ler `.city` cru no prefill: era o que deixava o campo 2
    // vazio pro lead antigo que guardou a cidade no endereço (2026-09-08).
    expect(fonte).not.toMatch(/cidade: (lead|leadDoContatoAberto)\.city/);
  });

  // A aba WhatsApp só consegue preencher se a consulta de leads trouxer os
  // dois campos — tirar `city`/`segment` do select apagaria o prefill em
  // silêncio.
  it('a consulta de leads da aba WhatsApp traz city e segment', () => {
    expect(fonte).toMatch(/from\('leads'\)\.select\('id, name, phone, category, segment, city, status', extra\)/);
  });
});

// ── {{2}} cidade: a coluna, o endereço ou o nome ─────────────────────────
// O print de 2026-09-08: lead "Studio Arquitetura Guarulhos", coluna CIDADE
// em "—", "Guarulhos" embaixo do nome (era o `address`), e o modal de
// abordagem com o campo 2 vazio e o botão travado. A cidade estava na base
// — só não estava na coluna que o prefill lia.
describe('cidadeDoLead ({{2}} do template de abordagem)', () => {
  it('coluna city preenchida vence', () => {
    expect(cidadeDoLead({ city: 'Osasco', address: 'Guarulhos' })).toBe('Osasco');
  });

  it('endereço que é só a cidade (lead antigo de captação)', () => {
    expect(cidadeDoLead({ address: 'Guarulhos' })).toBe('Guarulhos');
    expect(cidadeDoLead({ address: 'Guarulhos - SP' })).toBe('Guarulhos');
    expect(cidadeDoLead({ address: 'Guarulhos/SP' })).toBe('Guarulhos');
    expect(cidadeDoLead({ address: 'Pimentas, Guarulhos - SP' })).toBe('Guarulhos');
  });

  it('rua com número ou logradouro NÃO vira cidade', () => {
    expect(cidadeDoLead({ address: 'R. Manaus, 158' })).toBeNull();
    expect(cidadeDoLead({ address: 'Av. Paulista' })).toBeNull();
    expect(cidadeDoLead({ address: 'Jardim dos Pimentas' })).toBeNull();
    expect(cidadeDoLead({ address: 'Estrada Aruja/Itaqua SP 56, 2320, Sala 09' })).toBeNull();
  });

  it('cidade conhecida no nome do lead, com ou sem acento', () => {
    expect(cidadeDoLead({ name: 'Studio Arquitetura Guarulhos', address: 'R. X, 10' })).toBe('Guarulhos');
    expect(cidadeDoLead({ name: 'Studio Aruja Design' })).toBe('Arujá');
    expect(cidadeDoLead({ name: 'Pintor de Sao Paulo' })).toBe('São Paulo');
  });

  it('palavra parecida no nome não conta', () => {
    expect(cidadeDoLead({ name: 'Guarulhense Tintas' })).toBeNull();
  });

  it('marcador da base importada não é cidade', () => {
    expect(cidadeDoLead({ city: 'n/a', address: 'Guarulhos' })).toBe('Guarulhos');
    expect(cidadeDoLead({ city: 'não informado' })).toBeNull();
  });

  it('sem pista nenhuma, devolve null (o campo fica vazio e o botão trava)', () => {
    expect(cidadeDoLead({})).toBeNull();
    expect(cidadeDoLead(null)).toBeNull();
  });

  it('a coluna CIDADE da tabela mostra a mesma cidade que a abordagem usa', () => {
    expect(fonte).toContain("{cidadeDoLead(l) || '—'}");
  });
});

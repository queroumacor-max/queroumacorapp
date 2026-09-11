// Janela de 24h da Cloud API, como o PORTAL a calcula.
//
// Por que testar código do portal aqui: esta lógica decide se a tela oferece
// o campo de texto ou o botão de template — ou seja, se o operador vai
// escrever uma mensagem que a Meta recusa. Errar pra mais (dizer "aberta"
// quando está fechada) devolve 131047 na cara dele; errar pra menos esconde
// o campo sem necessidade e empurra pra um template de Marketing, que é
// cobrado por envio.
//
// O portal não tem bundler nem módulos: as funções são consts soltas num
// arquivo servido direto. Extraímos o bloco do fonte e avaliamos, que é o
// mesmo caminho do `portalApiRoutes.test.ts`.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  escolherTemplate as escolherNoServidor,
  TEMPLATE_SEM_NOME,
} from '@/lib/api/_services/whatsapp';

interface MsgFake {
  direction: 'in' | 'out';
  wa_timestamp?: string | null;
  created_at?: string | null;
}

let janelaAberta: (m: MsgFake[]) => boolean;
let restanteDaJanela: (m: MsgFake[]) => string | null;
let fimDaJanela: (m: MsgFake[]) => number | null;

beforeAll(() => {
  const src = readFileSync(
    join(process.cwd(), 'public/portal/app.jsx'),
    'utf8'
  );
  // Marcadores explícitos, não texto de comentário vizinho: em 2026-09-05
  // um componente JSX foi inserido entre o fim das funções e o comentário
  // que servia de âncora, o `new Function` quebrou no `<` e o arquivo
  // inteiro virou "skipped" — verde na contagem de testes, sem cobertura
  // nenhuma. Marcador nomeado torna o acidente visível.
  const inicio = src.indexOf('const JANELA_MS =');
  const fim = src.indexOf('// [teste:janela-fim]');
  expect(inicio).toBeGreaterThan(-1);
  expect(fim).toBeGreaterThan(inicio);

  const bloco = src.slice(inicio, fim);
  const fabrica = new Function(
    `${bloco}; return { janelaAberta, restanteDaJanela, fimDaJanela };`
  ) as () => {
    janelaAberta: typeof janelaAberta;
    restanteDaJanela: typeof restanteDaJanela;
    fimDaJanela: typeof fimDaJanela;
  };
  ({ janelaAberta, restanteDaJanela, fimDaJanela } = fabrica());
});

afterEach(() => vi.useRealTimers());

const AGORA = new Date('2026-09-05T12:00:00Z');
const haHoras = (h: number) =>
  new Date(AGORA.getTime() - h * 3600000).toISOString();

function entrada(h: number): MsgFake {
  return { direction: 'in', created_at: haHoras(h) };
}
function saida(h: number): MsgFake {
  return { direction: 'out', created_at: haHoras(h) };
}

describe('janela de 24h (portal)', () => {
  beforeAll(() => void 0);

  it('sem histórico → fechada (é o caso da abordagem de lead)', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([])).toBe(false);
    expect(fimDaJanela([])).toBeNull();
  });

  it('mensagem recebida há 2h → aberta', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([entrada(2)])).toBe(true);
  });

  it('mensagem recebida há 25h → fechada', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([entrada(25)])).toBe(false);
  });

  // O ponto que mais confunde: quem abre a janela é o CLIENTE. Mandar
  // mensagem não compra mais 24h — se comprasse, dava pra conversar pra
  // sempre com quem nunca respondeu.
  it('mensagem NOSSA não abre janela, por mais recente que seja', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([entrada(30), saida(0)])).toBe(false);
  });

  it('vale a mensagem recebida MAIS RECENTE, não a primeira', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([entrada(40), entrada(1)])).toBe(true);
    expect(janelaAberta([entrada(1), entrada(40)])).toBe(true);
  });

  it('usa wa_timestamp quando existe (relógio da Meta, não o nosso)', () => {
    vi.setSystemTime(AGORA);
    // created_at antigo, wa_timestamp recente: vale o da Meta.
    expect(
      janelaAberta([
        { direction: 'in', wa_timestamp: haHoras(1), created_at: haHoras(50) },
      ])
    ).toBe(true);
  });

  it('data inválida não vira janela aberta', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([{ direction: 'in', created_at: 'não é data' }])).toBe(false);
    expect(janelaAberta([{ direction: 'in', created_at: null }])).toBe(false);
  });

  it('exatamente 24h → fechada (a borda não conta a favor)', () => {
    vi.setSystemTime(AGORA);
    expect(janelaAberta([entrada(24)])).toBe(false);
  });

  it('restante é legível e some quando fecha', () => {
    vi.setSystemTime(AGORA);
    expect(restanteDaJanela([entrada(2)])).toBe('22h');
    expect(restanteDaJanela([entrada(23.5)])).toBe('30min');
    expect(restanteDaJanela([entrada(25)])).toBeNull();
    expect(restanteDaJanela([])).toBeNull();
  });
});

// ── A regra do template tem que ser a MESMA nos dois lados ───────────────
// O portal decide o que mandar quando o operador clica; o servidor decide
// sozinho no follow-up automático. Se as duas divergirem, um dos caminhos
// acaba mandando `{{1}}` vazio — e o cliente recebe "Oi ,".

let avisoMarketingEUA: (waId: string, cat: string) => string | null;
let ehNumeroEUA: (waId: string) => boolean;
let escolherNoPortal: (
  nome: string | null | undefined,
  preferido?: string,
  dados?: { cidade?: string | null; segmento?: string | null }
) => { template: string; nome: string | null; components?: unknown[] };
let registroDeTemplate: (e: { template: string; nome: string | null }) => string;
let parseRegistroTemplate: (b: string) => { template: string; param: string | null } | null;

describe('escolha de template: portal e servidor concordam', () => {
  beforeAll(() => {
    const src = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = src.indexOf('const TEMPLATE_IDIOMA =');
    const fim = src.indexOf('// [teste:template-fim]');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const fabrica = new Function(
      `${src.slice(inicio, fim)}; return { escolherTemplate, registroDeTemplate, parseRegistroTemplate };`
    ) as () => {
      escolherTemplate: typeof escolherNoPortal;
      registroDeTemplate: (e: { template: string; nome: string | null }) => string;
      parseRegistroTemplate: (b: string) => { template: string; param: string | null } | null;
    };
    const mod = fabrica();
    escolherNoPortal = mod.escolherTemplate;
    registroDeTemplate = mod.registroDeTemplate;
    parseRegistroTemplate = mod.parseRegistroTemplate;
  });

  const CASOS: Array<string | null | undefined> = [
    'Beatris Porsebon',
    'João da Silva',
    'Ângela',
    '',
    '   ',
    null,
    undefined,
    '11987654321',
    '(11) 98765-4321',
    'J Silva',
  ];

  // Cidade + segmento (2026-09-06; era bairro até 07/09). Os dois lados só sobem pro template de
  // 3 variáveis com PROVA de que ele existe — o servidor pela env, o portal
  // pela lista viva que vem da Meta. Sem prova, os dois descem pro de nome:
  // template não aprovado volta 132001 e quebraria a abordagem de todo lead
  // que tem os dois dados.
  it('sem prova de que o template de 3 variáveis existe, os dois descem pro de nome', () => {
    const dados = { cidade: 'Guarulhos', segmento: 'pintura residencial' };
    const p = escolherNoPortal('Beatris', undefined, dados);
    const sv = escolherNoServidor('Beatris', undefined, dados);
    expect(p.template).toBe(sv.template);
    expect(p.components).toEqual(sv.components);
  });

  it('escolhem o mesmo template pros mesmos nomes', () => {
    for (const nome of CASOS) {
      expect(
        { caso: nome, template: escolherNoPortal(nome).template },
        `divergiu em ${JSON.stringify(nome)}`
      ).toEqual({ caso: nome, template: escolherNoServidor(nome).template });
    }
  });

  it('extraem o mesmo primeiro nome', () => {
    for (const nome of CASOS) {
      expect(escolherNoPortal(nome).nome).toBe(escolherNoServidor(nome).nome);
    }
  });

  // O erro que a regra existe pra impedir, verificado dos dois lados.
  it('nenhum dos dois manda {{1}} vazio', () => {
    for (const nome of ['', '   ', null, undefined, '11987654321']) {
      const p = escolherNoPortal(nome);
      const sv = escolherNoServidor(nome);
      expect(p.template).toBe(TEMPLATE_SEM_NOME);
      expect(sv.template).toBe(TEMPLATE_SEM_NOME);
      expect(p.components).toBeUndefined();
      expect(sv.components).toBeUndefined();
    }
  });
});

// ── Guarda dos marcadores ────────────────────────────────────────────────
// Este arquivo lê o fonte do portal por marcador. Se alguém apagar o
// marcador, ou enfiar JSX entre eles, o `new Function` quebra e o vitest
// reporta o arquivo como SKIPPED — a contagem de testes segue verde e a
// cobertura some sem ninguém notar. Aconteceu em 2026-09-05. Este teste
// não depende da extração, então ele falha ALTO quando isso acontece.

describe('marcadores de extração do portal', () => {
  const MARCADORES = [
    '// [teste:janela-fim]',
    '// [teste:template-inicio]',
    '// [teste:template-fim]',
    '// [teste:previa-inicio]',
    '// [teste:previa-fim]',
    '// [teste:erro-supabase-inicio]',
    '// [teste:erro-supabase-fim]',
    'const JANELA_MS =',
    'const TEMPLATE_IDIOMA =',
    'const segmentosDoTemplate =',
    'const textoDeErroSupabase =',
  ];

  let fonte = '';
  beforeAll(() => {
    fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  });

  it('todos os marcadores existem', () => {
    for (const m of MARCADORES) {
      expect(fonte.includes(m), `marcador sumiu do app.jsx: ${m}`).toBe(true);
    }
  });

  it('os blocos extraídos não contêm JSX', () => {
    const blocos = [
      fonte.slice(fonte.indexOf('const JANELA_MS ='), fonte.indexOf('// [teste:janela-fim]')),
      fonte.slice(fonte.indexOf('const TEMPLATE_IDIOMA ='), fonte.indexOf('// [teste:template-fim]')),
      fonte.slice(fonte.indexOf('const segmentosDoTemplate ='), fonte.indexOf('// [teste:previa-fim]')),
      fonte.slice(fonte.indexOf('const textoDeErroSupabase ='), fonte.indexOf('// [teste:erro-supabase-fim]')),
    ];
    for (const b of blocos) {
      expect(b.length).toBeGreaterThan(50);
      // `<` seguido de letra maiúscula ou barra é abertura/fechamento de tag.
      expect(b, 'JSX dentro de um bloco que o teste avalia como JS puro').not.toMatch(/<[A-Za-z/]/);
    }
  });
});

// ── Marketing para número dos EUA ────────────────────────────────────────
// A Meta NÃO entrega template de categoria Marketing para número dos EUA: o
// envio é aceito e o status volta `failed` (131049). Foi o que aconteceu com
// 5 disparos em 2026-09-05 — o portal registrou tudo certo e o cliente nunca
// recebeu. Sem o aviso, o operador repete achando que foi falha de rede.

describe('aviso de marketing para número dos EUA', () => {
  // beforeAll PRÓPRIO: um `beforeAll` dentro de outro describe não vale
  // aqui. Esqueci disso na 1ª versão e os cinco testes falharam com
  // "ehNumeroEUA is not defined" — o que, ao menos, falha alto.
  beforeAll(() => {
    const src = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = src.indexOf('const TEMPLATE_IDIOMA =');
    const fim = src.indexOf('// [teste:template-fim]');
    const fabrica = new Function(
      `${src.slice(inicio, fim)}; return { avisoMarketingEUA, ehNumeroEUA };`
    ) as () => {
      avisoMarketingEUA: typeof avisoMarketingEUA;
      ehNumeroEUA: typeof ehNumeroEUA;
    };
    ({ avisoMarketingEUA, ehNumeroEUA } = fabrica());
  });

  it('reconhece número dos EUA (DDI 1, 11 dígitos)', () => {
    expect(ehNumeroEUA('16502701234')).toBe(true);
    expect(ehNumeroEUA('+1 (650) 270-1234')).toBe(true);
  });

  it('número brasileiro não é confundido', () => {
    // 5511987654321 tem 13 dígitos e começa com 55.
    expect(ehNumeroEUA('5511987654321')).toBe(false);
    expect(ehNumeroEUA('551139876543')).toBe(false);
    // 11 dígitos mas começando com 5 (celular BR sem DDI) também não.
    expect(ehNumeroEUA('11987654321')).toBe(false);
  });

  it('avisa em Marketing + EUA', () => {
    const a = avisoMarketingEUA('16502701234', 'MARKETING');
    expect(a).toContain('marketing');
    expect(a).toContain('Utility');
  });

  it('não avisa em Utility, nem em número brasileiro', () => {
    expect(avisoMarketingEUA('16502701234', 'UTILITY')).toBeNull();
    expect(avisoMarketingEUA('5511987654321', 'MARKETING')).toBeNull();
    expect(avisoMarketingEUA('', 'MARKETING')).toBeNull();
  });

  it('categoria em minúscula também conta', () => {
    expect(avisoMarketingEUA('16502701234', 'marketing')).not.toBeNull();
  });
});

// ── Envio bloqueado com variável vazia ───────────────────────────────────
// A regra "nunca mandar {{1}} vazio" agora vale pra QUALQUER variável: um
// template Utility com {{2}} = nº do orçamento não pode sair com o número
// em branco. A trava é a mesma no componente (botão desabilitado) e aqui
// se descreve o predicado que ele usa.

// ── Modelo inicial do seletor ─────────────────────────────────────────────
// Decisão do usuário (2026-09-08): "abordagem v2 como padrão inicial". O de
// 3 variáveis abre marcado quando a lista (a viva, da Meta) o traz; a
// embutida não o tem, então nela o inicial segue sendo o de nome.
describe('modelo inicial do seletor de template', () => {
  let templateInicial: (lista: Array<{ nome: string }>) => string;
  let fonte = '';
  beforeAll(() => {
    fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = fonte.indexOf('const TEMPLATE_IDIOMA =');
    const fim = fonte.indexOf('// [teste:template-fim]');
    ({ templateInicial } = new Function(
      `${fonte.slice(inicio, fim)}; return { templateInicial };`
    )());
  });

  it('com o v2 na lista, ele é o inicial', () => {
    expect(templateInicial([
      { nome: 'calicolors' }, { nome: 'calicolors_nome' }, { nome: 'calicolors_abordagem_v2' },
    ])).toBe('calicolors_abordagem_v2');
  });

  it('sem o v2, o de nome', () => {
    expect(templateInicial([{ nome: 'calicolors' }, { nome: 'calicolors_nome' }])).toBe('calicolors_nome');
  });

  it('sem nenhum dos dois, o primeiro que houver; lista vazia cai no de nome', () => {
    expect(templateInicial([{ nome: 'outro' }])).toBe('outro');
    expect(templateInicial([])).toBe('calicolors_nome');
  });

  it('o seletor abre com templateInicial e a lista viva só troca enquanto o operador não mexeu', () => {
    // A regra vive no hook `useListaDeTemplates`, usado pelo envio unitário
    // e pelo lote — um só lugar decide.
    expect(fonte).toContain('useState(() => templateInicial(templatesDisponiveis()))');
    expect(fonte).toContain('if(!tocado.current) setEscolhidoBruto(templateInicial(t));');
    expect(fonte).toContain('const escolher = (nome) => { tocado.current = true; setEscolhidoBruto(nome); };');
    expect(fonte).toMatch(/const EnvioDeTemplate = [^\n]*\n\s*const \{[^}]*\} = useListaDeTemplates\(\);/);
    expect(fonte).toMatch(/const AbordagemLoteModal = [^\n]*\n\s*const \{[^}]*\} = useListaDeTemplates\(\);/);
  });
});

// ── {{1}} da abordagem é o nome COMPLETO ─────────────────────────────────
// Decisão do usuário (2026-09-08): o lead é quase sempre um negócio ("Neri
// Pintor Atelier") e "Oi Neri" cortava o nome no meio. A validade é a mesma
// do primeiro nome (telefone e inicial solta não passam).
describe('nome completo no {{1}} do prefill', () => {
  let nomeCompleto: (b: string | null | undefined) => string | null;
  let fonte = '';
  beforeAll(() => {
    fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = fonte.indexOf('const TEMPLATE_IDIOMA =');
    const fim = fonte.indexOf('// [teste:template-fim]');
    ({ nomeCompleto } = new Function(
      `${fonte.slice(inicio, fim)}; return { nomeCompleto };`
    )());
  });

  it('devolve o nome inteiro, não a primeira palavra', () => {
    expect(nomeCompleto('Neri Pintor Atelier')).toBe('Neri Pintor Atelier');
    expect(nomeCompleto('  Studio   Arquitetura Guarulhos ')).toBe('Studio Arquitetura Guarulhos');
    expect(nomeCompleto('Ângela')).toBe('Ângela');
  });

  it('recusa o que o primeiro nome também recusa', () => {
    expect(nomeCompleto('')).toBeNull();
    expect(nomeCompleto(null)).toBeNull();
    expect(nomeCompleto('11987654321')).toBeNull();
    expect(nomeCompleto('(11) 98765-4321')).toBeNull();
    expect(nomeCompleto('J')).toBeNull();
  });

  it('o prefill do campo 1 usa o nome completo', () => {
    expect(fonte).toContain("va.indice === 1 ? (nomeCompleto(nomeContato) || '')");
    expect(fonte).not.toContain("va.indice === 1 ? (primeiroNome(nomeContato) || '')");
  });
});

// ── Pacote do POST: unitário e lote montam o MESMO ───────────────────────
describe('pacoteDeTemplate (unitário e lote usam a mesma conta)', () => {
  let pacoteDeTemplate: (
    tpl: { nome: string; idioma?: string },
    vars: Array<{ indice: number }>,
    valores: Record<number, string>
  ) => { template: string; idioma: string; components?: unknown; registro: string };
  let fonte = '';
  beforeAll(() => {
    fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = fonte.indexOf('const TEMPLATE_IDIOMA =');
    const fim = fonte.indexOf('// [teste:template-fim]');
    ({ pacoteDeTemplate } = new Function(
      `${fonte.slice(inicio, fim)}; return { pacoteDeTemplate };`
    )());
  });

  it('ordena as variáveis pelo índice e grava todas no registro', () => {
    const p = pacoteDeTemplate(
      { nome: 'calicolors_abordagem_v2', idioma: 'pt_BR' },
      [{ indice: 3 }, { indice: 1 }, { indice: 2 }],
      { 1: 'Neri Pintor Atelier', 2: ' Mairiporã ', 3: 'pintura residencial' }
    );
    expect(p.template).toBe('calicolors_abordagem_v2');
    expect(p.idioma).toBe('pt_BR');
    expect(p.components).toEqual([{ type: 'body', parameters: [
      { type: 'text', text: 'Neri Pintor Atelier' },
      { type: 'text', text: 'Mairiporã' },
      { type: 'text', text: 'pintura residencial' },
    ] }]);
    expect(p.registro).toBe('[template calicolors_abordagem_v2] {{1}}=Neri Pintor Atelier {{2}}=Mairiporã {{3}}=pintura residencial');
  });

  it('template sem variável vai sem components e com registro seco', () => {
    const p = pacoteDeTemplate({ nome: 'calicolors' }, [], {});
    expect(p.components).toBeUndefined();
    expect(p.idioma).toBe('pt_BR');
    expect(p.registro).toBe('[template calicolors]');
  });

  it('o envio unitário e o lote passam pelo pacoteDeTemplate', () => {
    expect(fonte).toContain('onEnviar(pacoteDeTemplate(tpl, vars, valores));');
    expect(fonte).toContain('pacote: pacoteDeTemplate(tpl, vars, x.valores)');
  });

  // O lote preenche as variáveis pelo cadastro do lead com as MESMAS
  // funções do modal unitário — nomeCompleto, cidadeDoLead, ramoDoLead.
  it('o lote resolve {{1}}/{{2}}/{{3}} pelas mesmas funções do unitário', () => {
    expect(fonte).toContain("const valores = { 1: nomeCompleto(l.name) || '', 2: cidadeDoLead(l) || '', 3: ramoDoLead(l) || '' };");
  });
});

describe('bloqueio de envio com variável vazia', () => {
  // Espelha `faltando` do <EnvioDeTemplate>.
  const faltando = (vars: number[], valores: Record<number, string>) =>
    vars.filter((i) => !String(valores[i] || '').trim());

  it('todas preenchidas → libera', () => {
    expect(faltando([1, 2], { 1: 'Bianca', 2: '1042' })).toEqual([]);
  });

  it('qualquer uma vazia → bloqueia, e diz qual', () => {
    expect(faltando([1, 2], { 1: 'Bianca', 2: '' })).toEqual([2]);
    expect(faltando([1, 2], { 1: '', 2: '1042' })).toEqual([1]);
    expect(faltando([1, 2], {})).toEqual([1, 2]);
  });

  it('só espaço não conta como preenchida', () => {
    expect(faltando([1], { 1: '   ' })).toEqual([1]);
  });

  it('template sem variável nunca bloqueia', () => {
    expect(faltando([], {})).toEqual([]);
  });
});

// ── Registro de template: gravar e ler tem que fechar ────────────────────
// Mensagem de template não viaja com corpo — quem guarda o texto é a Meta.
// O portal grava um REGISTRO no `body` (`[template x] {{1}}=Fulano`) pra o
// histórico saber o que foi enviado a quem. Se a leitura não entender o que
// a gravação escreve, a bolha mostra esse registro CRU na tela — que é
// exatamente o que ele existia pra evitar. Aconteceu em 2026-09-05: o
// `body` passou a ser preenchido e ganhou do espelho na renderização.

describe('registro de template: ida e volta', () => {
  // beforeAll próprio (ver o describe do aviso de marketing): um
  // `beforeAll` de outro describe não vale aqui.
  beforeAll(() => {
    const src = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = src.indexOf('const TEMPLATE_IDIOMA =');
    const fim = src.indexOf('// [teste:template-fim]');
    const fabrica = new Function(
      `${src.slice(inicio, fim)}; return { escolherTemplate, registroDeTemplate, parseRegistroTemplate };`
    ) as () => {
      escolherTemplate: typeof escolherNoPortal;
      registroDeTemplate: typeof registroDeTemplate;
      parseRegistroTemplate: typeof parseRegistroTemplate;
    };
    const mod = fabrica();
    escolherNoPortal = mod.escolherTemplate;
    registroDeTemplate = mod.registroDeTemplate;
    parseRegistroTemplate = mod.parseRegistroTemplate;
  });

  it('lê de volta o que grava, com nome', () => {
    const escolha = escolherNoPortal('Bianca Aparecida');
    const registro = registroDeTemplate(escolha);
    const lido = parseRegistroTemplate(registro);
    expect(lido).not.toBeNull();
    expect(lido?.template).toBe(escolha.template);
    expect(lido?.param).toBe('Bianca');
  });

  it('lê de volta o que grava, sem nome', () => {
    const escolha = escolherNoPortal(null);
    const lido = parseRegistroTemplate(registroDeTemplate(escolha));
    expect(lido?.template).toBe(escolha.template);
    expect(lido?.param).toBeNull();
  });

  it('mensagem de texto normal NÃO é confundida com registro', () => {
    // Senão uma mensagem que por acaso começa com colchete viraria template.
    expect(parseRegistroTemplate('Oi, tudo bem?')).toBeNull();
    expect(parseRegistroTemplate('[imagem]')).toBeNull();
    expect(parseRegistroTemplate('')).toBeNull();
    expect(parseRegistroTemplate('[template]')).toBeNull();
  });

  it('aceita nome com acento no parâmetro', () => {
    const lido = parseRegistroTemplate('[template calicolors_nome] {{1}}=Ângela');
    expect(lido?.param).toBe('Ângela');
  });
});

// ── Prévia do template: o que a tela mostra antes de enviar ──────────────
// Relato de 2026-09-07, três coisas de uma vez: a prévia estava feia, uns
// templates não mostravam o modelo, e outros mostravam `{{2}}` cru. A
// terceira é a que vira teste: chave dupla é notação da Meta, não conteúdo,
// e não tem por que aparecer pra quem opera. Um buraco tem que parecer
// buraco.

interface Segmento {
  tipo: 'texto' | 'valor' | 'vazio';
  indice?: number;
  valor: string;
}

let segmentosDoTemplate: (
  texto: string | null,
  valores: Record<number, string>,
  vars: Array<{ indice: number; exemplo: string | null }>
) => Segmento[] | null;
let rotuloDeTemplate: (t: { nome?: string; rotulo?: string }) => string;

describe('prévia do template (portal)', () => {
  beforeAll(() => {
    const src = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = src.indexOf('const segmentosDoTemplate =');
    const fim = src.indexOf('// [teste:previa-fim]');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const fabrica = new Function(
      `${src.slice(inicio, fim)}; return { segmentosDoTemplate, rotuloDeTemplate };`
    ) as () => {
      segmentosDoTemplate: typeof segmentosDoTemplate;
      rotuloDeTemplate: typeof rotuloDeTemplate;
    };
    ({ segmentosDoTemplate, rotuloDeTemplate } = fabrica());
  });

  const CORPO = 'Oi {{1}}, seu orçamento {{2}} está pronto.';
  const VARS = [
    { indice: 1, exemplo: 'Bianca' },
    { indice: 2, exemplo: '1042' },
  ];

  // O bug relatado: com {{2}} vazio, a prévia antiga imprimia o `{{2}}`
  // literal no meio da frase.
  it('variável vazia nunca vira `{{n}}` na tela', () => {
    const segs = segmentosDoTemplate(CORPO, { 1: 'Beatris' }, VARS)!;
    expect(segs.map((s) => s.valor).join('')).not.toContain('{{');
    expect(segs.map((s) => s.valor).join('')).not.toContain('}}');
  });

  it('o buraco aparece como buraco, com o exemplo do painel', () => {
    const segs = segmentosDoTemplate(CORPO, { 1: 'Beatris' }, VARS)!;
    const vazio = segs.find((s) => s.tipo === 'vazio')!;
    expect(vazio.indice).toBe(2);
    expect(vazio.valor).toBe('ex.: 1042');
  });

  it('sem exemplo cadastrado, o buraco ainda se identifica', () => {
    const segs = segmentosDoTemplate('Oi {{1}}', {}, [{ indice: 1, exemplo: null }])!;
    expect(segs.find((s) => s.tipo === 'vazio')!.valor).toBe('variável 1');
  });

  it('preenchido vira segmento destacável, não texto solto', () => {
    const segs = segmentosDoTemplate(CORPO, { 1: 'Beatris', 2: '1042' }, VARS)!;
    expect(segs.filter((s) => s.tipo === 'vazio')).toHaveLength(0);
    expect(segs.filter((s) => s.tipo === 'valor').map((s) => s.valor)).toEqual([
      'Beatris',
      '1042',
    ]);
    // O texto reconstruído é exatamente a mensagem que sai.
    expect(segs.map((s) => s.valor).join('')).toBe(
      'Oi Beatris, seu orçamento 1042 está pronto.'
    );
  });

  it('espaço em branco não conta como preenchido', () => {
    const segs = segmentosDoTemplate('Oi {{1}}', { 1: '   ' }, VARS)!;
    expect(segs.find((s) => s.tipo === 'vazio')).toBeTruthy();
  });

  it('tolera espaço dentro das chaves, como a Meta permite', () => {
    const segs = segmentosDoTemplate('Oi {{ 1 }}!', { 1: 'Ana' }, VARS)!;
    expect(segs.map((s) => s.valor).join('')).toBe('Oi Ana!');
  });

  it('template sem corpo devolve null (a tela então diz onde o texto vive)', () => {
    expect(segmentosDoTemplate(null, {}, [])).toBeNull();
  });

  // O nome cru da Meta continua à vista embaixo do botão — é ele que tem
  // que bater com o painel quando o envio falha com 132001. O rótulo é só
  // pra lista não virar uma coluna de `calicolors_orcamento_pronto`.
  it('nome cru vira rótulo legível no seletor', () => {
    // Sem cedilha de propósito: o nome na Meta é ASCII
    // (`calicolors_orcamento_pronto`) e o rótulo é derivado DELE. Restaurar
    // acento exigiria um dicionário escrito à mão — a mesma doença da lista
    // de templates que esta rota veio matar.
    expect(rotuloDeTemplate({ nome: 'calicolors_orcamento_pronto' })).toBe(
      'Orcamento pronto'
    );
    expect(rotuloDeTemplate({ nome: 'calicolors' })).toBe('Calicolors');
  });

  it('rótulo próprio da lista embutida ganha do derivado', () => {
    expect(
      rotuloDeTemplate({ nome: 'calicolors_nome', rotulo: 'Com o nome da pessoa' })
    ).toBe('Com o nome da pessoa');
  });
});

// ── Erro de carga da lista de WhatsApp ───────────────────────────────────
// Relato de 11/09/2026: "tem muitas msgs" com a coluna dizendo "Nenhuma
// conversa ainda". O `load` engolia a falha num `console.warn`, então
// consulta quebrada e caixa de entrada vazia produziam a MESMA frase — e a
// única leitura possível era "sumiram as mensagens".
//
// O que vira teste é a parte que decide se o operador consegue AGIR: o
// código do Postgres precisa sobreviver até a tela. Sem ele, 42703 (SQL
// pendente), 42501 (permissão) e falha de rede são indistinguíveis.

let textoDeErroSupabase: (e: unknown) => string;

describe('erro do Supabase legível na tela', () => {
  beforeAll(() => {
    const src = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
    const inicio = src.indexOf('const textoDeErroSupabase =');
    const fim = src.indexOf('// [teste:erro-supabase-fim]');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const fabrica = new Function(
      `${src.slice(inicio, fim)}; return { textoDeErroSupabase };`
    ) as () => { textoDeErroSupabase: typeof textoDeErroSupabase };
    ({ textoDeErroSupabase } = fabrica());
  });

  // 42703 = coluna que não existe. É o desfecho que manda rodar um SQL, e
  // já aconteceu três vezes neste projeto (quotes.post_id, leads.city,
  // profiles.username). Perder o código transforma isso em "tela quebrada".
  it('mantém o código do Postgres, que é o que diz o que fazer', () => {
    const t = textoDeErroSupabase({
      code: '42703',
      message: 'column whatsapp_messages.foo does not exist',
    });
    expect(t).toContain('42703');
    expect(t).toContain('does not exist');
  });

  it('anexa hint/details quando vêm — é onde o PostgREST explica', () => {
    expect(textoDeErroSupabase({ code: 'PGRST204', message: 'x', hint: 'confira a coluna' }))
      .toContain('confira a coluna');
    expect(textoDeErroSupabase({ message: 'x', details: 'linha 3' })).toContain('linha 3');
  });

  it('erro sem código ainda é legível', () => {
    expect(textoDeErroSupabase({ message: 'Failed to fetch' })).toBe('Failed to fetch');
  });

  it('nunca devolve vazio — string vazia na tela seria outro silêncio', () => {
    expect(textoDeErroSupabase(null)).toBeTruthy();
    expect(textoDeErroSupabase({})).toBeTruthy();
    expect(textoDeErroSupabase({ message: '   ' })).toBeTruthy();
  });

  // A coluna é estreita e no celular fica mais estreita ainda; um `details`
  // gigante empurraria o botão "Tentar de novo" pra fora da tela.
  it('trunca para caber na coluna', () => {
    const t = textoDeErroSupabase({ code: '42703', message: 'x'.repeat(900) });
    expect(t.length).toBeLessThanOrEqual(300);
  });
});

// ── A tela não pode dizer "não existe" quando a consulta falhou ──────────
// Guarda de texto, não de comportamento: o defeito relatado foi uma FRASE
// errada, e ela some se alguém reescrever o bloco sem saber por que ele é
// assim.

describe('coluna de conversas: vazio × falha', () => {
  let fonte = '';
  beforeAll(() => {
    fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  });

  it('a falha de carga tem texto próprio, separado do caixa-vazia', () => {
    expect(fonte).toContain('Não consegui carregar as conversas.');
  });

  it('o vazio sem erro não afirma que não existe mensagem', () => {
    expect(fonte).toContain('provavelmente é permissão');
  });

  // O +55 11 92072-5935 era o número da Evolution, aposentada em 09/2026. A
  // tela seguia mandando o operador esperar mensagem num canal que não
  // recebe mais nada.
  it('não cita o número da Evolution', () => {
    expect(fonte).not.toContain('92072-5935');
    expect(fonte).not.toContain('92072');
  });
});

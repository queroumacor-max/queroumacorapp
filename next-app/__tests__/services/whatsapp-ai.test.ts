// whatsapp-ai — travas do atendimento automático. O que mais importa aqui
// NÃO é a IA acertar o texto: é a REGRA DA LOJA (nunca preço, nunca
// orçamento) valer mesmo quando o modelo desobedece.
import { describe, expect, it, vi } from 'vitest';
import {
  buildSystemPrompt,
  descreverRegistroDeTemplate,
  PROMPT_BASE_PADRAO,
  clientAsksForPrice,
  clientHasComplaintOrLegalThreat,
  diaBrt,
  isBusinessHour,
  isOptOut,
  ehRecusaDeAbordagem,
  textoRecusaAgradecida,
  replyLeaksPrice,
  replyMakesUnverifiedPromise,
  shouldSendAway,
  textoAusencia,
} from '../../lib/api/_services/whatsapp-ai';

describe('clientAsksForPrice — pedido do CLIENTE escala antes de chamar a IA', () => {
  it('detecta pedido de preço em várias formas', () => {
    ['Quanto custa?', 'qual o valor do galão', 'Me passa a tabela de preço',
     'tem desconto?', 'da pra parcelar?', 'quanto fica 18L', 'qual a forma de pagamento',
     'faz por quanto à vista'].forEach((t) => {
      expect(clientAsksForPrice(t), t).toBe('preco');
    });
  });

  it('detecta pedido de orçamento', () => {
    ['Pode fazer um orçamento?', 'preciso de um orcamento pra fachada', 'me orça aí'].forEach(
      (t) => expect(clientAsksForPrice(t), t).toBe('orcamento'),
    );
  });

  it('não escala conversa normal', () => {
    ['Bom dia!', 'Vocês têm tinta branca?', 'Onde fica a loja?',
     'Trabalham com epóxi?', 'Que horas abre?'].forEach((t) => {
      expect(clientAsksForPrice(t), t).toBeNull();
    });
  });
});

describe('replyLeaksPrice — trava final na SAÍDA da IA', () => {
  it('barra resposta com R$ ou reais', () => {
    expect(replyLeaksPrice('O galão sai R$ 189,90')).toBe(true);
    expect(replyLeaksPrice('custa 250 reais')).toBe(true);
  });

  it('barra número em contexto de dinheiro sem R$', () => {
    expect(replyLeaksPrice('esse custa 120')).toBe(true);
    expect(replyLeaksPrice('sai por 89,90 no pix')).toBe(true);
    expect(replyLeaksPrice('a partir de 70')).toBe(true);
  });

  it('barra promessa de orçamento fechado', () => {
    expect(replyLeaksPrice('Segue o orçamento completo abaixo')).toBe(true);
    expect(replyLeaksPrice('o valor total ficou fechado')).toBe(true);
  });

  it('deixa passar resposta legítima com número que NÃO é dinheiro', () => {
    expect(replyLeaksPrice('Temos o galão de 3,6L e a lata de 18L')).toBe(false);
    expect(replyLeaksPrice('Abrimos das 8h às 18h')).toBe(false);
    expect(replyLeaksPrice('Trabalhamos com acrílico e látex, sim!')).toBe(false);
  });

  // Achado da auditoria de segurança de IA (2026-09-17): a regex original
  // exigia "R" e "$" colados — um jailbreak que convence o modelo a variar
  // só o espaçamento ("R $ 120") escapava da trava de saída inteira,
  // mesmo com a trava de entrada (`clientAsksForPrice`) não tendo disparado
  // (pergunta indireta). Prova que o bypass fechou.
  it('não escapa por espaçamento variado em torno do R$ (bypass corrigido)', () => {
    expect(replyLeaksPrice('Fica R $ 120 o galão')).toBe(true);
    expect(replyLeaksPrice('São R$120')).toBe(true);
    expect(replyLeaksPrice('o valor é R  $  95,50')).toBe(true);
  });

  it('pega frases de preço indireto que a v1 da regex não cobria', () => {
    expect(replyLeaksPrice('cobramos 300 pela pintura completa')).toBe(true);
    expect(replyLeaksPrice('gira em torno de 450 dependendo da área')).toBe(true);
    expect(replyLeaksPrice('sai a 90 o galão')).toBe(true);
  });
});

// Achado da auditoria de segurança de IA (2026-09-17): a regra 4 do prompt
// ("reclamação/cobrança/assunto delicado → precisa_humano=true") dependia
// só de o modelo obedecer. Esta trava vira código, na mesma forma da trava
// de preço.
describe('clientHasComplaintOrLegalThreat — regra 4 virou código, não só prompt', () => {
  it('detecta reclamação/ameaça legal/pedido de cancelamento ou reembolso', () => {
    [
      'Vou no PROCON reclamar disso',
      'Já falei com meu advogado sobre esse atraso',
      'quero cancelar meu pedido agora',
      'não recebi meu pedido ainda, cadê?',
      'quero reembolso disso',
      'isso é um absurdo, péssimo atendimento',
    ].forEach((t) => expect(clientHasComplaintOrLegalThreat(t), t).toBe(true));
  });

  it('não confunde pergunta normal sobre tinta com reclamação', () => {
    expect(clientHasComplaintOrLegalThreat('Vocês têm tinta acrílica?')).toBe(false);
    expect(clientHasComplaintOrLegalThreat('Qual o rendimento por litro?')).toBe(false);
    expect(clientHasComplaintOrLegalThreat('Bom dia, td bem?')).toBe(false);
  });
});

// Achado da auditoria de segurança de IA (2026-09-17): a regra 3 do prompt
// ("não invente produto, prazo de entrega, estoque nem promessa de prazo")
// também dependia só do modelo. Mesma filosofia de `replyLeaksPrice`.
describe('replyMakesUnverifiedPromise — regra 3 virou código, não só prompt', () => {
  it('barra promessa de prazo concreto', () => {
    expect(replyMakesUnverifiedPromise('Chega amanhã sem falta!')).toBe(true);
    expect(replyMakesUnverifiedPromise('Entregamos em 2 dias')).toBe(true);
    expect(replyMakesUnverifiedPromise('Fica pronto até sexta')).toBe(true);
  });

  it('barra afirmação categórica de estoque', () => {
    expect(replyMakesUnverifiedPromise('Temos sim esse produto')).toBe(true);
    expect(replyMakesUnverifiedPromise('Está disponível na loja')).toBe(true);
    expect(replyMakesUnverifiedPromise('Garantido para você')).toBe(true);
  });

  it('deixa passar resposta genérica sem promessa concreta', () => {
    expect(replyMakesUnverifiedPromise('Trabalhamos com tintas acrílicas e esmalte')).toBe(false);
    expect(replyMakesUnverifiedPromise('Nosso horário é das 8h às 18h')).toBe(false);
    expect(replyMakesUnverifiedPromise('Posso verificar isso com a equipe pra confirmar')).toBe(
      false,
    );
  });
});

describe('isBusinessHour — horário de Brasília', () => {
  const utc = (iso: string) => new Date(iso);
  it('dentro do horário em dia útil', () => {
    // 2026-08-27 é quinta. 13:00 UTC = 10:00 Brasília.
    expect(isBusinessHour(utc('2026-08-27T13:00:00Z'))).toBe(true);
    expect(isBusinessHour(utc('2026-08-27T11:00:00Z'))).toBe(true); // 08:00 BRT
  });
  it('fora do horário', () => {
    expect(isBusinessHour(utc('2026-08-27T05:00:00Z'))).toBe(false); // 02:00 BRT
    expect(isBusinessHour(utc('2026-08-27T23:00:00Z'))).toBe(false); // 20:00 BRT
  });
  it('domingo nunca responde', () => {
    // 2026-08-30 é domingo. 15:00 UTC = 12:00 BRT.
    expect(isBusinessHour(utc('2026-08-30T15:00:00Z'))).toBe(false);
  });
});

describe('diaBrt — o "dia" do teto de respostas é o de Brasília', () => {
  it('23h de Brasília ainda é o MESMO dia (com UTC cru já teria virado)', () => {
    // 2026-08-29T02:54Z = 28/08 23:54 em Brasília.
    expect(diaBrt(new Date('2026-08-29T02:54:00Z'))).toBe('2026-08-28');
  });
  it('vira à meia-noite daqui, não às 21h', () => {
    expect(diaBrt(new Date('2026-08-29T02:59:00Z'))).toBe('2026-08-28'); // 23:59 BRT
    expect(diaBrt(new Date('2026-08-29T03:01:00Z'))).toBe('2026-08-29'); // 00:01 BRT
  });
});

describe('isOptOut', () => {
  it('respeita PARE e variações', () => {
    ['PARE', 'pare', 'parar', 'Sair', 'não quero', 'stop'].forEach((t) =>
      expect(isOptOut(t), t).toBe(true),
    );
  });
  it('não confunde com conversa normal', () => {
    expect(isOptOut('parece bom')).toBe(false);
    expect(isOptOut('quero sim')).toBe(false);
  });
});

describe('mensagem de ausência — quando a IA não vai responder', () => {
  const NOW = new Date('2026-08-29T17:00:00Z');
  const hAtras = (h: number) => new Date(NOW.getTime() - h * 3600000).toISOString();

  it('se apresenta, agradece e promete retorno — sem falar preço', () => {
    const t = textoAusencia({ motivo: 'horario', janela: { start: 8, end: 19 } });
    expect(t).toContain('Cali Colors');
    expect(t).toContain('Obrigado pelo seu contato');
    expect(t).toContain('em breve');
    expect(t).toContain('das 8h às 19h');
    expect(replyLeaksPrice(t)).toBe(false);
  });

  it('com a chave desligada não inventa horário de atendimento', () => {
    const t = textoAusencia({ motivo: 'desligada' });
    expect(t).not.toMatch(/\dh às \dh/);
    expect(t).toContain('em breve');
    expect(replyLeaksPrice(t)).toBe(false);
  });

  it('texto customizado do portal manda mais que o padrão', () => {
    expect(textoAusencia({ motivo: 'horario', custom: 'Voltamos amanhã!' })).toBe('Voltamos amanhã!');
  });

  it('manda quando a conversa está fria', () => {
    expect(shouldSendAway({ now: NOW })).toBe(true);
    expect(shouldSendAway({ awayAt: hAtras(20), now: NOW })).toBe(true);
  });

  it('NÃO repete dentro de 12h', () => {
    expect(shouldSendAway({ awayAt: hAtras(3), now: NOW })).toBe(false);
  });

  it('NÃO atropela pessoa que respondeu agora há pouco', () => {
    expect(shouldSendAway({ lastHumanOutAt: hAtras(1), now: NOW })).toBe(false);
    expect(shouldSendAway({ lastHumanOutAt: hAtras(5), now: NOW })).toBe(true);
  });

  it('NUNCA vai pra quem pediu PARE', () => {
    expect(shouldSendAway({ optedOut: true, now: NOW })).toBe(false);
  });
});

describe('descreverRegistroDeTemplate', () => {
  it('registro de template vira a mensagem de apresentação', () => {
    const t = descreverRegistroDeTemplate('[template calicolors_abordagem_v2] {{1}}=OHMTECH {{2}}=Guarulhos {{3}}=engenharia civil');
    expect(t).toContain('Mensagem de apresentação enviada pela loja');
    expect(t).toContain('Calicolors Tintas');
    expect(t).not.toContain('{{1}}');
    expect(descreverRegistroDeTemplate('[template calicolors]')).toContain('apresentação');
  });

  it('mensagem normal passa intacta', () => {
    expect(descreverRegistroDeTemplate('Bom dia, com quem eu falo?')).toBe('Bom dia, com quem eu falo?');
    expect(descreverRegistroDeTemplate(null)).toBe('');
  });
});

describe('buildSystemPrompt', () => {
  it('inclui as regras duras e o contexto do lead', () => {
    const p = buildSystemPrompt({
      lead: { name: 'DNA Bodyshop', category: 'Funilaria/Auto', city: 'Guarulhos' },
      produtos: ['Primer PU 3,6L', 'Verniz HS 5L'],
    });
    expect(p).toContain('NUNCA informe preço');
    expect(p).toContain('NUNCA faça orçamento');
    expect(p).toContain('DNA Bodyshop');
    expect(p).toContain('Funilaria/Auto');
    expect(p).toContain('Primer PU 3,6L');
    expect(p).toContain('precisa_humano');
  });

  it('funciona sem lead e sem produtos', () => {
    const p = buildSystemPrompt({});
    expect(p).toContain('Cali Colors');
    expect(p).not.toContain('undefined');
  });

  // Decisão do usuário (2026-09-08): a IA não fala do app por conta própria.
  it('não apresenta o QueroUmaCor por iniciativa própria', () => {
    const p = buildSystemPrompt({});
    expect(p).not.toContain('também mantém o QueroUmaCor');
    expect(p).toContain('NÃO mencione o app QueroUmaCor');
    expect(p).toContain('Só fale dele se a PESSOA perguntar');
  });

  it('sabe explicar por que a loja chamou quem foi abordado', () => {
    const p = buildSystemPrompt({});
    expect(p).toContain('por que chamamos');
    expect(p).toContain('conhecer profissionais da região');
  });

  it('PRIMEIRO CONTATO manda recepcionar antes de responder', () => {
    const p = buildSystemPrompt({ primeiroContato: true });
    expect(p).toContain('PRIMEIRA MENSAGEM DA CONVERSA');
    expect(p).toContain('cumprimente');
    expect(p).toContain('loja de tintas em Guarulhos');
    expect(p).toContain('agradeça o contato');
    expect(p).toContain('nunca robótico');
  });

  it('com pendência aberta, manda NÃO repetir a promessa e seguir ajudando', () => {
    const p = buildSystemPrompt({ pendenciaAberta: true });
    expect(p).toContain('NÃO repita essa promessa');
    expect(p).toContain('Siga atendendo normalmente');
    expect(p).toContain('sem prometer prazo');
  });

  it('sem pendência, não fala em promessa nenhuma', () => {
    const p = buildSystemPrompt({});
    expect(p).not.toContain('NÃO repita essa promessa');
  });

  // Prompt editável no portal (2026-09-08): o texto da loja substitui a
  // base (identidade + regras), e o resto continua fixo.
  it('promptBase do portal substitui a base e mantém o rabo fixo', () => {
    const p = buildSystemPrompt({
      promptBase: 'Você é a Dona Cali, atendente da Cali Colors. Seja breve.',
      lead: { name: 'DNA Bodyshop' },
      primeiroContato: true,
    });
    expect(p).toContain('Você é a Dona Cali');
    expect(p).not.toContain('REGRAS ABSOLUTAS');
    expect(p).toContain('DNA Bodyshop');
    expect(p).toContain('PRIMEIRA MENSAGEM DA CONVERSA');
    expect(p).toContain('Responda SEMPRE em JSON puro');
    expect(p).toContain('precisa_humano');
  });

  it('promptBase vazio ou só espaço cai no padrão', () => {
    expect(buildSystemPrompt({ promptBase: '   ' })).toContain('REGRAS ABSOLUTAS');
    expect(buildSystemPrompt({ promptBase: null })).toContain('REGRAS ABSOLUTAS');
    expect(PROMPT_BASE_PADRAO).toContain('NUNCA informe preço');
    expect(PROMPT_BASE_PADRAO).not.toContain('Responda SEMPRE em JSON');
  });

  it('conversa já em andamento NÃO repete a apresentação', () => {
    const p = buildSystemPrompt({ primeiroContato: false });
    expect(p).not.toContain('PRIMEIRA MENSAGEM DA CONVERSA');
    expect(p).toContain('No máximo 3 frases curtas');
  });
});

// ── "Não tenho interesse" (quick reply do template) ─────────────────────
describe('ehRecusaDeAbordagem', () => {
  it('reconhece o rótulo do botão', () => {
    expect(ehRecusaDeAbordagem('Não tenho interesse')).toBe(true);
  });

  // O rótulo é editado no painel da Meta: pode voltar sem acento, em outra
  // caixa ou com ponto, e ninguém aqui ficaria sabendo.
  it('não depende de acento, caixa ou pontuação', () => {
    for (const t of [
      'nao tenho interesse',
      'NÃO TENHO INTERESSE',
      '  Não tenho interesse.  ',
      'Sem interesse',
      'não me interessa',
    ]) {
      expect(ehRecusaDeAbordagem(t), t).toBe(true);
    }
  });

  it('não confunde com quem está conversando', () => {
    for (const t of [
      'tenho interesse',
      'tenho interesse sim',
      'me interessa muito',
      'qual o preço?',
      '',
      'não tenho interesse em tinta acrílica, quero esmalte',
    ]) {
      expect(ehRecusaDeAbordagem(t), t).toBe(false);
    }
  });

  it('é separado do PARE — os dois calam, mas o desfecho difere', () => {
    expect(isOptOut('Não tenho interesse')).toBe(false);
    expect(ehRecusaDeAbordagem('PARE')).toBe(false);
  });
});

describe('textoRecusaAgradecida', () => {
  const texto = textoRecusaAgradecida();

  it('é curto — quem disse não não vai ler parágrafo', () => {
    expect(texto.length).toBeLessThan(200);
  });

  it('não fala preço (a regra da loja vale aqui também)', () => {
    expect(replyLeaksPrice(texto)).toBe(false);
  });

  it('não anuncia o PARE (decisão da loja, 29/08)', () => {
    expect(texto).not.toMatch(/\bPARE\b/);
  });
});

// Prova que as travas 1b/2b estão de fato LIGADAS em `generateAiReply` — uma
// função pura passando no teste não prova que ela é chamada de verdade no
// fluxo (foi exatamente essa lacuna que a auditoria de segurança de IA de
// 2026-09-17 apontou pra regra de preço original, antes de ter trava 1/2).
describe('generateAiReply — travas 1b/2b realmente conectadas no fluxo', () => {
  it('reclamação do cliente nem chama a OpenAI (trava 1b, igual à de preço)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const { generateAiReply } = await import('../../lib/api/_services/whatsapp-ai');
      const out = await generateAiReply({
        turns: [{ direction: 'in', body: 'Quero cancelar meu pedido, isso é um absurdo' }],
      });
      expect(out.escalate).toBe(true);
      expect(out.reason).toBe('humano');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('promessa de prazo/estoque da IA é descartada antes de virar `reply` (trava 2b)', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    resposta: 'Pode ficar tranquilo, chega amanhã sem falta!',
                    precisa_humano: false,
                    motivo: null,
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    try {
      const { generateAiReply } = await import('../../lib/api/_services/whatsapp-ai');
      const out = await generateAiReply({
        turns: [
          { direction: 'out', body: 'Oi, tudo bem?' },
          { direction: 'in', body: 'Vocês têm tinta acrílica branca?' },
        ],
      });
      expect(out.reply).not.toContain('chega amanhã');
      expect(out.escalate).toBe(true);
      expect(out.reason).toBe('humano');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

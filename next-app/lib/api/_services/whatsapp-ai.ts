// lib/api/_services/whatsapp-ai.ts — atendimento automático do WhatsApp do
// portal (Evolution) com ChatGPT.
//
// REGRA DE NEGÓCIO INEGOCIÁVEL (decisão do dono, 2026-08-29):
// a IA NUNCA fala preço, valor, desconto, condição de pagamento nem faz
// orçamento. Isso é trabalho de pessoa. Quando o cliente pede, a IA diz
// que vai verificar e responder em breve, DESLIGA a si mesma naquela
// conversa e cria um alerta no portal.
//
// A regra é aplicada em DOIS lugares, de propósito:
//   1. no prompt (a IA é instruída a não falar);
//   2. numa TRAVA DE CÓDIGO que varre a resposta antes de enviar.
// Prompt pode falhar — modelo alucina, cliente insiste, alguém edita o
// texto. A trava não depende de o modelo obedecer.
//
// Modelo configurável por env (`WHATSAPP_AI_MODEL`, default gpt-4o-mini,
// o mesmo que o resto do app usa) pra trocar sem deploy.

import { getRuntimeEnv } from '../env';
import { ServiceError } from '../security';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const AI_TIMEOUT_MS = 20000;
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';

/** Horário comercial de Brasília — a IA não responde fora dele. */
export const BUSINESS_START_HOUR = 8;
export const BUSINESS_END_HOUR = 19; // responde até 18:59

/** Teto de respostas automáticas por conversa por dia (anti-loop). */
export const MAX_AUTO_REPLIES_PER_DAY = 30;

/**
 * O "dia" do contador é o dia de BRASÍLIA, não o UTC.
 *
 * Com `toISOString()` cru o contador virava às 21h daqui — conversa da
 * noite era cortada no meio e o dia seguinte começava antes da hora.
 * Regra do projeto: todo horário do QueroUmaCor é America/Sao_Paulo.
 */
export function diaBrt(now: Date = new Date()): string {
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface LeadContext {
  name?: string | null;
  category?: string | null;
  segment?: string | null;
  city?: string | null;
  neighborhood?: string | null;
}

export interface ConversationTurn {
  direction: 'in' | 'out';
  body: string;
}

export interface AiReplyResult {
  /** Texto pronto pra enviar. Vazio quando não há o que responder. */
  reply: string;
  /** true = precisa de humano; NÃO enviar `reply` como resposta final. */
  escalate: boolean;
  /** 'preco' | 'orcamento' | 'humano' — usado no alerta do portal. */
  reason: 'preco' | 'orcamento' | 'humano' | null;
}

// ─── Travas de segurança (puras, testáveis) ─────────────────────────────────

/**
 * O CLIENTE está pedindo preço/orçamento? Roda na mensagem recebida —
 * se der positivo, nem chamamos a IA: escala direto.
 */
export function clientAsksForPrice(text: string): 'preco' | 'orcamento' | null {
  const t = (text || '').toLowerCase();
  if (/or[çc]ament|fazer um or[çc]|me or[çc]a/.test(t)) return 'orcamento';
  if (
    /(pre[çc]o|valor|quanto custa|quanto (?:fica|sai|é|e)\b|tabela de pre|cota[çc]|desconto|parcel|forma de pagamento|à vista|a vista)/.test(
      t,
    )
  ) {
    return 'preco';
  }
  return null;
}

/**
 * A RESPOSTA DA IA vazou preço? Última linha de defesa antes de enviar.
 * Pega "R$", números com vírgula decimal em contexto de dinheiro, e as
 * palavras que a IA não deveria usar afirmando valor.
 *
 * REGRA: esta trava é SINTÁTICA (regex), não semântica — ela não entende o
 * texto, só reconhece padrões. Achado da auditoria de segurança de IA
 * (2026-09-17): "R $ 120" (espaço entre R e $) e variações de espaçamento
 * escapavam do `/r\$/` original porque o regex exigia os dois caracteres
 * colados. Normalizar espaço solto entre pontuação ANTES de testar fecha
 * essa classe específica de bypass sem mudar o que a regra tenta pegar.
 * Isto NÃO torna a trava semanticamente à prova de tudo (por extenso,
 * unicode look-alike, ofuscação deliberada ainda podem escapar) — por isso
 * ela é só a ÚLTIMA camada, em cima da trava 1 (`clientAsksForPrice`, que
 * nem deixa a pergunta chegar no modelo) e nunca a única defesa.
 */
export function replyLeaksPrice(text: string): boolean {
  // Colapsa espaço/pontuação solta entre símbolo de moeda e dígito:
  // "R $ 120", "R$ 120", "r$120" viram todos comparáveis ao mesmo padrão.
  const t = (text || '')
    .toLowerCase()
    .replace(/r\s*\$\s*/g, 'r$')
    .replace(/\$\s+(?=\d)/g, '$');
  if (/r\$|\breais\b/.test(t)) return true;
  // "custa 120", "sai por 89,90", "fica 250", "cobramos 90", "gira em torno de 300"
  if (
    /\b(custa|sai por|sai a|fica em|fica por|por apenas|a partir de|cobra(?:mos)?|em torno de|por volta de|gira em torno de)\s*\d/.test(
      t,
    )
  ) {
    return true;
  }
  // Promessa de orçamento fechado pela IA.
  if (/(segue o or[çc]amento|or[çc]amento fica|valor total|te passo o valor de)\b/.test(t)) {
    return true;
  }
  return false;
}

/**
 * O CLIENTE está reclamando, ameaçando ação legal ou pedindo cancelamento/
 * reembolso? Roda na mensagem recebida — igual `clientAsksForPrice`, nem
 * chama a IA: escala direto. Achado da auditoria de segurança de IA
 * (2026-09-17): a regra 4 do prompt ("reclamação/cobrança/assunto delicado
 * → precisa_humano=true") dependia só de o modelo obedecer, sem trava de
 * código — diferente da regra de preço, que tem duas. Isto fecha essa
 * lacuna com a MESMA filosofia: código decide, prompt é só o plano B.
 */
export function clientHasComplaintOrLegalThreat(text: string): boolean {
  const t = (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return /procon|advogad|vou processar|reclama[cç]|reembolso|estorno|cancelar (o |meu )?pedido|n[aã]o recebi (o |meu )?pedido|pedido atrasado|p[eé]ssimo atendimento|isso [eé] um absurdo|absurdo isso|vou denunciar/.test(
    t,
  );
}

/**
 * A RESPOSTA DA IA afirmou prazo de entrega ou estoque com certeza que ela
 * não tem como saber? Última linha de defesa pra regra 3 do prompt ("não
 * invente produto, prazo de entrega, estoque nem promessa de prazo") — a
 * mesma lógica de `replyLeaksPrice`: o prompt pede pra não inventar, mas
 * quem garante é o código, não a boa vontade do modelo.
 */
export function replyMakesUnverifiedPromise(text: string): boolean {
  const t = (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  // Prazo concreto: "chega amanhã", "entrega em 3 dias", "até sexta".
  if (
    /\b(chega|chegam?|entrega(?:mos)?|fica(?:rá)? pronto|estar[aá] pronto)\b[^.?!]{0,25}\b(amanh[aã]|hoje|em \d+\s*(dias?|horas?|semanas?)|at[eé] (segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo))\b/.test(
      t,
    )
  ) {
    return true;
  }
  // Afirmação categórica de estoque/disponibilidade.
  if (/\b(temos (sim )?(esse|essa|em estoque|dispon[ií]vel)|est[aá] dispon[ií]vel|tem estoque|garantido (para|pra))\b/.test(t)) {
    return true;
  }
  return false;
}

/**
 * Está dentro do horário comercial de Brasília?
 *
 * A janela é CONFIGURÁVEL (app_settings 'whatsapp_ai_hours', formato
 * "8-19"; "0-24" = sempre; "off" também libera geral) porque o horário
 * de atendimento é decisão do dono e muda sem precisar de deploy. Os
 * parâmetros vêm do runner, que lê o banco.
 */
export function isBusinessHour(
  now: Date = new Date(),
  janela?: { start: number; end: number; domingo?: boolean },
): boolean {
  const start = janela?.start ?? BUSINESS_START_HOUR;
  const end = janela?.end ?? BUSINESS_END_HOUR;
  // 24h corridas: não precisa nem olhar o relógio.
  if (start <= 0 && end >= 24) return true;
  // America/Sao_Paulo (UTC-3, sem horário de verão desde 2019).
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const h = brt.getUTCHours();
  const dow = brt.getUTCDay();
  if (dow === 0 && !janela?.domingo) return false; // domingo
  return h >= start && h < end;
}

/** Lê "8-19" / "0-24" / "off" → janela. Formato inválido cai no padrão. */
export function parseHoursSetting(raw: string | null | undefined): {
  start: number;
  end: number;
  domingo: boolean;
} {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'off' || v === '24h' || v === 'sempre') return { start: 0, end: 24, domingo: true };
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})(\s*\+dom)?$/.exec(v);
  if (!m) return { start: BUSINESS_START_HOUR, end: BUSINESS_END_HOUR, domingo: false };
  const start = Math.max(0, Math.min(24, Number(m[1])));
  const end = Math.max(0, Math.min(24, Number(m[2])));
  if (end <= start) return { start: BUSINESS_START_HOUR, end: BUSINESS_END_HOUR, domingo: false };
  return { start, end, domingo: Boolean(m[3]) };
}

// ─── Mensagem de ausência ───────────────────────────────────────────────────
// Quando a IA NÃO vai responder — fora do horário ou chave desligada — o
// cliente não pode ficar no vácuo achando que ninguém viu. Vai UMA cortesia
// da loja, sem prometer nada além de retorno. Não é a IA falando: é texto
// fixo, então nem passa perto de preço.

/** Uma cortesia dessas a cada 12h por conversa, no máximo. */
export const AWAY_COOLDOWN_HOURS = 12;
/** Se uma PESSOA respondeu há menos que isso, ela está no volante — o
 *  robô fica quieto pra não atropelar a conversa ao vivo. */
export const AWAY_HUMAN_GRACE_HOURS = 2;

export function textoAusencia(opts: {
  motivo: 'horario' | 'desligada';
  janela?: { start: number; end: number; domingo?: boolean };
  custom?: string | null;
}): string {
  const custom = (opts.custom || '').trim();
  if (custom) return custom;
  if (opts.motivo === 'horario') {
    const s = opts.janela?.start ?? BUSINESS_START_HOUR;
    const e = opts.janela?.end ?? BUSINESS_END_HOUR;
    const dias = opts.janela?.domingo ? 'todos os dias' : 'de segunda a sábado';
    return (
      `Oi! Aqui é da Cali Colors 🎨 Obrigado pelo seu contato! ` +
      `Nosso atendimento é ${dias}, das ${s}h às ${e}h. ` +
      `Sua mensagem já ficou registrada e a nossa equipe te responde em breve. 😊`
    );
  }
  return (
    `Oi! Aqui é da Cali Colors 🎨 Obrigado pelo seu contato! ` +
    `Recebemos a sua mensagem e a nossa equipe vai te responder em breve. 😊`
  );
}

/**
 * Vale mandar a cortesia agora? Puro de propósito — é a regra que evita
 * transformar boa educação em enxurrada.
 */
export function shouldSendAway(opts: {
  optedOut?: boolean;
  awayAt?: string | null;
  lastHumanOutAt?: string | null;
  now?: Date;
}): boolean {
  if (opts.optedOut) return false; // pediu PARE: nem cortesia
  const now = (opts.now || new Date()).getTime();
  const horas = (iso: string) => (now - new Date(iso).getTime()) / 3600000;
  if (opts.awayAt && horas(opts.awayAt) < AWAY_COOLDOWN_HOURS) return false;
  if (opts.lastHumanOutAt && horas(opts.lastHumanOutAt) < AWAY_HUMAN_GRACE_HOURS) return false;
  return true;
}

/** Cliente pediu pra parar de receber mensagens. */
export function isOptOut(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  return /^(pare|parar|sair|remover|descadastrar|nao quero|não quero|stop)\b/.test(t);
}

/**
 * A pessoa tocou no botão "Não tenho interesse" do template de abordagem.
 *
 * É opt-out igual ao PARE — mas com desfecho diferente: quem tocou nesse
 * botão respondeu a uma mensagem NOSSA, e sumir sem dizer nada é grosseria.
 * Vai um agradecimento curto, e só.
 *
 * Compara sem acento e sem caixa porque o rótulo do botão é editado no
 * painel da Meta: "Não tenho interesse" pode virar "Nao tenho interesse"
 * numa revisão e ninguém aqui ficaria sabendo.
 */
export function ehRecusaDeAbordagem(text: string): boolean {
  const t = (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, '');
  return (
    t === 'nao tenho interesse' ||
    t === 'sem interesse' ||
    t === 'nao me interessa' ||
    t === 'nao tenho interesse no momento'
  );
}

/**
 * Resposta ao "Não tenho interesse". Curta de propósito: quem acabou de
 * dizer que não quer não vai ler um parágrafo, e insistir aqui é o que
 * transforma um "não" educado numa denúncia de spam.
 *
 * Não menciona "PARE" nem promete retorno — a decisão da loja (29/08) é
 * não anunciar opt-out em texto automático, e a pessoa já saiu da lista.
 */
export function textoRecusaAgradecida(): string {
  return 'Obrigado pelo retorno! Não vamos mais incomodar. ' +
    'Se um dia precisar de tinta ou de uma cor específica, é só chamar aqui. 🎨';
}

// ─── Registro de template no histórico ──────────────────────────────────────
// Template não viaja com corpo: o banco guarda `[template <nome>] {{1}}=…`
// (ver persistWhatsAppMessage). Lido cru pela IA isso não diz NADA — ela
// não sabia que a loja tinha iniciado a conversa e respondia "não tenho
// essa informação" quando a pessoa dizia "vocês que me chamaram". Aqui o
// registro vira o que a pessoa de fato recebeu, em resumo: os três templates
// de abordagem (calicolors, calicolors_nome, calicolors_abordagem_v2) têm o
// mesmo assunto.
const TEXTO_DA_APRESENTACAO =
  '(Mensagem de apresentação enviada pela loja: nos apresentamos como ' +
  'Calicolors Tintas, de Guarulhos, dissemos que estamos conversando com ' +
  'profissionais da região e perguntamos o que mais faz diferença no dia a ' +
  'dia — preço, entrega rápida, ajuda técnica ou condição de pagamento.)';

export function descreverRegistroDeTemplate(body: string | null | undefined): string {
  const b = String(body || '').trim();
  if (!/^\[template [a-z0-9_]+\]/i.test(b)) return b;
  return TEXTO_DA_APRESENTACAO;
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

// ─── Base do prompt (editável no portal) ────────────────────────────────────
// Identidade + regras de conversa. É o que o portal deixa a loja editar
// (2026-09-08, pedido do usuário: "onde fica o prompt da IA para que possa
// ser alterado manualmente e salvo"): fica em `whatsapp_ai_config.prompt`
// (NULL = este padrão). O que NÃO é editável, de propósito: o contexto do
// lead, os blocos de primeiro contato/pendência, o estilo e o formato JSON
// da resposta — sem o JSON o parser quebra —, e as TRAVAS de preço, que são
// código (`clientAsksForPrice`/`replyLeaksPrice`) e valem mesmo que alguém
// apague a regra 1 do texto.
export const PROMPT_BASE_PADRAO = [
    'Você é o atendente virtual da Cali Colors, loja de tintas em Guarulhos/SP,',
    'atendendo pelo WhatsApp.',
    '',
    'REGRAS ABSOLUTAS:',
    '1. NUNCA informe preço, valor, desconto, condição de pagamento ou frete.',
    '   NUNCA faça orçamento. Isso é feito por uma pessoa da equipe.',
    '2. Se pedirem preço ou orçamento, responda que vai verificar com a equipe',
    '   e retorna em breve — e marque precisa_humano=true.',
    '3. Não invente produto, prazo de entrega, estoque nem promessa de prazo.',
    '4. Se for reclamação, cobrança, assunto delicado ou algo fora de tinta e',
    '   pintura, marque precisa_humano=true.',
    '5. Você é um assistente; se perguntarem, diga que é o atendimento virtual',
    '   da Cali Colors e que uma pessoa pode continuar o atendimento.',
    // Decisão do usuário (2026-09-08): a IA falava do app por conta própria
    // ("Posso te ajudar com algo relacionado a tintas ou o app QueroUmaCor?")
    // — o assunto aqui é tinta e a loja; o app só entra se a pessoa puxar.
    '6. NÃO mencione o app QueroUmaCor nem outros produtos da empresa por',
    '   iniciativa própria. Só fale dele se a PESSOA perguntar.',
    // A abordagem de lead sai como template e entra no histórico como a
    // mensagem de apresentação (ver descreverRegistroDeTemplate). Sem esta
    // regra a IA respondia "não tenho essa informação" pra "vocês que me
    // chamaram" — de quem foi procurado pela loja.
    '7. Se a loja começou a conversa com a mensagem de apresentação e a',
    '   pessoa perguntar quem somos ou por que chamamos: explique que a',
    '   Cali Colors entrou em contato pra conhecer profissionais da região',
    '   e entender o que faz diferença pra eles na hora de comprar tinta',
    '   (preço, entrega, ajuda técnica, condição de pagamento).',
].join('\n');

export function buildSystemPrompt(opts: {
  lead?: LeadContext | null;
  produtos?: string[];
  /** Ninguém da loja falou ainda nesta conversa → hora de se apresentar. */
  primeiroContato?: boolean;
  /** Já existe promessa de retorno em aberto (preço/orçamento na fila). */
  pendenciaAberta?: boolean;
  /** Texto editado no portal (whatsapp_ai_config.prompt); vazio = padrão. */
  promptBase?: string | null;
}): string {
  const l = opts.lead;
  const quem = l?.name ? `O contato se chama ${l.name}.` : '';
  const ramo = l?.category ? `Ramo dele: ${l.category}.` : '';
  const onde = l?.neighborhood || l?.city ? `Fica em ${l.neighborhood || l.city}.` : '';
  const cat =
    opts.produtos && opts.produtos.length
      ? `Produtos que temos pra esse perfil (cite pelo nome, NUNCA com preço): ${opts.produtos.join('; ')}.`
      : '';
  const base = String(opts.promptBase || '').trim() || PROMPT_BASE_PADRAO;

  return [
    base,
    '',
    quem || ramo || onde || cat ? 'SOBRE QUEM ESTÁ FALANDO COM VOCÊ:' : '',
    quem,
    ramo,
    onde,
    cat,
    '',
    // Primeira mensagem: recepção calorosa. Sem isso a IA respondia um
    // "oi" seco de robô — quem chega no WhatsApp da loja tem que sentir
    // que foi bem recebido, e saber COM QUEM está falando.
    opts.primeiroContato
      ? [
          'ESTA É A PRIMEIRA MENSAGEM DA CONVERSA. Antes de responder o que',
          'a pessoa perguntou, RECEPCIONE bem:',
          '  • cumprimente (use o nome dela se você souber);',
          '  • diga que aqui é a Cali Colors, loja de tintas em Guarulhos;',
          '  • agradeça o contato;',
          '  • e então responda / pergunte no que pode ajudar.',
          'Tom acolhedor e humano, de quem gosta de atender — nunca robótico.',
          'Nesta primeira mensagem pode usar até 4 frases.',
        ].join('\n')
      : '',
    // Promessa em aberto: a pessoa da loja ainda vai responder o valor.
    // A IA precisa saber pra (a) não repetir "vou verificar" a cada
    // mensagem, virando robô quebrado, e (b) seguir ajudando no resto.
    opts.pendenciaAberta
      ? [
          'ATENÇÃO: já foi prometido a esta pessoa que a equipe retorna sobre',
          'valores/orçamento. NÃO repita essa promessa a cada mensagem.',
          'Siga atendendo normalmente no que NÃO é preço (tipo de tinta,',
          'cor, rendimento, aplicação, horário, endereço). Se ela cobrar o',
          'retorno, reconheça em UMA frase que a equipe já foi avisada e',
          'está chegando — sem prometer prazo.',
        ].join('\n')
      : '',
    '',
    'ESTILO: português do Brasil, informal e direto, como se fosse WhatsApp.',
    opts.primeiroContato
      ? 'Depois da apresentação, mantenha as respostas curtas.'
      : 'No máximo 3 frases curtas. Sem emoji em excesso (no máximo 1).',
    '',
    'Responda SEMPRE em JSON puro, sem markdown, no formato:',
    '{"resposta":"texto pro cliente","precisa_humano":true|false,"motivo":"preco|orcamento|humano|null"}',
  ]
    .filter(Boolean)
    .join('\n');
}

// ─── Chamada ao modelo ──────────────────────────────────────────────────────

interface OpenAiChoice {
  message?: { content?: string };
}
interface OpenAiResponse {
  choices?: OpenAiChoice[];
  error?: { message?: string };
}

export function getAiModel(): string {
  return getRuntimeEnv('WHATSAPP_AI_MODEL') || DEFAULT_AI_MODEL;
}

export function isAiConfigured(): boolean {
  return Boolean(getRuntimeEnv('OPENAI_API_KEY'));
}

/**
 * Gera a resposta pro cliente. Já aplica as travas: escala antes de
 * chamar o modelo quando o cliente pede preço, e escala depois quando a
 * resposta do modelo vaza valor.
 */
export async function generateAiReply(opts: {
  lead?: LeadContext | null;
  produtos?: string[];
  /** Histórico em ordem cronológica; só as últimas trocas importam. */
  turns: ConversationTurn[];
  /** Já existe promessa de retorno em aberto nesta conversa. */
  pendenciaAberta?: boolean;
  /** Prompt editado no portal (whatsapp_ai_config.prompt); vazio = padrão. */
  promptBase?: string | null;
}): Promise<AiReplyResult> {
  const ultima = [...opts.turns].reverse().find((t) => t.direction === 'in');
  const textoCliente = ultima?.body || '';
  // Ninguém da loja escreveu ainda → é o primeiro contato, a IA se
  // apresenta. Se a loja já abordou (abordagem de lead, por exemplo),
  // não repete a apresentação.
  const primeiroContato = !opts.turns.some((t) => t.direction === 'out');

  // Trava 1: pedido explícito de preço/orçamento nem chega no modelo.
  const pedido = clientAsksForPrice(textoCliente);
  if (pedido) {
    // Mesmo escalando, recepciona: pode ser a PRIMEIRA coisa que a pessoa
    // fala com a loja, e um "vou verificar" seco espanta.
    return {
      reply: primeiroContato
        ? 'Oi! Aqui é a Cali Colors, loja de tintas em Guarulhos 🎨 Obrigado pelo contato! ' +
          'Sobre valores eu já chamo alguém da equipe pra te passar direitinho — te respondo em breve, tá?'
        : opts.pendenciaAberta
          ? // Já prometemos antes: reconhece sem repetir a mesma frase.
            'Já avisei a equipe sobre os valores, tá? Enquanto isso, posso te ajudar com tipo de tinta, cor ou rendimento.'
          : 'Boa pergunta! Vou verificar isso com a equipe e te respondo em breve, tá? 👍',
      escalate: true,
      reason: pedido,
    };
  }

  // Trava 1b: reclamação/ameaça legal/pedido de cancelamento nem chega no
  // modelo — regra 4 do prompt vira código, mesma filosofia da trava de
  // preço (auditoria de segurança de IA, 2026-09-17).
  if (clientHasComplaintOrLegalThreat(textoCliente)) {
    return {
      reply: primeiroContato
        ? 'Oi! Aqui é a Cali Colors 🎨 Recebi sua mensagem e já vou chamar alguém da equipe pra cuidar disso com você, tá?'
        : 'Entendi. Vou chamar alguém da equipe pra cuidar disso com você agora, tá?',
      escalate: true,
      reason: 'humano',
    };
  }

  const key = getRuntimeEnv('OPENAI_API_KEY');
  if (!key) throw new ServiceError('OPENAI_API_KEY não configurada', 503);

  // Só as últimas 8 trocas — contexto curto é mais barato e mais preciso.
  const historico = opts.turns.slice(-8).map((t) => ({
    role: t.direction === 'in' ? ('user' as const) : ('assistant' as const),
    content: (t.body || '').slice(0, 700),
  }));

  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getAiModel(),
        temperature: 0.4,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: buildSystemPrompt({
              promptBase: opts.promptBase,
              lead: opts.lead,
              produtos: opts.produtos,
              primeiroContato,
              pendenciaAberta: opts.pendenciaAberta,
            }),
          },
          ...historico,
        ],
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('falha de rede ao chamar a IA', 502);
  }

  let data: OpenAiResponse = {};
  try {
    data = (await res.json()) as OpenAiResponse;
  } catch {
    /* status decide abaixo */
  }
  if (!res.ok || data.error) {
    throw new ServiceError(
      `IA recusou a chamada: ${(data.error?.message || `HTTP ${res.status}`).slice(0, 160)}`,
      502,
    );
  }

  const bruto = data.choices?.[0]?.message?.content || '';
  let parsed: { resposta?: unknown; precisa_humano?: unknown; motivo?: unknown } = {};
  try {
    parsed = JSON.parse(bruto) as typeof parsed;
  } catch {
    // Modelo fugiu do JSON: trata o texto cru como resposta, mas escala
    // por precaução (não sabemos se respeitou as regras).
    return {
      reply: 'Vou verificar isso e te respondo em breve!',
      escalate: true,
      reason: 'humano',
    };
  }

  const resposta = typeof parsed.resposta === 'string' ? parsed.resposta.trim() : '';
  const precisaHumano = parsed.precisa_humano === true;
  const motivo =
    parsed.motivo === 'preco' || parsed.motivo === 'orcamento' || parsed.motivo === 'humano'
      ? parsed.motivo
      : null;

  // Trava 2: a IA vazou preço? Não envia; escala.
  if (replyLeaksPrice(resposta)) {
    return {
      reply: 'Vou confirmar essa informação com a equipe e já te retorno! 👍',
      escalate: true,
      reason: 'preco',
    };
  }

  // Trava 2b: a IA prometeu prazo de entrega ou afirmou estoque que ela não
  // tem como saber (regra 3: "não invente produto, prazo, estoque nem
  // promessa de prazo")? Descarta e escala — mesma regra da trava de preço,
  // pra regra 3 não depender só de o modelo obedecer.
  if (replyMakesUnverifiedPromise(resposta)) {
    return {
      reply: 'Vou confirmar isso direitinho com a equipe e já te retorno! 👍',
      escalate: true,
      reason: 'humano',
    };
  }

  if (!resposta) {
    return { reply: '', escalate: true, reason: 'humano' };
  }

  return {
    reply: resposta,
    escalate: precisaHumano,
    reason: precisaHumano ? motivo || 'humano' : null,
  };
}

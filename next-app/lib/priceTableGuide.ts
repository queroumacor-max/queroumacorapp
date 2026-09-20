// priceTableGuide — a parte NÃO-tabular da tabela da ABRAPP 2026
// (folhas 20 a 26 do PDF): como usar as três faixas, as 13 variáveis que
// definem o preço final, a "tabela do jeitinho" e os créditos.
//
// Por que isto NÃO está no banco, se os preços estão: preço muda todo ano e
// a loja precisa corrigir sem deploy; este texto é editorial, muda junto com
// o app e não tem consulta em cima dele. Uma tabela no Postgres com 13 linhas
// de texto corrido só criaria um segundo lugar pra procurar.

export interface GuiaFaixa {
  faixa: 'Mínimo' | 'Médio' | 'Máximo';
  quando: string;
}

/** Folha 21 — "Como usar a tabela corretamente". */
export const GUIA_FAIXAS: readonly GuiaFaixa[] = [
  {
    faixa: 'Mínimo',
    quando: 'Obra simples, rápida, vazia e fácil de executar.',
  },
  {
    faixa: 'Médio',
    quando: 'Obra padrão, em condições normais.',
  },
  {
    faixa: 'Máximo',
    quando:
      'Obra difícil, cliente exigente, local distante ou horário ruim. Também quando o prazo é curto ou há risco alto de acidente, como trabalho em altura ou perto de rede elétrica.',
  },
];

/**
 * O recado principal da folha 21, que é o que separa usar a tabela de
 * copiar um número dela.
 */
export const GUIA_PRINCIPIO =
  'O valor da tabela é uma referência de pesquisa de mercado — uma das 13 variáveis que você deve levar em conta, não um número mágico e fixo. Para chegar no SEU preço, parta do valor da tabela e aplique as variáveis da obra.';

export interface GuiaVariavel {
  n: number;
  titulo: string;
  texto: string;
}

/** Folhas 22 a 25 — as 13 variáveis. */
export const GUIA_VARIAVEIS: readonly GuiaVariavel[] = [
  {
    n: 1,
    titulo: 'Distância (deslocamento)',
    texto:
      'Obra longe gasta combustível e, principalmente, tempo no trânsito. Se for longe ou tiver pedágio, o preço sobe (faixa média ou máxima).',
  },
  {
    n: 2,
    titulo: 'O grau de "bucha" (dificuldade)',
    texto:
      'Parede lisa no chão é uma coisa; teto, escadaria, fachada no sol, lugar alto (acima de 3 m) ou terreno inclinado é outra. Acesso difícil, entulho ou muito móvel para arrastar encarecem pelo esforço.',
  },
  {
    n: 3,
    titulo: 'Tamanho da obra',
    texto:
      'Volume: prédio, galpão ou casa inteira garante serviço por meses e permite negociar perto do mínimo. Serviço pequeno: pintar só um lavabo dá o mesmo trabalho de proteger e limpar de um quarto grande, mas gasta pouco material.',
  },
  {
    n: 4,
    titulo: 'Como está o mercado',
    texto:
      'Mercado fraco: cobre o mínimo para garantir o cliente. Agenda lotada e procura grande: valorize seu passe, cobre o médio ou o máximo.',
  },
  {
    n: 5,
    titulo: 'Preparação (o trabalho invisível)',
    texto:
      'Parede que exige muita massa, correção de umidade, tratamento de trincas ou remoção de tinta velha é trabalho extra. Ajuste o valor para cima.',
  },
  {
    n: 6,
    titulo: 'Tipo de tinta e acabamento',
    texto:
      'Tinta econômica pode exigir mais demãos (mais braço). Premium, acetinada ou brilhante exige parede perfeita e técnica apurada — o preço vai para o máximo.',
  },
  {
    n: 7,
    titulo: 'Custos da equipe',
    texto:
      'Seu preço tem que pagar o seu dia, o do ajudante, o transporte, a alimentação e os impostos — e ainda sobrar. Coloque tudo na ponta do lápis.',
  },
  {
    n: 8,
    titulo: 'Sua qualificação e ferramentas',
    texto:
      'Tem cursos? Usa airless e lixadeira girafa, que entregam a obra rápida e limpa? Isso é diferencial: quem investe em tecnologia e conhecimento cobra o médio ou o máximo, porque entrega resultado superior.',
  },
  {
    n: 9,
    titulo: 'A polêmica dos vãos (portas e janelas)',
    texto:
      'Vãos grandes: desconta-se a área total. Vãos pequenos e médios: a recomendação técnica é cobrar "pano cheio" ou descontar só em parte, porque o tempo do recorte e da proteção costuma ser maior do que se a parede fosse reta. Explique isso ao cliente antes de fechar.',
  },
  {
    n: 10,
    titulo: 'Pressa e horário',
    texto:
      'Cliente quer a obra "para ontem", à noite ou no fim de semana? Isso é hora extra e desgaste físico. O preço sobe.',
  },
  {
    n: 11,
    titulo: 'Valor percebido',
    texto:
      'Uniforme, organização e limpeza mudam a cabeça do cliente. Quem passa confiança consegue cobrar mais sem reclamação.',
  },
  {
    n: 12,
    titulo: 'Imprevistos',
    texto: 'Deixe sempre uma margem de segurança no orçamento para as surpresas da obra.',
  },
  {
    n: 13,
    titulo: 'Pagamento',
    texto:
      'À vista (Pix ou dinheiro) permite chegar no mínimo. Parcelado ou cartão tem taxa e risco: calcule isso e vá para o médio ou o máximo.',
  },
];

export interface GuiaJeitinho {
  frase: string;
  acrescimo: number; // em %
}

/**
 * Folha 20 — "Tabela especial para o jeitinho": quanto acrescentar quando o
 * cliente pede aquele favorzinho. É humor com fundo sério (todo item é
 * trabalho que ninguém orçou), e por isso entra no guia, não na tabela de
 * preços — não é um serviço que se cobra, é um percentual sobre o que já foi
 * orçado.
 */
export const GUIA_JEITINHO: readonly GuiaJeitinho[] = [
  { frase: 'Coisa rápida', acrescimo: 5 },
  { frase: 'É só uma coisinha', acrescimo: 10 },
  { frase: 'Não leva 5 minutos', acrescimo: 20 },
  { frase: 'Rapidinho', acrescimo: 30 },
  { frase: 'Mudar só isso', acrescimo: 5 },
  { frase: 'Pra ver como fica', acrescimo: 10 },
  { frase: 'Favor', acrescimo: 20 },
  { frase: 'Favorzinho', acrescimo: 30 },
  { frase: 'Favorzinho de amigo', acrescimo: 40 },
  { frase: 'Não precisa fazer em todas', acrescimo: 50 },
  { frase: 'Eu pago amanhã', acrescimo: 100 },
  { frase: 'Faz esse que eu te indico', acrescimo: 200 },
];

/** O fecho da folha 20. */
export const GUIA_TRES_TIPOS =
  'Existem 3 tipos de serviço: bom, barato e rápido. Se for bom e barato, não vai ser rápido. Se for barato e rápido, não vai ser bom. Se for bom e rápido, não vai ser barato.';

/**
 * Avisos presos a uma folha específica. Aparecem no fim do grupo, como o
 * rodapé impresso aparece embaixo da tabela.
 */
export const NOTAS_POR_FOLHA: Readonly<Record<number, string>> = {
  19: 'Os fundos para usar em drywall podem ser "Fundo Gesso/Drywall", "Direto no Gesso (fundo + acabamento)" ou "Fundo Preparador" diluído 50% a 100% para não vetrificar.',
};

/**
 * Ressalvas nossas sobre o documento, não da ABRAPP. Ficam à vista porque
 * quem for conferir contra o PDF impresso vai bater de frente com elas.
 */
export const AVISOS_DA_FONTE: readonly string[] = [
  'Na folha 13, a linha "Tinta Epóxi (Alta espessura) — Manutenção Pesada" está zerada no documento original. Aqui ela aparece como "sem valor publicado".',
  'Na folha 19 (drywall), três pares de linhas têm a descrição idêntica no impresso com preços diferentes — a coluna cortou o que as separa. Foram mantidas como estão.',
];

export const FONTE_CREDITO =
  'Sugestão de Preços de Pintura 2026 — Movimento Brasil por um Pintor Melhor. Atualização de janeiro de 2026. Sugestões e correções: WhatsApp (11) 92006-1357, com Douglas de Assis.';

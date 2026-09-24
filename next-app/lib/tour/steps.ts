// steps.ts — roteiro do tour guiado (coach marks) que roda na PRIMEIRA vez
// que o usuário abre o app. Cada passo aponta pra um elemento real da UI
// via `data-tour="..."` (atributo colocado no TopNav/BottomNav) e mostra um
// balão com uma explicação curta, em linguagem bem simples.
//
// Passos com `selector: null` não destacam nada — viram um cartão
// centralizado (usado na abertura e no encerramento).
//
// Ordem pedida: Início → Mensagens → Buscar → Loja → Avisos → Perfil → Plano.
//
// Este arquivo tem DOIS roteiros:
//   - `TOUR_STEPS`         → navegação (as duas barras), roda em /feed
//   - `PROFILE_TOUR_STEPS` → um passo por ferramenta do perfil, roda em /perfil

export interface TourStep {
  /** Identificador estável (usado em key/testes). */
  id: string;
  /** Seletor CSS do alvo. `null` = cartão centralizado, sem recorte. */
  selector: string | null;
  /** Emoji grande do balão (evita depender de lib de ícones). */
  emoji: string;
  title: string;
  /** 1-2 frases curtas, tom "explica pra criança". */
  text: string;
  /** Raio do recorte do holofote, em px. */
  radius?: number;
}

export const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'welcome',
    selector: null,
    emoji: '👋',
    title: 'Oi! Bem-vindo ao QueroUmaCor',
    text: 'Vou te mostrar pra que serve cada botão do app. É rapidinho, menos de um minuto.',
  },
  {
    id: 'feed',
    selector: '[data-tour="nav-feed"]',
    emoji: '🏠',
    title: 'A casinha é o Início',
    text: 'Toque aqui pra voltar pra página inicial, onde aparecem todos os posts dos pintores.',
  },
  {
    id: 'chat',
    selector: '[data-tour="nav-chat"]',
    emoji: '💬',
    title: 'Aqui ficam as mensagens',
    text: 'É o seu chat com clientes e outros profissionais. Quando chega mensagem nova, aparece uma bolinha vermelha.',
  },
  {
    id: 'search',
    selector: '[data-tour="nav-search"]',
    emoji: '🔎',
    title: 'A lupa procura tudo',
    text: 'Digite um nome, um serviço ou uma tinta e a lupa acha pintores, posts e produtos.',
  },
  {
    id: 'loja',
    selector: '[data-tour="nav-loja"]',
    emoji: '🛒',
    title: 'A sacolinha é a Loja',
    text: 'Escolha tintas e materiais, monte sua lista de pedido e a equipe da Cali Colors te chama no WhatsApp.',
  },
  {
    id: 'notificacoes',
    selector: '[data-tour="nav-notif"]',
    emoji: '🔔',
    title: 'O sininho avisa você',
    text: 'Ele mostra quem curtiu, quem comentou e quem começou a te seguir.',
  },
  {
    id: 'perfil',
    selector: '[data-tour="nav-perfil"]',
    emoji: '👤',
    title: 'O bonequinho é o seu perfil',
    text: 'Seu espaço: suas fotos de trabalho, suas avaliações e as ferramentas de orçamento, agenda e clientes.',
  },
  {
    id: 'plano',
    selector: '[data-tour="nav-plano"]',
    emoji: '⭐',
    title: 'Esse é o seu plano',
    text: 'Mostra se você está no GRÁTIS ou no PRO. Toque pra ver o que o plano PRO libera.',
  },
  {
    id: 'done',
    selector: null,
    emoji: '🎉',
    title: 'Pronto, é só isso!',
    text: 'Agora pode explorar à vontade. Se quiser rever depois, o botão “Ver tutorial de novo” fica lá no seu perfil.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tour 2 — as ferramentas do Perfil ("Meu Negócio"), um passo por tile.
//
// Roda na PRIMEIRA vez que o usuário abre `/perfil`. Cada passo aponta pra
// `[data-tour="tile-<sheet>"]` (atributo colocado no BusinessGrid, derivado
// da chave `sheet` do tile), então o roteiro segue a mesma regra do tour de
// navegação: passo cujo alvo não está na tela é pulado sozinho.
//
// Isso importa aqui porque o grid é condicional ao papel do usuário —
// pintor não vê "AR Grafite", cliente não vê "Financeiro", e cada papel só
// enxerga a SUA persona de IA. Na prática cada pessoa vê só os passos das
// ferramentas que realmente tem.
//
// A ordem espelha a ordem de render do BusinessGrid: tiles de papel primeiro,
// depois as ferramentas gerais, e as personas de IA por último.

export const PROFILE_TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'p-welcome',
    selector: null,
    emoji: '🧰',
    title: 'Estas são as suas ferramentas',
    text: 'Cada quadradinho aqui embaixo faz uma coisa que ajuda no seu trabalho. Vou explicar um por um.',
  },

  // ── tiles de papel (só aparecem pra quem tem o papel) ──────────────────
  {
    id: 'p-grafites',
    selector: '[data-tour="tile-grafites"]',
    emoji: '🎨',
    title: 'AR Grafite',
    text: 'Aponte a câmera do celular pra parede e veja a sua arte encaixada nela, antes de pintar.',
  },
  {
    id: 'p-arte-venda',
    selector: '[data-tour="tile-arte-venda"]',
    emoji: '🖼️',
    title: 'Arte pra venda',
    text: 'Monte um catálogo das suas obras pra quem quiser comprar ver tudo num lugar só.',
  },
  {
    id: 'p-click-rua',
    selector: '[data-tour="tile-click-rua"]',
    emoji: '📖',
    title: 'Click Rua',
    text: 'A revista Click Rua, de graffiti do Brasil inteiro, pra ler aqui dentro. Toque numa edição e arraste pra virar a página.',
  },
  {
    id: 'p-avaliar',
    selector: '[data-tour="tile-avaliar"]',
    emoji: '⭐',
    title: 'Avaliar serviço',
    text: 'Quando a obra terminar, conte aqui como foi o trabalho do profissional. Isso ajuda outras pessoas a escolher.',
  },

  // ── ferramentas gerais ─────────────────────────────────────────────────
  {
    id: 'p-pedidos',
    selector: '[data-tour="tile-pedidos"]',
    emoji: '📋',
    title: 'Meus Pedidos',
    text: 'Aqui ficam guardadas as listas de pedido que você mandou pra loja Cali Colors.',
  },
  {
    id: 'p-orcamento',
    selector: '[data-tour="tile-orcamento"]',
    emoji: '📄',
    title: 'Orçamento',
    text: 'Responda algumas perguntas e o app monta o orçamento pronto pra mandar pro cliente.',
  },
  {
    id: 'p-orcamentos',
    selector: '[data-tour="tile-orcamentos"]',
    emoji: '🗂️',
    title: 'Orçamentos',
    text: 'Acompanhe cada orçamento que você enviou: quem ainda não respondeu, quem aprovou e quem recusou.',
  },
  {
    id: 'p-pontos',
    selector: '[data-tour="tile-pontos"]',
    emoji: '🎁',
    title: 'Meus Pontos',
    text: 'Você ganha pontos usando o app e indicando amigos. Juntando pontos, o plano PRO sai de graça.',
  },
  {
    id: 'p-portfolio',
    selector: '[data-tour="tile-portfolio"]',
    emoji: '📸',
    title: 'Meu Portfolio',
    text: 'É por aqui que você publica as fotos dos seus trabalhos. Elas aparecem no Início pra todo mundo ver.',
  },
  {
    id: 'p-calculadora',
    selector: '[data-tour="tile-calculadora"]',
    emoji: '🧮',
    title: 'Calculadora',
    text: 'Diga o tamanho da parede e ela calcula quantos litros de tinta você vai precisar.',
  },
  {
    id: 'p-frete',
    selector: '[data-tour="tile-frete"]',
    emoji: '🚚',
    title: 'Frete',
    text: 'Coloque a distância até a obra, quantos km o carro faz por litro e o preço do litro. Ela mostra quanto custa ir e voltar, pra você não esquecer de cobrar.',
  },
  {
    id: 'p-tabela-precos',
    selector: '[data-tour="tile-tabela-precos"]',
    emoji: '📊',
    title: 'Tabela de Preços',
    text: 'A tabela de referência com o preço sugerido de cada serviço de pintura. Diz o mínimo, o médio e o máximo pra você não cobrar menos do que vale.',
  },
  {
    id: 'p-agenda',
    selector: '[data-tour="tile-agenda"]',
    emoji: '📅',
    title: 'Agenda',
    text: 'Marque os dias de cada obra pra não prometer dois serviços no mesmo dia.',
  },
  {
    id: 'p-crm',
    selector: '[data-tour="tile-crm"]',
    emoji: '🔁',
    title: 'Reativar clientes',
    text: 'Lembra dos clientes de um tempo atrás e já escreve a mensagem pra você chamar de novo.',
  },
  {
    id: 'p-financeiro',
    selector: '[data-tour="tile-financeiro"]',
    emoji: '💰',
    title: 'Financeiro',
    text: 'Anote o que entrou e o que você gastou na obra. Ele mostra quanto sobrou de lucro no fim.',
  },
  {
    id: 'p-notes',
    selector: '[data-tour="tile-notes"]',
    emoji: '📝',
    title: 'Anotações',
    text: 'Seu caderninho: medidas, recado do cliente, lista de material. Fica salvo mesmo se trocar de celular.',
  },
  {
    id: 'p-camisetas',
    selector: '[data-tour="tile-camisetas"]',
    emoji: '👕',
    title: 'Camisetas',
    text: 'Monte a camisa do seu trabalho com o seu nome e a sua logo.',
  },
  {
    id: 'p-formacao',
    selector: '[data-tour="tile-formacao"]',
    emoji: '🎓',
    title: 'Formação',
    text: 'Guarde aqui os cursos e certificados que você fez. Eles aparecem no seu perfil e passam confiança.',
  },

  // ── personas de IA (uma por papel; admin vê todas) ─────────────────────
  {
    id: 'p-seu-ze',
    selector: '[data-tour="tile-seu-ze"]',
    emoji: '👷',
    title: 'Seu Zé',
    text: 'É o ajudante do app. Pergunte qualquer dúvida de pintura, do preparo da parede ao acabamento.',
  },
  {
    id: 'p-alice',
    selector: '[data-tour="tile-alice"]',
    emoji: '🛋️',
    title: 'Alice Codessi',
    text: 'Ela te ajuda a escolher as cores e combinar os ambientes da sua casa.',
  },
  {
    id: 'p-fe',
    selector: '[data-tour="tile-fe"]',
    emoji: '🎨',
    title: 'Fê',
    text: 'Fala a língua do grafite: ideias de traço, material e onde a cena está bombando.',
  },
  {
    id: 'p-senna',
    selector: '[data-tour="tile-senna"]',
    emoji: '🚗',
    title: 'Senna',
    text: 'Entende de pintura de carro e funilaria. Tire dúvidas de tinta, verniz e polimento com ele.',
  },

  {
    id: 'p-done',
    selector: null,
    emoji: '✅',
    title: 'Pronto!',
    text: 'É só tocar no quadradinho pra abrir a ferramenta. Pra rever isso depois, use “Ver tutorial das ferramentas”, aqui no fim do perfil.',
  },
];

/**
 * Filtra os passos cujo alvo realmente existe na tela agora. Telas que
 * escondem a TopNav/BottomNav (ex.: conversa de chat) simplesmente pulam
 * os passos correspondentes em vez de destacar o vazio.
 */
export function resolveVisibleSteps(
  steps: ReadonlyArray<TourStep>,
  exists: (selector: string) => boolean,
): TourStep[] {
  return steps.filter((s) => s.selector === null || exists(s.selector));
}

// Pedido de pintor feito pela página PÚBLICA /pedir (2026-11-10).
// Regra única de validação: o formulário e a rota /api/pedidos-pintor usam
// a MESMA função — o que a tela aceita é o que o servidor grava.
//
// Sem zod de propósito: é um punhado de campos de texto e a página é
// pública (bundle pequeno pra quem chega de um grupo de Facebook no 4G).

export const SERVICOS_PEDIDO = [
  'Pintura interna',
  'Pintura externa / fachada',
  'Textura / grafiato',
  'Grafite / arte',
  'Pintura automotiva',
  'Outro',
] as const;

export const PRAZOS_PEDIDO = [
  'O quanto antes',
  'Nos próximos 30 dias',
  'Sem pressa',
] as const;

export const CIDADE_PADRAO = 'Guarulhos';

export interface PedidoPintorEntrada {
  servico?: unknown;
  descricao?: unknown;
  cidade?: unknown;
  bairro?: unknown;
  prazo?: unknown;
  nome?: unknown;
  telefone?: unknown;
  consentimento?: unknown;
  origem?: unknown;
}

export interface PedidoPintorValido {
  servico: string;
  descricao: string;
  cidade: string;
  bairro: string | null;
  prazo: string | null;
  nome: string;
  telefone: string;
  origem: string | null;
}

export type ResultadoPedido =
  | { ok: true; pedido: PedidoPintorValido }
  | { ok: false; campo: keyof PedidoPintorEntrada; erro: string };

function texto(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Colapsa espaço e tira caractere de controle: o texto vai pra tela do
  // portal e pra mensagem de WhatsApp da equipe.
  return v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
}

/**
 * Telefone BR com DDD → só dígitos com 55 na frente. Aqui só entra número
 * do Brasil (a página é de pintor por cidade brasileira): 10 dígitos (fixo)
 * ou 11 com 9 no 3º dígito (celular), com ou sem o 55.
 */
export function telefoneDoPedido(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length === 10) return `55${d}`;
  if (d.length === 11 && d[2] === '9') return `55${d}`;
  return null;
}

/** Origem (`?o=facebook`): só letra, número, hífen e sublinhado. */
export function origemDoPedido(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const o = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return o || null;
}

export function validarPedidoPintor(e: PedidoPintorEntrada): ResultadoPedido {
  const servico = texto(e.servico, 60);
  if (!(SERVICOS_PEDIDO as readonly string[]).includes(servico)) {
    return { ok: false, campo: 'servico', erro: 'Escolha o tipo de serviço.' };
  }
  const descricao = texto(e.descricao, 1500);
  if (descricao.length < 10) {
    return { ok: false, campo: 'descricao', erro: 'Conte um pouco mais sobre o serviço (pelo menos 10 letras).' };
  }
  const cidade = texto(e.cidade, 80);
  if (cidade.length < 2) return { ok: false, campo: 'cidade', erro: 'Informe a cidade.' };
  const bairro = texto(e.bairro, 80) || null;
  const prazoRaw = texto(e.prazo, 40);
  const prazo = (PRAZOS_PEDIDO as readonly string[]).includes(prazoRaw) ? prazoRaw : null;
  const nome = texto(e.nome, 80);
  if (nome.length < 2) return { ok: false, campo: 'nome', erro: 'Informe seu nome.' };
  const telefone = telefoneDoPedido(e.telefone);
  if (!telefone) {
    return { ok: false, campo: 'telefone', erro: 'Informe um telefone com DDD, ex.: (11) 91234-5678.' };
  }
  if (e.consentimento !== true) {
    return { ok: false, campo: 'consentimento', erro: 'Marque a autorização para passarmos seu contato aos pintores.' };
  }
  return {
    ok: true,
    pedido: { servico, descricao, cidade, bairro, prazo, nome, telefone, origem: origemDoPedido(e.origem) },
  };
}

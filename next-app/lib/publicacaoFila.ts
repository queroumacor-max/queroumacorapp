// publicacaoFila — publicar em SEGUNDO PLANO (2026-11-04, pedido do usuário:
// "clique, ele some e faz o loading em background; o círculo fica girando").
//
// Antes, o composer ficava aberto em "Publicando…" de 15 a 30s com 5 fotos.
// Agora o Composer entrega o pedido aqui e fecha na hora; o envio roda neste
// módulo (estado de módulo sobrevive à troca de tela do SPA) e quem quiser
// mostrar o andamento assina com `usePublicacao()` — o anel do "Seu story" no
// feed e o aviso global do AppShell.
//
// Limite que nenhum código web resolve: se o app for FECHADO no meio, o envio
// para junto. O post pendente nunca aparece pra ninguém (o servidor só publica
// depois de moderar) e a varredura `posts-sweep-pending` cuida do que sobrar.
//
// Uma publicação por vez: um 2º pedido com outro em voo é recusado (o Composer
// avisa). Se falhar, o pedido FICA guardado pra `tentarDeNovo()` — a pessoa não
// precisa escolher as fotos de novo.

'use client';

import { useSyncExternalStore } from 'react';
import type { CreatePostMediaType } from '@/lib/services/posts';
import {
  executarPublicacao,
  type PublishPostInput,
} from '@/lib/services/publicarPost';

export type EstadoPublicacao =
  | { status: 'ocioso' }
  | {
      status: 'enviando';
      mediaType: CreatePostMediaType;
      total: number;
      enviados: number;
      aprovando: boolean;
    }
  | { status: 'pronto'; mediaType: CreatePostMediaType }
  | { status: 'erro'; mediaType: CreatePostMediaType; mensagem: string; erro: unknown };

export interface ContextoFila {
  userId: string;
  emailVerified: boolean | null | undefined;
}

const OCIOSO: EstadoPublicacao = { status: 'ocioso' };
/** Quanto tempo o "publicado" fica visível antes de voltar ao normal. */
export const PRONTO_MS = 4000;

let estado: EstadoPublicacao = OCIOSO;
let pendente: { input: PublishPostInput; ctx: ContextoFila } | null = null;
let timerPronto: ReturnType<typeof setTimeout> | null = null;
const ouvintes = new Set<() => void>();

function definir(novo: EstadoPublicacao) {
  estado = novo;
  ouvintes.forEach((f) => f());
}

export function estadoPublicacao(): EstadoPublicacao {
  return estado;
}

export function assinarPublicacao(f: () => void): () => void {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/** Pra telas: re-renderiza a cada mudança do envio. */
export function usePublicacao(): EstadoPublicacao {
  return useSyncExternalStore(assinarPublicacao, estadoPublicacao, () => OCIOSO);
}

export function publicandoAgora(): boolean {
  return estado.status === 'enviando';
}

async function rodar(input: PublishPostInput, ctx: ContextoFila): Promise<void> {
  if (timerPronto) {
    clearTimeout(timerPronto);
    timerPronto = null;
  }
  pendente = { input, ctx };
  definir({
    status: 'enviando',
    mediaType: input.mediaType,
    total: input.files.length,
    enviados: 0,
    aprovando: false,
  });
  try {
    await executarPublicacao(input, {
      userId: ctx.userId,
      emailVerified: ctx.emailVerified,
      aoProgredir: (p) => {
        if (estado.status !== 'enviando') return;
        definir({ ...estado, ...p });
      },
    });
    pendente = null;
    definir({ status: 'pronto', mediaType: input.mediaType });
    timerPronto = setTimeout(() => {
      timerPronto = null;
      if (estado.status === 'pronto') definir(OCIOSO);
    }, PRONTO_MS);
  } catch (e) {
    const mensagem =
      e instanceof Error && e.message ? e.message : 'Não foi possível publicar.';
    definir({ status: 'erro', mediaType: input.mediaType, mensagem, erro: e });
  }
}

/**
 * Começa a publicar em segundo plano. Devolve false (e não faz nada) se já há
 * uma publicação em andamento.
 */
export function iniciarPublicacao(input: PublishPostInput, ctx: ContextoFila): boolean {
  if (publicandoAgora()) return false;
  void rodar(input, ctx);
  return true;
}

/** Repete a última publicação que falhou, com as mesmas fotos. */
export function tentarDeNovo(): boolean {
  if (estado.status !== 'erro' || !pendente) return false;
  const { input, ctx } = pendente;
  void rodar(input, ctx);
  return true;
}

/** Desiste da publicação que falhou (as fotos guardadas são descartadas). */
export function descartarPublicacao(): void {
  if (estado.status === 'enviando') return;
  pendente = null;
  if (timerPronto) {
    clearTimeout(timerPronto);
    timerPronto = null;
  }
  definir(OCIOSO);
}

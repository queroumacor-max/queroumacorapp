// Chave de idempotência do pedido da loja.
//
// Por que existe: a trava de clique duplo da tela (useSingleFlight) só cobre
// o mesmo toque repetido. Ela não cobre o caso "o pedido FOI gravado, mas a
// resposta se perdeu na rede": a tela mostra erro, a pessoa toca de novo, e
// sem chave nasce um segundo pedido. A checagem por assinatura do carrinho em
// `submitOrder` também não fecha isso — ela é ler-e-depois-gravar, e duas
// tentativas quase simultâneas passam pela leitura antes de qualquer uma
// gravar.
//
// Com a chave, a tentativa repetida manda o MESMO valor, e o índice único
// (user_id, idempotency_key) no banco recusa o segundo INSERT (23505).
//
// A chave é por (usuário, conteúdo do carrinho): mudou o carrinho, é outro
// pedido. Fica guardada no localStorage pra sobreviver a um recarregamento
// entre a tentativa e a repetição, vale por 1h e é esquecida quando o pedido
// é confirmado — depois disso, pedir de novo é intencional.

const STORAGE_KEY = 'order_idem_v1';
export const VALIDADE_CHAVE_MS = 60 * 60 * 1000;

interface Registro {
  user: string;
  sig: string;
  key: string;
  at: number;
}

// Fallback quando o localStorage não está disponível (aba privada, WebView
// com storage bloqueado): vale pelo menos dentro da mesma página.
let memoria: Registro | null = null;

function ler(): Registro | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoria;
    const r = JSON.parse(raw) as Partial<Registro>;
    if (
      typeof r.user === 'string' &&
      typeof r.sig === 'string' &&
      typeof r.key === 'string' &&
      typeof r.at === 'number'
    ) {
      return r as Registro;
    }
    return memoria;
  } catch {
    return memoria;
  }
}

function gravar(r: Registro | null): void {
  memoria = r;
  try {
    if (r) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage indisponível: a cópia em memória já foi atualizada.
  }
}

function novaChave(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // cai no fallback abaixo
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/** Chave da tentativa de pedido. Repetir com o mesmo usuário e o mesmo
 *  carrinho (dentro de 1h) devolve a MESMA chave. */
export function chaveDoPedido(userId: string, sig: string, now: number = Date.now()): string {
  const atual = ler();
  if (atual && atual.user === userId && atual.sig === sig && now - atual.at < VALIDADE_CHAVE_MS) {
    return atual.key;
  }
  const key = novaChave();
  gravar({ user: userId, sig, key, at: now });
  return key;
}

/** Esquece a chave depois que o pedido foi confirmado. */
export function esquecerChaveDoPedido(userId: string, sig: string): void {
  const atual = ler();
  if (atual && atual.user === userId && atual.sig === sig) gravar(null);
}

/** Roda `fn` sob uma trava EXCLUSIVA compartilhada por todas as abas da
 *  mesma origem (Web Locks API). Duas abas enviando o mesmo carrinho ao mesmo
 *  tempo liam o storage antes de qualquer uma gravar, geravam chaves
 *  DIFERENTES e as duas passavam pelo índice único. Com a trava, a segunda só
 *  começa depois que a primeira terminou — e aí a checagem de pedido recente
 *  e a chave guardada já enxergam o que a primeira gravou.
 *  Sem Web Locks (navegador antigo, SSR, testes) roda direto: o índice único
 *  continua cobrindo a repetição na mesma aba. */
export async function comTravaEntreAbas<T>(nome: string, fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & {
          locks?: { request: (n: string, cb: () => Promise<T>) => Promise<T> };
        }).locks
      : undefined;
  if (!locks || typeof locks.request !== 'function') return fn();
  return locks.request(nome, fn);
}

/** Só pra testes. */
export function __resetChaveDoPedidoForTests(): void {
  gravar(null);
}

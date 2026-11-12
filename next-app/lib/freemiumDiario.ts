// Limite diário do plano GRÁTIS (decisão do usuário, 12/11/2026):
// orçamento, calculadora de tinta e frete = 2 usos por dia no FREE.
// PRO e admin: ilimitado. Reset à meia-noite de Brasília.
//
// É um NUDGE de produto, não uma fronteira de cobrança: o contador vive no
// localStorage do aparelho, por ferramenta e por dia. Some se a pessoa trocar
// de aparelho ou limpar os dados — aceitável, porque o objetivo é convidar pro
// PRO, não travar dinheiro (a cobrança de verdade é a assinatura/pacote, que
// continua no servidor). Toda leitura/escrita é protegida (localStorage pode
// faltar em WebView/aba privada).
import { useCallback, useSyncExternalStore } from 'react';
import { canSeeProFeature } from '@/lib/policies';
import { ymdBrt } from '@/lib/utils';

// Assinantes que querem saber quando um contador muda (useUsosHoje).
const ouvintes = new Set<() => void>();
function notificar() {
  ouvintes.forEach((l) => l());
}

// Mesmo tipo de usuário que canSeeProFeature aceita (MaybeUser não é exportado).
type MaybeUser = Parameters<typeof canSeeProFeature>[0];

export const LIMITE_DIARIO_FREE = 2;

export type FerramentaDiaria = 'orcamento' | 'calculadora' | 'frete';

function chave(t: FerramentaDiaria): string {
  // Carimba o dia de Brasília: vira chave nova à meia-noite, então o contador
  // "zera" sozinho sem precisar de limpeza.
  return `freemium_diario:${t}:${ymdBrt()}`;
}

/** Quantos usos a ferramenta já teve HOJE (Brasília) neste aparelho. */
export function usosHoje(t: FerramentaDiaria): number {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(chave(t)) : null;
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Marca mais um uso de hoje; devolve o novo total. */
export function registrarUso(t: FerramentaDiaria): number {
  const n = usosHoje(t) + 1;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(chave(t), String(n));
  } catch {
    // sem storage (WebView/privada): o limite não persiste — nudge, não trava.
  }
  notificar();
  return n;
}

/** PRO/admin não têm limite. */
export function semLimite(user: MaybeUser): boolean {
  return canSeeProFeature(user);
}

/** true quando o free já gastou os 2 usos de hoje. PRO/admin nunca atinge. */
export function limiteAtingido(t: FerramentaDiaria, user: MaybeUser): boolean {
  if (canSeeProFeature(user)) return false;
  return usosHoje(t) >= LIMITE_DIARIO_FREE;
}

/** Usos restantes hoje; null = ilimitado (PRO/admin). */
export function restantesHoje(t: FerramentaDiaria, user: MaybeUser): number | null {
  if (canSeeProFeature(user)) return null;
  return Math.max(0, LIMITE_DIARIO_FREE - usosHoje(t));
}

/**
 * Lê o contador de hoje de forma segura pra SSR com useSyncExternalStore:
 * o snapshot do SERVIDOR é 0 (sem localStorage → sem erro de hidratação) e o
 * do cliente lê o localStorage; `registrarUso` notifica, então todas as telas
 * se atualizam juntas. `refresh()` força uma releitura (ex.: após gravar).
 */
export function useUsosHoje(t: FerramentaDiaria): { usos: number; refresh: () => void } {
  const usos = useSyncExternalStore(
    (cb) => {
      ouvintes.add(cb);
      return () => ouvintes.delete(cb);
    },
    () => usosHoje(t), // cliente
    () => 0, // servidor (SSR): começa em 0
  );
  const refresh = useCallback(() => notificar(), []);
  return { usos, refresh };
}

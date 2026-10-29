// Boas-vindas depois da compra — regra pura, testada em
// __tests__/boasVindasCompra.test.ts. Quem mostra é o BoasVindasCompraModal.
//
// Dois avisos, cada um UMA vez:
//   - PRO: a primeira vez que a conta abre o app sendo PRO ("Parabéns, você
//     é PRO" + benefícios + até quando vale). A marca é por conta e só é
//     apagada quando o perfil (já carregado) diz que a pessoa deixou de ser
//     PRO — assim quem assina de novo depois de vencer vê o aviso de novo,
//     e renovação mensal (data nova) NÃO repete o aviso todo mês.
//   - Créditos: quando o saldo de créditos SOBE em relação ao último que
//     este aparelho viu ("Você comprou o pacote, tem N créditos"). Gastar
//     crédito só atualiza a marca, sem aviso.
//
// Admin nunca vê: o acesso dele não depende de compra.

import { canSeeProFeature, isAdmin, type PolicyUser } from '@/lib/policies';
import { fimDoPro } from '@/lib/proAviso';

/** Créditos do pacote Iniciante (`quote_pack_40`). */
export const CREDITOS_PACOTE_INICIANTE = 40;

export type BoasVindas =
  | { tipo: 'pro'; fim: number | null }
  | { tipo: 'creditos'; total: number; ganhou: number };

export interface EntradaBoasVindas {
  user: PolicyUser | null;
  /** O perfil já veio do banco? Antes disso is_pro pode estar falso à toa. */
  perfilCarregado: boolean;
  /** Créditos atuais; null = saldo ainda não chegou (ou SQL ausente). */
  creditos: number | null;
  /** Fim da assinatura vinda da loja (ISO), se houver. */
  assinaturaAte?: string | null;
  jaViuPro: boolean;
  /** Último saldo de créditos que este aparelho viu; null = nunca viu. */
  ultimosCreditos: number | null;
}

export function ehProComprado(user: PolicyUser | null): boolean {
  return !!user && !isAdmin(user) && canSeeProFeature(user);
}

/** O que mostrar agora (ou null). PRO tem prioridade sobre créditos. */
export function boasVindasAgora(e: EntradaBoasVindas): BoasVindas | null {
  const { user } = e;
  if (!user || isAdmin(user) || !e.perfilCarregado) return null;

  if (ehProComprado(user) && !e.jaViuPro) {
    const doPerfil = fimDoPro(user);
    const daLoja = e.assinaturaAte ? Date.parse(e.assinaturaAte) : NaN;
    const fim = Number.isFinite(daLoja)
      ? Math.max(daLoja, doPerfil ?? -Infinity)
      : doPerfil;
    return { tipo: 'pro', fim };
  }

  if (e.creditos !== null && e.creditos > 0) {
    const antes = e.ultimosCreditos ?? 0;
    if (e.creditos > antes) {
      return { tipo: 'creditos', total: e.creditos, ganhou: e.creditos - antes };
    }
  }
  return null;
}

/** "1 pacote Iniciante", "2 pacotes Iniciante"… ou null se não fecha em 40. */
export function pacotesIniciante(ganhou: number): number | null {
  if (ganhou < CREDITOS_PACOTE_INICIANTE) return null;
  return ganhou % CREDITOS_PACOTE_INICIANTE === 0 ? ganhou / CREDITOS_PACOTE_INICIANTE : null;
}

// ── Marcas no aparelho ────────────────────────────────────────────────

const CHAVE_PRO = 'boasvindas_pro_visto_';
const CHAVE_CREDITOS = 'boasvindas_creditos_vistos_';

function ler(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function gravar(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* storage bloqueado: no pior caso o aviso repete */ }
}

export function jaViuBoasVindasPro(uid: string): boolean {
  return ler(CHAVE_PRO + uid) === '1';
}
export function marcarBoasVindasPro(uid: string, visto: boolean): void {
  gravar(CHAVE_PRO + uid, visto ? '1' : null);
}
export function ultimosCreditosVistos(uid: string): number | null {
  const v = ler(CHAVE_CREDITOS + uid);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
export function marcarCreditosVistos(uid: string, n: number): void {
  gravar(CHAVE_CREDITOS + uid, String(n));
}

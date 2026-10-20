// Aviso de PRO acabando — regra pura, testada em __tests__/proAviso.test.ts.
//
// Quem decide "o PRO acaba quando" é a MESMA conta do canSeeProFeature: o
// acesso vale até a MAIOR data entre pro_expires_at e pro_grace_until.
// Avisar pela expires_at sozinha mandaria "acaba amanhã" pra quem ainda tem
// 3 dias de carência — e o aviso errado ensina a ignorar o certo.
//
// A marca de "já vi" carrega a DATA DE FIM. Renovou (data nova) → a próxima
// janela de 24h avisa de novo; com chave fixa o modal morreria depois do
// primeiro uso.

import { isAdmin, type PolicyUser } from '@/lib/policies';

export const JANELA_AVISO_PRO_MS = 24 * 60 * 60 * 1000;
const PREFIXO_CHAVE = 'pro_aviso_fim_visto_';

function ms(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Fim do acesso PRO em ms, ou null quando não há data (PRO sem prazo). */
export function fimDoPro(user: PolicyUser | null): number | null {
  if (!user || user.is_pro !== true) return null;
  const exp = ms(user.pro_expires_at);
  const grace = ms((user as { pro_grace_until?: string | null }).pro_grace_until);
  if (exp === null && grace === null) return null;
  return Math.max(exp ?? -Infinity, grace ?? -Infinity);
}

/**
 * Devolve o fim (ms) quando o PRO acaba nas próximas 24h e ainda não acabou;
 * null em qualquer outro caso. Admin nunca vê: o acesso dele não depende do
 * plano, e o aviso seria falso.
 */
export function proAcabandoEm(user: PolicyUser | null, agora = Date.now()): number | null {
  if (!user || isAdmin(user)) return null;
  const fim = fimDoPro(user);
  if (fim === null) return null;
  const falta = fim - agora;
  return falta > 0 && falta <= JANELA_AVISO_PRO_MS ? fim : null;
}

export function chaveAvisoPro(fim: number): string {
  return `${PREFIXO_CHAVE}${fim}`;
}

export function jaViuAvisoPro(fim: number): boolean {
  try {
    return localStorage.getItem(chaveAvisoPro(fim)) === '1';
  } catch {
    return false;
  }
}

export function marcarAvisoProVisto(fim: number): void {
  try {
    localStorage.setItem(chaveAvisoPro(fim), '1');
  } catch {
    /* storage bloqueado: o pior caso é avisar de novo */
  }
}

/** "hoje às 18:30" / "amanhã às 09:00" — sempre no fuso de Brasília. */
export function quandoAcaba(fim: number, agora = Date.now()): string {
  const dia = (t: number) =>
    new Date(t).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = new Date(fim).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
  const quando = dia(fim) === dia(agora) ? 'hoje' : 'amanhã';
  return `${quando} às ${hora}`;
}

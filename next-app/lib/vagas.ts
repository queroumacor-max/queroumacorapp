// Vagas pra pintor (2026-11-10). A equipe acha a vaga fora do app (site de
// emprego, anúncio de empresa), confere e cadastra pelo portal; aqui o
// profissional vê e chama o contato do anúncio. O QueroUmaCor só divulga.

import { telefoneDoPedido } from '@/lib/pedidoPintor';

export interface Vaga {
  id: string;
  titulo: string;
  empresa: string | null;
  cidade: string | null;
  bairro: string | null;
  descricao: string | null;
  remuneracao: string | null;
  contato: string | null;
  contato_whatsapp: boolean;
  contato_obs: string | null;
  fonte: string | null;
  fonte_url: string | null;
  anuncio_em: string | null;
  created_at: string;
  /** Colunas de 10/11 (2ª leva): ausentes se o ALTER ainda não rodou. */
  regime?: string | null;
  conferido_em?: string | null;
}

export function localDaVaga(v: Pick<Vaga, 'cidade' | 'bairro'>): string {
  return [v.bairro, v.cidade].filter(Boolean).join(', ');
}

/**
 * Link do contato da vaga: wa.me com mensagem pronta quando o anúncio diz que
 * é WhatsApp, `tel:` quando é só telefone. Número que não é BR com DDD → null
 * (a tela mostra o texto cru em vez de um link que abre conversa errada).
 */
export function linkDoContato(v: Pick<Vaga, 'contato' | 'contato_whatsapp' | 'titulo'>): string | null {
  const fone = telefoneDoPedido(v.contato ?? '');
  if (!fone) return null;
  if (!v.contato_whatsapp) return `tel:+${fone}`;
  const texto = `Olá! Vi a vaga "${v.titulo}" divulgada no QueroUmaCor e tenho interesse.`;
  return `https://wa.me/${fone}?text=${encodeURIComponent(texto)}`;
}

/** Só https: a URL vem do portal, mas vira `href` na tela de todo mundo. */
export function fonteSegura(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "2026-09-23" → "23/09/2026", sem passar por fuso (é data digitada). */
export function dataDoAnuncio(ymd: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

const ROTULO_REGIME: Record<string, string> = {
  diaria: 'Diária',
  temporario: 'Temporário',
  clt: 'CLT',
  pj: 'PJ / MEI',
};

/** Rótulo do regime pra tela; valor desconhecido ou vazio → null. */
export function rotuloDoRegime(regime: string | null | undefined): string | null {
  return (regime && ROTULO_REGIME[regime]) || null;
}

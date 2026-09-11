// _untrusted.ts — helpers pra tratar dado de fora (webhook, WhatsApp, IA,
// corpo de request) ANTES de ele chegar num sink. Auditoria de 2026-09-11.
//
// Regra que este arquivo materializa: dado externo só entra num filtro
// PostgREST, numa URL, num log ou num header depois de passar por uma
// função daqui — nunca cru, nunca só com `encodeURIComponent`, que NÃO
// escapa `*` (o curinga do `ilike`), `(`, `)`, `.` nem `,`.

/** Só dígitos. */
export function soDigitos(s: unknown): string {
  return String(s ?? '').replace(/\D/g, '');
}

/**
 * `wa_id` da Meta é só dígitos (DDI + número), 8-15 chars. Qualquer outra
 * coisa é payload malformado ou hostil — e nunca seria um destinatário
 * válido pra responder.
 */
export function waIdValido(s: unknown): s is string {
  return typeof s === 'string' && /^\d{8,15}$/.test(s);
}

/**
 * Cauda de 8 dígitos usada pra casar telefone com lead/perfil pelo `ilike`.
 * Devolve `null` quando não há 8 dígitos: o chamador NÃO consulta nada
 * (uma cauda curta ou com `*` casaria a tabela inteira).
 */
export function caudaDeTelefone(waId: unknown): string | null {
  const d = soDigitos(waId).slice(-8);
  return d.length === 8 ? d : null;
}

/**
 * Padrão `ilike` do PostgREST pra "contém estes dígitos", só com o que
 * `caudaDeTelefone` aprovou. Centralizado pra não voltar a interpolar
 * `waId.slice(-8)` cru em ninguém.
 */
export function filtroTelefoneContem(waId: unknown): string | null {
  const cauda = caudaDeTelefone(waId);
  return cauda ? `ilike.*${cauda}*` : null;
}

/**
 * Escapa os curingas do LIKE/ILIKE (`%`, `_`) e o `*` do PostgREST num
 * VALOR de padrão. Pra usar quando o texto vem de pessoa (busca) e o
 * padrão é `*<texto>*`: sem isto, `*` no texto vira "qualquer coisa".
 */
export function escaparCuringasIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`).replace(/\*/g, '');
}

/**
 * Texto seguro pra ir dentro de uma expressão `or=(...)` do PostgREST:
 * tira os caracteres ESTRUTURAIS da gramática (`,` separa cláusulas, `(`
 * `)` agrupam, `.` separa coluna/operador/valor, aspas abrem string) e os
 * curingas. O que sobra só pode ser valor.
 */
export function valorParaOr(s: string, max = 100): string {
  const semGramatica = s.replace(/[,()."'\\*]/g, ' ').replace(/\s+/g, ' ').trim();
  return escaparCuringasIlike(semGramatica).slice(0, max);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s);
}

/**
 * Texto pra LOG: sem quebra de linha nem caractere de controle (um
 * `\n` num nome de contato forja uma linha de log inteira), com teto.
 */
export function paraLog(s: unknown, max = 120): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .slice(0, max);
}

/**
 * Chave de rate-limit em forma de UUID. A RPC `check_rate_limit` recebe
 * `p_user_id uuid`: mandar `ip:1.2.3.4` ali dava 22P02 → 400 → o
 * `checkRateLimit` liberava em silêncio, e NENHUM limite por IP valia
 * (auditoria de 2026-09-11). UUID de verdade passa intacto (bucket por
 * usuário continua legível no banco); o resto vira um UUID determinístico
 * derivado do SHA-256 da chave (formato v4/v5-like, só pra passar no
 * cast).
 */
export async function chaveDeRateLimit(chave: string): Promise<string> {
  if (ehUuid(chave)) return chave.toLowerCase();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(chave)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // "versão" 5: marca que é derivado, não sorteado
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * URL de mídia devolvida por terceiro (Meta/Dualhook): só https, só host
 * da lista. O Bearer NUNCA vai pra host fora da lista — mandar a chave do
 * Dualhook pra qualquer URL que apareça num JSON é entregar a credencial.
 */
export const HOSTS_DE_MIDIA_WHATSAPP = [
  'api.dualhook.com',
  'dualhook.com',
  'lookaside.fbsbx.com',
  'fbsbx.com',
  'fbcdn.net',
  'facebook.com',
  'whatsapp.net',
  'whatsapp.com',
];

export function hostPermitido(url: string, hosts: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  return hosts.some((d) => h === d || h.endsWith('.' + d));
}

// lib/api/_services/whatsapp-evo.ts — o que sobrou do cliente do Evolution
// API (WhatsApp não-oficial via Baileys, self-hosted no Render) depois da
// migração pra Cloud API/Dualhook (2026-09-05, ver CLAUDE.md).
//
// O restante do arquivo (config, sendText, parse do webhook MESSAGES_UPSERT,
// sonda de estado da instância) foi removido em 2026-09-17 (limpeza de
// código morto pós-auditoria de webhooks): zero call site fora deste
// arquivo e dos próprios testes havia meses — as envs `EVOLUTION_*` não
// existem mais no Cloudflare Pages. Quem precisar do cliente completo, está
// no histórico do git (`git log -- lib/api/_services/whatsapp-evo.ts`).
//
// `normalizeWhatsAppTarget` sobrevive porque é a regra de normalização de
// telefone usada pelo envio via Cloud API (`whatsapp.ts`,
// `app/api/whatsapp/send/route.ts`) — não é específica da Evolution, só
// nasceu aqui.

/**
 * Resolve o número de destino do WhatsApp SEM assumir que todo mundo é do
 * Brasil.
 *
 * Bug que isso corrige (2026-08-28): o envio usava `normalizeBrPhone`, que
 * colava '55' em qualquer número de 10-11 dígitos. Um contato dos EUA
 * (`16503154274` = +1 650 315-4274) virava `5516503154274` — número
 * inexistente. Isso causava falhas silenciosas/penduradas no envio: era a
 * origem do "502 Bad gateway" no envio, com o diagnóstico do edge todo
 * verde.
 *
 * Regras (em ordem):
 *   - já com DDI 55 e 12-13 dígitos → Brasil, passa direto;
 *   - 10 dígitos (DDD + fixo) → Brasil local, ganha o 55;
 *   - 11 dígitos com 9 no 3º dígito (DDD + celular) → Brasil local, ganha 55;
 *   - 11-15 dígitos em qualquer outro formato → JÁ tem DDI de outro país
 *     (EUA, Portugal…), passa VERBATIM;
 *   - resto → inválido.
 */
export function normalizeWhatsAppTarget(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10) return `55${digits}`;
  if (digits.length === 11 && digits[2] === '9') return `55${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits; // DDI estrangeiro
  return null;
}

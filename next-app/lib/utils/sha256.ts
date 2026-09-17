// lib/utils/sha256.ts — SHA-256 de arquivo, client-safe (usa crypto.subtle,
// disponível em browser e edge runtime).
//
// Extraído de posts.ts (Wave 29/C4, hash de mídia de post) pra ser
// reaproveitado por qualquer upload de mídia do usuário — avatar e
// art-references (2026-09-17, extensão da auditoria de negócio: o gate de
// hash-blocklist CSAM só cobria posts.media_hash, não avatar_url nem
// art_references.image_url).
//
// Fica em lib/utils/ (não lib/api/) de propósito: lib/api/mediaHash.ts
// importa lib/api/security.ts no topo (getServiceKey/getSupabaseUrl), que
// puxa `next/server` — seguro no edge, arriscado num bundle de client
// component. Este arquivo não importa nada além de crypto.subtle.

/**
 * SHA-256 do binário do arquivo, hex minúsculo (64 chars). String vazia se
 * `crypto.subtle` está indisponível, a leitura falha ou o arquivo é vazio —
 * nunca lança (caller decide o que fazer com hash vazio; normalmente:
 * "não calculei", não "arquivo inválido").
 */
export async function sha256Hex(file: File | Blob): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    return '';
  }
  if (buf.byteLength === 0) return '';
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const h = bytes[i].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;
  } catch {
    return '';
  }
}

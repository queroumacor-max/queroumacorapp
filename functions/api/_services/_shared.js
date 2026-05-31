// @ts-check
// Helpers compartilhados entre services. Sem Request/Response — funções
// puras pra reuso (image→base64 chunked, etc.). Cresce conforme padrões
// duplicados aparecerem entre _services/*.

/**
 * Converte ArrayBuffer pra base64. Chunked pra evitar estouro do call stack
 * em imagens grandes (apply é limitado a ~65k argumentos).
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/**
 * Lê uma File/Blob de imagem e devolve `data:<mime>;base64,...`.
 * Throws Error em caso de leitura falha (controller/service decide como tratar).
 * @param {File|Blob} image
 * @returns {Promise<string>}
 */
export async function imageToDataUrl(image) {
  const buf = await image.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const mime = (image.type && /^image\//.test(image.type)) ? image.type.split(';')[0] : 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}

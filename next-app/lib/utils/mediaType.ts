// mediaType — o MIME do arquivo quando o Android NÃO manda MIME nenhum.
//
// Motivo (2026-09-01): trocar a foto de perfil no app instalado morria com
// "Selecione um arquivo de imagem" — a validação `file.type.startsWith
// ('image/')` recusando uma foto que era, obviamente, uma foto.
//
// O seletor do wrapper (WebIntoApp) não é a galeria do sistema: é um
// diálogo próprio, "Files Chooser", com Camera × Files. O ramo "Files"
// abre o gerenciador de arquivos, e o `File` que volta de lá muitas vezes
// chega com `type` VAZIO ou `application/octet-stream` — o content://
// provider não declarou o tipo. Pelo Chrome o mesmo arquivo vem
// `image/jpeg`, e é por isso que "no navegador funciona".
//
// Consertar só a mensagem não bastaria: o bucket `posts` (e o `avatars`)
// tem `allowed_mime_types`, então subir com octet-stream seria RECUSADO
// pelo Storage. Por isso aqui não se decide só "é imagem?" — também se
// devolve o arquivo com o `type` CORRIGIDO, pra que o upload declare o
// content type certo.
//
// Ordem de confiança: o `type` do arquivo quando ele é específico; senão a
// extensão do nome. Nunca o contrário — quem manda `image/png` num arquivo
// `.jpg` sabe mais que a gente sobre o conteúdo.

/** Extensões que o app aceita, mapeadas pro MIME que o Storage espera. */
const MIME_POR_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  // SVG de propósito FORA daqui (pentest final, 2026-09-18; mesmo achado
  // reconfirmado pela auditoria de release-gate no mesmo dia): é o único
  // formato de "imagem" que carrega <script> executável — servido direto
  // (avatar/post/logo/art-reference são sempre URL pública, nunca só
  // <img>) abre stored XSS se algum dia um bucket for reconfigurado pra
  // aceitar o MIME. Nenhuma feature do app pede SVG de propósito; cai no
  // "não dá pra deduzir" (mimeConfiavel devolve '') e é recusado com
  // prova (`ehImagem`/`ehVideo` = false), igual qualquer não-mídia.
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/mp4',
  '3gp': 'video/3gpp',
  // Áudio: o chat aceita, e sem isto um .m4a sem MIME viraria "desconhecido".
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  // NÃO-mídia. Estão aqui de propósito: com o tipo conhecido dá pra recusar
  // COM PROVA ("esse arquivo não é imagem") em vez de recusar por falta de
  // informação — e o certificado em PDF da tela de Formação passa a subir
  // com o content type certo em vez de ser etiquetado image/jpeg.
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
};

/**
 * Tipos que NÃO dizem nada sobre o conteúdo. `application/octet-stream` é o
 * "não sei" do Android; string vazia é o mesmo, só que mais honesto.
 */
function tipoInutil(tipo: string): boolean {
  return (
    !tipo ||
    tipo === 'application/octet-stream' ||
    tipo === 'application/unknown' ||
    tipo === 'binary/octet-stream' ||
    tipo === '*/*'
  );
}

/** Extensão em minúsculas, sem ponto. '' quando o nome não tem. */
export function extensaoDe(nome: string | null | undefined): string {
  if (!nome) return '';
  const partes = nome.split('.');
  if (partes.length < 2) return '';
  return (partes.pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * MIME que NUNCA é aceito, mesmo declarado explicitamente pelo browser
 * (que marca `file.type='image/svg+xml'` sozinho pra um .svg de verdade —
 * remover só do `MIME_POR_EXT` não bastava, porque esse branch confia no
 * tipo DECLARADO antes de olhar a extensão). SVG carrega `<script>`
 * executável; servido como imagem pública (avatar/post/logo/art-
 * reference sempre têm URL própria) é stored XSS na cara. Pentest final,
 * 2026-09-18.
 */
const MIME_PROIBIDO = new Set(['image/svg+xml', 'image/svg']);

/**
 * O MIME em que dá pra confiar. Devolve '' quando nem o arquivo nem a
 * extensão dizem o que é — aí é caso de recusar mesmo.
 */
export function mimeConfiavel(file: File | null | undefined): string {
  if (!file) return '';
  const tipo = (file.type || '').toLowerCase().trim();
  if (!tipoInutil(tipo)) return MIME_PROIBIDO.has(tipo) ? '' : tipo;
  const porExt = MIME_POR_EXT[extensaoDe(file.name)] || '';
  return MIME_PROIBIDO.has(porExt) ? '' : porExt;
}

/** É imagem? Aceita o arquivo sem MIME cujo NOME diz que é imagem.
 *  SVG nunca conta como imagem aqui — pode carregar script (ver nota em
 *  MIME_POR_EXT); mesmo que o navegador declare `file.type==='image/svg+xml'`
 *  de verdade (ex.: usuário escolheu um .svg de propósito), recusamos. */
export function ehImagem(file: File | null | undefined): boolean {
  const tipo = mimeConfiavel(file);
  return tipo.startsWith('image/') && tipo !== 'image/svg+xml';
}

/** É vídeo? Mesma regra. */
export function ehVideo(file: File | null | undefined): boolean {
  return mimeConfiavel(file).startsWith('video/');
}

/**
 * O mesmo arquivo, com o `type` corrigido quando ele veio vazio/genérico.
 *
 * Devolve o arquivo ORIGINAL quando já tem tipo bom ou quando não dá pra
 * deduzir nada — nunca inventa um tipo, e nunca cria uma cópia à toa (o
 * `new File` copia a referência do blob, mas trocar a identidade do objeto
 * à toa complica comparação de estado nas telas).
 */
export function comMimeCorrigido(file: File): File {
  const bom = mimeConfiavel(file);
  if (!bom || file.type === bom) return file;
  try {
    return new File([file], file.name, {
      type: bom,
      lastModified: file.lastModified,
    });
  } catch {
    // Ambiente sem construtor de File (WebView muito antiga): melhor o
    // arquivo original que exceção na cara de quem só queria trocar a foto.
    return file;
  }
}

// ─── Último recurso: os BYTES ───────────────────────────────────────────────
//
// Quando o Android não declara o tipo E o nome não tem extensão (alguns
// content providers devolvem "image" ou um id puro), nem `file.type` nem o
// nome ajudam. Aí sobra o único informante que não mente: o começo do
// arquivo. É isso que torna a decisão definitiva em vez de provável.

/** Assinaturas de arquivo (magic numbers) que o app precisa reconhecer. */
const ASSINATURAS: Array<{ mime: string; offset: number; bytes: number[] }> = [
  { mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', offset: 0, bytes: [0x42, 0x4d] },
  // RIFF....WEBP — o tamanho fica nos 4 bytes do meio, por isso só o 'WEBP'.
  { mime: 'image/webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  // Não-imagens que vale reconhecer: com elas dá pra RECUSAR com prova, em
  // vez de recusar por falta de informação (ver `provadoNaoImagem`).
  { mime: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'application/zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
];

/**
 * Contêineres ISO-BMFF: todos começam com `ftyp` no offset 4 e só se
 * distinguem pela MARCA nos 4 bytes seguintes. Sem isso, uma foto HEIC do
 * iPhone e um vídeo MP4 teriam a mesma assinatura.
 */
const MARCAS_ISOBMFF: Record<string, string> = {
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  mif1: 'image/heif',
  msf1: 'image/heif',
  qt: 'video/quicktime',
  isom: 'video/mp4',
  iso2: 'video/mp4',
  mp41: 'video/mp4',
  mp42: 'video/mp4',
  avc1: 'video/mp4',
};

function casa(buf: Uint8Array, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * O MIME lido do CONTEÚDO. Devolve '' quando não reconhece — nunca chuta.
 *
 * Lê só os 16 primeiros bytes: é o suficiente pra toda assinatura acima e
 * não custa nada nem num vídeo de 50MB.
 */
export async function mimePorConteudo(file: File): Promise<string> {
  try {
    const buf = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    for (const a of ASSINATURAS) {
      if (casa(buf, a.offset, a.bytes)) return a.mime;
    }
    // ISO-BMFF: 'ftyp' no offset 4, marca no 8.
    if (casa(buf, 4, [0x66, 0x74, 0x79, 0x70])) {
      const marca = String.fromCharCode(...buf.slice(8, 12))
        .toLowerCase()
        .trim();
      return MARCAS_ISOBMFF[marca] || 'video/mp4';
    }
    return '';
  } catch {
    // Blob ilegível (arquivo removido do provider entre a escolha e o uso):
    // melhor seguir sem palpite que estourar na cara de quem só quer postar.
    return '';
  }
}

/**
 * A resposta final sobre o que é este arquivo, na ordem de confiança:
 * tipo declarado → extensão do nome → bytes.
 */
export async function mimeDefinitivo(file: File): Promise<string> {
  return mimeConfiavel(file) || (await mimePorConteudo(file));
}

/**
 * O arquivo pronto pra validar e subir: mesmo conteúdo, com o `type` que
 * ele realmente tem. Use ANTES de `ehImagem`/`ehVideo` em qualquer caminho
 * que aceite arquivo escolhido pela pessoa.
 */
export async function normalizarArquivo(file: File): Promise<File> {
  const bom = await mimeDefinitivo(file);
  if (!bom || file.type === bom) return file;
  try {
    return new File([file], file.name, { type: bom, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/**
 * Depois de `normalizarArquivo`: temos PROVA de que isto não é imagem?
 *
 * A diferença entre "não provei que é imagem" e "provei que NÃO é" decide
 * quem fica de fora. Até 2026-09-01 as telas usavam a primeira regra e
 * recusavam a foto sempre que o Android não dizia o tipo — quer dizer,
 * puniam a pessoa pela omissão do sistema operacional. A regra certa é a
 * segunda: com `accept="image/*"` no input, o arquivo desconhecido segue e
 * quem dá a palavra final é o Storage (que valida de verdade). Recusar
 * aqui só quando o tipo é conhecido E não é imagem.
 *
 * Espelha a decisão já tomada em `posts.uploadMedia`, onde o fallback
 * `image/jpeg` existe pelo mesmo motivo.
 */
export function provadoNaoImagem(file: File): boolean {
  const tipo = (file.type || '').toLowerCase().trim();
  // SVG É EXCEÇÃO à regra "startsWith('image/') passa": o navegador marca
  // um .svg de verdade com esse tipo sozinho (não depende de extensão nem
  // de content-sniffing), então "não provei que não é imagem" seria
  // literalmente falso aqui — SVG É conhecido, e o app não aceita SVG em
  // lugar nenhum (script executável servido como avatar/logo público).
  // Pentest final, 2026-09-18.
  if (MIME_PROIBIDO.has(tipo)) return true;
  return !!tipo && !tipo.startsWith('image/');
}

/**
 * Descrição curta do arquivo pra mensagem de erro e telemetria. Sem isto,
 * "não é imagem" é indistinguível de "o app está desatualizado" — foi
 * exatamente o que aconteceu em 01/09: a mensagem antiga e a nova eram a
 * mesma frase, e não deu pra saber qual código estava rodando no aparelho.
 */
export function descreverArquivo(file: File | null | undefined): string {
  if (!file) return 'arquivo ausente';
  return `nome=${file.name || '(sem nome)'} tipo=${file.type || '(vazio)'} bytes=${file.size}`;
}

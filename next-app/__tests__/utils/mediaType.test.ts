// O caso real (2026-09-01): o "Files Chooser" do WebIntoApp devolve a foto
// com `type` VAZIO, e a validação `startsWith('image/')` recusava uma foto
// de verdade — "Selecione um arquivo de imagem" na cara de quem selecionou
// exatamente isso. Estes testes travam a regra: quando o Android não diz o
// tipo, quem decide é a extensão; e o upload tem que sair com o MIME certo,
// senão o `allowed_mime_types` do bucket recusa.

import { describe, it, expect } from 'vitest';
import {
  comMimeCorrigido,
  ehImagem,
  ehVideo,
  extensaoDe,
  mimeConfiavel,
} from '@/lib/utils/mediaType';

function arquivo(nome: string, tipo: string): File {
  return new File([new Uint8Array([1, 2, 3])], nome, { type: tipo });
}

describe('mimeConfiavel', () => {
  it('confia no tipo quando ele é específico', () => {
    expect(mimeConfiavel(arquivo('x.jpg', 'image/png'))).toBe('image/png');
  });

  it('cai na extensão quando o Android não manda tipo', () => {
    expect(mimeConfiavel(arquivo('foto.jpg', ''))).toBe('image/jpeg');
    expect(mimeConfiavel(arquivo('FOTO.JPEG', ''))).toBe('image/jpeg');
    expect(mimeConfiavel(arquivo('parede.PNG', ''))).toBe('image/png');
  });

  it('trata octet-stream como "não sei", não como tipo', () => {
    expect(mimeConfiavel(arquivo('foto.jpg', 'application/octet-stream'))).toBe(
      'image/jpeg',
    );
  });

  it('devolve vazio quando nada identifica o arquivo', () => {
    expect(mimeConfiavel(arquivo('semextensao', ''))).toBe('');
    expect(mimeConfiavel(arquivo('arquivo.xyz', ''))).toBe('');
  });

  // Extensão de NÃO-mídia também é resposta: serve pra recusar com prova
  // (ver provadoNaoImagem) e pro certificado em PDF subir com o tipo certo.
  it('reconhece não-mídia pela extensão em vez de dar de ombros', () => {
    expect(mimeConfiavel(arquivo('contrato.pdf', ''))).toBe('application/pdf');
    expect(mimeConfiavel(arquivo('planilha.csv', ''))).toBe('text/csv');
  });
});

describe('ehImagem / ehVideo', () => {
  it('aceita a foto que veio sem MIME do seletor do wrapper', () => {
    expect(ehImagem(arquivo('IMG_20260901_114900.jpg', ''))).toBe(true);
    expect(ehImagem(arquivo('captura.heic', ''))).toBe(true);
  });

  it('continua recusando o que não é imagem', () => {
    expect(ehImagem(arquivo('planilha.csv', 'text/csv'))).toBe(false);
    expect(ehImagem(arquivo('doc.pdf', 'application/pdf'))).toBe(false);
    expect(ehImagem(arquivo('qualquer', ''))).toBe(false);
  });

  it('separa vídeo de imagem mesmo sem MIME', () => {
    expect(ehVideo(arquivo('obra.mp4', ''))).toBe(true);
    expect(ehVideo(arquivo('obra.mov', ''))).toBe(true);
    expect(ehImagem(arquivo('obra.mp4', ''))).toBe(false);
  });

  it('nulo não é imagem nem vídeo', () => {
    expect(ehImagem(null)).toBe(false);
    expect(ehVideo(undefined)).toBe(false);
  });

  // Pentest final (2026-09-18): SVG carrega <script> executável — servir
  // um avatar/post/logo como image/svg+xml de propósito abre stored XSS
  // se alguém navegar direto pra URL pública. `ehImagem` nunca pode
  // classificar .svg como imagem — nem pela extensão (Android sem MIME),
  // nem pelo tipo que o PRÓPRIO NAVEGADOR declara sozinho pra um .svg de
  // verdade (esse é o caminho real, não só o de fallback do Android).
  it('NUNCA trata .svg como imagem, nem por extensão nem por tipo declarado', () => {
    expect(mimeConfiavel(arquivo('logo.svg', ''))).toBe('');
    expect(ehImagem(arquivo('logo.svg', ''))).toBe(false);
    expect(mimeConfiavel(arquivo('avatar.svg', 'image/svg+xml'))).toBe('');
    expect(ehImagem(arquivo('avatar.svg', 'image/svg+xml'))).toBe(false);
  });
});

describe('comMimeCorrigido', () => {
  it('corrige o tipo vazio — sem isso o bucket recusa o upload', () => {
    const corrigido = comMimeCorrigido(arquivo('foto.jpg', ''));
    expect(corrigido.type).toBe('image/jpeg');
    expect(corrigido.name).toBe('foto.jpg');
  });

  it('não mexe no arquivo que já tem tipo bom', () => {
    const orig = arquivo('foto.png', 'image/png');
    expect(comMimeCorrigido(orig)).toBe(orig);
  });

  it('não inventa tipo pro que não dá pra deduzir', () => {
    const orig = arquivo('semextensao', '');
    expect(comMimeCorrigido(orig)).toBe(orig);
  });
});

describe('extensaoDe', () => {
  it('normaliza e ignora nome sem ponto', () => {
    expect(extensaoDe('a/b/foto.JPG')).toBe('jpg');
    expect(extensaoDe('semponto')).toBe('');
    expect(extensaoDe(null)).toBe('');
  });
});

// ─── Último recurso: os bytes ──────────────────────────────────────────────
//
// O caso que a extensão não cobre: alguns content providers do Android
// devolvem o arquivo SEM tipo E com nome sem extensão ("image", um id puro).
// Aí o único informante que não mente é o começo do arquivo.

import {
  descreverArquivo,
  mimeDefinitivo,
  mimePorConteudo,
  normalizarArquivo,
  provadoNaoImagem,
} from '@/lib/utils/mediaType';

function comBytes(nome: string, tipo: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo });
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0];
// RIFF <4 bytes de tamanho> WEBP
const WEBP = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0];
// ....ftyp<marca>
const isobmff = (marca: string) => [
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70,
  ...marca.split('').map((c) => c.charCodeAt(0)),
  0, 0, 0, 0,
];

describe('mimePorConteudo', () => {
  it('reconhece JPEG, PNG e WebP pelos bytes', async () => {
    expect(await mimePorConteudo(comBytes('x', '', JPEG))).toBe('image/jpeg');
    expect(await mimePorConteudo(comBytes('x', '', PNG))).toBe('image/png');
    expect(await mimePorConteudo(comBytes('x', '', WEBP))).toBe('image/webp');
  });

  it('separa HEIC de MP4 pela MARCA — os dois começam com ftyp', async () => {
    expect(await mimePorConteudo(comBytes('x', '', isobmff('heic')))).toBe('image/heic');
    expect(await mimePorConteudo(comBytes('x', '', isobmff('mif1')))).toBe('image/heif');
    expect(await mimePorConteudo(comBytes('x', '', isobmff('isom')))).toBe('video/mp4');
  });

  it('não chuta quando não reconhece', async () => {
    expect(await mimePorConteudo(comBytes('x', '', [1, 2, 3, 4, 5, 6, 7, 8]))).toBe('');
  });
});

describe('mimeDefinitivo / normalizarArquivo', () => {
  it('o caso que a extensão NÃO cobre: sem tipo e sem extensão', async () => {
    const f = comBytes('1000012345', '', PNG);
    expect(mimeConfiavel(f)).toBe(''); // nem tipo nem nome ajudam
    expect(await mimeDefinitivo(f)).toBe('image/png'); // os bytes ajudam
    expect(ehImagem(await normalizarArquivo(f))).toBe(true);
  });

  it('a extensão vence os bytes só quando o tipo declarado falta', async () => {
    // nome diz .png, conteúdo é jpeg: confiamos no nome (ordem documentada)
    const f = comBytes('foto.png', '', JPEG);
    expect(await mimeDefinitivo(f)).toBe('image/png');
  });

  it('tipo declarado continua no topo da ordem', async () => {
    const f = comBytes('foto.png', 'image/webp', JPEG);
    expect(await mimeDefinitivo(f)).toBe('image/webp');
  });

  it('não promove a imagem o arquivo que não é imagem', async () => {
    const f = comBytes('coisa', '', [0x25, 0x50, 0x44, 0x46]); // %PDF
    expect(ehImagem(await normalizarArquivo(f))).toBe(false);
  });
});

// A regra que decide quem fica de fora. "Não provei que é imagem" NÃO pode
// recusar — foi assim que a troca de foto ficou travada no app, punindo a
// pessoa por uma omissão do Android. Só recusa com prova.
describe('provadoNaoImagem', () => {
  it('deixa passar o arquivo que ninguém conseguiu identificar', async () => {
    const f = comBytes('1000012345', '', [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(provadoNaoImagem(await normalizarArquivo(f))).toBe(false);
  });

  it('recusa o que TEM prova de não ser imagem', async () => {
    const pdf = comBytes('coisa', '', [0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]);
    expect(provadoNaoImagem(await normalizarArquivo(pdf))).toBe(true);
    expect(provadoNaoImagem(comBytes('x.pdf', 'application/pdf', []))).toBe(true);
  });

  it('não recusa imagem identificada por qualquer um dos três degraus', async () => {
    expect(provadoNaoImagem(comBytes('a.png', 'image/png', []))).toBe(false);
    expect(provadoNaoImagem(await normalizarArquivo(comBytes('a.png', '', [])))).toBe(false);
    expect(
      provadoNaoImagem(await normalizarArquivo(comBytes('semnome', '', PNG))),
    ).toBe(false);
  });

  // Pentest final (2026-09-18): SVG é o único caso onde "startsWith
  // ('image/')" mente — o próprio navegador declara file.type=
  // 'image/svg+xml' pra um .svg de verdade, e essa regra sozinha deixaria
  // passar exatamente o formato que carrega <script>. uploadAvatar/
  // uploadArtReference/aiLogo usam ESTA função como o único portão.
  it('recusa SVG mesmo com type declarado começando com "image/"', () => {
    expect(provadoNaoImagem(arquivo('avatar.svg', 'image/svg+xml'))).toBe(true);
  });
});

describe('descreverArquivo', () => {
  it('mostra o que foi detectado — sem isso "não é imagem" vira adivinhação', () => {
    const d = descreverArquivo(comBytes('foto.jpg', '', [1, 2, 3]));
    expect(d).toContain('nome=foto.jpg');
    expect(d).toContain('tipo=(vazio)');
    expect(d).toContain('bytes=3');
  });
});

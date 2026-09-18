// whatsapp-media — o que decide onde o arquivo vai parar e se ele é
// reconhecido. Nada aqui fala com a rede: o risco real é gravar o
// arquivo errado, com extensão errada, ou duplicar em cada reentrega do
// webhook.
import { describe, expect, it } from 'vitest';
import {
  caminhoMidia,
  extensaoDe,
  mimeBase,
} from '../../lib/api/_services/whatsapp-media';

describe('mimeBase', () => {
  it('descarta os parâmetros que o WhatsApp manda colados', () => {
    expect(mimeBase('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(mimeBase('IMAGE/JPEG')).toBe('image/jpeg');
    expect(mimeBase('')).toBe('');
  });
});

describe('extensaoDe', () => {
  it('reconhece os tipos que chegam do WhatsApp', () => {
    expect(extensaoDe('audio/ogg; codecs=opus')).toBe('ogg');
    expect(extensaoDe('image/jpeg')).toBe('jpg');
    expect(extensaoDe('video/mp4')).toBe('mp4');
    expect(extensaoDe('application/pdf')).toBe('pdf');
  });
  it('sem mime, chuta pelo tipo da mensagem', () => {
    expect(extensaoDe('', 'image')).toBe('jpg');
    expect(extensaoDe('application/octet-stream', 'audio')).toBe('ogg');
  });
  it('desconhecido não inventa extensão', () => {
    expect(extensaoDe('application/x-sei-la')).toBe('bin');
  });
});

describe('caminhoMidia', () => {
  it('agrupa por número e nomeia pelo id da mensagem', () => {
    expect(caminhoMidia('5511988271552', '3EB0C7AB', 'audio/ogg')).toBe(
      '5511988271552/3EB0C7AB.ogg',
    );
  });

  it('MESMO caminho pro mesmo id — reentrega do webhook sobrescreve, não duplica', () => {
    const a = caminhoMidia('5511988271552', '3EB0C7AB', 'audio/ogg; codecs=opus');
    const b = caminhoMidia('55 11 98827-1552', '3EB0C7AB', 'audio/ogg');
    expect(a).toBe(b);
  });

  it('limpa o que não pode virar caminho', () => {
    const p = caminhoMidia('+55 (11) 98827-1552', 'ab/../cd?x=1', 'image/png');
    expect(p).toBe('5511988271552/abcdx1.png');
    expect(p).not.toContain('..');
  });
});

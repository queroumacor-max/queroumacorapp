// Tests de lib/utils/richText.tsx — apenas extractHashtags (função pura,
// sem JSX). renderRichText precisaria de JSX runtime no vitest e o ganho
// não compensa: o boundary é o mesmo regex testado aqui, e o strip de
// pontuação trailing em URLs é inspeção visual simples no app.
//
// extractHashtags é função órfã hoje (sem caller) — testes travam o
// comportamento esperado pra quando alguém usar pra search index, dedup
// ou suggested hashtags.

import { describe, it, expect } from 'vitest';
import { extractHashtags } from '../../lib/utils/richText';

describe('extractHashtags — boundary', () => {
  it('extrai hashtag no começo do texto', () => {
    expect(extractHashtags('#pintura branca')).toEqual(['pintura']);
  });

  it('extrai hashtag precedida por espaço', () => {
    expect(extractHashtags('parede #pintura branca')).toEqual(['pintura']);
  });

  it('extrai hashtag precedida por quebra de linha', () => {
    expect(extractHashtags('linha um\n#pintura')).toEqual(['pintura']);
  });

  it('NÃO extrai hashtag colada em palavra (E1 boundary)', () => {
    // "foo#bar" não é hashtag — é fragmento de URL ou código.
    expect(extractHashtags('foo#bar')).toEqual([]);
  });

  it('extrai múltiplas hashtags únicas', () => {
    expect(extractHashtags('#pintura #grafiato #pintura')).toEqual([
      'pintura',
      'grafiato',
    ]);
  });

  it('normaliza pra lowercase', () => {
    expect(extractHashtags('#PiNtUrA')).toEqual(['pintura']);
  });

  it('para no primeiro char não-permitido (pontuação)', () => {
    expect(extractHashtags('#pintura. e #grafiato!')).toEqual([
      'pintura',
      'grafiato',
    ]);
  });

  it('aceita letras unicode (acentos)', () => {
    expect(extractHashtags('#decoração #pintura')).toEqual([
      'decoração',
      'pintura',
    ]);
  });

  it('retorna [] pra texto vazio/null/undefined', () => {
    expect(extractHashtags('')).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
    expect(extractHashtags(undefined)).toEqual([]);
  });
});

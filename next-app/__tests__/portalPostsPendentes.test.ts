import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../public/portal/app.jsx'), 'utf8');

function helpers() {
  const ini = src.indexOf('// [teste:posts-midias-inicio]');
  const fim = src.indexOf('// [teste:posts-midias-fim]');
  if (ini < 0 || fim < 0) throw new Error('marcadores [teste:posts-midias-*] sumiram do app.jsx');
  const trecho = src.slice(ini, fim);
  return new Function(`${trecho}; return { midiasDoPost, ehVideoDoPost };`)() as {
    midiasDoPost: (p: unknown) => string[];
    ehVideoDoPost: (u: string, t?: string) => boolean;
  };
}

describe('portal: Posts pendentes', () => {
  it('a tela está no menu, com badge', () => {
    expect(src).toMatch(/id:'posts-pendentes'[^\n]*badgeKey:'postsPendentes'[^\n]*<PostsModeracao \/>/);
    expect(src).toMatch(/postsPendentes: pendRes\.count/);
  });

  it('mostra TODAS as fotos do carrossel, sem repetir a 1ª', () => {
    const { midiasDoPost } = helpers();
    expect(midiasDoPost({ media_url: 'a', media_urls: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
    expect(midiasDoPost({ media_url: 'x', media_urls: ['b'] })).toEqual(['x', 'b']);
    expect(midiasDoPost({ media_url: 'a' })).toEqual(['a']);
    expect(midiasDoPost({})).toEqual([]);
  });

  it('reconhece vídeo por tipo ou extensão', () => {
    const { ehVideoDoPost } = helpers();
    expect(ehVideoDoPost('https://x/y.mp4')).toBe(true);
    expect(ehVideoDoPost('https://x/y.MOV?t=1')).toBe(true);
    expect(ehVideoDoPost('https://x/y', 'video')).toBe(true);
    expect(ehVideoDoPost('https://x/y.jpg')).toBe(false);
  });

  it('esconde post apagado e confere a linha ao aprovar', () => {
    const tela = src.slice(src.indexOf('const PostsModeracao'), src.indexOf('const AvaliacoesList'));
    expect(tela).toMatch(/\.is\('deleted_at', null\)/);
    expect(tela).not.toMatch(/profiles!user_id/);
    expect(src).toMatch(/update\(\{status\}\)\.eq\('id', id\)\.select\('id'\)/);
  });
});

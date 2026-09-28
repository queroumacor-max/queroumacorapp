// Tela "Posts pendentes" do portal: existia desde a moderação no servidor
// (2026-09-26) mas nunca entrou no menu — post preso só se via pelo SQL
// Editor. E, se entrasse como estava, quebraria: o embed `profiles!user_id`
// não existe (posts.user_id aponta pra auth.users, não pra profiles).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', 'public', 'portal', 'app.jsx'), 'utf8');
const tela = src.slice(src.indexOf('const PostsModeracao = () => {'), src.indexOf('const AvaliacoesList = () => {'));

describe('portal — Posts pendentes', () => {
  it('está no menu, com badge', () => {
    expect(src).toMatch(/id:'posts-pendentes'[^\n]*badgeKey:'postsPendentes'[^\n]*<PostsModeracao \/>/);
  });

  it('não usa o embed profiles!user_id (FK aponta pra auth.users)', () => {
    expect(tela).not.toContain('profiles!user_id');
  });

  it('pendente apagado pelo próprio app não aparece como decisão pendente', () => {
    expect(tela).toMatch(/eq\('status','pending'\)\.is\('deleted_at', null\)/);
  });

  it('aprovar/rejeitar confere que alguma linha mudou', () => {
    expect(src).toMatch(/setStatus: async[\s\S]{0,200}\.select\('id'\)[\s\S]{0,200}length === 0/);
  });
});

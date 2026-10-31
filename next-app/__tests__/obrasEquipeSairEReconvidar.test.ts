// Relato do Fabio (2026-10-31): "disse que já tá na equipe, mas não" e
// "se você me chama pra sua equipe, como eu saio depois?".
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const svc = readFileSync(join(__dirname, '../lib/services/obras.ts'), 'utf8');
const agenda = readFileSync(join(__dirname, '../app/obras/MinhaAgenda.tsx'), 'utf8');
const sql = readFileSync(join(__dirname, '../../migrations/2026-10-31-minhas-equipes-obras.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('convite repetido não mente', () => {
  it('23505 vai pro reconvidar em vez da frase fixa', () => {
    expect(svc).toMatch(/23505'\) return reconvidar\(/);
  });
  it('quem saiu/recusou volta a convidado; convidado avisa que falta aceitar', () => {
    expect(svc).toMatch(/status: 'convidado'/);
    expect(svc).toMatch(/Falta ela aceitar/);
  });
});

describe('funcionário consegue sair da equipe', () => {
  it('a agenda lista as equipes e chama sairDaEquipe com confirmação', () => {
    expect(agenda).toMatch(/minhasEquipes/);
    expect(agenda).toMatch(/sairDaEquipe\(id\)/);
    expect(agenda).toMatch(/dialog\.confirm\(/);
  });
  it('RPC só devolve as equipes ATIVAS do próprio usuário, sem diária/telefone, sem anon', () => {
    expect(sql).toMatch(/e\.membro_id = \(SELECT auth\.uid\(\)\) AND e\.status = 'ativo'/);
    expect(sql).not.toMatch(/diaria|telefone/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.minhas_equipes_obras\(\) FROM PUBLIC, anon/);
  });
  it('SQL ausente esconde a seção em vez de mostrar erro', () => {
    expect(svc).toMatch(/\['42883', 'PGRST202'\]\.includes\(error\.code \?\? ''\)\) return null/);
  });
});

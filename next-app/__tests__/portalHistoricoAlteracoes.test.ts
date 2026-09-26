// Histórico de alterações do portal (2026-09-26). Extrai as funções puras
// do app.jsx pelos marcadores e trava a tela no menu.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fonte = readFileSync(join(__dirname, '..', 'public', 'portal', 'app.jsx'), 'utf8');

function extrair() {
  const ini = fonte.indexOf('// [teste:auditoria-inicio]');
  const fim = fonte.indexOf('// [teste:auditoria-fim]');
  if (ini < 0 || fim < 0) throw new Error('marcadores [teste:auditoria-*] sumiram do app.jsx');
  const trecho = fonte.slice(ini, fim);
  // eslint-disable-next-line no-new-func
  return new Function(`${trecho}; return { resumoDaMudanca, AUDIT_TABELAS };`)() as {
    resumoDaMudanca: (a: string, c: unknown, max?: number) => string[];
    AUDIT_TABELAS: Record<string, string>;
  };
}

describe('portal: histórico de alterações', () => {
  const { resumoDaMudanca, AUDIT_TABELAS } = extrair();

  it('update mostra cada coluna old → new', () => {
    expect(
      resumoDaMudanca('portal.leads.update', { status: { old: 'novo', new: 'contactado' } }),
    ).toEqual(['status: novo → contactado']);
  });

  it('corta texto longo (o prompt da IA) no resumo', () => {
    const [linha] = resumoDaMudanca(
      'portal.whatsapp_ai_config.update',
      { prompt: { old: null, new: 'a'.repeat(500) } },
      50,
    );
    expect(linha.startsWith('prompt: ∅ → ')).toBe(true);
    expect(linha.endsWith('…')).toBe(true);
    expect(linha.length).toBeLessThan(80);
  });

  it('insert/delete mostra o nome da linha', () => {
    expect(resumoDaMudanca('portal.stores.insert', { id: 'x', name: 'Loja Nova' })).toEqual([
      'Loja Nova',
    ]);
    expect(resumoDaMudanca('portal.posts.delete', null)).toEqual([]);
  });

  it('toda tabela auditada pela migration tem rótulo na tela', () => {
    const sql = readFileSync(
      join(__dirname, '..', '..', 'migrations', '2026-09-26-portal-audit-trail.sql'),
      'utf8',
    );
    const bloco = sql.slice(sql.indexOf('FOREACH t IN ARRAY ARRAY['), sql.indexOf('] LOOP'));
    const tabelas = Array.from(bloco.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
    expect(tabelas.length).toBeGreaterThan(5);
    for (const t of tabelas) expect(AUDIT_TABELAS[t], t).toBeTruthy();
  });

  it('a tela está no menu e lê audit_log', () => {
    expect(fonte).toMatch(/id:'historico'[^\n]*component:<HistoricoAlteracoes \/>/);
    expect(fonte).toMatch(/supa\.from\('audit_log'\)/);
  });
});

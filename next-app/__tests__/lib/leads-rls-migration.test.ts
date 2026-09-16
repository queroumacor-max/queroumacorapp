// __tests__/lib/leads-rls-migration.test.ts — trava o achado CRÍTICO da
// auditoria de segurança do Supabase (2026-09-13): `public.leads` nunca
// teve RLS habilitada em nenhuma migration deste repositório.
//
// A tabela nasceu FORA do repo (não existe `CREATE TABLE public.leads` em
// lugar nenhum) e uma varredura da história inteira de SQL — base +
// 94 migrations, em ordem — não achou NENHUM `ENABLE ROW LEVEL SECURITY`,
// `CREATE POLICY` nem `GRANT`/`REVOKE` tocando essa tabela, em nenhum
// ponto. Comparado com as outras 50 tabelas criadas neste repo: todas as
// 50 passam por `ENABLE ROW LEVEL SECURITY` pelo menos uma vez. `leads`
// era a única exceção — sem RLS, qualquer usuário comum do app (não só
// admin) lê/escreve a tabela inteira (~1072 contatos de prospecção, PII)
// direto pela API REST do Supabase.
//
// Este teste não substitui rodar a migration no banco — não há acesso a
// Postgres real deste ambiente. Ele garante que a CORREÇÃO em código
// (o arquivo de migration) não desaparece/regride em silêncio: se alguém
// apagar o arquivo, ou apagar o `ENABLE ROW LEVEL SECURITY`/a policy de
// dentro dele, o teste denuncia.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), '..', 'migrations');

function readAllMigrations(): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  return files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')).join('\n');
}

describe('leads: RLS habilitada em alguma migration (auditoria 2026-09-13)', () => {
  it('existe ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY em algum arquivo', () => {
    const all = readAllMigrations();
    expect(all).toMatch(/ALTER TABLE public\.leads\s+ENABLE ROW LEVEL SECURITY/i);
  });

  it('existe uma policy pra leads restrita a is_portal_admin() (SELECT/INSERT/UPDATE/DELETE)', () => {
    const all = readAllMigrations();
    // FOR ALL cobre as 4 operações de uma vez — é o padrão usado no resto
    // do repo pra tabela back-office (commissions_admin_all, etc.).
    const policyBlock =
      /CREATE POLICY leads_admin_all ON public\.leads[\s\S]{0,300}?FOR ALL[\s\S]{0,300}?is_portal_admin\(\)[\s\S]{0,300}?is_portal_admin\(\)/i;
    expect(all).toMatch(policyBlock);
  });

  it('a migration crítica específica existe e contém a conferência (relrowsecurity)', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    expect(files).toContain('2026-09-13-leads-rls-critical.sql');
    const content = readFileSync(
      join(MIGRATIONS_DIR, '2026-09-13-leads-rls-critical.sql'),
      'utf8'
    );
    // A conferência tem que checar o estado REAL no catálogo do Postgres
    // (pg_class.relrowsecurity), não só "a policy existe" — policy pode
    // existir com RLS desligada e não valer nada.
    expect(content).toMatch(/relrowsecurity/);
    expect(content).toMatch(/pg_policies/);
  });
});

describe('leads: nenhuma outra tabela criada neste repo ficou sem RLS (regressão geral)', () => {
  it('toda tabela com CREATE TABLE público em migrations/*.sql também tem ENABLE ROW LEVEL SECURITY em algum arquivo', () => {
    const all = readAllMigrations();
    const createRe = /create table(?: if not exists)? (?:public\.)?([a-z_]+)/gi;
    const created = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(all))) created.add(m[1].toLowerCase());

    const enableRe =
      /alter table(?: if exists)? (?:public\.)?([a-z_]+)\s+enable row level security/gi;
    const enabled = new Set<string>();
    while ((m = enableRe.exec(all))) enabled.add(m[1].toLowerCase());

    const semRls = [...created].filter((t) => !enabled.has(t));
    // Documenta a lista pra debug se falhar — não é só um boolean cego.
    expect(semRls, `tabelas criadas sem ENABLE ROW LEVEL SECURITY: ${semRls.join(', ')}`).toEqual(
      []
    );
  });
});

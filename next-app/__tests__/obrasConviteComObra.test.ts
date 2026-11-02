// "Obra no convite" (2026-11-02, pedido do usuário: "acho que ele tá
// vinculando a pessoa a todas as obras quando eu chamo pra 1"). A equipe
// segue sendo do gestor; o convite agora pode dizer pra qual obra.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ler = (p: string) => readFileSync(join(__dirname, p), 'utf8');
const svc = ler('../lib/services/obras.ts');
const equipe = ler('../app/obras/EquipeTab.tsx');
const escala = ler('../app/obras/EscalaTab.tsx');
const agenda = ler('../app/obras/MinhaAgenda.tsx');
const detalhe = ler('../app/obras/ObrasTab.tsx');
const sql = ler('../../migrations/2026-11-02-convite-com-obra.sql')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('SQL da obra no convite', () => {
  it('obra apagada não apaga o membro (SET NULL)', () => {
    expect(sql).toMatch(/obra_id uuid REFERENCES public\.obras\(id\) ON DELETE SET NULL/);
  });
  it('só aceita obra do PRÓPRIO gestor, no insert e no update', () => {
    expect(sql).toMatch(/o\.owner_id = NEW\.gestor_id/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF obra_id, gestor_id ON public\.obra_equipe/);
  });
  it('convidado vê só o NOME da obra (nunca valor/endereço) e anon fica de fora', () => {
    const rpc = sql.slice(sql.indexOf('CREATE FUNCTION public.meus_convites_equipe'));
    expect(rpc).toMatch(/o\.nome FROM/);
    expect(rpc.split('$$;')[0]).not.toMatch(/valor|endereco|observacoes|diaria|telefone/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.meus_convites_equipe\(\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/e\.membro_id = \(SELECT auth\.uid\(\)\)/);
  });
  it('aviso continua sem derrubar o convite e mantém o texto antigo sem obra', () => {
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN RAISE WARNING 'notify_obra_convite/);
    expect(sql).toMatch(/te convidou pra obra/);
    expect(sql).toMatch(/te convidou pra equipe de obras dele/);
  });
});

describe('app', () => {
  it('lista da equipe tolera a coluna ausente (SQL pendente não esvazia a tela)', () => {
    expect(svc).toMatch(/colunaAusente\(error\.code\)\) \(\{ data, error \} = await consulta\(EQUIPE_COLS_BASE\)\)/);
  });
  it('escolher obra com SQL pendente AVISA, em vez de convidar pra qualquer obra calado', () => {
    expect(svc.match(/throw new ValidationError\(SEM_COLUNA_OBRA\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('convite, sem conta e reconvite levam a obra', () => {
    expect(svc.match(/linha\.obra_id = obraId/g)?.length).toBe(2);
    expect(svc).toMatch(/patch\.obra_id = obraId/);
  });
  it('formulário tem o campo e o cartão troca a obra', () => {
    expect(equipe).toMatch(/Pra qual obra \(opcional\)/);
    expect(equipe).toMatch(/obraId: f\.obra \|\| null/);
    expect(equipe).toMatch(/atualizarMembro\(uid, m\.id, \{ obra_id: novo \}\)/);
  });
  it('na Escala quem é da obra vem primeiro, sem esconder o resto', () => {
    expect(escala).toMatch(/label="Desta obra"/);
    expect(escala).toMatch(/label="Resto da equipe"/);
  });
  it('convidado e detalhe da obra mostram a obra', () => {
    expect(agenda).toMatch(/c\.obra_nome/);
    expect(detalhe).toMatch(/Equipe desta obra/);
  });
});

// Equipe da Gestão de Obras: o "×" solto virou botão com texto e a mudança
// de status é otimista (a tela muda na hora; o banco confirma por trás).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fonte = readFileSync(join(__dirname, '..', 'app', 'obras', 'EquipeTab.tsx'), 'utf8');

describe('EquipeTab — cancelar convite', () => {
  it('convite pendente tem botão "Cancelar convite", sem o × solto', () => {
    expect(fonte).toContain('Cancelar convite');
    expect(fonte).toContain('Remover da equipe');
    expect(fonte).not.toMatch(/>\s*×\s*</);
  });

  it('muda o cache antes do UPDATE e desfaz se falhar', () => {
    const corpo = fonte.slice(fonte.indexOf('async function mudar('));
    const otimista = corpo.indexOf('qc.setQueryData<MembroEquipe[]>(chave');
    const update = corpo.indexOf('await atualizarMembro(');
    expect(otimista).toBeGreaterThan(-1);
    expect(otimista).toBeLessThan(update);
    expect(corpo).toContain('qc.setQueryData(chave, antes)');
  });
});

describe('Equipe: quem saiu fica separado e pode ser apagado', () => {
  const src = readFileSync(join(__dirname, '..', 'app', 'obras', 'EquipeTab.tsx'), 'utf8');
  it('lista principal só mostra ativo e convidado', () => {
    expect(src).toMatch(/naEquipe = lista\.filter\(\(m\) => m\.status === 'ativo' \|\| m\.status === 'convidado'\)/);
    expect(src).toContain('{naEquipe.map(cartao)}');
  });
  it('saiu/recusado vão pra seção fechada com botão Apagar', () => {
    expect(src).toContain('Fora da equipe · {fora.length}');
    expect(src).toContain('apagarMembro(uid, m.id)');
    expect(src).toMatch(/useState\(false\)[\s\S]*foraAberta/);
  });
});

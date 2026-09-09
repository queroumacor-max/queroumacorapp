// Portal: "Uso do app" (2026-09-09). Lê o FONTE do portal e avalia o bloco
// de helpers puros; e trava que toda `feature` que alguma rota de IA grava
// em `ai_usage` tem rótulo na tela — feature nova sem rótulo apareceria
// como chave crua ("receipt_ocr") pro operador.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let fonte = '';
let IA_FEATURE_ROTULOS: Record<string, string>;
let IA_PERSONAS: string[];
let CATEGORIAS_DE_USO: Array<{ campo: string; rotulo: string; unidade: string }>;
let desdeDoPeriodo: (p: string, agora?: number) => string | null;
let csvDoUso: (pessoas: Array<Record<string, unknown>>) => string;

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  const inicio = fonte.indexOf('// [teste:uso-inicio]');
  const fim = fonte.indexOf('// [teste:uso-fim]');
  expect(inicio).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(inicio);
  ({ IA_FEATURE_ROTULOS, IA_PERSONAS, CATEGORIAS_DE_USO, desdeDoPeriodo, csvDoUso } = new Function(
    `${fonte.slice(inicio, fim)}; return { IA_FEATURE_ROTULOS, IA_PERSONAS, CATEGORIAS_DE_USO, desdeDoPeriodo, csvDoUso };`,
  )());
});

function arquivosTs(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosTs(p, out);
    else if (/\.ts$/.test(nome)) out.push(p);
  }
  return out;
}

describe('a tela está registrada e chama a rota com service role', () => {
  it('resposta de um período que já mudou não entra na tela', () => {
    expect(fonte).toContain('const meu = ++pedidoRef.current;');
    expect(fonte).toContain('if (!atual()) return;\n      setRel(j);');
  });
  it('página "Uso do app" na seção DADOS, e a rota existe', () => {
    expect(fonte).toContain("{ id:'uso', icon:'📊', label:'Uso do app', section:'DADOS', component:<UsoDoApp /> }");
    expect(fonte).toContain("fetch('/api/admin/stats'");
    expect(statSync(join(process.cwd(), 'app/api/admin/stats/route.ts')).isFile()).toBe(true);
  });
});

describe('rótulos das features de IA', () => {
  it('toda feature gravada por uma rota (recordAiUsage) tem rótulo na tela', () => {
    const gravadas = new Set<string>();
    for (const f of arquivosTs(join(process.cwd(), 'app/api'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/feature:\s*'([a-z_]+)'/g)) gravadas.add(m[1]);
    }
    expect(gravadas.size).toBeGreaterThan(10);
    const semRotulo = [...gravadas].filter(f => !IA_FEATURE_ROTULOS[f]);
    expect(semRotulo).toEqual([]);
  });
  it('as personas são as três que gravam fora do CHECK original', () => {
    expect(IA_PERSONAS).toEqual(['alice', 'fe', 'senna']);
    const sql = readFileSync(join(process.cwd(), '../migrations/2026-09-09-ai-usage-feature-check.sql'), 'utf8');
    expect(sql).toContain('ALTER TABLE public.ai_usage DROP CONSTRAINT IF EXISTS ai_usage_feature_check;');
  });
});

describe('categorias do pódio batem com os rankings do servidor', () => {
  it('todo campo de CATEGORIAS_DE_USO é um ranking que montarRelatorio devolve', () => {
    const servico = readFileSync(join(process.cwd(), 'lib/api/_services/admin-stats.ts'), 'utf8');
    const rankingsBloco = servico.slice(servico.indexOf('rankings: {'), servico.indexOf('pessoas: lista,'));
    for (const c of CATEGORIAS_DE_USO) expect(rankingsBloco).toContain(`${c.campo}: rank(`);
    expect(CATEGORIAS_DE_USO.map(c => c.campo)).toContain('camisetas');
    expect(CATEGORIAS_DE_USO.map(c => c.campo)).toContain('indicacoes');
  });
});

describe('desdeDoPeriodo / csvDoUso', () => {
  it('período vira ISO contado de "agora"; tudo = null', () => {
    const agora = Date.parse('2026-09-09T12:00:00Z');
    expect(desdeDoPeriodo('7d', agora)).toBe('2026-09-02T12:00:00.000Z');
    expect(desdeDoPeriodo('30d', agora)).toBe('2026-08-10T12:00:00.000Z');
    expect(desdeDoPeriodo('tudo', agora)).toBeNull();
    expect(desdeDoPeriodo('xyz', agora)).toBeNull();
  });
  it('CSV com BOM, ponto-e-vírgula (Excel pt-BR) e aspas escapadas', () => {
    const csv = csvDoUso([{ nome: 'Ana "A"', tag: 'ana', fotos: 2, notaMedia: null }]);
    expect(csv.startsWith('\uFEFF"Nome";"@tag";')).toBe(true);
    expect(csv.split('\n')[1]).toContain('"Ana ""A""";"ana"');
    expect(csv.split('\n')[1].split(';').length).toBe(csv.split('\n')[0].split(';').length);
  });
});

// Portal: Leads com 60 mil+ linhas (2026-09-09, relato do usuário: "creio
// que pq tem 60k + leads, a pagina nao carrega").
//
// Três causas, as três travadas aqui: (1) `buscarTudo` paginava em SÉRIE
// e parava em silêncio na página 50; (2) a tela ficava em "Carregando"
// até a ÚLTIMA página; (3) a tabela montava um <tr> por lead. Este arquivo
// lê o FONTE do portal (arquivo único, sem módulos) e avalia os blocos
// marcados com `new Function`.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Lead = Record<string, unknown> & { id?: string };
let fonte = '';
let buscarEmPaginas: (
  montar: (extra: Record<string, unknown>) => { range: (a: number, b: number) => Promise<{ data?: unknown[]; error?: unknown; count?: number | null }> },
  opts?: { aoChegar?: (parcial: unknown[], total: number | null) => void; cancelado?: () => boolean },
) => Promise<unknown[]>;
let comIntervalo: (f: (...a: unknown[]) => void, ms: number) => ((...a: unknown[]) => void) & { agora: () => void; cancelar: () => void };
let PAGINA_SUPA: number;
let emendarLeads: (lista: Lead[], mudados: Lead[]) => Lead[];
let LEADS_JANELA: number;
let LEADS_BLOCO: number;
let janelaDeLeads: (total: number, bloco: number, limite: number) => { de: number; ate: number; bloco: number; nBlocos: number; fimDoBloco: boolean };

function bloco(nome: string) {
  const inicio = fonte.indexOf(`// [teste:${nome}-inicio]`);
  const fim = fonte.indexOf(`// [teste:${nome}-fim]`);
  expect(inicio).toBeGreaterThan(0);
  expect(fim).toBeGreaterThan(inicio);
  return fonte.slice(inicio, fim);
}

beforeAll(() => {
  fonte = readFileSync(join(process.cwd(), 'public/portal/app.jsx'), 'utf8');
  ({ buscarEmPaginas, comIntervalo, PAGINA_SUPA } = new Function(
    `const PAGINA_SUPA = 1000; ${bloco('paginas')}; return { buscarEmPaginas, comIntervalo, PAGINA_SUPA };`,
  )());
  ({ emendarLeads, LEADS_JANELA, LEADS_BLOCO, janelaDeLeads } = new Function(
    `const normalizeLeadPhone = (p) => p; ${bloco('leads-janela')}; return { emendarLeads, LEADS_JANELA, LEADS_BLOCO, janelaDeLeads };`,
  )());
});

// Banco falso: `total` linhas numeradas, ordenadas. Cada range devolve a
// fatia depois de um atraso que varia por página — o que faz as respostas
// chegarem FORA de ordem, como em produção.
function bancoFalso(total: number, opts: { semCount?: boolean; atraso?: (n: number) => number } = {}) {
  const chamadas: Array<[number, number]> = [];
  const montar = (extra: Record<string, unknown>) => ({
    range: async (a: number, b: number) => {
      chamadas.push([a, b]);
      const n = Math.floor(a / PAGINA_SUPA);
      await new Promise(r => setTimeout(r, opts.atraso ? opts.atraso(n) : 0));
      const data = [];
      for (let i = a; i <= Math.min(b, total - 1); i++) data.push({ id: i });
      return { data, count: extra.count === 'exact' && !opts.semCount ? total : null };
    },
  });
  return { montar, chamadas };
}

describe('buscarEmPaginas', () => {
  it('traz TODAS as linhas, em ordem, mesmo com as páginas chegando fora de ordem', async () => {
    const total = 3450;
    const { montar, chamadas } = bancoFalso(total, { atraso: n => (4 - n) * 3 });
    const parciais: number[] = [];
    const out = await buscarEmPaginas(montar, { aoChegar: (p) => parciais.push(p.length) });
    expect(out.length).toBe(total);
    expect(out.map(l => (l as { id: number }).id)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(chamadas.length).toBe(4);
    // A primeira publicação já tem a primeira página; a última tem tudo.
    expect(parciais[0]).toBe(PAGINA_SUPA);
    expect(parciais[parciais.length - 1]).toBe(total);
    // O total do count chega junto com a primeira página.
  });
  it('não tem teto de 50 mil: 61.617 linhas viram 62 páginas', async () => {
    const total = 61617;
    const { montar, chamadas } = bancoFalso(total);
    const totais: Array<number | null> = [];
    const out = await buscarEmPaginas(montar, { aoChegar: (_p, t) => totais.push(t) });
    expect(out.length).toBe(total);
    expect(chamadas.length).toBe(62);
    expect(totais.every(t => t === total)).toBe(true);
  });
  it('sem `count` do PostgREST, segue em série até a página curta', async () => {
    const total = 2500;
    const { montar, chamadas } = bancoFalso(total, { semCount: true });
    const out = await buscarEmPaginas(montar);
    expect(out.length).toBe(total);
    expect(chamadas.length).toBe(3);
  });
  it('cancelado() para os trabalhadores sem estourar', async () => {
    const { montar, chamadas } = bancoFalso(9000);
    let vivo = true;
    const out = await buscarEmPaginas(montar, { aoChegar: () => { vivo = false; }, cancelado: () => !vivo });
    // Só a primeira página (e no máximo as que já estavam em voo) saíram.
    expect(chamadas.length).toBeLessThan(9);
    expect(out.length).toBeLessThan(9000);
  });
  it('erro de uma página derruba a busca', async () => {
    const montar = () => ({ range: async (a: number) => a === 0 ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), count: 2000 } : { error: new Error('boom') } });
    await expect(buscarEmPaginas(montar)).rejects.toThrow('boom');
  });
  it('a consulta dos leads pede count na primeira página e ordena por created_at + id (desempate)', () => {
    expect(fonte).toContain("supa.from('leads').select('*', extra).order('created_at', { ascending:false }).order('id')");
    expect(fonte).toContain('for (let de = 0; ; de += PAGINA_SUPA)');
    expect(fonte).not.toContain('de < 50000');
  });
});

describe('comIntervalo', () => {
  it('a primeira chamada sai na hora, as seguintes se agrupam e a última sempre sai', async () => {
    const vistos: unknown[] = [];
    const g = comIntervalo((x) => vistos.push(x), 30);
    g(1); g(2); g(3);
    expect(vistos).toEqual([1]);
    await new Promise(r => setTimeout(r, 50));
    expect(vistos).toEqual([1, 3]);
  });
  it('cancelar() descarta a chamada presa', async () => {
    const vistos: unknown[] = [];
    const g = comIntervalo((x) => vistos.push(x), 30);
    g(1); g(2); g.cancelar();
    await new Promise(r => setTimeout(r, 50));
    expect(vistos).toEqual([1]);
  });
});

describe('emendarLeads', () => {
  const base: Lead[] = [{ id: 'a', status: 'novo', name: 'A' }, { id: 'b', status: 'novo', name: 'B' }];
  it('linha conhecida recebe só os campos novos, sem perder os outros', () => {
    const out = emendarLeads(base, [{ id: 'b', status: 'contactado' }]);
    expect(out[1]).toEqual({ id: 'b', status: 'contactado', name: 'B' });
    expect(out[0]).toBe(base[0]);
  });
  it('nada mudou → devolve a MESMA lista (não remonta a tela)', () => {
    expect(emendarLeads(base, [{ id: 'a', status: 'novo' }])).toBe(base);
    expect(emendarLeads(base, [])).toBe(base);
  });
  it('lead desconhecido entra no começo', () => {
    const out = emendarLeads(base, [{ id: 'c', status: 'novo' }]);
    expect(out.length).toBe(3);
    expect(out[0].id).toBe('c');
  });
});

describe('a tela de Leads', () => {
  it('monta só a janela e cresce por sentinela', () => {
    expect(LEADS_JANELA).toBeGreaterThan(0);
    expect(fonte).toContain('{visiveis.map((l, i) => {');
    expect(fonte).not.toContain('{filtered.map((l, i) => {');
    expect(fonte).toContain('<tr ref={janela.fimDoBloco ? null : sentinelaRef}>');
    expect(fonte).toContain('const visiveis = React.useMemo(() => filtered.slice(janela.de, janela.ate), [filtered, janela.de, janela.ate]);');
    // A sentinela nunca passa do teto do bloco.
    expect(fonte).toContain('setLimite(l => Math.min(LEADS_BLOCO, l + LEADS_JANELA))');
  });
  it('janelaDeLeads: o DOM nunca passa de LEADS_BLOCO linhas, e o bloco seguinte DESMONTA o anterior (Codex #291)', () => {
    expect(LEADS_BLOCO).toBeGreaterThanOrEqual(LEADS_JANELA);
    const total = 61617;
    expect(janelaDeLeads(total, 0, 100)).toEqual({ de: 0, ate: 100, bloco: 0, nBlocos: 124, fimDoBloco: false });
    expect(janelaDeLeads(total, 0, 500)).toMatchObject({ de: 0, ate: 500, fimDoBloco: true });
    // limite acima do teto não vaza pro bloco seguinte
    expect(janelaDeLeads(total, 0, 5000)).toMatchObject({ de: 0, ate: 500, fimDoBloco: true });
    expect(janelaDeLeads(total, 3, 100)).toMatchObject({ de: 1500, ate: 1600, fimDoBloco: false });
    const ultimo = janelaDeLeads(total, 123, 500);
    expect(ultimo).toMatchObject({ de: 61500, ate: 61617, fimDoBloco: true });
    // bloco fora do alcance (filtro encolheu a lista) volta pro último válido
    expect(janelaDeLeads(120, 9, 100)).toMatchObject({ de: 0, ate: 100, bloco: 0, nBlocos: 1 });
    expect(janelaDeLeads(0, 0, 100)).toMatchObject({ de: 0, ate: 0, nBlocos: 1, fimDoBloco: true });
  });
  it('o poll/pós-envio pagina os recentes sem teto de 1000 (Codex #291)', () => {
    expect(fonte).toContain("recentes: (desdeIso) => buscarEmPaginas(");
    expect(fonte).not.toContain(".gte('abordagem_at', desdeIso).order('abordagem_at', { ascending:false }).limit(PAGINA_SUPA)");
  });
  it('pinta com a primeira página e mostra o progresso; o poll e o pós-envio emendam em vez de recarregar', () => {
    expect(fonte).toContain('if (loading && leads.length === 0) return');
    expect(fonte).toContain("leadsService.list({ aoChegar: publicar, cancelado: () => !vivoRef.current })");
    expect(fonte).toContain('const t = setInterval(mesclarRecentes, 20000);');
    expect(fonte).toContain('onSent={()=>mesclarRecentes()}');
    expect(fonte).toContain("onSent={()=>{ mesclarRecentes(); setSel(new Set()); }}");
    expect(fonte).not.toContain('const t = setInterval(fetchLeads, 20000);');
  });
  it('a busca é debounced e a ordenação por texto usa Intl.Collator', () => {
    expect(fonte).toContain("new Intl.Collator('pt-BR').compare");
    expect(fonte).toContain('if (buscaDeb) {');
  });
});

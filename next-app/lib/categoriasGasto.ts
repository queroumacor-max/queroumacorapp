// Categorias de GASTO do Financeiro (sugestão do pintor Léo, 2026-09-24:
// "gasto com funcionários, despesa com veículos, transporte — porque até
// chegar no lucro o gasto fica bem resumido"). Resumo (receita/custo/lucro)
// segue igual pra todos; o detalhe por categoria é PRO.
//
// Fonte da categoria de um lançamento, em ordem:
//  1. coluna `jobs.categoria` (migration 2026-09-24-b);
//  2. prefixo antigo do service_type ("Material: tinta 18L") — é como o
//     formulário guardava antes da coluna existir, e como continua gravando
//     se a migration ainda não rodou;
//  3. "Sem categoria".

export const CATEGORIAS_GASTO = [
  { id: 'material', rotulo: 'Material' },
  { id: 'mao_de_obra', rotulo: 'Mão de obra (funcionários)' },
  { id: 'veiculo', rotulo: 'Veículo' },
  { id: 'transporte', rotulo: 'Transporte / frete' },
  { id: 'outros', rotulo: 'Outros' },
] as const;

export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number]['id'];
export type CategoriaOuSem = CategoriaGasto | 'sem';

const IDS = new Set<string>(CATEGORIAS_GASTO.map((c) => c.id));

export function ehCategoriaGasto(v: unknown): v is CategoriaGasto {
  return typeof v === 'string' && IDS.has(v);
}

export function rotuloCategoria(id: CategoriaOuSem): string {
  return CATEGORIAS_GASTO.find((c) => c.id === id)?.rotulo ?? 'Sem categoria';
}

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Palavra do prefixo antigo ("Material:", "Mão de obra:") → categoria. */
function categoriaDoPrefixo(serviceType: string | null | undefined): CategoriaGasto | null {
  const t = String(serviceType ?? '');
  const i = t.indexOf(':');
  if (i <= 0) return null;
  const p = sem(t.slice(0, i));
  if (p.startsWith('material')) return 'material';
  if (p.startsWith('mao de obra') || p.startsWith('funcionario') || p.startsWith('diaria')) return 'mao_de_obra';
  if (p.startsWith('veiculo') || p.startsWith('carro') || p.startsWith('combustivel')) return 'veiculo';
  if (p.startsWith('transporte') || p.startsWith('frete')) return 'transporte';
  if (p.startsWith('outro')) return 'outros';
  return null;
}

export function categoriaDoLancamento(e: { categoria?: string | null; service_type?: string | null }): CategoriaOuSem {
  if (ehCategoriaGasto(e.categoria)) return e.categoria;
  return categoriaDoPrefixo(e.service_type) ?? 'sem';
}

export interface GastoPorCategoria {
  id: CategoriaOuSem;
  rotulo: string;
  total: number;
}

/** Soma os CUSTOS (material_cost) por categoria, maior primeiro; ignora zeros. */
export function gastosPorCategoria(
  entries: ReadonlyArray<{ categoria?: string | null; service_type?: string | null; material_cost?: number | string | null }>,
): GastoPorCategoria[] {
  const soma = new Map<CategoriaOuSem, number>();
  for (const e of entries) {
    const v = Number(e.material_cost) || 0;
    if (v <= 0) continue;
    const c = categoriaDoLancamento(e);
    soma.set(c, (soma.get(c) ?? 0) + v);
  }
  return [...soma.entries()]
    .map(([id, total]) => ({ id, rotulo: rotuloCategoria(id), total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

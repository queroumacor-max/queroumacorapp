// Gestão de Obras — contas e regras puras (testadas em __tests__/obras.test.ts).
// Quem fala com o banco é lib/services/obras.ts; aqui não tem rede.

import { gastosPorCategoria, type GastoPorCategoria } from '@/lib/categoriasGasto';

export const STATUS_OBRA = [
  { id: 'planejada', rotulo: 'Planejada' },
  { id: 'em_andamento', rotulo: 'Em andamento' },
  { id: 'pausada', rotulo: 'Pausada' },
  { id: 'concluida', rotulo: 'Concluída' },
] as const;
export type StatusObra = (typeof STATUS_OBRA)[number]['id'];

export function rotuloStatusObra(s: string): string {
  return STATUS_OBRA.find((x) => x.id === s)?.rotulo ?? s;
}

/** 'YYYY-MM-DD' de um Date usando os campos LOCAIS (datas montadas por nós). */
export function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Converte 'YYYY-MM-DD' em Date local (meio-dia: imune a horário de verão). */
export function deYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12);
}

/**
 * Segunda a sábado da semana que contém `hoje` (obra de pintura raramente
 * roda domingo; a escala mostra 6 dias). `deslocamento` anda semanas.
 */
export function diasDaSemana(hoje: string, deslocamento = 0): string[] {
  const base = deYmd(hoje);
  const dow = base.getDay(); // 0 = domingo
  const seg = new Date(base);
  seg.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1) + deslocamento * 7);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(seg);
    d.setDate(seg.getDate() + i);
    return ymd(d);
  });
}

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function rotuloDia(dia: string): { sem: string; num: string; curto: string } {
  const d = deYmd(dia);
  const num = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return { sem: SEMANA[d.getDay()], num, curto: `${SEMANA[d.getDay()]} ${num}/${mes}` };
}

export interface ResumoObra {
  valor: number;
  gastos: GastoPorCategoria[];
  totalGastos: number;
  /** Mão de obra ESTIMADA pela escala (dias escalados × diária), se não lançada. */
  maoDeObraEstimada: number;
  lucro: number;
}

/**
 * Valor da obra − gastos lançados. A mão de obra, se ainda não foi lançada
 * como gasto, entra ESTIMADA pela escala (dias × diária) pra o lucro não
 * parecer maior do que é — e aparece separada, marcada como estimativa.
 */
export function resumoDaObra(
  valor: number | null | undefined,
  lancamentos: ReadonlyArray<{ categoria?: string | null; service_type?: string | null; material_cost?: number | string | null }>,
  escalaComDiaria: ReadonlyArray<{ diaria?: number | string | null }>,
): ResumoObra {
  const v = Number(valor) || 0;
  const gastos = gastosPorCategoria(lancamentos);
  const totalGastos = gastos.reduce((s, g) => s + g.total, 0);
  const lancouMaoDeObra = gastos.some((g) => g.id === 'mao_de_obra');
  const estimada = lancouMaoDeObra
    ? 0
    : escalaComDiaria.reduce((s, e) => s + (Number(e.diaria) || 0), 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    valor: r(v),
    gastos,
    totalGastos: r(totalGastos),
    maoDeObraEstimada: r(estimada),
    lucro: r(v - totalGastos - estimada),
  };
}

/** Dígitos do telefone pro wa.me (BR local ganha 55; o resto passa como veio). */
export function waDigitos(tel: string | null | undefined): string | null {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 10 || (d.length === 11 && d[2] === '9')) return `55${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** Texto da escala pra mandar no WhatsApp de quem não tem o app. */
export function textoEscalaWhatsApp(
  nome: string,
  gestor: string,
  dias: ReadonlyArray<{ dia: string; obra: string; endereco?: string | null; horario?: string | null; tarefa?: string | null }>,
): string {
  const linhas = dias.map((d) => {
    const partes = [rotuloDia(d.dia).curto, d.obra];
    if (d.horario) partes.push(d.horario);
    if (d.endereco) partes.push(d.endereco);
    if (d.tarefa) partes.push(`tarefa: ${d.tarefa}`);
    return `• ${partes.join(' — ')}`;
  });
  return [`Oi ${nome.split(' ')[0]}! Sua escala com ${gestor}:`, ...linhas].join('\n');
}

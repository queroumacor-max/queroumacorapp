// Gestão de Obras — acesso ao banco. SQL:
// /migrations/2026-09-24-b-gestao-obras-tabelas.sql e -c-…-funcoes.sql.
//
// Segurança (ver comentários do SQL): o GESTOR lê/escreve as próprias
// tabelas sob RLS; o FUNCIONÁRIO só age por RPC (convites, agenda,
// presença) — nunca lê `obras`/`obra_equipe` direto, então não vê valor
// da obra nem diária dos colegas. Os filtros por dono aqui são defesa em
// camadas; quem garante é a RLS.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { DB } from '@/lib/db';
import { NetworkError, ValidationError } from '@/lib/errors';
import { ehCategoriaGasto, type CategoriaGasto } from '@/lib/categoriasGasto';
import { ymdBrt } from '@/lib/utils';

// Tabelas novas, fora do schema TS gerado.
const db = () => getSupabase() as unknown as SupabaseClient;

/** SQL da Gestão de Obras ainda não rodou no banco. */
export class ObrasSqlPendenteError extends Error {
  constructor() {
    super('A Gestão de Obras ainda não foi ativada no banco (SQL pendente).');
    this.name = 'ObrasSqlPendenteError';
  }
}

type ErroPg = { message: string; code?: string } | null;

function falha(error: ErroPg): never {
  const code = error?.code ?? '';
  // 42P01/PGRST205 = tabela ausente; 42883/PGRST202 = função ausente.
  if (['42P01', 'PGRST205', '42883', 'PGRST202'].includes(code)) throw new ObrasSqlPendenteError();
  throw new NetworkError(error?.message || 'Erro no banco', error ?? undefined);
}

// ─── tipos ──────────────────────────────────────────────────────────────

export interface Obra {
  id: string;
  owner_id: string;
  nome: string;
  cliente: string | null;
  endereco: string | null;
  status: string;
  inicio: string | null;
  fim: string | null;
  quote_id: string | null;
  valor: number | null;
  observacoes: string | null;
  client_id: string | null;
  created_at: string;
}

export interface MembroEquipe {
  id: string;
  gestor_id: string;
  membro_id: string | null;
  nome: string;
  telefone: string | null;
  funcao: string | null;
  diaria: number | null;
  status: 'convidado' | 'ativo' | 'recusado' | 'saiu';
}

export interface DiaEscala {
  id: string;
  obra_id: string;
  equipe_id: string;
  dia: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  tarefa: string | null;
  presenca: 'pendente' | 'confirmada' | 'faltou';
}

export interface Convite {
  id: string;
  gestor_nome: string | null;
  gestor_tag: string | null;
  funcao: string | null;
  created_at: string;
}

export interface MeuDia {
  escala_id: string;
  dia: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  tarefa: string | null;
  presenca: 'pendente' | 'confirmada' | 'faltou';
  obra_nome: string;
  obra_endereco: string | null;
  gestor_nome: string | null;
  colegas: string | null;
}

export interface LancamentoObra {
  id: string;
  service_type: string | null;
  categoria: string | null;
  material_cost: number | null;
  revenue: number | null;
  created_at: string;
}

const OBRA_COLS_BASE = 'id, owner_id, nome, cliente, endereco, status, inicio, fim, quote_id, valor, observacoes, created_at';
// client_id é de uma migration posterior (2026-09-25) — tolera coluna
// ausente pra quem ainda não rodou o SQL do vínculo de cliente (mesmo
// padrão do Financeiro com `categoria`/`obra_id`).
const OBRA_COLS = `${OBRA_COLS_BASE}, client_id`;
const colunaAusente = (code?: string) => code === '42703';
const EQUIPE_COLS = 'id, gestor_id, membro_id, nome, telefone, funcao, diaria, status';
const ESCALA_COLS = 'id, obra_id, equipe_id, dia, hora_inicio, hora_fim, tarefa, presenca';

const txt = (v: unknown, max: number) => {
  const s = String(v ?? '').trim().slice(0, max);
  return s || null;
};

// ─── GESTOR: obras ─────────────────────────────────────────────────────

export async function listObras(uid: string): Promise<Obra[]> {
  if (!uid) return [];
  const r1 = await db().from('obras').select(OBRA_COLS).eq('owner_id', uid)
    .order('created_at', { ascending: false }).limit(200);
  if (r1.error && colunaAusente(r1.error.code)) {
    const r2 = await db().from('obras').select(OBRA_COLS_BASE).eq('owner_id', uid)
      .order('created_at', { ascending: false }).limit(200);
    if (r2.error) falha(r2.error);
    return (r2.data ?? []).map((o) => ({ ...o, client_id: null })) as Obra[];
  }
  if (r1.error) falha(r1.error);
  return (r1.data ?? []) as Obra[];
}

export interface ObraInput {
  nome: string;
  cliente?: string | null;
  endereco?: string | null;
  status?: string;
  inicio?: string | null;
  fim?: string | null;
  valor?: number | null;
  quote_id?: string | null;
  observacoes?: string | null;
}

function linhaObra(input: ObraInput) {
  const nome = txt(input.nome, 120);
  if (!nome) throw new ValidationError('Dê um nome à obra.');
  const valor = input.valor == null || !Number.isFinite(input.valor) ? null : Math.max(0, input.valor);
  return {
    nome,
    cliente: txt(input.cliente, 120),
    endereco: txt(input.endereco, 300),
    status: input.status || 'planejada',
    inicio: input.inicio || null,
    fim: input.fim || null,
    valor,
    quote_id: input.quote_id || null,
    observacoes: txt(input.observacoes, 4000),
  };
}

export async function salvarObra(uid: string, input: ObraInput, id?: string): Promise<Obra> {
  if (!uid) throw new ValidationError('Faça login.');
  const linha = linhaObra(input);
  if (linha.inicio && linha.fim && linha.fim < linha.inicio) {
    throw new ValidationError('A data de fim é antes do início.');
  }
  const r1 = id
    ? await db().from('obras').update(linha).eq('id', id).eq('owner_id', uid).select(OBRA_COLS)
    : await db().from('obras').insert({ ...linha, owner_id: uid }).select(OBRA_COLS);
  if (r1.error && colunaAusente(r1.error.code)) {
    // já gravou (o erro é só no SELECT de retorno) — refaz sem client_id.
    const r2 = id
      ? await db().from('obras').select(OBRA_COLS_BASE).eq('id', id).eq('owner_id', uid)
      : await db().from('obras').select(OBRA_COLS_BASE).eq('owner_id', uid).order('created_at', { ascending: false }).limit(1);
    if (r2.error) falha(r2.error);
    const row2 = (r2.data ?? []).map((o) => ({ ...o, client_id: null }))[0];
    if (!row2) throw new NetworkError('Obra não encontrada ou sem permissão.');
    return row2 as Obra;
  }
  if (r1.error) falha(r1.error);
  const row = (r1.data ?? [])[0];
  if (!row) throw new NetworkError('Obra não encontrada ou sem permissão.');
  return row as Obra;
}

/**
 * GESTOR: vincula (ou desvincula, tag='') a obra a um cliente do app pela
 * @tag — o cliente ganha uma tela de acompanhamento (status, equipe
 * escalada, agenda), nunca valor nem observações do gestor.
 */
export async function vincularCliente(uid: string, obraId: string, tagBruta: string): Promise<Obra> {
  let clientId: string | null = null;
  const tag = normalizarTag(tagBruta);
  if (tag) {
    if (tag.length < 2) throw new ValidationError('Digite a @tag do cliente.');
    const { data: perfis, error: e1 } = await db().from('profiles_public').select('id').eq('tag', tag).limit(1);
    if (e1) throw new NetworkError(e1.message, e1);
    const alvo = (perfis ?? [])[0] as { id: string } | undefined;
    if (!alvo) throw new ValidationError(`Não achei ninguém com a @${tag} no app.`);
    if (alvo.id === uid) throw new ValidationError('Você não pode se vincular como cliente da própria obra.');
    clientId = alvo.id;
  }
  const { data, error } = await db().from('obras').update({ client_id: clientId }).eq('id', obraId).eq('owner_id', uid).select(OBRA_COLS);
  if (error) falha(error);
  const row = (data ?? [])[0];
  if (!row) throw new NetworkError('Obra não encontrada ou sem permissão.');
  return row as Obra;
}

export async function apagarObra(uid: string, id: string): Promise<void> {
  const { data, error } = await db().from('obras').delete().eq('id', id).eq('owner_id', uid).select('id');
  if (error) falha(error);
  if (!data?.length) throw new NetworkError('Obra não encontrada ou sem permissão.');
}

// ─── GESTOR: equipe ────────────────────────────────────────────────────

export async function listEquipe(uid: string): Promise<MembroEquipe[]> {
  if (!uid) return [];
  const { data, error } = await db().from('obra_equipe').select(EQUIPE_COLS).eq('gestor_id', uid)
    .order('nome', { ascending: true }).limit(200);
  if (error) falha(error);
  return (data ?? []) as MembroEquipe[];
}

export interface MembroInput {
  nome: string;
  telefone?: string | null;
  funcao?: string | null;
  diaria?: number | null;
}

/** Funcionário SEM conta no app (recebe a escala por WhatsApp). */
export async function adicionarSemConta(uid: string, input: MembroInput): Promise<MembroEquipe> {
  const nome = txt(input.nome, 80);
  if (!nome) throw new ValidationError('Informe o nome.');
  const tel = String(input.telefone ?? '').replace(/\D/g, '').slice(0, 15) || null;
  const { data, error } = await db().from('obra_equipe').insert({
    gestor_id: uid, nome, telefone: tel, funcao: txt(input.funcao, 60),
    diaria: input.diaria != null && Number.isFinite(input.diaria) ? Math.max(0, input.diaria) : null,
  }).select(EQUIPE_COLS);
  if (error) falha(error);
  return (data ?? [])[0] as MembroEquipe;
}

export interface PessoaSeguida {
  id: string;
  nome: string;
  tag: string;
}

/**
 * Quem o gestor SEGUE, pra sugerir no campo @tag (a pessoa mais provável de
 * ser convidada é alguém que ele já segue). Só entra quem tem @tag — sem
 * tag não dá pra convidar por essa rota mesmo. Best-effort: erro aqui não
 * pode travar o formulário de convite.
 */
export async function pessoasQueSigo(uid: string): Promise<PessoaSeguida[]> {
  if (!uid) return [];
  try {
    const ids = await DB.follows.listFollowingIds(uid);
    if (!ids.length) return [];
    const { data, error } = await db().from('profiles_public').select('id, name, tag').in('id', ids.slice(0, 300));
    if (error) return [];
    return (data ?? [])
      .map((p: { id: string; name: string | null; tag: string | null }) => ({ id: p.id, nome: p.name || '', tag: p.tag || '' }))
      .filter((p) => p.tag);
  } catch {
    return [];
  }
}

/** Normaliza "@Fulano.Pinta " → "fulano.pinta" (mesmo alfabeto da @tag). */
export function normalizarTag(t: string): string {
  return String(t ?? '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._]/g, '');
}

/**
 * Convida um usuário do app pela @tag. Ele entra como "convidado" — só
 * vira "ativo" quando ELE aceita (trava no banco, não aqui).
 */
export async function convidarPorTag(uid: string, tagBruta: string, extra: Omit<MembroInput, 'nome'>): Promise<MembroEquipe> {
  const tag = normalizarTag(tagBruta);
  if (tag.length < 2) throw new ValidationError('Digite a @tag do profissional.');
  const { data: perfis, error: e1 } = await db().from('profiles_public').select('id, name, tag').eq('tag', tag).limit(1);
  if (e1) throw new NetworkError(e1.message, e1);
  const alvo = (perfis ?? [])[0] as { id: string; name: string | null } | undefined;
  if (!alvo) throw new ValidationError(`Não achei ninguém com a @${tag} no app.`);
  if (alvo.id === uid) throw new ValidationError('Você não pode se convidar.');
  const { data, error } = await db().from('obra_equipe').insert({
    gestor_id: uid, membro_id: alvo.id, nome: txt(alvo.name, 80) || `@${tag}`,
    funcao: txt(extra.funcao, 60),
    diaria: extra.diaria != null && Number.isFinite(extra.diaria) ? Math.max(0, extra.diaria) : null,
  }).select(EQUIPE_COLS);
  if (error) {
    if (error.code === '23505') throw new ValidationError('Essa pessoa já está na sua equipe.');
    falha(error);
  }
  return (data ?? [])[0] as MembroEquipe;
}

export async function atualizarMembro(
  uid: string,
  id: string,
  patch: Partial<Pick<MembroEquipe, 'funcao' | 'diaria' | 'telefone' | 'status'>>,
): Promise<void> {
  const { data, error } = await db().from('obra_equipe').update(patch).eq('id', id).eq('gestor_id', uid).select('id, status');
  if (error) falha(error);
  if (!data?.length) throw new NetworkError('Pessoa não encontrada na sua equipe.');
}

// ─── GESTOR: escala ────────────────────────────────────────────────────

export async function listEscala(uid: string, de: string, ate: string): Promise<DiaEscala[]> {
  if (!uid) return [];
  const { data, error } = await db().from('obra_escala').select(ESCALA_COLS)
    .gte('dia', de).lte('dia', ate).order('dia', { ascending: true }).limit(1000);
  if (error) falha(error);
  return (data ?? []) as DiaEscala[];
}

/** Toda a escala de UMA obra (pra estimar mão de obra e listar quem vai). */
export async function escalaDaObra(obraId: string): Promise<DiaEscala[]> {
  const { data, error } = await db().from('obra_escala').select(ESCALA_COLS)
    .eq('obra_id', obraId).order('dia', { ascending: true }).limit(1000);
  if (error) falha(error);
  return (data ?? []) as DiaEscala[];
}

export async function escalar(input: { obra_id: string; equipe_id: string; dia: string; hora_inicio?: string | null; hora_fim?: string | null; tarefa?: string | null }): Promise<void> {
  const { error } = await db().from('obra_escala').insert({
    obra_id: input.obra_id, equipe_id: input.equipe_id, dia: input.dia,
    hora_inicio: input.hora_inicio || null, hora_fim: input.hora_fim || null,
    tarefa: txt(input.tarefa, 200),
  });
  if (error) {
    if (error.code === '23505') throw new ValidationError('Essa pessoa já está nessa obra neste dia.');
    falha(error);
  }
}

export async function desescalar(id: string): Promise<void> {
  const { data, error } = await db().from('obra_escala').delete().eq('id', id).select('id');
  if (error) falha(error);
  if (!data?.length) throw new NetworkError('Dia não encontrado.');
}

export interface EnvioEscala {
  app: number;
  sem_conta: Array<{ nome: string; telefone: string | null; dias: number }>;
}

export async function enviarEscala(de: string, ate: string): Promise<EnvioEscala> {
  const { data, error } = await db().rpc('enviar_escala_obras', { p_de: de, p_ate: ate });
  if (error) falha(error);
  const r = (data ?? {}) as Partial<EnvioEscala>;
  return { app: Number(r.app) || 0, sem_conta: Array.isArray(r.sem_conta) ? r.sem_conta : [] };
}

// ─── GESTOR: custos da obra (Financeiro) e anotações ───────────────────

export async function lancamentosDaObra(uid: string, obraId: string): Promise<LancamentoObra[]> {
  const { data, error } = await db().from('jobs')
    .select('id, service_type, categoria, material_cost, revenue, created_at')
    .eq('painter_id', uid).eq('obra_id', obraId).order('created_at', { ascending: false }).limit(300);
  if (error) falha(error);
  return (data ?? []) as LancamentoObra[];
}

/** Lança um GASTO da obra no Financeiro (mesmo livro caixa: tabela jobs). */
export async function lancarGastoDaObra(
  uid: string,
  obra: Pick<Obra, 'id' | 'nome' | 'cliente'>,
  input: { categoria: CategoriaGasto; valor: number; descricao?: string | null },
): Promise<void> {
  if (!ehCategoriaGasto(input.categoria)) throw new ValidationError('Escolha a categoria.');
  if (!Number.isFinite(input.valor) || input.valor <= 0) throw new ValidationError('Informe o valor do gasto.');
  const desc = txt(input.descricao, 80) || obra.nome;
  const { error } = await db().from('jobs').insert({
    painter_id: uid,
    obra_id: obra.id,
    categoria: input.categoria,
    service_type: desc,
    client_name: obra.cliente || '-',
    revenue: 0,
    material_cost: Math.round(input.valor * 100) / 100,
    status: 'concluido',
    scheduled_date: ymdBrt(),
    notes: 'Gasto da obra',
  });
  if (error) falha(error);
}

export async function notasDaObra(uid: string, obraId: string): Promise<Array<{ id: string; body: string | null; created_at: string }>> {
  const { data, error } = await db().from('notes').select('id, body, created_at')
    .eq('user_id', uid).eq('obra_id', obraId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(100);
  if (error) falha(error);
  return (data ?? []) as Array<{ id: string; body: string | null; created_at: string }>;
}

export async function anotarNaObra(uid: string, obraId: string, body: string): Promise<void> {
  const t = txt(body, 4000);
  if (!t) throw new ValidationError('Escreva a anotação.');
  const { error } = await db().from('notes').insert({ user_id: uid, obra_id: obraId, body: t });
  if (error) falha(error);
}

// ─── FUNCIONÁRIO (tudo por RPC) ────────────────────────────────────────

export async function meusConvites(): Promise<Convite[]> {
  const { data, error } = await db().rpc('meus_convites_equipe');
  if (error) falha(error);
  return (data ?? []) as Convite[];
}

export async function responderConvite(id: string, aceitar: boolean): Promise<void> {
  const { error } = await db().rpc('responder_convite_equipe', { p_id: id, p_aceitar: aceitar });
  if (error) falha(error);
}

export async function sairDaEquipe(id: string): Promise<void> {
  const { error } = await db().rpc('sair_da_equipe', { p_id: id });
  if (error) falha(error);
}

export async function minhaAgenda(de: string, ate: string): Promise<MeuDia[]> {
  const { data, error } = await db().rpc('minha_agenda_obras', { p_de: de, p_ate: ate });
  if (error) falha(error);
  return (data ?? []) as MeuDia[];
}

export async function confirmarPresenca(escalaId: string, confirmar: boolean): Promise<void> {
  const { error } = await db().rpc('confirmar_presenca_obra', { p_escala_id: escalaId, p_confirmar: confirmar });
  if (error) falha(error);
}

// ─── CLIENTE (tudo por RPC — só o que o gestor vinculou, nunca valor
// nem observações) ──────────────────────────────────────────────────────

export interface ObraCliente {
  obra_id: string;
  nome: string;
  status: string;
  endereco: string | null;
  inicio: string | null;
  fim: string | null;
  gestor_nome: string | null;
  gestor_tag: string | null;
}

export interface MembroObraCliente {
  nome: string;
  funcao: string | null;
}

export interface DiaAgendaCliente {
  dia: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  tarefa: string | null;
  presenca: 'pendente' | 'confirmada' | 'faltou';
  equipe: string | null;
}

export async function minhasObrasCliente(): Promise<ObraCliente[]> {
  const { data, error } = await db().rpc('minhas_obras_cliente');
  if (error) falha(error);
  return (data ?? []) as ObraCliente[];
}

export async function equipeDaObraCliente(obraId: string): Promise<MembroObraCliente[]> {
  const { data, error } = await db().rpc('obra_equipe_cliente', { p_obra_id: obraId });
  if (error) falha(error);
  return (data ?? []) as MembroObraCliente[];
}

export async function agendaDaObraCliente(obraId: string, de: string, ate: string): Promise<DiaAgendaCliente[]> {
  const { data, error } = await db().rpc('obra_agenda_cliente', { p_obra_id: obraId, p_de: de, p_ate: ate });
  if (error) falha(error);
  return (data ?? []) as DiaAgendaCliente[];
}

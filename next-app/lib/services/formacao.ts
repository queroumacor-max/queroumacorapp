// formacao.ts — service layer para Formação (`qualifications`) + Cursos
// (`courses`). Espelha o subset relevante de modules/quals-courses.js do
// vanilla (addQualification, deleteQualification, loadQualsList, addCourse,
// deleteCourse, loadCoursesList) num shape testável sem DOM.
//
// Schemas (supabase_init.sql linhas 809+, 840+):
//   qualifications: id uuid, user_id uuid, title text NOT NULL, org text,
//                   year text, icon text DEFAULT '🎓', created_at timestamptz
//   courses:        id uuid, user_id uuid, title text NOT NULL, subtitle text,
//                   cover_url text, price numeric, is_free boolean,
//                   duration text, link text, created_at timestamptz
//
// RLS: SELECT é restrito a `authenticated` (policy "qualifications_select_auth"
// e "courses_select_auth" — supabase_init.sql linhas 2030+). INSERT/UPDATE/
// DELETE só do dono (`auth.uid() = user_id`). O service assume que a sessão
// já está ativa quando chamado — caller (hook) garante isso via `enabled`.

import { getSupabase } from '@/lib/supabase';
import { ValidationError, NetworkError } from '@/lib/errors';

// ─── tipos ─────────────────────────────────────────────────────────────────

export interface Qualification {
  id: string;
  user_id: string;
  title: string;
  org?: string | null;
  year?: string | null;
  icon?: string | null;
  certificate_url?: string | null;
  created_at?: string;
}

export interface Course {
  id: string;
  user_id: string;
  title: string;
  subtitle?: string | null;
  cover_url?: string | null;
  price?: number | null;
  is_free?: boolean | null;
  duration?: string | null;
  link?: string | null;
  created_at?: string;
}

// Input pra addQual: só `title` é obrigatório (NOT NULL no schema). Os outros
// são opcionais com default no banco (icon='🎓') ou nullable.
export interface AddQualInput {
  title: string;
  org?: string | null;
  year?: string | null;
  icon?: string | null;
  certificate_url?: string | null;
}

// Input pra addCourse. `url` no spec mapeia pra coluna `link` do schema —
// mantemos o alias do spec na API pública e renomeamos internamente.
export interface AddCourseInput {
  title: string;
  url?: string | null;
}

// Colunas explícitas — alinhado com vanilla (`select('*')`) mas restrito ao
// que o frontend usa, pra evitar payload inflado e drift se colunas novas
// forem adicionadas só pra backend.
const QUAL_COLS = 'id, user_id, title, org, year, icon, certificate_url, created_at';
const COURSE_COLS =
  'id, user_id, title, subtitle, cover_url, price, is_free, duration, link, created_at';

// ─── qualifications ────────────────────────────────────────────────────────

/**
 * Lista as formações do usuário em ordem reverse-chronological. Retorna []
 * se userId vazio (consistente com fetchPedidos/fetchNotifications) pra que
 * o caller não precise checar antes.
 */
export async function listQuals(userId: string): Promise<Qualification[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('qualifications')
    .select(QUAL_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data ?? []) as Qualification[];
}

/**
 * Adiciona uma formação. `title` é obrigatório (NOT NULL no schema); demais
 * campos viram null se vazio (alinhado com vanilla `_val(...).trim() || null`).
 * Retorna a row criada — o select pós-insert é via `.select().single()` pra
 * que o caller possa atualizar o cache localmente sem refetch.
 */
export async function addQual(
  userId: string,
  input: AddQualInput
): Promise<Qualification> {
  if (!userId) throw new ValidationError('Faça login para adicionar.');
  const title = (input.title || '').trim();
  if (!title) throw new ValidationError('Informe o título.');

  const sb = getSupabase();
  const { data, error } = await sb
    .from('qualifications')
    .insert({
      user_id: userId,
      title,
      org: (input.org || '').trim() || null,
      year: (input.year || '').trim() || null,
      icon: (input.icon || '').trim() || '🎓',
      certificate_url: input.certificate_url || null,
    })
    .select(QUAL_COLS)
    .single();
  if (error) {
    throw new NetworkError(error.message, error);
  }
  if (!data) {
    throw new NetworkError('Insert em qualifications retornou vazio.');
  }
  return data as Qualification;
}

/**
 * Remove uma formação. A RLS de DELETE já restringe ao dono — passar `userId`
 * no `.eq()` é defesa em profundidade caso a policy seja afrouxada por engano.
 */
export async function deleteQual(userId: string, qualId: string): Promise<void> {
  if (!userId) throw new ValidationError('Faça login para remover.');
  if (!qualId) throw new ValidationError('Id inválido.');
  const sb = getSupabase();
  const { error } = await sb
    .from('qualifications')
    .delete()
    .eq('id', qualId)
    .eq('user_id', userId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

// ─── courses ───────────────────────────────────────────────────────────────

/**
 * Lista os cursos do usuário em ordem reverse-chronological. Retorna [] se
 * userId vazio (mesma convenção dos demais services).
 */
export async function listCourses(userId: string): Promise<Course[]> {
  if (!userId) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('courses')
    .select(COURSE_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    throw new NetworkError(error.message, error);
  }
  return (data ?? []) as Course[];
}

/**
 * Adiciona um curso. `title` obrigatório; `url` (alias pro spec) vai pro
 * campo `link` do schema. Curso novo entra como gratuito por default (sem
 * preço) — vanilla expõe campos extras (subtitle, cover_url, duration,
 * price/is_free) no modal completo, mas o port aqui é a versão "simples" do
 * spec (title + url opcional) pra alinhar com a UX da Formação.
 */
export async function addCourse(
  userId: string,
  input: AddCourseInput
): Promise<Course> {
  if (!userId) throw new ValidationError('Faça login para adicionar.');
  const title = (input.title || '').trim();
  if (!title) throw new ValidationError('Informe o título.');

  const sb = getSupabase();
  const { data, error } = await sb
    .from('courses')
    .insert({
      user_id: userId,
      title,
      link: (input.url || '').trim() || null,
      is_free: true,
    })
    .select(COURSE_COLS)
    .single();
  if (error) {
    throw new NetworkError(error.message, error);
  }
  if (!data) {
    throw new NetworkError('Insert em courses retornou vazio.');
  }
  return data as Course;
}

/**
 * Remove um curso. Mesma defesa em profundidade do deleteQual.
 */
export async function deleteCourse(
  userId: string,
  courseId: string
): Promise<void> {
  if (!userId) throw new ValidationError('Faça login para remover.');
  if (!courseId) throw new ValidationError('Id inválido.');
  const sb = getSupabase();
  const { error } = await sb
    .from('courses')
    .delete()
    .eq('id', courseId)
    .eq('user_id', userId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

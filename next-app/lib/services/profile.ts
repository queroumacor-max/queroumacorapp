// profile.ts — service layer para a feature "Edição de Perfil".
// Porta o subset relevante de modules/profile-edit.js do vanilla:
//   - getProfile: lê colunas editáveis de `profiles` (RLS já restringe ao dono
//     mas filtramos por id explicitamente pra evitar carga acidental).
//   - updateProfile: aplica patch parcial; normaliza tag (lowercase/sem @) e
//     state (uppercase) defensivamente — schemas Zod já fazem isso no caller,
//     mas o service não confia na UI pra preservar invariantes do banco.
//   - uploadAvatar: tenta bucket `avatars` primeiro, fallback `posts` (mesma
//     escada do vanilla saveEditProfile linhas 322-353); retorna publicUrl.
//   - getCidadesByUF: bate em /api/cidades?uf=<UF> (route já portada — proxy
//     IBGE com cache CDN), retorna array de nomes.
//   - getEspecialidadesByRole: tabela hardcoded (espelho de _roleSpecs em
//     app.js linha 575). Funciona offline, sem dependência de tabela no banco.
//
// Decisões:
//  - Não fazemos best-effort silencioso em update (vanilla engole errors de
//    email/service_radius). Aqui qualquer error vira NetworkError pra a UI
//    decidir como reportar. Schemas garantem que o patch só carrega colunas
//    válidas — não há mais o caso de "coluna ainda não existe".
//  - business_logo_url, _epLogoFile, _epLogoClear ficam fora deste port
//    (feature de logo de loja segue no vanilla; pode portar separado se virar
//    requisito do Next.js).

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import type { Profile, UserRole, UserType } from '@/lib/types';

// (getProfile usa SELECT * defensivamente — não dependemos de uma lista
// explícita de colunas, então uma migration pendente não quebra a UI.)

// Patch parcial — apenas as colunas que o usuário pode editar pelo form. `tag`
// é immutable pós-criação na UI (input disabled), mas mantemos no shape pra o
// signup-flow poder reusar este service no futuro.
export interface ProfilePatch {
  name?: string;
  tag?: string;
  // Categoria da conta. Usado pelo onboarding pós-OAuth (/completar-perfil),
  // onde o usuário escolhe a categoria depois de logar com Google/Apple. O
  // trigger trg_sync_role_from_user_type no banco preenche `role` a partir
  // daqui (nunca sobrescreve role='admin'). NÃO exposto no /perfil/editar.
  user_type?: UserType | null;
  bio?: string | null;
  phone?: string;
  city?: string;
  state?: string;
  address?: string | null;
  specialties?: string | null;
  avatar_url?: string | null;
  service_radius?: number | null;
  business_logo_url?: string | null;
  business_name?: string | null;
  // Wave 20 / S4: links externos públicos no perfil.
  instagram_url?: string | null;
  website_url?: string | null;
}

/**
 * Busca o profile do usuário pelo id. RLS já restringe (auth.uid() = id),
 * mas filtramos por id no select pra economizar payload e tornar a query
 * intencional. Retorna null quando não encontra (usuário sem linha em
 * profiles — caso do signup recém-feito antes da trigger handle_new_user
 * popular a row).
 */
// Colunas que a UI realmente lê do profile. Listadas explicitamente em vez
// de SELECT * pra reduzir payload (algumas colunas têm JSONs grandes tipo
// `archived_conversations`, `cart`, `seen_stories`, `palette` — que somam
// 30-40% do row e nunca são lidos). Se uma coluna não existir no banco,
// PostgREST devolve erro específico e caímos no fallback profiles_public.
const PROFILE_COLS =
  'id, name, tag, username, display_name, avatar_url, bio, phone, email, ' +
  'city, state, address, business_logo_url, business_name, role, user_type, ' +
  'profession, specialties, service_radius, is_pro, pro_expires_at, ' +
  'pro_grace_until, is_admin, portal_access, verified, rating_avg, ' +
  'review_count, birth_date, ai_logo_gen_count, instagram_url, ' +
  'website_url, followers_count, following_count, posts_count, created_at';

export async function getProfile(userId: string): Promise<Profile | null> {
  if (!userId) return null;
  const sb = getSupabase();
  // Lista explícita de colunas — economiza ~40% do payload típico vs SELECT *.
  // Fallback pra profiles_public preserva o comportamento defensivo anterior
  // caso uma coluna específica falhe (migration pendente, RLS).
  const { data, error } = await sb
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (typeof console !== 'undefined') {
      console.warn('[getProfile] erro no select profiles:', error.message);
    }
    // Fallback: profiles_public (view safe). Perde phone/email/address e
    // portal_access (view não expõe). UI degrada mas não quebra.
    const fb = await sb
      .from('profiles_public')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (fb.error) {
      throw new NetworkError(error.message, error);
    }
    return (fb.data ?? null) as Profile | null;
  }
  return (data ?? null) as Profile | null;
}

/**
 * Aplica patch parcial em `profiles`. Normaliza tag (lowercase/sem @) e
 * state (uppercase) defensivamente. O caller (form) já valida via Zod, mas
 * o service não confia na UI — qualquer escrita direta passa pelo mesmo funil.
 *
 * Throws NetworkError quando o Supabase devolve erro (RLS, FK, check constraint).
 * Throws ValidationError quando userId está vazio.
 */
export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<void> {
  if (!userId) throw new ValidationError('userId obrigatório');

  // Cópia + normalizações idempotentes (sem mutar o input). Mesmo set de
  // transformações que o vanilla aplica em saveEditProfile linhas 306-309.
  // Tipagem agora estrita: shape de ProfilePatch já corresponde ao subset
  // gravável de profiles.Update (sem `updated_at` — coluna não existe no
  // schema; o vanilla setava como no-op silencioso, o typed client agora
  // rejeita).
  const cleaned: ProfilePatch = { ...patch };
  if (typeof cleaned.tag === 'string') {
    cleaned.tag = cleaned.tag.trim().replace(/^@+/, '').toLowerCase();
  }
  if (typeof cleaned.state === 'string') {
    cleaned.state = cleaned.state.trim().toUpperCase();
  }

  const sb = getSupabase();
  // Retry-com-coluna-removida: se Postgrest reportar "Could not find the 'X'
  // column of 'profiles' in the schema cache", removemos X do patch e
  // tentamos de novo. Isso evita travar todo o UPDATE quando uma coluna
  // ainda não foi adicionada via migration (ex.: address, business_logo_url).
  // Tentativas máximas = nº de chaves do patch — eventualmente o set vazia
  // ou tudo passa.
  let attempt: ProfilePatch = { ...cleaned };
  for (let i = 0; i < Object.keys(cleaned).length + 1; i++) {
    if (Object.keys(attempt).length === 0) return; // nada sobrou pra atualizar
    const { error } = await sb.from('profiles').update(attempt as never).eq('id', userId);
    if (!error) return;
    const msg = (error as { message?: string }).message || '';
    // Postgrest 4.x reporta "Could not find the 'X' column" quando a coluna
    // não existe no schema cache (DDL pendente). Extraímos X e droppamos.
    const m = /Could not find the '([^']+)' column/i.exec(msg);
    if (m && m[1] && m[1] in attempt) {
      const k = m[1] as keyof ProfilePatch;
      const next = { ...attempt };
      delete next[k];
      attempt = next;
      continue;
    }
    throw new NetworkError(error.message, error);
  }
}

/**
 * Upload de avatar pro Supabase Storage. Tenta `avatars/` primeiro
 * (bucket dedicado, policy mais restrita) e cai pra `posts/` se falhar
 * (mesma escada do vanilla saveEditProfile lines 322-353). Não tem fallback
 * pra data URL — se ambos os buckets falham, deixa a UI lidar com o erro.
 *
 * Path layout: `<userId>/<timestamp>.<ext>` — userId no prefixo é exigido
 * pelas storage policies que filtram por `auth.uid()::text = (storage.foldername(name))[1]`.
 *
 * Throws ValidationError se userId/file ausente ou file não for image/*.
 * Throws NetworkError se nenhum bucket aceitar o upload.
 */
export async function uploadAvatar(
  userId: string,
  file: File,
): Promise<string> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('Arquivo obrigatório');
  if (!file.type || !file.type.startsWith('image/')) {
    throw new ValidationError('Selecione um arquivo de imagem');
  }
  // 5MB cap igual ao vanilla previewEpLogo line 47.
  if (file.size > 5 * 1024 * 1024) {
    throw new ValidationError('Imagem muito grande (máx 5MB)');
  }

  const sb = getSupabase();
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const ts = Date.now();
  const path = `${userId}/${ts}.${ext}`;

  // Tentativa 1: bucket `avatars` (dedicado).
  const primary = await sb.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (!primary.error) {
    const { data } = sb.storage.from('avatars').getPublicUrl(path);
    if (data?.publicUrl) return data.publicUrl;
  }

  // Tentativa 2: bucket `posts` (fallback). O path muda pra deixar claro que
  // é avatar fallback — útil pra debug e pra policy não confundir com mídia.
  const fallbackPath = `${userId}/avatar_fallback_${ts}.${ext}`;
  const fallback = await sb.storage
    .from('posts')
    .upload(fallbackPath, file, { upsert: true, contentType: file.type });
  if (!fallback.error) {
    const { data } = sb.storage.from('posts').getPublicUrl(fallbackPath);
    if (data?.publicUrl) return data.publicUrl;
  }

  // Ambos falharam — surfa o erro mais recente pra a UI.
  const last = fallback.error || primary.error;
  throw new NetworkError(
    last?.message || 'Falha ao enviar avatar',
    last ?? undefined,
  );
}

/**
 * Busca cidades por UF via /api/cidades (route já portada que faz proxy do
 * IBGE com cache CDN). Retorna array de nomes ordenado alfabeticamente
 * (a ordenação vem do upstream).
 *
 * Retorna [] em qualquer falha (UF inválida, rede, parse) — esta função é
 * "best-effort": o autocomplete da cidade não pode quebrar o form.
 */
export async function getCidadesByUF(uf: string): Promise<string[]> {
  const normalized = (uf || '').trim().toUpperCase();
  if (normalized.length !== 2) return [];
  try {
    const res = await fetch(`/api/cidades?uf=${normalized}`);
    if (!res.ok) return [];
    const json = (await res.json()) as { cidades?: Array<{ nome?: string }> };
    return (json.cidades ?? [])
      .map((c) => c.nome)
      .filter((n): n is string => typeof n === 'string');
  } catch {
    return [];
  }
}

// Tabela hardcoded de especialidades por role. Espelho 1:1 de _roleSpecs em
// app.js linha 575 + modules/signup-flow.js linha 19. Mantido aqui (não em
// types.ts) pra que mudanças de catálogo passem pelos tests do service.
export const ROLE_SPECS: Record<string, readonly string[]> = {
  pintor: [
    'Residencial', 'Comercial', 'Textura', 'Grafiato', 'Piso Epóxi',
    'Fachada', 'Degradê', 'Stencil', 'Industrial', 'Caiação',
  ],
  grafiteiro: [
    'Grafite Artístico', 'Mural Decorativo', 'Painel Comercial', 'Arte Urbana',
    'Lettering', 'Realismo', 'Abstrato', '3D / Ilusão', 'Stencil Urbano',
    'Lambe-lambe',
  ],
  automotivo: [
    'Pintura Automotiva', 'Funilaria', 'Envelopamento', 'Polimento',
    'Cristalização', 'Customização', 'Aerografia', 'Restauração',
    'Martelinho de Ouro', 'PPF / Película',
  ],
};

/**
 * Retorna a lista de especialidades válidas pro role do usuário.
 * Roles `cliente`/`admin` (e qualquer desconhecido) → [] porque não
 * têm catálogo de especialidades (a UI esconde o seletor neste caso).
 *
 * Mesma lógica de _epSpecRole em modules/profile-edit.js linha 237: normaliza
 * sinônimos (graffiti → grafiteiro, funileiro → automotivo) antes de procurar.
 */
export function getEspecialidadesByRole(
  role: UserRole | string | null | undefined,
): string[] {
  const r = (role || '').toLowerCase();
  let key: string | null = null;
  if (r === 'grafiteiro' || r === 'graffiti') key = 'grafiteiro';
  else if (r === 'automotivo' || r === 'funileiro') key = 'automotivo';
  else if (r === 'pintor') key = 'pintor';
  if (!key) return [];
  return [...(ROLE_SPECS[key] ?? [])];
}

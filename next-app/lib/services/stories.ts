// stories.ts — service layer pra feature "Stories" (estilo Instagram).
// Porta o subset do vanilla `modules/stories.js`:
//   - fetchStoriesGroupedByUser: lê posts com media_type='story' das últimas
//     24h dos follows + próprio user, agrupa por user_id, ordena own→unseen→seen;
//   - markStorySeen: atualiza `profiles.seen_stories` (jsonb) com timestamp
//     do owner do grupo (mesmo shape do vanilla `_seenStories[uid] = ts`);
//   - uploadStory: cria post novo com media_type='story' (igual ao fluxo
//     vanilla showModal('post-modal') quando é story) — upload pro bucket
//     `posts` + insert na tabela `posts` com status='approved'.
//
// O `seen_stories` é jsonb (objeto { [ownerId]: timestamp_ms }) — mesma
// shape do vanilla pra que o usuário que alterna entre web e app não veja
// stories já vistos.
//
// Tipos INLINE neste arquivo (não em lib/types.ts) por instrução do spec.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import { normalizarArquivo } from '@/lib/utils/mediaType';

// ─── Tipos inline ──────────────────────────────────────────────────────────

// Subset de columns que o feed de stories puxa de `posts`. Espelha o select
// usado em DB.posts.getStories (db.js linha 284) — não inclui caption porque
// stories não mostram texto no viewer.
export interface StoryRow {
  id: string;
  user_id: string;
  media_url: string | null;
  media_type: string | null;
  // S5: link externo do story (CTA "ver mais"). Definido na publicação.
  link_url?: string | null;
  created_at: string;
  /** Fotos do mesmo post de 24h (Wave 57). O viewer não lê: cada uma vira
   *  uma tela própria em `expandirFotosDoStory`. */
  media_urls?: string[] | null;
  /** Id do post de origem. Igual a `id`, menos nas telas 2..N de um story
   *  com várias fotos, cujo `id` ganha o sufixo `:<n>` (chave de render). */
  post_id?: string;
}

/**
 * Um post de 24h com várias fotos vira VÁRIAS telas no viewer, uma por foto,
 * na ordem (2026-09-26, relato do usuário: "deixa adicionar múltiplos e
 * publicar, mas aparece apenas 1"). O composer sempre gravou todas em
 * `media_urls`; o viewer só lia `media_url` (a 1ª). Mesmo `created_at` em
 * todas, então o "visto" (por timestamp) continua valendo igual.
 */
export function expandirFotosDoStory(r: StoryRow): StoryRow[] {
  const extras = (r.media_urls || []).filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  );
  const urls = Array.from(new Set([r.media_url, ...extras].filter((u): u is string => !!u)));
  if (urls.length <= 1) return [{ ...r, post_id: r.id }];
  return urls.map((url, i) => ({
    ...r,
    id: i === 0 ? r.id : `${r.id}:${i}`,
    post_id: r.id,
    media_url: url,
  }));
}

// Profile mínimo pra renderizar avatar+nome no carrossel + viewer.
export interface StoryProfile {
  id: string;
  name: string | null;
  tag: string | null;
  avatar_url: string | null;
}

// Grupo agregado por usuário (1 user → N stories ordenados ASC por created_at).
// `seen` é derivado do `seen_stories` do viewer no fetch — encapsulado aqui
// pra o caller não ter que cruzar maps. `isOwn` simplifica a ordenação na UI.
export interface StoryGroup {
  user_id: string;
  profile: StoryProfile;
  stories: StoryRow[];
  seen: boolean;
  isOwn: boolean;
}

const STORY_COLS = 'id, user_id, media_url, media_type, link_url, created_at';
const PROFILE_COLS = 'id, name, tag, avatar_url';
const STORY_BUCKET = 'posts';

/**
 * Busca todos os stories ativos (últimas 24h) do `viewerId` + dos
 * `followingIds`, agrupa por user_id, ordena:
 *   1) próprio user primeiro (se tiver stories);
 *   2) depois grupos com pelo menos 1 story não-visto;
 *   3) por último grupos totalmente vistos.
 *
 * Internamente cruza com `profiles.seen_stories` (jsonb com timestamps por
 * owner). Um grupo é considerado "visto" se o timestamp do seen é >= ao
 * created_at do último story do grupo — mesma lógica do vanilla
 * isStoryGroupSeen, mas mais precisa: garante que stories novos publicados
 * depois da última visita reabram o anel.
 *
 * Retorna [] se viewerId vazio (UI sem auth não tem stories pra mostrar).
 */
export async function fetchStoriesGroupedByUser(
  viewerId: string,
  followingIds: string[],
): Promise<StoryGroup[]> {
  if (!viewerId) return [];

  const sb = getSupabase();
  // Universo: próprio user + follows. dedupe defensivo pra evitar `in()` com
  // duplicatas (o Postgres aceita mas economiza payload).
  const feedIds = Array.from(new Set([viewerId, ...followingIds])).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (feedIds.length === 0) return [];

  // Janela de 24h, mesmo padrão do vanilla loadStories (modules/stories.js:38).
  const sinceISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const buscar = (cols: string) =>
    sb
      .from('posts')
      .select(cols)
      .eq('media_type', 'story')
      .in('user_id', feedIds)
      .gte('created_at', sinceISO)
      .not('media_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(100);

  let { data: storiesData, error: storiesErr } = await buscar(`${STORY_COLS}, media_urls`);
  // `media_urls` (Wave 57) ausente → só a 1ª foto, como antes.
  if (storiesErr && (storiesErr as { code?: string }).code === '42703') {
    ({ data: storiesData, error: storiesErr } = await buscar(STORY_COLS));
  }

  if (storiesErr) {
    throw new NetworkError(storiesErr.message, storiesErr);
  }
  const rows = ((storiesData ?? []) as unknown as StoryRow[]).flatMap(expandirFotosDoStory);
  // IMPORTANTE: não fazer early-return quando rows=[]. Mesmo sem story na
  // janela de 24h, queremos renderizar bolinhas dos seguidos (com anel cinza)
  // pro user ter quick-link pros perfis. Vanilla faz a mesma coisa
  // (modules/stories.js linha 154+).

  // Profiles: fetch pra TODOS os followingIds + viewer (não só quem tem story).
  // Vanilla também faz isso (modules/stories.js linha 60) — renderiza follow
  // sem story como bolinha cinza no carrossel pra o usuário ter um quick-link
  // pro perfil. Sem isso, a fila de stories fica vazia/só com "Seu story" e
  // dá impressão de que ninguém é seguido.
  const allKnownIds = Array.from(new Set([...rows.map((r) => r.user_id), ...feedIds]));
  // profiles_public (não `profiles` direto): a policy de SELECT de `profiles`
  // é restrita a dono/admin (privacy audit 2026-09-17) — ler dados de OUTROS
  // usuários (todo mundo que a pessoa segue) precisa passar pela view pública.
  const { data: profilesData, error: profilesErr } = await sb
    .from('profiles_public')
    .select(PROFILE_COLS)
    .in('id', allKnownIds);
  if (profilesErr) {
    throw new NetworkError(profilesErr.message, profilesErr);
  }
  const profileById = new Map<string, StoryProfile>();
  (profilesData ?? []).forEach((p) => {
    const prof = p as StoryProfile;
    profileById.set(prof.id, prof);
  });

  // `seen_stories` do viewer (jsonb). Default {} pra usuário novo ou se RLS
  // bloqueou (raro — RLS de profiles permite self-select). Sem throw aqui
  // porque "sem seen state" só significa que tudo aparece como unseen — UX
  // ruim mas não erro fatal.
  const seenMap = await fetchSeenMap(viewerId);

  // Agrupa por user_id mantendo a ordem ASC interna.
  const grouped = new Map<string, StoryGroup>();
  for (const r of rows) {
    let group = grouped.get(r.user_id);
    if (!group) {
      const prof = profileById.get(r.user_id) ?? {
        id: r.user_id,
        name: null,
        tag: null,
        avatar_url: null,
      };
      group = {
        user_id: r.user_id,
        profile: prof,
        stories: [],
        seen: false,
        isOwn: r.user_id === viewerId,
      };
      grouped.set(r.user_id, group);
    }
    group.stories.push(r);
  }

  // Compute `seen` por grupo: precisa que o timestamp salvo seja >= ao
  // created_at do último story (pra que stories novos reabram o anel).
  for (const g of grouped.values()) {
    const lastTs = Date.parse(g.stories[g.stories.length - 1]!.created_at);
    const seenTs = seenMap[g.user_id];
    g.seen = typeof seenTs === 'number' && !Number.isNaN(lastTs) && seenTs >= lastTs;
  }

  // Ordenação final: own → unseen → seen (mantém ordem interna de cada bucket
  // por created_at do primeiro story DESC — quem postou mais recente aparece
  // primeiro dentro de cada grupo).
  const own: StoryGroup[] = [];
  const unseen: StoryGroup[] = [];
  const seen: StoryGroup[] = [];
  for (const g of grouped.values()) {
    if (g.isOwn) own.push(g);
    else if (g.seen) seen.push(g);
    else unseen.push(g);
  }
  const byRecency = (a: StoryGroup, b: StoryGroup) =>
    Date.parse(b.stories[0]!.created_at) - Date.parse(a.stories[0]!.created_at);
  unseen.sort(byRecency);
  seen.sort(byRecency);

  // Followed sem story — vira bolinha cinza "seen" com avatar do perfil,
  // só pro user ter quick-link. Não adiciona o próprio viewer aqui (já
  // tratado pelo carrossel via SelfStoryAvatar).
  const noStory: StoryGroup[] = [];
  for (const id of followingIds) {
    if (id === viewerId) continue;
    if (grouped.has(id)) continue;
    const prof =
      profileById.get(id) ?? { id, name: null, tag: null, avatar_url: null };
    noStory.push({
      user_id: id,
      profile: prof,
      stories: [],
      seen: true,
      isOwn: false,
    });
  }
  // Ordena os "sem story" alfabeticamente pelo nome/tag pra ficar estável
  // entre fetches (sem timestamp pra comparar).
  noStory.sort((a, b) => {
    const an = (a.profile.tag || a.profile.name || a.user_id).toLowerCase();
    const bn = (b.profile.tag || b.profile.name || b.user_id).toLowerCase();
    return an.localeCompare(bn);
  });

  return [...own, ...unseen, ...seen, ...noStory];
}

/**
 * Marca o grupo de stories do `ownerId` como visto pelo `viewerId`.
 * Atualiza `profiles.seen_stories[ownerId] = lastStoryCreatedAtMs` (ou
 * `Date.now()` quando o caller não tem o timestamp).
 *
 * Read-modify-write do jsonb (mesma estratégia do archive). RLS já restringe
 * UPDATE em `profiles` ao dono (auth.uid()=id) então não precisamos validar
 * permissão aqui. `lastStoryId` é opcional e serve só pra rastreamento futuro
 * (analytics) — não é usado no shape do jsonb por compat com o vanilla.
 */
export async function markStorySeen(
  viewerId: string,
  storyGroupOwnerId: string,
  lastStoryId?: string,
): Promise<void> {
  if (!viewerId) throw new ValidationError('viewerId obrigatório');
  if (!storyGroupOwnerId) throw new ValidationError('storyGroupOwnerId obrigatório');
  // lastStoryId é só pra trace — descartado aqui mas mantido no shape pra
  // facilitar plug de analytics depois sem mudar callers.
  void lastStoryId;

  const sb = getSupabase();
  const current = await fetchSeenMap(viewerId);
  const next = { ...current, [storyGroupOwnerId]: Date.now() };

  const { error } = await sb
    .from('profiles')
    .update({ seen_stories: next })
    .eq('id', viewerId);
  if (error) {
    throw new NetworkError(error.message, error);
  }
}

/**
 * Upload de mídia + insert da row na `posts` com media_type='story'.
 * Não força status='approved' explicitamente porque a default da coluna
 * pode estar configurada via trigger; quando o post entra como 'pending'
 * o vanilla também esconde até moderar — comportamento aceitável.
 *
 * Path layout: `<userId>/story_<timestamp>.<ext>` — userId no prefixo é
 * exigido pelas storage policies do bucket `posts` (auth.uid()::text =
 * (storage.foldername(name))[1]).
 *
 * Retorna o id do post criado pra que a UI atualize a lista local sem
 * refetch.
 */
export async function uploadStory(
  userId: string,
  file: File,
  mediaType: 'image' | 'video',
): Promise<string> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('Arquivo obrigatório');
  // type vazio (seletor do app) subiria como octet-stream e o
  // allowed_mime_types do bucket recusaria o story.
  file = await normalizarArquivo(file);
  if (mediaType !== 'image' && mediaType !== 'video') {
    throw new ValidationError("mediaType deve ser 'image' ou 'video'");
  }
  // 50MB cap igual ao limit do bucket `posts` em produção.
  if (file.size > 50 * 1024 * 1024) {
    throw new ValidationError('Arquivo muito grande (máx 50MB)');
  }

  const sb = getSupabase();
  const ext = (file.name.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg'))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || (mediaType === 'video' ? 'mp4' : 'jpg');
  const path = `${userId}/story_${Date.now()}.${ext}`;

  const upload = await sb.storage
    .from(STORY_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (upload.error) {
    throw new NetworkError(upload.error.message, upload.error);
  }

  const { data: pub } = sb.storage.from(STORY_BUCKET).getPublicUrl(path);
  const mediaUrl = pub?.publicUrl;
  if (!mediaUrl) {
    throw new NetworkError('Falha ao gerar URL pública do story');
  }

  const { data, error } = await sb
    .from('posts')
    .insert({
      user_id: userId,
      media_url: mediaUrl,
      media_type: 'story',
      caption: null,
    })
    .select('id')
    .single();
  if (error) {
    throw new NetworkError(error.message, error);
  }
  const id = (data as { id?: string } | null)?.id;
  if (!id) {
    throw new NetworkError('Insert não retornou id');
  }
  return id;
}

// ─── Helpers privados ──────────────────────────────────────────────────────

// Lê o map de stories vistos do perfil. Não throwa: viewer sem permissão pra
// ler própria seen_stories é cenário hipotético (RLS permite self), e degradar
// pra {} só faz o anel aparecer como unseen — UX ruim mas não fatal.
async function fetchSeenMap(viewerId: string): Promise<Record<string, number>> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('seen_stories')
    .eq('id', viewerId)
    .maybeSingle();
  if (error) return {};
  const raw = (data as { seen_stories?: unknown } | null)?.seen_stories;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

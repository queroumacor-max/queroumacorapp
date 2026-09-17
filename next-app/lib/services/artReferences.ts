// art-references — biblioteca de imagens de arte (referências) do pintor
// pra usar em overlay AR (sprint 2). Storage no bucket `art-refs` do
// Supabase Storage; metadata em public.art_references.
//
// Path no bucket: `${userId}/${randomUuid}.${ext}` — RLS exige isso
// porque a policy verifica (storage.foldername(name))[1] = auth.uid().

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import { normalizarArquivo } from '@/lib/utils/mediaType';
import { sha256Hex } from '@/lib/utils/sha256';
import { assertMediaApproved } from '@/lib/services/moderateMedia';

export interface ArtReference {
  id: string;
  user_id: string;
  title: string | null;
  image_url: string;
  tags: string[];
  width: number | null;
  height: number | null;
  created_at: string;
}

const BUCKET = 'art-refs';
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 20 * 1024 * 1024; // 20MB (alinhado com bucket)

interface AnyRow {
  id: string;
  user_id: string;
  title: string | null;
  image_url: string;
  tags: string[] | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

// Cast manual igual ao product_variants — tabela ainda fora do schema TS gen.
function artClient() {
  return getSupabase() as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => PromiseLike<{
            data: AnyRow[] | null;
            error: { message: string } | null;
          }>;
        };
      };
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => PromiseLike<{
            data: AnyRow | null;
            error: { message: string } | null;
          }>;
        };
      };
      delete: () => {
        eq: (col: string, val: string) => PromiseLike<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

function rowToArt(r: AnyRow): ArtReference {
  return {
    id: r.id,
    user_id: r.user_id,
    title: r.title,
    image_url: r.image_url,
    tags: r.tags ?? [],
    width: r.width,
    height: r.height,
    created_at: r.created_at,
  };
}

/** Lista as artes do user logado (mais recentes primeiro). */
export async function listMyArtReferences(userId: string): Promise<ArtReference[]> {
  if (!userId) return [];
  const { data, error } = await artClient()
    .from('art_references')
    .select('id, user_id, title, image_url, tags, width, height, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new NetworkError(error.message, error);
  return (data ?? []).map(rowToArt);
}

/**
 * Upload de arquivo no bucket + insert no art_references. Devolve a row
 * criada. Path do storage = `${userId}/${uuid}.${ext}` pra RLS bater.
 */
export async function uploadArtReference(params: {
  userId: string;
  file: File;
  title?: string | null;
  tags?: string[];
  dimensions?: { width: number; height: number } | null;
}): Promise<ArtReference> {
  const { userId, title, tags = [], dimensions } = params;
  let { file } = params;
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('file obrigatório');
  // O seletor do app instalado entrega a foto SEM MIME type. Sem esta
  // normalização, três coisas quebravam de uma vez: a checagem abaixo
  // recusava ("Formato não suportado"), a extensão saía sempre .jpg e o
  // upload subia com content type vazio (que o bucket recusa).
  file = await normalizarArquivo(file);
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new ValidationError('Formato não suportado. Use JPG, PNG ou WebP.');
  }
  if (file.size > MAX_BYTES) {
    throw new ValidationError('Arquivo maior que 20MB.');
  }

  // Path: userId/uuid.ext — RLS exige primeiro segmento = auth.uid().
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectId = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '');
  const path = `${userId}/${objectId}.${ext}`;

  // Hash em paralelo com o upload (mesmo padrão de uploadMedia/uploadAvatar)
  // — 2026-09-17, extensão da auditoria CSAM: ver
  // enforce_art_reference_hash_blocklist. Falha em calcular não bloqueia o
  // upload, só grava image_hash vazio.
  const hashPromise = sha256Hex(file);

  const sb = getSupabase();
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) throw new NetworkError(upErr.message, upErr);

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const imageUrl = pub.publicUrl;
  const imageHash = (await hashPromise) || null;

  // Checagem AUTORITATIVA (2026-09-17, achado do Codex na revisão da PR
  // que estendeu a blocklist de hash CSAM pra esta tabela): o trigger do
  // banco confia no `image_hash` que O CLIENTE manda, e RLS deixa o dono
  // inserir a própria linha direto via PostgREST — falsificável, só não
  // mandar o hash certo. `/api/moderate` baixa o arquivo e calcula o hash
  // NO SERVIDOR (não confia em `imageHash` pra decidir nada, só grava ele
  // depois no banco), então é essa chamada que fecha a checagem de
  // verdade. Reprovado → limpa o storage (senão vira arquivo órfão
  // público) e propaga o erro; a mesma limpeza que já existe pra falha de
  // insert, mais abaixo.
  try {
    await assertMediaApproved({ mediaUrl: imageUrl });
  } catch (e) {
    sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw e;
  }

  const row: Record<string, unknown> = {
    user_id: userId,
    title: title ?? null,
    image_url: imageUrl,
    image_hash: imageHash,
    tags,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
  let { data, error } = await artClient()
    .from('art_references')
    .insert(row)
    .select('id, user_id, title, image_url, tags, width, height, created_at')
    .single();
  // Tolera migration pendente: `image_hash` é coluna nova (2026-09-17) —
  // se ainda não rodou, o insert falha com "Could not find the
  // 'image_hash' column" e a biblioteca de artes pararia de aceitar
  // upload por causa de um recurso que ninguém pediu ainda. Mesmo padrão
  // de updateProfile em profile.ts.
  if (error && /Could not find the 'image_hash' column/i.test(error.message || '')) {
    // Objeto NOVO (não mutar `row` in-place) — quem chamou `insert(row)` na
    // 1ª tentativa pode ter guardado a referência (ex.: spy de teste, log);
    // mutar o mesmo objeto reescreveria a história da 1ª chamada.
    const rowSemHash: Record<string, unknown> = { ...row };
    delete rowSemHash.image_hash;
    ({ data, error } = await artClient()
      .from('art_references')
      .insert(rowSemHash)
      .select('id, user_id, title, image_url, tags, width, height, created_at')
      .single());
  }
  if (error) {
    // Best-effort cleanup do storage se o insert falhou (não deixa órfão).
    sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new NetworkError(error.message, error);
  }
  return rowToArt(data!);
}

/**
 * Apaga uma arte (row + arquivo no storage). Idempotente — se o arquivo
 * já não existe, ignora o erro do remove.
 */
export async function deleteArtReference(ref: ArtReference): Promise<void> {
  if (!ref?.id) throw new ValidationError('id obrigatório');
  // Extrai o path do publicUrl: .../storage/v1/object/public/art-refs/<path>
  const m = ref.image_url.match(/\/art-refs\/(.+)$/);
  const path = m?.[1] ?? null;

  const { error } = await artClient()
    .from('art_references')
    .delete()
    .eq('id', ref.id);
  if (error) throw new NetworkError(error.message, error);

  if (path) {
    const sb = getSupabase();
    sb.storage.from(BUCKET).remove([path]).catch(() => {});
  }
}

/** Lê width/height de um File de imagem antes do upload (CLS=0 no AR). */
export function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

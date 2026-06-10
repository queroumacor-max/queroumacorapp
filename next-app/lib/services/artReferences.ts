// art-references — biblioteca de imagens de arte (referências) do pintor
// pra usar em overlay AR (sprint 2). Storage no bucket `art-refs` do
// Supabase Storage; metadata em public.art_references.
//
// Path no bucket: `${userId}/${randomUuid}.${ext}` — RLS exige isso
// porque a policy verifica (storage.foldername(name))[1] = auth.uid().

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';

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
  const { userId, file, title, tags = [], dimensions } = params;
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('file obrigatório');
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

  const sb = getSupabase();
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) throw new NetworkError(upErr.message, upErr);

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const imageUrl = pub.publicUrl;

  const { data, error } = await artClient()
    .from('art_references')
    .insert({
      user_id: userId,
      title: title ?? null,
      image_url: imageUrl,
      tags,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    })
    .select('id, user_id, title, image_url, tags, width, height, created_at')
    .single();
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

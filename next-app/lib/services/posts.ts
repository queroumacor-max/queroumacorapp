// posts.ts — service layer pro fluxo de publicar post no feed (composer).
// Espelha o subset de modules/feed-publish.js do vanilla:
//   - publishPost  → createPost (insert na tabela `posts`)
//   - upload file  → uploadMedia (bucket Supabase `posts`, path
//                    `<user_id>/<ts>.<ext>`, contentType explícito; o SQL do
//                    bucket aceita image/jpeg|png|webp|gif|heic|heif +
//                    video/mp4|quicktime|webm, file_size_limit 50MB).
//   - frame de vídeo p/ legenda IA → extractVideoThumbnail (canvas).
//   - gerar legenda → generateCaption (POST multipart /api/caption — endpoint
//                    aceita só imagem; pra vídeo o caller já passa um frame
//                    extraído como Blob; aqui o service recebe URLs já
//                    publicadas e baixa a primeira imagem para enviar).
//
// Decisões:
//   - Validação (size/count) fica AQUI e no componente (defense in depth);
//     o componente bloqueia cedo pra UX e o service repete pra blindar
//     chamadas programáticas/testes futuros.
//   - getMediaType reusa o helper de lib/utils.ts (sem duplicar regex).
//   - Compressão de imagem (>2MB) é exposta como helper `compressImage` pra
//     o componente chamar antes do upload — service em si NÃO comprime
//     automático pra não esconder side-effects (caller decide).
//   - createPost NÃO faz moderação aqui: o trigger de moderação roda
//     server-side no vanilla via /api/moderate-* — quando migrar essa etapa
//     pro Next, vira chamada antes do insert. Por ora insere com
//     status='approved' (mantém paridade com vanilla quando moderação OK).

import { getSupabase } from '@/lib/supabase';
import {
  ValidationError,
  AuthenticationError,
  NetworkError,
  ConfigError,
} from '@/lib/errors';
import { getMediaType } from '@/lib/utils';

// Limites alinhados com o bucket `posts` no Supabase (CLAUDE.md confirma:
// allowed_mime_types image/jpeg|png|webp|gif|heic|heif + video/mp4|quicktime|webm,
// file_size_limit 50 MB).
export const MAX_FILE_BYTES = 50 * 1024 * 1024;          // 50 MB hard limit
export const MAX_IMAGES = 5;                              // limite UI: até 5 fotos
export const COMPRESS_THRESHOLD = 2 * 1024 * 1024;        // >2MB → recomprimir
export const COMPRESS_MAX_DIM = 1920;                     // lado maior pós-resize
export const COMPRESS_QUALITY = 0.85;                     // JPEG quality

// Mime types aceitos no bucket. Mantemos aqui pra validar ANTES do upload
// (Supabase rejeita com 400 silencioso se não bater — preferimos erro claro).
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

export interface UploadMediaResult {
  url: string;
  mediaType: 'image' | 'video';
  path: string; // path no bucket (útil pra cleanup em rollback)
  // Wave 29 (C4): SHA-256 hex do binário, calculado ANTES do upload.
  // Usado pra (1) gravar em `posts.media_hash` (audit/dedup) e (2)
  // permitir lookup futuro contra `media_hash_blocklist`. Pode ser
  // string vazia se crypto.subtle não estiver disponível (raro;
  // browsers modernos têm).
  mediaHash: string;
}

/**
 * SHA-256 hex de um File via crypto.subtle. Edge/browser friendly.
 * Retorna string vazia se a API não estiver disponível ou arquivo vazio
 * (caller decide se trata como blocker — uploadMedia segue mesmo sem hash).
 */
async function sha256Hex(file: File): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  try {
    const buf = await file.arrayBuffer();
    if (buf.byteLength === 0) return '';
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const h = bytes[i].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;
  } catch {
    return '';
  }
}

/**
 * Sobe um arquivo (imagem ou vídeo) pro bucket `posts`. Path determinístico
 * `<userId>/<Date.now()>.<ext>` evita colisão e permite RLS por prefixo.
 *
 * Erros:
 *   - ValidationError: userId vazio, file nulo, tipo não aceito, > MAX_FILE_BYTES
 *   - NetworkError: falha do storage (RLS, quota, rede)
 */
export async function uploadMedia(
  userId: string,
  file: File
): Promise<UploadMediaResult> {
  if (!userId) throw new AuthenticationError('Faça login para publicar.');
  if (!file) throw new ValidationError('Arquivo ausente.');
  if (file.size > MAX_FILE_BYTES) {
    throw new ValidationError(
      `Arquivo grande demais (máx ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB).`
    );
  }

  const mediaType = getMediaType(file);
  // Mime explícito quando o browser preenche; fallback pelo getMediaType.
  const mime =
    file.type ||
    (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');

  // Defense in depth: o bucket também filtra, mas erro nosso é mais legível.
  const allowed =
    mediaType === 'video'
      ? ALLOWED_VIDEO_MIMES.has(mime)
      : ALLOWED_IMAGE_MIMES.has(mime);
  if (!allowed) {
    throw new ValidationError(`Tipo de arquivo não aceito: ${mime}`);
  }

  const ext =
    (file.name?.split('.').pop()?.toLowerCase() || '').replace(/[^a-z0-9]/g, '') ||
    (mediaType === 'video' ? 'mp4' : 'jpg');
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Wave 29: SHA-256 do binário ANTES do upload. Calcula em paralelo
  // com o upload pra não inflar latência (hash de 1-5MB ~50ms; upload
  // ~200ms-2s na rede móvel).
  const sb = getSupabase();
  const [hashResult, uploadResult] = await Promise.all([
    sha256Hex(file),
    sb.storage.from('posts').upload(path, file, {
      contentType: mime,
      upsert: false,
    }),
  ]);
  if (uploadResult.error) {
    throw new NetworkError(
      uploadResult.error.message || 'Falha ao subir mídia.',
      uploadResult.error,
    );
  }
  const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
  if (!urlData?.publicUrl) {
    throw new NetworkError('Bucket não devolveu publicUrl.');
  }
  return { url: urlData.publicUrl, mediaType, path, mediaHash: hashResult };
}

/**
 * Extrai um frame ~25% dentro do vídeo via <video> + canvas, retorna Blob JPG.
 * Port direto do vanilla _extractVideoFrame. SSR-safe: estoura cedo se chamado
 * sem `document` (caller só usa no browser, mas a guarda evita falhas crípticas
 * em testes Node sem jsdom).
 */
export function extractVideoThumbnail(file: File): Promise<Blob> {
  if (typeof document === 'undefined') {
    return Promise.reject(
      new ConfigError('extractVideoThumbnail só roda no browser.')
    );
  }
  return new Promise<Blob>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    let done = false;
    const cleanup = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    };
    const fail = (msg: string) => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('timeout lendo vídeo'), 15_000);
    v.addEventListener('loadedmetadata', () => {
      const target = Math.min(1, Math.max(0, (v.duration || 2) * 0.25));
      try {
        v.currentTime = target;
      } catch {
        v.currentTime = 0;
      }
    });
    v.addEventListener('seeked', () => {
      if (done) return;
      try {
        const w = v.videoWidth || 720;
        const h = v.videoHeight || 1280;
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const cw = Math.round(w * scale);
        const ch = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext('2d');
        if (!ctx) {
          fail('canvas sem contexto 2d');
          return;
        }
        ctx.drawImage(v, 0, 0, cw, ch);
        c.toBlob(
          (blob) => {
            done = true;
            clearTimeout(timer);
            cleanup();
            if (!blob) {
              reject(new Error('canvas vazio'));
              return;
            }
            resolve(blob);
          },
          'image/jpeg',
          0.85
        );
      } catch (e) {
        fail('canvas: ' + (e instanceof Error ? e.message : String(e)));
      }
    });
    v.addEventListener('error', () => fail('vídeo não carregou'));
  });
}

/**
 * Lê width/height naturais de um File de imagem via <img>. Retorna null
 * pra files não-imagem ou se a leitura falhar (não bloquia upload — W/H
 * é opcional, posts sem ele caem no aspect-ratio CSS).
 */
export function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!file.type.startsWith('image/')) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    };
    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      cleanup();
      resolve(w > 0 && h > 0 ? { width: w, height: h } : null);
    };
    img.onerror = () => {
      cleanup();
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Comprime imagem via canvas (resize + JPEG q=0.85). Só faz sentido pra
 * imagem; caller decide se chama (típico: file.size > COMPRESS_THRESHOLD).
 * Retorna File novo com mesmo nome trocando ext pra .jpg.
 */
export function compressImage(file: File): Promise<File> {
  if (typeof document === 'undefined') {
    return Promise.reject(
      new ConfigError('compressImage só roda no browser.')
    );
  }
  return new Promise<File>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Falha ao decodificar imagem'));
      img.onload = () => {
        const ratio = Math.min(
          1,
          COMPRESS_MAX_DIM / Math.max(img.width, img.height)
        );
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas sem contexto 2d'));
          return;
        }
        // Fundo branco — JPEG não suporta alpha; PNG com transparência viraria preto.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('canvas vazio'));
              return;
            }
            const baseName = (file.name || 'foto').replace(/\.[^/.]+$/, '');
            resolve(new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          COMPRESS_QUALITY
        );
      };
      img.src = String(e.target?.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export interface GenerateCaptionResult {
  caption: string;
  hashtags: string[];
}

/**
 * POST multipart pra /api/caption com a primeira imagem. Aceita URLs já
 * publicadas (o uploader sobe primeiro, depois gera legenda) — busca o blob
 * e reenvia. Se a primeira URL for vídeo, o caller deve passar uma URL de
 * thumbnail extraído (vanilla faz frame extract antes; aqui mantemos contrato
 * simples: o caller resolve "imagem para enviar" e passa a URL dela).
 *
 * Erros:
 *   - ValidationError: lista vazia ou primeira URL inválida
 *   - NetworkError: fetch da imagem ou da API falhou
 *   - ConfigError: backend devolveu 503 (sem OPENAI_API_KEY)
 */
export async function generateCaption(
  mediaUrls: string[]
): Promise<GenerateCaptionResult> {
  if (!mediaUrls || mediaUrls.length === 0) {
    throw new ValidationError('Selecione uma foto pra gerar a legenda.');
  }
  const first = mediaUrls[0];
  if (!first || typeof first !== 'string') {
    throw new ValidationError('URL de mídia inválida.');
  }

  // Baixa a imagem da URL publicada. Tem que ser CORS-allowed; o bucket
  // `posts` é público então funciona sem token.
  let blob: Blob;
  try {
    const r = await fetch(first);
    if (!r.ok) {
      throw new NetworkError(`Falha ao baixar mídia (${r.status}).`);
    }
    blob = await r.blob();
  } catch (e) {
    if (e instanceof NetworkError) throw e;
    throw new NetworkError(
      e instanceof Error ? e.message : 'Falha ao baixar mídia.',
      e
    );
  }

  const fd = new FormData();
  fd.append('image', blob, 'foto.jpg');

  let res: Response;
  try {
    res = await fetch('/api/caption', { method: 'POST', body: fd });
  } catch (e) {
    throw new NetworkError(
      e instanceof Error ? e.message : 'Falha ao chamar /api/caption',
      e
    );
  }

  if (res.status === 503) {
    throw new ConfigError('IA não configurada no servidor.');
  }
  if (!res.ok) {
    let msg = `API /api/caption respondeu ${res.status}`;
    try {
      const errData = (await res.json()) as { error?: string };
      if (errData?.error) msg = errData.error;
    } catch {
      /* ignore parse error */
    }
    throw new NetworkError(msg);
  }

  // Parse permissivo: backend pode mandar caption sem hashtags ou vice-versa.
  let data: { caption?: unknown; hashtags?: unknown };
  try {
    data = (await res.json()) as { caption?: unknown; hashtags?: unknown };
  } catch {
    throw new NetworkError('Resposta /api/caption inválida (JSON).');
  }
  const caption = typeof data.caption === 'string' ? data.caption.trim() : '';
  const hashtags = Array.isArray(data.hashtags)
    ? data.hashtags.filter((h): h is string => typeof h === 'string')
    : [];
  if (!caption && hashtags.length === 0) {
    throw new ValidationError(
      'IA não devolveu legenda — tente outra mídia.'
    );
  }
  return { caption, hashtags };
}

// ─── createPost ───────────────────────────────────────────────────────────

export type CreatePostMediaType = 'image' | 'video' | 'story';

export interface CreatePostInput {
  userId: string;
  caption: string | null;
  mediaUrls: string[];       // primeira URL vai pra `media_url`; resto ignorado
                             // por ora (schema atual tem só 1 coluna). Quando
                             // posts virarem carrosel, virar tabela
                             // post_media (1-N) — interface já antecipa o N.
  mediaType: CreatePostMediaType;
  // Dimensões da primeira mídia (Wave 17). Frontend usa pra setar
  // <img width height> e eliminar CLS. Opcional pra compat com posts
  // sem captura (vídeo, ou caller antigo).
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  // Wave 29 (C4): SHA-256 hex da primeira mídia. Opcional pra compat
  // com posts sem mídia ou caller antigo. Gravado em `posts.media_hash`
  // pra rastrear reuploads e habilitar lookup futuro no blocklist.
  mediaHash?: string | null;
  forSale?: boolean;
  price?: number | null;
  artType?: string | null;
  // Wave 20 / S5: link externo do story (CTA "ver mais").
  linkUrl?: string | null;
}

export interface CreatePostResult {
  id: string;
  media_url: string | null;
}

/**
 * Insere uma linha em `posts`. Status default 'approved' (paridade com
 * vanilla quando moderação OK ou sem mídia). Validação:
 *   - userId obrigatório
 *   - story exige pelo menos 1 mídia
 *   - post sem mídia exige caption (paridade com publishPost vanilla)
 *   - forSale=true exige price > 0 e artType não-vazio
 */
export async function createPost(
  input: CreatePostInput
): Promise<CreatePostResult> {
  if (!input.userId) throw new AuthenticationError('Faça login para publicar.');

  const caption = (input.caption || '').trim();
  const hasMedia = input.mediaUrls.length > 0;

  if (input.mediaType === 'story' && !hasMedia) {
    throw new ValidationError('Story exige uma imagem.');
  }
  if (input.mediaType !== 'story' && !hasMedia && !caption) {
    throw new ValidationError('Adicione uma imagem ou texto.');
  }

  if (input.forSale) {
    if (!input.price || input.price <= 0) {
      throw new ValidationError('Informe o preço pra publicar como venda.');
    }
    if (!input.artType) {
      throw new ValidationError('Selecione o tipo de arte.');
    }
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('posts')
    .insert({
      user_id: input.userId,
      caption: caption || null,
      media_url: input.mediaUrls[0] || null,
      media_type: input.mediaType,
      // Wave 17: grava W/H se o caller capturou no upload. Permite
      // <img width height> no feed sem onLoad → CLS zero.
      media_width: input.mediaWidth ?? null,
      media_height: input.mediaHeight ?? null,
      // Wave 29 (C4): SHA-256 da primeira mídia (gravado pra dedup +
      // futura integração com blocklist).
      media_hash: input.mediaHash ?? null,
      // Wave 20 / S5: link externo. Schema impõe sanidade (http/https
      // validado no client antes daqui).
      link_url: input.linkUrl ?? null,
      status: 'approved',
      for_sale: !!input.forSale,
      price: input.forSale && input.price ? input.price : null,
      art_type: input.forSale && input.artType ? input.artType : null,
      created_at: new Date().toISOString(),
    } as never)
    .select('id, media_url')
    .single();

  if (error) {
    throw new NetworkError(error.message || 'Falha ao publicar.', error);
  }
  if (!data) {
    throw new NetworkError('Insert sem retorno.');
  }
  return data as CreatePostResult;
}

// chat-attachments.ts — upload de imagens/vídeos/áudios pro bucket `posts`.

import { getSupabase } from '@/lib/supabase';
import { NetworkError, ValidationError } from '@/lib/errors';
import {
  ALLOWED_ATTACHMENT_MIMES,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  MAX_ATTACHMENT_BYTES,
  type AttachmentUploadResult,
} from './chat-types';

/**
 * Faz upload de um attachment pro bucket `posts` (path
 * `<userId>/chat/<timestamp>.<ext>` — policy do bucket exige user_id como
 * 1º segmento). Retorna URL pública + tipo MIME pra caller mapear pra
 * MessageType.
 *
 * Validações:
 *  - Tipo MIME na allowlist (imagem/vídeo/áudio).
 *  - Tamanho ≤ MAX_ATTACHMENT_BYTES (10MB).
 *  - userId obrigatório (caller passa do AuthProvider).
 */
export async function uploadAttachment(
  userId: string,
  file: File,
): Promise<AttachmentUploadResult> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('Arquivo obrigatório');
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ValidationError(
      `Arquivo muito grande (máx ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`,
    );
  }
  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_ATTACHMENT_MIMES.includes(mime)) {
    throw new ValidationError('Tipo de arquivo não permitido');
  }

  const sb = getSupabase();
  // Path: user_id é OBRIGATÓRIO como 1º segmento pra storage policy aceitar.
  // ext: pega depois do último ponto; sanitiza pra não escapar do path.
  const rawName = file.name || 'arquivo';
  const dot = rawName.lastIndexOf('.');
  const ext = (dot >= 0 ? rawName.slice(dot + 1) : 'bin')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const path = `${userId}/chat/${Date.now()}.${ext || 'bin'}`;

  const { error } = await sb.storage.from('posts').upload(path, file, {
    upsert: true,
    contentType: mime,
  });
  if (error) throw new NetworkError(error.message, error);

  const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
  const url = urlData?.publicUrl ?? '';
  if (!url) throw new NetworkError('URL pública não disponível');

  let messageType: 'image' | 'video' | 'audio';
  if (ALLOWED_IMAGE_MIMES.includes(mime)) messageType = 'image';
  else if (ALLOWED_VIDEO_MIMES.includes(mime)) messageType = 'video';
  else messageType = 'audio';

  return { url, mimeType: mime, messageType };
}

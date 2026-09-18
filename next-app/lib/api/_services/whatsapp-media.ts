// lib/api/_services/whatsapp-media.ts — traz pro portal a MÍDIA que o
// cliente manda no WhatsApp (foto, áudio, vídeo, documento).
//
// Por que existe: o evento do WhatsApp não carrega o arquivo, só o aviso
// de que existe um. Sem isso o webhook gravaria só um marcador de texto —
// "[áudio]", "[imagem]" — e o arquivo ficaria só no celular da loja. Quem
// atendia pelo portal responderia sem ter visto a foto da parede.
//
// Caminho (Cloud API/Dualhook, ver `baixarMidiaCloudApi` no fim do
// arquivo): a Meta manda só um `id`; os bytes se buscam em dois passos
// (`GET /{id}` devolve URL temporária, a URL entrega o arquivo) → bucket
// `whatsapp-media` no Supabase Storage → o path fica em
// `whatsapp_messages.media_url`. O portal pede uma URL assinada na hora de
// mostrar; o bucket é PRIVADO, porque é conversa de cliente, não conteúdo
// público.
//
// Áudio ainda passa pelo Whisper: a transcrição vai pra coluna
// `transcript`, aparece embaixo do player e — o que mais importa — entra
// no histórico que a IA lê. Sem isso ela respondia como se o cliente
// tivesse ficado calado.
//
// TUDO best-effort: qualquer falha aqui devolve o que já tem e a mensagem
// é gravada mesmo assim, com o marcador de antes. Mídia perdida é chato;
// webhook falhando é pior.
//
// O caminho da Evolution API (base64 dentro do próprio evento do webhook,
// ou buscado num endpoint dela) foi removido em 2026-09-17 (limpeza de
// código morto): zero call site fora deste arquivo e dos testes desde a
// migração pra Cloud API/Dualhook (2026-09-05). Histórico no git.

import { getRuntimeEnv } from '../env';
import { getServiceKey, getSupabaseUrl } from '../security';

export const MEDIA_BUCKET = 'whatsapp-media';

const FETCH_TIMEOUT_MS = 20000;
const WHISPER_TIMEOUT_MS = 25000;
/** Acima disso não vale a pena: o webhook precisa responder rápido. */
export const MAX_MEDIA_BYTES = 12 * 1024 * 1024;
/** Whisper cobra por minuto; áudio gigante quase sempre é engano. */
export const MAX_AUDIO_TRANSCRIBE_BYTES = 8 * 1024 * 1024;

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'application/pdf': 'pdf',
};

/** "audio/ogg; codecs=opus" → "audio/ogg". */
export function mimeBase(mime: string): string {
  return (mime || '').split(';')[0].trim().toLowerCase();
}

export function extensaoDe(mime: string, tipo?: string): string {
  const ext = EXTENSOES[mimeBase(mime)];
  if (ext) return ext;
  if (tipo === 'image') return 'jpg';
  if (tipo === 'audio') return 'ogg';
  if (tipo === 'video') return 'mp4';
  return 'bin';
}

/**
 * Caminho no bucket. Vai pelo message_id, que é único: se a Meta reentregar
 * o mesmo evento, sobrescreve o arquivo em vez de duplicar.
 */
export function caminhoMidia(waId: string, messageId: string, mime: string, tipo?: string): string {
  const id = (messageId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || `${Date.now()}`;
  const num = (waId || 'desconhecido').replace(/\D/g, '') || 'desconhecido';
  return `${num}/${id}.${extensaoDe(mime, tipo)}`;
}

/** Sobe pro bucket privado com a service_role. Devolve o PATH, não a URL. */
export async function subirMidia(
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<string | null> {
  const url = getSupabaseUrl();
  const key = getServiceKey();
  if (!url || !key) return null;
  try {
    const r = await fetch(
      `${url.replace(/\/$/, '')}/storage/v1/object/${MEDIA_BUCKET}/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': mimeBase(mime) || 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: bytes as unknown as BodyInit,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!r.ok) {
      console.warn('wa-media: upload falhou', r.status, (await r.text()).slice(0, 200));
      return null;
    }
    return path;
  } catch (e) {
    console.warn('wa-media: exceção no upload:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Whisper. Devolve '' em qualquer falha — transcrição é bônus. */
export async function transcreverAudio(bytes: Uint8Array, mime: string): Promise<string> {
  const key = getRuntimeEnv('OPENAI_API_KEY') || '';
  if (!key || bytes.length > MAX_AUDIO_TRANSCRIBE_BYTES) return '';
  try {
    const form = new FormData();
    const tipo = mimeBase(mime) || 'audio/ogg';
    form.append('file', new Blob([bytes as unknown as BlobPart], { type: tipo }), `audio.${extensaoDe(tipo, 'audio')}`);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.warn('wa-media: whisper', r.status, (await r.text()).slice(0, 200));
      return '';
    }
    const j = (await r.json()) as { text?: string };
    return (j?.text || '').trim().slice(0, 2000);
  } catch (e) {
    console.warn('wa-media: exceção no whisper:', e instanceof Error ? e.message : e);
    return '';
  }
}

// ─── Cloud API (Meta via Dualhook) ──────────────────────────────────────────
//
// Aqui a mídia NÃO vem no webhook: o evento traz só um `id`, e o arquivo se
// busca em dois passos — `GET /{id}` devolve uma URL temporária, e essa URL
// entrega os bytes. Os dois pedem o mesmo Bearer.
//
// Falha aqui é BEST-EFFORT: a mensagem já foi gravada e aparece na conversa
// com o marcador ("[audio]"). Perder o arquivo degrada; derrubar o webhook
// por causa dele faria a Meta reenviar tudo.

const CLOUD_FETCH_TIMEOUT_MS = 20000;

/**
 * Baixa a mídia de uma mensagem recebida pela Cloud API.
 *
 * O download da URL temporária é feito SEM seguir para outro host sem o
 * header: a URL costuma apontar pro CDN da Meta e exigir o mesmo Bearer.
 * Se o CDN recusar a nossa credencial (a chave é do Dualhook, não da Meta),
 * o corpo da recusa vai pro log — é a única pista pra saber se o caminho
 * precisa de outra credencial.
 */
export async function baixarMidiaCloudApi(
  mediaId: string,
  apiBase: string,
  versao: string,
  token: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!mediaId || !token) return null;
  try {
    const metaRes = await fetch(
      `${apiBase}/${versao}/${encodeURIComponent(mediaId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
      },
    );
    const cru = await metaRes.text().catch(() => '');
    if (!metaRes.ok) {
      console.warn(
        `wa-media: metadados recusados (${metaRes.status}) id=${mediaId}: ${cru.slice(0, 200)}`,
      );
      return null;
    }
    let info: { url?: string; mime_type?: string; file_size?: number };
    try {
      info = JSON.parse(cru) as typeof info;
    } catch {
      console.warn(`wa-media: metadados ilegíveis id=${mediaId}: ${cru.slice(0, 200)}`);
      return null;
    }
    if (!info.url) {
      console.warn(`wa-media: metadados sem url id=${mediaId}`);
      return null;
    }
    // Recusa ANTES de baixar quando a Meta já diz o tamanho: não adianta
    // puxar 40 MB pra descobrir que passa do teto do bucket.
    if (typeof info.file_size === 'number' && info.file_size > MAX_MEDIA_BYTES) {
      console.warn(`wa-media: arquivo grande demais (${info.file_size}) id=${mediaId}`);
      return null;
    }

    const arqRes = await fetch(info.url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CLOUD_FETCH_TIMEOUT_MS),
    });
    if (!arqRes.ok) {
      const corpo = await arqRes.text().catch(() => '');
      console.warn(
        `wa-media: download recusado (${arqRes.status}) id=${mediaId}: ${corpo.slice(0, 200)}`,
      );
      return null;
    }
    const buf = new Uint8Array(await arqRes.arrayBuffer());
    if (buf.length > MAX_MEDIA_BYTES) {
      console.warn(`wa-media: arquivo grande demais (${buf.length}) id=${mediaId}`);
      return null;
    }
    return { bytes: buf, mime: info.mime_type || arqRes.headers.get('content-type') || '' };
  } catch (e) {
    console.warn('wa-media: exceção no download da Cloud API:', e instanceof Error ? e.message : e);
    return null;
  }
}

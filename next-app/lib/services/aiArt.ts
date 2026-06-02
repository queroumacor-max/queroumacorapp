// aiArt.ts — service layer pra feature "Arte pra Instagram".
// Porta modules/ai-art.js do vanilla (openAiArt / gerarArteIG /
// _aiArtComposeWithLogo / _aiArtPost / _aiArtLoadTemplates / _aiArtUploadTemplate
// / créditos diários) num shape testável sem DOM/global state.
//
// O backend (functions/api/ig-art.js + _services/ig-art.js) faz a parte
// pesada (OpenAI gpt-image-1 + fallback Gemini + composição prompt). Aqui só:
//   - normalizamos o input pro contrato do endpoint;
//   - parseamos a resposta e estouramos NetworkError/ValidationError com
//     mensagens limpas pra UI surfar;
//   - oferecemos helpers canvas-only (applyLogoToImage) e supabase-only
//     (fetchTemplates / uploadTemplate / postArtToFeed) pra UI montar fluxo
//     sem importar SDK direto.
//
// Créditos diários: 5/dia (espelho do `gateProAI({ limit: 5 })` em ig-art.js).
// O backend é fonte da verdade — getDailyCreditsUsed/incrementCredits aqui
// servem só pra UX (mostrar contador + bloquear botão quando bate no teto).
// Persiste em localStorage com chave `igArt:credits:<userId>:<YYYY-MM-DD>`,
// mesmo padrão do vanilla `_aiArtCreditsKey()`. Não tenta column de profiles
// porque o spec autoriza fallback localStorage (e é o que evita ter que
// criar coluna nova só pra contador derivável).

import { NetworkError, ValidationError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

// ── Public types ────────────────────────────────────────────────────────────

export type ArtStyle =
  | 'profissional'
  | 'trabalho'
  | 'antesdepois'
  | 'criativo';
export type ArtAspect = 'square' | 'vertical' | 'horizontal';

// Posições suportadas pelo overlay de logo. O vanilla só tinha top-right;
// aqui expomos 4 variantes (default top-right p/ retrocompat).
export type LogoPosition =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export interface GenerateArtInput {
  userId: string;
  style: ArtStyle;
  aspect: ArtAspect;
  photo1: string; // data URL base64 — foto principal
  photo2?: string; // data URL base64 — segunda foto (antes/depois)
  bizName?: string;
  hint?: string;
}

export interface GenerateArtResult {
  imageDataUrl: string;
  caption: string;
  style: string;
  aspect: string;
  model?: string;
}

// Limites diários:
// - Free: 5 (espelha gateProAI({ limit: 5 }) em functions/api/ig-art.js)
// - PRO: 2 por dia (incluído na assinatura). Pra gerar mais, comprar pacote
//   avulso (R$1/imagem, mín R$10) — pacote ainda não está wired.
export const DAILY_CREDITS_LIMIT = 5;
export const PRO_DAILY_LIMIT = 2;

// Quais estilos o backend reconhece. `criativo` é alias do `portrait` do
// backend (mesma composição cinemática) — mapeado abaixo no payload.
const STYLE_TO_BACKEND: Record<ArtStyle, string> = {
  profissional: 'profissional',
  trabalho: 'trabalho',
  antesdepois: 'antesdepois',
  criativo: 'portrait',
};

// ── Generate art (POST /api/ig-art) ────────────────────────────────────────

/**
 * Bate em POST /api/ig-art e devolve a arte gerada (data URL) + legenda.
 *
 * Validação local mínima (defesa em profundidade — backend re-valida):
 *   - userId não-vazio (gateProAI exige sessão, mas falhar cedo evita request);
 *   - photo1 obrigatória; photo2 obrigatória SE style=antesdepois;
 *   - photo1/photo2 devem ser data URLs `data:image/...;base64,...`.
 *
 * Estoura ValidationError pros casos acima e NetworkError pra qualquer
 * falha de rede/parse/status. A mensagem do erro carrega o "detail" do
 * backend quando disponível (ex.: "modelo: gpt-image-1+ref") pra UI surfar.
 */
export async function generateArt(
  input: GenerateArtInput,
): Promise<GenerateArtResult> {
  if (!input.userId) {
    throw new ValidationError('Faça login para gerar arte.');
  }
  if (!input.photo1) {
    throw new ValidationError('Escolha uma foto primeiro.', { field: 'photo1' });
  }
  if (!isDataUrl(input.photo1)) {
    throw new ValidationError('Foto inválida — envie uma imagem.', {
      field: 'photo1',
    });
  }
  if (input.style === 'antesdepois' && !input.photo2) {
    throw new ValidationError(
      'Antes/Depois precisa de 2 fotos (antes e depois).',
      { field: 'photo2' },
    );
  }
  if (input.photo2 && !isDataUrl(input.photo2)) {
    throw new ValidationError('Segunda foto inválida.', { field: 'photo2' });
  }

  const backendStyle = STYLE_TO_BACKEND[input.style] || 'portrait';
  const payload: Record<string, unknown> = {
    photoDataUrl: input.photo1,
    style: backendStyle,
    aspect: input.aspect,
    captionHint: (input.hint || '').slice(0, 300),
    businessName: (input.bizName || '').slice(0, 80),
  };
  if (input.style === 'antesdepois' && input.photo2) {
    payload.photoDataUrl2 = input.photo2;
  }

  let res: Response;
  try {
    res = await fetch('/api/ig-art', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao falar com o Seu Zé', e);
  }

  // Backend pode devolver JSON em sucesso E em erro (modelo de
  // serviceErrorResponse). Tenta parsear sempre.
  let body: {
    imageDataUrl?: string;
    caption?: string;
    style?: string;
    aspect?: string;
    model?: string;
    error?: string;
    detail?: string;
    model_tried?: string;
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!res.ok) {
    let msg = body.error || `HTTP ${res.status}`;
    if (body.detail) msg += ` — ${body.detail}`;
    if (body.model_tried) msg += ` [modelo: ${body.model_tried}]`;
    throw new NetworkError(msg);
  }

  if (!body.imageDataUrl) {
    throw new NetworkError('Provider não devolveu imagem');
  }

  // Incrementa contador local em sucesso — backend já consumiu o crédito,
  // a gente espelha pra UX (badge contador + disable do botão).
  try {
    incrementCredits(input.userId);
  } catch {
    /* localStorage indisponível (SSR/iframe) — ignorar */
  }

  return {
    imageDataUrl: body.imageDataUrl,
    caption: typeof body.caption === 'string' ? body.caption : '',
    style: typeof body.style === 'string' ? body.style : input.style,
    aspect: typeof body.aspect === 'string' ? body.aspect : input.aspect,
    model: typeof body.model === 'string' ? body.model : undefined,
  };
}

// ── Logo overlay (canvas) ──────────────────────────────────────────────────

/**
 * Compõe arte + logo via canvas e devolve uma data URL PNG. Espelha
 * _aiArtComposeWithLogo do vanilla com `position` configurável (default
 * top-right, igual ao comportamento original). Tamanho ~16% da menor
 * dimensão, margem 4%, cartão branco arredondado com sombra suave.
 *
 * Throws ValidationError pra inputs vazios; NetworkError se imagem não
 * carregar (CORS/404); AppError genérico em runtime sem `document`.
 */
export async function applyLogoToImage(
  imageUrl: string,
  logoUrl: string,
  position: LogoPosition = 'top-right',
): Promise<string> {
  if (!imageUrl) throw new ValidationError('imageUrl obrigatório');
  if (!logoUrl) throw new ValidationError('logoUrl obrigatório');
  if (typeof document === 'undefined') {
    throw new NetworkError('applyLogoToImage só funciona no browser');
  }

  const [art, logo] = await Promise.all([
    loadImage(imageUrl),
    loadImage(logoUrl),
  ]);

  const W = art.naturalWidth || 1024;
  const H = art.naturalHeight || 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new NetworkError('Canvas 2D não disponível');

  ctx.drawImage(art, 0, 0, W, H);

  const minDim = Math.min(W, H);
  const box = Math.round(minDim * 0.16);
  const pad = Math.round(minDim * 0.04);
  const radius = Math.round(box * 0.18);

  // Posiciona o cartão da logo conforme `position`. Default top-right
  // preserva comportamento do vanilla.
  let x = W - box - pad;
  let y = pad;
  if (position === 'top-left') {
    x = pad;
    y = pad;
  } else if (position === 'bottom-right') {
    x = W - box - pad;
    y = H - box - pad;
  } else if (position === 'bottom-left') {
    x = pad;
    y = H - box - pad;
  }

  // Sombra suave + cartão branco arredondado (mesmo visual do vanilla).
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = Math.round(minDim * 0.015);
  ctx.shadowOffsetY = Math.round(minDim * 0.005);
  ctx.fillStyle = '#fff';
  roundRect(ctx, x, y, box, box, radius);
  ctx.fill();
  ctx.restore();

  // Logo dentro do cartão respeitando proporção (contain). 78% interno
  // pra dar respiro nas bordas.
  const inner = Math.round(box * 0.78);
  const ix = x + (box - inner) / 2;
  const iy = y + (box - inner) / 2;
  const lw = logo.naturalWidth || inner;
  const lh = logo.naturalHeight || inner;
  const scale = Math.min(inner / lw, inner / lh);
  const dw = lw * scale;
  const dh = lh * scale;
  const dx = ix + (inner - dw) / 2;
  const dy = iy + (inner - dh) / 2;
  ctx.drawImage(logo, dx, dy, dw, dh);

  return canvas.toDataURL('image/png');
}

// ── Style templates (Supabase storage bucket `style-refs`) ─────────────────

/**
 * Resolve URL pública do template visual de um estilo. Tenta `jpg/png/webp`
 * no bucket `style-refs` (admin sobe via /api/upload-style-ref) e cai pro
 * fallback `/style-refs/<key>.jpg` estático se nenhum existir.
 *
 * Retorna a primeira URL que respondeu 200. Cache-buster `?v=<ts>` pra evitar
 * CDN stale após admin trocar o template.
 *
 * NÃO estoura — UI mostra fallback visual quando retorno é null. Best-effort.
 */
export async function fetchTemplates(style: ArtStyle): Promise<string | null> {
  const backendKey = STYLE_TO_BACKEND[style];
  if (!backendKey) return null;

  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) return null; // UI cai pra StyleMock SVG.

  for (const ext of ['jpg', 'png', 'webp'] as const) {
    const url = `${baseUrl}/storage/v1/object/public/style-refs/${backendKey}.${ext}?v=${Date.now()}`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (head.ok) {
        const ct = (head.headers.get('content-type') || '').toLowerCase();
        if (ct.startsWith('image/')) return url;
      }
    } catch {
      /* tenta próxima ext */
    }
  }

  // Nada respondeu image/*. Devolve null em vez de path estático que 404a —
  // setar backgroundImage com URL quebrada fazia o card piscar do SVG pra
  // "broken image" branco. Com null, StyleMock continua renderizando.
  return null;
}

/**
 * Upload de novo template visual pelo admin. Bate no /api/upload-style-ref
 * (que valida ADMIN_EMAILS server-side e usa service_role pra escrever no
 * bucket privado-pra-escrita). Aqui só validamos client-side e disparamos.
 *
 * Throws ValidationError pra adminUserId ausente, file inválido (não-imagem
 * ou > 4MB). NetworkError em falha do endpoint.
 *
 * NOTA: gate de admin é server-side (endpoint checa email). adminUserId é
 * passado só pra defesa em profundidade (se a UI chamar isso sem user, falha
 * cedo em vez de mandar request anônima que vai ser rejeitada).
 */
export async function uploadTemplate(
  adminUserId: string,
  style: ArtStyle,
  file: File,
): Promise<{ url: string }> {
  if (!adminUserId) throw new ValidationError('adminUserId obrigatório');
  if (!file) throw new ValidationError('Arquivo obrigatório');
  if (!file.type || !file.type.startsWith('image/')) {
    throw new ValidationError('Selecione um arquivo de imagem');
  }
  // 4MB cap (vanilla _aiArtUploadTemplate linha 140).
  if (file.size > 4 * 1024 * 1024) {
    throw new ValidationError('Template muito grande (máx 4MB)');
  }

  const backendKey = STYLE_TO_BACKEND[style];
  if (!backendKey) throw new ValidationError('Estilo inválido', { field: 'style' });

  // Endpoint espera dataURL no body JSON (~1MB de payload). Converte client-side.
  const dataUrl = await fileToDataUrl(file);

  let res: Response;
  try {
    res = await fetch('/api/upload-style-ref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ styleKey: backendKey, photoDataUrl: dataUrl }),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao subir template', e);
  }

  let body: { ok?: boolean; url?: string; error?: string } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    body = {};
  }

  if (!res.ok || !body.ok || !body.url) {
    throw new NetworkError(body.error || `HTTP ${res.status}`);
  }
  return { url: body.url };
}

// ── Daily credits (UX espelhando rate-limit server-side) ───────────────────

/**
 * Chave do contador diário no localStorage. Mesma forma do vanilla:
 * `igArt:credits:<userId>:<YYYY-MM-DD>` (ano-mês-dia em fuso local). A
 * data muda à meia-noite local — contador "reseta" automaticamente sem
 * código de cron.
 */
function creditsKey(userId: string): string {
  const d = new Date();
  const day =
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0');
  return `igArt:credits:${userId || 'anon'}:${day}`;
}

/**
 * Quantos créditos o usuário já gastou hoje (0–DAILY_CREDITS_LIMIT).
 * Retorna 0 em ambientes sem localStorage (SSR, iframe sandbox).
 */
export function getDailyCreditsUsed(userId: string): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(creditsKey(userId));
    const n = parseInt(raw || '0', 10);
    return Math.max(0, Number.isFinite(n) ? n : 0);
  } catch {
    return 0;
  }
}

/**
 * Incrementa o contador local em 1 (chamado APÓS confirmação de sucesso do
 * backend pra não burnar crédito em falha). No-op se localStorage indisponível.
 */
export function incrementCredits(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const cur = getDailyCreditsUsed(userId);
    localStorage.setItem(creditsKey(userId), String(cur + 1));
  } catch {
    /* ignore */
  }
}

/**
 * Força o contador no máximo (chamado quando backend devolve 429 — UX bate
 * imediatamente no "limite atingido" mesmo se o local estivesse < 5).
 */
export function maxCredits(userId: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(creditsKey(userId), String(DAILY_CREDITS_LIMIT));
  } catch {
    /* ignore */
  }
}

// ── Post art to feed (replicação de _aiArtPost vanilla) ────────────────────

export interface PostArtInput {
  userId: string;
  imageDataUrl: string;
  caption: string;
}

export interface PostArtResult {
  ok: boolean;
  mediaUrl: string;
  status: 'approved' | 'pending';
}

/**
 * Publica a arte gerada no feed do usuário. Replica _aiArtPost do vanilla:
 *   - converte dataURL → Blob;
 *   - upload pra storage bucket `posts` em `<userId>/ai-art-<ts>.<ext>`;
 *   - obtém publicUrl;
 *   - insere row em `posts` (status approved, sem moderação de imagem porque
 *     a arte foi gerada pelo nosso pipeline).
 *
 * NÃO faz moderação de texto aqui (vanilla chama `moderateContentAsync` —
 * essa lib ainda não foi portada pro Next.js, e o spec não pede). Quando
 * portar, plugar antes do insert e setar status='pending' em soft-block.
 *
 * Throws ValidationError pros campos faltando, NetworkError pra falha
 * de storage/insert.
 */
export async function postArtToFeed(
  input: PostArtInput,
): Promise<PostArtResult> {
  if (!input.userId) throw new ValidationError('Faça login para postar.');
  if (!input.imageDataUrl) throw new ValidationError('Gere uma arte primeiro.');

  const match = /^data:([^;]+);base64,(.+)$/.exec(input.imageDataUrl);
  if (!match) throw new ValidationError('imageDataUrl inválida');
  const mime = match[1];
  const b64 = match[2];

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const ext = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${input.userId}/ai-art-${Date.now()}.${ext}`;

  const sb = getSupabase();
  const { error: upErr } = await sb.storage.from('posts').upload(path, blob, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) throw new NetworkError(upErr.message, upErr);

  const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
  const mediaUrl = urlData?.publicUrl;
  if (!mediaUrl) {
    throw new NetworkError('Sem publicUrl após upload');
  }

  const caption = (input.caption || '').trim();
  const { error: insErr } = await sb.from('posts').insert({
    user_id: input.userId,
    caption: caption || null,
    media_url: mediaUrl,
    media_type: 'image',
    status: 'approved',
    created_at: new Date().toISOString(),
  });
  if (insErr) {
    // Insert falhou após upload — tenta remover blob órfão (best-effort).
    try {
      await sb.storage.from('posts').remove([path]);
    } catch {
      /* ignore */
    }
    throw new NetworkError(insErr.message, insErr);
  }

  return { ok: true, mediaUrl, status: 'approved' };
}

// ── Internals ──────────────────────────────────────────────────────────────

function isDataUrl(s: string): boolean {
  return /^data:image\/[a-z0-9+.-]+;base64,/i.test(s || '');
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new NetworkError(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new NetworkError('Falha ao ler arquivo'));
    reader.onload = () => {
      const out = reader.result;
      if (typeof out === 'string') resolve(out);
      else reject(new NetworkError('Resultado do FileReader não é string'));
    };
    reader.readAsDataURL(file);
  });
}

// aiLogo.ts — service layer pra feature "Gerador de Logo IA + Camiseta".
// Porta o subset relevante de modules/ai-logo.js do vanilla:
//   - generateLogos: bate em POST /api/generate-logo, devolve N variants
//     (string[] de URLs). Endpoint gateado server-side (gateProAI: PRO + rate
//     limit), aqui só fazemos o fetch e parse — o controle de "1ª grátis vs
//     paga" fica na camada de hook (useAiLogo) que vê o profile state.
//   - saveLogo / fetchLogo: read/write trivial em profiles.business_logo_url.
//   - uploadLogo: PUT no bucket `posts` (mesmo bucket do avatar) com path
//     `<userId>/business_logo.<ext>`. Retorna publicUrl com cache-buster.
//   - applyLogoToShirt: composição canvas — desenha o logo sobre a foto da
//     camiseta e devolve dataURL. Funciona client-side (precisa de
//     document.createElement('canvas') + Image), throw em ambiente node.
//
// Decisões:
//  - Não exportamos os SVG fallbacks do vanilla (_renderAiLogoSvg). O port
//    Next.js assume que o endpoint /api/generate-logo sempre responde (se
//    falhar, a UI mostra erro em vez de logo offline). Reduz superfície.
//  - generateLogos joga em qualquer falha (NetworkError) pra o hook decidir
//    UX (toast + retry). Vanilla engolia e caía no fallback SVG, aqui o
//    contrato é estrito.

import { NetworkError, ValidationError } from '@/lib/errors';
import { getSupabase } from '@/lib/supabase';

// Input do form do logo. `style` é opcional — o backend tolera ausência e
// usa estilo padrão. `name` é o único required (vai virar o texto do logo).
export interface GenerateLogoInput {
  name: string;
  slogan?: string;
  style?: string;
}

// Resposta esperada do /api/generate-logo. O backend sempre devolve `urls`
// como string[]; outros campos (model, prompt) são metadata pra debug.
interface GenerateLogoResponse {
  urls: string[];
  model?: string;
  prompt?: string;
  error?: string;
}

/**
 * Gera N variants de logo via IA. POST /api/generate-logo no backend
 * Cloudflare (Function que chama OpenAI). O backend já valida PRO + rate
 * limit + presença de OPENAI_API_KEY; este service apenas:
 *   - valida que `name` foi passado (defesa em profundidade, o form também
 *     valida);
 *   - faz o POST;
 *   - extrai `urls` ou estoura NetworkError com a mensagem mais clara que
 *     conseguir.
 *
 * Não tenta retry/backoff — UX de "Gerar novamente" deixa o usuário decidir.
 */
export async function generateLogos(
  input: GenerateLogoInput,
): Promise<string[]> {
  const name = (input.name || '').trim();
  if (!name) throw new ValidationError('Digite o nome do logo');

  let res: Response;
  try {
    res = await fetch('/api/generate-logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        slogan: (input.slogan || '').trim() || undefined,
        style: (input.style || '').trim() || undefined,
      }),
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao gerar logo', e);
  }

  // Backend pode devolver 401/403/429/503 com JSON `{ error: '...' }`. Tenta
  // parsear pra surfar a mensagem real; se não for JSON, usa o status text.
  let body: GenerateLogoResponse | null = null;
  try {
    body = (await res.json()) as GenerateLogoResponse;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const msg = body?.error || `HTTP ${res.status}`;
    throw new NetworkError(msg);
  }

  if (!body || !Array.isArray(body.urls) || body.urls.length === 0) {
    throw new NetworkError('Resposta inválida do servidor');
  }

  return body.urls;
}

/**
 * Persiste a URL do logo escolhido no perfil do usuário (coluna
 * `profiles.business_logo_url`). Throws NetworkError se Supabase rejeita
 * (RLS exige `auth.uid() = id` pra UPDATE).
 */
export async function saveLogo(
  userId: string,
  logoUrl: string,
): Promise<void> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!logoUrl) throw new ValidationError('logoUrl obrigatório');

  const sb = getSupabase();
  const { error } = await sb
    .from('profiles')
    .update({ business_logo_url: logoUrl })
    .eq('id', userId);
  if (error) throw new NetworkError(error.message, error);
}

/**
 * Lê a URL do logo salvo no perfil. Retorna null se userId vazio ou se o
 * perfil ainda não salvou logo. Throws NetworkError em erro de RLS/rede.
 */
export async function fetchLogo(userId: string): Promise<string | null> {
  if (!userId) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('profiles')
    .select('business_logo_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new NetworkError(error.message, error);
  const url = (data as { business_logo_url?: string | null } | null)
    ?.business_logo_url;
  return url || null;
}

/**
 * Upload manual de logo customizado (não-IA). Mesma escada do vanilla
 * uploadBusinessLogo: valida tipo/tamanho, sobe pro bucket `posts` com path
 * `<userId>/business_logo.<ext>`, atualiza `profiles.business_logo_url`, e
 * devolve a publicUrl com cache-buster `?t=<ts>` (pra o browser não servir
 * a versão velha do CDN).
 *
 * Throws ValidationError pra inputs inválidos (não-imagem, > 5MB) e
 * NetworkError se upload ou update falham.
 */
export async function uploadLogo(
  userId: string,
  file: File,
): Promise<string> {
  if (!userId) throw new ValidationError('userId obrigatório');
  if (!file) throw new ValidationError('Arquivo obrigatório');
  if (!file.type || !file.type.startsWith('image/')) {
    throw new ValidationError('Selecione um arquivo de imagem');
  }
  // 5MB cap igual ao vanilla (uploadBusinessLogo linha 311).
  if (file.size > 5 * 1024 * 1024) {
    throw new ValidationError('Imagem muito grande (máx 5MB)');
  }

  const sb = getSupabase();
  const ext =
    (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') ||
    'png';
  const path = `${userId}/business_logo.${ext}`;

  const { error: upErr } = await sb.storage
    .from('posts')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw new NetworkError(upErr.message, upErr);

  const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
  const publicUrl = urlData?.publicUrl
    ? `${urlData.publicUrl}?t=${Date.now()}`
    : null;
  if (!publicUrl) throw new NetworkError('Sem publicUrl após upload');

  const { error: profErr } = await sb
    .from('profiles')
    .update({ business_logo_url: publicUrl })
    .eq('id', userId);
  if (profErr) throw new NetworkError(profErr.message, profErr);

  return publicUrl;
}

/**
 * Compoõe o logo sobre a foto da camiseta usando canvas 2D, devolve dataURL
 * PNG. Substitui _applyLogoToShirt do vanilla (que mexia direto no DOM da
 * camiseta mockup). Aqui produz uma imagem standalone — o caller decide
 * onde mostrar (preview, download, share).
 *
 * Layout: logo é desenhado no peito da camiseta (~38% da largura, centralizado
 * horizontalmente, 22% do top). Esses ratios espelham a posição do mockup
 * vanilla (shirt-chest-logo CSS).
 *
 * Throws ValidationError se algum dos URLs estiver vazio. Throws NetworkError
 * se alguma imagem falhar ao carregar (CORS, 404, etc.). Throws AppError
 * generico se rodar em ambiente sem `document` (Node, edge runtime).
 */
export async function applyLogoToShirt(
  shirtImageUrl: string,
  logoUrl: string,
): Promise<string> {
  if (!shirtImageUrl) throw new ValidationError('shirtImageUrl obrigatório');
  if (!logoUrl) throw new ValidationError('logoUrl obrigatório');
  if (typeof document === 'undefined') {
    throw new NetworkError('applyLogoToShirt só funciona no browser');
  }

  const [shirt, logo] = await Promise.all([
    loadImage(shirtImageUrl),
    loadImage(logoUrl),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = shirt.naturalWidth || 512;
  canvas.height = shirt.naturalHeight || 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new NetworkError('Canvas 2D não disponível');

  ctx.drawImage(shirt, 0, 0, canvas.width, canvas.height);

  // Logo no peito da camiseta. Ratios espelham o layout do mockup vanilla:
  // largura ~38% da camiseta, posicionado a 31% da esquerda e 22% do topo
  // (= centro horizontal aproximado, faixa do peito).
  const logoW = canvas.width * 0.38;
  const aspect =
    logo.naturalWidth > 0 ? logo.naturalHeight / logo.naturalWidth : 1;
  const logoH = logoW * aspect;
  const logoX = (canvas.width - logoW) / 2;
  const logoY = canvas.height * 0.22;
  ctx.drawImage(logo, logoX, logoY, logoW, logoH);

  return canvas.toDataURL('image/png');
}

// Helper privado: carrega URL → HTMLImageElement com crossOrigin pra o
// canvas não tainted. Promise rejeita com NetworkError em erro de load.
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

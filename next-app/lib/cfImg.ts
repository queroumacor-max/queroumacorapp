// cfImg — helper que reescreve URLs de imagem pra passar pelo Cloudflare
// Image Resizing (https://developers.cloudflare.com/images/transform-images/).
// Funciona em qualquer URL que esteja no mesmo domínio Cloudflare (ou seja:
// queroumacor.com.br, que faz proxy de Supabase Storage via _redirects ou
// que serve a imagem direto via worker).
//
// API: cfImg(url, { width, quality, format }) → URL com `/cdn-cgi/image/...`.
// Se a URL é externa (Supabase direto, sem passar pelo CF), devolve a URL
// original — Cloudflare Image Resizing só funciona em hostnames servidos
// pelo zone CF do user.
//
// Formato default: 'auto' (CF serve AVIF/WebP se browser aceita, JPEG senão).
// Quality default 85 (bom equilíbrio LCP vs nitidez pra mobile).
//
// O componente usa cfImgSrcSet pra montar srcset multi-resolução de uma
// vez, ideal pra <img> de feed/avatar em viewport variável.

const CF_HOST_RX = /^https?:\/\/(?:[^/]*\.)?queroumacor\.com\.br/i;

export interface CfImgOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'auto' | 'avif' | 'webp' | 'jpeg' | 'png';
  fit?: 'cover' | 'contain' | 'scale-down' | 'crop' | 'pad';
}

function buildOpts(o: CfImgOptions): string {
  const parts: string[] = [];
  if (o.width) parts.push(`w=${o.width}`);
  if (o.height) parts.push(`h=${o.height}`);
  parts.push(`q=${o.quality ?? 85}`);
  parts.push(`f=${o.format ?? 'auto'}`);
  if (o.fit) parts.push(`fit=${o.fit}`);
  return parts.join(',');
}

export function cfImg(url: string | null | undefined, opts: CfImgOptions = {}): string {
  if (!url) return '';
  if (typeof url !== 'string') return '';

  // URLs do mesmo CF zone — pode reescrever pra /cdn-cgi/image/.../original-url
  if (CF_HOST_RX.test(url)) {
    const parsed = new URL(url);
    const restPath = parsed.pathname + parsed.search;
    return `${parsed.origin}/cdn-cgi/image/${buildOpts(opts)}${restPath}`;
  }

  // URLs externas (Supabase Storage direto) — CF Image Resizing pode
  // aceitar URL absoluta como suffix. Vamos tentar via /cdn-cgi/image/
  // do domínio principal do user (queroumacor.com.br).
  //   `https://queroumacor.com.br/cdn-cgi/image/w=400,q=85,f=auto/https://supabase.co/storage/.../img.jpg`
  // Se o user tiver "Allow URLs from other zones" desligado no CF,
  // o fetch falha e a tag <img> dá 404 → onError fallback do componente
  // mostra placeholder. Sem regressão funcional.
  const supabaseRx = /^https?:\/\/[^/]+\.supabase\.co\//i;
  if (supabaseRx.test(url)) {
    return `https://queroumacor.com.br/cdn-cgi/image/${buildOpts(opts)}/${url}`;
  }

  // Outras URLs externas — não reescreve, devolve original.
  return url;
}

// Monta srcset 1x/2x/3x pra um width-base. Usa em <img srcset={cfImgSrcSet(...)} sizes="...">.
// Browser escolhe a melhor variante baseado em DPR e viewport.
export function cfImgSrcSet(
  url: string | null | undefined,
  baseWidth: number,
  opts: Omit<CfImgOptions, 'width'> = {},
): string {
  if (!url) return '';
  const u1 = cfImg(url, { ...opts, width: baseWidth });
  const u2 = cfImg(url, { ...opts, width: baseWidth * 2 });
  const u3 = cfImg(url, { ...opts, width: baseWidth * 3 });
  return `${u1} 1x, ${u2} 2x, ${u3} 3x`;
}

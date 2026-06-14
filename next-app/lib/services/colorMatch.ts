// colorMatch — cruza uma cor-alvo (hex, ex.: amostrada da parede no AR) com
// as cores do catálogo da loja (`products.color_hex`) e devolve as tintas
// mais próximas. Distância em espaço CIE-Lab (ΔE CIE76): bem mais fiel à
// percepção humana que Euclides em RGB.
//
// Uso: o WallARView amostra um pixel da câmera (eyedropper) e chama
// `nearestColors(hex, catalog, limit)`. O catálogo vem de `fetchColorCatalog`
// (cacheado pelo hook useColorMatch — não muda a cada toque).

import { getSupabase } from '@/lib/supabase';
import { NetworkError } from '@/lib/errors';
import { resolveColorHex } from '@/lib/services/mkt';

export interface ColorCatalogItem {
  id: string;
  name: string;
  code: string | null;
  price: number | null;
  hex: string; // já resolvido (não-vazio) — só entram produtos com cor real
  image_url: string | null;
}

export interface ColorMatch extends ColorCatalogItem {
  deltaE: number; // 0 = idêntico; < ~2.3 imperceptível; < ~10 bem próximo
}

// ─── conversão de cor ───────────────────────────────────────────────────

interface Rgb { r: number; g: number; b: number }
interface Lab { L: number; a: number; b: number }

export function hexToRgb(hex: string): Rgb | null {
  const h = (hex || '').trim();
  const m6 = h.match(/^#?([0-9a-f]{6})$/i);
  if (m6) {
    const v = m6[1];
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  }
  const m3 = h.match(/^#?([0-9a-f]{3})$/i);
  if (m3) {
    const v = m3[1];
    return {
      r: parseInt(v[0] + v[0], 16),
      g: parseInt(v[1] + v[1], 16),
      b: parseInt(v[2] + v[2], 16),
    };
  }
  return null;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

function rgbToLab({ r, g, b }: Rgb): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // sRGB → XYZ (D65)
  const x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
  // Normaliza pelo branco de referência D65
  const xn = x / 0.95047;
  const yn = y / 1.0;
  const zn = z / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xn);
  const fy = f(yn);
  const fz = f(zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** ΔE CIE76 (distância euclidiana em Lab). */
export function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// ─── catálogo + match ───────────────────────────────────────────────────

/**
 * Busca os produtos ativos do catálogo que têm uma cor sólida resolvível.
 * Só colunas mínimas pro card de resultado — o cruzamento é client-side
 * (ΔE é instantâneo mesmo com milhares de cores; o custo é só o fetch,
 * que o hook cacheia).
 */
export async function fetchColorCatalog(): Promise<ColorCatalogItem[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('products')
    .select('id, name, code, price, color_hex, image_url')
    .not('color_hex', 'is', null)
    .neq('active', false)
    .order('name');
  if (error) throw new NetworkError(error.message, error);

  const items: ColorCatalogItem[] = [];
  for (const row of (data ?? []) as Array<{
    id: string;
    name: string | null;
    code: string | null;
    price: number | null;
    color_hex: string | null;
    image_url: string | null;
  }>) {
    // resolveColorHex filtra cores "não-reais" (ex.: placeholders) e normaliza.
    const hex = resolveColorHex({ name: row.name ?? '', color_hex: row.color_hex });
    if (!hex || !hexToRgb(hex)) continue;
    items.push({
      id: row.id,
      name: row.name ?? 'Produto',
      code: row.code,
      price: row.price,
      hex,
      image_url: row.image_url,
    });
  }
  return items;
}

/**
 * Top-N tintas do catálogo mais próximas da cor-alvo, por ΔE crescente.
 * `maxDeltaE` (opcional) descarta cores claramente diferentes — default sem
 * corte (sempre devolve as N mais próximas, mesmo que distantes).
 */
export function nearestColors(
  targetHex: string,
  catalog: ColorCatalogItem[],
  limit = 12,
  maxDeltaE?: number,
): ColorMatch[] {
  const rgb = hexToRgb(targetHex);
  if (!rgb) return [];
  const targetLab = rgbToLab(rgb);

  const scored: ColorMatch[] = [];
  for (const item of catalog) {
    const itemRgb = hexToRgb(item.hex);
    if (!itemRgb) continue;
    const d = deltaE(targetLab, rgbToLab(itemRgb));
    if (maxDeltaE != null && d > maxDeltaE) continue;
    scored.push({ ...item, deltaE: d });
  }
  scored.sort((a, b) => a.deltaE - b.deltaE);
  return scored.slice(0, Math.max(1, limit));
}

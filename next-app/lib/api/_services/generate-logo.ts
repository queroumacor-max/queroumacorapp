// lib/api/_services/generate-logo.ts — port de
// `functions/api/_services/generate-logo.js`. 3 variants via gpt-image-1.

import { ServiceError } from '../security';

const TIMEOUT_MS = 45000;

function buildPrompts(name: string, styleHint: string): string[] {
  return [
    `Logo design — bold emblem badge composition for a Brazilian small business called "${name}". Strong sans-serif typography integrated with iconic shapes. Visual style: ${styleHint}. Isolated subject on a fully transparent background, no rectangle or backdrop behind the logo, flat 2D vector art, no people, no photographic elements, no extra text besides the brand name.`,
    `Logo design — modern circular monogram composition for a business named "${name}". Large prominent initials. Visual style: ${styleHint}. Isolated subject on a fully transparent background, no rectangle or backdrop behind the logo, flat 2D vector art, premium feel, no people, no extra text besides the brand name.`,
    `Logo design — horizontal lockup composition with an icon to the left of the brand name "${name}". Crisp, premium. Visual style: ${styleHint}. Isolated subject on a fully transparent background, no rectangle or backdrop behind the logo, flat 2D vector art, no people, no extra text besides the brand name.`,
  ];
}

export async function generateLogo(args: {
  name?: unknown;
  style?: unknown;
}): Promise<{ urls: string[] }> {
  const cleanName = String(args.name || '')
    .replace(/[^\p{L}\p{N}\s&\-.']/gu, '')
    .trim()
    .slice(0, 50);
  if (!cleanName) throw new ServiceError('name obrigatório', 400);
  const cleanStyle = String(args.style || '')
    .replace(/[^\p{L}\p{N}\s,&\-.']/gu, '')
    .trim()
    .slice(0, 80);
  const styleHint = cleanStyle || 'modern minimalist, premium branding';

  const key = process.env.OPENAI_API_KEY;
  const prompts = buildPrompts(cleanName, styleHint);
  try {
    const urls = await Promise.all(
      prompts.map(async (prompt) => {
        const r = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-image-1',
            prompt,
            n: 1,
            size: '1024x1024',
            quality: 'medium',
            background: 'transparent',
            output_format: 'png',
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!r.ok) {
          const errText = await r.text();
          throw new Error(`OpenAI ${r.status}: ${errText.slice(0, 200)}`);
        }
        const data = (await r.json()) as {
          data?: Array<{ url?: string; b64_json?: string }>;
        };
        const item = data?.data?.[0];
        if (item?.url) return item.url;
        if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
        return null;
      })
    );
    if (urls.some((u) => !u)) {
      throw new ServiceError('OpenAI não retornou imagem', 502);
    }
    return { urls: urls as string[] };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    const isTimeout =
      e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('DALL-E timeout (45s) — tente de novo', 504);
    }
    console.warn('generate-logo: exception', e instanceof Error ? e.message : e);
    throw new ServiceError('Erro interno — tente de novo em instantes', 500);
  }
}

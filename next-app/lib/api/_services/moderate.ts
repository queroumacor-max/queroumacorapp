// lib/api/_services/moderate.ts — port de
// `functions/api/_services/moderate.js`. Moderação de texto + imagem via Gemini.

import { ServiceError } from '../security';

const GEMINI_MODEL = 'gemini-2.5-flash';
const TIMEOUT_MS = 25000;
const MAX_INLINE_BYTES = 6 * 1024 * 1024;
const IMG_FETCH_TIMEOUT_MS = 10000;

const RUBRIC =
  'Você é um moderador de conteúdo de uma plataforma BRASILEIRA de PINTORES, GRAFITEIROS e profissionais de pintura. ' +
  'O público publica trabalhos, materiais, preços e formas de contato — isso é o NEGÓCIO dessa galera. ' +
  'Modere com PARCIMÔNIA: na dúvida, libere. Falso positivo (segurar trabalho honesto) machuca mais do que falso negativo. ' +
  'Analise o texto e a imagem (se houver) e responda APENAS um JSON válido: ' +
  '{"flagged":bool,"severity":"none|soft|hard","reasons":[string]}.\n' +
  '\n' +
  'severity "hard" (bloqueio total — só nesses casos): ' +
  'nudez explícita ou pornografia; QUALQUER conteúdo sexual envolvendo menores; ' +
  'violência gráfica real com sangue/cadáveres; ameaça concreta de morte/agressão a pessoa específica; ' +
  'apologia ao nazismo, terrorismo ou abuso infantil; venda explícita de drogas ilícitas pesadas ou armas de fogo.\n' +
  '\n' +
  'severity "soft" (revisão humana — use com PARCIMÔNIA): ' +
  'golpe/scam/phishing claro ("pague antes pra liberar", "ganhe X reais sem fazer nada", taxa antecipada, link de encurtador suspeito); ' +
  'spam massivo (mesma mensagem repetida várias vezes); ' +
  'doxxing de TERCEIRO (expor telefone/endereço de outra pessoa sem permissão); ' +
  'ofensa pesada direcionada a uma pessoa real específica (não gíria casual); ' +
  'incitação a ódio contra grupo (não simples palavrão).\n' +
  '\n' +
  'severity "none" (LIBERA — esses casos NUNCA são soft nem hard):\n' +
  '- Arte de pintura, grafite, mural, textura — mesmo que abstrato, polêmico, expressivo ou com nudez artística discreta.\n' +
  '- Telefone, WhatsApp, Instagram, e-mail, PIX e endereço do PRÓPRIO prestador na legenda — é como ele atende cliente.\n' +
  '- Preço de serviço/material, "R$/m²", orçamento.\n' +
  '- Link pro próprio Instagram, site ou portfólio (instagram.com/foo, meusite.com.br).\n' +
  '- Palavrão leve usado como exclamação ou ênfase brasileira ("foda demais", "puta arte linda", "que merda de tempo", "caraca, ficou top") — sem ataque pessoal real.\n' +
  '- Críticas a marcas, produtos ou concorrência (mesmo duras).\n' +
  '- Termos técnicos: "matar a sede", "matar a saudade", "armário", "pistola de pintar", "rolo", "trincha".\n' +
  '- Nomes próprios (Cornélio, Matheus, Armando) — não confundir com substring de palavrão.\n' +
  '\n' +
  'reasons: palavras curtas em pt-br (ex: "nudez","sexual_menores","golpe","violencia","odio","spam","doxxing").';

export interface ModerateResult {
  flagged: boolean;
  severity: 'none' | 'soft' | 'hard';
  reasons: string[];
  categories: Record<string, unknown>;
  scores: Record<string, unknown>;
  engine: string;
}

function isAllowedImageHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    if (!/^[A-Za-z0-9-]+\.supabase\.co$/.test(u.hostname)) return false;
    return u.pathname.startsWith('/storage/');
  } catch {
    return false;
  }
}

export async function moderateContent(args: {
  text?: unknown;
  imageUrl?: unknown;
}): Promise<ModerateResult> {
  const cleanText = typeof args.text === 'string' ? args.text.slice(0, 4000) : '';
  const imageUrlRaw = typeof args.imageUrl === 'string' ? args.imageUrl : '';
  const cleanUrl =
    imageUrlRaw.startsWith('data:image/') || isAllowedImageHost(imageUrlRaw)
      ? imageUrlRaw
      : '';

  if (!cleanText.trim() && !cleanUrl.trim()) {
    return {
      flagged: false,
      severity: 'none',
      reasons: [],
      categories: {},
      scores: {},
      engine: 'none',
    };
  }

  const scam = detectScam(cleanText);
  const parts: Array<
    { text: string } | { inline_data: { mime_type: string; data: string } }
  > = [
    { text: RUBRIC },
    { text: 'CONTEÚDO:\n' + (cleanText || '(sem texto)') },
  ];
  if (cleanUrl.trim()) {
    try {
      const img = await fetchImageInline(cleanUrl);
      if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.b64 } });
    } catch {
      /* sem imagem inline, modera só o texto */
    }
  }

  const key = process.env.GEMINI_API_KEY;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (!r.ok) {
      throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 150)}`);
    }
    const data = (await r.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed: { flagged?: unknown; severity?: unknown; reasons?: unknown } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    let severity: 'none' | 'soft' | 'hard' =
      parsed.severity === 'soft' || parsed.severity === 'hard'
        ? parsed.severity
        : 'none';
    const reasons = Array.isArray(parsed.reasons)
      ? (parsed.reasons.slice(0, 8) as string[])
      : [];
    let flagged = !!parsed.flagged || severity !== 'none';

    if (scam) {
      flagged = true;
      if (severity === 'none') severity = 'soft';
      if (!reasons.includes('golpe')) reasons.push('golpe');
    }
    return {
      flagged,
      severity,
      reasons,
      categories: {},
      scores: {},
      engine: 'gemini',
    };
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) {
      throw new ServiceError('Gemini timeout (25s) — tente de novo', 504, {
        engine: 'failed',
      });
    }
    console.warn('moderate err:', err instanceof Error ? err.message : err);
    throw new ServiceError('moderação indisponível', 502, { engine: 'failed' });
  }
}

function detectScam(text: string): boolean {
  if (!text) return false;
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const lures = [
    'pix antecipado',
    'deposito antecipado',
    'taxa de liberacao',
    'ganhe dinheiro facil',
    'renda extra garantida',
    'investimento garantido',
    'dobre seu dinheiro',
    'clique no link e ganhe',
    'premio voce ganhou',
    'cartao premiado',
    'emprestimo sem consulta',
    'pagamento adiantado',
  ];
  return lures.some((l) => t.includes(l));
}

async function fetchImageInline(
  src: string
): Promise<{ mime: string; b64: string } | null> {
  const m = /^data:([^;]+);base64,(.+)$/.exec(src);
  if (m) return { mime: m[1], b64: m[2] };
  if (!/^https?:\/\//.test(src)) return null;
  const r = await fetch(src, {
    signal: AbortSignal.timeout(IMG_FETCH_TIMEOUT_MS),
  });
  if (!r.ok) return null;
  const ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX_INLINE_BYTES) return null;
  return { mime: ct, b64: bufToB64(buf) };
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// lib/api/_services/ig-art.ts — port de
// `functions/api/_services/ig-art.js`. Gerador de "Arte pra Instagram":
// edita a foto do usuário num estilo (portrait, antesdepois, profissional,
// trabalho, grafite) via OpenAI gpt-image-1, com fallback pra Gemini.
//
// Modo "antesdepois" aceita 2 fotos. Bug histórico do vanilla: photo2
// não era passado pro fallback Gemini → foto do "depois" sumia quando
// OpenAI caía. Aqui já porta com photo2 na chain inteira.

import { ServiceError, getSupabaseUrl } from '../security';
import { callAIText } from '../_ai';

const OPENAI_IMG_MODEL = 'gpt-image-1';
const OPENAI_IMG_QUALITY = 'medium';
const OPENAI_IMG_TIMEOUT_MS = 24000;

const GEMINI_FALLBACK_DEFAULT_MODEL = 'gemini-2.5-flash-image';
const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation',
];
const GEMINI_FALLBACK_TIMEOUT_MS = 4000;

const CAPTION_TIMEOUT_MS = 7000;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

const HARD_RULES = [
  'REGRAS CRÍTICAS — siga sem exceção:',
  '(1) GRAMÁTICA PT-BR: todo texto deve estar em português do Brasil correto. NUNCA invente acentos. Palavras certas: "SEU" (nunca "SÊU"), "TRABALHO" (nunca "TRABÁLHO" nem "TRÁBALHO"), "MINHA" (nunca "MÍNHA"), "ARTE", "NOVO", "LAR", "AGENDE", "ORÇAMENTO" (com Ç e til em "Ã"), "PINTOR", "PROFISSIONAL". Se não tiver certeza de uma palavra, troque por outra mais simples. Revise CADA letra antes de finalizar.',
  '(2) SAFE-ZONE: deixe margem mínima de 6% em cada borda da imagem. Texto, badges, logos e footer DEVEM ficar dentro dessa área segura — NADA pode ser cortado nas bordas. Letras inteiras, palavras inteiras visíveis.',
  '(3) CANTO SUPERIOR DIREITO LIVRE: reserve um espaço quadrado vazio no canto superior direito (~18% da largura, sem texto, sem badge, sem ornamento) — o profissional vai sobrepor a logo dele lá depois.',
  '(4) TIPOGRAFIA: use UMA fonte sans-serif bold/condensada consistente. Letras grandes, kerning normal, sem efeitos exóticos. Nada de fonte cursiva inventada.',
  '(5) Sem palavras inventadas, sem letras misturadas com símbolos, sem "Lorem Ipsum".',
  '',
].join(' ');

type StyleKey = 'portrait' | 'antesdepois' | 'profissional' | 'trabalho' | 'grafite';
type AspectKey = 'square' | 'vertical' | 'horizontal';

const STYLE_PROMPTS: Record<StyleKey, string> = {
  portrait: [
    'MODELO: retrato cinematográfico vertical estilo capa de revista profissional.',
    'COMPOSIÇÃO: sujeito principal centralizado, busto/cintura pra cima, ocupando ~60% do quadro,',
    'cabeça no terço superior, olhar levemente fora do eixo, profundidade de campo rasa.',
    'ILUMINAÇÃO: luz lateral suave tipo Rembrandt, key light quente vindo da diagonal superior,',
    'fill light fraco no lado oposto, leve rim light separando o sujeito do fundo.',
    'FUNDO: bokeh desfocado em tons quentes (laranja queimado, terracota, marrom-café),',
    'gradiente vertical do escuro embaixo pra mais quente no topo.',
    'PALETA: tons terrosos premium, alto contraste, leve granulado de filme cinematográfico.',
    'PRESERVE rosto, traços e proporções idênticos à foto original — só estilize iluminação e fundo.',
    "Sem texto, sem marca d'água, sem borda.",
  ].join(' '),
  antesdepois: [
    'MODELO: imagem ANTES/DEPOIS com divisão vertical exata bem no meio do quadro.',
    'METADE ESQUERDA (ANTES): exatamente a cena da foto fornecida sem retoque — superfícies originais,',
    'paredes manchadas/descascadas/sem pintura, iluminação plana e fria, leve dessaturação.',
    'METADE DIREITA (DEPOIS): mesma cena/ângulo após pintura profissional — paredes uniformes, cor sólida e limpa,',
    'acabamento premium sem falhas, iluminação quente e clara, saturação realçada.',
    'LINHA DIVISÓRIA: branca fina ou sutil sombra vertical centralizada, separando as duas metades sem misturar.',
    'O mesmo objeto/ambiente aparece nos dois lados, no mesmo ângulo, só muda o estado.',
    "Sem rótulos de texto, sem marca d'água, sem moldura.",
  ].join(' '),
  profissional: [
    'MODELO: post de marketing pra Instagram de PINTOR PROFISSIONAL — o profissional aparece em destaque no ambiente recém-pintado.',
    'COMPOSIÇÃO: ambiente interno (sala/quarto) ao fundo, o profissional centralizado em primeiro plano segurando ferramentas (pincel, paleta),',
    'sorrindo, vestindo camisa/camiseta clean com leve respingo de tinta — aparência confiável e profissional.',
    'HEADLINE: texto grande em PT-BR no topo, fonte sans-serif bold/condensada, parte branca + parte amarela com underline manuscrito,',
    'mensagem tipo "TRANSFORME SEU LAR COM A MINHA ARTE!" ou similar (varie a frase mas mantenha o tom).',
    'BADGE INFERIOR ESQUERDO: círculo amarelo com ícone de pincel + texto "PINTOR PROFISSIONAL" ao lado em pill branca.',
    'BADGE INFERIOR DIREITO: pill creme com ícone de calendário + "AGENDE SEU ORÇAMENTO".',
    'FOOTER: barra branca arredondada com 3 colunas: @handle do Instagram, telefone, cidade-UF, especialidade.',
    'PALETA: terrosos quentes (bege, marrom claro), branco, amarelo cádmio. Iluminação natural de janela.',
    'PRESERVE o rosto e a identidade da pessoa da foto original idênticos.',
    'Formato 1:1 Instagram preferencial; ajustar pra formato pedido.',
  ].join(' '),
  trabalho: [
    'MODELO: post de marketing pra Instagram de TRABALHO FINALIZADO — sem pessoas, só o ambiente pintado.',
    'COMPOSIÇÃO: foto profissional de interior decorado (sala/quarto/cozinha) recém-pintado,',
    'enquadramento aberto mostrando paredes, sofá/móveis decorados, plantas, luz natural entrando por janela à esquerda.',
    'HEADLINE: texto grande sobreposto no topo em duas linhas, fonte sans-serif bold/condensada,',
    'primeira linha em branco com leve outline preto, segunda linha em amarelo cádmio com underline manuscrito,',
    'mensagem tipo "TRABALHO FINALIZADO. MINHA ARTE, SEU NOVO LAR." (varie mas mantenha o tom de orgulho de obra entregue).',
    'BADGE INFERIOR DIREITO: pill creme com ícone de calendário + "AGENDE SEU ORÇAMENTO".',
    'FOOTER: barra branca arredondada com 3 colunas: @handle + e-mail do Instagram, ícone de localização + cidade-UF, especialidade.',
    'PALETA: tons neutros quentes (bege, off-white, marrom claro), com pontos amarelos/verdes nas almofadas/plantas. Iluminação natural difusa.',
    'PRESERVE o ambiente, cores das paredes e móveis da foto original — só estilize iluminação e adicione as camadas gráficas.',
    'Formato 1:1 Instagram preferencial; ajustar pra formato pedido.',
  ].join(' '),
  grafite: [
    'MODELO: arte de grafite urbano brasileiro pintado em mural de rua de São Paulo.',
    'COMPOSIÇÃO: sujeito principal da foto recriado em estilo grafite expressivo, ocupando centro do quadro,',
    'envolvido por respingos e formas geométricas vibrantes, leve perspectiva de quem está olhando o muro.',
    'TÉCNICA: traços marcados de spray, contornos pretos grossos, preenchimentos em cores saturadas,',
    'detalhes em throw-up/bomb, sombras chapadas estilo cartoon-realista, alguns dripping de tinta.',
    'PALETA: amarelo cádmio, magenta, azul ciano, laranja queimado, preto, branco — alto contraste tropical.',
    'FUNDO: parede de tijolo aparente, concreto manchado ou portão de aço com leve grafite secundário ao fundo,',
    'textura de muro real visível.',
    'PRESERVE o sujeito principal reconhecível, só transformado em linguagem de mural.',
    "Sem assinatura legível, sem marca d'água, sem moldura.",
  ].join(' '),
};

const ASPECT_SIZES: Record<AspectKey, { openai: string; label: string }> = {
  square: { openai: '1024x1024', label: 'quadrado 1:1 (feed do Instagram)' },
  vertical: { openai: '1024x1536', label: 'vertical 2:3 (Reels/Stories)' },
  horizontal: { openai: '1536x1024', label: 'horizontal 3:2 (capa/banner)' },
};

const STYLE_REFERENCES: Record<StyleKey, string> = {
  portrait: '/style-refs/portrait.jpg',
  antesdepois: '/style-refs/antesdepois.jpg',
  profissional: '/style-refs/profissional.jpg',
  trabalho: '/style-refs/trabalho.jpg',
  grafite: '/style-refs/grafite.jpg',
};

const FALLBACK_CAPTIONS: Record<StyleKey, string> = {
  portrait: 'Pronto pra próxima obra. Bora pintar! 🎨',
  antesdepois: 'Antes e depois. Diferença que só o profissional faz. ✨',
  profissional: 'Trabalho entregue com capricho. ✅',
  trabalho: 'Mais um lar transformado. Minha arte, seu novo espaço. 🏠',
  grafite: 'Cor na rua, arte na parede. 🎨',
};

interface StyleReference {
  blob: Blob;
  mime: string;
}

interface PhotoData {
  mime: string;
  b64: string;
}

interface ImgResult {
  b64?: string;
  mime?: string;
  error?: string;
  modelTried?: string;
}

export interface IgArtResult {
  imageDataUrl: string;
  caption: string;
  style: string;
  aspect: string;
  model: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function generateIgArt(args: {
  request: Request;
  photoDataUrl?: unknown;
  photoDataUrl2?: unknown;
  style?: unknown;
  aspect?: unknown;
  captionHint?: unknown;
  businessName?: unknown;
}): Promise<IgArtResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new ServiceError('OPENAI_API_KEY não configurada', 503);
  }

  const styleKey: StyleKey =
    typeof args.style === 'string' && args.style in STYLE_PROMPTS
      ? (args.style as StyleKey)
      : 'portrait';
  const aspectKey: AspectKey =
    typeof args.aspect === 'string' && args.aspect in ASPECT_SIZES
      ? (args.aspect as AspectKey)
      : 'square';
  const cleanHint =
    typeof args.captionHint === 'string'
      ? args.captionHint.trim().slice(0, 300)
      : '';
  const cleanBiz =
    typeof args.businessName === 'string'
      ? args.businessName.trim().slice(0, 80)
      : '';

  // Valida foto principal: data URL com base64.
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    typeof args.photoDataUrl === 'string' ? args.photoDataUrl : ''
  );
  if (!m) {
    throw new ServiceError(
      'photoDataUrl inválida — envie uma data URL de imagem',
      400
    );
  }
  const inputMime = m[1];
  const inputB64 = m[2].replace(/\s+/g, '');
  if ((inputB64.length * 3) / 4 > MAX_INPUT_BYTES) {
    throw new ServiceError('Foto grande demais (máx 8MB). Tente uma menor.', 413);
  }

  // Foto 2 opcional (Antes/Depois).
  let photo2: PhotoData | null = null;
  if (typeof args.photoDataUrl2 === 'string' && args.photoDataUrl2) {
    const m2 = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      args.photoDataUrl2
    );
    if (m2) {
      const b64_2 = m2[2].replace(/\s+/g, '');
      if ((b64_2.length * 3) / 4 <= MAX_INPUT_BYTES) {
        photo2 = { mime: m2[1], b64: b64_2 };
      }
    }
  }

  const stylePrompt = STYLE_PROMPTS[styleKey];
  const aspectInfo = ASPECT_SIZES[aspectKey];
  const aspectPart = ` FORMATO DE SAÍDA OBRIGATÓRIO: ${aspectInfo.label}. Componha respeitando essa proporção; nada de bordas pretas/brancas pra encaixar.`;
  const hintPart = cleanHint
    ? ` IMPORTANTE — o profissional quer transmitir o seguinte com essa imagem: "${cleanHint}". Componha a arte reforçando visualmente essa mensagem (foco, ângulo, iluminação, destaque do que importa).`
    : '';

  const styleRef = await loadStyleReference({ request: args.request, styleKey });
  const basePrompt = styleRef
    ? buildReferencePrompt(cleanBiz, cleanHint, !!photo2) +
      ' ' +
      stylePrompt +
      aspectPart
    : stylePrompt + aspectPart + hintPart;
  const imgPrompt = HARD_RULES + ' ' + basePrompt;

  const [imgRes, capRes] = await Promise.all([
    generateImageWithFallback({
      prompt: imgPrompt,
      mime: inputMime,
      b64: inputB64,
      size: aspectInfo.openai,
      styleRef,
      photo2,
    }),
    generateCaption({ styleKey, captionHint: cleanHint, businessName: cleanBiz }),
  ]);

  if (imgRes.error) {
    console.error('[ig-art-fail] img-err:', imgRes.error, 'model:', imgRes.modelTried);
    throw new ServiceError('Falha ao gerar arte', 502, {
      detail: String(imgRes.error).slice(0, 240),
      model_tried: imgRes.modelTried,
    });
  }
  if (!imgRes.b64) {
    console.error('[ig-art-fail] sem-imagem, model:', imgRes.modelTried);
    throw new ServiceError('Provider não devolveu imagem', 502, {
      model_tried: imgRes.modelTried,
    });
  }

  return {
    imageDataUrl: 'data:' + (imgRes.mime || 'image/png') + ';base64,' + imgRes.b64,
    caption: capRes.text || FALLBACK_CAPTIONS[styleKey] || FALLBACK_CAPTIONS.portrait,
    style: styleKey,
    aspect: aspectKey,
    model: imgRes.modelTried || OPENAI_IMG_MODEL,
  };
}

// ─── Internals ──────────────────────────────────────────────────────────────

function buildReferencePrompt(
  businessName: string,
  captionHint: string,
  hasPhoto2: boolean
): string {
  const bizPart = businessName
    ? `Substitua qualquer marca/handle/logo de placeholder no template pela marca do profissional: "${businessName}". `
    : 'Mantenha discreto qualquer texto/badge — não invente nomes de marca. ';
  const hintPart = captionHint
    ? `Headline/título principal deve transmitir: "${captionHint}". `
    : 'Headline curta e profissional, em PT-BR, sem clichês de marketing. ';
  if (hasPhoto2) {
    return [
      'IMPORTANTE — você recebe TRÊS imagens.',
      'IMAGEM 1 (TEMPLATE): use como modelo RÍGIDO de layout, divisão antes/depois, tipografia, posição dos rótulos "ANTES"/"DEPOIS", footer e elementos gráficos. Reproduza fielmente a estrutura visual.',
      'IMAGEM 2 (ANTES): use exatamente essa foto na metade ANTES (topo ou esquerda, conforme template).',
      'IMAGEM 3 (DEPOIS): use exatamente essa foto na metade DEPOIS (base ou direita, conforme template).',
      bizPart + hintPart,
      'Resultado final: composição antes/depois no estilo do TEMPLATE, com a foto 2 no antes e a foto 3 no depois.',
    ].join(' ');
  }
  return [
    'IMPORTANTE — você recebe DUAS imagens.',
    'IMAGEM 1 (TEMPLATE): use como modelo RÍGIDO de layout, composição, tipografia, paleta, posição de badges, footer e elementos gráficos. Reproduza fielmente a estrutura visual.',
    'IMAGEM 2 (CONTEÚDO): use o profissional, o ambiente e as cores dela como sujeito principal da arte gerada. Substitua a pessoa/cena do template pelo que está na imagem 2.',
    bizPart + hintPart,
    'Resultado final: arte no estilo do TEMPLATE (imagem 1) mas mostrando o conteúdo da imagem 2.',
  ].join(' ');
}

async function loadStyleReference(args: {
  request: Request;
  styleKey: StyleKey;
}): Promise<StyleReference | null> {
  if (!STYLE_REFERENCES[args.styleKey]) return null;

  // 1. Tenta Supabase storage (admin pode ter sobrescrito o template).
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    supaUrl = '';
  }
  if (supaUrl) {
    for (const ext of ['jpg', 'png', 'webp']) {
      try {
        const url = `${supaUrl}/storage/v1/object/public/style-refs/${args.styleKey}.${ext}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (!resp.ok) continue;
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (!ct.startsWith('image/')) continue;
        const buf = await resp.arrayBuffer();
        if (!buf || buf.byteLength < 1024) continue;
        return { blob: new Blob([buf], { type: ct }), mime: ct };
      } catch {
        /* tenta próxima ext */
      }
    }
  }

  // 2. Fallback: static file no /public do Next.
  const path = STYLE_REFERENCES[args.styleKey];
  try {
    const refUrl = new URL(path, args.request.url).toString();
    const resp = await fetch(refUrl, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength < 1024) return null;
    return { blob: new Blob([buf], { type: ct }), mime: ct };
  } catch (e) {
    console.warn(
      '[ig-art] loadStyleReference falhou:',
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

async function generateImageWithFallback(args: {
  prompt: string;
  mime: string;
  b64: string;
  size: string;
  styleRef: StyleReference | null;
  photo2: PhotoData | null;
}): Promise<ImgResult> {
  const openaiRes = await generateImageOpenAI(args);
  if (openaiRes.b64) {
    return {
      ...openaiRes,
      modelTried:
        OPENAI_IMG_MODEL + (args.styleRef ? '+ref' : '') + (args.photo2 ? '+2' : ''),
    };
  }

  const openaiErr = openaiRes.error || 'sem detalhe';
  console.warn('[ig-art-fail] openai-img-falhou:', openaiErr.slice(0, 240));

  if (!process.env.GEMINI_API_KEY) {
    return { error: openaiErr, modelTried: OPENAI_IMG_MODEL };
  }
  if (/timeout/i.test(openaiErr)) {
    return { error: openaiErr, modelTried: OPENAI_IMG_MODEL };
  }

  const imgModel = process.env.GEMINI_IMG_MODEL || GEMINI_FALLBACK_DEFAULT_MODEL;
  const modelChain = process.env.GEMINI_IMG_MODEL
    ? [imgModel]
    : [imgModel, ...GEMINI_FALLBACK_MODELS];
  // ⚠️ photo2 CRÍTICO: sem ele, fallback Gemini perde "depois" do antes/depois.
  const geminiRes = await generateImageGeminiChain({
    models: modelChain,
    prompt: args.prompt,
    mime: args.mime,
    b64: args.b64,
    styleRef: args.styleRef,
    photo2: args.photo2,
  });
  if (geminiRes.b64) return geminiRes;

  return {
    error: `OpenAI: ${openaiErr.slice(0, 100)} | Gemini: ${(geminiRes.error || '').slice(0, 100)}`,
    modelTried: geminiRes.modelTried || OPENAI_IMG_MODEL,
  };
}

async function generateImageOpenAI(args: {
  prompt: string;
  mime: string;
  b64: string;
  size: string;
  styleRef: StyleReference | null;
  photo2: PhotoData | null;
}): Promise<ImgResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OPENAI_IMG_TIMEOUT_MS);
  try {
    const binary = atob(args.b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = args.mime.includes('png') ? 'png' : args.mime.includes('webp') ? 'webp' : 'jpg';
    const blob = new Blob([bytes], { type: args.mime });

    let blob2: Blob | null = null;
    let ext2 = ext;
    if (args.photo2) {
      const bin2 = atob(args.photo2.b64);
      const bytes2 = new Uint8Array(bin2.length);
      for (let i = 0; i < bin2.length; i++) bytes2[i] = bin2.charCodeAt(i);
      ext2 = args.photo2.mime.includes('png')
        ? 'png'
        : args.photo2.mime.includes('webp')
          ? 'webp'
          : 'jpg';
      blob2 = new Blob([bytes2], { type: args.photo2.mime });
    }

    const form = new FormData();
    form.append('model', OPENAI_IMG_MODEL);
    if (args.styleRef && args.styleRef.blob) {
      const refExt = (args.styleRef.mime || '').includes('png')
        ? 'png'
        : (args.styleRef.mime || '').includes('webp')
          ? 'webp'
          : 'jpg';
      form.append('image[]', args.styleRef.blob, `template.${refExt}`);
      form.append('image[]', blob, `content.${ext}`);
      if (blob2) form.append('image[]', blob2, `content2.${ext2}`);
    } else if (blob2) {
      form.append('image[]', blob, `content1.${ext}`);
      form.append('image[]', blob2, `content2.${ext2}`);
    } else {
      form.append('image', blob, `input.${ext}`);
    }
    form.append('prompt', args.prompt.slice(0, 4000));
    form.append('size', args.size || '1024x1024');
    form.append('n', '1');
    form.append('quality', OPENAI_IMG_QUALITY);

    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: ac.signal,
    });

    if (!r.ok) {
      const errText = (await r.text()).slice(0, 400);
      return { error: `OpenAI ${r.status}: ${errText}` };
    }
    const data = (await r.json()) as {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>;
    };
    const result = data?.data?.[0];
    if (!result?.b64_json) {
      const txt = result?.revised_prompt || JSON.stringify(result).slice(0, 200);
      return { error: `OpenAI sem b64_json: ${txt}` };
    }
    return { b64: result.b64_json, mime: 'image/png' };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: `Timeout (${OPENAI_IMG_TIMEOUT_MS / 1000}s) gpt-image-1` };
    }
    return {
      error: `Erro de rede OpenAI: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function generateImageGeminiChain(args: {
  models: string[];
  prompt: string;
  mime: string;
  b64: string;
  styleRef: StyleReference | null;
  photo2: PhotoData | null;
}): Promise<ImgResult> {
  let lastErr = '';
  let lastModel = '';
  for (const model of args.models) {
    lastModel = model;
    const r = await generateImageGemini({ ...args, model });
    if (r.b64) return { ...r, modelTried: 'gemini:' + model };
    lastErr = r.error || 'sem detalhe';
    const worthRetrying =
      /404|NOT_FOUND|not found|not.support|403|FORBIDDEN|permission|access/i.test(
        lastErr
      );
    if (!worthRetrying) {
      return { error: lastErr, modelTried: 'gemini:' + model };
    }
  }
  return {
    error: 'Gemini: todos modelos falharam. Último: ' + lastErr,
    modelTried: 'gemini:' + lastModel,
  };
}

async function generateImageGemini(args: {
  model: string;
  prompt: string;
  mime: string;
  b64: string;
  styleRef: StyleReference | null;
  photo2: PhotoData | null;
}): Promise<ImgResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEMINI_FALLBACK_TIMEOUT_MS);
  try {
    const parts: Array<
      { text: string } | { inline_data: { mime_type: string; data: string } }
    > = [{ text: args.prompt }];
    if (args.styleRef && args.styleRef.blob) {
      try {
        const refBuf = await args.styleRef.blob.arrayBuffer();
        const refB64 = btoa(String.fromCharCode(...new Uint8Array(refBuf)));
        parts.push({
          inline_data: {
            mime_type: args.styleRef.mime || 'image/jpeg',
            data: refB64,
          },
        });
      } catch {
        /* se falhar conversão, segue sem template */
      }
    }
    parts.push({ inline_data: { mime_type: args.mime, data: args.b64 } });
    if (args.photo2) {
      parts.push({
        inline_data: { mime_type: args.photo2.mime, data: args.photo2.b64 },
      });
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            temperature: 0.7,
          },
        }),
      }
    );
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 400);
      return {
        error: `Gemini ${r.status} (${args.model}): ${errText.slice(0, 200)}`,
      };
    }
    const data = (await r.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inline_data?: { data?: string; mime_type?: string };
            inlineData?: { data?: string; mimeType?: string };
          }>;
        };
      }>;
    };
    const respParts = data?.candidates?.[0]?.content?.parts || [];
    for (const p of respParts) {
      const inline = p.inline_data || p.inlineData;
      if (inline && inline.data) {
        const mime =
          ('mime_type' in inline ? inline.mime_type : undefined) ||
          ('mimeType' in inline ? inline.mimeType : undefined) ||
          'image/png';
        return { b64: inline.data, mime };
      }
    }
    return { error: `"${args.model}" só retornou texto` };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return { error: `Timeout (${GEMINI_FALLBACK_TIMEOUT_MS / 1000}s) Gemini ${args.model}` };
    }
    return {
      error: `Erro Gemini: ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function generateCaption(args: {
  styleKey: StyleKey;
  captionHint: string;
  businessName: string;
}): Promise<{ text: string }> {
  const styleHint =
    {
      portrait: 'retrato profissional do pintor',
      antesdepois: 'antes/depois de uma obra',
      profissional: 'post de marketing do pintor profissional no trabalho',
      trabalho: 'post de marketing do trabalho/ambiente recém-entregue',
      grafite: 'arte/mural em grafite',
    }[args.styleKey] || 'post profissional';

  const system =
    'Você é o Seu Zé — copywriter brasileiro especialista em legendas curtas pra Instagram de pintor, grafiteiro ou pintor automotivo. Sua legenda é direta, soa humana, usa no máximo 2 emojis, sem hashtags genéricas, sem "siga para mais", sem clichês de marketing. Tom de quem trabalha e tem orgulho do trabalho. Máximo 280 caracteres em PT-BR.';

  let user = `Tipo de imagem: ${styleHint}.`;
  if (args.businessName)
    user += `\nNome da empresa do profissional: ${args.businessName}.`;
  if (args.captionHint)
    user += `\nMensagem que o profissional quer transmitir nesse post: "${args.captionHint}". Construa a legenda em volta dessa mensagem, com a voz dele (1ª pessoa, jeito de quem trabalha).`;
  user +=
    '\n\nEscreva 1 legenda curta pra esse post no Instagram. Retorne SÓ a legenda, sem aspas, sem prefixo, sem nada antes ou depois.';

  const { text } = await callAIText({
    systemPrompt: system,
    userMessage: user,
    temperature: 0.85,
    maxTokens: 200,
    prefer: 'gemini',
    timeoutMs: CAPTION_TIMEOUT_MS,
  });

  const cleaned = String(text || '')
    .replace(/^["'`""]/, '')
    .replace(/["'`""]$/, '')
    .replace(/^Legenda:?\s*/i, '')
    .trim()
    .slice(0, 400);
  return { text: cleaned };
}

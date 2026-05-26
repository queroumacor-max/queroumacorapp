// @ts-check
// Gerador de arte pra Instagram a partir de uma foto.
// Pipeline:
//   - PRIMÁRIO: OpenAI gpt-image-1 (image-to-image via /v1/images/edits)
//   - FALLBACK: Gemini image (só se OpenAI falhar RÁPIDO, não em timeout)
//   - Legenda: Gemini Text com fallback OpenAI (callAIText)
// Endpoint PRO, rate-limit baixo (custo de imagem).
//
// Orçamento de tempo (limite Cloudflare Pages: 30s):
//   - Imagem OpenAI: até 22s (1024x1536 vertical e 1536x1024 horizontal são
//     mais lentos que 1024x1024 — costuma demorar 18-25s).
//   - Fallback Gemini (só em erro rápido, ex 404/403): até 4s
//   - Legenda (paralela): até 7s × 2 providers = 14s
//   Promise.all = max(imagem, legenda) ≤ 22s.
//   Outer hard-timeout em 27s GARANTE retorno JSON antes do CF matar (30s).
import { gateProAI, jsonResponse as json, FALLBACK_SUPABASE_URL } from './_security.js';
import { callAIText } from './_ai.js';

const OPENAI_IMG_MODEL = 'gpt-image-1';
const OPENAI_IMG_TIMEOUT_MS = 22000;

const GEMINI_FALLBACK_DEFAULT_MODEL = 'gemini-2.5-flash-image';
const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation'
];
const GEMINI_FALLBACK_TIMEOUT_MS = 4000;

const CAPTION_TIMEOUT_MS = 7000;
const OUTER_HARD_TIMEOUT_MS = 27000;  // < 30s do CF Pages, garante retorno JSON
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

// MODELOS DE COMPOSIÇÃO — cada estilo descreve um template visual rígido
// (enquadramento, distribuição dos elementos, plano de fundo, iluminação)
// pra IA reproduzir um padrão consistente entre gerações.
const STYLE_PROMPTS = {
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
    'Sem texto, sem marca d\'água, sem borda.'
  ].join(' '),
  antesdepois: [
    'MODELO: imagem ANTES/DEPOIS com divisão vertical exata bem no meio do quadro.',
    'METADE ESQUERDA (ANTES): exatamente a cena da foto fornecida sem retoque — superfícies originais,',
    'paredes manchadas/descascadas/sem pintura, iluminação plana e fria, leve dessaturação.',
    'METADE DIREITA (DEPOIS): mesma cena/ângulo após pintura profissional — paredes uniformes, cor sólida e limpa,',
    'acabamento premium sem falhas, iluminação quente e clara, saturação realçada.',
    'LINHA DIVISÓRIA: branca fina ou sutil sombra vertical centralizada, separando as duas metades sem misturar.',
    'O mesmo objeto/ambiente aparece nos dois lados, no mesmo ângulo, só muda o estado.',
    'Sem rótulos de texto, sem marca d\'água, sem moldura.'
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
    'Formato 1:1 Instagram preferencial; ajustar pra formato pedido.'
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
    'Formato 1:1 Instagram preferencial; ajustar pra formato pedido.'
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
    'Sem assinatura legível, sem marca d\'água, sem moldura.'
  ].join(' ')
};

// Mapeamento aspect → tamanho aceito pelo gpt-image-1.
// gpt-image-1 aceita: 1024x1024 (square), 1024x1536 (vertical), 1536x1024 (horizontal).
const ASPECT_SIZES = {
  square:     { openai: '1024x1024', label: 'quadrado 1:1 (feed do Instagram)' },
  vertical:   { openai: '1024x1536', label: 'vertical 2:3 (Reels/Stories)' },
  horizontal: { openai: '1536x1024', label: 'horizontal 3:2 (capa/banner)' }
};

// Referências visuais por estilo. Cada arquivo (se existir em /style-refs/)
// é enviado pra IA como TEMPLATE de composição junto com a foto do usuário.
// Se o arquivo não existir, cai no fluxo só-texto.
const STYLE_REFERENCES = {
  portrait:    '/style-refs/portrait.jpg',
  antesdepois: '/style-refs/antesdepois.jpg',
  profissional:'/style-refs/profissional.jpg',
  trabalho:    '/style-refs/trabalho.jpg',
  grafite:     '/style-refs/grafite.jpg'
};

// Quando uma referência é carregada, prepende esse bloco no prompt
// pra deixar claro pra IA o que fazer com cada imagem.
function buildReferencePrompt(styleKey, businessName, captionHint, hasPhoto2){
  const bizPart = businessName
    ? `Substitua qualquer marca/handle/logo de placeholder no template pela marca do profissional: "${businessName}". `
    : 'Mantenha discreto qualquer texto/badge — não invente nomes de marca. ';
  const hintPart = captionHint
    ? `Headline/título principal deve transmitir: "${captionHint}". `
    : 'Headline curta e profissional, em PT-BR, sem clichês de marketing. ';
  if (hasPhoto2){
    return [
      'IMPORTANTE — você recebe TRÊS imagens.',
      'IMAGEM 1 (TEMPLATE): use como modelo RÍGIDO de layout, divisão antes/depois, tipografia, posição dos rótulos "ANTES"/"DEPOIS", footer e elementos gráficos. Reproduza fielmente a estrutura visual.',
      'IMAGEM 2 (ANTES): use exatamente essa foto na metade ANTES (topo ou esquerda, conforme template).',
      'IMAGEM 3 (DEPOIS): use exatamente essa foto na metade DEPOIS (base ou direita, conforme template).',
      bizPart + hintPart,
      'Resultado final: composição antes/depois no estilo do TEMPLATE, com a foto 2 no antes e a foto 3 no depois.'
    ].join(' ');
  }
  return [
    'IMPORTANTE — você recebe DUAS imagens.',
    'IMAGEM 1 (TEMPLATE): use como modelo RÍGIDO de layout, composição, tipografia, paleta, posição de badges, footer e elementos gráficos. Reproduza fielmente a estrutura visual.',
    'IMAGEM 2 (CONTEÚDO): use o profissional, o ambiente e as cores dela como sujeito principal da arte gerada. Substitua a pessoa/cena do template pelo que está na imagem 2.',
    bizPart + hintPart,
    'Resultado final: arte no estilo do TEMPLATE (imagem 1) mas mostrando o conteúdo da imagem 2.'
  ].join(' ');
}

// Tenta carregar a referência visual do estilo. Ordem de busca:
//   1. Supabase storage bucket style-refs (admin sobe via /api/upload-style-ref)
//   2. Static /style-refs/<style>.jpg no repo (fallback default)
//   3. null (cai no fluxo só-texto)
async function loadStyleReference({ env, request, styleKey }){
  if (!STYLE_REFERENCES[styleKey]) return null;

  // 1. Tenta Supabase storage (admin pode ter sobrescrito o template)
  const supaUrl = (env.SUPABASE_URL || FALLBACK_SUPABASE_URL).replace(/\/$/, '');
  for (const ext of ['jpg', 'png', 'webp']){
    try {
      const url = `${supaUrl}/storage/v1/object/public/style-refs/${styleKey}.${ext}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) continue;
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (!ct.startsWith('image/')) continue;
      const buf = await resp.arrayBuffer();
      if (!buf || buf.byteLength < 1024) continue;
      return { blob: new Blob([buf], { type: ct }), mime: ct };
    } catch(_){ /* tenta próxima ext */ }
  }

  // 2. Fallback: static file no repo
  const path = STYLE_REFERENCES[styleKey];
  try {
    let resp = null;
    if (env && env.ASSETS && typeof env.ASSETS.fetch === 'function'){
      const refUrl = new URL(path, request.url).toString();
      resp = await env.ASSETS.fetch(new Request(refUrl));
    } else {
      const refUrl = new URL(path, request.url).toString();
      resp = await fetch(refUrl, { signal: AbortSignal.timeout(3000) });
    }
    if (!resp || !resp.ok) return null;
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null;
    const buf = await resp.arrayBuffer();
    if (!buf || buf.byteLength < 1024) return null;
    return { blob: new Blob([buf], { type: ct }), mime: ct };
  } catch(e) {
    console.warn('[ig-art] loadStyleReference falhou:', String(e?.message || e));
    return null;
  }
}

const FALLBACK_CAPTIONS = {
  portrait: 'Pronto pra próxima obra. Bora pintar! 🎨',
  antesdepois: 'Antes e depois. Diferença que só o profissional faz. ✨',
  profissional: 'Trabalho entregue com capricho. ✅',
  trabalho: 'Mais um lar transformado. Minha arte, seu novo espaço. 🏠',
  grafite: 'Cor na rua, arte na parede. 🎨'
};

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
export async function onRequestPost(context) {
  // Race contra hard-timeout — se algo passar de 27s, devolvemos JSON 504
  // ANTES do Cloudflare Pages matar a função aos 30s (que retorna 502 sem body).
  const hardTimeout = new Promise(resolve => {
    setTimeout(() => resolve(json({
      error: 'Tempo esgotado',
      detail: 'Gerador de arte demorou mais que o limite. Tente novamente — pode ter sido pico de uso do provedor.'
    }, 504)), OUTER_HARD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([handle(context), hardTimeout]);
  } catch (e) {
    console.warn('[ig-art-fail] handler-crash:', e && e.message);
    return json({ error: 'Erro interno', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
}

/**
 * @param {{ request: Request, env: Record<string, string>, params: Record<string, string> }} context
 * @returns {Promise<Response>}
 */
async function handle(context) {
  const { env, request } = context;

  if (!env.OPENAI_API_KEY) {
    return json({ error: 'OPENAI_API_KEY não configurada no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // PRO + rate-limit (limit baixo: imagem é cara)
  const g = await gateProAI(env, request, body, { endpoint: 'ig-art', limit: 5 });
  if (g instanceof Response) return g;

  const photoDataUrl = typeof body?.photoDataUrl === 'string' ? body.photoDataUrl : '';
  const photoDataUrl2 = typeof body?.photoDataUrl2 === 'string' ? body.photoDataUrl2 : '';
  const styleKey = typeof body?.style === 'string' ? body.style : 'portrait';
  const aspectKey = typeof body?.aspect === 'string' && ASPECT_SIZES[body.aspect] ? body.aspect : 'square';
  const captionHint = typeof body?.captionHint === 'string' ? body.captionHint.trim().slice(0, 300) : '';
  const businessName = typeof body?.businessName === 'string' ? body.businessName.trim().slice(0, 80) : '';

  // Valida foto principal: data URL com base64
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoDataUrl);
  if (!m) return json({ error: 'photoDataUrl inválida — envie uma data URL de imagem' }, 400);
  const inputMime = m[1];
  const inputB64 = m[2].replace(/\s+/g, '');
  if ((inputB64.length * 3 / 4) > MAX_INPUT_BYTES) {
    return json({ error: 'Foto grande demais (máx 8MB). Tente uma menor.' }, 413);
  }

  // Foto 2 opcional (Antes/Depois). Só faz parsing se veio.
  let photo2 = null;
  if (photoDataUrl2){
    const m2 = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoDataUrl2);
    if (m2){
      const b64_2 = m2[2].replace(/\s+/g, '');
      if ((b64_2.length * 3 / 4) <= MAX_INPUT_BYTES){
        photo2 = { mime: m2[1], b64: b64_2 };
      }
    }
  }

  const stylePrompt = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS.portrait;
  const aspectInfo = ASPECT_SIZES[aspectKey];
  const aspectPart = ` FORMATO DE SAÍDA OBRIGATÓRIO: ${aspectInfo.label}. Componha respeitando essa proporção; nada de bordas pretas/brancas pra encaixar.`;
  const hintPart = captionHint
    ? ` IMPORTANTE — o profissional quer transmitir o seguinte com essa imagem: "${captionHint}". Componha a arte reforçando visualmente essa mensagem (foco, ângulo, iluminação, destaque do que importa).`
    : '';

  // Tenta carregar referência visual do estilo (template). Se existir,
  // muda o pipeline pra multi-imagem (template + conteúdo do usuário).
  const styleRef = await loadStyleReference({ env, request, styleKey });
  const imgPrompt = styleRef
    ? buildReferencePrompt(styleKey, businessName, captionHint, !!photo2) + ' ' + stylePrompt + aspectPart
    : stylePrompt + aspectPart + hintPart;

  // Dispara geração de arte + legenda em paralelo
  const [imgRes, capRes] = await Promise.all([
    generateImageWithFallback({ env, prompt: imgPrompt, mime: inputMime, b64: inputB64, size: aspectInfo.openai, styleRef, photo2 }),
    generateCaption({ env, styleKey, captionHint, businessName })
  ]);

  if (imgRes.error) {
    console.error('[ig-art-fail] img-err:', imgRes.error, 'model:', imgRes.modelTried);
    return json({
      error: 'Falha ao gerar arte',
      detail: String(imgRes.error).slice(0, 240),
      model_tried: imgRes.modelTried
    }, 502);
  }
  if (!imgRes.b64) {
    console.error('[ig-art-fail] sem-imagem, model:', imgRes.modelTried);
    return json({
      error: 'Provider não devolveu imagem',
      model_tried: imgRes.modelTried
    }, 502);
  }

  return json({
    imageDataUrl: 'data:' + (imgRes.mime || 'image/png') + ';base64,' + imgRes.b64,
    caption: capRes.text || FALLBACK_CAPTIONS[styleKey] || FALLBACK_CAPTIONS.portrait,
    style: styleKey,
    aspect: aspectKey,
    model: imgRes.modelTried
  });
}

// Pipeline: OpenAI gpt-image-1 → fallback Gemini (só em erro rápido).
/**
 * @typedef {{ blob: Blob, mime: string }} StyleRef
 * @param {{ env: Record<string, string>, prompt: string, mime: string, b64: string, size?: string, styleRef?: StyleRef | null, photo2?: { mime: string, b64: string } | null }} args
 * @returns {Promise<{ b64?: string, mime?: string, error?: string, modelTried?: string }>}
 */
async function generateImageWithFallback({ env, prompt, mime, b64, size, styleRef, photo2 }) {
  // 1. PRIMÁRIO: OpenAI gpt-image-1 (image-to-image edit, opcional + referência + opcional foto2)
  const openaiRes = await generateImageOpenAI({ env, prompt, mime, b64, size, styleRef, photo2 });
  if (openaiRes.b64) return { ...openaiRes, modelTried: OPENAI_IMG_MODEL + (styleRef ? '+ref' : '') + (photo2 ? '+2' : '') };

  const openaiErr = openaiRes.error || 'sem detalhe';
  console.warn('[ig-art-fail] openai-img-falhou:', openaiErr.slice(0, 240));

  // 2. FALLBACK Gemini — APENAS se OpenAI falhou rapidamente E temos chave Gemini.
  // Se OpenAI já comeu 18s em timeout, não dá tempo de tentar Gemini.
  if (!env.GEMINI_API_KEY) {
    return { error: openaiErr, modelTried: OPENAI_IMG_MODEL };
  }
  if (/timeout/i.test(openaiErr)) {
    return { error: openaiErr, modelTried: OPENAI_IMG_MODEL };
  }

  const imgModel = env.GEMINI_IMG_MODEL || GEMINI_FALLBACK_DEFAULT_MODEL;
  const modelChain = env.GEMINI_IMG_MODEL ? [imgModel] : [imgModel, ...GEMINI_FALLBACK_MODELS];
  const geminiRes = await generateImageGeminiChain({ env, models: modelChain, prompt, mime, b64, styleRef });
  if (geminiRes.b64) return { ...geminiRes, modelTried: geminiRes.modelTried };

  // Ambos falharam — devolve erro combinado
  return {
    error: `OpenAI: ${openaiErr.slice(0, 100)} | Gemini: ${(geminiRes.error || '').slice(0, 100)}`,
    modelTried: geminiRes.modelTried || OPENAI_IMG_MODEL
  };
}

// OpenAI gpt-image-1 via /v1/images/edits (multipart com a foto como entrada).
// Quando styleRef existe, usa endpoint multi-imagem: image[] template + image[] foto(s).
// Quando photo2 existe (caso antes/depois), envia ambas fotos como image[].
/**
 * @param {{ env: Record<string, string>, prompt: string, mime: string, b64: string, size?: string, styleRef?: StyleRef | null, photo2?: { mime: string, b64: string } | null }} args
 * @returns {Promise<{ b64?: string, mime?: string, error?: string }>}
 */
async function generateImageOpenAI({ env, prompt, mime, b64, size, styleRef, photo2 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OPENAI_IMG_TIMEOUT_MS);
  try {
    // base64 → Blob (V8 isolates do CF Workers suportam Blob/FormData nativo)
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const blob = new Blob([bytes], { type: mime });

    // Foto 2 opcional (caso Antes/Depois com 2 fotos)
    let blob2 = null, ext2 = ext;
    if (photo2 && photo2.b64 && photo2.mime){
      const bin2 = atob(photo2.b64);
      const bytes2 = new Uint8Array(bin2.length);
      for (let i = 0; i < bin2.length; i++) bytes2[i] = bin2.charCodeAt(i);
      ext2 = photo2.mime.includes('png') ? 'png' : photo2.mime.includes('webp') ? 'webp' : 'jpg';
      blob2 = new Blob([bytes2], { type: photo2.mime });
    }

    const form = new FormData();
    form.append('model', OPENAI_IMG_MODEL);
    if (styleRef && styleRef.blob){
      // Ordem importa: template primeiro (IMAGEM 1), foto(s) do usuário depois
      const refExt = (styleRef.mime || '').includes('png') ? 'png'
        : (styleRef.mime || '').includes('webp') ? 'webp' : 'jpg';
      form.append('image[]', styleRef.blob, `template.${refExt}`);
      form.append('image[]', blob, `content.${ext}`);
      if (blob2) form.append('image[]', blob2, `content2.${ext2}`);
    } else if (blob2) {
      // Sem template mas 2 fotos (ex: antes/depois sem ref)
      form.append('image[]', blob, `content1.${ext}`);
      form.append('image[]', blob2, `content2.${ext2}`);
    } else {
      form.append('image', blob, `input.${ext}`);
    }
    form.append('prompt', prompt.slice(0, 4000));  // OpenAI tem limite de prompt
    form.append('size', size || '1024x1024');
    form.append('n', '1');
    // gpt-image-1 retorna b64_json por padrão no /v1/images/edits

    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: ac.signal
    });

    if (!r.ok) {
      const errText = (await r.text()).slice(0, 400);
      return { error: `OpenAI ${r.status}: ${errText}` };
    }
    const data = await r.json();
    const result = data?.data?.[0];
    if (!result?.b64_json) {
      const txt = result?.revised_prompt || JSON.stringify(result).slice(0, 200);
      return { error: `OpenAI sem b64_json: ${txt}` };
    }
    return { b64: result.b64_json, mime: 'image/png' };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { error: `Timeout (${OPENAI_IMG_TIMEOUT_MS/1000}s) gpt-image-1` };
    }
    return { error: `Erro de rede OpenAI: ${String(e?.message || e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ env: Record<string, string>, models: string[], prompt: string, mime: string, b64: string, styleRef?: StyleRef | null, photo2?: { mime: string, b64: string } | null }} args
 * @returns {Promise<{ b64?: string, mime?: string, error?: string, modelTried?: string }>}
 */
async function generateImageGeminiChain({ env, models, prompt, mime, b64, styleRef, photo2 }) {
  let lastErr = '';
  let lastModel = '';
  for (const model of models) {
    lastModel = model;
    const r = await generateImageGemini({ env, model, prompt, mime, b64, styleRef, photo2 });
    if (r.b64) return { ...r, modelTried: 'gemini:' + model };
    lastErr = r.error || 'sem detalhe';
    const worthRetrying = /404|NOT_FOUND|not found|not.support|403|FORBIDDEN|permission|access/i.test(lastErr);
    if (!worthRetrying) {
      return { error: lastErr, modelTried: 'gemini:' + model };
    }
  }
  return { error: 'Gemini: todos modelos falharam. Último: ' + lastErr, modelTried: 'gemini:' + lastModel };
}

/**
 * @param {{ env: Record<string, string>, model: string, prompt: string, mime: string, b64: string, styleRef?: StyleRef | null, photo2?: { mime: string, b64: string } | null }} args
 * @returns {Promise<{ b64?: string, mime?: string, error?: string }>}
 */
async function generateImageGemini({ env, model, prompt, mime, b64, styleRef, photo2 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEMINI_FALLBACK_TIMEOUT_MS);
  try {
    // Monta parts: texto + (opcional) template + foto(s) do usuário.
    // Ordem importa: template primeiro (IMAGEM 1), foto(s) depois (IMAGEM 2 [+ 3]).
    const parts = [{ text: prompt }];
    if (styleRef && styleRef.blob){
      try {
        const refBuf = await styleRef.blob.arrayBuffer();
        const refB64 = btoa(String.fromCharCode(...new Uint8Array(refBuf)));
        parts.push({ inline_data: { mime_type: styleRef.mime || 'image/jpeg', data: refB64 } });
      } catch(_){ /* se falhar conversão, segue sem template */ }
    }
    parts.push({ inline_data: { mime_type: mime, data: b64 } });
    if (photo2 && photo2.b64 && photo2.mime){
      parts.push({ inline_data: { mime_type: photo2.mime, data: photo2.b64 } });
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            temperature: 0.7
          }
        })
      }
    );
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 400);
      return { error: `Gemini ${r.status} (${model}): ${errText.slice(0, 200)}` };
    }
    const data = await r.json();
    const respParts = data?.candidates?.[0]?.content?.parts || [];
    for (const p of respParts) {
      const inline = p.inline_data || p.inlineData;
      if (inline && inline.data) {
        return { b64: inline.data, mime: inline.mime_type || inline.mimeType || 'image/png' };
      }
    }
    return { error: `"${model}" só retornou texto` };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { error: `Timeout (${GEMINI_FALLBACK_TIMEOUT_MS/1000}s) Gemini ${model}` };
    }
    return { error: `Erro Gemini: ${String(e?.message || e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ env: Record<string, string>, styleKey: string, captionHint: string, businessName: string }} args
 * @returns {Promise<{ text: string }>}
 */
async function generateCaption({ env, styleKey, captionHint, businessName }) {
  const styleHint = ({
    portrait: 'retrato profissional do pintor',
    antesdepois: 'antes/depois de uma obra',
    profissional: 'post de marketing do pintor profissional no trabalho',
    trabalho: 'post de marketing do trabalho/ambiente recém-entregue',
    grafite: 'arte/mural em grafite'
  })[styleKey] || 'post profissional';

  const system = 'Você é o Seu Zé — copywriter brasileiro especialista em legendas curtas pra Instagram de pintor, grafiteiro ou pintor automotivo. Sua legenda é direta, soa humana, usa no máximo 2 emojis, sem hashtags genéricas, sem "siga para mais", sem clichês de marketing. Tom de quem trabalha e tem orgulho do trabalho. Máximo 280 caracteres em PT-BR.';

  let user = `Tipo de imagem: ${styleHint}.`;
  if (businessName) user += `\nNome da empresa do profissional: ${businessName}.`;
  if (captionHint) user += `\nMensagem que o profissional quer transmitir nesse post: "${captionHint}". Construa a legenda em volta dessa mensagem, com a voz dele (1ª pessoa, jeito de quem trabalha).`;
  user += '\n\nEscreva 1 legenda curta pra esse post no Instagram. Retorne SÓ a legenda, sem aspas, sem prefixo, sem nada antes ou depois.';

  const { text } = await callAIText({
    env,
    systemPrompt: system,
    userMessage: user,
    temperature: 0.85,
    maxTokens: 200,
    prefer: 'gemini',          // Gemini text é rápido e barato
    timeoutMs: CAPTION_TIMEOUT_MS  // 8s por provider (cai pra OpenAI se Gemini falhar)
  });

  const cleaned = String(text || '')
    .replace(/^["'`""]/, '')
    .replace(/["'`""]$/, '')
    .replace(/^Legenda:?\s*/i, '')
    .trim()
    .slice(0, 400);
  return { text: cleaned };
}

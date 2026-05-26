// Gerador de arte pra Instagram a partir de uma foto.
// Pipeline:
//   - PRIMÁRIO: OpenAI gpt-image-1 (image-to-image via /v1/images/edits)
//   - FALLBACK: Gemini image (só se OpenAI falhar RÁPIDO, não em timeout)
//   - Legenda: Gemini Text com fallback OpenAI (callAIText)
// Endpoint PRO, rate-limit baixo (custo de imagem).
//
// Orçamento de tempo (limite Cloudflare Pages: 30s):
//   - Imagem OpenAI: até 18s
//   - Fallback Gemini (só em erro rápido, ex 404/403): até 8s
//   - Legenda (paralela): até 8s × 2 providers = 16s
//   Promise.all = max(imagem, legenda) ≤ 24s. Folga de 6s.
import { gateProAI, jsonResponse as json } from './_security.js';
import { callAIText } from './_ai.js';

const OPENAI_IMG_MODEL = 'gpt-image-1';
const OPENAI_IMG_TIMEOUT_MS = 18000;

const GEMINI_FALLBACK_DEFAULT_MODEL = 'gemini-2.5-flash-image';
const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash-image-preview',
  'gemini-2.0-flash-preview-image-generation'
];
const GEMINI_FALLBACK_TIMEOUT_MS = 8000;

const CAPTION_TIMEOUT_MS = 8000;
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
    'MODELO: imagem de catálogo profissional minimalista estilo e-commerce premium.',
    'COMPOSIÇÃO: sujeito/objeto/trabalho principal centralizado, isolado e em foco total,',
    'ocupando ~70% do quadro, com respiro generoso nas bordas.',
    'FUNDO: gradiente neutro sutil (cinza claro → branco, ou bege quente claro), totalmente liso, sem distrações.',
    'ILUMINAÇÃO: luz difusa de softbox, sombra projetada suave embaixo do sujeito (chão refletivo leve),',
    'highlights controlados, sem estouro de luz.',
    'PALETA: tons neutros sofisticados, alta nitidez, look de fotografia comercial.',
    'PRESERVE o sujeito principal da foto original idêntico — só limpe e refine o entorno.',
    'Sem texto, sem logo, sem marca d\'água, sem borda.'
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

const FALLBACK_CAPTIONS = {
  portrait: 'Pronto pra próxima obra. Bora pintar! 🎨',
  antesdepois: 'Antes e depois. Diferença que só o profissional faz. ✨',
  profissional: 'Trabalho entregue com capricho. ✅',
  grafite: 'Cor na rua, arte na parede. 🎨'
};

export async function onRequestPost(context) {
  try {
    return await handle(context);
  } catch (e) {
    console.warn('[ig-art-fail] handler-crash:', e && e.message);
    return json({ error: 'Erro interno', detail: String(e?.message || e).slice(0, 200) }, 500);
  }
}

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
  const styleKey = typeof body?.style === 'string' ? body.style : 'portrait';
  const aspectKey = typeof body?.aspect === 'string' && ASPECT_SIZES[body.aspect] ? body.aspect : 'square';
  const captionHint = typeof body?.captionHint === 'string' ? body.captionHint.trim().slice(0, 300) : '';
  const businessName = typeof body?.businessName === 'string' ? body.businessName.trim().slice(0, 80) : '';

  // Valida foto: data URL com base64
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoDataUrl);
  if (!m) return json({ error: 'photoDataUrl inválida — envie uma data URL de imagem' }, 400);
  const inputMime = m[1];
  const inputB64 = m[2].replace(/\s+/g, '');
  if ((inputB64.length * 3 / 4) > MAX_INPUT_BYTES) {
    return json({ error: 'Foto grande demais (máx 8MB). Tente uma menor.' }, 413);
  }

  const stylePrompt = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS.portrait;
  const aspectInfo = ASPECT_SIZES[aspectKey];
  const aspectPart = ` FORMATO DE SAÍDA OBRIGATÓRIO: ${aspectInfo.label}. Componha respeitando essa proporção; nada de bordas pretas/brancas pra encaixar.`;
  const hintPart = captionHint
    ? ` IMPORTANTE — o profissional quer transmitir o seguinte com essa imagem: "${captionHint}". Componha a arte reforçando visualmente essa mensagem (foco, ângulo, iluminação, destaque do que importa).`
    : '';
  const imgPrompt = stylePrompt + aspectPart + hintPart;

  // Dispara geração de arte + legenda em paralelo
  const [imgRes, capRes] = await Promise.all([
    generateImageWithFallback({ env, prompt: imgPrompt, mime: inputMime, b64: inputB64, size: aspectInfo.openai }),
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
async function generateImageWithFallback({ env, prompt, mime, b64, size }) {
  // 1. PRIMÁRIO: OpenAI gpt-image-1 (image-to-image edit)
  const openaiRes = await generateImageOpenAI({ env, prompt, mime, b64, size });
  if (openaiRes.b64) return { ...openaiRes, modelTried: OPENAI_IMG_MODEL };

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
  const geminiRes = await generateImageGeminiChain({ env, models: modelChain, prompt, mime, b64 });
  if (geminiRes.b64) return { ...geminiRes, modelTried: geminiRes.modelTried };

  // Ambos falharam — devolve erro combinado
  return {
    error: `OpenAI: ${openaiErr.slice(0, 100)} | Gemini: ${(geminiRes.error || '').slice(0, 100)}`,
    modelTried: geminiRes.modelTried || OPENAI_IMG_MODEL
  };
}

// OpenAI gpt-image-1 via /v1/images/edits (multipart com a foto como entrada).
async function generateImageOpenAI({ env, prompt, mime, b64, size }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OPENAI_IMG_TIMEOUT_MS);
  try {
    // base64 → Blob (V8 isolates do CF Workers suportam Blob/FormData nativo)
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const blob = new Blob([bytes], { type: mime });

    const form = new FormData();
    form.append('model', OPENAI_IMG_MODEL);
    form.append('image', blob, `input.${ext}`);
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

async function generateImageGeminiChain({ env, models, prompt, mime, b64 }) {
  let lastErr = '';
  let lastModel = '';
  for (const model of models) {
    lastModel = model;
    const r = await generateImageGemini({ env, model, prompt, mime, b64 });
    if (r.b64) return { ...r, modelTried: 'gemini:' + model };
    lastErr = r.error || 'sem detalhe';
    const worthRetrying = /404|NOT_FOUND|not found|not.support|403|FORBIDDEN|permission|access/i.test(lastErr);
    if (!worthRetrying) {
      return { error: lastErr, modelTried: 'gemini:' + model };
    }
  }
  return { error: 'Gemini: todos modelos falharam. Último: ' + lastErr, modelTried: 'gemini:' + lastModel };
}

async function generateImageGemini({ env, model, prompt, mime, b64 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GEMINI_FALLBACK_TIMEOUT_MS);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ac.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mime, data: b64 } }
            ]
          }],
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
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
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

async function generateCaption({ env, styleKey, captionHint, businessName }) {
  const styleHint = ({
    portrait: 'retrato profissional do pintor',
    antesdepois: 'antes/depois de uma obra',
    profissional: 'foto profissional do trabalho entregue',
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

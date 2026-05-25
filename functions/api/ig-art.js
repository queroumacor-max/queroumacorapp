// Gerador de arte pra Instagram a partir de uma foto.
// Pipeline: Gemini Image (nano banana) gera a arte estilizada + Gemini Text
// escreve a legenda. Endpoint PRO, rate-limit baixo (custo de imagem).
// Modelo de imagem configurável via env GEMINI_IMG_MODEL (default nano banana).
import { gateProAI, jsonResponse as json } from './_security.js';
import { callAIText } from './_ai.js';

const DEFAULT_IMG_MODEL = 'gemini-2.5-flash-image-preview';
// Limitamos a 1 fallback pra caber no timeout de 30s do Cloudflare Pages.
// Imagem leva 8-20s; chain de 4 modelos = 502 garantido.
const IMG_MODEL_FALLBACKS = [
  'gemini-2.0-flash-exp-image-generation'
];
const FETCH_TIMEOUT_MS = 22000; // 22s por tentativa — sobra 6s pra outras coisas
const MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8MB de foto de entrada

// Presets de estilo — chave curta no front, prompt rico aqui.
const STYLE_PROMPTS = {
  portrait: [
    'Transforme essa foto em um retrato cinematográfico profissional, estilo capa de revista,',
    'iluminação tipo estúdio com luz lateral suave, fundo desfocado tipo bokeh com tons quentes,',
    'paleta de cor premium, mantenha rosto e proporções da pessoa idênticos à foto original,',
    'composição em quadrado 1:1 para Instagram, sem texto algum, sem marca d\'água, sem borda.'
  ].join(' '),
  antesdepois: [
    'Componha uma imagem split-screen ANTES/DEPOIS de um trabalho de pintura.',
    'Esquerda (ANTES): exatamente como está hoje na foto fornecida — paredes/superfície atual, sem retoque.',
    'Direita (DEPOIS): mesma cena imaginada após uma pintura profissional caprichada — paredes limpas, tinta uniforme, acabamento premium, sem manchas.',
    'Divisão vertical bem no meio. Formato 1:1 Instagram. Sem texto, sem rótulos, sem marca d\'água.'
  ].join(' '),
  profissional: [
    'Reimagine a foto como uma imagem de marketing profissional limpa do trabalho/produto principal,',
    'fundo neutro de estúdio com leve gradiente, iluminação difusa de catálogo, paleta moderna,',
    'mantenha o sujeito/objeto principal da foto reconhecível, formato 1:1 Instagram,',
    'sem texto algum, sem marca d\'água, sem borda.'
  ].join(' '),
  grafite: [
    'Reimagine a foto como uma arte de grafite urbano brasileiro vibrante,',
    'cores saturadas e contrastantes, traços marcados e expressivos, fundo de muro de tijolo ou concreto,',
    'estilo de mural de rua de São Paulo, mantenha o sujeito principal reconhecível,',
    'formato 1:1 Instagram, sem texto algum, sem assinatura, sem marca d\'água.'
  ].join(' ')
};

// Caption rápida por estilo — usada quando a IA de texto falhar.
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
    // Garante que SEMPRE retorna JSON — nunca deixa Cloudflare devolver HTML 502
    return json({ error: 'Erro interno: ' + String(e?.message || e) }, 500);
  }
}

async function handle(context) {
  const { env, request } = context;

  if (!env.GEMINI_API_KEY) {
    return json({ error: 'GEMINI_API_KEY não configurada no Cloudflare Pages' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // PRO + rate-limit (limit baixo: imagem é cara)
  const g = await gateProAI(env, request, body, { endpoint: 'ig-art', limit: 5 });
  if (g instanceof Response) return g;

  const photoDataUrl = typeof body?.photoDataUrl === 'string' ? body.photoDataUrl : '';
  const styleKey = typeof body?.style === 'string' ? body.style : 'portrait';
  const captionHint = typeof body?.captionHint === 'string' ? body.captionHint.trim().slice(0, 300) : '';
  const businessName = typeof body?.businessName === 'string' ? body.businessName.trim().slice(0, 80) : '';

  // Valida foto: data URL com base64
  const m = /^data:(image\/[a-z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(photoDataUrl);
  if (!m) return json({ error: 'photoDataUrl inválida — envie uma data URL de imagem' }, 400);
  const inputMime = m[1];
  const inputB64 = m[2].replace(/\s+/g, '');
  // Estimativa de bytes: base64 ≈ 4/3 do bruto
  if ((inputB64.length * 3 / 4) > MAX_INPUT_BYTES) {
    return json({ error: 'Foto grande demais (máx 8MB). Tente uma menor.' }, 413);
  }

  const stylePrompt = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS.portrait;
  // captionHint = mensagem do profissional (o que ele quer transmitir/destacar).
  // Entra no prompt da arte (Gemini Image) E na legenda (Gemini Text), pra
  // garantir que a imagem reforça visualmente o que ele quer comunicar.
  const hintPart = captionHint
    ? ` IMPORTANTE — o profissional quer transmitir o seguinte com essa imagem: "${captionHint}". Componha a arte reforçando visualmente essa mensagem (foco, ângulo, iluminação, destaque do que importa).`
    : '';
  const imgPrompt = stylePrompt + hintPart;

  const imgModel = env.GEMINI_IMG_MODEL || DEFAULT_IMG_MODEL;
  // Se a env força um modelo, usa só ele; senão tenta o principal + fallbacks
  const modelChain = env.GEMINI_IMG_MODEL ? [imgModel] : [imgModel, ...IMG_MODEL_FALLBACKS];

  // Dispara geração de arte + legenda em paralelo
  const [imgRes, capRes] = await Promise.all([
    generateImageWithFallback({ env, models: modelChain, prompt: imgPrompt, mime: inputMime, b64: inputB64 }),
    generateCaption({ env, styleKey, captionHint, businessName })
  ]);

  if (imgRes.error) return json({ error: 'Falha ao gerar arte: ' + imgRes.error, modelTried: imgRes.modelTried }, 502);
  if (!imgRes.b64) return json({ error: 'Gemini não devolveu imagem (modelo: ' + (imgRes.modelTried || imgModel) + ')' }, 502);

  return json({
    imageDataUrl: 'data:' + (imgRes.mime || 'image/png') + ';base64,' + imgRes.b64,
    caption: capRes.text || FALLBACK_CAPTIONS[styleKey] || FALLBACK_CAPTIONS.portrait,
    style: styleKey,
    model: imgRes.modelTried
  });
}

async function generateImageWithFallback({ env, models, prompt, mime, b64 }) {
  let lastErr = '';
  let lastModel = '';
  for (const model of models) {
    lastModel = model;
    const r = await generateImage({ env, model, prompt, mime, b64 });
    if (r.b64) return { ...r, modelTried: model };
    lastErr = r.error || 'sem detalhe';
    // Fallback SÓ quando o modelo não existe (404). Timeout/quota/permissão
    // não vão melhorar com outro modelo e estouram o limite de 30s do Pages.
    const isModelNotFound = /404|NOT_FOUND|not found|not.support/i.test(lastErr);
    if (!isModelNotFound) {
      return { error: lastErr, modelTried: model };
    }
    console.warn('ig-art: modelo', model, 'inexistente, tentando próximo:', lastErr);
  }
  return { error: 'Todos os modelos retornaram 404. Último: ' + lastErr, modelTried: lastModel };
}

async function generateImage({ env, model, prompt, mime, b64 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
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
            // Ordem importa: TEXT primeiro, IMAGE depois (formato esperado pela API)
            responseModalities: ['TEXT', 'IMAGE'],
            temperature: 0.7
          }
        })
      }
    );
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 400);
      // Detecta erros típicos pra mensagem mais clara
      if (r.status === 404 || /not found|NOT_FOUND/i.test(errText)) {
        return { error: `Modelo "${model}" não encontrado (HTTP ${r.status}). ${errText.slice(0,120)}` };
      }
      if (r.status === 403) {
        return { error: `Sem permissão pra usar "${model}" (HTTP 403). Habilite Imagen/Gemini Image na sua chave. ${errText.slice(0,120)}` };
      }
      if (r.status === 400) {
        return { error: `Request inválido pra "${model}" (HTTP 400). ${errText.slice(0,200)}` };
      }
      return { error: `Gemini ${r.status} (${model}): ${errText}` };
    }
    const data = await r.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    // Procura a primeira parte com inline_data (a imagem gerada)
    for (const p of parts) {
      const inline = p.inline_data || p.inlineData;
      if (inline && inline.data) {
        return { b64: inline.data, mime: inline.mime_type || inline.mimeType || 'image/png' };
      }
    }
    // Sem imagem na resposta — coleta o texto pra debug
    const txt = parts.map(p => p.text).filter(Boolean).join(' ').slice(0, 200);
    return { error: `"${model}" retornou só texto: ${txt || '(vazio)'}` };
  } catch (e) {
    if (e?.name === 'AbortError') {
      return { error: `Timeout (${FETCH_TIMEOUT_MS/1000}s) gerando com "${model}"` };
    }
    return { error: `Erro de rede pra "${model}": ` + String(e?.message || e) };
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
    prefer: 'gemini'  // Gemini já tá quente da chamada de imagem
  });

  // Limpa aspas / formatação típica
  const cleaned = String(text || '')
    .replace(/^["'`""]/, '')
    .replace(/["'`""]$/, '')
    .replace(/^Legenda:?\s*/i, '')
    .trim()
    .slice(0, 400);
  return { text: cleaned };
}

// aiChat.ts — service layer pra feature "Seu Zé" (assistente IA + chat com
// voz + sugestões de preço/escopo). Porta o subset de modules/ai-chat.js do
// vanilla (sendAiChat, falarSeuZe, aiChatHandleVoice, sugerirEscopoIA), mas
// sem o acoplamento DOM/global: cada função é pura (recebe params, devolve
// dado tipado ou estoura AppError).
//
// Endpoints atrás:
//   - POST /api/chat-ai           → { reply } (chat com o Seu Zé)
//   - POST /api/transcribe        → { text }  (Whisper STT via FormData)
//   - POST /api/tts               → audio/mpeg (OpenAI TTS, Blob)
//   - POST /api/pricing-suggest   → { price, justification } (sugestão de preço)
//
// Todos esses endpoints são gated PRO server-side via gateProAI. O frontend
// faz gate visual (canSeeProFeature) pra evitar requests inúteis, mas a
// checagem definitiva fica no servidor.
//
// Knowledge base offline: mantemos o mesmo dicionário do vanilla aqui mesmo
// (não duplica em outro módulo) pra que o fallback funcione sem network.
// Quando o backend responde, o knowledge não é consultado.

import { NetworkError, ValidationError } from '@/lib/errors';

// ─── Knowledge base offline (fallback quando /api/chat-ai falha) ──────────
// Espelha o `_aiKnowledge` de modules/ai-chat.js. Usado só quando o backend
// não responde — a IA real cobre muito mais cenários. Manter aqui evita
// trazer fetch desnecessário pra UI mostrar "tente de novo" — pelo menos
// o usuário recebe uma resposta útil mesmo offline.
export const aiKnowledge: Record<string, string> = {
  tinta:
    'Para paredes internas, recomendo tinta acrílica acetinada (melhor custo-benefício). Para áreas úmidas, use tinta acrílica semi-brilho. Para fachadas, tinta elastomérica. Rendimento médio: 10-12m²/L por demão.',
  textura:
    'Texturas mais pedidas: Grafiato (rolo texturizado), Marmorato (efeito mármore com espátula), Cimento Queimado (2-3 demãos de massa + verniz). Preço médio: R$35-60/m² dependendo da técnica.',
  preco:
    'Valores médios de mão de obra: Pintura simples R$18-25/m², Textura R$35-60/m², Epóxi R$50-80/m², Fachada R$25-40/m². Sempre inclua material + mão de obra + deslocamento no orçamento.',
  epoxi:
    'Piso epóxi: lixar o piso, aplicar primer epóxi, 2-3 demãos de epóxi (intervalo de 12h). Rendimento: 4-6m²/L. Cura total: 7 dias. Preço médio: R$50-80/m² com material.',
  rendimento:
    'Tinta acrílica: 10-12m²/L. Massa corrida: 4-6m²/L. Selador: 8-10m²/L. Textura: 2-4m²/L. Sempre compre 10% a mais como margem de segurança.',
  preparo:
    'Preparação é 70% do resultado! 1) Limpe a parede. 2) Lixe com lixa 150. 3) Aplique massa corrida nas imperfeições. 4) Lixe novamente com 220. 5) Aplique selador. 6) Pinte com rolo de lã.',
  cor: 'Tendências: tons terrosos (terracota, argila), verde-salvia, azul petróleo. Para ambientes pequenos: cores claras ampliam. Para destaque: parede accent em tom mais escuro. Sempre teste uma amostra antes!',
  ferramenta:
    'Kit básico: rolo de lã 23cm, trincha 2" e 3", bandeja, fita crepe, lona plástica, espátula, lixa 150 e 220, escada. Para textura: desempenadeira de aço e espátula de plástico.',
  infiltracao:
    'Antes de pintar parede com infiltração: 1) Resolva a causa da infiltração. 2) Raspe a área afetada. 3) Aplique impermeabilizante. 4) Massa corrida após secar. 5) Selador. 6) Pintura. Sem resolver a causa, volta sempre.',
  calculo:
    'Cálculo rápido: meça comprimento × altura de cada parede. Subtraia portas (1.6m²) e janelas (2.4m²). Multiplique pelo número de demãos. Divida pelo rendimento da tinta (10m²/L). Adicione 10% de margem.',
};

// Resposta offline padrão quando nem o backend nem o knowledge base ajudam.
// Mantém o "tom" do Seu Zé do vanilla (disclaimer + fallback honesto).
const OFFLINE_FALLBACK =
  'Conexão com o Seu Zé falhou no momento. Tente novamente em alguns segundos.';

// Disclaimer prepended em respostas que vêm SÓ do knowledge base offline (não
// nas respostas do backend real). Mesma string do vanilla pra paridade.
const DISCLAIMER =
  'Sou o Seu Zé (assistente virtual). Qualquer confirmação de informações ditas aqui eu recomendo checar com o representante da marca ou lojista que você escolher.\n\n';

// History trimming: vanilla mantém 20 últimas msgs no array (10 turnos
// completos). Exportamos pra hook/UI poder rodar o trim sem importar mágica.
export const MAX_HISTORY = 20;

// ─── Shapes ──────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatAiResponse {
  reply?: string;
  error?: string;
}

interface TranscribeResponse {
  text?: string;
  error?: string;
}

interface PricingResponse {
  price?: number;
  justification?: string;
  area_m2?: number;
  rate_brl_per_m2?: number;
  extras_brl?: number;
  error?: string;
}

// Input pra suggestPrice — espelha o que /api/pricing-suggest espera. Todos
// opcionais (o backend exige pelo menos um), mas TS deixa o caller escolher.
export interface SuggestPriceInput {
  service_type?: string;
  description?: string;
  area_m2?: number;
}

export interface SuggestPriceResult {
  price: number;
  justification: string;
}

// Lookup do knowledge base offline. Exposto pra teste e pra o hook poder
// chamar sem ir na rede quando o backend está claramente fora (ex.: status
// 503 já recebido). Não prepend DISCLAIMER aqui — caller decide.
export function lookupKnowledge(query: string): string | null {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return null;

  // Match direto pelas chaves (substring). Mesma ordem de checagem do vanilla.
  for (const [key, answer] of Object.entries(aiKnowledge)) {
    if (q.includes(key)) return answer;
  }

  // Heurísticas por regex pra capturar perguntas em PT-BR sem casar a chave
  // exata (ex.: "quanto cobrar?" → preco). Ordem importa: a primeira que
  // bate vence — alinha 1:1 com o vanilla.
  if (q.match(/quanto|valor|cobr|preci/)) return aiKnowledge.preco;
  if (q.match(/quant|litro|galao|lata/)) return aiKnowledge.rendimento;
  if (q.match(/prepar|lixa|massa|antes/)) return aiKnowledge.preparo;
  if (q.match(/umid|mofo|infiltr|vazam/)) return aiKnowledge.infiltracao;
  if (q.match(/qual tinta|melhor tinta|tipo.*tinta/)) return aiKnowledge.tinta;
  if (q.match(/calcul|medir|medid|area/)) return aiKnowledge.calculo;
  if (q.match(/tend|cor|tom|paleta/)) return aiKnowledge.cor;
  if (q.match(/ferrament|rolo|pincel|trincha/)) return aiKnowledge.ferramenta;
  return null;
}

// Aplica o disclaimer do Seu Zé se ainda não estiver presente. Idempotente.
export function withDisclaimer(reply: string): string {
  if (/^(Sou o Seu Zé|Sou um assistente virtual)/i.test(reply)) return reply;
  return DISCLAIMER + reply;
}

// Trim history pra MAX_HISTORY últimas msgs. Função pura — caller decide
// quando rodar (após cada turno bem-sucedido).
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  if (history.length <= MAX_HISTORY) return history;
  return history.slice(-MAX_HISTORY);
}

/**
 * Manda uma mensagem ao Seu Zé. POST /api/chat-ai com `{ message, history }`.
 *
 * Comportamento:
 *  - Valida que `userMessage` não está vazio (defesa em profundidade — UI já
 *    deveria bloquear).
 *  - Se backend responder ok + reply: retorna o reply DIRETO (sem disclaimer
 *    — o backend já controla o tom).
 *  - Se backend falhar (rede, 4xx, 5xx, body inválido): consulta knowledge
 *    base offline, aplica disclaimer e retorna. Última cartada: OFFLINE_FALLBACK.
 *
 * Não estoura — o contrato é "sempre tem reply pra mostrar". Isso espelha o
 * UX do vanilla que sempre coloca uma resposta na thread, mesmo em falha.
 * Caller (hook) decide se sinaliza erro via toast separado (ver UseSeuZe).
 */
export async function sendChatMessage(
  history: ChatMessage[],
  userMessage: string,
  signal?: AbortSignal,
  opts?: { endpoint?: string },
): Promise<string> {
  const text = String(userMessage || '').trim();
  if (!text) throw new ValidationError('Mensagem vazia');

  // Endpoint padrão = Seu Zé. Alice passa '/api/alice'.
  const endpoint = opts?.endpoint || '/api/chat-ai';

  let res: Response | null = null;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
      signal,
    });
  } catch (e) {
    // AbortError propaga pra caller cancelar UI sem mostrar fallback.
    if ((e as { name?: string })?.name === 'AbortError') {
      throw e;
    }
    return offlineReply(text);
  }

  // Tenta parsear mesmo em erro — backend pode mandar { error: '...' } útil
  // pro hook logar; aqui só queremos o reply.
  let data: ChatAiResponse | null = null;
  try {
    data = (await res.json()) as ChatAiResponse;
  } catch {
    data = null;
  }

  // Se o backend mandou um reply explícito (mesmo em 429/4xx — caso da
  // Alice quando bate o limite diário com mensagem amigável + CTA pra
  // loja), respeitamos. Só caímos no offlineReply pra falhas SEM reply.
  if (data?.reply) return data.reply;
  if (!res.ok || !data) return offlineReply(text);
  return offlineReply(text);
}

// Helper privado: monta o reply offline (knowledge base + disclaimer).
function offlineReply(text: string): string {
  const found = lookupKnowledge(text) ?? OFFLINE_FALLBACK;
  return withDisclaimer(found);
}

/**
 * Sugere escopo de serviço (texto pra colar em "Observações" de um orçamento).
 * Reusa o mesmo /api/chat-ai do chat normal — só monta um prompt específico.
 * Vanilla: sugerirEscopoIA em modules/ai-chat.js linha 232.
 *
 * Diferente de sendChatMessage, aqui ESTOURA em falha — o caller (UI do
 * orçamento) precisa saber pra mostrar erro inline e não preencher o textarea
 * com lixo. Sem fallback offline (escopo é texto criativo, não cabe no
 * dicionário).
 *
 * Remove o disclaimer "Sou o Seu Zé..." se vier — escopo é texto profissional
 * que vai direto pro PDF do orçamento.
 */
export async function suggestScope(
  jobDescription: string,
  signal?: AbortSignal
): Promise<string> {
  const desc = String(jobDescription || '').trim();
  if (!desc) throw new ValidationError('Descrição vazia');

  // Mantém o prompt enxuto — backend já tem system message que orienta o tom.
  const prompt =
    'Você é um pintor profissional. Escreva, em português, um escopo de serviço objetivo (4 a 6 linhas, sem títulos) para o seguinte trabalho: ' +
    desc +
    '. Liste preparação, aplicação, prazo estimado e garantia. Texto pronto para colar no orçamento.';

  let res: Response;
  try {
    res = await fetch('/api/chat-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, history: [] }),
      signal,
    });
  } catch (e) {
    throw new NetworkError('Falha de rede ao sugerir escopo', e);
  }

  let data: ChatAiResponse | null = null;
  try {
    data = (await res.json()) as ChatAiResponse;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new NetworkError(msg);
  }
  if (!data?.reply) {
    throw new NetworkError('Resposta inválida do servidor');
  }

  // Remove o disclaimer do começo (regex mesma do vanilla linha 252).
  return data.reply
    .replace(/^\s*Sou (o Seu Zé|um assistente virtual)[^\n]*\n+/i, '')
    .trim();
}

/**
 * Transcreve um Blob de áudio via Whisper. POST /api/transcribe multipart.
 * Vanilla: aiChatHandleVoice em modules/ai-chat.js linha 178.
 *
 * Estoura em falha — sem texto não há o que mostrar. O hook (useSeuZe)
 * captura e mostra toast.
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  if (!audioBlob || audioBlob.size === 0) {
    throw new ValidationError('Áudio vazio');
  }

  const fd = new FormData();
  // Nome do arquivo é só metadata; o backend usa o content-type do blob.
  fd.append('audio', audioBlob, 'voice.webm');

  let res: Response;
  try {
    res = await fetch('/api/transcribe', { method: 'POST', body: fd });
  } catch (e) {
    throw new NetworkError('Falha de rede ao transcrever áudio', e);
  }

  let data: TranscribeResponse | null = null;
  try {
    data = (await res.json()) as TranscribeResponse;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new NetworkError(msg);
  }
  if (!data?.text) {
    throw new NetworkError('Não foi possível entender o áudio');
  }
  return data.text;
}

/**
 * Sintetiza fala (TTS) do texto e devolve uma `audioUrl` pronta pra <audio>.
 * Vanilla: falarSeuZe em modules/ai-chat.js linha 194.
 *
 * O caller é responsável por `URL.revokeObjectURL(audioUrl)` quando terminar
 * de tocar — devolvemos object URL pra evitar serializar base64 em memória.
 * Em ambiente node (sem URL.createObjectURL) estoura.
 *
 * Truncamos em 1500 chars como o vanilla — TTS cobra por caractere e a UX
 * pede pra responder rápido, não pra ler romance.
 */
export async function textToSpeech(
  text: string,
  signal?: AbortSignal,
  opts?: { endpoint?: string; voice?: string },
): Promise<string> {
  const t = String(text || '').trim();
  if (!t) throw new ValidationError('Texto vazio');

  // Endpoint default = Seu Zé (PRO + onyx). Alice passa
  // '/api/alice/tts' + voice 'nova'.
  const endpoint = opts?.endpoint || '/api/tts';
  const body: Record<string, unknown> = { text: t.slice(0, 1500) };
  if (opts?.voice) body.voice = opts.voice;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new NetworkError('Falha de rede ao gerar áudio', e);
  }

  if (!res.ok) {
    // TTS retorna audio binário em sucesso e JSON em erro. Tenta extrair
    // mensagem; senão usa status code.
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      // sem json — segue com status
    }
    throw new NetworkError(msg);
  }

  const blob = await res.blob();
  if (typeof URL === 'undefined' || !URL.createObjectURL) {
    throw new NetworkError('URL.createObjectURL não disponível neste ambiente');
  }
  return URL.createObjectURL(blob);
}

/**
 * Sugere um preço total para um orçamento. POST /api/pricing-suggest.
 * Vanilla: chamado em modules/ai-orcamento.js (suggestPrice) — backend mesmo.
 *
 * Retorna `{ price, justification }`. Estoura ValidationError se input vazio
 * (backend rejeita 400 mas falhamos antes pra economizar round-trip) e
 * NetworkError em qualquer outra falha. O backend tem matemática determinística
 * que corrige erros do LLM (area × rate); confiamos no número.
 */
export async function suggestPrice(
  input: SuggestPriceInput,
  signal?: AbortSignal
): Promise<SuggestPriceResult> {
  const serviceType = (input.service_type || '').trim();
  const description = (input.description || '').trim();
  const areaRaw = input.area_m2;
  const area =
    typeof areaRaw === 'number' && Number.isFinite(areaRaw) && areaRaw > 0
      ? areaRaw
      : null;

  if (!serviceType && !description && !area) {
    throw new ValidationError(
      'Informe ao menos service_type, description ou area_m2'
    );
  }

  let res: Response;
  try {
    res = await fetch('/api/pricing-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_type: serviceType || undefined,
        description: description || undefined,
        area_m2: area ?? undefined,
      }),
      signal,
    });
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    throw new NetworkError('Falha de rede ao sugerir preço', e);
  }

  let data: PricingResponse | null = null;
  try {
    data = (await res.json()) as PricingResponse;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new NetworkError(msg);
  }

  const price = typeof data?.price === 'number' ? data.price : NaN;
  if (!Number.isFinite(price) || price <= 0) {
    throw new NetworkError('Resposta inválida do servidor');
  }

  return {
    price,
    justification:
      typeof data?.justification === 'string' ? data.justification : '',
  };
}

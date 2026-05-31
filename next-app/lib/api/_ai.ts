// lib/api/_ai.ts — port de `functions/api/_ai.js`.
//
// Wrapper compartilhado de OpenAI Chat Completions com FALLBACK automático
// pro Gemini quando OpenAI faltar/falhar. Todos os endpoints de IA (chat,
// agenda, crm, resolve-color, ig-art caption, etc.) consomem `callAIText`.
//
// Diferenças do vanilla:
//   - Lê chaves de `process.env` em vez de receber `env` parâmetro.
//     Acceitamos `OPENAI_API_KEY`/`GEMINI_API_KEY` direto do environment
//     do Next edge runtime.
//   - Tipos TS estritos. `Role` é literal `'user'|'assistant'`.
//   - `error` é sempre string (vazia em sucesso) — chamador checa `!text`
//     pra decidir se faz throw.

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const OPENAI_MODEL = 'gpt-4o-mini';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AITextOpts {
  systemPrompt: string;
  userMessage: string;
  history?: ChatHistoryMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  prefer?: 'openai' | 'gemini';
  timeoutMs?: number;
}

export interface AITextResult {
  text: string;
  error: string;
}

interface OpenAIChatBody {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  max_tokens: number;
  response_format?: { type: 'json_object' };
}

/**
 * Chama OpenAI ou Gemini conforme `prefer`, com fallback automático no outro
 * provider se o primeiro retornar vazio/erro.
 */
export async function callAIText(opts: AITextOpts): Promise<AITextResult> {
  const {
    systemPrompt,
    userMessage,
    history = [],
    temperature = 0.5,
    maxTokens = 500,
    json = false,
    prefer = 'openai',
    timeoutMs = 25000,
  } = opts;

  const tryOpenAI = async (): Promise<AITextResult> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return { text: '', error: 'OPENAI_API_KEY ausente' };
    try {
      const messages: OpenAIChatBody['messages'] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
      ];
      const body: OpenAIChatBody = {
        model: OPENAI_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      };
      if (json) body.response_format = { type: 'json_object' };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 150);
        return { text: '', error: `OpenAI ${r.status}: ${txt}` };
      }
      const data = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      return { text, error: text ? '' : 'OpenAI retornou vazio' };
    } catch (e) {
      return { text: '', error: 'OpenAI: ' + (e instanceof Error ? e.message : String(e)) };
    }
  };

  const tryGemini = async (): Promise<AITextResult> => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return { text: '', error: 'GEMINI_API_KEY ausente' };
    try {
      const contents = [
        ...history.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: userMessage }] },
      ];
      const gconf: {
        temperature: number;
        maxOutputTokens: number;
        responseMimeType?: string;
      } = { temperature, maxOutputTokens: maxTokens };
      if (json) gconf.responseMimeType = 'application/json';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: gconf,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 150);
        return { text: '', error: `Gemini ${r.status}: ${txt}` };
      }
      const data = (await r.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      return { text, error: text ? '' : 'Gemini retornou vazio' };
    } catch (e) {
      return { text: '', error: 'Gemini: ' + (e instanceof Error ? e.message : String(e)) };
    }
  };

  let res: AITextResult;
  if (prefer === 'openai') {
    res = await tryOpenAI();
    if (!res.text) res = await tryGemini();
  } else {
    res = await tryGemini();
    if (!res.text) res = await tryOpenAI();
  }
  return res;
}

// ─── Helpers compartilhados ─────────────────────────────────────────────────

/**
 * ArrayBuffer → base64 chunked. Evita stack overflow em imagens grandes
 * (apply é limitado a ~65k argumentos).
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  return btoa(bin);
}

/**
 * Lê uma File/Blob de imagem e devolve `data:<mime>;base64,...`.
 */
export async function imageToDataUrl(image: File | Blob): Promise<string> {
  const buf = await image.arrayBuffer();
  const b64 = arrayBufferToBase64(buf);
  const mime =
    image.type && /^image\//.test(image.type)
      ? image.type.split(';')[0]
      : 'image/jpeg';
  return `data:${mime};base64,${b64}`;
}

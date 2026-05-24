// Helper compartilhado: chama OpenAI Chat Completions com fallback automático
// para Gemini quando OpenAI faltar/falhar. Retorna { text, error } sempre.
// Opts: { temperature, maxTokens, json } (json=true seta response_format).
// Prefixo `_` para que o Cloudflare Pages Functions NÃO o exponha como rota.

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const OPENAI_MODEL = 'gpt-4o-mini';

export async function callAIText({
  env, systemPrompt, userMessage,
  history = [],            // [{role:'user'|'assistant', content:'...'}]
  temperature = 0.5,
  maxTokens = 500,
  json = false,
  prefer = 'openai'        // 'openai' | 'gemini'
}) {
  const tryOpenAI = async () => {
    if (!env.OPENAI_API_KEY) return { text: '', error: 'OPENAI_API_KEY ausente' };
    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
      ];
      const body = { model: OPENAI_MODEL, messages, temperature, max_tokens: maxTokens };
      if (json) body.response_format = { type: 'json_object' };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) return { text: '', error: `OpenAI ${r.status}: ${(await r.text()).slice(0,150)}` };
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content?.trim() || '';
      return { text, error: text ? '' : 'OpenAI retornou vazio' };
    } catch (e) {
      return { text: '', error: 'OpenAI: ' + String(e?.message || e) };
    }
  };
  const tryGemini = async () => {
    if (!env.GEMINI_API_KEY) return { text: '', error: 'GEMINI_API_KEY ausente' };
    try {
      const contents = [
        ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        { role: 'user', parts: [{ text: userMessage }] }
      ];
      const gconf = { temperature, maxOutputTokens: maxTokens };
      if (json) gconf.responseMimeType = 'application/json';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: gconf
          })
        }
      );
      if (!r.ok) return { text: '', error: `Gemini ${r.status}: ${(await r.text()).slice(0,150)}` };
      const data = await r.json();
      const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      return { text, error: text ? '' : 'Gemini retornou vazio' };
    } catch (e) {
      return { text: '', error: 'Gemini: ' + String(e?.message || e) };
    }
  };

  let res;
  if (prefer === 'openai') {
    res = await tryOpenAI();
    if (!res.text) res = await tryGemini();
  } else {
    res = await tryGemini();
    if (!res.text) res = await tryOpenAI();
  }
  return res;
}

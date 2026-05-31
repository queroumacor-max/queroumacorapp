// @ts-check
// Business logic — diagnóstico de modelos Gemini/OpenAI disponíveis nas chaves.
// Útil pra descobrir se a chave Gemini tem acesso a image generation.

const TIMEOUT_MS = 10000;

/**
 * @param {{ env: Record<string,string>, testOpenAI?: boolean }} args
 * @returns {Promise<{ gemini: any, openai: any }>}
 */
export async function diagnoseIgArt({ env, testOpenAI }) {
  /** @type {any} */
  const result = {
    gemini: { configured: !!env.GEMINI_API_KEY },
    openai: { configured: !!env.OPENAI_API_KEY }
  };

  if (env.GEMINI_API_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}&pageSize=200`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 300);
        result.gemini.error = `HTTP ${r.status}: ${txt}`;
      } else {
        const data = await r.json();
        const models = (data.models || []).map(m => ({
          name: String(m.name || '').replace(/^models\//, ''),
          displayName: m.displayName,
          methods: m.supportedGenerationMethods || []
        }));
        result.gemini.total = models.length;
        result.gemini.image_models = models.filter(m =>
          /image|imagen|nano.?banana/i.test(m.name) ||
          /image|imagen|nano.?banana/i.test(m.displayName || '')
        );
        result.gemini.first_30_models = models.slice(0, 30).map(m => m.name);
      }
    } catch (e) {
      result.gemini.error = 'erro de rede: ' + String(e?.message || e);
    }
  }

  if (testOpenAI && env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 300);
        result.openai.error = `HTTP ${r.status}: ${txt}`;
      } else {
        const data = await r.json();
        const all = (data.data || []).map(m => m.id);
        result.openai.image_models = all.filter(id => /gpt-image|dall-e/i.test(id));
        result.openai.total = all.length;
      }
    } catch (e) {
      result.openai.error = 'erro de rede: ' + String(e?.message || e);
    }
  }

  return result;
}

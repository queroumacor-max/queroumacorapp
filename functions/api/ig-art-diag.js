// Diagnóstico: lista modelos Gemini disponíveis na chave configurada.
// Útil pra descobrir se a chave tem acesso a image generation.
// PRO-gated (só dev autenticado) + rate-limit baixo.
//
// Uso:
//   GET /api/ig-art-diag        → lista modelos da chave Gemini
//   GET /api/ig-art-diag?openai=1 → testa também acesso a OpenAI gpt-image-1
import { gateProAI, jsonResponse as json } from './_security.js';

export async function onRequestGet(context) {
  const { env, request } = context;

  // PRO-gate (só dev/PRO pode rodar diagnóstico — chave Gemini não vaza no response)
  const g = await gateProAI(env, request, {}, { endpoint: 'ig-art-diag', limit: 10 });
  if (g instanceof Response) return g;

  const url = new URL(request.url);
  const testOpenAI = url.searchParams.get('openai') === '1';

  const result = {
    gemini: { configured: !!env.GEMINI_API_KEY },
    openai: { configured: !!env.OPENAI_API_KEY }
  };

  // 1. Lista modelos Gemini
  if (env.GEMINI_API_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}&pageSize=200`,
        { signal: AbortSignal.timeout(10000) }
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
        // Filtra os que parecem suportar image gen (nome ou displayName contém "image")
        result.gemini.image_models = models.filter(m =>
          /image|imagen|nano.?banana/i.test(m.name) ||
          /image|imagen|nano.?banana/i.test(m.displayName || '')
        );
        // Lista dos primeiros 30 modelos pra contexto geral
        result.gemini.first_30_models = models.slice(0, 30).map(m => m.name);
      }
    } catch (e) {
      result.gemini.error = 'erro de rede: ' + String(e?.message || e);
    }
  }

  // 2. (Opcional) Verifica OpenAI — chama /v1/models e filtra por gpt-image
  if (testOpenAI && env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 300);
        result.openai.error = `HTTP ${r.status}: ${txt}`;
      } else {
        const data = await r.json();
        const all = (data.data || []).map(m => m.id);
        result.openai.image_models = all.filter(id =>
          /gpt-image|dall-e/i.test(id)
        );
        result.openai.total = all.length;
      }
    } catch (e) {
      result.openai.error = 'erro de rede: ' + String(e?.message || e);
    }
  }

  return json(result);
}

// lib/api/_services/ig-art-diag.ts — port de
// `functions/api/_services/ig-art-diag.js`. Diagnóstico de modelos disponíveis.

const TIMEOUT_MS = 10000;

export interface DiagResult {
  gemini: {
    configured: boolean;
    error?: string;
    total?: number;
    image_models?: Array<{ name: string; displayName?: string; methods: string[] }>;
    first_30_models?: string[];
  };
  openai: {
    configured: boolean;
    error?: string;
    total?: number;
    image_models?: string[];
  };
}

export async function diagnoseIgArt(args: {
  testOpenAI?: boolean;
}): Promise<DiagResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const result: DiagResult = {
    gemini: { configured: !!geminiKey },
    openai: { configured: !!openaiKey },
  };

  if (geminiKey) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}&pageSize=200`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 300);
        result.gemini.error = `HTTP ${r.status}: ${txt}`;
      } else {
        const data = (await r.json()) as {
          models?: Array<{
            name?: string;
            displayName?: string;
            supportedGenerationMethods?: string[];
          }>;
        };
        const models = (data.models || []).map((m) => ({
          name: String(m.name || '').replace(/^models\//, ''),
          displayName: m.displayName,
          methods: m.supportedGenerationMethods || [],
        }));
        result.gemini.total = models.length;
        result.gemini.image_models = models.filter(
          (m) =>
            /image|imagen|nano.?banana/i.test(m.name) ||
            /image|imagen|nano.?banana/i.test(m.displayName || '')
        );
        result.gemini.first_30_models = models.slice(0, 30).map((m) => m.name);
      }
    } catch (e) {
      result.gemini.error =
        'erro de rede: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  if (args.testOpenAI && openaiKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openaiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) {
        const txt = (await r.text()).slice(0, 300);
        result.openai.error = `HTTP ${r.status}: ${txt}`;
      } else {
        const data = (await r.json()) as { data?: Array<{ id: string }> };
        const all = (data.data || []).map((m) => m.id);
        result.openai.image_models = all.filter((id) =>
          /gpt-image|dall-e/i.test(id)
        );
        result.openai.total = all.length;
      }
    } catch (e) {
      result.openai.error =
        'erro de rede: ' + (e instanceof Error ? e.message : String(e));
    }
  }

  return result;
}

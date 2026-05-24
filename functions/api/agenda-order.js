// Otimiza a ordem de visitas do dia de um pintor com base nos endereços
// (heurística da IA — não usa GPS real, só conhecimento geográfico das
// cidades brasileiras pelo texto do endereço).
// POST { date, jobs: [{ id, client_name, address, scheduled_time }] }
//  -> { ordered_ids: [<id1>, <id2>, ...], notes: '<racional em PT-BR>' }
import { requireAuth, requirePro, checkRateLimit, rateLimitResponse, jsonResponse as json } from './_security.js';

const GEMINI_MODEL = 'gemini-2.5-flash';

export async function onRequestPost(context) {
  const { env, request } = context;
  if (!env.OPENAI_API_KEY && !env.GEMINI_API_KEY) {
    return json({ error: 'IA não configurada: defina OPENAI_API_KEY ou GEMINI_API_KEY' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Auth + PRO check (fail-open)
  const auth = await requireAuth(env, request, body);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const proCheck = await requirePro(env, auth.user && auth.user.id);
  if (!proCheck.pro) return json({ error: 'Esta função é exclusiva do Plano PRO ⚡' }, 403);

  const rl = await checkRateLimit(env, auth.user && auth.user.id, 'agenda-order', 5);
  if (!rl.allowed) return rateLimitResponse(rl);

  const date = typeof body?.date === 'string' ? body.date.slice(0, 10) : '';
  const rawJobs = Array.isArray(body?.jobs) ? body.jobs.slice(0, 40) : [];
  const jobs = rawJobs.map(j => ({
    id: String(j?.id ?? '').slice(0, 80),
    client_name: String(j?.client_name ?? '').slice(0, 120),
    address: String(j?.address ?? '').slice(0, 240),
    scheduled_time: String(j?.scheduled_time ?? '').slice(0, 10)
  })).filter(j => j.id);

  if (jobs.length < 2) return json({ error: 'Envie ao menos 2 obras com id' }, 400);

  const validIds = new Set(jobs.map(j => j.id));

  const systemPrompt = `Você é um pintor brasileiro experiente, com cabeça de logística, que precisa visitar várias obras no mesmo dia. Seu trabalho é colocar as visitas na ordem que minimiza o tempo total de deslocamento, considerando APENAS o texto dos endereços (cidade, bairro, região, CEP se houver) e seu conhecimento geral da geografia das cidades brasileiras (zonas Norte/Sul/Leste/Oeste/Central, bairros vizinhos, eixos viários conhecidos).
Regras:
- Você NÃO tem GPS nem mapa real — é uma heurística baseada em conhecimento das cidades.
- Mantenha exatamente os MESMOS IDs recebidos na entrada; apenas reordene. NÃO invente, NÃO remova, NÃO duplique IDs.
- Considere o horário (scheduled_time) só como peso leve: se uma obra tem hora marcada cedo, ela tende a vir antes; mas a prioridade é minimizar deslocamento.
- Responda SOMENTE com JSON válido, sem markdown, no formato:
  {"ordered_ids": ["<id>", "<id>", ...], "notes": "<1 a 2 frases em português explicando a ordem (ex.: começa pela zona sul, depois sobe pro centro)>"}
- "notes" curto, no máximo 2 frases, em PT-BR.`;

  const userPrompt = `Data: ${date || '(sem data)'}\nObras do dia:\n` + jobs.map(j =>
    `- id="${j.id}" cliente="${j.client_name}" endereco="${j.address}"${j.scheduled_time ? ` hora="${j.scheduled_time}"` : ''}`
  ).join('\n');

  let raw = '';
  let lastError = '';

  if (env.OPENAI_API_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' },
          max_tokens: 800
        })
      });
      if (r.ok) {
        const data = await r.json();
        raw = data?.choices?.[0]?.message?.content?.trim() || '';
      } else {
        lastError = `OpenAI ${r.status}: ${(await r.text()).slice(0, 150)}`;
      }
    } catch (e) {
      lastError = 'OpenAI: ' + String(e?.message || e);
    }
  }

  if (!raw && env.GEMINI_API_KEY) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 800 }
          })
        }
      );
      if (r.ok) {
        const data = await r.json();
        raw = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      } else {
        lastError = `Gemini ${r.status}: ${(await r.text()).slice(0, 150)}`;
      }
    } catch (e) {
      lastError = 'Gemini: ' + String(e?.message || e);
    }
  }

  if (!raw) return json({ error: lastError || 'IA não respondeu' }, 502);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // tenta extrair o primeiro objeto JSON do texto
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }
  if (!parsed || !Array.isArray(parsed.ordered_ids)) {
    return json({ error: 'Resposta da IA inválida' }, 502);
  }

  // sanitiza: mantém só ids válidos, sem duplicar, completa com os faltantes
  const seen = new Set();
  const ordered = [];
  for (const id of parsed.ordered_ids) {
    const s = String(id);
    if (validIds.has(s) && !seen.has(s)) { ordered.push(s); seen.add(s); }
  }
  for (const j of jobs) {
    if (!seen.has(j.id)) { ordered.push(j.id); seen.add(j.id); }
  }

  const notes = typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 400) : '';

  return json({ ordered_ids: ordered, notes });
}

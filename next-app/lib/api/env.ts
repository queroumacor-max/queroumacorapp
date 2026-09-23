// env.ts — leitura de variáveis de ambiente no edge do Cloudflare Pages.
//
// O ponto central: os secrets definidos no painel do Pages NÃO chegam em
// `process.env` no edge. Eles vivem só no request context, que o runtime
// publica num symbol global. Confirmado depurando o portal admin em
// produção.
//
// Lemos esse symbol DIRETO, sem importar `@cloudflare/next-on-pages`: o
// entrypoint daquele pacote faz `require('server-only')`, que não está
// instalado, e isso derrubava a carga de ~40 arquivos de teste com
// "Cannot find module 'server-only'" (197 testes) — a suíte inteira que
// toca `security.ts` parava de rodar.
//
// Fora de um request handler (build, dev local, vitest) o symbol não
// existe e caímos em `process.env`, que é onde as variáveis estão nesses
// contextos.
//
// Use estas funções — nunca `process.env` direto — pra qualquer secret ou
// configuração lida em runtime.

/**
 * Symbols onde o runtime publica o contexto da request, em ordem de
 * preferência.
 *
 * `__cloudflare-context__` é o do @opennextjs/cloudflare (adapter atual,
 * produção em Workers desde 2026-09-20) — um getter sobre AsyncLocalStorage
 * que devolve `{ env, ctx, cf }` da request corrente.
 * `__cloudflare-request-context__` é o do @cloudflare/next-on-pages (adapter
 * antigo), mantido só como fallback.
 *
 * INCIDENTE (2026-09-23): este arquivo lia SÓ o symbol antigo. Depois da
 * migração pro OpenNext ele nunca mais existiu — as envs continuaram
 * funcionando por acaso (o OpenNext copia o env do worker pra `process.env`,
 * que é o nosso fallback), mas `runAfterResponse` perdeu o `ctx.waitUntil` e
 * passou a deixar o trabalho de fundo como promessa solta, que o workerd
 * cancela quando a resposta termina. Efeito visível: resposta de cliente no
 * WhatsApp não chegava no portal (o webhook respondia 200 e a gravação em
 * `whatsapp_messages` era cortada no meio).
 */
const CF_CONTEXT_SYMBOLS = [
  Symbol.for('__cloudflare-context__'),
  Symbol.for('__cloudflare-request-context__'),
];

interface CloudflareRequestContext {
  env?: Record<string, unknown>;
  /** ExecutionContext do worker — é dele que sai o `waitUntil`. */
  ctx?: { waitUntil?: (p: Promise<unknown>) => void };
}

/** Lê o contexto da request publicado pelo runtime, se houver. */
function readRequestContext(): CloudflareRequestContext | undefined {
  for (const sym of CF_CONTEXT_SYMBOLS) {
    try {
      const c = (globalThis as Record<symbol, unknown>)[sym] as
        | CloudflareRequestContext
        | undefined;
      if (c && typeof c === 'object') return c;
    } catch {
      // getter do ALS pode lançar fora de request — tenta o próximo.
    }
  }
  return undefined;
}

/**
 * Deixa um trabalho rodando DEPOIS da resposta já ter sido enviada.
 *
 * No edge do Cloudflare o worker é encerrado assim que a resposta sai —
 * promessa solta é abortada no meio. `waitUntil` é o que mantém o worker
 * vivo até ela terminar. Fora do edge (build, dev, vitest) não existe
 * contexto: aí AGUARDA a promessa, que é o comportamento correto nesses
 * ambientes e mantém os testes determinísticos.
 *
 * Nunca lança: falha no trabalho de fundo não pode virar erro de resposta.
 */
export function runAfterResponse(work: Promise<unknown>): void {
  const seguro = Promise.resolve(work).catch((e) => {
    console.error(
      'runAfterResponse: trabalho de fundo falhou:',
      e instanceof Error ? e.message : e,
    );
  });

  // `waitUntil` PRECISA ser chamado no `ctx`, nunca solto.
  //
  // A versão anterior fazia `const waitUntil = ctx?.waitUntil` e chamava
  // `waitUntil(seguro)`. Isso desamarra o método do objeto dono, e o
  // ExecutionContext do workerd é nativo: sem o `this` certo ele lança
  // `TypeError: Illegal invocation`. E lança de forma SÍNCRONA, dentro do
  // handler — ou seja, o erro não ficava no trabalho de fundo, ele derrubava
  // a resposta. Em produção o webhook do WhatsApp respondia 500 depois de já
  // ter logado a mensagem recebida (2026-09-05).
  //
  // O teste antigo não pegava porque um `vi.fn()` num objeto literal é uma
  // função JS comum, que não liga pro `this`. Só o objeto nativo reclama —
  // por isso o teste agora verifica o `this` explicitamente.
  const ctx = readRequestContext()?.ctx;
  if (ctx && typeof ctx.waitUntil === 'function') {
    try {
      ctx.waitUntil(seguro);
      return;
    } catch (e) {
      // Nem o `waitUntil` falhando pode custar a resposta. Perder o
      // keep-alive degrada (o trabalho pode ser cortado no fim da request);
      // lançar aqui viraria 500 numa request que já estava correta.
      console.error(
        'runAfterResponse: waitUntil recusou o trabalho:',
        e instanceof Error ? e.message : e,
      );
    }
  }
  void seguro;
}

/**
 * Lê uma variável de ambiente. Prioridade: contexto da request do
 * Cloudflare (única fonte no edge) → `process.env` (build/dev/testes).
 */
export function getRuntimeEnv(key: string): string | undefined {
  const value = readRequestContext()?.env?.[key];
  if (value !== undefined && value !== null) return String(value);
  return process.env[key];
}

/**
 * Chave service role do Supabase (secret sensível). Só em código
 * server-side, e sempre depois de checar autorização.
 */
export function getSupabaseServiceKey(): string | undefined {
  return getRuntimeEnv('SUPABASE_SERVICE_ROLE_KEY');
}

/** Chave da OpenAI. */
export function getOpenAiKey(): string | undefined {
  return getRuntimeEnv('OPENAI_API_KEY');
}

/** Chave do Google Gemini. */
export function getGeminiKey(): string | undefined {
  return getRuntimeEnv('GEMINI_API_KEY');
}

/** Access token do Mercado Pago. */
export function getMercadoPagoToken(): string | undefined {
  return getRuntimeEnv('MP_ACCESS_TOKEN');
}

/** Secret usado pra validar o webhook do Mercado Pago. */
export function getMercadoPagoWebhookSecret(): string | undefined {
  return getRuntimeEnv('MP_WEBHOOK_SECRET');
}

// NÃO recriar aqui `getSupabaseUrl`/`getSupabaseAnonKey`. Eles existiam neste
// arquivo lendo SÓ as `NEXT_PUBLIC_*`, enquanto o `security.ts` tinha outra
// ordem — dois resolvedores discordando entre si, que é exatamente a classe de
// bug do incidente de 2026-09-04 (URL de um projeto + anon key de outro → o
// GoTrue respondia "Invalid API key" pra QUALQUER token). A URL e a anon key
// saem juntas de `resolveSupabaseEnv()` em `lib/api/security.ts`, sempre do
// MESMO par. Aqui fica só a leitura crua de env (`getRuntimeEnv`).

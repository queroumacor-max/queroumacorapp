# ADR 0003 — Backend em Cloudflare Pages Functions (V8 isolates)

- **Status**: Accepted
- **Date**: 2026-05-31
- **Deciders**: mantenedor único
- **Tags**: backend, hosting, runtime, serverless

## Context

O QueroUmaCor precisa de backend pra:

- Wrapper de IA (OpenAI ↔ Gemini com fallback) — sem expor chaves no
  cliente.
- Webhooks (Mercado Pago, futuros Sentry/etc.).
- Operações privilegiadas que precisam de `service_role` do Supabase
  (admin moderation, log de erros com waitUntil, refund de pontos).
- Rate-limit central, pré-validação de auth, gates de PRO.
- Pipeline de mídia (transcribe, captions, TTS, moderate-video).

Constraints contextuais:

- Hosting do frontend já é Cloudflare Pages (CDN edge global).
- Time = 1 mantenedor; "rodar e manter um Node server" é custo
  proibitivo (PM2, logrotate, monitoring, deploy pipeline,
  TLS, etc.).
- O produto é PWA mobile-first global (Brasil); latência de edge ajuda.
- Cold start = morte de UX. App é interativo, qualquer endpoint que leve
  500ms+ pro primeiro byte machuca.
- Tráfego é "bursty" — picos quando influencer divulga, vale durante a
  madrugada. Pagar por VM idle é desperdício.

Alternativas no momento da decisão (2024–2025):

- Node.js server (Render/Fly/Railway/EC2).
- Vercel Edge Functions / Vercel Serverless Functions.
- Cloudflare Workers / Cloudflare Pages Functions.
- Supabase Edge Functions (Deno).
- AWS Lambda + API Gateway.

## Decision

**Backend roda em Cloudflare Pages Functions (V8 isolates, mesmo runtime
dos Workers).** Cada `functions/api/X.js` vira a rota `/api/X` por
convenção do Pages. Arquivos com prefixo `_` (`_security.js`, `_ai.js`)
são módulos privados não-roteáveis.

Stack do endpoint típico:

```js
// functions/api/X.js (ESM)
import { requireAuth, checkRateLimit } from './_security.js';
import { callAI } from './_ai.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const user = await requireAuth(request, env);
  await checkRateLimit(user.id, 'X', env);
  // ... usar env.SUPABASE_SERVICE_ROLE_KEY se precisar bypass RLS
  return new Response(JSON.stringify({ ok: true }), { ... });
}
```

Helpers centralizados em `_security.js` evitam reinventar parse JWT /
rate-limit em cada endpoint.

## Consequences

### Positive

- **Cold start = 0.** V8 isolates "atualizam" instantaneamente — não há
  bootstrap de container/Node. Latência de primeiro request é a mesma do
  enésimo.
- **Edge global automático.** Cloudflare roda o código no datacenter
  mais próximo do usuário. Latência sub-100ms na maior parte do mundo
  sem configuração.
- **Mesma plataforma do frontend.** Push em `main` → deploy automático
  do frontend **e** das functions, em ~90s. Sem pipeline separado.
- **Sem servidor pra manter.** Zero VMs, zero containers, zero patches
  de SO, zero logrotate, zero certbot.
- **Custo baixo em volume real.** Plano Pages PRO ($20/mês) cobre todo o
  uso atual + sobrando. Sem cobrança de VM idle.
- **CORS / cache / headers como código.** `_headers` e `_redirects` no
  repo são source-of-truth. CSP, HSTS, `Cache-Control` versionados junto
  do código.
- **Variáveis de ambiente via dashboard.** Separação Production /
  Preview embutida. `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ADMIN_EMAILS`,
  `SUPABASE_SERVICE_ROLE_KEY` configuradas uma vez.

### Negative

- **Timeout duro de ~30s.** Cloudflare Pages Functions tem CPU limit
  (~30s no plano Pages PRO; Workers Unbound tem mais). Endpoint de IA
  que demora muito (geração de imagem pesada, transcrição longa)
  precisa virar background job via Queues ou ser otimizado. Por
  enquanto: chunks + streaming + timeouts agressivos via
  `withTimeout()`.
- **Memória limitada (~128 MB).** OK pra JSON+fetch, ruim pra
  processamento de imagem grande server-side. Por isso compressão de
  imagem fica no client (`_compressImageFile` em utils).
- **Sem libs Node-only.** Sem `fs`, sem `crypto.createHash` legacy, sem
  `Buffer.from` em alguns paths. APIs Web (`fetch`, `crypto.subtle`,
  `TextEncoder`) são o padrão. Algumas libs npm não rodam — verificação
  por endpoint.
- **Debug é mais difícil.** Sem `node --inspect`. Logs vão pro
  dashboard Cloudflare (retention curta) ou pra `console.log` que vira
  log do worker. Mitigação: tabela `errors` no Supabase + Sentry
  (ADR 0005).
- **Vendor lock-in moderado.** Migrar pra Node.js exigiria reescrever
  `context.env`, `onRequestPost(context)`, `waitUntil`, e os `_headers`.
  Aceito porque o produto é vendor lock-in **leve** — handlers são
  ~30 linhas cada, migráveis um a um pra Lambda/Express/Hono em dia
  de trabalho.
- **Sem ambiente local pronto.** Não há `wrangler dev` configurado no
  repo. Iteração local em endpoint = colar handler em Wrangler isolado
  ou testar via preview deploy. (Ver `CONTRIBUTING.md §1`.)

## Por que isso encaixa com o produto

- **PWA mobile-first global**: latência edge baixa importa.
- **Bursty traffic**: serverless paga só pelo uso.
- **Time pequeno**: zero ops vence runtime mais flexível.
- **Endpoints "thin"**: a maioria é parse → auth → 1-2 chamadas externas
  → response. Casa bem com isolates.
- **Pipelines de IA**: timeouts internos das APIs OpenAI/Gemini (~30-60s
  na pior chamada) batem com o limite do isolate; quando estoura
  fallback pro outro provedor.

## Alternativas consideradas

- **Vercel Edge Functions**: equivalente técnico, mas hosting do
  frontend já estava no Cloudflare. Mover só backend pra Vercel
  fragmentaria deploy + envs sem benefício.
- **Node em Render/Fly**: viável, mas adiciona "1 VM pra cuidar". Não
  vale.
- **Supabase Edge Functions (Deno)**: tentador (mesmo dashboard do banco)
  mas (a) Deno tem ecossistema npm mais limitado em isolates, (b)
  perderíamos a colocation com o frontend (Cloudflare CDN), (c) menos
  controle de cache/headers.
- **AWS Lambda + API Gateway**: cold start de Lambda + setup pesado
  (IAM, gateway, cloudwatch). Não.

## Quando re-avaliar

- Endpoint legítimo precisa de >30s consistentemente (geração de vídeo
  longa, batch de IA grande) → migrar pra Workers Unbound, Queues, ou
  serviço dedicado.
- Volume passa de 10M req/mês e cobrança Cloudflare fica > custo de VM
  comparável (improvável em médio prazo).
- Vendor change forçado pela Cloudflare (politicas, preços).
- Aparece use case que demanda runtime Node específico (lib não-isolate-
  friendly, e.g. `sharp` pra image processing pesado).

## Referências

- `ARCHITECTURE.md §Backend`, `§Deploy`
- `DEPLOYMENT.md §1`, `§3`, `§6`, `§7`, `§8`, `§9`
- `functions/api/_security.js`, `functions/api/_ai.js`
- `_headers`, `_redirects`
- ADR 0002 (defense in depth, onde `requireAuth` vive)

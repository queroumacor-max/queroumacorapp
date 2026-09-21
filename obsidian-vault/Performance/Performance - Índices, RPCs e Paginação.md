---
tags: [performance, sql, rpc, paginação, índices]
---

# Performance — Índices, RPCs e Paginação de Listas Grandes

## Padrão recorrente: listas de dezenas de milhares de linhas
Encontrado e corrigido repetidamente em **Leads (61 mil, ver [[Leads - Importação e Funil de Abordagem]])**, **Produtos (21 mil, ver [[Portal - Pessoas, Produtos e Ferramentas]])**, **WhatsApp (90 dias de mensagens, ver [[WhatsApp - Portal e Mídia]])**: mesma receita —
1. Paginar em PARALELO (não série), 1ª página com `count:'exact'` pra pintar a tela rápido.
2. Ordenar por 2 colunas quando há empates de timestamp (`created_at, id`) — senão paginação repete/pula linha (lotes de importação têm o mesmo carimbo de tempo).
3. Renderizar em JANELA (IntersectionObserver), nunca 1 `<tr>`/card por linha de uma vez — um `<tr>` por lead travava o navegador com 61 mil linhas.
4. Cache em memória + botão "↻ Atualizar" em vez de recarregar tudo a cada ação.
5. Emendar por id em vez de substituir array inteiro (evita re-render e perda de scroll) — `emendarLeads`/`mesclarMensagens` devolvem o MESMO array se nada mudou.

### Produtos do portal (2026-08-29) — exemplo canônico do padrão
Catálogo passou de **21 mil** linhas e a tela ficava minutos em "Carregando produtos...": eram até 22 requisições `select('*')` em FILA (cada uma esperando a anterior) e, no fim, um card por produto de uma vez (21 mil em "Todos"). Corrigido com: só as colunas do card (`PRODUTO_COLS`, `description`/ficha técnica saíram do payload); 1ª página pinta e tira o "Carregando", resto vem em paralelo (4 conexões) emendado por posição (`paginas[n]`); janela de 60 cards crescendo por IntersectionObserver (`PRODUTOS_JANELA`); `_cat`/`_q` pré-calculados uma vez em `prepararProduto` (antes rodavam 21 mil vezes por tecla digitada na busca) + busca com 250ms de atraso; cache em memória (`_produtosCache`); salvar/excluir emendam a linha (`aplicarLinha`) em vez de recarregar tudo. Detalhe completo (incluindo o corte da foto do produto e o índice de nome) em [[Portal - Pessoas, Produtos e Ferramentas]].

## RPC `get_feed_v2` (Wave 16)
Agrega posts + autor + like_count + comment_count + liked_by_me + saved_by_me + top 3 comentários em UMA chamada (era 5 round-trips: `fetchFeed` chamava um trio Wave A + Wave B antes). **Existiu por um tempo sem o frontend chamar ela** — o swap em `lib/services/feed.ts fetchFeed()` era a Sprint 1.5, adiada quando o usuário pulou pro Sprint 2. Depois foi adotada e recriada várias vezes por motivos diferentes: boost/trending no topo (Wave 22), badge verified faltando (Wave 23 — a Wave 22 tinha esquecido `verified` no `jsonb_build_object`), filtro de `blocks` (Wave 21), width/height de mídia (Wave 17), e o fix CRÍTICO de IDOR do pentest final (`p_user_id` do CLIENTE decidindo `saved_by_me`/`liked_by_me` — ver [[Segurança - Auditoria Supabase (RLS e Banco)]]).

## Telemetria fetchFeed (polish, 2026-06-09)
`lib/services/feed.ts` chama `addFeedBreadcrumb()` em 3 caminhos: `rpc_ok` (sucesso, com row count), `rpc_error` (RPC retornou error, fallback legacy), `rpc_throw` (RPC throw, fallback). Breadcrumb vai pro Sentry e aparece como contexto em qualquer erro futuro do feed. Usar pra decidir quando remover o fallback legacy: se Sentry mostra só `rpc_ok` por semanas → seguro firmar.

## Índices parciais notáveis
- **Wave 15 (2026-06-09)**: `idx_comments_post_active_created` (post_id + created_at WHERE deleted_at IS NULL) acelera `fetchComments`; `idx_notifications_user_unread_created` (user_id + created_at WHERE read=false) acelera o badge do sininho; `idx_posts_approved_active_created` (created_at WHERE status=approved AND deleted_at IS NULL) acelera o feed "Todos". Criados **CONCURRENTLY** (sem lock).
- **`perf-indexes-check.sql`** — NÃO É MIGRATION, é auditoria: roda EXPLAIN ANALYZE nas 3 queries esperadas pelos índices Wave 15 + lista tamanho/scan count via `pg_stat_user_indexes`. "Seq Scan" no plano = índice não cobre, refazer.
- **Wave 52 (2026-08-29)**: `idx_products_name` — `CREATE INDEX CONCURRENTLY` (roda sozinho, fora de transação), sem ele cada uma das ~22 páginas de produtos reordenava as 21 mil linhas. Confirmado pelo `EXPLAIN ANALYZE`: "Index Scan using idx_products_name on products", 3,0 ms na fatia OFFSET 5000.
- **WhatsApp (2026-09-13, `/migrations/2026-09-13-whatsapp-perf.sql`)**: `idx_whatsapp_messages_created_id` (created_at desc, id desc — ordem EXATA da paginação, um índice só de created_at reordenava o recorte inteiro a cada página), `delivery_status_at` parcial (o poll filtra por OR) e `(wa_id, created_at) WHERE direction='in'` (não lidas). Detalhe completo do "57014: statement timeout" que motivou em [[WhatsApp - Portal e Mídia]].

## Regra de RLS em performance: função em policy sempre `(select …)`
`USING (is_portal_admin())` solto faz o Postgres chamar a função SECURITY DEFINER **por linha** — em vez de 1x. Causou "57014: statement timeout" no WhatsApp (as policies de `whatsapp_messages`/`whatsapp_ai_state`/`portal_alerts`/`whatsapp_ai_config` tinham `USING (is_portal_admin())` solto; um `count:'exact'` sobre 90 dias virava dezenas de milhares de consultas escondidas — cada chamada um SELECT em `profiles` — e passava dos 8s do `statement_timeout` do papel `authenticated`). Fix: `USING ((SELECT is_portal_admin()))` — vira um InitPlan, avaliado UMA vez por statement. **Mesma regra, mesma segurança. REGRA: função em policy de RLS vai SEMPRE embrulhada em `(select …)`.** Vale pra qualquer policy nova com `is_portal_admin()`.

## Width/height em posts (CLS=0, Wave 17)
`posts.media_width`/`media_height` (int, opcionais) capturados no client (`readImageDimensions()`) antes do upload e gravados no insert. `PostMedia` seta `width={...} height={...}` no `<img>` quando presente — browser reserva espaço exato e CLS = 0. Posts antigos sem W/H caem no `aspect-ratio: 1/1` CSS (sem regressão). RPC `get_feed_v2` foi DROP+CREATE pra incluir as 2 colunas no RETURNS TABLE.

## Web Vitals RUM (B7, deployado 2026-06-09)
`sentry.client.config.ts` carrega `browserTracingIntegration` com `tracesSampleRate: 1.0`. Sentry → Performance → Web Vitals começa a popular ~24h depois do primeiro acesso. **Não mexer no sample rate sem checar quota.**

## Cloudflare Image Resizing (B2) — confirmado LIGADO (verificado em 2026-09-05)
Helper `next-app/lib/cfImg.ts` reescreve URLs pra `/cdn-cgi/image/w=...,q=85,f=auto/<original-url>`; Avatar e PostMedia usam srcset 1x/2x/3x. Ficou meses anotado como "requer toggle no painel" sem ninguém conferir o efeito real.
- **COMO CONFERIR (mede o EFEITO, não a configuração)**: abrir `https://queroumacor.com.br/cdn-cgi/image/w=64,f=auto/https://queroumacor.com.br/icon-192.png`. Imagem pequena = ligado. 404 **comum** = desligado.
- **PEGADINHA que quase virou conclusão errada**: com uma origem inexistente a resposta é `ERROR 9404: ... HTTP error 404`. Ler só o "404" diz "desligado" — mas o prefixo `ERROR 9xxx` é emitido PELO Image Resizing, ou seja, prova o contrário. Desligado devolve 404 seco, sem o código. Usar uma origem que EXISTE (`/icon-192.png`) evita a ambiguidade.
- **Achado posterior (auditoria externa HostedScan, 2026-09-20)**: a opção "Resize images from any origin" está LIGADA, permitindo `/cdn-cgi/image/.../<qualquer-url-da-web>` redimensionar imagem de fora do domínio — pendência real, ver [[Pendências Reais (Ação Manual Necessária)]] e [[Segurança - Cloudflare]] pro detalhe de impacto e opções levantadas.

## Wave 54 (2026-08-30) — contador de seguidores em DOBRO
Perfil novo com 3 follows mostrava 6 (2× exato, sem backfill no meio = veio só de trigger). Causa: DOIS triggers de contador vivos em `follows` — um legado além do `trg_maintain_follow_counts` da Wave 40, que só derruba o homônimo. `/migrations/2026-08-30-follow-counts-dedupe.sql` derruba todo trigger de contador não-canônico (filtro: a função toca followers/following/posts_count — triggers de pontos/notificação passam) e RECONTA os três contadores da verdade. **JÁ EXECUTADA no Supabase (2026-08-30). LIÇÃO: wave nova de trigger precisa varrer duplicatas por FUNÇÃO, não só pelo próprio nome.** Detalhe adicional em [[Incidentes Notáveis]].

## Regra de arquitetura complementar
Ver [[Infraestrutura - Cloudflare, Env Vars e Deploy]] pra "ler env sempre por `getRuntimeEnv()`" — as 57 leituras cruas de `process.env` corrigidas em 2026-09-01 tocavam justamente toda a camada de IA/pagamentos (custo de performance/correção, não só segurança: `/api/health` podia reportar saúde errada).

---
## Ver também
[[WhatsApp - Portal e Mídia]] · [[Portal - Pessoas, Produtos e Ferramentas]] · [[Leads - Importação e Funil de Abordagem]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Posts, Stories e Feed]]

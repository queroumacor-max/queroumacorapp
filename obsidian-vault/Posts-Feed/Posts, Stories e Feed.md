---
tags: [posts, feed, stories, carrossel, moderação]
---

# Posts, Stories e Feed

## Carrossel de fotos (Wave 57, SQL executado)
Composer sempre deixou escolher até 5 fotos, mas só a 1ª era gravada (`media_url`) — as outras 4 viravam arquivo órfão. Fix: `posts.media_urls text[]`. Post antigo não ganha carrossel retroativo (fotos extras foram descartadas no ato). `media_url` continua sendo a 1ª foto (feed legado lê ela). `createPost` tolera 42703 (coluna ausente) refazendo sem `media_urls`. Scroll-snap nativo (não arrasto por JS).

## Enquadramento ao publicar
Proporção Original/1:1/4:5/16:9, modo Preencher/Ajustar. "Original" não passa pelo canvas (quem não mexe publica como sempre). Recorte feito NO ARQUIVO antes do upload (não CSS) — feed/perfil/carrossel renderizam a mesma URL. Prévia e recorte usam a MESMA conta (`lib/enquadramento.ts`).

## Vídeo em `<img>` — miniaturas quebradas
Regra de "é vídeo?" vivia em 4 lugares de 3 jeitos diferentes. Unificado em `isVideoPost(url, mediaType)` — `media_type` sozinho NÃO diz se é vídeo (marca STORY), extensão sozinha também não basta (upload legado sem extensão). Usa os dois sinais.

## Moderação no publish
Ver [[Moderação de Conteúdo (Gemini e CSAM)]].

## Story
Sem legenda nem link (decisão da loja, 2026-09-01) — conteúdo que some em 24h. X ficava POR BAIXO das barras do app (`z-50` vs BottomNav `z-[300]`) — corrigido pra `z-[400]` + portal no `<body>`. Botão voltar do Android fecha o story (empurra entrada no histórico). Som: tenta com áudio (há gesto do toque que abriu), cai pra mudo com botão 🔊/🔇.

## Admin apaga post de outra pessoa
App já deixava apagar comentário de qualquer um; post não — `.eq('user_id', userId)` filtrava mesmo pra admin. `comoAdmin` remove esse filtro, permissão real segue sendo da RLS. **Lacuna conhecida: apagar post alheio não deixa rastro de quem apagou** (audit_log sem policy de INSERT pra authenticated).

## Boost + Trending (Wave 22)
`boost_post`/`unboost_post` RPCs, até 30 dias, badge "Em destaque". `get_trending_posts`: score = likes_window + 3×comments_window.

## Blocks e sugestões sociais (Wave 21)
Tabela `blocks` (owner-only RLS), RPC `list_blocked_ids()`, `suggest_to_follow`. `renderRichText` parseia `@user`/`#hashtag`/URLs.

## Busca full-text (Wave 6)
`search_vector` gerado em posts/products/profiles, RPC `search_all` com `ts_headline`. **CRIT-3 XSS**: sentinelas `⟦HL_OPEN⟧`/`⟦HL_CLOSE⟧` viram `<b>` só depois de sanitização client-side (`sanitizeSearchSnippet`).

---
## Ver também
[[Moderação de Conteúdo (Gemini e CSAM)]] · [[Performance - Índices, RPCs e Paginação]]

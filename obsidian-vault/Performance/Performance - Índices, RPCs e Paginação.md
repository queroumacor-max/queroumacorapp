---
tags: [performance, sql, rpc, paginação, índices]
---

# Performance — Índices, RPCs e Paginação de Listas Grandes

## Padrão recorrente: listas de dezenas de milhares de linhas
Encontrado e corrigido repetidamente em **Leads (61 mil)**, **Produtos (21 mil)**, **WhatsApp (90 dias de mensagens)**: mesma receita —
1. Paginar em PARALELO (não série), 1ª página com `count:'exact'` pra pintar a tela rápido.
2. Ordenar por 2 colunas quando há empates de timestamp (`created_at, id`) — senão paginação repete/pula linha.
3. Renderizar em JANELA (IntersectionObserver), nunca 1 `<tr>`/card por linha de uma vez.
4. Cache em memória + botão "↻ Atualizar" em vez de recarregar tudo a cada ação.
5. Emendar por id em vez de substituir array inteiro (evita re-render e perda de scroll).

## RPC `get_feed_v2` (Wave 16)
Agrega posts + autor + like_count + comment_count + liked_by_me + saved_by_me + top 3 comentários em UMA chamada (era 5 round-trips). Recriada várias vezes (boost, verified badge, blocks, W/H de mídia).

## Índices parciais notáveis
`idx_comments_post_active_created`, `idx_notifications_user_unread_created`, `idx_posts_approved_active_created` (Wave 15). `idx_whatsapp_messages_created_id`, `idx_products_name` (CONCURRENTLY, Wave 52).

## Regra de RLS em performance: função em policy sempre `(select …)`
`USING (is_portal_admin())` solto faz o Postgres chamar a função SECURITY DEFINER **por linha** — em vez de 1x. Causou "57014: statement timeout" no WhatsApp (90 dias virava dezenas de milhares de consultas escondidas). Fix: `USING ((SELECT is_portal_admin()))` (InitPlan).

## Width/height em posts (CLS=0, Wave 17)
`posts.media_width/height` capturados no client antes do upload, `<img width height>` reserva espaço exato.

## Web Vitals RUM
Sentry `browserTracingIntegration`, `tracesSampleRate: 1.0`.

## Cloudflare Image Resizing — confirmado LIGADO (2026-09-05)
`lib/cfImg.ts` reescreve pra `/cdn-cgi/image/...`. Ficou meses marcado "requer toggle" sem ninguém conferir o efeito real (pegadinha: erro `ERROR 9404` com origem inexistente na verdade PROVA que está ligado — só 404 seco sem esse prefixo prova o contrário).

---
## Ver também
[[WhatsApp - Portal e Mídia]] · [[Portal - Pessoas, Produtos e Ferramentas]] · [[Leads - Importação e Funil de Abordagem]] · [[Segurança - Auditoria Supabase (RLS e Banco)]]

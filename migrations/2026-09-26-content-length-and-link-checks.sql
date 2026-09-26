-- 2026-09-26 — Tetos de tamanho e formato de link no BANCO (auditoria dos
-- "19 pontos", itens 2/12). Idempotente: cada constraint só é criada se ainda
-- não existir (checa pg_constraint). NOT VALID: vale só pra linha NOVA ou
-- ALTERADA — nenhuma linha antiga bloqueia a migration.
--
-- Limites >= o maior limite da UI (a UI é a primeira barreira; o banco é o
-- teto pra quem escreve direto via REST):
--   messages.content  4000  (MessageComposer maxLength=4000)
--   posts.caption     2200  (CaptionInput 2000; edição no PostCard 2200)
--   comments.text     1000  (CommentForm 500) — a coluna é `text`, não
--                           `content` (ver database.types.ts / supabase_init)
-- Links: só http(s). instagram_url aceita também "@user"/"user" — o
-- EditProfileForm aceita esse formato e o ProfileLinks o converte em URL.
--
-- Rodar um bloco por vez se colar pelo celular.
--
-- ATENÇÃO — NOT VALID não isenta UPDATE: uma linha ANTIGA fora da regra
-- passa a recusar QUALQUER update nela (inclusive de outra coluna, feito por
-- trigger — ex. contador de seguidores em profiles, soft delete em
-- messages). Por isso: (1) rode a PRÉ-CONFERÊNCIA abaixo; (2) os links
-- legados fora do formato são limpos (viram NULL) — nenhum deles é
-- renderizado hoje (a UI já recusa não-http), e são justamente os candidatos
-- a javascript:; (3) se a pré-conferência mostrar texto longo legado (> 0),
-- decidir antes (truncar ou não criar aquele CHECK).

-- PRÉ-CONFERÊNCIA (só leitura): quantas linhas antigas violam cada regra.
SELECT 'messages>4000' AS regra, count(*) FROM public.messages WHERE char_length(content) > 4000 UNION ALL SELECT 'posts.caption>2200', count(*) FROM public.posts WHERE char_length(caption) > 2200 UNION ALL SELECT 'comments.text>1000', count(*) FROM public.comments WHERE char_length(text) > 1000 UNION ALL SELECT 'posts.link_url', count(*) FROM public.posts WHERE link_url IS NOT NULL AND link_url !~* '^https?://' UNION ALL SELECT 'profiles.website_url', count(*) FROM public.profiles WHERE website_url IS NOT NULL AND website_url <> '' AND website_url !~* '^https?://' UNION ALL SELECT 'profiles.instagram_url', count(*) FROM public.profiles WHERE instagram_url IS NOT NULL AND instagram_url <> '' AND instagram_url !~* '^(https?://|@?[a-z0-9._]+$)';

-- Limpeza dos links legados fora do formato (idempotente).
UPDATE public.posts SET link_url = NULL WHERE link_url IS NOT NULL AND link_url !~* '^https?://';

UPDATE public.profiles SET website_url = NULL WHERE website_url IS NOT NULL AND website_url <> '' AND website_url !~* '^https?://';

UPDATE public.profiles SET instagram_url = NULL WHERE instagram_url IS NOT NULL AND instagram_url <> '' AND instagram_url !~* '^(https?://|@?[a-z0-9._]+$)';

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_content_len_chk' AND conrelid = 'public.messages'::regclass) THEN ALTER TABLE public.messages ADD CONSTRAINT messages_content_len_chk CHECK (content IS NULL OR char_length(content) <= 4000) NOT VALID; END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_caption_len_chk' AND conrelid = 'public.posts'::regclass) THEN ALTER TABLE public.posts ADD CONSTRAINT posts_caption_len_chk CHECK (caption IS NULL OR char_length(caption) <= 2200) NOT VALID; END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_text_len_chk' AND conrelid = 'public.comments'::regclass) THEN ALTER TABLE public.comments ADD CONSTRAINT comments_text_len_chk CHECK (text IS NULL OR char_length(text) <= 1000) NOT VALID; END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_link_url_http_chk' AND conrelid = 'public.posts'::regclass) THEN ALTER TABLE public.posts ADD CONSTRAINT posts_link_url_http_chk CHECK (link_url IS NULL OR link_url ~* '^https?://') NOT VALID; END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_website_url_http_chk' AND conrelid = 'public.profiles'::regclass) THEN ALTER TABLE public.profiles ADD CONSTRAINT profiles_website_url_http_chk CHECK (website_url IS NULL OR website_url = '' OR website_url ~* '^https?://') NOT VALID; END IF; END $$;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_instagram_url_chk' AND conrelid = 'public.profiles'::regclass) THEN ALTER TABLE public.profiles ADD CONSTRAINT profiles_instagram_url_chk CHECK (instagram_url IS NULL OR instagram_url = '' OR instagram_url ~* '^(https?://|@?[a-z0-9._]+$)') NOT VALID; END IF; END $$;

-- Conferência: deve listar as 6 constraints (convalidated=false é esperado —
-- NOT VALID; rodar VALIDATE CONSTRAINT depois, se quiser, após limpar legado).
SELECT conrelid::regclass AS tabela, conname, convalidated, pg_get_constraintdef(oid) AS definicao FROM pg_constraint WHERE conname IN ('messages_content_len_chk','posts_caption_len_chk','comments_text_len_chk','posts_link_url_http_chk','profiles_website_url_http_chk','profiles_instagram_url_chk') ORDER BY 1, 2;

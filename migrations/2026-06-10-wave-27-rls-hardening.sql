-- SQL Wave 27 (2026-06-10) — RLS hardening pós LAUNCH_AUDIT
-- ════════════════════════════════════════════════════════════════════
-- Fecha os 4 blockers críticos B2-B5 do LAUNCH_AUDIT.md:
--   B2: orders INSERT/UPDATE com WITH CHECK (true) → user A pode criar
--       order pra user B com total inflado
--   B3: messages UPDATE policy ausente (soft delete quebra) + SELECT
--       não filtra deleted_at (msgs "apagadas" reaparecem)
--   B4: quotes SELECT público (USING (true)) expõe phone/address de
--       leads pra qualquer authenticated user — LGPD violation
--   B5: storage posts/avatars sem path validation — user pode escrever
--       em qualquer path, sobrescrever arquivos de outros
--
-- Tudo idempotente (DROP IF EXISTS + CREATE) — seguro rerodar.
-- Path pattern de upload em posts/avatars: `{userId}/{...}` — confirmado
-- em next-app/lib/services/{posts,profile,aiArt,aiLogo,chat-attachments}.ts.


-- ─── B2: orders ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can create own orders" ON public.orders;
DROP POLICY IF EXISTS "orders_insert_own" ON public.orders;
CREATE POLICY "orders_insert_own" ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders;
DROP POLICY IF EXISTS "orders_update_own" ON public.orders;
CREATE POLICY "orders_update_own" ON public.orders
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- (SELECT já estava OK: owner + admin via outra policy)
-- (DELETE permanece negada — orders são append-only do ponto do user;
--  cancelamento é status update via service_role no webhook MP)


-- ─── B3: messages ───────────────────────────────────────────────────

-- UPDATE policy nova — cobre:
--   - sender marcando próprio msg como soft-deleted (deleted_at)
--   - receiver marcando como lida (read_at via Wave 24 mark_conversation_read,
--     que é SECURITY DEFINER mas precisa que a policy permita o UPDATE
--     pelo postgres role; SECURITY DEFINER bypassa RLS por padrão, mas
--     reforçar aqui é defense-in-depth caso alguém chame UPDATE direto)
DROP POLICY IF EXISTS "messages_update_own" ON public.messages;
CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR receiver_id = auth.uid());

-- SELECT filtra soft-deleted (Wave 8 esqueceu de incluir messages).
-- Admin (is_portal_admin) ainda enxerga tudo via OR pra auditoria.
DROP POLICY IF EXISTS "Users see own conversations" ON public.messages;
DROP POLICY IF EXISTS "messages_select_participants" ON public.messages;
CREATE POLICY "messages_select_participants" ON public.messages
  FOR SELECT TO authenticated
  USING (
    (deleted_at IS NULL
      AND (sender_id = auth.uid() OR receiver_id = auth.uid()))
    OR public.is_portal_admin()
  );


-- ─── B4: quotes — restrição de SELECT pra participants + admin ──────

DROP POLICY IF EXISTS "Quotes are viewable by everyone" ON public.quotes;
DROP POLICY IF EXISTS "quotes_select_participants" ON public.quotes;
CREATE POLICY "quotes_select_participants" ON public.quotes
  FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    OR painter_id = auth.uid()
    OR public.is_portal_admin()
  );

-- (INSERT/UPDATE já estavam corretas via client_id/painter_id)


-- ─── B5: storage.objects — posts + avatars path validation ──────────

-- Path pattern obrigatório: `{auth.uid()::text}/{...}`.
-- Sem isso, user pode escrever em path de outro user.

-- POSTS
DROP POLICY IF EXISTS "Users can upload to posts" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to posts bucket" ON storage.objects;
DROP POLICY IF EXISTS "posts owner write" ON storage.objects;
CREATE POLICY "posts owner write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own posts" ON storage.objects;
DROP POLICY IF EXISTS "posts owner update" ON storage.objects;
CREATE POLICY "posts owner update" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  ) WITH CHECK (
    bucket_id = 'posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own posts" ON storage.objects;
DROP POLICY IF EXISTS "posts owner delete" ON storage.objects;
CREATE POLICY "posts owner delete" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'posts'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- SELECT permanece público (bucket é público — URLs do feed servem direto)
DROP POLICY IF EXISTS "Posts bucket public read" ON storage.objects;
DROP POLICY IF EXISTS "posts public read" ON storage.objects;
CREATE POLICY "posts public read" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'posts');


-- AVATARS
DROP POLICY IF EXISTS "Users can upload to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to avatars bucket" ON storage.objects;
DROP POLICY IF EXISTS "avatars owner write" ON storage.objects;
CREATE POLICY "avatars owner write" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
DROP POLICY IF EXISTS "avatars owner update" ON storage.objects;
CREATE POLICY "avatars owner update" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  ) WITH CHECK (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own avatars" ON storage.objects;
DROP POLICY IF EXISTS "avatars owner delete" ON storage.objects;
CREATE POLICY "avatars owner delete" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Avatars bucket public read" ON storage.objects;
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars public read" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'avatars');

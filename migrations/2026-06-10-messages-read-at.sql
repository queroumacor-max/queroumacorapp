-- SQL Wave 24 (2026-06-10) — unread count de mensagens (chat badge na TopNav)
-- ────────────────────────────────────────────────────────────────────────
-- Mira UX: TopNav tem ícone de chat mas badge `hasUnreadChat` é sempre
-- false (prop sem hook). Adiciona coluna read_at + índice + função RPC
-- pra contagem rápida.
--
-- Critério de "unread": message com receiver_id = user_id e read_at IS NULL
-- e deleted_at IS NULL. Quando o user abre a conversa, frontend chama
-- mark_conversation_read(conv_id) que faz UPDATE bulk.

-- 1) Coluna read_at: timestamp em que o RECEIVER abriu a conversa
--    pela primeira vez depois da msg chegar. NULL = ainda não lida.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz DEFAULT NULL;

-- 2) Índice parcial pra contagem de unread — só guarda rows com read_at
--    NULL, então fica pequeno mesmo com chat grande. Cobre o filtro
--    `receiver_id = ? AND read_at IS NULL AND deleted_at IS NULL`.
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
  ON public.messages (receiver_id, created_at DESC)
  WHERE read_at IS NULL AND deleted_at IS NULL;

-- 3) RPC pra marcar todas as msgs de uma conversa como lidas pelo user
--    logado. Idempotente: UPDATE só toca rows com read_at IS NULL.
--    SECURITY DEFINER pra cobrir o caso onde RLS de UPDATE em messages
--    seria estrita (sender-only) e o receiver não conseguiria marcar.
--    Validamos auth.uid() == receiver_id no WHERE pra impedir abuse.
CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conv_id text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE public.messages
  SET read_at = now()
  WHERE conversation_id = p_conv_id
    AND receiver_id = auth.uid()
    AND read_at IS NULL
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read(text) TO authenticated;

-- 4) RPC pra count de unread do user logado (mais rápido que SELECT *
--    com count='exact' no client porque evita roundtrip de policy check
--    por row).
CREATE OR REPLACE FUNCTION public.unread_message_count()
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.messages
  WHERE receiver_id = auth.uid()
    AND read_at IS NULL
    AND deleted_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.unread_message_count() TO authenticated;

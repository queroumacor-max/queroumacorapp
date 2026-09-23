-- 2026-09-23 — get_conversations ignora mensagem soft-deletada.
--
-- A função é SECURITY DEFINER (ignora RLS) e nunca filtrou `deleted_at`: a
-- prévia da lista de conversas seguia mostrando o texto de mensagem apagada
-- (pelo dono ou, agora, pela moderação pós-envio do chat — PR #394). Única
-- mudança em relação ao corpo do supabase_init.sql: `AND m.deleted_at IS NULL`.
-- Mesma assinatura, idempotente.
--
-- Conferência depois de rodar:
--   SELECT prosrc LIKE '%deleted_at IS NULL%' AS ok FROM pg_proc WHERE proname = 'get_conversations';

CREATE OR REPLACE FUNCTION public.get_conversations()
RETURNS TABLE (
  conv_id text,
  other_id uuid,
  last_msg text,
  last_msg_time timestamptz,
  last_sender uuid,
  is3way boolean,
  name text,
  avatar_url text,
  tag text,
  email text,
  role text,
  user_type text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  msgs AS (
    SELECT m.content, m.created_at, m.sender_id, m.type,
      COALESCE(
        m.conversation_id::text,
        LEAST(m.sender_id::text, m.receiver_id::text) || '-' || GREATEST(m.sender_id::text, m.receiver_id::text)
      ) AS ckey,
      CASE WHEN m.sender_id = (SELECT uid FROM me) THEN m.receiver_id ELSE m.sender_id END AS oid
    FROM public.messages m, me
    WHERE (m.sender_id = (SELECT uid FROM me) OR m.receiver_id = (SELECT uid FROM me))
      AND m.deleted_at IS NULL
  ),
  last_msg AS (
    SELECT DISTINCT ON (ckey) ckey, content, created_at, sender_id, oid
    FROM msgs
    ORDER BY ckey, created_at DESC
  ),
  flags AS (
    SELECT ckey, bool_or(type = 'system' AND content = '__STORE_ADDED__') AS is3way
    FROM msgs GROUP BY ckey
  )
  SELECT
    l.ckey AS conv_id,
    l.oid AS other_id,
    l.content AS last_msg,
    l.created_at AS last_msg_time,
    l.sender_id AS last_sender,
    COALESCE(f.is3way, false) AS is3way,
    p.name, p.avatar_url, p.tag, p.email, p.role, p.user_type
  FROM last_msg l
  LEFT JOIN flags f ON f.ckey = l.ckey
  LEFT JOIN public.profiles p ON p.id = l.oid
  ORDER BY l.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversations() TO authenticated;

-- 2026-09-23 — get_conversations ignora mensagem soft-deletada.
--
-- NÃO PRECISA RODAR: conferido no banco em 2026-09-23 (pg_get_functiondef
-- colado pelo usuário) — a versão viva JÁ filtra `m.deleted_at IS NULL` e
-- NÃO devolve `email`. Este arquivo espelha EXATAMENTE a versão viva.
--
-- A 1ª versão deste arquivo foi montada a partir do `supabase_init.sql`
-- (desatualizado: ainda tinha `email` no RETURNS TABLE) e o Postgres
-- recusou com 42P13 "cannot change return type of existing function" —
-- nada foi alterado. Lição: recriar função a partir do banco
-- (`SELECT pg_get_functiondef('public.get_conversations()'::regprocedure)`),
-- nunca do supabase_init.sql.
--
-- Conferência:
--   SELECT prosrc LIKE '%deleted_at IS NULL%' AS ok FROM pg_proc WHERE proname = 'get_conversations';

CREATE OR REPLACE FUNCTION public.get_conversations()
 RETURNS TABLE(conv_id text, other_id uuid, last_msg text, last_msg_time timestamp with time zone, last_sender uuid, is3way boolean, name text, avatar_url text, tag text, role text, user_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  msgs AS (
    SELECT m.content, m.created_at, m.sender_id, m.type,
      COALESCE(m.conversation_id::text,
        LEAST(m.sender_id::text, m.receiver_id::text) || '-' || GREATEST(m.sender_id::text, m.receiver_id::text)) AS ckey,
      CASE WHEN m.sender_id = (SELECT uid FROM me) THEN m.receiver_id ELSE m.sender_id END AS oid
    FROM public.messages m, me
    WHERE (m.sender_id = (SELECT uid FROM me) OR m.receiver_id = (SELECT uid FROM me))
      AND m.deleted_at IS NULL
  ),
  last_msg AS (
    SELECT DISTINCT ON (ckey) ckey, content, created_at, sender_id, oid
    FROM msgs ORDER BY ckey, created_at DESC
  ),
  flags AS (
    SELECT ckey, bool_or(type = 'system' AND content = '__STORE_ADDED__') AS is3way
    FROM msgs GROUP BY ckey
  )
  SELECT l.ckey, l.oid, l.content, l.created_at, l.sender_id,
         COALESCE(f.is3way, false),
         p.name, p.avatar_url, p.tag, p.role, p.user_type
  FROM last_msg l
  LEFT JOIN flags f ON f.ckey = l.ckey
  LEFT JOIN public.profiles p ON p.id = l.oid
  ORDER BY l.created_at DESC;
$function$;

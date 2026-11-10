-- 2026-11-09 — "escolhe funileiro e fica cliente" (relato do Fabio, 2ª vez)
--
-- CAUSA (achada no banco, não no repo): existe uma SEGUNDA trava de perfil,
-- `zz_protect_profile_columns`, criada FORA das migrations, ligada à MESMA
-- função `protect_profile_columns`. Triggers BEFORE rodam em ordem
-- alfabética:
--   trg_protect_profile_columns  → protege (ok)
--   trg_sync_role_from_user_type → role passa a seguir user_type
--   zz_protect_profile_columns   → protege DE NOVO e DESFAZ o role que o
--                                  sync acabou de escrever
-- Resultado: quem entra por Google/Apple nasce cliente/cliente, escolhe
-- Funileiro no /completar-perfil e fica user_type=automotivo, role=cliente.
-- O app lê `role` → a pessoa é tratada como cliente.
--
-- Por que derrubar a zz é seguro: a trg_protect_profile_columns (mesma
-- função) continua rodando ANTES de tudo; entre ela e o fim, só o sync mexe
-- em coluna protegida, e ele só escreve um dos 5 papéis comuns (nunca
-- 'admin') e nunca toca role='admin'.

DROP TRIGGER IF EXISTS zz_protect_profile_columns ON public.profiles;

-- Acerta quem ficou dividido (rodado como postgres no SQL Editor = confiável,
-- a trava deixa passar). O trg_grant_pro_trial dispara junto e dá os dias de
-- PRO a quem tem direito (conta nova de profissional dentro do prazo).
UPDATE public.profiles SET role = lower(user_type) WHERE lower(user_type) IN ('cliente','pintor','grafiteiro','automotivo','arquiteto') AND coalesce(role,'') <> 'admin' AND coalesce(role,'') <> lower(user_type);

-- Conferência: as duas linhas devem voltar ok = true.
SELECT 'zz removida' AS item, NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'zz_protect_profile_columns' AND tgrelid = 'public.profiles'::regclass) AS ok
UNION ALL SELECT 'ninguém dividido', NOT EXISTS (SELECT 1 FROM public.profiles WHERE lower(user_type) IN ('cliente','pintor','grafiteiro','automotivo','arquiteto') AND coalesce(role,'') <> 'admin' AND coalesce(role,'') <> lower(user_type));

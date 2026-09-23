-- NÃO É MIGRATION — é CONFERÊNCIA. Só lê, não altera nada. Rodar quantas
-- vezes quiser.
--
-- Motivo: a lista de "SQL pendente" do CLAUDE.md é anotação escrita à mão, e
-- em 2026-09-05 ela estava errada em pelo menos dois pontos (a Wave 49 dizia
-- PENDENTE no título e JÁ EXECUTADA no próprio corpo; a Wave 30 dizia "não
-- rodado" sobre coisa que o push nativo chegando no aparelho provou estar no
-- ar). Anotação não é evidência. Isto é.
--
-- Cada linha devolve `ok` = true/false. false = aquele SQL realmente falta.

SELECT 'quotes.post_id (Wave 53)' AS item,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='quotes'
                  AND column_name='post_id') AS ok
UNION ALL SELECT 'bucket exports existe (Wave 41)',
       EXISTS (SELECT 1 FROM storage.buckets WHERE id='exports')
UNION ALL SELECT 'policies do exports — as 3 (Wave 41)',
       (SELECT count(*) FROM pg_policies
         WHERE schemaname='storage' AND tablename='objects'
           AND policyname LIKE 'exports %') = 3
UNION ALL SELECT 'leads importados da planilha',
       EXISTS (SELECT 1 FROM public.leads WHERE source='planilha')
UNION ALL SELECT 'leads.city (Wave da importação)',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='leads'
                  AND column_name='city')
UNION ALL SELECT 'posts.media_urls — carrossel (Wave 57)',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='posts'
                  AND column_name='media_urls')
UNION ALL SELECT 'app_settings.push_notify_url preenchida',
       EXISTS (SELECT 1 FROM public.app_settings
                WHERE key='push_notify_url' AND COALESCE(value,'') <> '')
UNION ALL SELECT 'app_settings.push_internal_secret preenchida',
       EXISTS (SELECT 1 FROM public.app_settings
                WHERE key='push_internal_secret' AND COALESCE(value,'') <> '')
UNION ALL SELECT 'tabela push_subscriptions (web push)',
       EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='push_subscriptions')
UNION ALL SELECT 'tabela push_device_tokens (push nativo)',
       EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema='public' AND table_name='push_device_tokens')
UNION ALL SELECT 'trigger trg_dispatch_push_notification',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_dispatch_push_notification')
UNION ALL SELECT 'notify_on_message SEM agrupamento de rajada',
       EXISTS (SELECT 1 FROM pg_proc
                WHERE proname='notify_on_message' AND prosrc NOT LIKE '%v_recentes%')
UNION ALL SELECT 'is_portal_admin usa to_jsonb (C3/A-D1)',
       EXISTS (SELECT 1 FROM pg_proc
                WHERE proname='is_portal_admin' AND prosrc LIKE '%to_jsonb%')
UNION ALL SELECT 'tabela ABRAPP — os 328 itens',
       (SELECT count(*) FROM public.price_table_items
         WHERE edicao='ABRAPP 2026') = 328
UNION ALL SELECT 'tabela ABRAPP — coluna altura preenchida',
       -- O UPDATE que normaliza `altura` é o ÚLTIMO statement do arquivo de
       -- dados e é o mais fácil de esquecer. Sem ele nada quebra: o filtro de
       -- altura da tela simplesmente para de filtrar, em silêncio. 212 das 328
       -- linhas têm eixo de altura no impresso; o número exato pega também o
       -- UPDATE que rodou pela metade.
       (SELECT count(*) FROM public.price_table_items
         WHERE edicao='ABRAPP 2026' AND altura IS NOT NULL) = 212
UNION ALL SELECT 'admin_delete_user com p_force_admin (Wave 44)',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname='admin_delete_user'
                 AND pg_get_function_identity_arguments(oid) LIKE '%boolean%')
ORDER BY 1;

-- leads.opted_out_at (2026-09-06): sem ela o botao "Abordar" segue
-- oferecendo quem tocou em "Nao tenho interesse".
SELECT 'leads.opted_out_at existe' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='opted_out_at') AS ok;

-- whatsapp_ai_config.prompt (2026-09-08): sem ela o botao "Prompt da IA"
-- do portal nao salva (a tela mostra o SQL) e a IA segue no padrao do codigo.
SELECT 'whatsapp_ai_config.prompt existe' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='whatsapp_ai_config' AND column_name='prompt') AS ok;

-- leads.abordagem_status (2026-09-09): sem ela nenhum lead vira "contactado"
-- sozinho (a confirmacao da Meta nao tem onde pousar) e o portal mostra o
-- aviso laranja na tela de Leads.
SELECT 'leads.abordagem_status existe' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='abordagem_status') AS ok;

-- 2026-09-09 (ai_usage sem CHECK de feature — personas passam a contar):
SELECT 'ai_usage sem CHECK em feature (2026-09-09)' AS item, NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ai_usage'::regclass AND contype = 'c' AND conname = 'ai_usage_feature_check') AS ok;

-- 2026-09-13 (aba WhatsApp: 57014 statement timeout). Sem isto a aba cai no
-- caminho antigo (baixa todas as mensagens de 90 dias) e continua sujeita ao
-- timeout; com a policy avaliada por linha, até o caminho antigo é lento.
SELECT 'whatsapp: policy avaliada uma vez (initplan) — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_policies WHERE tablename='whatsapp_messages' AND qual LIKE '%SELECT%is_portal_admin%') AS ok;
SELECT 'whatsapp: função whatsapp_conversas — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_proc WHERE proname='whatsapp_conversas') AS ok;
SELECT 'whatsapp: função whatsapp_nao_lidas — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_proc WHERE proname='whatsapp_nao_lidas') AS ok;
SELECT 'whatsapp: função leads_por_telefone — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_proc WHERE proname='leads_por_telefone') AS ok;
SELECT 'whatsapp: índice idx_whatsapp_messages_created_id — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='idx_whatsapp_messages_created_id') AS ok;

-- 2026-09-13 (auditoria de rate limiting/abuse). Sem isto o rate limit por
-- IP (login/signup/reset, log-error, push-notify, enforceRateLimit) segue
-- fail-open silencioso, e a busca segue chamável por anon sem teto.
SELECT 'auditoria: rate_limits.user_id é text — 2026-09-13' AS item, (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='rate_limits' AND column_name='user_id') = 'text' AS ok;
SELECT 'auditoria: check_rate_limit(text,...) existe — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='check_rate_limit' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_user_id text%') AS ok;
SELECT 'auditoria: search_all sem GRANT pra anon/public — 2026-09-13' AS item, NOT EXISTS (SELECT 1 FROM information_schema.routine_privileges WHERE routine_schema='public' AND routine_name='search_all' AND grantee IN ('anon','PUBLIC')) AS ok;

-- 2026-09-13 (auditoria de segurança do Supabase — RLS/grants). `leads`
-- nunca teve RLS habilitada em nenhuma migration deste repo (a tabela
-- nasceu fora dele). Sem isto, qualquer usuário comum do app (não só
-- admin) lê/escreve a tabela inteira direto pela API REST do Supabase.
SELECT 'auditoria supabase: leads com RLS — 2026-09-13' AS item, (SELECT relrowsecurity FROM pg_class WHERE relname='leads' AND relnamespace='public'::regnamespace) AS ok;
SELECT 'auditoria supabase: policy leads_admin_all existe — 2026-09-13' AS item, EXISTS (SELECT 1 FROM pg_policies WHERE tablename='leads' AND policyname='leads_admin_all') AS ok;

-- 2026-09-23 (chat: moderação pós-envio). Sem isto a prévia da lista de
-- conversas segue mostrando o texto de mensagem apagada (pelo dono ou pela
-- moderação) — get_conversations é SECURITY DEFINER e ignorava deleted_at.
SELECT 'chat: get_conversations ignora deleted_at — 2026-09-23' AS item, EXISTS (SELECT 1 FROM pg_proc WHERE proname='get_conversations' AND prosrc LIKE '%deleted_at IS NULL%') AS ok;

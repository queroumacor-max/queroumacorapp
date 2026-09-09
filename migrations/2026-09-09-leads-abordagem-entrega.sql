-- 2026-09-09 — abordagem de lead: "contactado" só com confirmação da Meta.
--
-- INCIDENTE: uma leva de abordagens saiu do portal, a API aceitou todas, o
-- portal marcou cada lead como `contactado` — e minutos depois a Meta
-- devolveu `failed` 131026 (Message undeliverable) pra boa parte. A tela de
-- Leads dizia "contactado" pra quem nunca recebeu nada, e o `failed` só
-- pousava em whatsapp_messages (Wave 58), longe do lead.
--
-- O que muda: o lead passa a carregar a própria abordagem. A rota de envio
-- grava o wamid + 'accepted'; o webhook, ao receber o status, grava
-- sent/delivered/read/failed E decide o funil (novo -> contactado só com
-- confirmação; failed desfaz contactado). O código TOLERA a coluna ausente
-- (envio segue funcionando, só sem o vínculo), e o portal avisa enquanto o
-- SQL não roda.
--
-- Rodar UMA INSTRUÇÃO POR VEZ no SQL Editor (o editor emenda quebra de
-- linha em bloco grande — 42601). Tudo é seguro repetir.

-- 1) colunas
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS abordagem_message_id text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS abordagem_status text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS abordagem_error text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS abordagem_at timestamptz;

-- 2) o webhook acha o lead pelo wamid
CREATE INDEX IF NOT EXISTS idx_leads_abordagem_message_id ON public.leads (abordagem_message_id) WHERE abordagem_message_id IS NOT NULL;

-- 3) BACKFILL: a última mensagem que o PORTAL mandou pra cada telefone vira
--    a abordagem do lead. Casa pelos 8 últimos dígitos (mesma regra do
--    portal: leads.phone tem máscara, whatsapp_messages.wa_id é E.164 sem
--    '+'). Sem status gravado = 'accepted' (a API aceitou, a Meta nunca
--    confirmou — mensagem anterior à Wave 58 ou aviso perdido). Só preenche
--    quem ainda não tem vínculo, então repetir não sobrescreve nada.
WITH ultima AS (
  SELECT DISTINCT ON (right(regexp_replace(m.wa_id, '\D', '', 'g'), 8))
         right(regexp_replace(m.wa_id, '\D', '', 'g'), 8) AS chave,
         m.message_id, m.delivery_status, m.delivery_error,
         COALESCE(m.delivery_status_at, m.created_at) AS quando
  FROM public.whatsapp_messages m
  WHERE m.direction = 'out' AND m.origin = 'portal'
    AND length(regexp_replace(m.wa_id, '\D', '', 'g')) >= 8
  ORDER BY right(regexp_replace(m.wa_id, '\D', '', 'g'), 8), m.created_at DESC
)
UPDATE public.leads l
SET abordagem_message_id = u.message_id,
    abordagem_status = COALESCE(u.delivery_status, 'accepted'),
    abordagem_error = CASE WHEN u.delivery_status = 'failed' THEN u.delivery_error END,
    abordagem_at = u.quando
FROM ultima u
WHERE l.abordagem_message_id IS NULL
  AND length(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g')) >= 8
  AND right(regexp_replace(l.phone, '\D', '', 'g'), 8) = u.chave;

-- 4) A CORREÇÃO do incidente: quem está "contactado" mas a Meta disse que
--    NÃO entregou volta pra "novo". Qualificado/convertido/perdido não são
--    tocados — são decisão de gente, não do envio.
UPDATE public.leads SET status = 'novo' WHERE status = 'contactado' AND abordagem_status = 'failed';

-- 5) CONFERÊNCIA (só leitura): quantos leads em cada situação. A linha
--    'contactado sem confirmação' é quem a API aceitou e a Meta nunca
--    confirmou — não dá pra afirmar nem que chegou nem que falhou; ficam
--    como estão, com "⏳ aguardando" na tela.
SELECT COALESCE(status, 'novo') AS status, COALESCE(abordagem_status, '(sem abordagem)') AS entrega, count(*) FROM public.leads GROUP BY 1, 2 ORDER BY 1, 2;

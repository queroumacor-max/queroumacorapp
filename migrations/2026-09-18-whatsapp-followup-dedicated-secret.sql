-- 2026-09-18 — passo 3 do achado L3 (auditoria de webhooks 2026-09-17,
-- fechado em código no PR #328): a varredura de follow-up passa a ser
-- chamada com um segredo PRÓPRIO (`WHATSAPP_FOLLOWUP_URL_SECRET`), em vez
-- de reusar o `WHATSAPP_WEBHOOK_URL_SECRET` do webhook. Reduz o raio de um
-- vazamento — quem descobrir o segredo do webhook deixa de conseguir
-- disparar a varredura de follow-up junto.
--
-- Pré-requisito (já feito antes de rodar isto): `WHATSAPP_FOLLOWUP_URL_SECRET`
-- cadastrada no Cloudflare Pages (Production, tipo Secret) com o valor
-- abaixo, e o deploy já refeito com essa env.
--
-- O código (`app/api/whatsapp/followup/route.ts`) já aceita os DOIS
-- segredos — o dedicado tem prioridade, o do webhook continua valendo como
-- fallback — então rodar isto não tem janela de indisponibilidade: se o
-- cron ainda estiver com a URL antiga no cache de alguma execução em voo,
-- ela continua funcionando até a próxima leitura.
--
-- Troque <SEGREDO_NOVO> pelo valor gerado (openssl rand -hex 24) e já
-- cadastrado como WHATSAPP_FOLLOWUP_URL_SECRET no Cloudflare Pages.

UPDATE app_settings
   SET value = 'https://www.queroumacor.com.br/api/whatsapp/followup?token=<SEGREDO_NOVO>'
 WHERE key = 'whatsapp_followup_url';

-- Conferência (deve devolver a URL com o token NOVO):
-- SELECT key, value FROM app_settings WHERE key = 'whatsapp_followup_url';

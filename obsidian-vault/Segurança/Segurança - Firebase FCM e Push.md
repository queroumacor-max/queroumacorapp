---
tags: [segurança, auditoria, firebase, fcm, push, apns]
---

# Auditoria Firebase / FCM / APNs / Push

**Data:** 2026-09-13. SQL `/migrations/2026-09-13-fcm-push-hardening.sql` **JÁ EXECUTADO** (2026-09-15, confirmado).

## Achado crítico: `push_device_tokens` tinha `UPDATE ... USING (true)`
Intenção era permitir aparelho compartilhado reatribuir a PRÓPRIA linha ao trocar de conta — mas `USING(true)` não distinguia "minha linha antiga" de "linha de qualquer um". Qualquer usuário podia `PATCH /rest/v1/push_device_tokens?user_id=eq.<vítima>` e **sequestrar a linha de outra pessoa**, só sabendo o `user_id` (não secreto). **Fix**: RPC SECURITY DEFINER `upsert_push_device_token(p_token, p_platform)` que grava sempre `user_id = auth.uid()` lido DENTRO da função. Policy de UPDATE volta a ser `auth.uid() = user_id` nos dois lados. Client (`lib/services/pushTokens.ts`) chama a RPC primeiro, cai pro upsert direto só se a função ainda não existir (`PGRST202`/`42883`).

## Achado médio: sem teto de linhas por usuário
RLS de INSERT só garante "é dono", não "quantidade razoável" — usuário podia inserir milhares de tokens/subscriptions falsos e qualquer notificação disparava milhares de fetches concorrentes. **Fix**: trigger mantém só os 20 mais recentes por usuário + `/api/push-notify` busca só `25 × nº destinatários` mais recentes por chamada.

## Achado médio: `dispatch_push_on_notification` sem teto por destinatário
Rate limit do `/api/push-notify` é por IP de quem chama (o próprio Postgres), nunca por quem recebe. **Fix**: `check_rate_limit(NEW.user_id::text, 'push-dispatch', 20, 1)` antes do `net.http_post` — estourou, notificação continua gravada, só o envio de push é contido. Depende do `check_rate_limit(text,...)` da [[Segurança - Rate Limiting e Abuse]].

## Verificado e correto, sem mudança
`push_subscriptions` (web push) já tinha UPDATE/DELETE corretamente escopados. FK `ON DELETE CASCADE` limpa tokens de conta deletada. Token morto (404/410/UNREGISTERED) já é removido pelo próprio envio. Sem `.p8`/service-account JSON no repo. FCM keys só em env do Cloudflare, via `getRuntimeEnv`, nunca no client. Deep link só aceita path relativo (bloqueia open-redirect). Sem FCM topics em uso.

## Regressão que quase quebrou o boot
`<NativeBadge>` (Onda C, 2026-09-04) causou "Algo deu errado" em todo usuário logado: dois consumidores dos hooks `useUnreadMessageCount`/`useUnreadNotificationCount` colidiam no MESMO nome de canal realtime (`msg-count:<uid>`) → `cannot add postgres_changes callbacks after subscribe()`. **Regra: hook com canal realtime = nome único por instância (`useId()`).**

## SEGUNDA RODADA — verificação manual de console (2026-09-16)
IAM Firebase/GCP limpo (3 principals); service account keys limpo (1 chave ativa por conta); quotas/billing FCM limpo (Spark plan, sem cobrança); Apple Developer "Users and Access" tem `beatrisporsebon@icloud.com` com Admin — **confirmado INTENCIONAL pelo usuário**, não vulnerabilidade.

---
## Ver também
[[Segurança - Auditorias Externas (Webhooks e Integrações)]] · [[Mobile - Build, Deploy e Push Nativo]] · [[Segurança - Auditoria Supabase (RLS e Banco)]]

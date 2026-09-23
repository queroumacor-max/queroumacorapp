---
tags: [chat, mensagens, realtime, unread, auto-resposta]
---

# Chat Interno (usuário-usuário) — 3-Way, Não Lidas e Respostas Automáticas

> Este arquivo cobre o chat **dentro do app** (comprador↔pintor, e a loja Cali Colors entrando numa conversa como terceiro). É DIFERENTE do WhatsApp externo (Cloud API/Dualhook) — ver [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] pra esse outro sistema.

## Chat 3-way (cliente + pintor + loja) — 2026-08-22
Não existe tabela de conversas: tudo é `messages` com `conversation_id` texto (`uuidA_uuidB` ordenado no 1:1, prefixo `3way:` quando criado por essa via, `store_calicolors_<uuid>` na conversa direta com a loja). A loja entra pelo banner dentro da conversa (só profissional vê — `isPainter` no `ChatConversation`), que insere `__STORE_ADDED__` (type=system, marcador) + saudação (type=store). O `/portal` → "Chats 3-Way" lista agrupando por `conversation_id` e responde com type=store.

- **Fix 1 — a tela não percebia a loja.** `is3way` olhava só o prefixo do convId, mas adicionar a loja NÃO troca o convId. Resultado: cabeçalho nunca virava "+ Cali Colors" e o convite continuava na tela (dava pra adicionar de novo e duplicar a saudação). Agora deriva de 3 sinais: prefixo, `convMeta.is3way` (marcador) ou qualquer mensagem `type='store'` já carregada. `findOrCreate3WayWithStore` segue sem caller (código morto).
- **Fix 2 — atalho "🎨 Loja" na lista de conversas** (`ChatList`), que abre ou cria a conversa direta com a loja. Antes só existia a ABA "Cali Colors", que FILTRA conversas existentes — quem nunca tinha falado com a loja precisava adivinhar o nome dela na busca do "+".
- **SQL Wave 35 — JÁ EXECUTADA no Supabase (2026-08-29).** A policy de SELECT em `messages` liberava só sender/receiver, e a loja responde escolhendo UM destinatário → o terceiro não via a mensagem. A policy nova acrescenta participante ESTRUTURAL: `POSITION(auth.uid()::text IN conversation_id) > 0`. **Não usar a regra "tem mensagem sua nessa conversa"** — o convId é derivado de UUIDs públicos, então qualquer um poderia inserir uma mensagem na conversa alheia e passar a ler o histórico. Migration em `/migrations/2026-08-22-messages-conversation-visibility.sql`.

## Respostas automáticas do chat — consertadas (Wave 39, 2026-08-28)
Dois bugs, os dois corrigidos: (1) `auto_responses` nasceu SEM unique em `(user_id, trigger_type)` → o upsert `onConflict` do AutoRespostaSheet falhava com 42P10 em TODO salvamento, e o código não conferia o `error` do supabase-js (não lança!) → toast "salvas!" mentiroso, toggle voltava desligado; agora o save é 1 upsert em lote com erro conferido. (2) O disparo rodava no NAVEGADOR do pintor (`useChatRealtime.maybeAutoReply`) — só respondia com o app aberto; o listener foi REMOVIDO e o disparo virou trigger no banco.

**Wave 39** (`/migrations/2026-08-28-auto-responses-fix.sql`): limpa duplicatas, cria a UNIQUE e o trigger `trg_auto_reply_on_message` (responde mesmo com app fechado; anti-loop pelo marcador "🤖 Resposta automática:"; máx 1 por conversa/12h; `EXCEPTION WHEN OTHERS` igual à Wave 36 de push — falha em notificar nunca derruba o INSERT da mensagem). **Wave 39 rodada em 2026-08-28 — não pedir pra rodar de novo.**

Follow-up (3 dias) segue não implementado (precisa de pg_cron; só o slot `new_message` dispara).

## Não lidas nos Chats 3-Way (Wave 51, 2026-08-29, v=20260829y)
O número da conversa era `conv.messages.length` (total da conversa) e o do menu era o COUNT de `messages` inteiro — o famoso "23" que não fazia sentido nenhum. Nenhum dos dois baixava ao abrir a conversa.

Agora vale a marca em `portal_chat_reads` (`/migrations/2026-08-29-portal-chat-reads.sql`), separada de propósito de `messages.read_at`, que é do APP: se a loja escrevesse ali, apagaria o não-lido de quem é o destinatário de verdade. Não conta o que o próprio operador mandou; abrir a conversa zera; chegou mensagem com a conversa aberta, já entra lida. O badge do menu passou pro `loadWaBadge` (agora calcula WhatsApp + chats, ver [[WhatsApp - Portal e Mídia]]) e saiu do `loadBadges` (que é caro e quase estático — por isso `loadBadges` MESCLA o state em vez de substituir).

**JÁ EXECUTADA no Supabase (2026-08-29). Não pedir pra rodar de novo.**

## Badge de chat não lido (TopNav) — fix LIVE (2026-06-15)
`useUnreadMessageCount` revalida também no INSERT de `notifications` (mesmo evento que acende o sininho, comprovadamente entregue) + `refetchOnWindowFocus` + `staleTime` 15s. O realtime da tabela `messages` sozinho não disparava o badge no DB live; fazer "piggyback" no sininho garante que acenda junto.

## SQL Wave 24 (2026-06-09) — unread chat (TopNav badge)
Coluna `messages.read_at timestamptz` (NULL = não lida) + índice parcial `idx_messages_receiver_unread` (receiver_id + created_at WHERE read_at IS NULL AND deleted_at IS NULL). RPCs `mark_conversation_read(p_conv_id text)` (SECURITY DEFINER, marca todas as msgs da conv onde receiver = auth.uid()) e `unread_message_count()` (count total do user logado). Frontend: service `chat-messages.markConversationRead/fetchUnreadMessageCount`, hook `useUnreadMessageCount` (mesmo padrão do hook de notificação: COUNT + realtime subscribe em messages filtrado por receiver_id) — **canal realtime com nome único por instância, ver a lição do "boot logado quebrou" em [[Mobile - Build, Deploy e Push Nativo]]**, aplicável a este hook também depois que ele passou a ser reutilizado por TopNav e `<NativeBadge>` simultaneamente. TopNav lê do hook e renderiza badge com número (99+ pra >99) — prop `hasUnreadChat` removida (era sempre false). `ChatConversation` chama `markConversationRead` em `useEffect` ao montar.

## Soft delete de mensagens (Wave 8, 2026-05-31)
`messages.deleted_at` — policies de SELECT escondem soft-deleted, mas dono e admin (`is_portal_admin()`) ainda enxergam pra desfazer/auditoria. Service `chat-messages.softDeleteMessage/undoDeleteMessage` com `undoToken`, hook `useDeleteMessage` expõe `remove + undo`. `cleanup_soft_deleted()` (SECURITY DEFINER, só `service_role`) faz hard delete após 30 dias.

## RLS hardening (Wave 27, 2026-06-10)
`messages` ganhou UPDATE policy (sender/receiver) e SELECT passou a filtrar `deleted_at IS NULL` (admin via `is_portal_admin()` ainda enxerga). Detalhe completo em [[Auth - OAuth, Cadastro e RLS de Sessão]].

## Gap de segurança fechado depois: bloqueio (`blocks`) não valia em escrita de mensagem
O filtro de `blocks` (Wave 21, 2026-06-09) só cobria o FEED, client-side. Até a auditoria "Pentest Integrado Final" (2026-09-18) fechar isso, `messages` (junto com `follows`/`likes`/`comments`) checava só posse da própria linha no INSERT — A bloqueava B, e B continuava conseguindo mandar mensagem via REST direto. Fix: `blocked_between(a,b)` SECURITY DEFINER (checa as duas direções) entrou no WITH CHECK das 4 tabelas. Detalhe completo, incluindo o bug de escopo de variável correlacionada que passou pela 1ª versão do fix, em [[Segurança - Auditoria Supabase (RLS e Banco)]].

## Gap de segurança fechado depois: "e-mail confirmado" pra mandar mensagem era só client-side
Mesma auditoria de 2026-09-18: não existe rota de servidor pra enviar mensagem (supabase-js direto do browser), então REST direto com token de conta nunca confirmada mandava mensagem normalmente. Fix: `is_email_verified()` SECURITY DEFINER no WITH CHECK de INSERT de `messages` (junto com `posts`/`comments`). Ver [[Segurança - Auditoria Supabase (RLS e Banco)]].

## Rate limit em mensagens de chat (2026-09-15)
`messages` ganhou rate limit PRÓPRIO — antes só existia no dispatch do push (20/min por destinatário, que continha o SINTOMA, não a causa). Trigger `BEFORE INSERT` chama `check_rate_limit` com chave por PAR remetente→destinatário (`sender>receiver`, não o remetente sozinho — pra não travar a loja respondendo muita gente rápido), 30 msgs/min. Estourou → INSERT recusado com mensagem que contém "rate limit" (já bate no pattern existente de `lib/errors-friendly.ts` → "Muitas tentativas"). `type='system'` (marcadores internos) não conta. Falha na checagem não bloqueia o envio. SQL em `/migrations/2026-09-15-chat-safety-hardening.sql` — **JÁ EXECUTADO no Supabase (2026-09-15). Não pedir pra rodar de novo.**

## Push de mensagem sem texto (2026-09-15)
`dispatch_push_on_notification` parou de mandar o texto da mensagem no push — antes copiava `notifications.body`, que pra `type='message'` inclui até 80 chars do texto real, direto pro corpo da notificação (aparecia na tela de bloqueio). Agora, só pra `type='message'`, o push manda "`<nome de quem mandou>` enviou uma mensagem" (nome vem do `actor_id`). `notifications.body` NÃO muda — a tela `/notificacoes` dentro do app continua mostrando o preview completo; só o que SAI pelo push foi redigido. Mesmo tratamento estendido depois pra comentário (auditoria "Bloco 21", 2026-09-18): comentário caía no ELSE e mandava `notifications.body` verbatim — `dispatch_push_on_notification` ganhou ramo próprio pra `'comment'` ("`<nome>` comentou no seu post", sem o texto).

---
## Envio instantâneo — moderação depois do INSERT, no servidor (2026-09-23, PR #394)
Mandar mensagem levava ~5s: o `useSendMessage` esperava `/api/moderate` (GoTrue + rate limit + reserva de cota + Gemini) ANTES do INSERT em `messages`, e o composer travava o campo ("..."). Agora grava direto (bolha otimista) e pede a moderação ao SERVIDOR: `POST /api/chat/moderate-message {messageId}` (fetch `keepalive`) responde 202 e modera por `runAfterResponse`/`waitUntil` — conteúdo lido do BANCO com service role, só o remetente pode pedir, cota `moderate`, rate limit 60/min.

- Reprovada (qualquer `flagged`) → PATCH `deleted_at` + broadcast `msg-removed` no canal `chat-global-<uuid>` de cada participante. `useChatRealtime` escuta e REFAZ a consulta (payload é só aviso); remetente ganha toast. Portal 3-way filtra `deleted_at` e ouve UPDATE (v=20260923b).
- **Por que broadcast:** a policy de SELECT esconde linha apagada e o realtime respeita RLS — o destinatário nunca receberia o UPDATE.
- **Achados do Codex na 1ª versão (P1, corrigidos no mesmo PR):** moderar no navegador morria com o app fechado; o soft delete só saía do cache do remetente.
- **Trade-off:** mensagem reprovada fica visível alguns segundos; INSERT direto via REST segue pulando a moderação (igual antes).
- **SQL PENDENTE:** `/migrations/2026-09-23-get-conversations-skip-deleted.sql` — `get_conversations` (SECURITY DEFINER) nunca filtrou `deleted_at`; sem ele a prévia da lista mostra o texto apagado.
- Testes: `__tests__/chatEnvioInstantaneo.test.ts`, `__tests__/services/chat-moderation.test.ts`.

## Ver também
[[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] · [[WhatsApp - Portal e Mídia]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Segurança - Firebase FCM e Push]] · [[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Mobile - Build, Deploy e Push Nativo]]

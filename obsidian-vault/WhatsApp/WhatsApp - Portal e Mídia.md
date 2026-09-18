---
tags: [whatsapp, portal, performance, mídia]
---

# WhatsApp — Aba do Portal, Performance e Mídia Recebida

## Performance (2026-09-13, "57014: statement timeout")
SQL `/migrations/2026-09-13-whatsapp-perf.sql` executado. Causa não era volume, era RLS: policies com `USING (is_portal_admin())` solto chamavam a função SECURITY DEFINER **uma vez por linha**. Fix: `USING ((SELECT is_portal_admin()))` — InitPlan, avaliada 1x. **Regra: função em policy de RLS vai sempre embrulhada em `(select …)`.**
- Índices novos: `(created_at desc, id desc)`, `delivery_status_at` parcial, `(wa_id, created_at) where direction='in'`.
- `whatsapp_conversas(p_desde)`: 1 linha por número (resumo), não baixa mais 90 dias de mensagens inteiros. `whatsapp_nao_lidas(p_desde)`: badge do menu. `leads_por_telefone(sufixos[])`: substitui ILIKE que varria 61 mil linhas.
- Enviar mensagem não recarrega mais 90 dias a cada envio. Status de entrega chega por realtime UPDATE.
- Rota `/api/whatsapp/send`: escrituração DEPOIS da resposta (`runAfterResponse`/`waitUntil`) — só vínculo wamid→lead segura a resposta (teto 3s).

## "A lista era as últimas 500 mensagens e conversas se perdiam" (2026-08-29)
`limit(500)` agrupado por número fazia lote de abordagem ocupar as 500 linhas e conversa antiga sumir. Fix: aba baixa TODAS as mensagens dos últimos 90 dias em páginas, emendadas por id; poll de 60s só pede 1 dia; histórico completo ao abrir conversa; nome do lead casado pelos 8 últimos dígitos do telefone em lotes; coluna renderiza no máx 300 conversas com aviso.

## Não lidas (badge)
Contador de CONVERSAS (não mensagens) com mensagem RECEBIDA depois de `whatsapp_ai_state.last_read_at`. Pílula "● Não lidas (N)" filtra a lista; conversa aberta fica na lista mesmo lida (senão sumiria no clique que a abriu).

## Origem das mensagens (Wave 55, SQL executado)
`whatsapp_messages.origin` ('portal'|'ia'|'celular'): rota de envio grava portal, runner IA grava ia, webhook grava celular pra toda 'out' vinda de fora (eco do que já foi enviado colide no UNIQUE e é descartado). Chip 📱/🖥️/🤖 por conversa.

## Mídia recebida
- **Cloud API/Dualhook (2026-09-05)**: arquivo não vem no webhook, só um `id` — busca em 2 passos (`GET /{id}` → URL temporária → download), Bearer do Dualhook. Objeto vem numa chave com o NOME DO TIPO (`audio`, `image`, `sticker`...). Legenda vira corpo; áudio é transcrito (entra no histórico que a IA lê).
- **Origem histórica (Evolution, Wave 49)**: base64 no próprio evento webhook, upload pro bucket privado `whatsapp-media`, `media_url` grava PATH (não URL, expira), portal pede URL assinada em lote (1h).
- Tudo best-effort: falha nunca derruba o 200 do webhook nem perde a mensagem.
- Reação/edição/mensagem não suportada: `textoDeReacaoOuEdicao` extrai `reaction.emoji`/`edit.text.body`; `TIPOS_SEM_CONVERSA` grava no histórico mas não acorda a IA.
- **Eco do celular (Coexistence)**: `field='smb_message_echoes'` — o que a loja manda pelo APP do WhatsApp chega assim, não em `messages`. Gravado como `direction='out'` + `origin='celular'`, nunca chama IA.

## Chats 3-Way (cliente + pintor + loja)
Não existe tabela de conversas: tudo é `messages` com `conversation_id` texto. Loja entra pelo banner dentro da conversa (`__STORE_ADDED__` marcador + saudação). Fix: policy de SELECT precisava de participante ESTRUTURAL (`POSITION(auth.uid()::text IN conversation_id) > 0`), não "tem mensagem sua nessa conversa" (permitiria vazamento). Atalho "🎨 Loja" na lista de conversas abre/cria direto.

## Templates com nome + modal de contatos, janela 24h
Ver [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] pra regras de template e telefone.

---
## Ver também
[[WhatsApp - IA, Follow-up e Leads]] · [[Performance - Índices, RPCs e Paginação]] · [[Portal - Pessoas, Produtos e Ferramentas]]

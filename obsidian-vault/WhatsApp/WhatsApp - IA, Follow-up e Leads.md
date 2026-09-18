---
tags: [whatsapp, ia, follow-up, leads, automação]
---

# WhatsApp — IA de Atendimento, Follow-up Automático e Abordagem de Leads

## IA de atendimento (2026-08-29)
`whatsapp-ai.ts` (prompt + travas) + `whatsapp-ai-runner.ts` (cola com webhook). Horário comercial Brasília 8h-19h sem domingo + opt-out `PARE` + modelo por env `WHATSAPP_AI_MODEL` (default gpt-4o-mini). Teto de 30 respostas automáticas por conversa por dia (usa `diaBrt()`, fuso de Brasília — não UTC). Ordem: opt-out > IA desligada > fora do horário > teto > responde. Ao escalar, desliga a IA na conversa e cria alerta.

**REGRA INEGOCIÁVEL: mensagem e IA NUNCA falam preço, valor, desconto, condição de pagamento nem fazem orçamento.** Aplicada em dois pontos: no prompt E em trava de código (`clientAsksForPrice` escala antes de chamar o modelo; `replyLeaksPrice` barra vazamento na saída).

## Prompt editável (SQL `/migrations/2026-09-08-whatsapp-ai-prompt.sql`, executado)
`whatsapp_ai_config.prompt`. `PROMPT_BASE_PADRAO` é a parte editável pela loja; `buildSystemPrompt` mantém FIXOS contexto do lead, blocos de 1º contato, estilo e formato JSON. Travas de preço são código, valem sempre. Botão "🧠 Prompt da IA" no portal.

## Mensagem de ausência
Fora do horário OU IA desligada: cortesia fixa (não é a IA falando, texto fixo). Travas: nada pra opted_out, 1 a cada 12h por conversa, silêncio se pessoa real respondeu nas últimas 2h. Config: `whatsapp_ai_config.away_on`/`away_text`.

## Follow-up automático (Wave 48, SQL executado, cron confirmado rodando)
Varredura de hora em hora (pg_cron → pg_net → `/api/whatsapp/followup?token=...`). Três ações: (1) alerta parado vira "⏰ sem resposta há Xh"; (2) cobra cliente 1x em horário comercial; (3) reengaja quem sumiu depois da loja falar por último, 1x/semana. **Nenhum texto automático anuncia "responda PARE"** (decisão da loja) mas a palavra continua valendo. Teto 10 envios/varredura. Lógica pura em `whatsapp-followup.ts` (`planFollowups`). "Resposta de gente" = `sent_by NOT NULL` (IA grava NULL).

- **`whatsapp_ai_state.enabled` é NULL = "nunca decidido" → vale o padrão global** (não `false` — várias escritas de raspão desligavam a IA sem querer).
- **Rota nova de follow-up após migração pro Dualhook**: `/api/whatsapp/followup` (aceita `WHATSAPP_WEBHOOK_URL_SECRET` + ponte com token antigo). A rota antiga `/api/whatsapp-evo/followup` ficou parada quando a env `EVOLUTION_WEBHOOK_TOKEN` foi removida (403 silencioso por semanas) — corrigido 2026-09-05.
- **Custo da migração pro Dualhook**: follow-up fala com quem SUMIU (quase sempre FORA da janela de 24h) → texto livre recusado (131047) e não há template cadastrado pra isso → follow-up NÃO SAI hoje, tratado como desfecho conhecido (`SweepResult.foraDaJanela`), marcado como tentado pra não martelar. Resposta automática e ausência não são afetadas (reagem a mensagem recente, janela sempre aberta).
- **Achado do Codex (PR #336)**: RPC `claim_wa_followup_nudge` (reengajamento) tem migration escrita mas **sem confirmação de execução** — código é fail-safe, fase de reengajamento pausa em silêncio até rodar (ver [[Segurança - Auditorias Externas (Webhooks e Integrações)]]).

## Abordagem de leads (captação, 2026-08-29 em diante)
- Botão "💬 Abordar" no portal: `AbordagemModal` mostra categoria, sub-funil (`LEAD_PITCH`), telefone, sugere produtos. **2026-09-05: virou template-only** (aba texto livre removida — janela sempre fechada pra abordagem). `montarAbordagem` foi apagada junto (código morto).
- Lead vira `contactado` **só com confirmação da Meta** (Wave 43, SQL executado). Incidente que motivou: abordagens em lote saíam 200 + wamid, portal marcava `contactado` na hora, minutos depois chegava `failed` 131026 e a tela mentia. Agora `leads.abordagem_message_id`/`abordagem_status`/`abordagem_error`/`abordagem_at` são escritos pelo SERVIDOR: rota grava wamid + 'accepted'; webhook (`persistStatusDoLead`) acha o lead pelo wamid e decide o funil (sent/delivered/read → contactado; failed → volta pra novo). Status só anda pra frente. **Regra: escrita de funil que depende de entrega externa é do servidor, no evento de confirmação — nunca do cliente, na aceitação.**
- Abordagem em LOTE: checkbox por linha, mesmo template pra todos, variáveis puxadas do cadastro de cada lead (nome completo, cidade, ramo).
- Opt-out tem desfecho próprio: quem toca "Não tenho interesse" (quick reply de template) recebe agradecimento curto (não é o silêncio do `PARE`) e sai da abordagem — `ehRecusaDeAbordagem` compara sem acento/caixa.
- Lista de contatos pra "+ Nova conversa" busca NO BANCO (não em 500 primeiros, que ficava invisível pra maioria dos 1072 leads) + índice A-Z.

---
## Ver também
[[Leads - Importação e Funil de Abordagem]] · [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]] · [[WhatsApp - Portal e Mídia]]

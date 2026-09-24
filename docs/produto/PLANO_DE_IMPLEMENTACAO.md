# Plano de implementação — QueroUmaCor

> Estado em 2026-09-23 e próximos passos em ordem de prioridade. Montado a
> partir do `CLAUDE.md` (registro de estado) e do código — **não** do
> `BACKLOG.md`, que está desatualizado.
>
> Esforço: P (horas) · M (1–3 dias) · G (semana+).
> Dono: **Código** = sessão de desenvolvimento · **Painel** = alguém com
> acesso ao Cloudflare/Supabase/lojas · **Decisão** = produto/negócio.

## 1. Onde estamos

| Área | Estado |
|---|---|
| App web (Next 16 no Cloudflare Workers) | ✅ No ar, domínio cortado para o Worker em 2026-09-20 |
| Android (Capacitor, Codemagic) | ✅ Play Store; builds automáticos para Internal Testing |
| iOS (Capacitor, Codemagic) | 🟡 Builds no TestFlight, **em revisão da Apple** |
| Rede social, chat, orçamentos, loja, ferramentas, IA | ✅ Completos |
| Portal da Cali Colors | ✅ Completo |
| WhatsApp — envio, templates, abordagem | ✅ |
| WhatsApp — **recebimento** | 🔴 Parado desde 2026-09-17 |
| Segurança (auditorias ASVS, pentest, LGPD, CI/CD, DR) | ✅ Sem crítico aberto; riscos documentados |

## 2. Fase 0 — Urgente (esta semana)

| # | Item | Esforço | Dono |
|---|---|---|---|
| 0.1 | **Restabelecer o recebimento do WhatsApp.** Conferir no painel do Dualhook se o webhook está ativo, a URL cadastrada e os códigos de entrega; ou testar o GET de verificação no navegador. Corrigir segredo/URL conforme o resultado | P | Painel + Código |
| 0.2 | Depois de 0.1: confirmar ponta a ponta (template → resposta → aparece no portal → IA responde) e registrar | P | Código |
| 0.3 | Dar permissão `Zone > Workers Routes > Edit` ao token do deploy (o passo de rotas falha em todo deploy) | P | Painel |

## 3. Fase 1 — Fechar riscos conhecidos (2–4 semanas)

| # | Item | Esforço | Dono |
|---|---|---|---|
| 1.1 | **Moderação obrigatória no servidor para posts.** Hoje um INSERT direto via API pula a moderação. Proposta registrada: posts nascem `pending` e só a rota de moderação (service role) promove para `approved`; unificar foto e vídeo no mesmo modelo; testar os dois fluxos antes de revogar o INSERT direto | G | Código |
| 1.2 | Decidir "Resize images from any origin" no Cloudflare: auditar quanto da mídia passa por proxy do domínio; proxiar o Supabase Storage e então desligar | M | Código + Painel |
| 1.3 | ✅ **Feito (2026-09-24).** Policies das 4 tabelas conferidas (só `authenticated`, sem sobra antiga); cron duplicado removido por `2026-09-24-cron-dedupe.sql` | P | Código (SQL colado) |
| 1.4 | ✅ **Feito (2026-09-24).** Conferido no banco: `2026-09-16-business-logic-security-audit.sql`, `2026-09-17-rate-limit-sliding-window.sql` e `2026-09-17-whatsapp-followup-claim.sql` estão aplicados (22/22 checagens `true`) | P | Painel |
| 1.5 | Segundo admin em GitHub, Cloudflare, Supabase, Firebase, Play; MFA em todos; revisar Dualhook e desligar a instância Evolution no Render | M | Painel |
| 1.6 | Remover o Custom Domain do projeto Cloudflare Pages antigo, se ainda estiver lá | P | Painel |

## 4. Fase 2 — Produto (1–2 meses)

| # | Item | Esforço | Por quê |
|---|---|---|---|
| 2.1 | Follow-up do WhatsApp por **template** (fora da janela de 24h texto livre não sai) | M | Reengajamento hoje fica sem enviar |
| 2.2 | Links internos para `/loja` abrirem direto o catálogo da Cali Colors | P | Um toque a mais em várias telas |
| 2.3 | Catálogo multi-loja real (`store_id` em produtos, preço por loja) | G | Lojas parceiras cadastradas mostram "em preparação" |
| 2.4 | Página de aprovação de orçamento pelo cliente (hoje é link de WhatsApp) | M | Registro formal do aceite |
| 2.5 | Classificação automática de lead pela IA (temperatura/resumo) e funis para PROs e clientes | M | Reaproveita a máquina do WhatsApp |
| 2.6 | CNPJ/CPF no perfil (hoje vivem só no `quote_data`) | P | Menos digitação no orçamento |
| 2.7 | Aviso "atualize o app" | P | Adiado por decisão — reavaliar |
| 2.8 | Reels verticais, editor de story, antes/depois real | G | Paridade com redes sociais |

## 5. Fase 3 — Plataforma e operação

| # | Item | Esforço |
|---|---|---|
| 3.1 | Trilha de auditoria para escritas do portal (prompt da IA, preços, produtos) — exige rota própria | M |
| 3.2 | Reconciliação automática com Mercado Pago (se a cobrança voltar) | M |
| 3.3 | Verificação real de IAP Apple/Google antes de ligar qualquer compra in-app | G |
| 3.4 | Definir RPO/RTO; testar restore de PITR; backup do Storage | M |
| 3.5 | Remover fallback legado do feed (usar só `get_feed_v2`) | P |
| 3.6 | Atualizar `supabase_init.sql`/`DATABASE.md` a partir do banco vivo | M |
| 3.7 | Figma/biblioteca de design e componente `EmptyState` padrão | M |
| 3.8 | Revisão de acessibilidade (`aria-label`, leitor de tela) | M |

## 6. Decisões pendentes (bloqueiam itens acima)

| Decisão | Afeta |
|---|---|
| Religar cobrança do PRO (e por qual meio, respeitando as regras das lojas)? | 3.2, 3.3 |
| Quando abrir catálogo para outras lojas? | 2.3 |
| Aceitar a janela de alguns segundos de mensagem de chat reprovada visível? | Hoje aceito |
| Metas de RPO/RTO | 3.4 |
| Reescrever histórico do git para tirar os 986 contatos importados? | Privacidade |

## 7. Como cada item vira "pronto"

1. Código com teste; `tsc`, `vitest` (linha **Test Files**) e `next build`.
2. SQL em `/migrations` + colado no chat + consulta de conferência.
3. Deploy por `deploy.yml` e confirmação **no aparelho/navegador real**
   (CI de datacenter é bloqueado pelo WAF).
4. Registro no `CLAUDE.md` na hora e atualização deste plano.

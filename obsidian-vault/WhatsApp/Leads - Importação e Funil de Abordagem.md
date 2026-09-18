---
tags: [leads, importação, portal, funil]
---

# Leads — Importação, Estrutura e Funil

## Performance da tela (2026-08-29, ~61 mil linhas)
Três causas empilhadas, corrigidas: `buscarTudo` paginava em SÉRIE com teto de 50.000 (parava em silêncio) → `buscarEmPaginas` (1ª página com count, resto em paralelo, ordena por `created_at` E `id`). Tela esperava a ÚLTIMA página → agora pinta a 1ª e completa em background com "⏳ carregando N de M". Um `<tr>` por lead travava o navegador → janela de 100 linhas + sentinela IntersectionObserver, com teto (500) e botão "próximos 500". Recarga total virou emenda por id (`emendarLeads`).
Busca do topo acha por TELEFONE quando a query é só número (dígitos, com/sem DDI 55).

## Importação de planilha
"✨ Busca AI" foi **REMOVIDO** (2026-08-29) — não buscava nada de verdade, o modelo INVENTAVA empresas/telefones plausíveis, que são telefones reais de alguém. No lugar: "📥 Importar planilha" — CSV com detecção de separador `;`/`,`/tab e re-decodificação windows-1252 (Excel pt-BR), casamento de coluna por nome, dedupe pelos 8 últimos dígitos do telefone, lotes de 200.
**986 leads do Google Maps importados** (2026-08-29) — `/migrations/2026-08-29-import-leads-planilha.sql`, confirmados no banco (usuário: "já importamos... 1072 leads" — número final incluindo os 88 originais `captacao`). **Lição de processo**: uma anotação anterior dizia "NÃO RODADA, confirmado no banco" e estava ERRADA — nem verificação pontual imuniza a anotação contra ficar desatualizada. Quando o usuário diz que está feito, ele ganha da anotação escrita.

## Colunas e schema
`leads` nasceu fora do repo (sem `CREATE TABLE`, só ALTERs incrementais) — **regra: conferir schema real antes de escrever INSERT/UPDATE**, já custou incidentes (`city`/`neighborhood` ausentes causaram erro engolido; mesma classe de erro que `quotes.post_id`).
- `city`/`neighborhood`: criadas na migration de importação.
- `instagram`/`state`: para leads de grafiteiros (Click Rua, sem telefone — canal é Instagram). Tolerado se ausente (fallback sem as colunas).
- `status='fixo (sem WhatsApp)'`: `LEADS_STATUS` é a lista única (sem CHECK constraint confirmado — `pg_constraint` retornou zero linhas pra `leads`).
- `opted_out_at`: opt-out próprio de leads (independente de `whatsapp_ai_state.opted_out`) — sem ela, botão "Abordar" seguia oferecendo contato de quem já recusou.

## Cadeia de RLS
**Achado crítico da auditoria de 2026-09-13**: `leads` nunca teve RLS habilitada (ver [[Segurança - Auditoria Supabase (RLS e Banco)]]). Corrigida: `is_portal_admin()` obrigatório.

## Tela — filtros e UI
Cabeçalho com ordenação real por coluna + filtro próprio (`OpcoesFiltro`). Coluna CIDADE. Dois selects (segmento/categoria) substituíram 7 linhas de chips. Segmento "POST nn - nnA EDICAO" é dado cru da importação Click Rua (coluna Edição mapeada errado), não bug de tela.

## Abordagem — ver nota dedicada
Fluxo de "💬 Abordar", template, confirmação de entrega e opt-out: [[WhatsApp - IA, Follow-up e Leads]].

---
## Ver também
[[WhatsApp - IA, Follow-up e Leads]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Performance - Índices, RPCs e Paginação]]

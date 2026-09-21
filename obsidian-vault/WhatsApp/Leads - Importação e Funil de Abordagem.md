---
tags: [leads, importação, portal, funil]
---

# Leads — Importação, Estrutura e Funil

## Performance da tela (2026-08-29, ~61 mil linhas)
Relato do usuário: "creio que pq tem 60k+ leads, a pagina nao carrega". Portal v=20260909g, SEM SQL. Três causas empilhadas, as três corrigidas:

- **`buscarTudo` paginava em SÉRIE e tinha teto de 50.000** — parava em silêncio na página 50 (o teto saiu; ele segue existindo, sem teto, pras listas menores). `buscarEmPaginas` (marcadores `[teste:paginas-*]`): 1ª página com `count:'exact'`, as outras 4 em paralelo, cada lote na SUA posição (`paginas[n]`), `aoChegar(parcial,total)` a cada lote e `cancelado()` pra parar quando a tela fecha. **A consulta ordena por `created_at` E `id`**: lote de importação inteiro tem o mesmo carimbo, e paginar por `created_at` sozinho repete/pula linha entre páginas.
- **A tela esperava a ÚLTIMA página.** Agora a 1ª pinta e tira o "Carregando"; o resto entra a cada ~600ms (`comIntervalo`, senão 60 lotes = 60 refiltragens de 61 mil) com "⏳ carregando N de M" no KPI. Cache em memória (`_leadsCache`) + botão ↻; importação recarrega.
- **Um `<tr>` por lead travava o navegador.** Janela de `LEADS_JANELA` (100) linhas da lista filtrada, sentinela por IntersectionObserver e "Mostrando X–Y de Z". **Com TETO (Codex no #291, corrigido no #292):** a sentinela cresce só até `LEADS_BLOCO` (500); daí é "próximos 500 ›", que DESMONTA o bloco anterior (`janelaDeLeads`, pura). O prefixo que só crescia (receita do catálogo de produtos) remontaria as 61 mil linhas de quem rolasse a lista inteira — o catálogo tem o mesmo desenho e 21 mil cards; se incomodar lá, é a mesma função.
- **Recarga total virou EMENDA** (`emendarLeads`, por id, devolve a MESMA lista se nada mudou): `updateStatus` emenda a linha, e o poll de 20s + pós-envio usam `leadsService.recentes` (leads com `abordagem_at` nas últimas 6h, PAGINADO sem teto — um lote pode passar de mil) em vez de baixar tudo de novo — o webhook escreve `abordagem_at` a cada status, então a janela pega o que muda.
- **Busca do topo acha por TELEFONE (2026-09-09):** `buscaDeLead(q)` — consulta que é só número (com ou sem máscara) casa pelos dígitos do telefone; texto segue em nome/segmento/categoria/bairro/@. "Rua 402" NÃO vira busca de telefone (endereço com número traria lead errado). Consulta com DDI 55 também é tentada sem ele — a base guarda o telefone como veio da planilha, com ou sem +55 (achado do Codex, PR #294). Portal v=20260909l.
- Busca com 250ms de atraso; ordenação por texto com `Intl.Collator` (o `localeCompare` monta um collator por comparação — segundos por ordenação em 61 mil linhas). Testes em `__tests__/portalLeadsJanela.test.ts`; o teste de abordagem já cobria `selecionados`.
- **Custo conhecido:** segue `select('*')` (o aviso `semColunaAbordagem` depende de ver as colunas), então a carga completa baixa dezenas de MB — só que agora em paralelo e sem travar a tela.

## Cabeçalho da tabela: ordenação e filtro reais (2026-08-29, v=20260829q)
As setas "↕" eram DECORATIVAS — o header era `['NOME ↕', …].map()`. Fix: cada coluna ordena de verdade (`ThLead`/`ordenarPor`, clique inverte) e tem filtro próprio no "▾" (`OpcoesFiltro`): Nome e Telefone por texto, Cidade/Segmento/Categoria/Prioridade/Status por lista com contagem, Rating por nota mínima. Coluna **CIDADE** nova na tabela (o endereço desceu pra linha de baixo do nome). O select "Ordenar" do topo saiu (virou redundante) e no lugar entrou "✕ Limpar N filtros", que só aparece com filtro ativo. Segmento/Categoria/Status do header escrevem nos MESMOS states dos chips do topo — uma fonte de verdade só.

## Leads: chips de segmento/categoria viraram dois selects (2026-09-08, v=20260908e)
Pedido do usuário: "não precisa mostrar todos esses ícones, apenas um campo com dropdown". Com 1464 leads na época e segmentos vindos de planilha ("POST 11 - 69A EDICAO"…) os chips eram sete linhas de botão empurrando a tabela pra baixo da dobra. Os selects escrevem nos MESMOS states dos filtros do cabeçalho da tabela. Os segmentos "POST nn - nnA EDICAO" e as categorias numéricas ("68", "67") são DADO da importação da Click Rua (coluna Edição mapeada errado), não bug de tela — corrigir é UPDATE no banco, proposto no chat e não rodado.

## Importação de planilha

### "Busca AI" REMOVIDO, importador de planilha no lugar (2026-08-29, portal v=20260829o)
O botão "✨ Busca AI" NÃO buscava nada de verdade: mandava o modelo INVENTAR empresas plausíveis (nome, telefone, nota, avaliações) e salvava como lead `source='ai_search'`. Telefone inventado em formato válido é o telefone de alguém — e com o botão "💬 Abordar" ao lado, viravam mensagem pra estranho. A base tinha 0 `ai_search` (os 88 originais são `captacao`), então nada a limpar.

No lugar entrou **"📥 Importar planilha"** (`ImportarPlanilhaModal`): lê CSV (xlsx é ZIP+XML e exigiria biblioteca; o portal não tem bundler), **detecta separador `;`/`,`/tab e re-decodifica em windows-1252** quando o UTF-8 falha (Excel pt-BR salva ANSI e com ponto-e-vírgula — sem isso vem tudo numa coluna ou com acento quebrado), casa as colunas sozinho por nome de cabeçalho com correção manual, mostra prévia, deduplica pelos 8 últimos dígitos do telefone e grava em lotes de 200 com `source='planilha'`.

### Importação de 986 leads do Google Maps (2026-08-29)
`/migrations/2026-08-29-import-leads-planilha.sql`. **JÁ IMPORTADOS** — confirmado pelo usuário em 2026-09-05 ("já importamos esses leads, estão no BD"); o portal mostra **1072 leads** (988 base original + 986 novos, menos duplicatas). Não pedir pra rodar, não listar como pendência.

- **Lição de processo (registrada explicitamente no CLAUDE.md):** uma anotação anterior dizia "NÃO RODADA, confirmado no banco" e estava ERRADA. A verificação procurou `source='planilha'` e não achou — mas a importação aconteceu por outro caminho, ou depois da consulta. Ou seja: **nem uma verificação pontual imuniza a anotação**, porque ela envelhece a partir do instante em que foi escrita. Mesmo padrão das 7 pendências falsas achadas na varredura de 2026-09-05 (ver [[Convenções Gerais de Desenvolvimento]]). Quando o usuário diz que algo está feito, ele ganha da anotação escrita — ele vê o banco, o arquivo não.
- Da planilha de 1000 do usuário: 13 telefones repetidos + 1 sem telefone ficaram fora. Categoria crua do Maps ("Architect", "Closed") traduzida pras chaves de `LEAD_PITCH`; segmento vence quando a categoria briga com ele; "Região" separada em cidade × bairro (696 linhas traziam o TERMO DE BUSCA, tipo "arquiteto Osasco SP", não região de fato); prioridade pela distância (alta = Guarulhos + vizinhos, 422 leads; media = metropolitana, 311; baixa = interior, 253). `LEAD_PITCH` ganhou a chave **'Engenharia'** (funil `fornece`) — 234 leads caem nela.

### Importador aceita Excel direto (.xlsx/.xls/.xlsm/.ods) — 2026-09-09
Pedido do usuário. Portal v=20260909e, SEM SQL. O portal não tem bundler, então o SheetJS (xlsx 0.18.5, Apache-2.0, ~880 KB) vive VENDORADO em `public/portal/xlsx.full.min.js`, como o React, e é carregado por `<script>` dinâmico com SRI **só quando a pessoa escolhe um Excel** (`carregarXlsx`) — a tela de leads não paga isso no boot. O CSV segue no parser nosso (separador `;`/`,` + windows-1252). Só a PRIMEIRA aba é lida.
- **Célula numérica vira `String(v)`**, nunca o texto formatado do Excel: telefone em coluna estreita sai "1.19877E+10" no `w` da célula, e o `raw:true` + conversão própria evita isso.
- **Trocou o arquivo vendorado? Trocar `XLSX_SRI` no `app.jsx`.** Hash errado = o navegador recusa o script em silêncio e a tela diz "não consegui carregar o leitor de Excel". `__tests__/portalImportarExcel.test.ts` confere o hash contra o arquivo real no CI.

### "Perfil do IG" + Estado — importação dos grafiteiros da Click Rua (2026-09-08)
SQL `/migrations/2026-09-08-leads-instagram.sql` (duas linhas: `leads.instagram text` e `leads.state text`) — executado (2026-09-08, informado pelo usuário). A planilha "Revista Click Rua — Diretório de Artistas" (Edição, Nome, Perfil do IG, Cidade, Estado) vem quase toda SEM telefone: o canal desses leads é o Instagram.

- **Importador do portal (v=20260908a): Nome + (Telefone OU Perfil do IG).** Duplicata = mesmo telefone (8 últimos dígitos) OU mesmo @ (`normalizarIg` tira "@", "instagram.com/" e barra final). Quem não tem nenhum dos dois fica de fora, com contagem no relatório. Planilha sem coluna Segmento ganha um select "usar pra todas as linhas" — escolha explícita, nunca chute; GRAFFITI põe a categoria `Graffiti/Arte` (a única desse funil).
- **Tolera as colunas ausentes**: INSERT com 42703 em `instagram|state` é refeito sem as duas e o relatório avisa em laranja pra rodar o SQL e importar de novo (as linhas entram, mas sem @ e UF). Recurso novo não derruba o que já funciona por SQL pendente.
- **Tabela: coluna "PERFIL DO IG"** (link pro perfil) e, pra lead sem telefone, o botão da ação vira **"📸 Abrir IG"** — "Abordar" é template de WhatsApp e não faz sentido ali. Busca do topo também acha pelo @.
- Build do portal conferido byte a byte antes de mexer (recipe padrão do repo, `@babel/preset-react` instalado com `--no-save`).

## Colunas e schema
`leads` nasceu fora do repo (sem `CREATE TABLE`, só `ALTER TABLE` incrementais) — **regra: conferir schema real antes de escrever INSERT/UPDATE em `leads`** (a lista de colunas do código não bate com a tabela); já custou incidentes.

- **`city`/`neighborhood`: PEGADINHA descoberta em 2026-08-29** — `leads` NÃO tinha essas colunas. O portal lê `l.neighborhood || l.city` em 4 lugares (todo lead mostrava "—" embaixo do nome) e o antigo Busca AI também mandava as duas no INSERT — o banco recusava com 42703 e o erro era engolido. A migration de importação (`2026-08-29-import-leads-planilha.sql`) criou as duas colunas antes de inserir.
- **`instagram`/`state`**: para leads de grafiteiros (Click Rua, sem telefone — canal é Instagram). Tolerado se ausente (fallback sem as colunas).
- **`status='fixo (sem WhatsApp)'`** (2026-09-09): boa parte dos 90 "não entregue" do incidente de entrega era telefone fixo — template nunca chega, mas o lead não é "perdido" (pode valer por outro canal). `LEADS_STATUS` virou a lista ÚNICA (select da linha, filtro do topo, filtro do cabeçalho, contagens); o teste proíbe lista escrita à mão voltar. Lead `fixo` sai da seleção em lote; o "Abordar" unitário segue disponível (fixo pode ter WhatsApp Business). **A tabela `leads` nasceu fora do repo e não dá pra saber se `status` tem CHECK**: `/migrations/2026-09-09-leads-status-fixo.sql` é conferência (lista os CHECKs) + ALTER comentado; o portal traduz o 23514 apontando pra esse arquivo. **CONFERIDO NO BANCO (2026-09-09): a consulta de `pg_constraint` voltou ZERO linhas — `leads` não tem CHECK nenhum.** O ALTER comentado não é pendência; o arquivo fica como conferência.
- **`opted_out_at`** (2026-09-06): opt-out próprio de leads (independente de `whatsapp_ai_state.opted_out`) — sem ela, botão "Abordar" seguia oferecendo contato de quem já recusou. Ver [[WhatsApp - IA, Follow-up e Leads]] para o fluxo completo de opt-out via quick reply.
- **`abordagem_message_id`/`abordagem_status`/`abordagem_error`/`abordagem_at`** (2026-09-09): rastreiam a confirmação de entrega da Meta pra abordagem — detalhe completo, incluindo por que o status "contactado" não pode ser escrito na aceitação da API, em [[WhatsApp - IA, Follow-up e Leads]].

## Cadeia de RLS
**Achado crítico da auditoria de 2026-09-13**: `leads` nunca teve RLS habilitada (ver [[Segurança - Auditoria Supabase (RLS e Banco)]]). Corrigida: `is_portal_admin()` obrigatório em todas as operações.

## Abordagem — fluxo completo em nota dedicada
Botão "💬 Abordar", template de abordagem, variáveis `{{1}}`/`{{2}}`/`{{3}}`, confirmação de entrega, abordagem em lote e opt-out: [[WhatsApp - IA, Follow-up e Leads]].

---
## Ver também
[[WhatsApp - IA, Follow-up e Leads]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Performance - Índices, RPCs e Paginação]] · [[WhatsApp - Portal e Mídia]]

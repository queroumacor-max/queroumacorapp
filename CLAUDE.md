# Estado do projeto / convenções (não perguntar de novo)

- **AUDITORIA DOS "19 PONTOS" — itens nunca auditados (2026-09-26, pedido
  do usuário). CORRIGIDO NO CÓDIGO (ver sub-item); os 3 SQLs JÁ RODADOS e conferidos.**
  - **Os 3 SQLs TESTADOS em Postgres 16 local (2026-09-26), cada um rodado
    2x:** RPC do Financeiro (dono soma, negativo trava em 0, job alheio não
    muda, anon sem EXECUTE); CHECKs recusam `javascript:`/`data:`/texto
    longo. **Achado no teste e corrigido:** CHECK NOT VALID + linha ANTIGA
    fora da regra = todo UPDATE nela falha (uma mensagem legada >4000
    travaria `mark_conversation_read` e o soft delete da conversa inteira).
    Agora cada CHECK é PULADO (NOTICE "PULADO …") quando há linha antiga
    violando — a conferência final lista menos constraints nesse caso.
    Cruzada a
  lista de 19 pontos com este arquivo: 14 já cobertos por auditorias
  anteriores; auditados agora 2 (validação front), 9 (clique duplo), 10
  (CSRF), 12 (vazamento de info), 18 (cookies).
  - **CORRIGIDO NO CÓDIGO (2026-09-26, pedido "corrija"; branch
    `claude/verificar-edicoes-memoria-sm9dzg`, NO AR desde o deploy #753).** Suíte
    220/220 arquivos, 2589 testes, `tsc` e `next build` verdes. Portal
    v=20260926a (`urlSegura` nos hrefs, trava no Criar Produto, app.js
    recompilado + SRI); `next-app/public/_headers` com frame-ancestors/XFO
    pra `/portal` (sem script-src — CSP completa do portal segue pendente);
    `script-src` do jsdelivr restrito a pdfjs/mediapipe/eruda, `onrender`
    fora do connect-src; `lib/errors.ts` troca mensagem técnica crua por
    texto amigável (crua em `.raw`/`cause`); IA/ig-art/401/403/envs sem
    detalhe na resposta; cadastro sem enumeração; logs do WhatsApp sem
    texto/telefone; `useSingleFlight` + travas em loja/publicar/financeiro/
    obras; `signOut` limpa sessão local mesmo offline; cookie de sessão 30
    dias; set-session-cookie exige JSON + Origin + SameSite=Strict; chat
    maxLength 4000; mídia de terceiro no chat vira link; `safeHttpUrl`.
    **3 SQLs RODADOS pelo usuário (2026-09-26, "rodei tudo")** —
    `2026-09-26-brand-logos-https-check.sql`,
    `2026-09-26-financeiro-increment-cost.sql`,
    `2026-09-26-content-length-and-link-checks.sql`. **CONFERIDO no banco
    (2026-09-26):** RPC do Financeiro existe + anon sem EXECUTE +
    `brand_logos_image_url_https` = true (SQL 1 e 2 APLICADOS). As 6
    constraints do SQL 3 = false — só a pré-conferência tinha sido colada
    no chat; o resto do arquivo (3 UPDATEs + 6 DO) foi passado depois.
    **SQL 3 CONFERIDO APLICADO (2026-09-26): as 9 linhas da conferência
    combinada voltaram `true`** (RPC, anon sem EXECUTE e as 7 constraints —
    nenhuma pulada por legado). **Os 3 SQLs de 26/09 estão TODOS no banco.
    Não pedir pra rodar de novo.** **CÓDIGO NO AR: PR #412 (squash
    `5810283`) + deploy run #753 do `deploy.yml` terminou `success`
    (2026-09-26).** O Codex achou 2 P2 no PR, corrigidos antes do merge:
    mídia confiável no chat agora exige o host EXATO do projeto
    (`NEXT_PUBLIC_SUPABASE_URL`) + `/storage/v1/object/` (qualquer
    `*.supabase.co` deixava Edge Function de outro projeto rastrear IP), e
    `mascararTelefones` pega telefone formatado no log do Dualhook.
    **Não feito:** CSP com script-src no portal. (A chave de idempotência
    do pedido da loja foi feita depois — ver entrada logo abaixo.) **TESTADO EM PRODUÇÃO PELO USUÁRIO
    (2026-09-26, depois do deploy #753: "testado") — nenhuma falha
    relatada.** **Confirmado pelo usuário: portal e tela de AR OK**
    (os dois pontos de maior risco — CSP do jsdelivr restrito e
    `_headers`/`urlSegura` do portal). Caso fechado.
  Achados originais, por gravidade:
  - **ALTO (cadeia):** `/portal` servido pelo binding ASSETS do OpenNext
    NÃO passa pelo middleware → **sem CSP e sem X-Frame-Options** (nenhum
    `_headers` nem meta CSP em `public/`), e `public/portal/app.jsx:1866`
    faz `href={item.image_url}` cru — `brand_logos.image_url` é gravável
    pelo pintor via REST (sem CHECK) e o portal é React 18. Pintor grava
    `javascript:` → admin clica "Abrir" em Camisetas → XSS com sessão de
    admin. Fix: filtrar `^https://` no href + CHECK no banco + `_headers`
    com CSP/`frame-ancestors 'none'` pra `/portal/*`.
  - **ALTO:** `toFriendlyError` (`lib/errors-friendly.ts`) só é usado no
    `UndoSnackbar` — ~60 telas mostram `error.message` cru do Postgres
    (nome de tabela/policy). Bloqueado vê "violates row-level security"
    ao mandar mensagem/comentar: exatamente o que o pentest de 18/09
    queria esconder (o registro de lá afirmava o contrário).
  - **MÉDIO:** corpo de erro da OpenAI/Gemini chega ao usuário (`_ai.ts`
    → Alice/Fê/Senna, `ig-art` `detail`); cadastro mostra "User already
    registered" (enumeração de e-mail); webhook do WhatsApp loga 60 chars
    do texto do cliente; clique duplo sem trava em pedido da loja (checagem
    de duplicata não-atômica em `mkt.ts`), publicar post (`publish.reset()`
    antes de mutate), Financeiro (`incrementCost` ler-e-regravar),
    gasto de obra, "Criar Produto" do portal (zero trava); `signOut` sem
    rede não apaga a sessão local (aparelho compartilhado); cookie
    `sb-*-auth-token` guarda refresh token + `user` por 400 dias;
    `script-src` libera `cdn.jsdelivr.net` inteiro sem `strict-dynamic`;
    `messages/posts/comments` sem CHECK de tamanho (chat sem maxLength).
  - **BAIXO:** login CSRF em `/api/auth/set-session-cookie` (sem checagem
    de Origin/Content-Type; impacto só nas páginas /admin); 401/403 citam
    nomes de env e mecanismo de admin; imagem de terceiro no chat vaza IP.
  - **CSRF limpo no resto:** nenhuma rota de API autentica por cookie,
    sem Server Actions, CORS restrito — imune por arquitetura.

- **LOJA: CHAVE DE IDEMPOTÊNCIA NO PEDIDO (2026-09-26, pedido do usuário,
  pendência que sobrou da auditoria dos 19 pontos).** SQL
  `/migrations/2026-09-26-orders-idempotency-key.sql` — **JÁ EXECUTADO no
  Supabase (2026-09-26, informado pelo usuário: "rodei o sql"). Não pedir
  pra rodar de novo.** (O resultado da conferência de 3 `ok` não foi colado
  no chat — reconferir por ela antes de afirmar algo sobre o índice.)
  Testado em Postgres 16 local rodando 2x: mesma chave do mesmo usuário →
  23505; outro usuário com a mesma chave passa; pedido sem chave (NULL)
  nunca conflita; chave >100 chars recusada.
  - **O buraco que fecha:** a trava da tela (`useSingleFlight`) só cobre o
    toque repetido, e a checagem por assinatura do carrinho em
    `submitOrder` é ler-e-gravar (duas tentativas quase juntas passam as
    duas). O caso real: o pedido É gravado, a resposta se perde na rede, a
    tela mostra erro e a pessoa toca de novo → segundo pedido.
  - `lib/services/orderIdempotency.ts`: chave por (usuário, assinatura do
    carrinho), guardada no localStorage (sobrevive a recarregar a página;
    cai pra memória se o storage falhar), vale 1h e é ESQUECIDA quando o
    pedido é confirmado — pedir de novo depois é intencional.
  - `submitOrder` manda `idempotency_key` no INSERT; 23505 → busca o
    pedido pela chave e devolve ele (sem achar → erro, nunca sucesso
    inventado). Coluna ausente (42703/PGRST204) → refaz o INSERT sem a
    chave: o pedido não deixa de sair por SQL pendente. A checagem antiga
    por assinatura continua como primeira camada.
  - Testes novos em `__tests__/services/mkt.test.ts` (5). Suíte 221/221
    arquivos, 2599 testes, `tsc` e eslint verdes.
  - **Achado do Codex no PR #417 (P2), corrigido antes do merge:** duas
    ABAS com o mesmo carrinho liam o storage antes de qualquer uma gravar,
    geravam chaves diferentes e as duas passavam. `submitOrder` agora roda
    sob `comTravaEntreAbas('order-submit:<uid>')` (Web Locks API, exclusiva
    por origem): a 2ª aba só começa depois da 1ª e cai na checagem de pedido
    recente. Sem Web Locks roda direto. Teste
    `__tests__/services/orderIdempotencyLock.test.ts`. Suíte 222/222, 2601.
  - **CÓDIGO NO AR: PR #417 (squash `973cf69`) + deploy run #754 do
    `deploy.yml` terminou `success` (2026-09-26).** O SQL foi rodado depois do
    deploy (ver acima) — a chave passa a valer a partir daí.

- **GESTÃO DE OBRAS: acesso do CLIENTE (2026-09-25, pedido do usuário:
  "tem com colocar para o cliente tbm... progresso, quem vai, o que ata
  sendo feito, agenda"). PR #410 (squash `49fea6d`), deploy run #752 do
  `deploy.yml` terminou `success`, código NO AR. SQL
  `/migrations/2026-09-25-obra-cliente.sql` — **JÁ EXECUTADO no Supabase
  (2026-09-26, confirmado pelo usuário: as 3 linhas de conferência
  voltaram `ok=true` — `obras.client_id` existe, trigger de proteção do
  vínculo existe, anon sem EXECUTE nas RPCs do cliente). Não pedir pra
  rodar de novo.** Feature 100% ativa em produção: coluna/RPCs/triggers
  no banco + código já no ar desde o deploy #752.
  - **Decisão (perguntado ao usuário):** o cliente acessa **logado no
    app** — precisa ter conta e o gestor vincula pela @tag. Não é link
    público sem login (mesmo padrão de segurança do resto do app, RLS/
    RPC). Diferente do convite de EQUIPE (que exige aceite, porque
    implica obrigação de trabalho), o vínculo de cliente segue o mesmo
    precedente de `quotes.client_id`: o gestor vincula direto, sem passo
    de aceite — o cliente já sabe que contratou o serviço.
  - **`obras.client_id`** (nullable, FK profiles). Trigger
    `protect_obra_cliente` (defesa em profundidade, cobre PATCH direto
    via REST): só quem tem e-mail confirmado vincula, nunca vincula
    gente bloqueada (`blocked_between`), rate limit 20/60min, e o gestor
    não pode se vincular como cliente da própria obra. Aviso no sininho
    (`obra_cliente_vinculo`) quando vinculado.
  - **O CLIENTE NUNCA lê `obras`/`obra_equipe`/`obra_escala` direto** —
    só por 3 RPCs SECURITY DEFINER: `minhas_obras_cliente()` (status,
    endereço, datas, gestor — nunca valor nem observações),
    `obra_equipe_cliente(obra_id)` (nome+função de quem foi ESCALADO
    nessa obra — equipe não é "da obra", é do gestor; quem trabalha ali
    é definido pela escala — nunca telefone/diária) e
    `obra_agenda_cliente(obra_id, de, ate)` (dia, horário, tarefa,
    presença, quem vai — janela de até 62 dias, mesmo teto do
    `minha_agenda_obras` do funcionário).
  - **App**: aba nova "Meu progresso" em Gestão de Obras
    (`app/obras/MeuProgresso.tsx`) — vê SUAS obras vinculadas, entra e
    vê status/equipe/agenda. Notificação linka `/obras?aba=cliente`
    (mesmo padrão do `?aba=agenda` do funcionário — a aba fica sempre
    visível, não é gated por role, porque quem recebe o vínculo pode não
    ser cliente "profissionalmente"). Aba **Obras** do gestor ganhou
    seção "Cliente acompanha pelo app" (vincular/remover por @tag,
    `vincularCliente` em `lib/services/obras.ts`).
  - **`Obra.client_id` tolera coluna ausente** (42703) nos dois pontos
    que selecionam a linha inteira (`listObras`/`salvarObra`) — mesmo
    padrão de `jobs.categoria`/`obra_id` no Financeiro: recurso novo não
    derruba o que já funciona por SQL pendente.
  - Testes: bloco novo em `__tests__/obras.test.ts` (SECURITY DEFINER com
    search_path, e-mail confirmado + bloqueio + rate limit no vínculo,
    trava contra auto-vínculo, RPCs sem GRANT pra anon, RPCs nunca
    selecionam `valor`/`observacoes`, agenda/equipe sempre filtram por
    `client_id = auth.uid()`). Suíte inteira (211/211 arquivos, 2533/2533
    testes) e `tsc --noEmit` verdes antes do commit.

- **GESTÃO DE OBRAS: tile também pra grafiteiro e funileiro (2026-09-25,
  pedido do usuário). SEM SQL.** `visibleTiles` do `BusinessGrid.tsx` só
  liberava o tile 🏗️ pra `role==='pintor'` (+ admin) — a ferramenta em si
  (obras/equipe/escala) não é específica de pintura. Ampliado pra
  `grafiteiro` e `automotivo` (funileiro) também. PR #407 (squash
  `c8292703`), **deploy run #750 do `deploy.yml` terminou `success`, NO
  AR.**
  - **Ainda não confirmado no aparelho**: falta o usuário abrir o app numa
    conta pintor de verdade e confirmar que as 4 abas (Obras/Equipe/Escala/
    Minha agenda) funcionam ponta a ponta com o SQL da entrada abaixo já
    rodado — a suíte local só prova a lógica pura e as regras do SQL, não
    a experiência real.

- **GESTÃO DE OBRAS + GASTOS POR CATEGORIA + QUOTES SÓ-PINTOR (2026-09-24,
  pedido do usuário + sugestões do pintor Léo). SQL em 3 arquivos, NESTA
  ORDEM: `/migrations/2026-09-24-a-quotes-update-so-pintor.sql`,
  `…-b-gestao-obras-tabelas.sql`, `…-c-gestao-obras-funcoes.sql` —
  **JÁ EXECUTADAS no Supabase (2026-09-26, confirmado pelo usuário: as
  conferências no fim de cada arquivo voltaram `ok=true` — policy
  `quotes_update_painter`, tabelas `obras`/`obra_equipe`/`obra_escala` com
  RLS, `jobs.categoria`/`jobs.obra_id`, e o trigger `trg_protect_obra_equipe`
  + as RPCs do funcionário `meus_convites_equipe`/`responder_convite_equipe`/
  `sair_da_equipe`/`minha_agenda_obras`/`confirmar_presenca_obra`/
  `enviar_escala_obras`). Não pedir pra rodar de novo.** Testados ponta a
  ponta num Postgres 16 LOCAL com stubs do Supabase (34 testes de ataque e
  fluxo, idempotência conferida rodando 2x) antes de ir pra produção.
  - **A:** derruba toda policy de UPDATE de `quotes` e recria
    `quotes_update_painter` (pintor ou admin). Fecha o furo do cliente
    alterando preço/`quote_data`/status via REST. Nenhum fluxo do app
    escrevia em `quotes` como cliente (mapeado antes).
  - **B/C:** `obras` (dono), `obra_equipe` (gestor; `membro_id` = usuário
    do app ou NULL pra funcionário sem conta, com telefone e diária),
    `obra_escala` (obra × pessoa × dia, presença). O FUNCIONÁRIO não tem
    policy em nenhuma tabela — só RPC SECURITY DEFINER que devolve o
    necessário (nunca valor da obra, observações nem diária de colegas).
    Trigger `protect_obra_equipe`: gestor nunca coloca usuário do app como
    "ativo" (só o aceite dele), não troca dono/membro depois, convite exige
    e-mail confirmado, respeita `blocked_between`, teto de 100 pessoas e
    rate limit 20/h (também no reconvite). Escala só com gente ATIVA da
    própria equipe. `enviar_escala_obras` = 1 aviso por pessoa (não por
    dia) + lista dos sem-conta pro app abrir o WhatsApp. `jobs.categoria`
    (CHECK) + `jobs.obra_id`/`notes.obra_id` com trigger `check_obra_link`
    (só obra do próprio dono).
  - **App:** tile "🏗️ Gestão de Obras" (só pintor/admin) + rota `/obras`
    (`?aba=agenda`, destino dos avisos `obra_convite`/`obra_escala` — o
    funcionário pode não ser pintor). Abas Obras (criar/editar, vincular
    orçamento, detalhe com custos por categoria → Financeiro, mão de obra
    ESTIMADA pela escala × diária quando não lançada, anotações da obra,
    como chegar), Equipe, Escala (semana seg–sáb, enviar) e Minha agenda
    (convites, confirmar presença). Sem o SQL, a tela mostra quais
    arquivos rodar (`ObrasSqlPendenteError`), nunca erro cru.
  - **Financeiro:** categoria virou SELECT fixo (texto livre gerava
    "Material"/"material"/"Materiais"); grava na coluna E no prefixo antigo
    do `service_type` (funciona antes do SQL); card "Gastos por categoria"
    completo só PRO, resumo pra todos (regra pedida pelo Léo). Select/insert
    de `jobs` tolera 42703 (coluna ausente) — o Financeiro não cai por SQL
    pendente.
  - Testes: `__tests__/obras.test.ts` (lógica + guardas estáticas do SQL:
    RLS, `(SELECT auth.uid())`, colunas qualificadas, search_path, anon).
  - **Deploy run #748 do `deploy.yml` (commit `bb27d1c`, a pedido do
    usuário) terminou `success`: Frete (#403), rolagem do pipeline (#404) e
    editar/duplicar/modelo (#405) NO AR.** Esta entrada (Gestão de Obras,
    PR #406) precisa de OUTRO deploy depois do merge + o SQL a/b/c.

- **ORÇAMENTO: EDITAR, DUPLICAR e MODELO ⭐ (sugestões do pintor Léo,
  2026-09-24). SEM SQL.** O assistente já gravava o formulário INTEIRO em
  `quote_data` (`...form`); `lib/orcamentoModelo.ts`
  (`formularioDeQuoteData`, testado em `__tests__/orcamentoModelo.test.ts`)
  faz o caminho de volta. Detalhe do orçamento (só pro DONO) ganhou
  "✏️ Editar" (`/orcamento-ia?base=<id>&modo=editar`, grava por cima via
  `updateQuoteContent` — `.select('id')` + erro em zero linhas; preserva a
  marca de modelo; não toca status nem `scope_snapshot`; pede confirmação
  se já aprovado), "📑 Duplicar" (copia tudo MENOS cliente, endereço,
  visita e número — nada de dado pessoal do cliente anterior vai pra
  cópia) e "☆ Usar como modelo" (`quote_data.modelo=true`, um por pintor,
  `setQuoteModelo`). Orçamento novo do zero mostra "⭐ Começar do seu
  modelo". **De brinde: "Gravar" duas vezes criava DOIS orçamentos no
  pipeline — agora o segundo atualiza o primeiro.** `FormState` do wizard
  mudou-se pra `FormularioDoOrcamento` na lib. `?base` validado por regex.
  - **ACHADO DE SEGURANÇA PRÉ-EXISTENTE — FECHADO (2026-09-26, verificado
    contra o código e o banco, sem SQL novo).** A policy "Users can update
    own quotes" (`USING/WITH CHECK client_id OR painter_id`) que deixava o
    CLIENTE alterar `price`/`quote_data`/`status` via PATCH direto no REST
    **já não existe**: a migration `2026-09-24-a-quotes-update-so-pintor.sql`
    (rodada no mesmo dia, ver entrada "GESTÃO DE OBRAS + GASTOS POR
    CATEGORIA…" acima) derrubou TODA policy de UPDATE de `quotes` e recriou
    só `quotes_update_painter` (painter_id OU admin) — **conferido no banco**
    que essa é a ÚNICA policy de UPDATE/ALL na tabela. Reli
    `approveQuote`/`rejectQuote`/`setQuoteStage` em `lib/services/pipeline.ts`:
    os três SEMPRE filtram `.eq('painter_id', painterId)` — nenhum fluxo do
    app escreve em `quotes` como cliente (aprovar/recusar pelo cliente é link
    `wa.me` pro pintor, nunca grava na tabela). Ou seja: o fix da migration
    `a` já fechou este achado por completo, sem quebrar nenhum caminho
    legítimo — não precisou do trigger proposto. Comentário desatualizado em
    `pipeline.ts` (linha 13, ainda descrevia "UPDATE por client_id OR
    painter_id") corrigido junto.

- **PIPELINE "NÃO ROLA / NÃO VOLTA" (relato do pintor Léo, 2026-09-24).
  SEM SQL. Não reproduzido no aparelho dele — correções pelas causas
  prováveis achadas no código:** (1) o app ESCONDE a barra de rolagem em
  todo lugar (`globals.css`), e no COMPUTADOR isso tira a única pista de
  que a tela rola — agora, com mouse (`@media (pointer: fine)`), `<main>`
  e o corpo do BottomSheet (classe nova `.sheet-body`) mostram barra fina;
  no celular segue escondida. (2) `/orcamentos/[id]`: "← Voltar pro
  pipeline" ficava só no topo; virou barra `sticky` sempre visível.
  (3) BottomSheet: a trava de `touchmove` cancelava o gesto quando o corpo
  não transbordava, prendendo roláveis INTERNOS — `temRolavelInterno`
  libera. Teste `__tests__/components/BottomSheetRolagem.test.ts`. Pedir
  pro Léo confirmar se resolveu (e se usa PC ou celular).
  **Frete (#403) MERGEADO (squash `23dff6c`); rolagem (#404) MERGEADO
  (squash `34725d2`).**

- **TILE "FRETE" (2026-09-24, pedido do usuário: "cálculo de frete, KM por
  litro vs valor do litro"). SEM SQL.** `lib/frete.ts` (`calcularFrete`,
  puro, testado em `__tests__/frete.test.ts`) + `app/frete/FreteView.tsx`
  (sheet no BusinessGrid, ao lado da Calculadora; visível pra todo papel
  MENOS cliente). Distância × ida/volta × viagens ÷ km/L × preço do litro +
  pedágio/estacionamento por viagem; mostra km, litros, custo por km e por
  viagem, e copia o texto pro orçamento. Dado faltando → "preencha", nunca
  R$ 0,00. Nada é gravado (só cálculo); passo novo no tour (`p-frete`).
  - **EM ABERTO, planejado e NÃO feito (aguardando OK do usuário):**
    (1) **Gestão de Obras** (tile pintor): protótipo em
    https://claude.ai/artifact/XoADjescHo2T7Ww8ULs6fU — obras, equipe
    (convite por @tag ou funcionário sem conta via WhatsApp), escala
    semanal, agenda do funcionário. Usuário pediu que seja LIGADA aos tiles
    Financeiro, Orçamento, Agenda e Anotações (e o Frete entra como custo da
    obra). Precisa de SQL novo (obras/obra_equipe/obra_escala).
    (2) **Sugestões do pintor Léo Pinheiro** (via WhatsApp do usuário):
    orçamento mestre como modelo + "Duplicar"; "Editar" orçamento gravado;
    BUG: no pipeline/detalhe do orçamento não consegue rolar nem voltar
    (todas as abas) — não reproduzido ainda; Financeiro com categorias de
    gasto (funcionários, veículos, transporte) — ele sugere resumido no
    FREE e detalhado no PRO.

- **LIMPEZA DO BANCO (2026-09-24, conferido pelo usuário no SQL Editor).**
  (1) Policies de SELECT de `follows`/`likes`/`qualifications`/`courses`:
  UMA por tabela (`*_select_auth`, `{authenticated}`) — as antigas "…
  viewable by everyone" já não existem. Nada a fazer. (2) Cron: 10 jobs,
  2 DUPLICADOS — `cleanup-audit-events` = `cleanup-old-audit-events` e
  `cleanup-notifications` = `cleanup-old-notifications` (mesmo comando e
  horário; vinham das migrations de observability e de privacidade de
  09-17). SQL `/migrations/2026-09-24-cron-dedupe.sql` desagenda as cópias
  — **JÁ EXECUTADO no Supabase (2026-09-24, conferido: 8 jobs, 1 por
  comando, o 2 `unschedule` voltaram true). Não pedir pra rodar de novo.** A migration de
  observability foi alterada no repo pra usar os nomes `cleanup-old-*`,
  então re-rodar qualquer uma das duas não duplica de novo.

- **3 MIGRATIONS "SEM REGISTRO DE EXECUÇÃO" CONFERIDAS NO BANCO — TODAS
  APLICADAS (2026-09-24, pelo usuário no SQL Editor).** A consulta de
  conferência combinada (as 22 checagens dos blocos de conferência dos
  próprios arquivos, filtrada por `WHERE NOT ok`) voltou "No rows returned":
  `2026-09-16-business-logic-security-audit.sql` (inclui a brecha de PRO
  grátis via `pro_expires_at` — FECHADA em produção, e as RPCs
  `reserve_ai_usage`/`bump_wa_ai_reply_count`),
  `2026-09-17-rate-limit-sliding-window.sql` e
  `2026-09-17-whatsapp-followup-claim.sql` (`claim_wa_followup_nudge` existe
  — o reengajamento do follow-up NÃO está pausado por falta dela). **Não
  pedir pra rodar de novo nem listar como pendência** — as menções "sem
  confirmação de execução" nas entradas do pentest (09-18), do Bloco 21 e da
  auditoria de webhooks mais abaixo estão superadas por esta.

- **SPLASH DOS URSOS COM DUAS LEGENDAS SOBREPOSTAS (2026-09-24, relato do
  usuário: "parece que tá as duas sobrepostas"). SEM SQL.** O #383 trocou a
  arte MANTENDO o nome `/mascotes-calicolors.webp`, e o `sw.js` serve imagem
  CACHE-FIRST — aparelho que já tinha a arte antiga (com "Alice • Seu Zé •
  Senna • Fê" desenhado DENTRO da imagem) seguiu com ela, e a legenda nova em
  texto HTML (`marginTop:-12`) caía por cima. Fix: arquivo renomeado pra
  `/mascotes-calicolors-v2.webp` (URL nova = cache antigo não casa), refs no
  `SplashMascotes` e no "Reconectando…" do `AppShell` (que também tinha a
  proporção antiga 640×762 → 968×1066). Teste `__tests__/splashMascotes.test.ts`
  trava que a ref existe em `public/` e que o nome sem versão não volta.
  **REGRA: trocou arte estática servida pelo SW → troque o NOME do arquivo**
  (ou bumpe `CACHE_VERSION`, que limpa TODO o cache de imagem). PR #399
  MERGEADA (`5cc9818`) e **NO AR: deploy run #747 do `deploy.yml`
  (2026-09-24) terminou `success`.** **CONFIRMADO PELO USUÁRIO NO APARELHO
  (2026-09-24): "splash certinho" — uma legenda só.** Caso fechado.

- **DOCUMENTAÇÃO DE PRODUTO CRIADA (2026-09-23, pedido do usuário: "PRD
  TRD appflow brief ui and ux esquema backend plano de implementacao").**
  `docs/produto/` com README, BRIEF, PRD, TRD, APP_FLOW, UI_UX,
  BACKEND_SCHEMA e PLANO_DE_IMPLEMENTACAO, levantados do código (não de
  memória). O `BACKLOG.md` da raiz está DESATUALIZADO — o plano vigente é
  `docs/produto/PLANO_DE_IMPLEMENTACAO.md`. Divergências achadas no
  levantamento, a conferir no banco (BACKEND_SCHEMA §9): policies antigas
  `USING true` em follows/likes/qualifications/courses nunca derrubadas no
  repo; jobs de cron duplicados (`cleanup-notifications` e
  `cleanup-old-notifications`, idem audit-events); custo real de
  `redeem_pro_with_points` (função só existe no banco; a tela diz 1000 pts).
  Mudou regra/tela/tabela → atualizar o documento correspondente.

- **WHATSAPP: resposta do cliente NÃO CHEGAVA no portal — `runAfterResponse`
  sem `waitUntil` desde a migração pro OpenNext (2026-09-23, SEM SQL).**
  Relato: template chegou no celular, a resposta não apareceu no portal.
  Causa: `lib/api/env.ts` lia o contexto da request só em
  `Symbol.for('__cloudflare-request-context__')` (next-on-pages). O
  `@opennextjs/cloudflare` publica em **`Symbol.for('__cloudflare-context__')`**
  (getter sobre AsyncLocalStorage, `{env, ctx, cf}`). As envs seguiram
  funcionando POR ACASO (o OpenNext copia o env pra `process.env`, nosso
  fallback) e escondeu o bug; mas `runAfterResponse` nunca mais achou o
  `ctx.waitUntil` e deixava o trabalho como promessa solta, que o workerd
  cancela ao fim da resposta. Afetava tudo que roda depois da resposta: o
  webhook do WhatsApp (gravar em `whatsapp_messages`, mídia, IA), a
  escrituração do `/api/whatsapp/send` e a moderação do chat
  (`/api/chat/moderate-message`). Fix: `readRequestContext` tenta o symbol
  do OpenNext primeiro e o antigo como fallback. Teste de regressão em
  `__tests__/lib/run-after-response.test.ts`. **REGRA: trocou de adapter,
  conferir de onde sai o `ctx`/`env` — fallback que "funciona" esconde a
  metade que quebrou.** Mensagens perdidas no intervalo NÃO voltam (a Meta
  recebeu 200). Estado: PR #397 MERGEADA (squash `ef50473`, 2026-09-23) e
  **NO AR: deploy run #746 do `deploy.yml` (commit `ef50473`) terminou
  `success`.** **Usuário testou DEPOIS do deploy #746 (2026-09-23): a
  resposta ao template AINDA NÃO chegou no portal** — o fix do waitUntil
  era bug real mas não era (só) a causa. Investigação continua: falta saber
  se o webhook está sendo chamado (painel do Dualhook / `whatsapp_messages`
  direction='in' e `delivery_status_at` recentes).
  **DADO DO BANCO (2026-09-23): última mensagem recebida E último status
  de entrega = 2026-09-17 ~21:09 UTC (18:09 Brasília).** O webhook está
  MUDO desde então — nem mensagem nem ✓✓ chegam; o envio (saída) segue
  gravando (última out 09-23 05:13). Parou ANTES do corte pro Worker
  (09-20), então não é a migração. Nenhum merge na `main` entre 21:09 de
  09-17 e 03:54 de 09-18 (#328). Hipóteses: (a) o Dualhook parou de entregar
  (webhook desativado/URL trocada no painel dele) ou (b) nosso endpoint
  recusa toda entrega (403 de token/envelope). Só o log de entregas do
  Dualhook ou o teste de verificação do webhook distingue.

- **WHATSAPP DO PORTAL: envio de texto otimista (2026-09-23, v=20260923a,
  SEM SQL).** Mesmo sintoma do chat do app: a bolha só aparecia depois de
  `/api/whatsapp/send` responder (auth + Dualhook, alguns segundos) e o
  botão ficava em "Enviando…" travado. Agora `enviar` põe o eco na hora
  (`_envio:'enviando'`, 🕓), limpa o campo e não trava o botão; falha →
  eco vira "⚠ falhou", erro acima do campo e o texto volta pro input.
  `mesclarMensagens` não apaga eco que falhou e só casa eco com linha real
  criada até 2min antes dele (um "oi" antigo apagaria o eco de um "oi"
  novo). Template segue com o fluxo antigo (botão com estágio). `app.js`
  recompilado pela receita (build do HEAD conferido idêntico antes), SRI e
  `?v=` (`20260921a`→`20260923a`→`20260923b`) atualizados. Teste em
  `portalWhatsAppNaoLidas.test.ts`. Deploy: mesmo run #745 do chat abaixo.

- **CHAT: envio de mensagem levava ~5s — agora é instantâneo (2026-09-23,
  PR #394, MERGEADA). SQL `/migrations/2026-09-23-get-conversations-skip-deleted.sql`
  — NÃO PRECISA RODAR: a versão viva no banco JÁ filtra `deleted_at` e não
  tem `email` (conferido pelo `pg_get_functiondef` colado pelo usuário em
  2026-09-23). O arquivo agora espelha a versão viva.** O
  `useSendMessage` esperava `/api/moderate` (GoTrue + rate limit + reserva
  de cota + Gemini) ANTES do INSERT em `messages`, e o composer travava o
  campo ("...") nesse intervalo. Agora grava direto (bolha otimista) e
  pede a moderação ao SERVIDOR: `POST /api/chat/moderate-message
  {messageId}` (fetch `keepalive`) responde 202 e modera por
  `runAfterResponse`/`waitUntil` — lê o conteúdo do BANCO com service role,
  só aceita pedido do remetente, cota `moderate`, rate limit 60/min.
  Reprovada (qualquer `flagged`) → PATCH `deleted_at` + broadcast
  `msg-removed` no canal `chat-global-<uuid>` de cada participante (UUIDs
  do sender/receiver/convId). `useChatRealtime` escuta e REFAZ a consulta
  (payload é só aviso — broadcast forjado só provoca refetch); remetente
  ganha toast. Portal 3-way filtra `deleted_at` e ouve UPDATE (v=20260923b).
  - **Por que broadcast e não postgres_changes UPDATE:** a policy de SELECT
    esconde linha com `deleted_at`, e o realtime respeita RLS — o
    destinatário nunca recebe o UPDATE do soft delete.
  - **Achados do Codex na 1ª versão (os dois P1, corrigidos no mesmo PR):**
    (1) moderar no NAVEGADOR morria se o app fechasse depois do envio;
    (2) o soft delete só sumia do cache do remetente.
  - **Trade-off aceito:** mensagem reprovada fica visível alguns segundos.
    Continua não sendo fronteira de segurança: INSERT direto via REST pula
    o pedido de moderação (igual antes). Fechar isso = trigger/pg_net no
    banco chamando a rota, fora do escopo.
  - **`get_conversations` já estava certa no banco — o erro foi meu.** A
    1ª versão da migration foi montada a partir do `supabase_init.sql`
    (desatualizado, ainda com `email` no retorno) e o Postgres recusou com
    42P13 "cannot change return type" — nada mudou. A versão viva já tinha
    `AND m.deleted_at IS NULL` e já não expõe `email`. **REGRA: recriar
    função a partir do banco (`pg_get_functiondef`), nunca do
    `supabase_init.sql`.** (Mesma lição da Wave 42/53: o init não é o
    schema vivo.) O arquivo virou DROP+CREATE numa transação + GRANTs
    refeitos (achado do Codex no #395): roda também em banco criado do
    init; provado em Postgres 16 local (assinatura antiga → nova, re-run,
    anon sem EXECUTE, mensagem apagada fora da prévia).
  - Testes: `__tests__/chatEnvioInstantaneo.test.ts`,
    `__tests__/services/chat-moderation.test.ts`. Suíte (206/206), `tsc` e
    `next build` verdes. **NO AR: deploy run #745 do `deploy.yml`
    (2026-09-23, commit `07c2d1e`, a pedido do usuário) terminou
    `success`, versão `56811f9f-37d1-41ca-aacd-7ee3ce14fc62`, e desta vez
    o passo de rotas/custom domain também passou (`queroumacor.com.br` +
    `www` listados) — sem o erro `/workers/routes` das 3 ocorrências de
    2026-09-20. CONFIRMADO PELO USUÁRIO EM PRODUÇÃO (2026-09-23):
    "funcionou, tá instantâneo agora" — chat do app e WhatsApp do portal.**

- **LOJA: cadastro de lojas no PORTAL, ligado à tela de seleção do app
  (2026-09-21, mesma sessão da entrada abaixo — pedido do usuário
  imediatamente depois do PR #392: "crie dentro do portal uma opção
  Lojas... isso ta sendo salvo no BD tbm"). SQL
  `/migrations/2026-09-21-stores.sql` — **JÁ EXECUTADO no Supabase
  (2026-09-21, confirmado pelo usuário: "sql rodado"). Não pedir pra rodar
  de novo.**
  - **Tabela `stores`** (`id` text PK = slug estável, `name`, `subtitle`,
    `emoji`, `active`, `sort_order`, timestamps) — RLS leitura aberta
    (`anon, authenticated`, mesmo padrão de `click_rua_editions`: é
    diretório público de lojas, não dado sensível), escrita só
    `is_portal_admin()`. Seed grava a Cali Colors (`id='calicolors'`) —
    "já aparece" sem precisar cadastrar na mão.
  - **App (`next-app/lib/services/stores.ts` +
    `lib/hooks/useStores.ts`)**: `StoreSelector.tsx` (a tela criada no
    PR #392) deixou de ler um array hardcoded e passou a ler
    `fetchStores()` — só lojas `active=true`, ordenadas por
    `sort_order`/nome. **Fallback pra `FALLBACK_STORES` (só Cali Colors)
    em QUALQUER falha** — tabela ainda não migrada (42P01), tabela vazia,
    ou erro de rede genuíno — porque a /loja é a porta de entrada da
    compra inteira: não pode ficar sem tela nenhuma por causa de SQL
    pendente. Mesmo padrão de `lib/services/clickRua.ts`.
  - **Portal**: item novo **"🏬 Lojas"** no menu lateral (seção LOJA, ao
    lado de Leads) → `LojasList` (`storesService` + formulário de criação
    + lista com edição inline, ativar/desativar, excluir). Se a tabela
    ainda não existir, a tela mostra o caminho do SQL em vez de erro cru
    (mesmo padrão do `ClickRua`/`Reports`).
  - **`app.js` recompilado do `app.jsx`** pela receita documentada
    (babel + `@babel/preset-react` runtime classic +
    `jsescOption.minimal:false`), SRI e `?v=` do `index.html` atualizados
    (`20260919a`→`20260921a`). Diff do `app.js` confere: só INSERÇÃO, zero
    linha alterada no que já existia — prova de que a recompilação é fiel
    ao que estava publicado.
  - **ACHADO DO CODEX na revisão do PR #392, corrigido antes do merge**:
    `LojaShell` usava `storeId` só como flag (truthy/falsy) — escolher
    QUALQUER loja diferente da Cali Colors abria escondido o mesmo
    `ProductsList` (catálogo da Cali Colors), com o nome da loja errada no
    header. Real e ficou mais alcançável depois desta entrada: antes o
    array de lojas era hardcoded com 1 item só e não dava pra criar uma
    segunda sem mexer em código; agora o portal deixa cadastrar loja nova
    em 2 cliques. Fix: `LojaShell` só abre o `ProductsList` quando
    `store.id === 'calicolors'`; qualquer outra loja cai no
    `StoreComingSoon` (tela nova, mostra nome/emoji da loja escolhida +
    "Catálogo em preparação"). `StoreSelector.onSelect` passou a entregar
    o objeto `Store` inteiro (não só o id), pra `StoreComingSoon` poder
    mostrar nome/emoji sem buscar de novo. **Não é solução de catálogo
    multi-loja** (isso exigiria `store_id` em `products`, precificação por
    loja etc. — fora do pedido) — é só a trava pra nunca mostrar o
    catálogo errado por baixo do nome certo.
  - Suíte inteira (204/204 arquivos, 2474/2474 testes), `tsc --noEmit` e
    `next build` verdes antes do commit. Testes novos:
    `__tests__/services/stores.test.ts` (mapeamento + os 2 caminhos de
    fallback + propagação de erro genuíno) e
    `__tests__/components/LojaShell.test.tsx` (trava o roteamento por
    loja — não deixa a correção do Codex regredir).

- **LOJA: tela de seleção de LOJAS antes das categorias (2026-09-21). SEM
  SQL.** Pedido do usuário: vão existir mais lojas parceiras além da Cali
  Colors, então clicar no ícone "loja" (bottom nav) precisa mostrar antes
  uma grade de LOJAS — só depois de escolher uma é que entra no catálogo de
  categorias/produtos que já existia.
  - `app/loja/StoreSelector.tsx` (novo): grade de lojas, hoje só um tile
    "🎨 Cali Colors" (subtítulo + contagem de itens via `useProducts`).
    Lista vive num array `STORES` — loja nova é uma entrada a mais, não
    reescrita de tela.
  - `app/loja/LojaShell.tsx` (novo, client): state `storeId` decide entre
    `StoreSelector` (nenhuma loja escolhida) e `ProductsList` + `AliceFab` +
    `CorDoAnoModal` (loja escolhida). `page.tsx` (Server Component, mantém
    o `metadata`) só renderiza `<LojaShell/>` dentro do `AppShell`.
  - `ProductsList` ganhou prop opcional `onBackToStores` — seta de volta
    `storeId=null`. Botão "‹" novo no header dark, à esquerda de "Loja Cali
    Colors", só aparece quando a prop existe (sem quebrar quem ainda chama
    `<ProductsList/>` sem prop, ex. algum teste futuro).
  - **Não resolvido de propósito (fora do pedido)**: links internos que
    apontam pra `/loja` de fora (carrinho vazio, confirmação de pedido,
    detalhe de produto `/loja/[id]`, calculadora, pedidos) voltam pra tela
    de SELEÇÃO de loja, não direto pro catálogo — como só existe uma loja
    hoje, é um toque a mais até essas telas serem revisadas (ou até isso
    incomodar de verdade). Suíte inteira (202/202, 2466/2466), `tsc
    --noEmit` e `next build` verdes.

- **REGRA PERMANENTE (2026-09-20, pedido explícito do usuário) — registrar
  neste arquivo IMEDIATAMENTE, sempre, sem exceção:** toda vez que (a) uma
  correção for aplicada (bug fix, mudança de config, deploy) OU (b) o
  usuário fizer algo manual fora do código (painel do Cloudflare/Supabase/
  GitHub, rodar SQL, trocar segredo, clicar em algo no dashboard), isso
  entra aqui NA HORA — não no fim da sessão, não "se sobrar tempo". Não
  esperar confirmação de que "funcionou" pra registrar: registrar o que foi
  feito e o estado conhecido até aquele momento (mesmo incerto/parcial) e
  atualizar depois se mudar. Esta regra existe porque este arquivo já
  documentou, repetidas vezes, sessões que fizeram auditoria/correção real
  e só registraram no fim (ou nunca) — deixando a próxima sessão cega ou
  repetindo trabalho já feito. Ver as várias entradas "LIÇÃO DE PROCESSO"
  espalhadas por este arquivo — a mesma lição, aprendida de novo várias
  vezes, é exatamente o que essa regra tenta parar de acontecer.

- **SPLASH DE BOOT: arte dos mascotes trocada + selo "AI-generated content"
  removido (2026-09-21, PR #383, MERGEADA — ainda sem deploy disparado).
  SEM SQL.** O usuário perguntou se eu sabia que a tela de loading inicial
  tinha uma imagem "dos bears" (os 4 mascotes-ursinhos da Cali Colors —
  Alice, Seu Zé, Senna, Fê — em `public/mascotes-calicolors.webp`,
  renderizada por `components/SplashMascotes.tsx` na raiz `/` e no
  `AppShell` enquanto a sessão resolve) e mandou uma imagem nova pra
  substituir.
  - **A imagem nova vinha com um selo semi-transparente "✨ AI-generated
    content"** colado no rodapé pelo próprio gerador de imagem, sobrepondo
    bem em cima da legenda "Alice • Seu Zé • Senna • Fê" que também estava
    desenhada DENTRO da arte. Publicar assim seria carregar um selo de
    "conteúdo gerado por IA" pra dentro da tela de loading do app — não dá
    pra simplesmente trocar o arquivo sem tratar isso primeiro.
  - **Fix por recorte, não por IA generativa**: medido pixel a pixel
    (histograma de brilho por linha) onde os pés dos ursinhos terminam
    (~y=1066 de uma imagem de 1152px de altura) — abaixo disso só tinha o
    selo + a legenda, nada de arte útil. Cortou o rodapé inteiro fora
    (selo E legenda desenhada, os dois juntos) e reconverteu pra WebP
    (968×1066, ~57KB, contra os 968×1153/~68KB de antes).
  - **A legenda "Alice • Seu Zé • Senna • Fê" voltou como TEXTO HTML de
    verdade** em `SplashMascotes.tsx`, logo abaixo da `<img>` (cor
    `#3f3729`, negrito, `marginTop:-12` pra ficar coladinha na imagem como
    estava antes) — não como parte do arquivo. Fica nítida em qualquer
    densidade de tela e a legenda nunca mais depende de ficar presa dentro
    de uma imagem gerada por terceiro.
  - `width`/`height` do `<img>` ajustados pro novo recorte (968×1066).
  - Suíte (202/202 arquivos, 2466/2466 testes), `tsc --noEmit` e
    `next build` verdes antes do commit. Conferido visualmente (crop
    ampliado da borda inferior) que o corte não deixou resquício do selo
    nem cortou os pés dos ursinhos.

- **ORÇAMENTO: "Imprimir (navegador)" não funcionava + desconto em % não
  calculava certo (2026-09-21, PR #381, MERGEADA — ainda sem deploy
  disparado). SEM SQL.** Dois relatos do usuário sobre o QuoteWizard
  (`/orcamento-ia`), o 1º pelo chat, o 2º via print de conversa no WhatsApp
  com um lead ("Fabio Irmao Nv") mostrando a mesma tela.
  - **"Imprimir" não fazia nada.** O botão "🖨️ Imprimir (navegador)" do
    modal **Visualizar** chamava `window.print()` — mesma classe de bug já
    documentada várias vezes neste arquivo (window.print é no-op na WebView
    do Capacitor). O botão "PDF" ao lado JÁ funcionava (gera com jsPDF +
    share nativo/Filesystem/download, `handlePdf()`), só o da tela de
    Visualizar tinha ficado pra trás. Fix: o modal (`QuotePreviewModal`)
    passou a chamar o MESMO `handlePdf()` via prop, em vez de reimplementar
    outro caminho. O CSS `@media print` + classes `quote-pdf-*` que só
    existiam pra esse `window.print()` saíram junto (código morto).
  - **Desconto em % calculava como se fosse R$.** `parseDesconto` sempre
    tratou "10%" como percentual e "500,00" como valor — a lógica estava
    certa. O problema era o TECLADO: o campo é `inputMode="decimal"`, e o
    teclado numérico que o Android mostra pra esse modo **não tem tecla de
    `%`** — fisicamente impossível digitar "10%" no aparelho, então todo
    desconto pretendido como percentual caía no ramo "é R$" e descontava um
    valor absurdo (ou nada, se o número digitado sozinho excedesse o
    subtotal). Fix: campo virou toggle **R$ / %** + input só numérico
    (`descontoDigitos`/`setDescontoTipo`/`setDescontoDigitos`, derivados de
    `form.desconto`, sem novo state) — a string gravada em
    `quote_data.desconto` continua exatamente no mesmo formato ("10%" /
    "500,00"), então `parseDesconto`/`orcamentoDocumento`/PDF nem precisaram
    mudar.
  - Suíte (202/202 arquivos, 2466/2466 testes), `tsc --noEmit` e
    `next build` verdes antes do commit. **Deploy NÃO disparado ainda** —
    esperando o usuário confirmar se quer que eu acione o workflow manual
    (`deploy.yml`, `workflow_dispatch`) ou se prefere disparar ele mesmo.

- **AUDITORIA EXTERNA HOSTEDSCAN (2026-09-20) — comparada contra todo o
  histórico de auditorias já feitas. Quase tudo já estava corrigido; 1
  achado NOVO e REAL, confirmado no painel Cloudflare pelo usuário —
  "Resize images from any origin" está LIGADO em Image Resizing, sem
  correção aplicada, pendente de decisão.**
  - **Contexto**: usuário colou relatório de scan (OWASP ZAP + OpenVAS +
    Nmap + Sslyze + Nuclei) contra `www.queroumacor.com.br`. Pedido
    explícito: só analisar/comparar/opinar, sem agir.
  - **Achado de CSP com `'unsafe-inline'` em `script-src`**: não é
    discrepância real — o scan foi feito ANTES do hardening de CSP
    (hash-only, 19/09) e do fix de nonce (20/09, ver entrada de
    `middleware.ts` mais abaixo/acima neste arquivo) irem ao ar. Foto
    antiga, sem ação necessária.
  - **Maioria dos outros achados** (headers inconsistentes, CORS amplo,
    SRI ausente em Google Fonts, DNSSEC/CAA "pendentes", DOMPurify
    desatualizada) já estavam cobertos por correções/decisões
    documentadas neste arquivo, ou são de terceiro (DOMPurify é script da
    Apple, `appleid.cdn-apple.com`) ou infra padrão da borda Cloudflare
    (port scan/TCP timestamp) — sem ação necessária.
  - **ACHADO NOVO E REAL, CONFIRMADO PELO USUÁRIO NO PAINEL (2026-09-20)**:
    Cloudflare → zona `queroumacor.com.br` → Speed → **Settings** →
    dropdown **"Image Optimization"** (não confundir com o dropdown
    "Recommendations", que aparece por padrão e não mostra essa opção) →
    seção "Image Transformations": toggle **LIGADO**, checkbox **"Resize
    images from any origin" MARCADO**. Isso significa que o endpoint
    público `/cdn-cgi/image/.../<qualquer-url>` aceita redimensionar
    imagem de QUALQUER origem da web, não só do próprio domínio — achado
    do Nuclei confirmado real, não falso positivo.
  - **Por que está assim (não é esquecimento, é uso real)**: `next-app/
    lib/cfImg.ts` depende disso ligado pra redimensionar/otimizar (WebP/
    AVIF automático, srcset 1x/2x/3x, qualidade 85) as fotos de post/
    avatar/produto, que ficam no Supabase Storage (`*.supabase.co`) — um
    domínio EXTERNO ao `queroumacor.com.br`. O próprio código já documenta
    essa dependência e tem fallback gracioso: se a opção fosse desligada,
    a imagem cai pro `onError` dos componentes (placeholder), sem crash.
  - **Impacto de segurança de deixar como está (real, mas não crítico)**:
    NÃO vaza dado de usuário, sessão, banco ou credencial (é só
    transformação de imagem; quem busca a imagem é a borda Cloudflare,
    não o servidor próprio, então também não serve pra sondar rede
    interna). O risco real é: (1) abuso de banda/cache Cloudflare às
    custas da conta; (2) phishing com link tipo
    `queroumacor.com.br/cdn-cgi/image/.../golpe.jpg`, que parece
    "hospedado" no domínio confiável; (3) **o mais relevante pra este
    projeto especificamente**: é uma porta de conteúdo arbitrário de
    terceiro sendo processado/cacheado sob o domínio, TOTALMENTE FORA do
    pipeline de moderação (Gemini, `media_hash_blocklist`,
    `media_review_queue`, acordo NCMEC) que o projeto já construiu com
    tanto cuidado em outras frentes — não gera post no banco, mas é um
    ângulo de exposição de conteúdo que a auditoria de CSAM/moderação
    nunca cobriu porque não é um caminho de upload do app.
  - **Impacto de performance de desligar sem mais nada** (real, imediato):
    toda foto de post/avatar/produto vinda do Supabase (maioria do
    conteúdo visual do app) deixaria de ser otimizada pela Cloudflare —
    volta pra arquivo original sem WebP/AVIF/srcset, LCP pior, mais dado
    consumido no celular. Não é teórico: é o que sustenta o item B2 já
    documentado como "LIGADO E FUNCIONANDO" neste arquivo.
  - **NÃO CORRIGIDO — decisão do usuário, duas opções levantadas, nenhuma
    implementada**: (a) desligar "Resize images from any origin" agora
    (fecha o vetor, perde otimização das imagens do Supabase até resolver
    a opção b); (b) proxiar o Supabase Storage por trás do próprio
    domínio (`_redirects`/rewrite — o comentário do `cfImg.ts` sugere que
    algo nesse sentido já existe parcialmente pra outro caso, não
    confirmado se cobre 100% das URLs de mídia hoje) — se cobrisse tudo,
    toda URL cairia no branch "mesma zona" do `cfImg.ts` e dá pra desligar
    "any origin" sem perder nenhuma otimização. Ação futura: auditar
    quanto da URL de mídia realmente passa por proxy vs. Supabase direto,
    antes de decidir.

- **CORTE DE DNS (P8) JÁ FEITO — `queroumacor.com.br` e `www.queroumacor.com.br`
  já estão vinculados ao Worker `queroumacor-next-production`, não mais ao
  projeto Cloudflare Pages (2026-09-20). NÃO tratar isso como pendência nem
  reabrir a PR #358 (obsoleta) achando que falta habilitar Custom Domain —
  já foi habilitado, direto no painel.**
  - **Como foi descoberto**: uma sessão de auditoria (pedido explícito do
    usuário: "verifique se o corte de DNS já foi realmente concluído, sem
    presumir nada") concluiu inicialmente, corretamente NA HORA, que o corte
    **não** tinha sido feito — toda a evidência de repo (PR #358 aberta em
    draft, `wrangler.jsonc` com `routes` comentado, PR #351 dizendo "corte
    continua fora de cogitação") apontava nesse sentido. **Enquanto essa
    auditoria ainda rodava**, outra sessão Claude em paralelo
    (`session_01WivWUTa5TA5knAqPHQakoq`, também operada pelo usuário) fez o
    corte de verdade DIRETO NO PAINEL do Cloudflare e mergeou a
    **PR #372** (`f1d4b33`, 2026-09-20T04:50:50Z) só pra declarar no
    `wrangler.jsonc` o que já tinha virado realidade — sem isso, o próximo
    `wrangler deploy --env production` IA REMOVER os Custom Domains de novo
    (Wrangler reconcilia `routes` de forma declarativa: o que não está no
    arquivo é tratado como "deve sair"). A auditoria só percebeu a mudança
    ao re-conferir `origin/main` alguns minutos depois — **prova de que
    "auditei agora" tem validade de minutos quando há mais de uma sessão
    mexendo no mesmo projeto ao mesmo tempo**, mesma lição já registrada
    neste arquivo pro susto de deploy de 2026-09-19 (contenção de fila entre
    sessões).
  - **`env.production.routes` no `wrangler.jsonc` agora é**:
    ```jsonc
    "routes": [
      { "pattern": "queroumacor.com.br", "custom_domain": true },
      { "pattern": "www.queroumacor.com.br", "custom_domain": true }
    ],
    ```
  - **CONFIRMADO NA HORA (2026-09-20, o próprio usuário testou pelo Claude in
    Chrome — navegador real, sessão já logada de antes, fora do sandbox desta
    sessão): o site funciona normalmente pra usuário real.**
    `https://queroumacor.com.br` carregou sem página de bloqueio, feed
    renderizou com posts/avatares/imagens reais (via `/cdn-cgi/image`
    proxiando o Supabase Storage — confirma que o Image Resizing também
    sobreviveu ao corte), leitura RLS em `profiles_public` voltando 200,
    prefetch RSC (`_rsc=`) em `/pro`, `/chat`, `/perfil`, `/hashtag/*`,
    `/search`, `/loja`, `/notificacoes`, `/feed` todos 200, service worker
    registrado, zero erro no console. **Isso resolve o item 3 abaixo** — o
    corte não quebrou a navegação básica nem a leitura via Supabase/RLS.
    **O usuário também reproduziu o 403 desta sessão rodando `curl` de um
    sandbox externo contra `queroumacor.com.br`/`www` — mesmo padrão (bot-
    management por IP de datacenter), confirmando que o 403 é só bloqueio de
    tráfego automatizado, não sinal de problema em produção.**
  - **CONFIRMADO PELO USUÁRIO (2026-09-20): os secrets de produção
    (`SUPABASE_SERVICE_ROLE_KEY`, chaves de IA, `MP_ACCESS_TOKEN`/
    `MP_WEBHOOK_SECRET`, segredos do WhatsApp, `PUSH_INTERNAL_SECRET`) JÁ
    FORAM PROVISIONADOS no Worker `queroumacor-next-production` ANTES do
    corte** (não aparecem no `wrangler.jsonc` — foram setados via
    `wrangler secret put`/painel, por isso não tem como ver isso num diff
    de código). **Não pedir pra confirmar de novo nem tratar como
    pendência** — WhatsApp/IA/pagamento/push em produção devem estar
    operando normalmente pós-corte, não fail-closed.
  - **AINDA NÃO CONFIRMADO — único item real que sobra, só o painel do
    Cloudflare resolve (nem sessão de navegador real distingue isso: é
    coisa que só aparece no dashboard, não em request/response HTTP)**:
    **se o Custom Domain foi de fato REMOVIDO do lado do Pages** (projeto
    `queroumacor-next`) ou se ainda está lá duplicado/conflitando — o
    próprio usuário apontou que isso só se resolve olhando as duas abas
    "Custom Domains" no painel (a do Worker `queroumacor-next-production`
    e a do Pages project `queroumacor-next`) — nenhum teste de HTTP de
    fora distingue com certeza qual dos dois está de fato vinculado ao
    hostname hoje.
  - **O bug do "Build output directory" do Cloudflare Pages (entrada logo
    abaixo) pode ter ficado IRRELEVANTE** — se o Pages não é mais quem serve
    o domínio, não importa que os builds dele continuem falhando. Mas isso
    também não está confirmado (ver item acima, sobre o Custom Domain do
    Pages) — não apagar a entrada abaixo até alguém confirmar que o Pages
    saiu de cena de vez.
  - **Achado extra desta sessão, útil pra qualquer smoke test futuro contra
    produção**: o `smoke-test-workers.yml` disparado contra
    `https://queroumacor.com.br` a partir de um runner do GitHub Actions
    tomou **403 "Sorry, you have been blocked" / "Attention Required! |
    Cloudflare"** (página de bloqueio do WAF/Bot Fight Mode, não erro de
    app) em 9 dos 10 checks — IP de datacenter do GitHub Actions é tratado
    como bot pelo Cloudflare. **Só `/api/whatsapp/webhook` passou** (voltou
    JSON de verdade, `{"error":"verificação inválida"}`), porque já existe
    allowlist de WAF pra esse path especificamente (pra não bloquear a
    Meta). **Isso significa que curl/CI a partir de IP de datacenter NÃO
    serve pra validar produção depois deste corte** — só navegador/app real
    (humano) passa pelo WAF. Qualquer validação futura do corte de DNS tem
    que ser manual, num navegador de verdade, não automatizada via CI.

- **DEPLOY DO WORKER `queroumacor-next-production`: erro de permissão em
  `/zones/.../workers/routes` (2026-09-20) — EM ABERTO, só o painel
  resolve.** No 2º deploy manual consecutivo (mesmo token, mesmo
  `wrangler.jsonc`, rotas idênticas ao 1º deploy que tinha funcionado
  minutos antes), o step `wrangler deploy --env production` subiu o código
  com sucesso (`Uploaded queroumacor-next-production`) mas falhou no passo
  seguinte, de sincronizar rotas: `A request to the Cloudflare API
  (/zones/9f9e32d439524affe34c4b53fe4ceb08/workers/routes) failed. No
  access to the specified resource.`
  - **O código novo foi pro ar mesmo assim** — confirmado pelo usuário
    testando o app real logo depois (voltou a carregar normalmente).
    Hipótese não confirmada: subir o script já ativa a versão nova pros
    domínios JÁ vinculados; o passo que falhou só tenta reconciliar/
    confirmar rotas, redundante quando o conjunto desejado não mudou.
  - **Causa provável, pela doc oficial da Cloudflare**
    (`/workers/authorization/workers/`): tanto Routes quanto Custom
    Domains são gates pela MESMA permissão de zona, `Zone > Workers
    Routes > Edit` (o texto da doc: "To add, update, or remove Routes or
    Custom Domains, you need Editor access to the Worker and Workers
    Routes Write permission for every affected zone"). O
    `CLOUDFLARE_API_TOKEN` (secret do GitHub Actions, usado por
    `deploy.yml`) claramente tem `Account > Workers Scripts > Edit` (o
    upload do código NUNCA falhou, nas duas execuções) mas
    aparentemente não tem — ou tem de forma inconsistente — essa
    permissão de ZONA especificamente pra `queroumacor.com.br` (zone id
    `9f9e32d439524affe34c4b53fe4ceb08`).
  - **O que não fecha, e fica como pergunta em aberto**: o MESMO token,
    minutos antes, completou com sucesso o passo equivalente ("Deployed
    queroumacor-next-production triggers... queroumacor.com.br (custom
    domain)... www.queroumacor.com.br (custom domain)") pro MESMO
    conjunto de rotas, sem nenhuma mudança de config entre as duas
    execuções. A doc da Cloudflare não confirma nem nega se o Wrangler
    faz uma chamada de LEITURA/diff contra esse endpoint antes de decidir
    se precisa escrever — se isso existir, um token com permissão
    assimétrica (Write mas não Read, por exemplo, ou a zona caindo da
    lista de recursos do token entre as duas execuções) explicaria a
    inconsistência. **Não confirmado — só hipótese informada**, verificada
    via pesquisa na documentação oficial, não via inspeção do token real
    (sem acesso a isso).
  - **AÇÃO PENDENTE, só o painel resolve**: conferir o token usado no
    secret `CLOUDFLARE_API_TOKEN` (dashboard Cloudflare → My Profile → API
    Tokens) e garantir que ele tem `Zone > Workers Routes > Edit`
    explicitamente escopado pra zona de `queroumacor.com.br` — não só
    permissão de conta pra Workers Scripts. Enquanto isso não for
    confirmado/corrigido, deploys futuros por este workflow podem repetir
    esse erro no passo de rotas (mesmo que o código suba normalmente).
  - **3ª OCORRÊNCIA, mesma assinatura exata (2026-09-20, run #742,
    workflow_dispatch disparado por Claude a pedido do usuário pra publicar
    as correções de vídeo/botão/ABRAPP desta sessão).** Log completo lido
    (`get_job_logs`): `Uploaded queroumacor-next-production (7.39 sec)` com
    sucesso, e a MESMA linha de erro no passo seguinte, char por char:
    `A request to the Cloudflare API (/zones/
    9f9e32d439524affe34c4b53fe4ceb08/workers/routes) failed. No access to
    the specified resource.` — confirma que não foi acidente isolado das
    duas primeiras vezes; o problema de permissão do
    `CLOUDFLARE_API_TOKEN` na zona segue sem correção. **Não peço mais pra
    "ver se foi bug único"** — nos próximos deploys por este workflow,
    esperar esse erro no passo de rotas como padrão, não exceção, até a
    AÇÃO PENDENTE acima ser resolvida no painel. O upload do código
    continua funcionando normalmente (3 de 3 vezes) — só a etapa de
    rotas/custom domain falha; a hipótese de que isso é redundante quando
    o conjunto de domínios não muda (linha acima) segue sem confirmação
    definitiva, mas o padrão "upload ok, rotas falha" já é consistente o
    bastante pra não investigar de novo do zero a cada ocorrência.
  - **CONFIRMADO PELO USUÁRIO EM PRODUÇÃO (2026-09-20), mesmo dia da 3ª
    ocorrência: "funcionou".** Depois desse mesmo deploy #742 (rotas
    falhando, upload ok), o usuário testou o app de verdade e confirmou que
    está funcionando — reforça, com mais um caso, a hipótese já registrada
    acima de que a falha no passo de sincronizar rotas NÃO impede o código
    novo de ir ao ar (são domínios já vinculados; só a reconciliação de
    rotas falha, não a entrega em si). As correções desta sessão que foram
    ao ar por esse deploy: remoção da palavra "ABRAPP" dos textos visíveis
    do app (Tabela de Preços/Orçamento — PR #377), fix de preview de vídeo
    quebrado (ícone genérico de play em vez do primeiro quadro, em 7 telas:
    Em alta, hashtag, lead card, preview de perfil próprio/público,
    portfólio, preview do composer — PR #378), e o botão "Seguindo" da tela
    de conexões que antes mostrava só "✓" e confundia (mesma PR #378).

- **"Build output directory" do Cloudflare Pages ficou desatualizado após o
  merge da migração OpenNext (PR #344, 2026-09-19) — TODO deploy novo de
  `main` falha, Production está SEGURA mas presa até corrigir.** Achado logo
  depois do merge, checando os builds mais recentes: `Error: Output
  directory "..." not found` em TODOS eles, incluindo o próprio build do
  commit do merge (`e526b3d`) e o preview build de um PR só-de-docs (#355)
  aberto depois, sem nenhuma relação com o pipeline.
  - **Causa**: `next-app/package.json` → `build:cf` passou a rodar
    `opennextjs-cloudflare build` (o novo adapter, `@opennextjs/cloudflare`),
    cujo artefato vai pra `.open-next/assets` (é o que `wrangler.jsonc`
    declara em `assets.directory`) — não mais `.vercel/output/static`, que
    era o output do `@cloudflare/next-on-pages` antigo (o adapter QUE ESTÁ
    saindo). O painel do projeto Pages (`queroumacor-next` → Settings →
    Builds & deployments → **Build output directory**) continua apontando
    pro caminho antigo, `next-app/.vercel/output/static` — ninguém atualizou
    esse campo no merge, porque é config de dashboard, fora do repo, e não
    aparece em nenhum diff de PR.
  - **Production não corre risco enquanto isso não for corrigido**:
    Cloudflare Pages mantém servindo o último deploy BEM-SUCEDIDO
    (`32de2c8`, com os 8 headers de segurança da correção de 2026-09-19 —
    ver entrada logo abaixo) toda vez que um build novo falha. Não há
    rollback nem downtime — só **nenhum commit novo de `main` consegue ir
    pro ar** até o campo do painel ser corrigido.
  - **NÃO CORRIGIDO ainda** — é config de dashboard (não dá pra editar via
    código/PR) e decisão de quem é dono da migração Workers (ADR 0006):
    apontar o campo pro novo path do Pages (`next-app/.open-next/assets`),
    ou cortar de vez o deploy de produção pra Workers via `wrangler deploy`
    (o que tornaria o campo do Pages irrelevante). Avisado via comentário no
    PR #344 (https://github.com/queroumacor-max/queroumacorapp/pull/344#issuecomment-5740183752)
    pra sessão/usuário dono da migração decidir e corrigir.
  - **LIÇÃO: uma migração de adapter de build muda o CAMINHO DE OUTPUT, e
    isso vive em config de painel que nenhum `git diff` mostra.** Depois de
    trocar `build:cf`/adapter em qualquer projeto Cloudflare Pages, conferir
    o "Build output directory" do painel bate com o novo artefato — não dá
    pra confiar só em `npm run build:cf` rodar limpo local.

- **CSP/X-Frame-Options/Permissions-Policy/COOP/CORP e o CORS restrito de
  `/api/*` NUNCA ESTIVERAM ATIVOS EM PRODUÇÃO — achado e corrigido
  (2026-09-19), disparado por 3 relatórios de scanner externo (CheckVibe/
  HostedScan: Nmap, OWASP ZAP) que o usuário colou no chat. SEM SQL.**
  - **O achado do ZAP**: resposta real de `GET https://www.queroumacor.com.br/`
    (200, `cf-cache-status: DYNAMIC` — não é cache velho) tinha só 3 dos 8
    headers de `headers()` no `next.config.mjs` (HSTS, Referrer-Policy,
    X-Content-Type-Options) — CSP, X-Frame-Options, Permissions-Policy,
    COOP e CORP estavam AUSENTES. `Access-Control-Allow-Origin: *` aparecia
    até na página HTML, quando a regra de `/api/(.*)` deveria restringir só
    às rotas de API.
  - **Investigação eliminou Cloudflare por completo** (usuário conferiu no
    painel): commit em Production batia com o código, sem split de
    domínio/projeto, nenhuma Transform Rule/Snippet/Cloud Connector/Workers
    Route/Page Rule mexendo em header de segurança. E o `next.config.mjs`
    tinha os 8 headers certos, sem mudança, desde ANTES da auditoria de
    13/09 (`git show <commit>` provou byte-a-byte).
  - **CAUSA RAIZ, reproduzida 100% LOCAL** (sem tocar em conta Cloudflare
    nenhuma): `npm run build:cf` + `wrangler pages dev` + `curl` no
    artefato mostrou o MESMO padrão quebrado — inclusive em `/api/health`,
    rota dinâmica de verdade, que devolvia `Access-Control-Allow-Origin: *`
    em vez do valor restrito. O `routes-manifest.json` (saída do `next
    build`) tem os 8 headers perfeitos, e a regra chega a ser embutida como
    objeto literal dentro do `_worker.js` compilado — mas o RUNTIME do
    worker gerado por `@cloudflare/next-on-pages@1.13.16` nunca aplica essa
    tabela a NENHUMA resposta. Não é cache, não é rota prerenderizada vs
    dinâmica, não é nada do Cloudflare: é bug do adapter (já descontinuado
    pelo mantenedor, ver regra mais abaixo sobre a trava do Next em
    15.5.x). **A validação "curl real via wrangler pages dev" que a
    auditoria de 13/09 registrou como prova não pegou esse bug** — não dá
    pra saber daqui se foi versão diferente do next-on-pages, path
    diferente testado, ou erro de método; o resultado é que o registro
    anterior estava errado e ninguém percebeu por meses.
  - **MECANISMO EXATO achado depois, por uma sessão em paralelo** (branch
    da migração pros Workers, `@opennextjs/cloudflare`, PR #344,
    reconciliada com esta em `main`): a entrada do `routes-manifest` que
    representa o PRÓPRIO MIDDLEWARE vem marcada `override:true`, e a
    função interna `applyRouteOverrides` do `@cloudflare/
    next-on-pages@1.13.16` ZERA os headers já acumulados sempre que uma
    requisição bate nela (lido direto no `_worker.js/index.js`
    minificado). Como o matcher do middleware casa quase toda rota (de
    propósito, pro bloqueio do CVE de Next-Action), isso zerava CSP e os
    outros headers do `next.config.mjs` em quase todo lugar. Detalhe
    completo no comentário de `middleware.ts` — inclusive uma
    DIVERGÊNCIA REAL entre os dois adapters (`next-on-pages` vs
    `opennextjs/cloudflare`) em quem vence quando `/api/health` seta o
    próprio CORS por cima do middleware.
  - **FIX: os 8 headers de segurança + o CORS de `/api/*` migraram pra
    `middleware.ts`.** Prova de que middleware funciona nesse adapter: o
    `x-request-id` que ele seta SEMPRE chegou certo em produção (inclusive
    no próprio scan do ZAP que achou o bug). `headers()` no
    `next.config.mjs` foi ESVAZIADO dos headers de segurança (só sobraram
    as regras de no-cache do `/portal`, que não dependem disso — o valor
    já é o default do Next pra página dinâmica, confirmado no próprio
    response do ZAP). **NÃO recriar CSP/X-Frame-Options/etc em
    `next.config.mjs`** — seria uma segunda fonte sem efeito nenhum em
    produção nesse adapter.
  - **`/api/health` mantém `Access-Control-Allow-Origin: *` PRÓPRIO,
    D E PROPÓSITO** (seta no código da rota, pra aceitar poll de uptime
    monitor externo tipo UptimeRobot) — o handler da rota sobrescreve o
    valor restrito do middleware, e isso é o comportamento CERTO, não bug.
    Toda outra rota de API sem CORS próprio herda o valor restrito do
    middleware (`https://queroumacor.com.br`) — confirmado com
    `/api/cidades` no teste local.
  - **`__tests__/cspHeadersParidade.test.ts` reapontado**: comparava
    `_headers` da raiz (relíquia inerte) com `next.config.mjs`; agora
    compara com `middleware.ts`, que é a fonte real.
  - Suíte inteira (184 arquivos/2300 testes) e `tsc --noEmit` verdes depois
    do fix, testado local com `build:cf` + `wrangler pages dev` + curl nos
    4 casos (`/`, `/login`, `/api/health`, `/portal`) antes do commit.
  - **LIÇÃO: "validado por curl via wrangler pages dev" numa entrada antiga
    não é garantia eterna.** O mesmo método que comprovou o bug agora foi o
    método que a auditoria de 13/09 disse ter usado pra provar que estava
    tudo certo. Perguntar "por que o scanner achou isso se já tinha sido
    auditado" — em vez de descartar como falso positivo — foi o que expôs
    um bug real de meses. **Achado de scanner externo em produção sempre
    merece reproduzir localmente antes de descartar, mesmo quando o código
    parece óbvio e correto.**
  - **SUSTO PÓS-MERGE, e a lição é sobre DEPLOY, não sobre código
    (2026-09-19).** Depois do merge do PR #350, o usuário testou em
    produção de verdade (fetch com `cache:'no-store'` + query string única,
    SW desregistrado e caches apagados — teste irretocável) e os 5 headers
    continuavam ausentes. Isso disparou uma investigação de ~2h buscando
    bug no `middleware.ts`/no bundler: eliminamos Cloudflare Trace (nenhuma
    Transform Rule/Managed Transform/WAF tocando esses headers), Managed
    Transforms (tudo desligado), divergência de versão do next-on-pages
    (idêntica: `1.13.16`, install limpo, mesmo comando `npm install && npm
    run build:cf`), e até um warning real do esbuild (`duplicate-case`) que
    parecia suspeito mas era código morto ISOLADO em duas rotas sem relação
    (`/loja/pedido-confirmado`, `/orcamentos/[id]`). **A causa real:** o
    deployment de produção do commit do merge (`32de2c8`) tinha
    ESTOURADO O TIMEOUT DE BUILD (`"build exceeded the time limit and was
    terminated"`, ~35min contra os ~4min normais do projeto) por
    CONTENÇÃO NA FILA — outra sessão do usuário rodava em paralelo no
    mesmo projeto Cloudflare Pages (a mesma que gerou o PR #344), disputando
    o limite de builds simultâneos da conta. Como o deployment com FALHA
    tinha rodado DEPOIS de um deployment mais antigo bem-sucedido, o painel
    manteve esse commit ANTERIOR (`40b6743`, sem nenhuma das mudanças desta
    correção) como "Production" — reproduzindo exatamente o bug antigo,
    porque era literalmente o código antigo ainda no ar. Um "Retry
    deployment" manual no commit certo resolveu; os 8 headers confirmados
    em produção logo depois. **REGRA NOVA: depois de mergear pra `main`,
    checar o STATUS do deployment de Production no painel do Cloudflare
    Pages (não só que o PR foi mergeado nem que existe um check verde) —
    "Production" pode ficar presa num commit anterior se o deploy do
    commit novo falhar/travar, especialmente com múltiplas sessões
    disparando build no mesmo projeto ao mesmo tempo.**

- **CVE POSTCSS/NEXT FECHADO DE FORMA ISOLADA + PLANO DE MIGRAÇÃO WORKERS
  APROFUNDADO (2026-09-18, PRs #337/#339/#340, TODAS MERGEADAS EM `main`).**
  Encadeamento de três PRs, cada uma resolvendo uma parte diferente do
  mesmo problema original (CVE de `postcss` herdado por `next@15.5.25`,
  achado numa investigação de migração pro Next 16):
  - **PR #337 (`d598194`) — investigação da migração `next@16` +
    `@opennextjs/cloudflare`, adapter revertido de propósito.** Branch
    isolada (`claude/next16-opennext-eval`) provou que `next@16.3.5` +
    `@opennextjs/cloudflare@1.20.6` builda limpo e fecha o CVE — mas o
    adapter atual (`@cloudflare/next-on-pages`, deprecado) trava o peer
    range em `next<=15.5.2`, então migrar de verdade exigiria trocar de
    adapter TAMBÉM, o que muda o MODELO DE DEPLOY (Cloudflare Pages →
    Workers), não só uma dependência. **Antes de mergear, o usuário pediu
    confirmação do risco real** — lendo o código-fonte do Wrangler
    instalado (não a doc), achamos que a PR tinha criado um
    `wrangler.jsonc` NOVO coexistindo com o `wrangler.toml` existente, e
    Wrangler resolve `wrangler.json > wrangler.jsonc > wrangler.toml`
    (primeiro que existir vence) — isso quebraria o próximo deploy
    automático de produção via Pages. **Revertido a troca de adapter**
    (`package.json`, `package-lock.json`, `.npmrc`, `wrangler.jsonc`,
    `open-next.config.ts`, `eslint.config.mjs` — todos de volta ao
    estado exato de `main`), mantendo só os 102 achados de lint
    corrigidos (`react-hooks/*`, regras de "React Compiler readiness" —
    cosmético, o Compiler não está instalado) e o **ADR 0006**
    (`docs/adr/0006-opennext-cloudflare-deploy-pipeline.md`), que
    documenta o TAMANHO da mudança pro mantenedor decidir depois, status
    `Proposed`. Revalidado do zero (`npm ci`, tsc, vitest 184/184
    arquivos, lint, `next build`, `build:cf` via `@cloudflare/
    next-on-pages` gerando o `.vercel/output/static/_worker.js/index.js`
    que produção espera) antes do merge.
  - **PR #339 (`cd02b88`) — o CVE do postcss fechado SEM esperar a
    migração de adapter.** Investigação separada: `npm audit --json`
    mostrava `next` vulnerável só via `postcss` (4 advisories —
    GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp,
    GHSA-r28c-9q8g-f849, faixa combinada `<=8.5.22`), com `fixAvailable`
    apontando só pro `next@16.3.5` — mas o `postcss` vulnerável existia
    numa ÚNICA cópia privada e isolada (`node_modules/next/node_modules/
    postcss@8.4.31`, pinada em versão EXATA pelo próprio `package.json`
    do `next`). O `postcss` de nível superior do projeto
    (`@tailwindcss/postcss`, `vite`, `autoprefixer`) já estava em
    `8.5.26`, acima da faixa vulnerável, só nunca deduplicava contra a
    cópia do `next` por causa do pin exato. **Fix**: `overrides` escopado
    em `next-app/package.json` (`{"next":{"postcss":"$postcss"}}`,
    sintaxe `$postcss` do npm apontando sempre pro `postcss` já resolvido
    no topo) — sem bump de major do `next`, sem trocar de adapter. Diff
    do lockfile cirúrgico (26 linhas removidas, a entrada nested), provado
    isolado comparando contra uma regeneração completa do lockfile (que
    traria dezenas de bumps não relacionados — não foi isso que foi
    commitado). `npm audit` confirma: `postcss`/`next` somem, resto do
    relatório (capacitor/cli, next-on-pages, vitest/mocker, cookie,
    esbuild, miniflare, sharp, tar, undici, vite, vite-node, ws) idêntico,
    achados pré-existentes não tocados.
  - **PR #340 (`104ce8b`) — plano de execução P1-P8 do ADR 0006
    aprofundado, e CORRIGIDO por revisão automática (Codex) antes do
    merge.** Com o CVE fechado sem depender da migração de adapter, a
    migração Workers virou puramente uma melhoria de infra (sair de um
    adapter deprecado), sem pressa de segurança. Documentação pura —
    **nenhuma config real tocada** (`next-app/wrangler.toml` intacto,
    produção segue em Pages) — mas checando o plano anterior (P1/P4 do
    ADR) contra a documentação VIVA da Cloudflare (não só memória),
    achamos que descrevia um mecanismo mais trabalhoso do que o que
    existe: **Workers Builds** é o produto nativo da Cloudflare
    equivalente ao Git integration que Pages já usa hoje (preview URL por
    branch + comentário automático no PR, sem workflow de GitHub Actions
    bespoke); e Workers separa vars de BUILD-TIME de vars de RUNTIME em
    duas superfícies distintas (Pages usa uma só). Novo arquivo
    `docs/adr/0006-workers-migration-artifacts.md` com os artefatos
    prontos pra execução: `wrangler.jsonc` completo, roster de ~30 env
    vars levantado por grep de `getRuntimeEnv()` real (não do
    `.env.example`, desatualizado), config do Workers Builds, `deploy.yml`
    reescrito, runbook de corte de DNS (P8). **A revisão automática do
    Codex achou 5 erros técnicos REAIS no conteúdo do plano antes do
    merge, todos verificados contra a doc oficial e corrigidos**: (1)
    Workers Environments NÃO herdam `vars` do topo (confirmado em
    `/workers/best-practices/workers-best-practices/`) — o draft deixava
    `env.production.vars`/`env.preview.vars` vazios "confiando na
    herança", o que na prática ZERARIA as vars públicas nos dois
    ambientes; (2) ambiente nomeado publica um Worker com NOME DIFERENTE
    (`{name}-{env}` — `queroumacor-next-production`/`-preview`, não
    `queroumacor-next` sozinho), afetando toda referência de rollback/URL
    no runbook; (3) os comandos de deploy do Workers Builds não tinham
    `--env production`/`--env preview` — sem o flag, cai no Worker RAIZ,
    que não é nem produção nem preview; (4)
    `NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`NEXT_PUBLIC_SENTRY_DSN` faltavam na
    lista de Build Variables (lidas via `process.env` direto em
    `PushOptIn.tsx`/`sentry.client.config.ts` — ausentes no build, o
    botão de ativar push some da tela em silêncio); (5) o `deploy.yml`
    reescrito tinha DOIS steps de build copiados do `next-on-pages` atual,
    quando o OpenNext só precisa de UM (`opennextjs-cloudflare build` já
    roda o `next build` sozinho por dentro) — o 2º step, o que gera o
    artefato de verdade, rodava SEM as env vars `NEXT_PUBLIC_*` que só o
    1º step recebia (escopo de `env:` é por STEP no GitHub Actions, não
    persiste). Todos os 5 corrigidos e as threads de review resolvidas
    antes do merge.
  - **O QUE FICA EM ABERTO, POR DESENHO — não é pendência esquecida**: a
    migração de verdade pro adapter `@opennextjs/cloudflare` + Cloudflare
    Workers (P1-P8) **não foi executada**. ADR 0006 continua `Proposed`;
    execução depende de decisão futura do mantenedor sobre quando abrir a
    janela de corte de DNS (P8, único passo com produção ao vivo em
    risco). O CVE que motivava essa migração já está fechado (PR #339),
    então não há mais urgência de segurança empurrando essa decisão — é
    puramente melhoria de infra agora.
  - **LIÇÃO DE PROCESSO**: as duas frentes (#339 e #340) foram trabalhadas
    em branches isoladas, sem push nem deploy, até o usuário revisar o
    diff de cada uma e autorizar push + PR + merge explicitamente, uma de
    cada vez — nenhuma delas foi ao ar sem essa aprovação intermediária.
- **AUDITORIA "BLOCO 21" — OWASP ASVS FINAL / SECURITY BASELINE / RELEASE
  GATE (2026-09-18). 30 categorias, 11 investigações paralelas cobrindo
  TODA a superfície (arquitetura, auth/sessão/autorização, RLS/injeção,
  XSS/SSRF/lógica de negócio, race conditions/webhooks, IA/upload, mobile/
  Firebase, HTTP/Cloudflare/secrets, logging/privacy/backup, CI-CD/deps/
  IAM, regressão histórica+attack chaining, build/test/secret-scan real).
  Achados de código-fixável CORRIGIDOS NA HORA nesta mesma sessão — não
  ficaram só documentados. SQL em
  `/migrations/2026-09-18-final-release-gate-hardening.sql` — JÁ
  EXECUTADO no Supabase (2026-09-20, confirmado pelo usuário: as 4 linhas
  de conferência voltaram `ok=true`). Não pedir pra rodar de novo.**
  - **Nenhum CRITICAL.** Um HIGH, achados MEDIUM/LOW listados abaixo por
    categoria. Suíte inteira (184 arquivos/2300 testes), typecheck e os
    testes do portal reconferidos DEPOIS de cada fix — verdes.
  - **HIGH corrigido: console de debug Eruda carregava em TODA instalação
    de produção, sem gate nenhum.** `app/layout.tsx` só checava
    `window.Capacitor` — verdadeiro em QUALQUER AAB/IPA publicado, não só
    build de debug. Eruda é um REPL de JS completo com acesso a
    `localStorage`/`sessionStorage` (onde mora a sessão do Supabase) — quem
    tivesse o app instalado (ou acesso rápido ao aparelho de outra pessoa)
    abria o botão flutuante e tinha um console com a sessão de quem
    estivesse logado, sequestro de conta sem precisar de XSS nenhum.
    Também era vetor de supply-chain (script sem pin de versão, liberado
    pela CSP pro jsdelivr). Fix: só carrega com
    `NEXT_PUBLIC_ENABLE_ERUDA==='1'` no build — env que fica de fora do
    build de produção, só setada em build interna de debug.
  - **MEDIUM corrigidos no código (sem depender de SQL):**
    - Sentry `beforeSend` (`lib/sentry-helpers.ts`) mascarava
      `user.email`/`request.data`/`extra`/`contexts`, mas NUNCA
      `exception.values[].value` (a mensagem do próprio Error) nem
      `message`/`breadcrumbs` — um `throw new Error("Falha ao enviar pra
      "+phone)` ia pro Sentry (terceiro) sem máscara. Estendido.
    - CI (`ci.yml`): o step "npm audit (fail-fast)" tinha
      `continue-on-error: true` — o comentário dizia "fail-fast" mas o job
      (e o check obrigatório `validate`) ficava verde mesmo com CVE HIGH/
      CRITICAL numa dependência de produção. Removido.
    - SVG deixou de contar como imagem válida em `lib/utils/mediaType.ts`
      (`ehImagem`/`provadoNaoImagem`) e saiu do `accept` dos inputs de
      avatar/logo. SVG pode embutir `<script>`; a única barreira era o
      `allowed_mime_types` dos buckets (que já não inclui svg, mas era
      ponto único de falha, e `/admin/media-review` abre arquivo em
      `<a target="_blank">`, que executaria script de um SVG top-level).
    - SSRF em `persistBrandLogos`/`fetchBytes` (logos gerados por IA):
      `isPubliclyRoutableHttpsUrl` validava só a URL de ENTRADA, e
      `fetch` segue redirect por padrão — host que passa no guard e
      responde 3xx pra um alvo privado seria seguido sem revalidação.
      Agora revalida `r.url` (destino final, depois de qualquer redirect)
      antes de aceitar os bytes.
    - Formula injection (CWE-1236) nos DOIS exports CSV do portal
      (`exportCSV` de Leads, `csvDoUso` de "Uso do App"): campo de lead
      importado de planilha ou de perfil (nome/cidade/@tag) começando com
      `=`/`+`/`-`/`@` vira FÓRMULA no Excel mesmo entre aspas. Prefixo com
      aspas simples nas linhas de DADO (cabeçalho, que é string fixa
      nossa — inclusive `"@tag"` — não é tocado). `app.js` recompilado do
      `app.jsx` pela receita documentada (babel + `jsescOption.minimal:
      false`), hash SRI e `?v=` do `index.html` atualizados
      (`20260916a`→`20260918a`), suíte do portal reconferida.
    - Ordem de `whatsapp_messages.delivery_status`: `statusAvanca`/
      `PESO_STATUS` só dedupavam DENTRO de uma entrega de webhook (Map em
      memória); duas entregas HTTP separadas (reentrega da Meta, ou `sent`
      chegando depois de `read` fora de ordem — normal pra ela) podiam
      regredir o status gravado. `persistStatusEntrega` agora usa
      `filtroSoAvancaEntrega` (mesmo padrão de `filtroSoAvanca`, já usado
      pra abordagem de lead) no PATCH, fechando a corrida ENTRE
      requisições, não só dentro de uma.
  - **MEDIUM que precisavam do SQL em
    `2026-09-18-final-release-gate-hardening.sql` (JÁ EXECUTADO, ver nota
    no início desta entrada):**
    - `comments_select_auth` (`USING(true)`, recuperação de 2026-06-06)
      ainda coexistia com a policy restritiva `"View comments active"` —
      MESMA classe de bug já corrigida pra `quotes` em 2026-09-03 (policies
      de SELECT são permissivas e somadas com OR: a solta sozinha já
      libera QUALQUER autenticado a ler comentário soft-deleted/moderado
      via PostgREST, tornando a restritiva inerte). SQL só faz o DROP —
      "View comments active" já cobre 100% dos casos legítimos.
    - `consent_log.user_id` (trilha de consentimento LGPD) era
      `ON DELETE CASCADE` — apagar a conta apagava a PRÓPRIA PROVA de que
      consentimento foi dado/revogado, na tabela criada pra servir de
      trilha. SQL troca pra `ON DELETE SET NULL` (mesmo padrão de
      `audit_log.actor_id`, já correto).
    - Push de COMENTÁRIO ainda mandava até 80 chars de texto cru pra tela
      de bloqueio — a redação de 2026-09-15 cobriu só `type='message'`;
      comentário caía no ELSE e mandava `notifications.body` verbatim.
      `dispatch_push_on_notification` recriada com um ramo próprio pra
      `'comment'` ("`<nome>` comentou no seu post", sem o texto).
      `notifications.body` (usado dentro do app) não muda.
  - **MEDIUM/LOW documentados, NÃO corrigidos nesta sessão (decisão de
    escopo — avaliar com o usuário se/quando priorizar):**
    - Nenhum audit trail (`audit_log`) pra maioria das escritas
      administrativas feitas PELO PORTAL (edição do prompt da IA do
      WhatsApp, tabela de preços, fotos de produto, Click Rua etc.) — o
      portal escreve direto no Supabase via RLS (`is_portal_admin()`),
      nunca passa pelas rotas Next.js que chamam `logAuditEvent`. Pra um
      recurso de mensageria automática pro cliente (o prompt da IA em
      particular), não existe registro de quem mudou o quê. Fechar isso
      de verdade é mudança de arquitetura (rota própria pro portal chamar,
      com log), não patch pontual.
    - TOCTOU na mensagem de ausência do WhatsApp
      (`whatsapp-ai-runner.ts enviarAusencia`): duas mensagens do cliente
      chegando em isolates diferentes quase ao mesmo tempo podem os dois
      lerem `away_at=null` antes de qualquer um gravar, e os dois mandarem
      a cortesia — duplicidade real, baixo impacto (mensagem educada
      repetida, não é dinheiro/preço). Mesma classe já corrigida pra
      `reserveReply`/`claim_wa_followup_nudge` no mesmo arquivo; falta
      aplicar aqui.
    - CSP com `script-src 'unsafe-inline'` sem nonce/hash — hoje sem
      sink explorável (o único `dangerouslySetInnerHTML` com dado de
      usuário já escapa por `sanitize.ts`), mas remove a CSP como rede de
      segurança pra uma regressão futura.
    - Link do PDF de orçamento (`quote-pdf-upload`) monta a origem a
      partir do Host da requisição, não de uma origem canônica fixa —
      baixo risco dado o roteamento do Cloudflare, mas é link mandado a
      CLIENTE de verdade por WhatsApp.
    - Sem reconciliação automática contra o Mercado Pago (cron que
      confira pagamento processado por eles mas nunca confirmado aqui por
      webhook perdido) — só investigação manual hoje.
    - Ação do CodeQL (`codeql.yml`) não fixada por SHA, único job com
      `security-events:write` fora do padrão de pin do resto do CI.
    - Cadeia `wrangler`→`sharp@0.33.5`/`undici`/`ws` com CVE HIGH — mesma
      classe já aceita pra `tar`/`vitest` (dev-only, não embarca no
      artefato). Dependências de PRODUÇÃO: **0 vulnerabilidades** (`npm
      audit --omit=dev`).
  - **Confirmado LIMPO / sem regressão em TODAS as 22 correções
    CRITICAL/HIGH históricas re-testadas** (RLS de quotes/orders/messages,
    proteção contra auto-promoção a admin, hijack de push token, `search_
    all` com teto, gates de PRO/IA fail-closed, MP webhook fail-closed,
    admin RSC auth, XSS/CSP, source maps, `getRuntimeEnv()`, normalização
    de telefone do WhatsApp, FK sweep de exclusão de conta, hash de CSAM
    do lado do servidor, fail-open só em 429, reservas atômicas de
    cota) — nenhum FAIL. Nenhuma cadeia de ataque nova (busca→IDOR,
    sessão obsoleta→ação privilegiada, injeção de prompt→efeito
    cross-user) encontrada.
  - **NOT VERIFIED (fora do alcance de código, listado pra não
    esconder a lacuna):** config de Auth do Supabase (JWT/MFA/leaked
    password — já checado em sessão de console anterior, não
    re-verificável daqui); OAuth PKCE ponta a ponta num aparelho real
    contra Google/Apple de verdade; se o gitleaks BINÁRIO acusaria algo
    (indisponível neste ambiente — proxy só libera npm/PyPI/Anthropic;
    fallback manual por grep não achou nada, mas não é o mesmo escopo);
    IAM/admins de todas as contas externas (GitHub/Cloudflare/Supabase/
    Firebase/Apple/Play/Codemagic/Meta/MP/Sentry/registrador) — só
    point-in-time de sessões anteriores, não re-conferido agora; restore
    de PITR nunca testado de verdade, só o procedimento documentado;
    se `migrations/2026-09-16-business-logic-security-audit.sql` (que já
    cobre boa parte de state-transition/self-farming) foi de fato
    EXECUTADA no Supabase — sem confirmação "JÁ EXECUTADO" explícita
    encontrada, ao contrário de toda outra migration deste arquivo;
    exploração real do gap de redirect-SSRF/DNS-rebinding (guard
    corrigido por revisão de código, não testado contra um alvo vivo).
  - **VEREDITO: READY WITH DOCUMENTED RISKS.** Sem CRITICAL. O único HIGH
    (Eruda) já está corrigido no código desta sessão. Não há bypass de
    FREE→PRO, USER→ADMIN, IDOR de service-role, nem vazamento cross-user
    confirmado. Falta rodar o SQL acima (3 blocos, idempotente) e decidir
    o que fazer com os MEDIUM/LOW não corrigidos (lista acima) — nenhum
    deles é bloqueante de release sozinho, mas ficam registrados aqui em
    vez de escondidos, seguindo a regra deste arquivo.
- **PENTEST INTEGRADO FINAL (2026-09-18, branch `claude/determined-volta-
  bo7wah`) — attack chaining, regressão, bypass, multi-layer. SQL
  `/migrations/2026-09-18-final-pentest-hardening.sql` — escrito e
  TESTADO PONTA A PONTA contra um Postgres 16 LOCAL (não a produção),
  e agora **JÁ EXECUTADO no Supabase de verdade também (2026-09-20,
  confirmado pelo usuário: as 8 linhas de conferência voltaram
  `ok=true`). Não pedir pra rodar de novo.** **Pegadinha real que
  aconteceu na primeira tentativa**: colar o SQL inteiro pelo celular
  (Supabase SQL Editor mobile) rodou sem erro de sintaxe, mas o
  `CREATE OR REPLACE FUNCTION public.get_feed_v2(...)` (achado A, a
  correção do IDOR) especificamente não pegou — os outros 7 itens do
  arquivo aplicaram normal. A checagem por item (não só um boolean
  agregado) foi o que revelou qual dos 8 tinha ficado pra trás; colar
  só essa função sozinha (sem o resto do arquivo em volta) resolveu.
  **Lição pro celular**: preview de arquivo anexado no chat pode estar
  VIRTUALIZADO (só renderiza o que está visível na tela) — "selecionar
  tudo" nesse preview pega só o trecho renderizado, não o arquivo
  inteiro. Colar como texto CRU direto na mensagem do chat (sem bloco
  de código, sem anexo) foi o que funcionou de forma confiável neste
  aparelho.** 4 agentes
  paralelos revalidaram (não presumiram) toda correção histórica
  relevante contra o código ATUAL, com foco em encadear achados
  pequenos em algo maior. 4 achados REAIS, NOVOS, com exploit provado
  localmente — os 4 corrigidos no mesmo SQL, sem quebrar nenhum fluxo
  legítimo (confirmado no harness: usuário não-bloqueado/verificado/
  adulto continua funcionando sem mudança nenhuma):
  - **A. [CRÍTICO, achado novo] `get_feed_v2` confiava no `p_user_id` que
    o CLIENTE manda** pra decidir `saved_by_me`/`liked_by_me` e pra
    aplicar a lista de `blocks` — é SECURITY DEFINER (ignora RLS) com
    GRANT pra `anon`+`authenticated`, e nunca conferia que o parâmetro é
    o mesmo `auth.uid()` de quem chama. **Exploit provado**: usuário B
    autenticado chama `rpc/get_feed_v2` passando o uuid do usuário A
    (público, aparece em toda URL de perfil/post) → resposta inclui
    `saved_by_me=true` pros posts que A salvou. `saved_posts` tem RLS
    dono-only em TODO outro caminho do app; este RPC era a única porta
    que vazava esse dado pra qualquer terceiro que soubesse o uuid de A.
    Fix: a função ignora `p_user_id` e deriva sempre de `auth.uid()` —
    mesma assinatura pública, zero mudança de comportamento (o client
    sempre passou o próprio id mesmo).
  - **B. [ALTO, achado novo] Bloqueio (`blocks`) nunca foi aplicado em
    NENHUM ponto de ESCRITA** — só filtra o feed, client-side, desde a
    Wave 21 (2026-06-09). `messages`/`follows`/`likes`/`comments`
    checavam só posse da própria linha no INSERT. **Exploit provado**: A
    bloqueia B; B continua conseguindo mandar mensagem, seguir, curtir e
    comentar o post de A via REST direto (ou cliente adulterado que pule
    `listBlockedIds()`). Fix: `blocked_between(a,b)` SECURITY DEFINER
    (checa as duas direções) entra no WITH CHECK das 4 tabelas. **Bug
    real achado testando a própria correção**: a 1ª versão escrevia
    `blocked_between(user_id, p.user_id)` dentro de um
    `EXISTS(...FROM posts p...)` — sem qualificar, o Postgres resolve
    `user_id` pro escopo MAIS INTERNO (`p.user_id`), virando
    `blocked_between(p.user_id, p.user_id)` — SEMPRE falso, nunca
    bloqueava ninguém, com a policy "certa" no olho. Só apareceu porque
    o exploit foi reproduzido DEPOIS do fix contra Postgres de verdade,
    não só lendo o SQL. Corrigido qualificando `likes.user_id`/
    `comments.user_id` explicitamente. **Lição de método: RLS com
    subquery correlacionada por tabela homônima de coluna precisa de
    teste executado, não revisão visual — o bug é invisível lendo o
    código.**
  - **C. [ALTO, achado novo] "E-mail confirmado" pra publicar/comentar/
    mandar mensagem era checagem 100% CLIENT-SIDE** (`AuthProvider.
    emailVerified`, testado em `usePublishPost`/`useComments.add`/
    `useSendMessage`). Não existe rota de servidor pra essas 3 ações —
    é tudo supabase-js direto do browser — então REST direto com o
    token de uma conta nunca confirmada publicava/comentava/mandava
    mensagem normalmente. Fix: `is_email_verified()` SECURITY DEFINER lê
    `auth.users.email_confirmed_at` pro `auth.uid()` atual; entra no
    WITH CHECK de INSERT de `posts`/`messages`/`comments`.
  - **D. [MÉDIO, achado novo, mitigação PARCIAL e deliberada] Age gate
    (`MIN_AGE=18`, `lib/schemas.ts`) é Zod, 100% client-side** — POST
    direto pra `/auth/v1/signup` (anon key é pública) com `birth_date`
    ausente ou uma data adulta FALSA pula tudo; `handle_new_user` só
    faz cast defensivo, nunca valida idade. O CHECK novo
    (`profiles_birth_date_min_age`) fecha só a fatia HONESTA: alguém
    que chama a API direto e AINDA informa a própria data real de
    menor. **Não impede quem mente sobre a própria idade** — nenhum
    sistema sem verificação de documento impede isso; é limitação
    inerente de autodeclaração, não bug de código. NULL passa sempre
    (OAuth grava `birth_date` só depois, em `/completar-perfil` — um
    CHECK que exigisse presença quebraria login Google/Apple).
  - **Erro de servidor cru NUNCA aparece pro usuário nem confirma o
    motivo**: `lib/errors-friendly.ts` ganhou um pattern pra
    `row-level security` → "Não foi possível concluir" — de propósito
    VAGO, porque confirmar "você foi bloqueado" ou "seu e-mail não está
    confirmado" pro REMETENTE é exatamente o dado que essas duas
    features existem pra não vazar.
  - **SVG upload — defesa em profundidade, achado do agente de AI-abuse/
    XSS.** `mimeConfiavel()`/`ehImagem()`/`provadoNaoImagem()`
    (`lib/utils/mediaType.ts`) passaram a recusar `image/svg+xml`
    EXPLICITAMENTE, em vez de só remover do mapa extensão→MIME — SVG
    carrega `<script>` executável, e o navegador declara
    `file.type='image/svg+xml'` sozinho pra um `.svg` de verdade (não
    depende de fallback de extensão pra passar, então só tirar do mapa
    não bastava). Nenhuma feature do app pede SVG de propósito; nenhum
    bucket declara `allowed_mime_types` com esse MIME hoje (não
    verificável a fundo do repo — é config de painel), mas o app agora
    recusa mesmo que um bucket seja reconfigurado no futuro.
  - **GAP ARQUITETURAL CRÍTICO, CONFIRMADO AINDA ABERTO (não corrigido
    às cegas nesta sessão, por decisão explícita — ver análise
    completa abaixo): insert direto em `posts` via PostgREST pula
    `/api/moderate`/`/api/moderate-video` inteiramente.** Dois agentes
    independentes reproduziram e confirmaram CRÍTICO: `status` tem
    `DEFAULT 'approved'`, a policy de INSERT (`supabase_init.sql`) só
    checa `auth.uid()=user_id`, sem restrição nenhuma de `status`. Um
    usuário autenticado comum (FREE, sem role especial) faz
    `POST /rest/v1/posts {status:'approved', media_url:'<qualquer
    coisa>', ...}` e o post vai pro feed público SEM passar por Gemini
    nem pela blocklist de hash CSAM (que só bloqueia hash JÁ conhecido —
    conteúdo novo passa igual). **Por que não foi fechado nesta sessão
    mesmo tendo Postgres local pra testar**: fechar de verdade (opção
    "força insert por RPC" / "trigger exige estado de moderação", ver
    item 223 do brief do pentest) exige UNIFICAR o fluxo de imagem
    (checa Gemini ANTES do insert, client-side) com o de vídeo
    (`createPost` já publica com `status:'approved'`; `/api/moderate-
    video` roda DEPOIS e só DERRUBA em `severity:'hard'` — modelo
    "publica e derruba", oposto ao de imagem) sob o MESMO modelo de
    "pending até aprovação server-side". Sem esse redesenho coordenado,
    forçar `status` pra `'pending'` em todo INSERT não-confiável
    prenderia posts de VÍDEO (que hoje publicam imediatamente) — uma
    regressão de publicação real, e não dá pra testar essa mudança
    ponta a ponta sem Supabase/browser ao vivo (que este ambiente não
    tem). A mesma decisão já tinha sido tomada, com a mesma
    justificativa, em DUAS sessões anteriores (auditoria de lógica de
    negócio 2026-09-16, PRs #325/#327) — reafirmada aqui depois de
    reconfirmar o exploit, não repetida por inércia.
    - **Opções avaliadas pra fechar de vez (nenhuma implementada
      às cegas)**: (1) RPC `create_post_secure(...)` SECURITY DEFINER
      + REVOKE do INSERT direto em `posts` pra `authenticated` — força
      todo insert a passar por uma função que já sabe o resultado da
      moderação; (2) trigger que sempre força `status:='pending'` pra
      role não-confiável + um segundo passo (chamado pelo
      `/api/moderate`/`/api/moderate-video` já existentes, com
      service_role) que promove pra `'approved'` só depois de rodar
      Gemini/hash de verdade — via um "carimbo" HMAC assinado pelo
      servidor (precisa de `pgcrypto`/segredo em `app_settings`,
      igual outros segredos do projeto) OU direto por
      `UPDATE ... status='approved'` com service_role (mesmo padrão já
      usado em avatar/art-reference `assertMediaApproved`); (3) fila
      de revisão passiva (`media_review_queue`) sem bloquear — avaliada
      e DESCARTADA: sem um sinal confiável de "isto passou por
      moderação" no banco, não dá pra distinguir post legítimo de
      insert direto, então a fila ficaria 100% cheia (todo post) e
      viraria ruído que ninguém revisa, não detecção de verdade.
      **Recomendação pra quem for implementar com acesso a Supabase/
      browser ao vivo**: opção (2), migrando vídeo pro mesmo modelo
      "pending → promovido por service_role" que imagem já teria,
      testando os DOIS fluxos (foto e vídeo) ponta a ponta antes de
      revogar o INSERT direto.
  - **Achados de MÉDIO/BAIXO, documentados e NÃO corrigidos nesta
    sessão (risco aceito ou fora de escopo seguro):**
    - Exclusão de conta sem trava de "exclusão em andamento": a janela
      entre o sweep de soft-delete e o `DELETE auth.users` final é de
      múltiplas chamadas HTTP sequenciais, não transação única — uma
      escrita concorrente (2ª aba, mensagem/upload/push em voo) nessa
      janela pode inserir linha não coberta pelo sweep, presa a um
      `user_id` que está sendo apagado. Fix recomendado: coluna
      `deletion_requested_at` + RLS checando ausência dela, ou
      re-rodar o sweep depois do `DELETE` final.
    - `whatsapp_ai_state.away_at` (cooldown de 12h da mensagem de
      ausência) é check-then-write, não atômico — sob rajada de
      webhooks concorrentes pode mandar a mensagem de ausência 2x.
      Impacto: mensagem duplicada, nenhuma fronteira de segurança
      quebrada. Fix trivial seria uma RPC atômica igual
      `bump_wa_ai_reply_count`, não feito por prioridade baixa.
    - `requirePro()` (usada por `gateProAI`) não considera
      `pro_grace_until`, diferente da RPC `is_pro_active()` (usada por
      `gateAiUsage`/`canSeeProFeature`). Falha FECHADA (usuário em
      grace period recebe 403 numa rota que deveria liberar) — é bug
      de produto, não brecha de segurança.
  - **DUAS migrations sem confirmação registrada de execução em
    produção, achado do agente de payments/webhooks — reforça a
    própria regra deste arquivo ("lista de pendência não é evidência"),
    desta vez com um exemplo concreto**: `/migrations/2026-09-16-
    business-logic-security-audit.sql` (a correção do CRÍTICO "PRO
    grátis pra sempre" — `pro_expires_at`/`pro_grace_until` sem
    proteção no `protect_profile_columns` antigo — e as RPCs atômicas
    `reserve_ai_usage`/`bump_wa_ai_reply_count`) e
    `/migrations/2026-09-17-rate-limit-sliding-window.sql` (substitui a
    janela fixa de 1 min do `check_rate_limit`, risco aceito
    documentado, por sliding window). **Nenhuma das duas está
    confirmada como executada no Supabase em lugar nenhum deste
    arquivo.** Enquanto não confirmadas: a brecha de PRO permanente
    grátis via `PATCH /rest/v1/profiles {"pro_expires_at":"2099-..."}`
    pode continuar aberta em produção mesmo com o código já mergeado —
    **confirmar isso é a ação mais urgente que sobra deste pentest.**
  - **4 agentes paralelos read-only revalidaram (não presumiram) as
    correções históricas citadas no brief do pentest** — RLS/IDOR/
    privilege escalation, payments/webhooks/AI-quota races, AI-abuse/
    SSRF/XSS/moderação, auth/session/mobile/account-lifecycle. Nenhuma
    regressão de achado histórico crítico/alto encontrada (proteção de
    campo PRO, auto-promoção a admin, PII de quotes, ownership de
    mensagens, path traversal de storage, sequestro de push token,
    rate-limit fail-open, exposição anônima do `search_all`, gate de
    IA, IAP fail-open, webhook de pagamento fail-open, auth de admin,
    XSS de busca, chave Gemini, source maps, bug de `process.env` no
    edge, normalização de telefone, correspondência fuzzy de
    destinatário, FK de exclusão de conta, CSP, enforcement de CSAM,
    fail-open de moderação, corrida de cota de IA/WhatsApp — todos
    PASS contra o código atual). Relatório completo (attack surface
    map, matrizes de achado histórico/cross-user/privilégio/Supabase
    direto/chain/business-logic/webhook/AI/rate-limit/mobile/
    privacidade, PoC de cada exploit) entregue no chat da sessão —
    não copiado pra arquivo por decisão de manter este `CLAUDE.md`
    enxuto, mesma regra já aplicada às auditorias anteriores.
  - Testes novos: `__tests__/lib/pentest-final-hardening.test.ts` (trava
    os 4 fixes do SQL, inclusive uma regressão específica pro bug de
    escopo do item B), 2 casos novos em `__tests__/utils/mediaType.test.ts`
    (SVG por extensão E por tipo declarado) e 1 em
    `__tests__/lib/errors-friendly.test.ts` (mensagem vaga de RLS).
    Suíte completa, typecheck, lint e `next build`/`build:cf` verdes
    antes do commit.

- **AUDITORIA DE PRIVACIDADE / LGPD PONTA A PONTA (2026-09-17, PR #359,
  branch `claude/funny-ramanujan-0zrao0`, mergeada 2026-09-19). SQL
  `/migrations/2026-09-17-privacy-audit-hardening.sql` — JÁ EXECUTADO no
  Supabase (2026-09-20, confirmado pelo usuário: as 14 linhas de
  conferência voltaram `ok=true`). Não pedir pra rodar de novo.** 6
  sub-auditorias paralelas (RLS/views/RPC, deleção de conta, fluxos a
  terceiros, storage local/mobile, logs/admin/moderação, política vs.
  realidade técnica).
  - **ACHADO CRÍTICO, confirmado por DUAS sub-auditorias independentes:
    `public.profiles` (tabela BASE, não a view) tinha policy de SELECT
    `USING (true)` SEM `TO authenticated`** — valia pra PUBLIC, incluindo
    `anon`. Qualquer um com a anon key (pública em todo bundle do app)
    baixava a tabela INTEIRA: email, phone, lat/lng, birth_date,
    `portal_access` (quem é admin), `is_pro`, `pro_expires_at`,
    `mp_preapproval_id`, etc. — de TODO usuário, sem login. Isso tornava
    a `profiles_public` (view curada, criada pra esconder essas colunas)
    uma formalidade sem efeito real. FIX: policy da tabela base virou
    dono-ou-admin; `profiles_public` foi recriada de propósito SEM
    `security_invoker` (roda com privilégio do criador, então continua
    projetando o subconjunto seguro de QUALQUER perfil mesmo com a
    tabela base fechada) — isso reabre o aviso "Security Definer View"
    do Security Advisor, aceito e documentado como trade-off correto.
  - **`role='admin'` também vazava** via `profiles_public`/`get_feed_v2`
    (reabria o mesmo vazamento que a Wave 32 de 2026-06-12 achava ter
    fechado removendo só `portal_access`) — `NULLIF(role,'admin')` na
    view fecha isso.
  - `get_feed_v2`/`get_trending_posts` (SECURITY DEFINER, GRANT pra
    `anon` herdado do modo visitante removido em 2026-06-18) ganharam
    teto de LIMIT + REVOKE anon, mesmo padrão do `search_all` de
    2026-09-13.
  - **Regressão corrigida em `search_all`**: o hardening de 2026-09-13
    tinha recriado a função a partir de uma versão mais antiga do corpo,
    perdendo sem querer as sentinelas anti-XSS do `ts_headline` (CRIT-3)
    e o match parcial/prefixo por nome — restaurado, mantendo o clamp/
    revoke. De quebra, passou a filtrar `posts.deleted_at IS NULL`
    (nunca filtrava antes).
  - Push de COMENTÁRIO passou a redigir o texto no corpo do push (mesmo
    tratamento que `type='message'` já tinha desde 2026-09-15).
  - RPC nova `quote_painter_contact(p_quote_id)` substitui a leitura
    direta de `profiles` que a tela `/orcamentos/[id]` fazia pro cliente
    ver contato do pintor — dependia da RLS aberta do achado crítico.
  - `cleanup_orphan_media()` passou a cobrir os buckets `avatars` e
    `art-refs` também (antes só `posts`) — foto de perfil de conta
    deletada ficava pública pra sempre, sem nenhum caminho de limpeza.
  - `cleanup_old_errors()` novo (tabela `errors`, 90 dias) + as 3
    funções de cleanup que existiam mas nunca tinham sido agendadas
    (`cleanup_rate_limits`, `cleanup_old_notifications`,
    `cleanup_old_audit_events`) foram pro pg_cron.
  - Trigger novo redige `title`/`body` de notificação quando o AUTOR da
    ação (quem curtiu/comentou/seguiu) tem a conta deletada depois.
  - Nota de reconciliação: esta migration e a
    `2026-09-18-final-pentest-hardening.sql` recriavam `get_feed_v2` de
    formas incompatíveis — a versão final reconciliada (IDOR + clamp +
    sem anon) ficou na do pentest, que roda DEPOIS desta.

- **AUDITORIA DE SECURITY LOGGING / MONITORING / ALERTING / AUDIT TRAILS
  (2026-09-17, PR #331, branch `claude/optimistic-davinci-h2ol1l`,
  mergeada 2026-09-19). SQL
  `/migrations/2026-09-17-security-observability-audit-trail.sql` — JÁ
  EXECUTADO no Supabase (2026-09-20, confirmado pelo usuário:
  `tentativa_bloqueada_e_auditada=true`, `role_change_auditado=true`,
  `crons_agendados_esperado_3=3`). Não pedir pra rodar de novo.**
  Pergunta que guiou a auditoria: "se alguém atacar ou abusar do
  sistema, conseguimos perceber, investigar e reconstruir sem vazar
  dado sensível?".
  - **Vários caminhos de segurança eram 100% silenciosos**: rate-limit
    hits, negação de quota de IA, rejeição de upload, assinatura de
    webhook inválida (WhatsApp e Mercado Pago), falha de envio de
    WhatsApp — e o mais grave, **tentativa de auto-escalada de
    privilégio (`role`/`is_pro`/`portal_access`) era revertida pelo
    trigger `protect_profile_columns` sem deixar rastro nenhum.** Agora
    a tentativa BLOQUEADA é gravada em `audit_events`
    (`security.privilege_escalation_blocked`) antes de ser revertida —
    mesmo comportamento de bloqueio, só ganhou trilha.
  - **`audit_profile_changes` nunca cobriu mudança de `role`** — só
    `is_pro`/`portal_access` tinham trilha old→new. Promoção/rebaixamento
    de admin feito por um admin de verdade (via `/api/admin/users`) não
    tinha registro nenhum de qual era o valor ANTERIOR. Agora
    `security.role_change` grava old_role/new_role.
  - Helper novo `lib/api/securityEvents.ts`: log estruturado (JSON de
    uma linha), convenção `dominio.assunto.verbo`, redação de secret por
    chave + PII por conteúdo (email/telefone/CPF/CNPJ/JWT/Bearer),
    defesa contra log injection, correlação por `x-request-id`, nunca
    lança. Plugado em `checkRateLimit`/`rejectOversizedBody`/
    `gateAiUsage`/`requireAuth`/webhooks do WhatsApp e MP/envio de
    WhatsApp.
  - `sentryBeforeSend` passou a filtrar também `breadcrumbs`,
    `request.url` (remove query string/fragment), `request.query_string`
    e `request.headers` (Authorization/Cookie → `[REDACTED]`) — antes só
    mascarava `user.email`/`request.data`/`extra`/`contexts`.
  - `docs/INCIDENT_RESPONSE.md` novo: runbooks §10.1–§10.12 por tipo de
    credencial/incidente (API key, service-role, GitHub, Cloudflare,
    Firebase, APNs, account takeover, admin compromise, payment/
    WhatsApp/AI abuse, data leak) + nota sobre ausência de kill switch
    central.
  - As 3 funções de cleanup (`cleanup_old_audit_events`,
    `cleanup_old_notifications`, `cleanup_rate_limits`) que já existiam
    como função mas nunca tinham sido agendadas via pg_cron foram pro ar.

- **AUDITORIA DE SEGURANÇA DE WEBHOOKS/CALLBACKS/INTEGRAÇÕES EXTERNAS
  (2026-09-17/18, PRs #328/#332/#333/#334/#335, TODAS MERGEADAS — o
  CÓDIGO está CONFIRMADO EM PRODUÇÃO (commit `7c4f24f`, verificado pelo
  usuário no painel do Cloudflare Pages).** Auditoria completa de Meta/
  WhatsApp Cloud API, Mercado Pago, Dualhook, Evolution legada, Firebase/
  FCM, push notifications, sob o modelo de ameaça "um atacante consegue
  falsificar, repetir, atrasar, reordenar ou manipular um evento externo
  pra causar uma ação que o sistema deveria aceitar só de um provider
  confiável?".
  - **RESSALVA (achado do Codex, revisão da PR #336): "código mergeado"
    e "SQL rodado" são coisas DIFERENTES, e esta entrada quase misturou
    as duas.** A confirmação de produção acima é só do deploy do CÓDIGO.
    A migration `/migrations/2026-09-17-whatsapp-followup-claim.sql`
    (RPC `claim_wa_followup_nudge`, ver PR #328 abaixo) **NÃO tem
    confirmação registrada de execução no Supabase** — "rodei o
    `run_whatsapp_followup`, veio ok" (que desbloqueou o rollout do #334)
    testou só a autenticação da rota com o segredo dedicado, uma
    migration DIFERENTE
    (`2026-09-18-whatsapp-followup-dedicated-secret.sql`), não esta RPC.
    **Enquanto ela não rodar, o próprio código já é fail-safe**: o
    comentário da migration documenta que `reservarReengajamento` trata
    RPC ausente (42883/PGRST202/erro de rede) como reserva NEGADA — ou
    seja, a fase de REENGAJAMENTO do follow-up automático fica PAUSADA
    em silêncio (não manda nada, não quebra, não avisa) até alguém
    confirmar que rodou. A fase de COBRANÇA não depende dessa RPC (usa
    PATCH condicional na linha de `portal_alerts`, que já existe sempre)
    — só o reengajamento é afetado.
  - **PR #328 — dois achados reais corrigidos:**
    - **SSRF crítico em `/api/push-notify`**: `push_subscriptions.endpoint`
      é gravado pelo CLIENTE (RLS só garante `user_id=auth.uid()`, nunca
      que o valor é um push service de verdade) e o handler fazia
      `fetch(sub.endpoint,…)` sem checar nada — qualquer usuário
      autenticado podia apontar o próprio endpoint pra URL arbitrária
      (metadado de nuvem, rede interna) e o edge emitiria um POST
      autenticado (JWT VAPID nosso) pra lá. Fix: allowlist de hostname
      pros provedores reais de Web Push (`lib/api/_services/
      push-endpoint-guard.ts`) — só `fcm.googleapis.com`,
      `android.googleapis.com`, `updates.push.services.mozilla.com`,
      `web.push.apple.com`, `*.notify.windows.com`/`*.wns.windows.com`,
      sempre `https://`.
    - **Bug de corretude achado ESCREVENDO o teste do item acima**: o
      DER/PKCS8 manual do `VAPID_PRIVATE_KEY` tinha dois comprimentos
      ASN.1 errados (tamanho TOTAL da estrutura em vez do CONTEÚDO) — Web
      Push nativo podia estar silenciosamente morto em produção
      (`sent:0` indistinguível de "sem inscritos"). Corrigido junto.
    - **Duplicidade de efeito colateral externo no WhatsApp**: o
      atendimento automático (IA) rodava pra TODA mensagem recebida sem
      checar se o wamid já tinha sido processado — reentrega da Meta/
      Dualhook (normal, documentado) ou replay de quem tem o segredo de
      URL mandava uma SEGUNDA resposta de verdade pro cliente. Fix:
      `persistInboundMessage` usa `INSERT … ON CONFLICT DO NOTHING` +
      `return=representation` (atômico no Postgres, sem corrida
      check-then-act) pra só deixar `maybeAutoReply` rodar em wamid
      REALMENTE novo. **Gap achado pelo Codex na revisão da PR #336,
      corrigido na mesma PR**: a checagem original só pulava a IA em
      `'duplicate'`, não em `'error'` — se a 1ª entrega falhasse ao
      persistir (timeout/rede, sem gravar o wamid) a IA rodava mesmo
      assim, e a REENTREGA seguinte (que persiste com sucesso) não via
      `'duplicate'` porque não havia registro nenhum ainda: rodava a IA
      de novo, duplicando a resposta pelo lado da FALHA em vez do
      sucesso repetido. Agora é fail-closed: só roda quando o resultado é
      exatamente `'inserted'` — `'duplicate'` e `'error'` os dois pulam.
      Teste de regressão em `__tests__/api/whatsapp-webhook.test.ts`
      (falha sem o fix, confirmado revertendo-o).
    - **Mesma classe de corrida na varredura de follow-up horária**:
      1ª versão do PR só tinha trava de reentrância por isolate + rate
      limit — **Codex achou (P1) que isso não fecha entre isolates
      DIFERENTES do Cloudflare**, e estava certo. Fix final: reserva
      ATÔMICA no banco ANTES do envio — PATCH condicional
      `followed_up_at=is.null` pra cobrança (linha já existe) e RPC nova
      `claim_wa_followup_nudge` (`INSERT…ON CONFLICT DO UPDATE…WHERE
      <fora do cooldown> RETURNING`) pra reengajamento (linha pode não
      existir ainda). Provado com teste de **isolates de verdade**
      (`vi.resetModules()` + import dinâmico = duas instâncias de módulo
      sem NENHUMA trava em memória em comum).
  - **PR #332 — limpeza do código morto do cliente Evolution API**
    (feita separada de propósito, pra não misturar achado de segurança
    com remoção de código): `whatsapp-evo.ts` ficou só com
    `normalizeWhatsAppTarget` (ainda usada pelo envio via Cloud API);
    `whatsapp-media.ts` perdeu o caminho de mídia via base64-no-webhook
    (a Cloud API/Dualhook usa outro, `baixarMidiaCloudApi`); rota morta
    `/api/whatsapp-evo/ping` removida. Zero call site vivo fora dos
    próprios arquivos e testes, confirmado por grep antes de cada remoção.
  - **Achado L3 (raio de vazamento do segredo do follow-up) — rollout
    combinado com o usuário em 3 PRs, um passo de cada vez:**
    - **#333**: registra no repo o `UPDATE` que o usuário já tinha rodado
      no Supabase (trocar `app_settings.whatsapp_followup_url` pro
      `?token=` do segredo dedicado `WHATSAPP_FOLLOWUP_URL_SECRET`,
      gerado com `openssl rand -hex 24`, cadastrado no Cloudflare Pages).
    - **#334**: SÓ DEPOIS do usuário confirmar em produção
      (`run_whatsapp_followup()` rodado à mão com o token novo, resultado
      ok), remove os fallbacks pro `WHATSAPP_WEBHOOK_URL_SECRET` (do
      webhook) e pro `EVOLUTION_WEBHOOK_TOKEN` (Evolution, já morta) —
      fecha o achado original de vez: reusar o segredo do webhook
      funcionava mas aumentava o raio de um vazamento.
    - **#335**: Codex revisou o #334 (P2) e achou que `.env.example` não
      documentava `WHATSAPP_FOLLOWUP_URL_SECRET` — numa instalação
      fresca, o cron levaria 401 pra sempre sem ninguém saber por quê.
      Investigando, o problema era maior: `.env.example` **ainda listava
      a Evolution API inteira** (código morto desde o #332) e não tinha
      NENHUMA env real da WhatsApp Cloud API/Dualhook. Corrigido
      substituindo a seção inteira pelas 6 envs realmente lidas por
      `getRuntimeEnv()` hoje (`DUALHOOK_API_KEY`,
      `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`,
      `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WEBHOOK_URL_SECRET`,
      `WHATSAPP_FOLLOWUP_URL_SECRET`).
  - **Verificado, sem achado**: `MP_WEBHOOK_SECRET` (Mercado Pago) já
    bem protegido (HMAC timing-safe, janela anti-replay 600s, sempre
    busca o estado LIVE do pagamento na API do MP em vez de confiar no
    corpo do webhook); `/api/quote-pdf-upload`, `/api/reverse-geocode`,
    `moderate-video.ts`, `/api/upload-style-ref` sem SSRF explorável
    (guard de host já existente ou input não é URL de terceiro).
  - **Achado L2 corrigido no mesmo PR (#328)**: `brand-logos.ts` baixava
    a URL que a resposta da IA (OpenAI) devolve quando não manda base64,
    sem checar host — resposta de provider é dado estruturado, não
    comando confiável. `lib/api/ssrf-guard.ts` (blocklist de IPv4/IPv6
    privado/reservado/CGNAT, escolhida em vez de allowlist porque o
    conjunto de hosts de imagem da OpenAI não é fechado/estável) bloqueia
    antes do fetch.
  - **LIÇÃO DE PROCESSO, corrigida NA HORA em vez de repetida**: o
    `CLAUDE.md` já tinha uma entrada inteira reclamando de uma sessão
    anterior que fez auditoria de segurança real e não registrou aqui.
    Esta sessão fez o mesmo trabalho de auditoria+fix+rollout em 5 PRs e
    só documentou tudo ao FINAL, depois do usuário perguntar "confirma
    que o deploy saiu certo" — ou seja, quase repetiu o erro. Registrado
    agora, imediatamente após a confirmação de produção, não deixado pra
    uma sessão futura notar a lacuna.
  - Lista completa de matrizes (Integration Map, Webhook Security Matrix,
    Provider Trust Matrix, Side Effect Matrix, Retry Matrix, Event
    Ordering Matrix, Outbound Request Matrix) entregue no chat da sessão
    original; não copiada pra arquivo por decisão de manter este
    `CLAUDE.md` enxuto — mesma regra já aplicada à auditoria Cloudflare de
    13/09.
- **DNSSEC de `queroumacor.com.br` FECHADO (2026-09-17) — DS record
  publicado na Registro.br.** Última pendência do item aberto em
  2026-09-16 (3ª rodada Cloudflare, ver entrada mais abaixo): o DNSSEC
  estava "ligado" só do lado Cloudflare, sem proteger nada até o
  registrador publicar o DS. **Confirmado pelo usuário**: pegou o DS
  record em Cloudflare → DNS → Settings → DNSSEC (Key Tag `2371`,
  Algoritmo `13`, Digest Type `2` / SHA-256, Digest
  `622EAF7E13F810DC8DFE5A78127EC1EDEB19CCAE3398EE0CB4AB758D003E6CE7`),
  publicou no formulário "Alterar servidores DNS → + DNSSEC" da
  Registro.br, que confirmou "DNS atualizado com sucesso!". Propagação
  estimada pelo Cloudflare: 10min-1h. **Não pedir pra reconfirmar antes
  dessa janela** — depois dela, o jeito de checar é Cloudflare → DNS →
  Settings → DNSSEC mostrando "Status: Active" (não só "Enabled").
  Fecha o item 10 (MEDIUM) da auditoria externa de identidade abaixo.

- **AUDITORIA EXTERNA DE IDENTIDADE E CONTAS ADMINISTRATIVAS (2026-09-17,
  branch `claude/inspiring-thompson-yh6hc9`) — diferente das auditorias
  de RLS/código acima: aqui o escopo é IAM/MFA/recovery/break-glass de
  TODA a infraestrutura externa (GitHub, Cloudflare, Supabase, GCP/
  Firebase, Apple Developer, Google Play, Codemagic, Sentry, Meta/
  WhatsApp/Dualhook, Mercado Pago, Google AI Studio, registrars,
  e-mail). Entregue em `docs/EXTERNAL_SECURITY_BASELINE.md` (inventário +
  matrizes + achados) e `docs/ACCOUNT_RECOVERY_RUNBOOK.md` (break-glass +
  tabletops + ordem de rotação de emergência). Detalhe completo em
  `SECURITY_AUDIT_LOG.md`.**
  - **Sessão sem browser/console** — só GitHub via API (verificado agora:
    repo é conta pessoal, não org; 2 collaborators —
    `queroumacor-max` admin/dono, `jacksongmatos` write, nenhum
    desconhecido; 8 workflows todos com `permissions:` explícito, sem
    `pull_request_target`, actions de terceiro pinadas por SHA) e o
    histórico já registrado neste arquivo (verificações de console de
    sessões anteriores). **Tentei até DNS público (sem login nenhum) via
    DoH — o proxy de rede do ambiente bloqueou com 403.** Todo o resto
    (Cloudflare, Supabase, GCP além do já registrado, Apple além do já
    registrado, Play, Codemagic, Sentry, Meta, Mercado Pago, os 2
    registrars) ficou `NOT VERIFIED`, nunca presumido PASS.
  - **CRITICAL, não corrigido (decisão do usuário)**: `queroumacor@gmail.com`
    (presumido — é a identidade usada em toda verificação de console já
    feita) parece concentrar Firebase/GCP, Google AI Studio (INCLUSIVE um
    projeto de outra empresa, "JR Erp"), Apple Developer Account Holder e
    provavelmente Cloudflare/Play — **sem 2º admin confirmado em nenhum
    exceto o Apple** (`beatrisporsebon@icloud.com`, já confirmado
    intencional em 2026-09-16). Maior single point of failure do
    sistema.
  - **HIGH, achados novos desta auditoria**: **Dualhook** (o proxy que
    intermedeia TODO o WhatsApp desde 2026-09-05) não estava no
    inventário de serviços externos do usuário — vendor com acesso total
    ao número oficial, sem MFA/rotação documentados; **Evolution API**
    (Render, "aposentada" 2026-09-05) tem env vars ainda em
    `.env.example` e NENHUMA confirmação de que a instância no Render foi
    desligada/revogada — candidata clássica a serviço esquecido com
    credencial viva; `MP_ACCESS_TOKEN` de produção segue no código sem
    call-site de UI ativa.
  - **Nada foi rotacionado/revogado/alterado automaticamente.** `FINAL
    STATUS`: **HIGH ACCOUNT-TAKEOVER RISK** (concentração de identidade +
    MFA não confirmado em nenhum dos 12 provedores externos críticos +
    Evolution API dormant não resolvida + nenhum break-glass em nenhum
    provedor). Ações manuais ficam listadas nos dois documentos novos.
- **AUDITORIA DE DISASTER RECOVERY / BUSINESS CONTINUITY (2026-09-17,
  branch `claude/elegant-mayer-a04g5h`). Relatório completo em
  `docs/DR_AUDIT_2026-09-17.md`; runbooks operacionais em
  `docs/DR_RUNBOOK.md`. Status final: PARTIALLY RESILIENT.** Pergunta
  central: "se perdermos banco/storage/deploy/secrets/conta admin/um
  provider inteiro, dá pra restaurar de forma segura e previsível?" —
  ainda não totalmente, e os motivos ficam documentados, não escondidos.
  - **SEGUNDA RODADA (mesma sessão, pedido do usuário "corrija o que
    for possível no código"): os 2 achados abaixo ganharam correção de
    código, sem esperar decisão de produto.** `next-app/lib/
    drAuditTrail.ts` (`captureDrAuditEvent`, fail-safe, mesmo padrão de
    `lib/api/errors.ts`) espelha no Sentry — sistema EXTERNO ao
    Postgres, não rola pra trás junto com um PITR restore — os dois
    eventos abaixo. Replicar só hash/id/categoria/timestamp (nunca
    conteúdo) é o mesmo princípio das listas de hash do NCMEC — não
    precisou de decisão de compliance pra ser seguro. **Limite que
    continua em aberto**: isto é um SINAL pra reconciliação MANUAL, não
    um job automático — depois de um restore, alguém ainda precisa
    procurar `dr_audit:account_deletion`/`dr_audit:media_hash_blocked`
    no Sentry e reaplicar à mão. Também não cobre a exclusão de conta
    feita direto pela RPC a partir do **portal vanilla**
    (`public/portal/app.js` chama `admin_delete_user` via supabase-js
    sem passar por `next-app`) — instrumentar isso exigiria recompilar
    o bundle do portal e refazer o hash SRI, o que este ambiente não
    tem como validar com segurança, então ficou de fora.
  - **2 achados CRITICAL/HIGH de fundo, mitigados mas SEM reconciliação
    automática** (a correção acima dá o sinal externo; reaplicar
    continua manual): (1) um PITR restore pra antes de um hash ser
    bloqueado em `media_hash_blocklist` reverte a proteção CSAM —
    `blockMediaPermanent`/`escalateToNcmec` (`lib/services/
    mediaReviewAdmin.ts`) agora capturam o evento; (2) restore pra
    antes de uma exclusão de conta ressuscita a conta — os dois
    caminhos de `next-app` (`/api/delete-account` e a rota admin)
    agora capturam o evento, além do `deletion_tombstones` (mesma DB).
  - **Correção de código aplicada** (`/migrations/
    2026-09-17-dr-deletion-tombstone-and-integrity.sql` — **JÁ EXECUTADO
    no Supabase (2026-09-20, confirmado pelo usuário: `deletion_tombstones`
    existe com RLS habilitada, `admin_delete_user` e `dr_integrity_report`
    existem, e a primeira grava tombstone antes do delete). Não pedir pra
    rodar de novo.**):
    tabela `deletion_tombstones` (ledger append-only, sem NENHUMA
    policy de UPDATE/DELETE pra ninguém logado — só SECURITY DEFINER
    escreve), `admin_delete_user` recriado (mesma assinatura/guardas)
    pra gravar nela antes do delete; e `dr_integrity_report()`, função
    read-only admin-gated que fecha uma lacuna real confirmada pela
    auditoria — **não existia NENHUMA checagem de reconciliação
    Storage↔DB na direção "banco referencia arquivo que sumiu do
    bucket"**, só a oposta (`cleanup_orphan_media()`, que já existia).
    Rodar `select * from public.dr_integrity_report();` como parte de
    qualquer restore, e como checagem periódica de saúde.
  - **`docs/RUNBOOK.md` ganhou aviso**: NUNCA rodar
    `execute_cleanup_orphan_media()` logo depois de um restore parcial
    (PITR do Postgres e Storage do Supabase não são garantidamente
    restaurados no mesmo instante — a janela pode fazer a limpeza
    apagar mídia de post que "ainda não existe" no banco recém-
    restaurado, mas vai voltar a existir assim que a reconciliação
    terminar).
  - **`.github/workflows/rollback.yml` tinha uma afirmação FALSA** no
    passo final ("deploy.yml vai rodar automaticamente") — `deploy.yml`
    é `workflow_dispatch`-only, quem redeploya a versão antiga é o
    Cloudflare Pages Git integration observando `main` direto. Corrigido
    a mensagem; travado por teste novo
    (`__tests__/dr/rollbackWorkflowSafety.test.ts`) pra não regredir.
  - **Mitigados com guarda de código (2ª rodada), mas o hazard de fundo
    continua exigindo disciplina manual/ferramenta melhor**: replay
    ingênuo das 101 migrations em ordem de arquivo REGRIDE
    `get_feed_v2` e `is_portal_admin()` pra versões supersedidas —
    `__tests__/dr/migrationCanonicalOrder.test.ts` (novo) trava o
    conjunto EXATO de arquivos que redefinem essas duas funções e falha
    se um novo arquivo redefinir sem atualizar conscientemente
    `migrations/MIGRATIONS.md`; corrigir o hazard DE VERDADE (não só
    detectar regressão silenciosa) ainda exige ferramenta de migration
    real, fora de escopo. Nenhum dump lógico independente do banco
    existia — `scripts/dr/pg-logical-backup.sh` (novo) fecha isso:
    script MANUAL (nunca CI, de propósito — ver comentário no
    arquivo), `pg_dump --schema-only` por padrão (dado real só com
    `--with-data` explícito), output `chmod 600`, checksum SHA-256,
    nunca ecoa a connection string, remove dump parcial se falhar.
    `__tests__/dr/backupScriptSafety.test.ts` (novo, 9 casos) valida
    essas propriedades e roda o script de verdade contra uma falha
    esperada.
  - **Achados confirmados, sem correção de código possível nesta
    sessão** (documentados em detalhe no relatório): Supabase Storage
    **sem backup confirmável** (PITR cobre só o Postgres — Storage é
    MANUAL VERIFICATION, pode não ter proteção nenhuma); 2 buckets
    (`art-refs`, `style-refs`) existem só no dashboard, nunca em
    migration versionada; `audit_log` sem cópia fora do Postgres pra
    TODO tipo de evento (só exclusão de conta e bloqueio CSAM ganharam
    espelho externo nesta sessão — o resto do `audit_log` continua só
    no Postgres); `supabase_init.sql` desatualizado desde 2026-09-07
    (achado já conhecido de auditoria anterior, não piorado nem
    corrigido aqui); owner único (Jackson) pra GitHub/Cloudflare/
    Supabase/Codemagic/Google Play/Firebase — só Apple Developer tem
    segundo admin documentado (Beatris, já confirmado intencional).
  - **Confirmado SEGURO por desenho, sem ação necessária**: Mercado
    Pago é tratado como fonte de verdade a cada webhook (`GET
    /v1/payments/{id}`/`GET /preapproval/{id}` ao vivo), então um
    restore de banco reconcilia sozinho sem duplicar benefício — o
    único domínio do audit com reconciliação automática completa;
    `message_id UNIQUE` faz reenvio do WhatsApp/Meta ser idempotente
    pra mensagem em si; push é `AFTER INSERT`-driven sem fila
    persistente, então não há replay fantasma num restore;
    `requirePro`/`gateAiUsage`/webhook do MP são fail-closed em
    produção (reconfirmado no código atual, não só por citação do
    CLAUDE.md); nenhum secret real nem dump de produção commitado no
    histórico do git (varredura completa, incluindo `git log --all
    --diff-filter=A`) — trava nova, `__tests__/dr/
    noCommittedBackupArtifacts.test.ts`, pra isso continuar verdade.
  - **RISCO HIGH sem correção automática, exige checagem manual**:
    opt-out de WhatsApp (`opted_out_at`) pode reverter num restore —
    se o Meta/Dualhook reenviar ou o cliente escrever de novo depois
    do restore, o runner pode tratar como opt-in outra vez. Nunca
    reabrir IA/follow-up automático logo após um restore sem checar
    manualmente quem pediu PARE no intervalo (fora do nosso banco, nos
    logs do Dualhook).
  - **986 contatos reais (`migrations/2026-08-29-import-leads-planilha.sql`)
    seguem commitados permanentemente no histórico do git** — não é
    achado novo de disponibilidade, mas relevante pra DR: qualquer
    estratégia de "clone do repo é backup" também propaga esse dado
    pra onde o repo for clonado. Não removido (reescrever histórico do
    git é decisão do usuário, fora do escopo desta sessão).
  - **RPO/RTO NÃO estão definidos como decisão de negócio** — a
    tabela de propostas em `docs/DR_AUDIT_2026-09-17.md §5` marca
    `BUSINESS DECISION REQUIRED`, não inventa meta.
  - Suíte completa (185 arquivos / 2307 testes, após a 2ª rodada),
    typecheck e `next build` verdes com as mudanças desta auditoria.

- **AUDITORIA DE SEGURANÇA DA PIPELINE CI/CD (2026-09-16, commit `bfa6849`,
  merge #318 `claude/keen-bell-vyn38f`) — MERGEADA SEM REGISTRO NESTE
  ARQUIVO, DOCUMENTADA AGORA EM 2026-09-17 pra fechar a lacuna.** Auditoria
  completa da pipeline (GitHub Actions, supply chain, dependências) sob o
  modelo de ameaça "PR de fork controla arquivos/deps/scripts, tenta ler
  secret ou publicar artifact malicioso". **Tudo corrigido no mesmo
  commit, nada ficou pra depois:**
  - `deploy.yml` **parava de passar `SUPABASE_SERVICE_ROLE_KEY`** pro
    ambiente do `next build` — desnecessário (o edge lê essa chave via
    `getRuntimeEnv()` em RUNTIME, nunca em build-time) e reduzia o que um
    `postinstall` malicioso já mergeado em `main` conseguiria exfiltrar.
  - **Actions de terceiros pinadas por commit SHA completo** (antes em tag
    mutável `@v3`/`@v2`/`@v0.13.0`/`@v1`): `cloudflare/wrangler-action`,
    `gitleaks/gitleaks-action`, `zaproxy/action-baseline`,
    `grafana/setup-k6-action` — as quatro têm acesso a secret ou rodam
    dentro do CI.
  - `npm install` → **`npm ci`** em `deploy.yml` e `ios-screenshots.yml`
    (respeita o lockfile de forma determinística).
  - **`persist-credentials: false`** nos checkouts de jobs que nunca dão
    push (`ci`, `deploy`, `security`, `load-test`, `ios-screenshots`) —
    reduz o que um script malicioso na etapa de install/build consegue
    fazer com o `GITHUB_TOKEN`.
  - `rollback.yml` **interpolava `${{ github.event.inputs.* }}` direto em
    `run:`** (padrão de shell injection, mesmo sendo input de quem já tem
    permissão de escrita) — movido pra `env:`; `target_sha` começando com
    `-` agora é recusado (argument injection em `git reset --hard`).
  - `.gitleaksignore` **documentava a chave Gemini vazada como "rotação
    pendente"** — desatualizado frente à confirmação já registrada aqui
    em 2026-09-16 de que a chave vazada não existe mais na conta.
  - **`sharp` 0.34.5 → 0.35.4** via `npm audit fix` (não-forçado): fecha a
    única CVE HIGH de dependência de produção com fix não-breaking.
    Validado com `npm ci` limpo + suíte completa (169 arquivos/2160
    testes) + typecheck + lint + `next build`, todos verdes.
  - **Scanners novos**: `.github/workflows/codeql.yml` (SAST, javascript-
    typescript — não existia; só havia `npm audit` e `gitleaks`, nada
    olhava o CÓDIGO em si), job `sbom` em `security.yml` (SBOM CycloneDX
    do `next-app`, `--package-lock-only`, sem instalar `node_modules` nem
    rodar script — artifact interno, não publicado), `.github/SECURITY.md`
    (canal de reporte de vulnerabilidade que não existia:
    `loja@calicolors.com.br`).
  - **Confirmado, já correto, sem mudança**: nenhum workflow usa
    `pull_request_target`; `pull_request` (`ci.yml`, `security.yml`) roda
    com `GITHUB_TOKEN` read-only padrão, sem secret exposto a PR de fork;
    `deploy.yml` só dispara por `workflow_dispatch` com `if: github.ref ==
    'refs/heads/main'`; `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` já são STEP-
    scoped (só no step do `wrangler-action`, nunca em install/build).
  - **O commit citava "ver relatório" pra permissões de organização/
    branch protection — esse relatório nunca saiu do chat daquela sessão,
    não estava em lugar nenhum do repo.** Conferido À MÃO em 2026-09-17:
    **só 2 colaboradores no repo** — `jacksongmatos` (write) e
    `queroumacor-max` (admin, dono) — nenhum externo/desconhecido; branch
    protection do `main` com o check `validate` obrigatório já era
    conhecido (confirmado antes pela recusa `405 Required status check`
    em merges anteriores). **Nada pendente aí também.**
  - **LIÇÃO DE PROCESSO, não de segurança**: essa sessão fez uma auditoria
    real e completa, mas não seguiu a própria regra do
    `SECURITY_AUDIT_LOG.md` ("toda vez que uma sessão fizer auditoria de
    segurança, registrar aqui") — o trabalho ficou invisível pra memória
    do projeto até esta entrada. Merge #318 chegou direto na `main` sem
    passar pelas duas outras entradas de doc-sync que vieram depois (SSL/
    TLS, DNSSEC/CAA) — nenhuma delas sabia que essa auditoria existia.

- **MODERAÇÃO GEMINI NO PUBLISH + BLOCKLIST DE HASH CSAM EM AVATAR/ART-
  REFERENCES (2026-09-17, PR #325, fecha as 2 pendências deixadas em
  aberto pela auditoria de lógica de negócio de 2026-09-16 — ver entrada
  "AUDITORIA DE SEGURANÇA DE LÓGICA DE NEGÓCIO" mais abaixo). SQL
  `/migrations/2026-09-17-moderation-quota-and-media-hash-coverage.sql`
  — JÁ EXECUTADO no Supabase (2026-09-17, confirmado pelo usuário: as 6
  linhas de conferência voltaram `ok=true`). Não pedir pra rodar de
  novo.**
  - **`usePublishPost` passou a chamar `/api/moderate` de verdade.** Até
    aqui, publicar não passava por NENHUMA triagem de conteúdo novo — só
    reenvio de mídia JÁ presente na `media_hash_blocklist` era barrado,
    e isso pelo trigger do banco (seção H da auditoria 2026-09-16), não
    pela aplicação. Cobre TODA foto do carrossel, não só a primeira
    (achado de revisão automática/Codex: fotos 2-5 furavam tanto o
    Gemini quanto a blocklist); a legenda só é reenviada na checagem da
    1ª foto (não gasta cota reanalisando o mesmo texto 5x). Bloqueia
    publicar quando `flagged`/`approved:false`.
  - **Vídeo ganhou moderação de verdade também.** `/api/moderate-video`
    existia PRONTO desde o RELEASE_AUDIT (item C4) — relê `media_url`
    autoritativo do banco, roda Gemini frame-a-frame, apaga a linha +
    o storage se `severity:'hard'` — mas nunca tinha NENHUM caller
    (achado do Codex: "the endpoint merely exists"). `usePublishPost`
    chama ele com `{postId, caption}` depois de `createPost`.
    `'pending'`/infra indisponível não bloqueia o publish (o post já
    existe) — mas **todo caminho `'pending'` (soft/flagged, download
    falhou, análise indisponível, vídeo grande) agora ENFILEIRA de
    verdade em `media_review_queue`** (2ª rodada de revisão do Codex,
    na própria PR de documentação #327: `moderateVideoPost` devolvia
    `'pending'` sem gravar NADA — um dos textos dizia "enviado para
    revisão humana" e não enviava, o post ficava aprovado e público pra
    sempre sem ninguém olhar). Isso fecha a lacuna — antes só o caminho
    de imagem (`/api/moderate`) enfileirava.
  - **Moderação ganhou cota PRÓPRIA, separada da cota geral de IA.**
    `gateAiUsage` já passava `feature:'moderate'`/`'moderate_video'`,
    mas `reserve_ai_usage` soma TODO uso do mês sem filtrar por feature
    — moderação ia consumir a MESMA cota de chat/legenda/Alice/Seu Zé
    que o usuário escolheu gastar em outra coisa, assim que o publish
    passasse a chamá-la em todo post. RPC nova `reserve_moderation_usage`
    (irmã de `reserve_ai_usage`, mesmo padrão atômico com advisory lock)
    soma só a própria feature; teto de 1000/mês — backstop de abuso, não
    limite de produto.
  - **429 (rate limit/cota) deixou de ser fail-open** (achado do Codex):
    o código original tratava QUALQUER `!res.ok` — incluindo 429 —
    como "infra fora do ar, segue sem bloquear". Estourar de propósito o
    rate limit de `/api/moderate` (20/min) ou a cota nova virava um jeito
    de publicar sem moderação nenhuma. Agora só 429 bloqueia (o servidor
    respondeu "não agora", não é falha de infra) — **qualquer OUTRA
    resposta não-2xx (503 sem `GEMINI_API_KEY`, mas também 400/401/403/
    500 e erro de rede/parse) segue fail-open**, não só 503 como uma
    versão anterior desta nota chegou a dizer (correção de precisão,
    achado de 2ª rodada do Codex — o código sempre foi assim, só o
    TEXTO estava incompleto). Ampliar o fail-closed pra além de 429 é
    decisão de produto em aberto, não feita aqui. Lógica em
    `lib/services/moderateMedia.ts` (`assertMediaApproved`), reusada por
    publish, avatar e art-references.
  - **Blocklist de hash CSAM estendida a avatar e à biblioteca de artes
    do AR Grafite** (`profiles.avatar_hash`, `art_references.image_hash`
    + triggers `enforce_avatar_hash_blocklist`/
    `enforce_art_reference_hash_blocklist`, mesmo padrão de
    `enforce_media_hash_blocklist` em `posts`, mesma tabela
    `media_hash_blocklist` — não é uma blocklist nova). **Mas a defesa
    de verdade não é o trigger** (achado do Codex: o trigger confia no
    hash que o CLIENTE manda, e RLS deixa o dono escrever a própria
    linha via PostgREST direto — falsificável só de não mandar o hash
    certo) — `uploadAvatar` (editar perfil e signup) e
    `uploadArtReference` agora chamam `assertMediaApproved` ANTES de
    persistir a linha, que baixa o arquivo e calcula o hash NO SERVIDOR
    a partir dos bytes reais. Reprovado → a linha nunca é gravada.
    **`uploadArtReference` já apagava o arquivo do storage nesse caso;
    `uploadAvatar` NÃO apagava** (2ª rodada de revisão do Codex, na
    própria PR de documentação #327: o primeiro texto desta entrada
    afirmava "o arquivo é removido" pros dois, e só era verdade pra
    art-references — avatar reprovado ficava pra sempre no bucket
    público `avatars`/`posts`). `removeUploadedAvatar` (nova, em
    `lib/services/profile.ts`, detecta o bucket pela própria URL
    pública) fecha isso nos dois call sites (editar perfil e signup).
    O trigger fica como defesa em profundidade contra bypass direto da
    API — mesmo trade-off que `posts.media_hash` sempre teve, não
    resolvido aqui (exigiria a extensão `http`/`pg_net` fazendo fetch
    dentro do Postgres).
  - Hash SHA-256 (client-side) extraído de dentro de `posts.ts` pra
    `lib/utils/sha256.ts` (`sha256Hex`), compartilhado entre posts,
    avatar e art-references — antes era código duplicável.
  - **GAP CONHECIDO, NÃO FECHADO: inserir em `posts` direto via
    PostgREST pula `/api/moderate` inteiro.** Tudo acima
    (`usePublishPost`) é orquestração do CLIENTE — protege quem publica
    pela UI normal, mas `supabase_init.sql` segue deixando qualquer
    `authenticated` inserir a própria linha em `posts` (RLS de dono), e
    `createPost` grava `status:'approved'` direto. Um usuário
    autenticado com acesso à API (não precisa nem ser sofisticado, só
    saber a URL do REST) publica sem passar pela moderação nenhuma. A
    PRÓPRIA auditoria de negócio de 2026-09-16
    (`migrations/2026-09-16-business-logic-security-audit.sql`) já
    registrava que fechar isso de verdade exige mover a CRIAÇÃO do post
    pro servidor (rota que faz auth + moderação + INSERT com
    service_role, cliente nunca insere direto) — mudança arquitetural
    maior, não decidida ainda. **Achado do Codex numa revisão posterior
    (PR #327): a 1ª versão desta entrada marcava o item como fechado
    sem essa ressalva — corrigido aqui pra não esconder a lacuna de
    quem ler depois.**
  - PRs #325 (fixes originais + os 4 achados P1 do Codex na mesma PR,
    commit `f30112a`) e #327 (esta entrada de documentação + mais 4
    achados do Codex nela mesma: cleanup de avatar reprovado, fila de
    revisão de vídeo pendente, e as 2 correções de texto acima),
    squash-mergeadas. Suíte/typecheck/build verdes nas duas.

- **SEGUNDA RODADA DE VERIFICAÇÃO POR CONSOLE — 15 dos 17 itens pendentes da
  auditoria Cloudflare/Supabase checados (2026-09-16).** Mesma sessão
  "Claude in Chrome" (logada como `queroumacor@gmail.com`), continuação da
  verificação dos 4 itens FCM/Firebase logo abaixo. Detalhe completo em
  `SECURITY_AUDIT_LOG.md` (entrada 2026-09-16, continuação). Resumo:
  - **FECHADOS/VERIFICADOS (9 itens):**
    - **`exec_sql`/`executar_sql` — CONFIRMADO REMOVIDO EM PRODUÇÃO.** Query
      direta no SQL Editor (`select … from pg_proc where proname ilike
      '%exec_sql%' or '%executar_sql%'`) voltou **0 rows** — a função de
      execução de SQL arbitrário não existe mais no banco vivo. O
      `/migrations/2026-06-18-rls-phase3-drop-exec-sql.sql` rodou de fato.
    - **Config de Auth do Supabase**: "Confirm email" desligado (login sem
      confirmar e-mail — a trava real é no APP, `AuthProvider.emailVerified`
      bloqueando publicar/comentar/mandar mensagem, não o login em si, então
      não é regressão); "Allow anonymous sign-ins" desligado (consistente
      com o modo visitante removido em 18/06); Redirect URLs (3) escopadas
      certo, sem wildcard perigoso; access token 3600s + refresh rotation +
      reuse detection ligados; **"Prevent use of leaked passwords" LIGADO**
      (bom); MFA TOTP disponível, SMS desligado. **Achado: "Enable Captcha
      protection" está DESLIGADO** — mesma lacuna do item "Bot Fight Mode/
      Turnstile ausente em `/login`/`/signup`" já conhecido, vista agora
      pelo lado do Supabase Auth em vez da borda Cloudflare — é a MESMA
      decisão pendente, não um achado novo.
    - **5 custom rules do WAF**: confirmadas ativas (a de bots/scrapers já
      bloqueou 794 tentativas reais) + 2 allowlists novas desde 25/05
      (webhook WhatsApp, `assetlinks.json`).
    - **`CLOUDFLARE_API_TOKEN`**: escopo confirmado como só
      `Cloudflare Pages:Edit` — mínimo necessário, nada a mais.
    - **`SENTRY_AUTH_TOKEN`**: confirmado AUSENTE do build real do CF Pages.
      Sem impacto de SEGURANÇA (o `strip-source-maps.mjs` da auditoria
      Cloudflare apaga todo `.map` do artefato incondicionalmente, com ou
      sem token) — o efeito é só operacional: o Sentry recebe stack trace
      minificado, sem symbolication.
    - **Rotas `whatsapp-evo/*`**: testadas ao vivo — `GET /webhook` → 405,
      `GET /ping` → 401 sem token, `GET /followup` → 405. Nenhuma vaza dado
      nem aceita ação sem auth; caminho morto, mas fechado, não uma porta
      aberta. Deixa de ser "não auditado".
    - **Cloudflare Access na frente de `*.pages.dev`**: confirmado que NÃO
      está configurado (zero aplicações). Continua sendo decisão do
      usuário — "a considerar", agora com o estado real confirmado.
    - **✅ Preview env vars do Cloudflare Pages — RECONCILIADO
      (2026-09-17).** Checando ao vivo o painel (`queroumacor-next` →
      Settings → Environment variables → Preview): só **5 variáveis
      públicas** (`NEXT_PUBLIC_*` + `VAPID_SUBJECT`) — nenhum secret de
      produção (`SUPABASE_SERVICE_ROLE_KEY`, chaves de IA/MP/WhatsApp
      ausentes). Isso CONTRADIZIA o que o `STAGING.md` e a auditoria
      Cloudflare de 13/09 descreviam ("Preview roda com os MESMOS secrets
      de produção"). **`STAGING.md` corrigido para refletir o estado real**
      — o texto era o desatualizado, não o painel (não dá pra saber se o
      usuário já tinha corrigido o painel antes da auditoria original, ou
      se o `STAGING.md` nunca bateu com a config real; de qualquer forma o
      estado ATUAL é seguro e agora é o que o arquivo descreve). Fechado.
    - **DMARC de `calicolors.com.br`**: CONFIRMADO ausente via lookup DNS
      direto (`_dmarc.calicolors.com.br` → NXDOMAIN) — deixa de ser
      presumido pela falta de confirmação e passa a ser um fato verificado.
      Ação (TXT no GoDaddy) continua sendo só do usuário.
  - **SSL/TLS do domínio — PARCIALMENTE FECHADO (2026-09-16, sessão
    separada de "Claude in Chrome").** Dos 4 gaps achados nesta rodada:
    - **✅ Mode Full → Full (Strict) — FEITO.** Alterado em SSL/TLS →
      Overview → Configure, confirmado pela mensagem "Encryption mode
      updated successfully." Agora a conexão Cloudflare↔origem exige
      certificado válido, não só cifra.
    - **✅ DNSSEC — FECHADO EM 2026-09-17 (DS record publicado na
      Registro.br; ver entrada no topo deste arquivo).** Ligado no
      Cloudflare nesta sessão (2026-09-16, 3ª sessão); depois de duas rodadas que
      só CONFIRMARAM o estado desligado (ver regra abaixo), esta terceira
      sessão executou a ação de verdade: "Enable DNSSEC" ativado em DNS →
      Settings. O DNSSEC só fica TOTALMENTE ativo depois que o registrador
      publica o DS record que o Cloudflare gera — e `queroumacor.com.br` é
      registrado na **Registro.br** (domínio `.com.br`; não confundir com
      o GoDaddy, que é o registrador de `calicolors.com.br`, usado pro
      DMARC). **Pendência real agora é só isso**: usuário adicionar o DS
      record na Registro.br. Enquanto isso não acontece, o DNSSEC está
      "ligado" do lado Cloudflare mas não protege nada (a cadeia de
      confiança só fecha com o DS no pai da zona).
    - **✅ DNSSEC — DS RECORD PUBLICADO NA REGISTRO.BR (2026-09-17),
      FECHADO.** Depois de duas rodadas que só CONFIRMARAM o estado
      desligado e uma terceira que ligou o DNSSEC no lado Cloudflare (ver
      regra abaixo), o usuário completou o último passo à mão: entrou no
      painel da **Registro.br** (registrador de `queroumacor.com.br` —
      não confundir com o GoDaddy, registrador de `calicolors.com.br`
      usado pro DMARC), abriu DNS → "Alterar servidores DNS" → "+
      DNSSEC", e publicou o DS record que o Cloudflare gerou (DNS →
      Settings → DNSSEC → "DS Record" no painel Cloudflare): **Key Tag
      2371, Algoritmo 13, Digest Type 2 (SHA256)**. A Registro.br
      confirmou "DNS atualizado com sucesso!". **Propagação (10min-1h,
      segundo o próprio Cloudflare) ainda não foi reverificada** — a
      cadeia de confiança do DNSSEC só fecha de fato depois que o
      resolver externo enxergar o DS no pai da zona; o valor do dígito
      completo não foi registrado aqui de propósito (é público, mas não
      há necessidade de reproduzir credencial/hash sensível num arquivo
      de memória). Tratar como fechado; reconfirmar só se algum dia
      houver suspeita de regressão (troca de registrador, DS revogado).
    - **✅ Registro CAA — CRIADO E PUBLICADO (2026-09-16, 3ª sessão).**
      6 registros CAA criados na zona: tag `issue` (pode emitir certificado
      padrão) e tag `issuewild` (pode emitir wildcard) para **3 CAs**:
      `letsencrypt.org`, `pki.goog` e `ssl.com` — o Cloudflare sugeriu as
      duas últimas automaticamente como reforço além da CA pedida.
      Qualquer outra CA que não estiver nessa lista fica IMPEDIDA de emitir
      certificado pro domínio, mesmo que seja enganada/comprometida. Item
      fechado, sem passo manual restante.
    - **TLS mínimo 1.2 (não 1.3)** — mantido de propósito, decisão do
      usuário ("TLS 1.2 bem configurado ainda é aceitável"). Confirmado
      que TLS 1.3 já está HABILITADO no edge (clientes que suportam usam
      1.3; 1.2 é só o piso pra não excluir clientes mais antigos) — não é
      "TLS 1.3 desligado", é "1.2 ainda aceito". Não é pendência.
    - **Confirmado OK, sem gap**: Always Use HTTPS ligado; HSTS ligado
      (12 meses, includeSubDomains, preload).
    - **REGRA: "verificar que X está desligado" NÃO é o mesmo que "ligar
      X".** Um relato que confirma o estado atual sem executar a ação
      recomendada não fecha a pendência — só a documenta com mais
      precisão. Aconteceu aqui com DNSSEC e CAA nas duas primeiras
      rodadas — e é a mesma regra que permitiu reconhecer, na 3ª rodada,
      que desta vez a ação FOI executada de verdade (DNSSEC ligado, CAA
      criado), em vez de aceitar a palavra "feito" sem examinar o que
      mudou.
  - **FECHADO por confirmação direta do usuário (2026-09-16):** acesso
    Admin da Beatris Porsebon no Apple Developer é **INTENCIONAL** — não
    era vulnerabilidade, só um colaborador que a memória do projeto ainda
    não tinha registrado.
  - **AINDA ABERTO, sem mudança (1 item):** login social PKCE no mobile
    (só testável instalando o AAB/IPA num aparelho real — não dá pra
    verificar por console/navegador).
  - **NÃO alterados por decisão/risco aceito, sem mudança**: `===` no
    handshake GET do webhook WhatsApp; janela fixa de 1 min no
    `check_rate_limit`; migrar adapter pro OpenNext-Cloudflare.
  - Cloudflare CSAM Scanning Tool: confirmado que não é toggle self-service
    nas configurações da zona — segue exigindo contato manual por e-mail,
    sem mudança de fato.

- **VERIFICAÇÃO MANUAL DOS 4 ITENS DE CONSOLE DA AUDITORIA FCM/PUSH — FEITA
  (2026-09-16).** Os 4 itens "MANUAL VERIFICATION" que a auditoria de
  Firebase/FCM/APNs/Push de 2026-09-13 tinha deixado em aberto (fora do
  alcance desta sessão de código, que não tem browser) foram checados pelo
  usuário numa sessão separada de "Claude in Chrome", logado como
  `queroumacor@gmail.com` (dono do Firebase/GCP/Apple Developer). Resultado:
  - **IAM do Firebase/GCP**: limpo — 3 principals (owner + 2 service
    accounts, uma delas `codemagic-play-publisher`, uso esperado pro AAB da
    Play Store via Codemagic).
  - **Service account keys**: limpo — 1 chave ativa por conta, ambas com
    ~13 dias (criadas 2026-09-03), nenhuma órfã/duplicada.
  - **Quotas/billing do FCM**: limpo — sem billing account vinculada (Spark
    plan confirmado), quota 600k req/min em 0% de uso. 0 alert policies no
    Cloud Monitoring, mas isso é esperado: FCM não tem custo/teto no Spark,
    então não existe categoria de alerta aplicável (não é gap).
  - **Apple Developer — Users and Access**: além de `queroumacor@gmail.com`
    (Account Holder+Admin), existe `beatrisporsebon@icloud.com` (Beatris
    Porsebon) com **Admin**, acesso completo à chave APNs `2R6FW9F2F6`.
    Esse contato não aparecia em nenhuma entrada anterior deste arquivo.
    Cross-checado contra o Firebase Console (colaboradores batem 1:1 com a
    IAM do GCP, sem discrepância). **✅ CONFIRMADO PELO USUÁRIO
    (2026-09-16): o acesso é INTENCIONAL** — não era vulnerabilidade, só um
    colaborador que a memória do projeto ainda não tinha registrado.
  - Detalhe completo em `SECURITY_AUDIT_LOG.md` (entrada 2026-09-16).

- **AUDITORIA DE SEGURANÇA DO SUPABASE (2026-09-13, pedido do usuário: "auditoria
  COMPLETA... RLS, policies, grants, roles, functions, RPCs, triggers, views,
  Storage, Realtime, Auth, cron, service role"). SQL
  `/migrations/2026-09-13-leads-rls-critical.sql` — JÁ EXECUTADO no Supabase
  (2026-09-16, confirmado pelo usuário: a consulta de conferência do fim do
  arquivo voltou as 3 linhas com `ok=true` — RLS habilitada, policy
  `leads_admin_all` existe, `anon` sem GRANT). Não pedir pra rodar de novo.**
  - **ACHADO CRÍTICO: `public.leads` NUNCA teve RLS habilitada por nenhuma
    migration deste repositório.** A tabela nasceu FORA do repo (não existe
    `CREATE TABLE public.leads` em lugar nenhum — só 7 `ALTER TABLE ... ADD
    COLUMN`). Varredura da história INTEIRA de SQL (10.935 linhas, base +
    94 migrations em ordem): zero `ENABLE ROW LEVEL SECURITY`, zero
    `CREATE POLICY`, zero `GRANT`/`REVOKE` tocando `leads`, em qualquer
    ponto. **Comparado com as outras 50 tabelas criadas neste repo — todas
    as 50 passam por `ENABLE ROW LEVEL SECURITY` pelo menos uma vez.**
    `leads` é a única exceção, porque nunca apareceu numa `CREATE TABLE`
    que desse o "gancho" de lembrar de proteger.
    - **Impacto**: `leads` guarda ~1072 contatos de prospecção (nome,
      telefone, categoria, cidade, status, abordagem) — dado de negócio
      da loja. Sem RLS, qualquer usuário comum do app (pintor, cliente —
      não precisa ser admin) ou a chave `anon` conseguia ler/escrever a
      tabela INTEIRA direto pela API REST do Supabase
      (`GET /rest/v1/leads?select=*`), sem passar pelo portal nem por
      `is_portal_admin()`. Conferido: o app consumidor (`next-app/`)
      **não toca essa tabela** — `lib/services/leads.ts` de lá é outro
      conceito (posts `for_sale=true`), sem relação. Toda leitura real de
      `leads` é do portal, sempre logado como admin — travar pra
      `is_portal_admin()` não tira acesso de ninguém que usa a feature.
    - **AUTOCRÍTICA DESTA SESSÃO**: o comentário do `leads_por_telefone`
      (escrito hoje mais cedo, na correção de performance do WhatsApp)
      dizia "SECURITY INVOKER de propósito: a RLS de `leads` continua
      valendo" — uma suposição repetida sem nunca ter sido checada. Esta
      auditoria corrigiu a própria suposição da sessão, não só o código.
      **Lição: "a RLS de X vale" não é fato até alguém ler a tabela de
      políticas de X.**
  - **FALSOS POSITIVOS CONFIRMADOS SEGUROS (lidos no SQL final, não
    presumidos)**: `products`/`orders`/`announcements`/`commissions`
    tiveram policy `USING(true)`/`WITH CHECK(true)` no `supabase_init.sql`
    original (qualquer `authenticated` alterava catálogo/pedido/aviso de
    QUALQUER UM) — mas todas as 4 foram fechadas pra
    `is_portal_admin()` num bloco "Re-auditoria Onda 1" já no mesmo
    arquivo, antes de qualquer migration incremental. `profiles_public`
    (view) perdeu `security_invoker=true` em duas recriações (Waves 32 e
    counters) e foi corrigida de volta num hardening posterior que cita
    literalmente "o ERROR do advisor" (Supabase Security Advisor —
    sessão anterior teve esse dado, mesmo sem estar resumido no
    CLAUDE.md). `exec_sql`/`executar_sql` (execução de SQL arbitrário,
    herança do vanilla) tiveram EXECUTE revogado e foram DROPadas por
    `/migrations/2026-06-18-rls-phase3-drop-exec-sql.sql` (idempotente,
    com pré-check de dependência — não confirmável se rodou em produção,
    ver MANUAL VERIFICATION abaixo). **100% das funções SECURITY DEFINER
    do histórico (52 ocorrências) têm `SET search_path` — nenhum risco de
    search-path hijacking encontrado.** Bucket `whatsapp-media`:
    corretamente privado, só `is_portal_admin()` lê, escrita só por
    service_role (sem policy de INSERT pra ninguém logado). Trigger
    `protect_profile_columns` (BEFORE INSERT/UPDATE em `profiles`,
    vinculada via `CREATE TRIGGER`, confirmado) reverte silenciosamente
    qualquer tentativa de setar `is_pro`/`portal_access`/`role=admin`/
    `verified` por quem não é `is_portal_admin()` — bloqueia auto-promoção
    a admin. Cron jobs (4, via `pg_cron`) têm corpo fixo sem parâmetro
    controlável pelo cliente — sem superfície de injeção. Nenhuma
    Edge Function no repo (tudo é rota Next.js no Cloudflare Pages).
  - **ACEITO COMO RISCO BAIXO, não corrigido**: `push_device_tokens`
    UPDATE usa `USING(true) WITH CHECK(auth.uid()=user_id)` — de
    propósito, pro aparelho que trocou de conta reatribuir a própria
    linha (o token físico é a chave natural, não o dono). Um usuário
    comum PODERIA, em teoria, sequestrar a linha de outro se soubesse o
    `id` (uuid) dela — mas não há SELECT que vaze esse id pra ninguém
    fora do dono, então a exploração exige adivinhar um UUID. Mudar pra
    `auth.uid()=user_id` também no USING quebraria a reatribinação
    legítima; não mexido nesta rodada.
  - **NÃO VERIFICADO NESTA RODADA** (fora do que consegui aprofundar):
    matriz completa das 50 tabelas × 4 operações (fiz um sweep de
    `USING(true)`/`WITH CHECK(true)` cobrindo os casos historicamente
    achados, não uma tabela linha-a-linha de tudo); Storage buckets além
    de `whatsapp-media` não foram re-conferidos nesta sessão (o histórico
    em waves anteriores já documenta `posts`/`avatars`/`exports`/
    `art-refs` — não re-lidos agora); Realtime publications além de
    `whatsapp_messages`; configuração de Auth (redirect URLs, expiração
    de JWT, MFA, leaked password protection, captcha) — tudo isso só no
    Dashboard do Supabase, **MANUAL VERIFICATION REQUIRED**; execução
    real em produção do DROP de `exec_sql`/`executar_sql` (o arquivo
    existe e está correto, mas não há como confirmar daqui se rodou).

- **RATE LIMIT EM MENSAGENS DE CHAT + PUSH DE MENSAGEM SEM TEXTO (2026-09-15,
  pedido do usuário, fechando 2 pendências da auditoria FCM/push abaixo). SQL
  `/migrations/2026-09-15-chat-safety-hardening.sql` — JÁ EXECUTADO no
  Supabase (2026-09-15, confirmado pelo usuário: "feito"). Não pedir pra
  rodar de novo.**
  - **`messages` ganhou rate limit PRÓPRIO** (antes só existia no dispatch do
    push, 20/min por destinatário — continha o SINTOMA, não a causa). Trigger
    `BEFORE INSERT` chama `check_rate_limit` com chave por PAR
    remetente→destinatário (`sender>receiver`, não o remetente sozinho — pra
    não travar a loja respondendo muita gente rápido), 30 msgs/min. Estourou
    → INSERT recusado com mensagem que contém "rate limit" (já bate no
    pattern existente de `lib/errors-friendly.ts` → "Muitas tentativas",
    nenhuma mudança de client necessária). `type='system'` (marcadores
    internos) não conta. Falha na checagem não bloqueia o envio.
  - **`dispatch_push_on_notification` para de mandar o texto da mensagem no
    push.** Antes copiava `notifications.body`, que pra `type='message'`
    inclui até 80 chars do texto real (ex. "Fulano: manda o endereço
    que..."), direto pro corpo da notificação — aparecia na tela de bloqueio.
    Agora, só pra `type='message'`, o push manda "`<nome de quem mandou>`
    enviou uma mensagem" (nome vem do `actor_id`, já gravado na notificação).
    **`notifications.body` NÃO muda** — a tela `/notificacoes` dentro do app
    continua mostrando o preview completo; só o que SAI pelo push foi
    redigido. Testes: `__tests__/chatSafetyHardening.test.ts` (lê o SQL e
    trava os dois invariantes) + caso novo em
    `__tests__/lib/errors-friendly.test.ts`.

- **AUDITORIA FIREBASE / FCM / APNs / PUSH (2026-09-13, auditoria paralela #11
  da rodada de segurança). SQL `/migrations/2026-09-13-fcm-push-hardening.sql`
  — JÁ EXECUTADO no Supabase (2026-09-15, confirmado pelo usuário: a consulta
  de conferência do fim do arquivo voltou as 6 linhas com `ok=true`). Não
  pedir pra rodar de novo.**
  - **ACHADO CRÍTICO: `push_device_tokens` tinha `UPDATE ... USING (true)`.**
    A intenção era só permitir que um aparelho compartilhado, ao trocar de
    conta, reatribuísse a PRÓPRIA linha (upsert por conflito de `token`) pro
    novo dono — mas `USING(true)` não distingue "minha linha antiga" de
    "linha de qualquer um". Qualquer usuário autenticado podia mandar
    `PATCH /rest/v1/push_device_tokens?user_id=eq.<vítima>
    {"user_id":"<atacante>"}` DIRETO no Supabase (sem passar pelo app) e
    **sequestrar a linha de qualquer outra pessoa**, sem precisar conhecer o
    token dela — só o `user_id`, que não é secreto. O `WITH CHECK` barrava só
    o passo seguinte (manter o `user_id` da vítima), não impedia tomar posse
    da linha. Efeito prático: o dispositivo real da vítima some da lista de
    destinatários até o app dela regravar o token sozinho (auto-cura no
    próximo `ensureDeviceToken`, mas é uma janela real de negação de serviço
    contra o push de outra pessoa). **FIX**: RPC SECURITY DEFINER
    `upsert_push_device_token(p_token, p_platform)` que grava **sempre**
    `user_id = auth.uid()` lido dentro da função (nunca de um campo que o
    cliente manda) — a reatribuição legítima passa a acontecer só por ali,
    identificando a linha em conflito pelo `token` (string de alta entropia
    que o próprio aparelho gerou), nunca pelo `user_id`. A policy de UPDATE
    da tabela volta a ser estritamente `auth.uid() = user_id` nos dois lados.
    Client (`lib/services/pushTokens.ts`) chama a RPC primeiro; cai pro
    upsert direto na tabela só se a função ainda não existir no banco
    (`PGRST202`/`42883`).
  - **ACHADO MÉDIO: nada limitava QUANTAS linhas um usuário cria pra si mesmo
    em `push_device_tokens`/`push_subscriptions`.** RLS de INSERT só garante
    "é dono da linha", não "é uma quantidade razoável" — um usuário podia
    inserir milhares de tokens/subscriptions falsos na PRÓPRIA conta e, a
    partir daí, QUALQUER notificação endereçada a ele (curtida, comentário,
    mensagem — nenhuma pede confirmação de quem recebe) faria
    `/api/push-notify` disparar milhares de fetches concorrentes pro
    FCM/push service no MESMO isolate. **FIX**: trigger que mantém só os 20
    dispositivos/subscriptions mais recentes por usuário (apaga o excedente
    no próprio INSERT) + `app/api/push-notify/route.ts` busca só os
    `25 × nº de destinatários do envio` mais recentes por chamada
    (`order=last_seen_at.desc&limit=`) — essa parte já vale mesmo sem a
    migration, é defesa em profundidade no código.
  - **ACHADO MÉDIO: `dispatch_push_on_notification` disparava 1 push por
    linha de `notifications`, sem teto por DESTINATÁRIO.** O rate limit do
    `/api/push-notify` é por IP de quem CHAMA a rota (o próprio Postgres, via
    pg_net) — nunca por quem RECEBE. Mensagem de chat virou 1 notificação por
    mensagem em 2026-09-04 (antes agrupava rajada de 5 min), então mandar
    muitas mensagens rápidas pro mesmo contato aciona um envio de push por
    mensagem pra essa pessoa. **FIX**: `check_rate_limit(NEW.user_id::text,
    'push-dispatch', 20, 1)` antes do `net.http_post` — estourou → a
    notificação continua gravada normalmente (sininho funciona), só o ENVIO
    de push é contido. Depende do `check_rate_limit(text,...)` da migration
    da auditoria de rate limiting (item abaixo) — rodar aquela primeiro.
  - **VERIFICADO E CORRETO, sem mudança**: `push_subscriptions` (web push)
    já tinha UPDATE/DELETE corretamente escopados (`USING(user_id=auth.uid())`
    nos dois lados) — só `push_device_tokens` (push nativo) tinha o buraco,
    porque o padrão de reatribuição cross-device foi copiado sem o `WITH
    CHECK` bastar sozinho. FK `ON DELETE CASCADE` em ambas as tabelas
    (`profiles.id`) já limpa tokens/subscriptions de conta deletada. Token
    morto (404/410/`UNREGISTERED` do FCM; 404/410 do push service) já é
    removido pelo próprio envio (`classifyFcmResult`/`sendWebPush`) — sem
    isso a lista cresceria pra sempre. Nenhum `.p8`/service-account JSON/chave
    privada no repo ou no histórico do git (`.gitignore` cobre os quatro:
    `*.p8`, `key.properties`, `google-services.json`,
    `GoogleService-Info.plist`); FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY só
    em env do Cloudflare Pages, lidas por `getRuntimeEnv` (nunca
    `process.env` cru), nunca expostas ao mobile/frontend. Deep link do
    toque na notificação (`routeFromNotificationData`) só aceita path
    relativo começando com `/` — bloqueia URL externa/open-redirect vinda de
    um payload adulterado. Sem FCM topics em uso (nem cliente nem servidor) —
    NOT APPLICABLE pros itens de segurança de topic. Sem notification actions
    customizadas (botões "Aprovar"/"Excluir" etc.) — NOT APPLICABLE.
    `notify_user()` RPC (não chamada por nenhum código cliente hoje, só fica
    disponível) já exige relação prévia (quote ou conversa) com o
    destinatário — não é broadcast arbitrário.
  - **NÃO coberto nesta rodada (fora do escopo Firebase/push, reportado)**:
    mensagem de chat spamada rapidamente gera 1 notificação por mensagem sem
    rate limit na CAMADA DE MENSAGENS (o teto que ESTE audit adicionou é no
    dispatch do PUSH, que contém o sintoma mas não a causa); conteúdo de
    mensagem de chat aparece em texto puro no `body` da notificação (lock
    screen) — decisão de produto equivalente à de apps de mensagem
    populares, não alterada sem confirmação do usuário.

- **AUDITORIA DE RATE LIMITING / ABUSE (2026-09-13, pedido do usuário: "auditoria
  COMPLETA de segurança... rate limiting, DoS, abuse de IA/WhatsApp/push").
  SQL `/migrations/2026-09-13-security-audit-hardening.sql` — JÁ EXECUTADO
  no Supabase (2026-09-13, confirmado pelo usuário: a consulta de
  conferência do fim do arquivo voltou as 5 linhas com `ok=true`). Não
  pedir pra rodar de novo.**
  - **ACHADO CRÍTICO: `check_rate_limit(p_user_id uuid, ...)` — a coluna e o
    parâmetro sempre foram UUID, mas toda chave que não é um id de usuário
    puro é uma STRING** ("ip:1.2.3.4", "ip:1.2.3.4:login",
    "log-error:1.2.3.4", "push-notify:1.2.3.4", "u:<uuid>"). O PostgREST
    recusa o cast (22P02 → HTTP 400), e `checkRateLimit` (`lib/api/
    security.ts`) trata QUALQUER `!res.ok` como "serviço indisponível" →
    FAIL-OPEN. **Não é "raro estourar": é "nunca rodou".** Isso significa
    que, desde que foram escritos, os seguintes limites por IP nunca
    funcionaram de verdade:
    - `checkAuthRateLimit` — brute force de LOGIN, criação em massa no
      SIGNUP, bombing de RESET DE SENHA — a defesa por IP estava morta;
    - `/api/log-error` por IP (log flooding / custo de Sentry);
    - `/api/push-notify` por IP (defesa contra vazamento do
      `PUSH_INTERNAL_SECRET`);
    - os 7 endpoints que usam `enforceRateLimit`: checkout, delete-account,
      upload-style-ref, apple-iap-verify, play-billing-verify, cidades,
      reverse-geocode, auth/set-session-cookie.
    **O que NÃO foi afetado**: qualquer chamada que manda um UUID de
    usuário puro (me-export, moderate, moderate-video, quote-pdf-upload,
    quote-pdf-upload, wa-suggest, admin-*, whatsapp/send, e o rate-limit
    por minuto de `gateProAI`/`gateAiUsage` — todos usam `auth.user.id`
    direto). A cota MENSAL de IA (`ai_usage`, 30/500/99999 por plano)
    também não foi tocada — é uma tabela e uma conta separadas.
    **Por que o teste existente nunca pegou**: `__tests__/api/
    security-ratelimit.test.ts` e `__tests__/api/auth-rate-check.test.ts`
    só mockavam respostas 200 da RPC — nunca simulavam o 400 real que o
    Postgres devolve pra UUID inválido. Os dois ganharam teste novo que
    simula esse 400 explicitamente e documenta o contrato (a chave
    mandada NUNCA é um UUID, prova em `auth-rate-check.test.ts`).
    **FIX**: `ALTER COLUMN user_id TYPE text` + `check_rate_limit(p_user_id
    text, ...)`. UUID continua sendo string válida — não quebra nada que
    já funcionava.
  - **ACHADO ALTO: `search_all(p_query, p_limit)` sem GRANT restrito nem
    teto no LIMIT.** Função criada sem REVOKE herda EXECUTE pra PUBLIC —
    ou seja, a chave `anon` (pública, em qualquer bundle do app) podia
    chamar `POST /rest/v1/rpc/search_all` DIRETO no Supabase, sem passar
    pelo `/search` do Next.js e sem NENHUM rate limit nosso. E o
    `p_limit` do cliente ia direto pro `LIMIT` da query, sem teto —
    `p_limit=2000000000` era aceito. **FIX**: `LIMIT
    LEAST(coalesce(p_limit,20), 100)` + REVOKE de PUBLIC/anon + GRANT só
    pra `authenticated` (o app exige login desde 2026-06-18, então isso
    não tira acesso de ninguém que hoje usa a busca pelo app).
  - **FALSOS POSITIVOS DESCARTADOS (verificados, não presumidos)**:
    tokens de IA já têm teto (`max_tokens`/`maxTokens` 200-2000 conforme o
    serviço; histórico truncado a 8-10 turnos e 2000 chars por turno em
    `chat-ai.ts`); `moderate-video` já tem SSRF guard (só `*.supabase.co
    /storage/`), timeout de 20s e teto de 25MB; `tts`/`moderate` já
    truncam texto de entrada (2000/4000 chars); webhooks (WhatsApp,
    Mercado Pago) já são idempotentes (`message_id`/`external_id` UNIQUE
    + upsert); `whatsapp/send` e `whatsapp/followup` já usam `safeEqual`
    (comparação em tempo constante) pro segredo — só o handshake GET de
    verificação do webhook (chamado uma vez pela Meta na configuração,
    não é o segredo corrente) usa `===` puro, risco residual BAIXO, não
    corrigido nesta rodada.
  - **CORRIGIDO (código, sem depender do SQL): 9 rotas de IA liam o corpo
    cru (`request.json()`/`request.formData()`) SEM NENHUM teto de
    tamanho antes do parse** — o `accessToken` mora dentro do body nesses
    endpoints, então não dá pra autenticar antes de ler algo, e um corpo
    de dezenas de MB era bufferizado e parseado por completo antes de
    qualquer rejeição. `rejectOversizedBody(request, maxBytes)`
    (`lib/api/security.ts`) é um pré-check barato (só olha
    `Content-Length`, não lê o corpo) chamado como PRIMEIRA linha do
    handler: chat-ai, alice, senna, fe (256KB — o Zod de chat-ai e o
    `.slice()` de `chatWithPersona` já capavam o que sobra, isso é
    defesa-em-profundidade pro custo de PARSE), generate-logo (64KB),
    ig-art (24MB, cobre as 2 fotos base64), transcribe (27MB),
    area-from-photo e receipt-ocr (9MB cada). **Limitação declarada**:
    só pega corpo com `Content-Length` presente e maior que o header diz;
    corpo chunked sem esse header passa direto, sob o teto que resta é o
    do próprio Cloudflare Workers na borda (~100MB, fora do nosso
    controle) — documentado no JSDoc do helper. Testes:
    `__tests__/api/security-body-size-guard.test.ts` (unitário do
    helper) + um caso de integração em cada um dos 6 arquivos de teste
    de rota que já existiam (chat-ai, generate-logo, transcribe, ig-art,
    area-from-photo); alice/senna/fe/receipt-ocr receberam o MESMO código
    mas não ganharam arquivo de teste novo (padrão idêntico ao já
    testado em chat-ai/transcribe — decisão de escopo, não esquecimento).
  - **NÃO coberto nesta rodada (reportado, não corrigido)**: janela FIXA
    de 1 minuto no `check_rate_limit` (não sliding window — dá pra
    dobrar o volume batendo bem na virada do minuto; baixo impacto,
    limites atuais têm folga); comparação `===` no handshake GET do
    webhook do WhatsApp; rotas `whatsapp-evo/*` (Evolution API,
    "aposentada" por decisão do usuário — ver regra "WEBINTOAPP" — mas
    o endpoint ainda existe e não foi auditado a fundo por já ser
    caminho morto).
- **AUDITORIA DE SEGURANÇA MOBILE (2026-09-13/15, pedido do usuário: auditoria
  completa Capacitor/Android/iOS/WebView). MERGEADA na `main` (2026-09-15,
  pedido explícito do usuário: "merge"), branch `claude/mobile-security-
  audit-b36g38` (commits `af59a79`…`927f466`). Suíte inteira verde, typecheck
  e `next build` limpos DEPOIS de reconciliada com a auditoria de rate
  limiting (#301) e a auditoria FCM/APNs/push (merge `0bc52fc`) que
  avançaram a `main` em paralelo — ver nota de reconciliação no fim desta
  entrada.**
  - **CRÍTICO CONTIDO NESTA SESSÃO, e DEPOIS CORRIGIDO NA RAIZ por uma
    auditoria paralela — `next@15.5.2` era vulnerável a CVE-2025-66478/
    CVE-2025-55182 (RCE, CVSS 10.0, desserialização do protocolo Flight via
    header `Next-Action`).** Nesta sessão a versão estava PRESA nesse número
    porque é o teto exato do peer range do `@cloudflare/next-on-pages`
    (`>=14.3.0 && <=15.5.2`), adapter DESCONTINUADO pelo mantenedor — por
    isso a correção aplicada aqui foi só **conter** o vetor em
    `next-app/middleware.ts`: qualquer requisição com o header `Next-Action`
    é barrada com 404 antes de qualquer processamento (seguro porque o app
    não declara NENHUMA Server Action — zero `'use server'` no repo).
    Matcher ampliado de `/api/:path*` pra todas as rotas de página (Actions
    são invocadas na própria URL da página). **Essa mitigação FICA** (defesa
    em profundidade, custo zero), mas deixou de ser a única barreira: a
    AUDITORIA DE SEGURANÇA CLOUDFLARE (2026-09-13/15, ver entrada própria
    mais abaixo), rodando em paralelo, bumpou `next` pra `15.5.25` — dentro
    da MESMA minor, sem quebrar API, destravado via `next-app/.npmrc`
    (`legacy-peer-deps=true`, que ignora só o teto do peer range do adapter
    sem tocar em mais nenhuma resolução) — e validou com `npm run build:cf`
    ponta a ponta. `15.5.25` está acima do patch que corrige o CVE
    (15.5.3+, conforme o comentário do próprio `.npmrc`), então a causa raiz
    está fechada em produção, não só contida. A migração de adapter
    (OpenNext-Cloudflare) segue como melhoria arquitetural de médio prazo —
    não é mais bloqueante de segurança.
  - **Corrigido: Android `allowBackup` true→false.** A sessão do Supabase
    mora em localStorage/cookies dentro da WebView
    (`lib/sessionStorageHybrid.ts`) — com `allowBackup=true` (o default) ela
    entrava no Auto Backup pra nuvem (Google Drive) e no `adb backup`.
  - **Corrigido: token de push nativo (FCM) não era desassociado no
    logout.** Em aparelho compartilhado, trocar de conta deixava quem saiu
    recebendo notificação (e o badge do ícone com a contagem de quem saiu)
    até a próxima conta sobrescrever o mesmo token. `currentNativePushToken()`
    (lê sem abrir prompt) + `clearDeviceTokenOnLogout()` no `signOut` do
    `AuthProvider`; badge zera ao desmontar.
  - **Corrigido: drift de CSP entre `_headers` (raiz) e `next.config.mjs`.**
    `media-src` no `_headers` estava sem `https://*.supabase.co` — podia
    bloquear `<video>`/`<audio>` do Storage em página estática pré-renderizada
    (ex. `/feed`). Ficaram idênticos; teste de paridade travando isso.
  - **M1 CORRIGIDO (2026-09-15, commit `927f466`): OAuth mobile migrou de
    implicit flow pra PKCE.** `lib/supabase.ts` ganhou `flowType:'pkce'`; o
    callback nativo (`lib/native/auth.ts`) agora recebe
    `br.com.queroumacor.app://auth/callback?code=...` (código de uso único)
    em vez de `#access_token=...&refresh_token=...` crus no fragment — o
    que o Android loga no Logcat deixa de ser um token de sessão utilizável
    (o `code` sozinho não abre sessão sem o `code_verifier`, que nunca sai
    do storage da WebView). `exchangeCodeForSession` troca o code pela
    sessão; o `setSession` com tokens crus virou fallback defensivo, nunca
    acionado com PKCE ligado. **O fluxo WEB não precisou de nenhuma
    mudança** — o supabase-js já troca `?code=` sozinho no boot
    (`detectSessionInUrl`, default true). Testes novos cobrindo
    `parseAuthCallbackUrl` (code via query) e 3 casos de
    `nativeSignInWithOAuth` mockando o client. Suíte (163/2119), typecheck
    e `next build` verdes. **AINDA NÃO TESTADO EM APARELHO REAL nem contra
    Google/Apple de verdade** — este ambiente não tem device nem consegue
    completar um login OAuth de ponta a ponta. Antes de confiar cegamente:
    instalar o AAB/IPA desta branch e fazer login social de verdade (Google
    e Apple) uma vez em cada plataforma. Este app já quebrou OAuth várias
    vezes em produção (ver waves de 2026-09-06/07 mais abaixo) — testar no
    aparelho não é opcional aqui.
  - **NOT VERIFIED: build nativo real.** Ambiente sem Android SDK e sem
    macOS/Xcode — `.aab`/`.apk`/`.ipa` nunca foram gerados nesta sessão, só
    revisão de código/config. Precisa rodar no Codemagic (ou local com SDK)
    antes de confiar cegamente nas mudanças de manifest/config.
  - **Achados baixos, sem ação necessária:** `.well-known/assetlinks.json` é
    resto de uma versão TWA anterior ao Capacitor — hoje não tem efeito
    nenhum (sem intent-filter `autoVerify` no manifest atual); FileProvider
    (`file_paths.xml`) tem `path="."` mais amplo que o necessário, mas não é
    exportado e é o template padrão do plugin de câmera — não mexido pra não
    arriscar quebrar o contrato do plugin. Sem Universal Links/App Links
    verificados (só o custom scheme do OAuth) — funcional pro que existe
    hoje, só vira pendência se um dia quiserem link direto de post/perfil
    abrindo no app.
  - Arquivos alterados: `_headers`, `android/app/src/main/AndroidManifest.xml`,
    `next-app/middleware.ts`, `next-app/components/{AuthProvider,
    NativeBadge}.tsx`, `next-app/lib/native/{index,push}.ts`,
    `next-app/lib/services/pushTokens.ts`, + 6 arquivos de teste (3 novos:
    `androidManifestSecurity`, `capacitorWebviewSecurity`,
    `cspHeadersParidade`).
  - **RECONCILIAÇÃO COM O MERGE (2026-09-15).** Enquanto esta branch estava
    aberta, DUAS outras auditorias avançaram a `main` em paralelo: rate
    limiting/abuse (#301) e Firebase/FCM/APNs/push (merge `0bc52fc`, ver
    entrada logo acima). A auditoria de FCM mexeu nos MESMOS arquivos desta
    (`pushTokens.ts`, `push.ts`, `AuthProvider.tsx` etc.) por um motivo
    DIFERENTE e complementar: ela fecha o sequestro cross-user de
    `push_device_tokens` (RPC `upsert_push_device_token`, dono da linha
    decidido por `auth.uid()` dentro da função — nunca pelo `userId` que o
    cliente manda); esta auditoria fecha o logout (o token continuava
    associado à conta depois que a pessoa saía). Os dois `git merge`
    automáticos, exceto por 3 conflitos textuais (CLAUDE.md,
    SECURITY_AUDIT_LOG.md, `__tests__/push-nativo.test.ts` — os três só
    porque as duas branches inseriam conteúdo NO MESMO PONTO do arquivo, não
    porque as correções colidissem). `pushTokens.ts`/`native/push.ts`/
    `native/index.ts` mesclaram sem conflito nenhum: `saveDeviceToken` usa a
    RPC deles, `clearDeviceTokenOnLogout` (desta auditoria) chama
    `currentNativePushToken()` e apaga a linha por `token` — as duas
    correções convivem sem se pisar. Suíte completa rodada de novo depois da
    reconciliação, verde.
  - **SEGUNDA RECONCILIAÇÃO (mesma sessão, minutos depois): a AUDITORIA
    CLOUDFLARE (ver as duas entradas logo abaixo) mergeou `main` NO MEIO do
    push desta.** `git push origin main` foi rejeitado (main tinha andado de
    `0bc52fc` pra `3c16bc1`); `git merge origin/main` trouxe mais um
    conflito textual, só em `SECURITY_AUDIT_LOG.md` (mesma causa: duas
    branches editando a tabela de pendências no mesmo ponto), resolvido
    concatenando as duas listas de itens. Essa auditoria bumpou `next` pra
    `15.5.25` — **corrigindo de verdade** o CVE que esta sessão só conteve
    no middleware (ver a nota acima, atualizada). Suíte + typecheck + `next
    build` rodados de novo na árvore com as DUAS reconciliações, verdes.
  Dos achados da auditoria de 13/09 (ver entrada abaixo) que ainda podiam
  ser corrigidos no repo: `/api/ig-art-diag` virou admin-only de verdade
  (o comentário sempre disse "PRO + admin", só PRO era checado — qualquer
  assinante PRO gastava cota das chaves de IA e via quais estavam
  configuradas); scanner de segredos **gitleaks** entrou no CI
  (`.gitleaks.toml`+`.gitleaksignore`+self-test, recuperados de uma
  branch nunca mergeada, validados contra o histórico inteiro com o
  binário real: 0 leaks); `scripts/load-test.js` restaurado (tinha sido
  apagado sem querer num cleanup antigo, `load-test.yml` rodava arquivo
  inexistente desde então). Detalhes em `SECURITY_AUDIT_LOG.md`. **Não
  sobrou nenhum item de CÓDIGO pendente desta auditoria** — só os 9 itens
  de MANUAL ACTION REQUIRED (Cloudflare/Supabase Dashboard), listados na
  entrada abaixo e em `SECURITY_AUDIT_LOG.md`.

- **AUDITORIA DE SEGURANÇA CLOUDFLARE (2026-09-13, pedido do usuário).
  Branch `claude/cloudflare-security-audit-gurtsy`.** Achado mais grave:
  **Next.js estava em 15.5.2 com 3 CVEs CRITICAL** (RCE via React Flight
  protocol, exposição de código-fonte de Server Actions, DoS) — a versão
  fixada porque `@cloudflare/next-on-pages@1.13.16` (deprecado, nunca mais
  atualizado; recomenda migrar pro adapter OpenNext) declara peer
  `next: "<=15.5.2"` e o `npm install` INTERNO do `vercel build` (rodado
  pelo próprio next-on-pages) falha com ERESOLVE em qualquer patch acima
  disso. **Corrigido**: `next` → `15.5.25` (último patch da MESMA minor,
  sem mudança de API) + `next-app/.npmrc` com `legacy-peer-deps=true` (só
  isso destrava o `npm install` do adapter; não afeta a resolução de mais
  nada). **Build real testado ponta a ponta** (`npm run build:cf` completo,
  `wrangler pages dev` servindo o artefato) — funciona. **REGRA NOVA: essa
  trava de peer dep é conhecida e esperada — não é motivo pra reverter um
  bump de PATCH do Next; só minor/major exige rever o adapter primeiro.**
  A regra antiga "next pinado EXATO em 15.5.2, não subir sem subir
  next-on-pages junto" está PARCIALMENTE SUPERADA: dentro da minor 15.5.x,
  suba à vontade (rodando `npm run build:cf` antes de confiar). `tar` e
  `vitest` seguem com CVE CRITICAL sem fix disponível sem major breaking —
  os dois são só devDependency/build-time do adapter, não rodam em
  produção; aceito como risco residual baixo.
  - **Source maps do bundle client-side vazavam publicamente.** O
    `@sentry/nextjs` só apaga o `.map` do artefato DEPOIS de fazer upload
    pra Sentry, e o upload só roda com `SENTRY_AUTH_TOKEN` no ambiente de
    build — sem o token, o plugin pula o upload E o apagamento, mas
    `hideSourceMaps` ainda tira o comentário `//# sourceMappingURL=` do
    `.js` (então parecia limpo no DevTools). Inspecionando o artefato REAL
    (não só `.next`): **157 arquivos `.js.map` ficavam no output final**,
    baixáveis direto por URL, reconstruindo o código-fonte legível do app
    inteiro. `next-app/scripts/strip-source-maps.mjs` (novo) apaga todo
    `.map` de `.vercel/output/static` DEPOIS do `next-on-pages`, plugado no
    `build:cf` — funciona independente do token do Sentry existir ou não
    (o upload, quando acontece, já rodou antes, durante o `next build`).
    **O `deploy.yml` do GitHub Actions não passava `SENTRY_AUTH_TOKEN`** —
    corrigido pra chamar `npm run build:cf` (herda o strip) + um passo que
    FALHA o job se sobrar `.map` ou `.env*` no artefato antes do deploy.
  - **MANUAL ACTION REQUIRED, não verificável daqui — PRIORIDADE ALTA:**
    confirmar se as env vars de **Preview** no Cloudflare Pages Dashboard
    são as MESMAS de produção (`STAGING.md` já dizia isso e ninguém tinha
    tirado a conclusão: qualquer push em qualquer branch dispara um build
    de Preview que roda com `SUPABASE_SERVICE_ROLE_KEY`/chaves de IA/MP/
    WhatsApp no ambiente — supply-chain via `postinstall` malicioso
    exfiltraria segredo de produção sem precisar de PR aprovado). Ver aviso
    completo em `STAGING.md`.
  - **Chave Gemini vazada no histórico do Git** (arquivo
    `queroumacorportal.html`, removido do HEAD há meses, mas recuperável
    via `git show a735531:queroumacorportal.html`) — **RESOLVIDO
    (2026-09-16, confirmado pelo usuário).** A chave vazada termina em
    `...sZN_IE`; no Google AI Studio (API Keys, "All projects") só existem
    duas chaves ativas hoje — `...iVmQ` (projeto "Quero uma cor", a que
    importa) e `...LsIU` (projeto "JR Erp") — nenhuma bate com o final da
    vazada. Como o Google só lista chaves que ainda EXISTEM (revogada some
    da lista, não fica listada como inativa), a vazada já não existe mais
    na conta — não tem como ser a que está configurada em `GEMINI_API_KEY`
    no Cloudflare Pages hoje. Não dá pra ler o valor do secret no CF Pages
    direto (Cloudflare não exibe secret já salvo), mas a lógica fecha sem
    isso: chave que não existe não pode ser a que está em uso. **Não
    pedir pra rotacionar de novo.**
  - **Chamadas ao Gemini paravam a API key na QUERY STRING** (`?key=...`)
    em 8 pontos (`_ai.ts`, `ig-art.ts`, `ig-art-diag.ts`, `moderate.ts`,
    `moderate-video.ts`) — URL de requisição é o tipo de dado que mais
    vaza pra log/Sentry/proxy sem querer. Movido pro header
    `x-goog-api-key` nos 8. Guardado por teste
    (`__tests__/lib/gemini-key-not-in-query-string.test.ts`).
  - **`deploy.yml` (workflow_dispatch) podia publicar produção a partir de
    QUALQUER branch** — o `wrangler pages deploy --branch=main` é fixo,
    mas o dispatch deixa escolher a ref livremente; agora
    `if: github.ref == 'refs/heads/main'`. Comparação de token do webhook
    Evolution (legado) trocada de `!==` pra `safeEqual` (tempo constante,
    mesma regra do webhook da Meta/MP). `ios-screenshots.yml` ganhou
    `permissions: contents: read` explícito (herdava o default do
    repo/org). `next-app/` entrou no `dependabot.yml` (só cobria o
    `package.json` da raiz — as deps que rodam em PRODUÇÃO nunca geravam
    PR automático de CVE).
  - **`_headers`/`_redirects` da RAIZ do repo (fora de `next-app/`) são
    INERTES** — Cloudflare Pages publica `next-app/.vercel/output/static`
    e só lê esses arquivos de DENTRO do build output, então os da raiz
    nunca são lidos em produção. Confirmado com inspeção real do artefato
    (`_routes.json` gerado: só `/_next/static/*` bypassa o `_worker.js`;
    todo o resto — HTML prerenderizado incluso — passa pelo worker, que
    aplica o `headers()` do `next.config.mjs` normalmente). Banner de aviso
    adicionado nos dois arquivos; considerar apagar num PR de limpeza.
    **Fonte única de CSP/headers confirmada por `curl` real via
    `wrangler pages dev` contra o artefato: `/login`, `/portal` e rotas
    prerenderizadas recebem CSP/HSTS/COOP/CORP/Permissions-Policy
    corretamente — C2 (auditoria 2026-08-26) está de fato fechado, não só
    documentado.**
  - **KV/R2/D1/Durable Objects/Queues/Workers AI/Service Bindings/Zero
    Trust Access: NENHUM em uso real** (confirmado por inventário
    completo). O binding `KV` mencionado no `wrangler.toml` existe só no
    painel (se existir) — o código não lê `env.KV` hoje, usa cache nativo
    do Next. Turnstile não existe mais no `next-app` (só no vanilla morto)
    — CSP ainda permite `challenges.cloudflare.com` de propósito, caso
    reintroduzido; login/signup hoje não têm NENHUMA proteção anti-bot
    além do que o Supabase GoTrue aplica por conta própria.
  - Relatório completo (132 seções cobertas) entregue no chat da sessão;
    não copiado pra arquivo por decisão de manter este CLAUDE.md enxuto.

- **WHATSAPP: "57014: statement timeout" AO CARREGAR AS CONVERSAS (2026-09-13,
  pedido do usuário: "mais rápido sem perder segurança"). Portal v=20260913a.
  SQL `/migrations/2026-09-13-whatsapp-perf.sql` — JÁ EXECUTADO no Supabase
  (2026-09-16, confirmado pelo usuário: as 5 linhas de conferência voltaram
  `ok=true` — policy avaliada 1x, e as funções `whatsapp_conversas`/
  `whatsapp_nao_lidas`/`leads_por_telefone` e o índice
  `idx_whatsapp_messages_created_id` existem). Não pedir pra rodar de novo.**
  - **A causa não era o volume; era a RLS.** As policies de
    `whatsapp_messages`/`whatsapp_ai_state`/`portal_alerts`/
    `whatsapp_ai_config` tinham `USING (is_portal_admin())` SOLTO. A função
    é SECURITY DEFINER (não inlina), então o Postgres a chamava UMA VEZ POR
    LINHA — cada chamada um SELECT em `profiles`. Um `count:'exact'` sobre
    90 dias virava dezenas de milhares de consultas escondidas e passava dos
    8s do `statement_timeout` do papel `authenticated`. Agora
    `USING ((SELECT is_portal_admin()))`: InitPlan, avaliada UMA vez por
    statement. **Mesma regra, mesma segurança.** **REGRA: função em policy
    de RLS vai SEMPRE embrulhada em `(select …)`.** Vale pra qualquer
    policy nova com `is_portal_admin()`.
  - **Índices que faltavam:** `(created_at desc, id desc)` (ordem exata da
    paginação — o índice só de `created_at` reordenava o recorte inteiro a
    cada página), `delivery_status_at` parcial (o poll filtra por `OR`) e
    `(wa_id, created_at) where direction='in'` (não lidas).
  - **A coluna de conversas vem de um RESUMO no banco**: `whatsapp_conversas
    (p_desde)` devolve UMA linha por número (última mensagem inteira em
    `ultima` jsonb, nome, canal da última resposta, `nao_lidas`, chave/
    decisão/marca da IA) — a aba não baixa mais os 90 dias de mensagens;
    `msgs` fica pro histórico da conversa ABERTA e pro realtime.
    `montarConversas(resumos, msgs)` casa as duas fontes,
    `naoLidasDaConversa` decide quem conta (marca local mais nova que a do
    servidor = o operador acabou de abrir → conta na tela; senão vale o
    número do banco), `aplicarMensagemNoResumo` põe a mensagem do realtime
    no resumo sem esperar o poll. A função é plpgsql SECURITY DEFINER que
    ESTOURA 42501 pra quem não é admin — zero linhas seria lido pela tela
    como "não há conversas". `whatsapp_nao_lidas(p_desde)` é o número do
    badge do menu (antes: 30 dias de mensagens + a tabela de marcas a cada
    45s). `leads_por_telefone(sufixos[])` + índice de expressão nos 8
    últimos dígitos substitui o `phone ILIKE '%1234'` que varria 61 mil
    linhas por lote (SECURITY INVOKER: a RLS de `leads` segue valendo).
  - **Fallback por `ehFuncaoAusente`** (42883/PGRST202): função ausente →
    caminho antigo (`loadTudo`, o badge no navegador, o ILIKE). Outro erro
    (42501, 57014) → aparece na tela com o código. "↻ Tentar de novo"
    tenta a RPC de novo (o SQL pode ter acabado de rodar).
  - **Enviar recarregava os 90 dias A CADA MENSAGEM** (`load()` sem
    argumento depois do envio, nos dois caminhos). Agora `load(1)`; o teste
    proíbe o `load();` voltar ali. **Status de entrega chega por realtime
    UPDATE** (a bolha muda na hora em vez de esperar o poll de 60s — a
    REPLICA IDENTITY FULL da Wave 45 manda a linha inteira). O `loadIa` de
    30s deixou de baixar `whatsapp_ai_state` inteira quando o resumo está
    ativo (os campos já vêm nele).
  - **Rota `/api/whatsapp/send`: escrituração DEPOIS da resposta.** Gravar
    a mensagem e o audit passaram pro `runAfterResponse` (`ctx.waitUntil`);
    só o vínculo wamid→lead (`vincularAbordagemAoLead`) ainda segura a
    resposta, com teto de 3s, porque o webhook da Meta precisa achá-lo. O
    portal mostra o envio pelo eco local e recebe a linha real pelo
    realtime segundos depois. Testes em `__tests__/portalWhatsAppNaoLidas
    .test.ts` (42).

- **"Cortou as opções no envio da abordagem" (2026-09-08, entregue em
  2026-09-11 como v=20260911a) — NÃO cortou.** Os botões de resposta rápida
  são do template aprovado e a Meta os anexa sozinha em todo envio (prova:
  quem toca neles chega como `type='button'`, 06/09). O que faltava era a
  BOLHA do portal desenhar o template inteiro: agora mostra cabeçalho,
  corpo, rodapé e botões (`BolhaConteudo`, ramo `template`). Depende da
  lista viva de templates (`templatePorNome`), que a aba já carrega. O PR
  #284 ficou 3 dias aberto com conflito enquanto a `main` avançou até o
  #297; foi reaplicado por cima.

- **ROTAS ADMIN ACEITAM QUEM FOI PROMOVIDO NO PORTAL (2026-09-10, decisão
  do usuário: "habilite pelo promover"). SEM SQL.** O relato: João estava
  promovido no portal e levava 403 ao responder WhatsApp ("não está na
  lista ADMIN_EMAILS"). Eram DUAS travas: o "Promover" grava
  `profiles.portal_access` (libera telas + RLS), e TODA rota de servidor
  (`whatsapp/send`, `suggest`, `templates`, `ai-prompt`, `followup`,
  `ping`, `admin/users`, `admin/stats`, `admin/errors-list`,
  `admin/moderate`, `upload-style-ref`) exigia o e-mail em `ADMIN_EMAILS`.
  Agora `ensurePortalAdmin({callerId, email})` em `_admin-helpers.ts` —
  allowlist OU `portal_access=true` OU `role='admin'`, lidos com a chave de
  serviço (mesma regra do guard RSC `isPortalAdmin` em `auth-server.ts`,
  que já era assim). Cache de 60s por caller no isolate (revogar leva até
  1 min pra valer na rota; o portal fecha na hora pela RLS). Banco fora →
  502, não 403; sem chave de serviço → só a allowlist. **`ADMIN_EMAILS`
  continua como porta de emergência** — não remover a env.
  `__tests__/api/admin-portal-access.test.ts` varre `app/api` e proíbe
  rota voltar a chamar `ensureAdminEmail`/`isAdminEmail` direto. Ações de
  ESCRITA de `admin/users` seguem exigindo `portal_access` ativo do caller
  (`ensureCallerHasPortalAccess`) — quem só está na allowlist lê.

- **WHATSAPP: BOTÃO "NÃO LIDAS" NA COLUNA DE CONVERSAS (2026-09-09, pedido
  do usuário: "botão de unread para ao clicar filtrar conversas que têm msg
  nova de cliente"). Portal v=20260909m, SEM SQL.** Pílula "● Não lidas (N)"
  embaixo da busca; ligada, a lista mostra só conversas com mensagem
  RECEBIDA depois do `whatsapp_ai_state.last_read_at` (a mesma regra do
  badge que já existia). **N é de CONVERSAS, não de mensagens.** A busca
  procura DENTRO das não lidas. **A conversa ABERTA fica na lista** mesmo
  depois de marcada como lida (`manter` em `filtrarConversas`) — abrir
  zera o contador, e sem isso ela sumiria no mesmo clique que a abriu.
  Puras `contarNaoLidas`/`filtrarConversas` entre `[teste:wa-lista-inicio]`
  /`-fim` (só JS, sem JSX), testadas em `__tests__/portalWhatsAppNaoLidas
  .test.ts`, que também trava que `naoLidas`/`convsFiltradas` da aba
  passam por elas. Item novo em `AJUDA_WHATSAPP`.
  - **A LISTA ERA "AS ÚLTIMAS 500 MENSAGENS" E CONVERSAS SE PERDIAM (mesmo
    PR, pergunta do usuário: "realmente aparecem todas as conversas ou
    algumas se perdem pelo limite?").** Perdiam: `limit(500)` em
    `whatsapp_messages`, agrupado por número — um lote de abordagem ocupava
    as 500 linhas e toda conversa mais antiga sumia da aba (histórico e não
    lidas juntos), enquanto o badge do menu contava por outra consulta.
    Agora: (1) a aba baixa TODAS as mensagens dos últimos `WA_DIAS_LISTA`
    (90) dias com `buscarEmPaginas`, emendadas por id (`mesclarMensagens`,
    devolve o MESMO array se nada mudou; linha com status de entrega novo
    é atualização — antes o ✓✓ só aparecia quando chegava mensagem nova);
    o poll de 60s só pede 1 dia (`created_at` OU `delivery_status_at`); o
    eco local do envio (`local-…`) some quando a linha real chega. (2) O
    histórico COMPLETO da conversa é buscado ao abrir (`conversasCarregadas`,
    uma vez por aba). (3) **Nome do lead pelo telefone da conversa**: o
    `limit(3000)` em `leads` (61 mil linhas) deixava quase todo lead
    abordado só com o número; `resolverLeads` pede `phone.ilike.*<4
    últimos dígitos>` (contíguos em qualquer máscara) em lotes de 60 e casa
    pelos 8 últimos aqui. (4) `whatsapp_ai_state` (marca de leitura) e o
    badge do menu também sem teto. (5) A coluna renderiza no máximo
    `WA_LISTA_MAX` (300) conversas e avisa — um lote pode criar milhares.
    `__tests__/portalWhatsAppNaoLidas.test.ts` proíbe os limites voltarem.

- **PORTAL: TELA "USO DO APP" (2026-09-09, pedido do usuário: "dashboard
  em relação ao uso do app: quem postou mais fotos, vídeos, colocou à
  venda, teve mais curtidas, convidou mais gente, pediu material na loja,
  camisa, uso das IAs, fez orçamentos"). Portal v=20260909l. SQL
  `/migrations/2026-09-09-ai-usage-feature-check.sql` — JÁ EXECUTADO no
  Supabase (2026-09-10, informado pelo usuário: "rodei"). Não pedir pra
  rodar de novo; reconferir pela linha da
  `2026-09-05-conferencia-pendencias.sql` antes de afirmar o contrário.
  A partir daí as chamadas das personas passam a contar; o histórico
  anterior ao ALTER não existe (os INSERTs eram recusados).**
  - **Quem agrega é o SERVIDOR**: `POST /api/admin/stats` (edge, service
    role, admin da allowlist, rate limit 30/min) → `lib/api/_services/
    admin-stats.ts`. Motivo: `ai_usage`, `referrals` e `points` têm RLS
    "cada um vê o seu" — consulta direta do portal mostraria só as linhas
    do próprio admin e o ranking sairia vazio parecendo "ninguém usa" (é o
    caso da aba Indicações, que lê `referrals` direto). `buscarTabela`
    pagina pelo `Range` (PostgREST corta em 1000 mesmo com service role),
    4 páginas em paralelo, teto de 40 mil linhas por tabela com aviso
    `truncado`; tabela quebrada sai zerada e nomeada, não derruba o resto.
    `montarRelatorio` é pura e testada (`__tests__/services/admin-stats
    .test.ts`).
  - **O que conta e de onde:** fotos/vídeos/à venda de `posts`
    (`isVideoPost` replicado: extensão OU `media_type`); curtidas e
    comentários RECEBIDOS pelo dono do post; seguidores de `follows`;
    indicações = `referrals.referrer_id`; pedidos = `orders`, e **camiseta
    = item do carrinho com id `shirt-…`** (é assim que o `ShirtCustomizer`
    põe a camiseta no pedido — não existe tabela de camisetas); logos =
    `brand_logos`; IA = `ai_usage` por `feature` (soma `cost_units`);
    orçamentos feitos (`painter_id`) × pedidos (`client_id`); avaliações
    recebidas (`reviews.painter_id`, denormalizado em 06/2026).
  - **"Tempo de uso das IAs" não existe como dado**: a `ai_usage` registra
    CHAMADAS, não minutos. A tela diz isso em vez de inventar uma conta.
  - **AS PERSONAS NUNCA FORAM REGISTRADAS.** O CHECK original da
    `ai_usage.feature` (Wave 7) lista 14 nomes, e as rotas de Alice/Fê/
    Senna (+ `alice_tts`, `receipt_ocr`) gravam outros — o INSERT volta
    23514 e `recordAiUsageViaRest` só faz `console.warn`. O SQL derruba o
    CHECK (a lista de features passa a ser a do código); o histórico
    anterior não tem como recuperar. A tela mostra o aviso enquanto nenhuma
    persona aparecer no período. `__tests__/portalUsoDoApp.test.ts` varre
    `app/api` e exige rótulo (`IA_FEATURE_ROTULOS`) pra toda feature
    gravada — feature nova sem rótulo não passa.
  - Tela: período (7/30/90/365 dias/tudo — perfis e seguidores não
    dependem dele), KPIs, pódio top 5 por categoria (`CATEGORIAS_DE_USO`,
    travado contra os rankings do serviço), IA por ferramenta, tabela por
    pessoa ordenável (só quem fez algo, por padrão) e CSV. A aba Analytics
    antiga continua.

- **LEADS: A TELA CARREGA COM 61 MIL LINHAS (2026-09-09, relato do
  usuário: "creio que pq tem 60k+ leads, a pagina nao carrega"). Portal
  v=20260909g, SEM SQL.** Três causas empilhadas, as três corrigidas:
  - **`buscarTudo` paginava em SÉRIE e tinha teto de 50.000** — parava em
    silêncio na página 50 (o teto saiu; ele segue existindo, sem teto, pras
    listas menores). `buscarEmPaginas` (marcadores `[teste:paginas-*]`):
    1ª página com `count:'exact'`, as outras 4 em paralelo, cada lote na
    SUA posição (`paginas[n]`), `aoChegar(parcial,total)` a cada lote e
    `cancelado()` pra parar quando a tela fecha. **A consulta ordena por
    `created_at` E `id`**: lote de importação inteiro tem o mesmo carimbo,
    e paginar por `created_at` sozinho repete/pula linha entre páginas.
  - **A tela esperava a ÚLTIMA página.** Agora a 1ª pinta e tira o
    "Carregando"; o resto entra a cada ~600ms (`comIntervalo`, senão 60
    lotes = 60 refiltragens de 61 mil) com "⏳ carregando N de M" no KPI.
    Cache em memória (`_leadsCache`) + botão ↻; importação recarrega.
  - **Um `<tr>` por lead travava o navegador.** Janela de `LEADS_JANELA`
    (100) linhas da lista filtrada, sentinela por IntersectionObserver e
    "Mostrando X–Y de Z". **Com TETO (Codex no #291, corrigido no #292):**
    a sentinela cresce só até `LEADS_BLOCO` (500); daí é "próximos 500 ›",
    que DESMONTA o bloco anterior (`janelaDeLeads`, pura). O prefixo que
    só crescia (receita do catálogo de produtos) remontaria as 61 mil
    linhas de quem rolasse a lista inteira — o catálogo tem o mesmo
    desenho e 21 mil cards; se incomodar lá, é a mesma função.
  - **Recarga total virou EMENDA** (`emendarLeads`, por id, devolve a
    MESMA lista se nada mudou): `updateStatus` emenda a linha, e o poll de
    20s + pós-envio usam `leadsService.recentes` (leads com `abordagem_at`
    nas últimas 6h, PAGINADO sem teto — um lote pode passar de mil) em vez
    de baixar tudo de novo — o webhook escreve `abordagem_at` a cada
    status, então a janela pega o que muda.
  - **Busca do topo acha por TELEFONE (2026-09-09, pedido do usuário):**
    `buscaDeLead(q)` — consulta que é só número (com ou sem máscara) casa
    pelos dígitos do telefone; texto segue em nome/segmento/categoria/
    bairro/@. "Rua 402" NÃO vira busca de telefone (endereço com número
    traria lead errado). Consulta com DDI 55 também é tentada sem ele — a
    base guarda o telefone como veio da planilha, com ou sem +55 (Codex
    no #294). Portal v=20260909l.
  - Busca com 250ms de atraso; ordenação por texto com `Intl.Collator`
    (o `localeCompare` monta um collator por comparação — segundos por
    ordenação em 61 mil linhas). Testes em `__tests__/portalLeadsJanela
    .test.ts`; o teste de abordagem já cobria `selecionados`.
  - **Custo conhecido:** segue `select('*')` (o aviso `semColunaAbordagem`
    depende de ver as colunas), então a carga completa baixa dezenas de
    MB — só que agora em paralelo e sem travar a tela.

- **MODAL DE ABORDAGEM ESPELHADO (2026-09-09, pedido do usuário: "espelha
  o modal para o botão ficar do lado direito de enviar"). Portal
  v=20260909f, SEM SQL.** Prévia à ESQUERDA, campos + Enviar à DIREITA, no
  `EnvioDeTemplate` (unitário + aba WhatsApp) e no lote. Feito com
  `flexDirection:'row-reverse'`, NÃO trocando a ordem do DOM: os campos
  seguem primeiro pro Tab, e em tela estreita o `wrap` continua empilhando
  campos em cima da prévia — trocar o DOM traria de volta o problema de
  08/09 (prévia empurrando o Enviar pra baixo da dobra). Teste em
  `portalAbordagemEntrega.test.ts`.

- **IMPORTADOR DE LEADS ACEITA EXCEL DIRETO (.xlsx/.xls/.xlsm/.ods)
  (2026-09-09, pedido do usuário). Portal v=20260909e, SEM SQL.** O portal
  não tem bundler, então o SheetJS (xlsx 0.18.5, Apache-2.0, ~880 KB) vive
  VENDORADO em `public/portal/xlsx.full.min.js`, como o React, e é carregado
  por `<script>` dinâmico com SRI **só quando a pessoa escolhe um Excel**
  (`carregarXlsx`) — a tela de leads não paga isso no boot. O CSV segue no
  parser nosso (separador `;`/`,` + windows-1252). Só a PRIMEIRA aba é lida.
  - **Célula numérica vira `String(v)`**, nunca o texto formatado do Excel:
    telefone em coluna estreita sai "1.19877E+10" no `w` da célula, e o
    `raw:true` + conversão própria evita isso.
  - **Trocou o arquivo vendorado? Trocar `XLSX_SRI` no `app.jsx`.** Hash
    errado = o navegador recusa o script em silêncio e a tela diz "não
    consegui carregar o leitor de Excel". `__tests__/portalImportarExcel
    .test.ts` confere o hash contra o arquivo real no CI.

- **WHATSAPP: RESPOSTA PELO CELULAR, REAÇÃO E EDIÇÃO APARECEM NA CONVERSA
  (2026-09-09, relato do usuário: "não está aparecendo as mensagens
  respondidas pelo celular, e reaction e edits"). Portal v=20260909d, SEM
  SQL.** Três causas distintas:
  - **Eco do celular vinha em OUTRO campo.** Em Coexistence, o que a loja
    manda pelo app do WhatsApp chega no webhook como `field=
    'smb_message_echoes'` com `value.message_echoes[]` (a contraparte é o
    `to`; o `from` é o próprio número da loja). `classifyWebhookPayload` só
    processava `messages` e respondia "ignorado" pro resto — a resposta dada
    no aparelho nunca existia no portal e a conversa parecia abandonada.
    `parseEchoMessages` lê esse campo; o webhook grava como `direction='out'`
    + `origin='celular'` (o chip 📱 já lia isso) e NUNCA chama a IA pra eco.
    O wamid UNIQUE descarta o eco do que saiu pelo portal/IA.
    **Incerteza declarada:** depende de o Dualhook repassar esse campo; se a
    resposta do celular seguir sem aparecer, é assinatura do lado deles.
  - **`[reaction]`/`[edit]`/`[unsupported]` secos:** o parser só lia
    `text.body`. `textoDeReacaoOuEdicao` pega `reaction.emoji` (vazio =
    removeu a reação) e o texto novo de `edit.text.body`/`text.body`
    (formato da edição não é documentado pela Meta — best-effort, com
    `refMessageId` pro wamid alvo). `TIPOS_SEM_CONVERSA` (reaction, edit,
    unsupported, system) grava no histórico mas NÃO acorda a IA —
    responder a um 👍 com parágrafo seria loop de constrangimento.
  - **Portal:** `rotuloDeTipo` (bolha + prévia da lista): "👍 reagiu a uma
    mensagem", "✏️ editou: …", e pra `unsupported` a explicação (enquete,
    contato, temporária — a API não repassa o conteúdo; ver no celular da
    loja). Testado em `portalAbordagemEntrega.test.ts`.

- **LEADS: STATUS "FIXO (SEM WHATSAPP)" (2026-09-09, pedido do usuário).
  Portal v=20260909c, SQL só se houver CHECK.** Boa parte dos 90 "não
  entregue" do incidente era telefone fixo — template nunca chega, mas o
  lead não é "perdido" (pode valer por outro canal). `LEADS_STATUS` virou a
  lista ÚNICA (select da linha, filtro do topo, filtro do cabeçalho,
  contagens); o teste proíbe lista escrita à mão voltar. Lead `fixo` sai da
  seleção em lote; o "Abordar" unitário segue (fixo pode ter WhatsApp
  Business). **A tabela `leads` nasceu fora do repo e não dá pra saber
  daqui se `status` tem CHECK**: `/migrations/2026-09-09-leads-status-fixo
  .sql` é conferência (lista os CHECKs) + ALTER comentado; o portal traduz
  o 23514 apontando pra esse arquivo. **CONFERIDO NO BANCO (2026-09-09):
  a consulta de `pg_constraint` voltou ZERO linhas — `leads` não tem CHECK
  nenhum.** O ALTER comentado não é pendência; o arquivo fica como
  conferência.

- **LEAD "CONTACTADO" SÓ COM CONFIRMAÇÃO DA META (2026-09-09, pedido do
  usuário). SQL `/migrations/2026-09-09-leads-abordagem-entrega.sql` —
  JÁ EXECUTADO no Supabase (2026-09-09, informado pelo usuário: "rodei o
  SQL"). Não pedir pra rodar de novo. Linha na
  `2026-09-05-conferencia-pendencias.sql`. O código TOLERA a coluna ausente
  e a tela de Leads mostra o aviso enquanto o SQL não roda.**
  - **O INCIDENTE:** uma leva de abordagens saiu do portal, a API aceitou
    todas (200 + wamid), `enviarTemplateDaLoja` marcou cada lead como
    `contactado` — e minutos depois a Meta devolveu `failed` 131026 (Message
    undeliverable) pra boa parte. O `failed` pousava só em
    `whatsapp_messages` (Wave 58); a tela de Leads seguia dizendo
    "contactado" pra quem nunca recebeu nada. **"A API aceitou" e "a
    mensagem chegou" são momentos diferentes** — o portal tratava o primeiro
    como o segundo.
  - **Agora o lead carrega a própria abordagem:** `abordagem_message_id`
    (wamid), `abordagem_status` ('accepted' | 'sent' | 'delivered' | 'read'
    | 'failed'), `abordagem_error`, `abordagem_at`. Quem escreve é o
    SERVIDOR: a rota `/api/whatsapp/send` recebe `leadId` (portal manda nos
    três caminhos: unitário, lote e aba WhatsApp quando o número casa com
    um lead) e grava wamid + 'accepted' (`vincularAbordagemAoLead`) SEM
    tocar em `status`; o webhook (`persistStatusDoLead`, chamado depois de
    `persistStatusEntrega`) acha o lead pelo wamid, grava o status e decide
    o funil: sent/delivered/read → `novo` vira `contactado`; `failed` →
    `contactado` VOLTA a `novo` com o motivo. Qualificado/convertido/perdido
    nunca são tocados. O status só anda pra frente (`filtroSoAvanca` no
    PATCH — a Meta entrega fora de ordem).
  - **Corrida conhecida e tratada:** o `sent` pode chegar antes de a rota
    terminar a escrituração (o vínculo é gravado em paralelo com a
    resposta). O webhook tenta o lead de novo uma vez após 1,5s
    (`ESPERA_VINCULO_MS`); sem isso o lead ficaria `novo` pra sempre com a
    mensagem entregue.
  - **O portal só grava sozinho a RECUSA da API** (401/422/400: não há
    wamid nem webhook) como `abordagem_status='failed'` com o motivo.
  - **Portal (v=20260909a):** badge embaixo do select de status (⏳
    aguardando / ✓ enviada / ✓✓ entregue / ✓✓ lida / ⚠ não entregue +
    "131026 · Message undeliverable"), select **"Entrega"** ao lado de
    Categoria (Não entregue / Entregue / Enviada / Aguardando / Sem
    abordagem, com contagem), CSV com as três colunas, e a lista se
    atualiza sozinha a cada 20s enquanto houver `accepted` com menos de 15
    min (`abordagemPendente`). O lote diz "N aceitos pela API" em vez de
    "enviados". Helpers puros entre `[teste:abordagem-inicio]`/`-fim`,
    testados em `__tests__/portalAbordagemEntrega.test.ts` (que também
    proíbe o portal voltar a escrever `status:'contactado'` no envio).
  - **O SQL faz o BACKFILL do incidente:** a última mensagem que o PORTAL
    mandou pra cada telefone (8 últimos dígitos) vira a abordagem do lead
    (sem status gravado = 'accepted'), e `contactado` + `failed` volta pra
    `novo`. A consulta no fim do arquivo mostra a contagem por
    status × entrega. Quem está `contactado` sem confirmação nenhuma fica
    como está, marcado "⏳ aguardando" — não dá pra afirmar nem que chegou
    nem que falhou.
  - **REGRA: escrita de funil que depende de entrega externa é do
    servidor, no evento de confirmação — nunca do cliente, na aceitação.**

- **IA DO WHATSAPP: prompt EDITÁVEL no portal + não fala do QueroUmaCor +
  entende a abordagem (2026-09-08, três pedidos do usuário). SQL
  `/migrations/2026-09-08-whatsapp-ai-prompt.sql` (uma linha:
  `whatsapp_ai_config.prompt text`) — JÁ EXECUTADO no Supabase (2026-09-16,
  confirmado pelo usuário: a linha de conferência de
  `2026-09-05-conferencia-pendencias.sql` voltou `ok=true`). Não pedir pra
  rodar de novo.**
  - **"Não falar da QueroUmaCor automaticamente":** a IA respondeu "Posso te
    ajudar com algo relacionado a tintas ou o app QueroUmaCor?". A frase de
    apresentação do app saiu do prompt e entrou a regra 6: só fala do app
    se a PESSOA perguntar.
  - **"Vocês que me chamaram" → "não tenho essa informação":** a abordagem
    entra no histórico como registro cru (`[template calicolors_abordagem_v2]
    {{1}}=…`), e a IA não sabia que a loja tinha começado a conversa.
    `descreverRegistroDeTemplate` (em `loadTurns`) troca o registro por um
    resumo da mensagem de apresentação, e a regra 7 ensina a explicar por que
    a loja chamou.
  - **Prompt editável:** `PROMPT_BASE_PADRAO` (identidade + regras) é a parte
    que a loja edita; `buildSystemPrompt({promptBase})` usa o texto do banco
    no lugar dela e mantém FIXOS o contexto do lead, os blocos de primeiro
    contato/pendência, o estilo e o formato JSON (sem ele o parser quebra).
    As travas de preço são código e valem seja qual for o texto. Runner e
    rota `suggest` leem `whatsapp_ai_config.prompt`; o runner refaz o select
    sem a coluna se o 42703 zerar a config (senão horário/padrão/ausência
    voltariam ao default em silêncio). Portal (v=20260908g): botão "🧠
    Prompt da IA" na barra → modal com textarea; o PADRÃO vem de
    `GET /api/whatsapp/ai-prompt` (admin), não de cópia no portal; salvar
    igual ao padrão grava NULL de propósito (melhoria futura do padrão chega
    sozinha); coluna ausente → a tela mostra o SQL. Testes:
    `__tests__/portalPromptIa.test.ts` + `whatsapp-ai.test.ts`.

- **ABORDAGEM: v2 É O MODELO INICIAL + a cidade sai de onde estiver
  (2026-09-08, pedido do usuário: "abordagem V2 como padrão inicial e corrija
  os campos para mapear certo"). Portal v=20260908b, SEM SQL.**
  - **`templateInicial(lista)`**: o seletor abre em `calicolors_abordagem_v2`
    quando a lista VIVA (da Meta) o traz; a embutida não o tem de propósito
    (132001 se não aprovado), então nela segue `calicolors_nome`. A lista viva
    chega depois do primeiro render e TROCA o inicial — mas só enquanto o
    operador não mexeu no seletor (`tocado` ref); depois disso a chegada da
    lista não desfaz a escolha dele.
  - **`cidadeDoLead(l)` ({{2}}): `city` → endereço que é só lugar → cidade
    conhecida no nome.** O print mostrava "Studio Arquitetura Guarulhos" com
    CIDADE "—", "Guarulhos" embaixo do nome (era o `address`) e o campo 2
    vazio travando o botão: os leads antigos de captação gravaram a cidade em
    `address`, e o prefill só lia `city`. "R. Manaus, 158", "Av. Paulista" e
    "Jardim dos Pimentas" NÃO viram cidade (dígito ou prefixo de logradouro);
    o nome só conta contra `CIDADES_CONHECIDAS` (31 da região), nunca uma
    palavra qualquer. Os dois chamadores (`AbordagemModal` e aba WhatsApp) e
    a coluna CIDADE da tabela usam a MESMA função — a tabela mostra a cidade
    que a abordagem vai mandar. Testes em `__tests__/portalRamoDoLead.test.ts`
    e `__tests__/portalJanela24h.test.ts`; o teste proíbe voltar a ler
    `lead.city` cru no prefill.
  - **A ABA WHATSAPP FICOU "TODA BUGADA" com o v2 (v=20260908c).** O bloco
    "Fora da janela de 24h" é filho de uma coluna flex de altura fixa
    (`calc(100vh - 230px)`) e não tinha `overflow`: item de flex não encolhe
    abaixo do conteúdo, e o v2 (texto longo + 4 botões na prévia) ficou mais
    alto que a coluna — empurrava o cabeçalho e o histórico pra fora da tela
    em vez de rolar. Agora `maxHeight:62%` + `overflowY:auto` + `minHeight:0`
    no bloco; botões da prévia mais baixos. **REGRA: filho de coluna flex de
    altura fixa que pode crescer precisa de `overflow` + `minHeight:0`.**
  - **{{1}} É O NOME COMPLETO do lead (v=20260908d, decisão do usuário:
    "falta aparecer o nome completo do lead e não somente a primeira
    palavra").** O lead é quase sempre um negócio ("Neri Pintor Atelier") e
    "Oi Neri" cortava o nome. `nomeCompleto` no prefill do campo 1, mesma
    validade do `primeiroNome` (telefone e inicial solta não passam). O
    `primeiroNome` FICA pro follow-up automático (`escolherTemplate`,
    paridade com o servidor) — só o prefill do modal mudou.
  - **LEADS: chips de segmento/categoria viraram DOIS SELECTS (v=20260908e,
    pedido do usuário: "não precisa mostrar todos esses ícones, apenas um
    campo com dropdown").** Com 1464 leads e segmentos vindos de planilha
    ("POST 11 - 69A EDICAO"…) os chips eram sete linhas de botão empurrando a
    tabela pra baixo da dobra. Os selects escrevem nos MESMOS states dos
    filtros do cabeçalho da tabela. Os segmentos "POST nn - nnA EDICAO" e as
    categorias numéricas ("68", "67") são DADO da importação da Click Rua
    (coluna Edição mapeada errado), não bug de tela — corrigir é UPDATE no
    banco, proposto no chat e não rodado.
  - **ABORDAGEM EM LOTE + modal em duas colunas (v=20260908f, pedido do
    usuário: "marcar múltiplos e mandar o modal para vários ao mesmo tempo"
    e "ver o modal inteiro com o botão de enviar sem rolar").**
    - Checkbox por linha (só lead abordável: telefone válido e sem opt-out)
      + checkbox do cabeçalho (marca os abordáveis da lista filtrada) +
      barra "💬 Abordar N selecionados". `AbordagemLoteModal`: mesmo
      template pra todos; as variáveis NÃO são digitadas, saem do cadastro
      de cada lead pelas MESMAS funções do unitário (`nomeCompleto`,
      `cidadeDoLead`, `ramoDoLead`). Lead com campo vazio, sem número, com
      opt-out ou dos EUA em Marketing fica DE FORA com o motivo na linha.
      Envio um por vez (400ms de folga), resultado por linha, "Parar" entre
      um e outro, "Reenviar N com falha" no fim.
    - **`useListaDeTemplates`** (hook) + `SeletorDeTemplate` +
      `AvisoListaEmbutida` + `pacoteDeTemplate` + `enviarTemplateDaLoja`:
      unitário e lote compartilham lista, modelo inicial, corpo do POST e o
      envio (que marca `contactado`). Testes travam que os dois passam por
      `pacoteDeTemplate` e pelo hook.
    - **`EnvioDeTemplate` virou DUAS COLUNAS** (campos | prévia, `flex-wrap`
      empilha em tela estreita) e o modal foi a 1000px com intro de uma
      linha — em coluna única a prévia do v2 empurrava o Enviar pra baixo da
      dobra. A aba WhatsApp usa o mesmo componente e ganhou a mesma largura.

- **LEADS: "PERFIL DO IG" + ESTADO — importação dos grafiteiros da Click Rua
  (2026-09-08, pedido do usuário). SQL
  `/migrations/2026-09-08-leads-instagram.sql` (duas linhas: `leads.instagram
  text` e `leads.state text`) — JÁ EXECUTADO no Supabase (2026-09-08,
  informado pelo usuário). Não pedir pra rodar de novo.** A planilha "Revista Click Rua — Diretório de
  Artistas" (Edição, Nome, Perfil do IG, Cidade, Estado) vem quase toda SEM
  telefone: o canal desses leads é o Instagram.
  - **Importador do portal (v=20260908a): Nome + (Telefone OU Perfil do IG).**
    Duplicata = mesmo telefone (8 últimos dígitos) OU mesmo @ (`normalizarIg`
    tira "@", "instagram.com/" e barra final). Quem não tem nenhum dos dois
    fica de fora, com contagem no relatório. Planilha sem coluna Segmento
    ganha um select "usar pra todas as linhas" — escolha explícita, nunca
    chute; GRAFFITI põe a categoria `Graffiti/Arte` (a única desse funil).
  - **Tolera as colunas ausentes**: INSERT com 42703 em `instagram|state` é
    refeito sem as duas e o relatório avisa em laranja pra rodar o SQL e
    importar de novo (as linhas entram, mas sem @ e UF). Recurso novo não
    derruba o que já funciona por SQL pendente.
  - **Tabela: coluna "PERFIL DO IG"** (link pro perfil) e, pra lead sem
    telefone, o botão da ação vira **"📸 Abrir IG"** — "Abordar" é template de
    WhatsApp e não faz sentido ali. Busca do topo também acha pelo @.
  - Build do portal conferido byte a byte antes de mexer (recipe do
    CLAUDE.md, `@babel/preset-react` instalado com `--no-save`).

- **AJUSTES DE DESKTOP E PORTFÓLIO (2026-09-08, três pedidos do usuário).**
  - **"Baixar PDF" abria a janela de Share do Windows.** `shareOrDownloadPdfBlob`
    tentava `navigator.share` com arquivo antes de tudo, e Chrome/Edge no
    Windows/macOS expõem essa API. Agora o share sheet só entra em
    Android/iOS; no desktop, "baixar" baixa. Vale pro PDF de pedido e de
    orçamento.
  - **Kanban de orçamentos espremido no PC.** O grid usava `xl:grid-cols-3`,
    que olha a JANELA, dentro de um `BottomSheet` de 430px — num monitor
    largo eram 3 colunas em 430px. Grid virou `repeat(auto-fill,
    minmax(300px, 1fr))` (largura do CONTAINER) e o `BottomSheet` ganhou
    `maxWidth?` (default 430); o tile `orcamentos` abre com 1100. **REGRA:
    dentro do sheet, breakpoint do Tailwind mente — usar auto-fill/minmax.**
  - **"Meu Portfólio" abria o composer igual ao /publicar.** O `Composer`
    ganhou `modo='portfolio'` (via `SheetConfig.props` no `BusinessGrid`):
    sem abas Publicação/24h (portfólio é permanente; rascunho de story
    restaura como publicação), sem "Marcar como venda" (isso é o tile Arte
    pra venda), título "📸 Meu Portfólio" e botão "Publicar no portfólio".
  - **Anotações: "Gravar áudio" abria o seletor de ARQUIVO no app Android.**
    O `NotesView` pulava o `getUserMedia` em Android por um gate
    `isAndroidWebView` da época do WebIntoApp (que nunca dava a permissão) e
    ia direto pro `<input capture>`. Na casca Capacitor o microfone funciona
    (o Seu Zé usa desde o par RECORD_AUDIO+MODIFY_AUDIO_SETTINGS). Agora
    tenta o microfone PRIMEIRO em todo lugar; o gravador do sistema é só o
    fallback do `onError`. `useAudioRecording` ganhou teto de 12s no
    `getUserMedia` (promessa pendurada na WebView não rejeita).
  - **Tile "Arte pra IG" REMOVIDO do BusinessGrid** (decisão do usuário). A
    rota `/arte-ig` e o `AiArtStudio` continuam no repo; só o tile e o passo
    do tour saíram (o `tour.test.ts` obriga os dois a andarem juntos).

- **PDF DO ORÇAMENTO NO LAYOUT DE REFERÊNCIA (2026-09-08, pedido do usuário:
  "100% fiel" ao orçamento da LP Decor Pinturas, 4 páginas). SEM SQL.**
  Cabeçalho do profissional (logo, nome, "Pintor", CNPJ, CPF, endereço,
  telefone, e-mail) + caixa "Orçamento nº"; Cliente (nome, telefone,
  endereço, CEP) + faixa "Visita técnica em:"; tabela "Serviços" em cards
  (item + descrição longa | Valor por m² | Quantidade | Subtotal); faixas
  "Valor total dos Serviços" / Subtotal / Descontos / "Valor total"; Laudo
  Técnico; Informações adicionais; Pagamento (formas + Chave PIX); "Este
  serviço será realizado na parte Interna/Externa da casa"; botões
  Recusar/Aprovar; página "Área do profissional" (logo + bio); rodapé
  "Documento gerado em" em toda página.
  - **UM MODELO, DOIS RENDERIZADORES.** `lib/orcamentoDocumento.ts`
    (`montarDocumento(quote, perfil)`, puro, testado em
    `__tests__/orcamentoDocumento.test.ts`) faz TODA a conta; quem desenha
    é `lib/pdf/quotePdf.ts` (jsPDF — o arquivo que o cliente recebe, único
    caminho que funciona no app) e `components/orcamento/OrcamentoDocumento
    .tsx` (HTML — prévia do wizard e `QuotePdfSheet` do pipeline). A prévia
    é o arquivo, não um resumo dele.
  - **O que o banco NÃO tem e vive em `quote_data`:** `numero` ("12/2026",
    contado dos orçamentos do pintor no ano, na abertura do wizard),
    `visitaTecnica` (datetime-local — hora DIGITADA, não passa por fuso),
    `cliente` {rua, bairro, complemento, cidade, uf, cep}, `desconto`
    ("10%" ou "500,00"), `laudoTecnico`, `pagamento[]`, `chavePix`,
    `descricao` por item, `local` (interna/externa) por serviço, e o snapshot
    `painter` com `cnpj`/`cpf`/`endereco`/`email`/`rotulo`/`sobre` — **o
    perfil não tem coluna de CNPJ, CPF nem CEP**; o wizard pede e REAPROVEITA
    do último orçamento gravado (fonte = banco, não localStorage). Se um dia
    quiserem no perfil: `ALTER TABLE profiles ADD COLUMN cnpj text, cpf
    text` + campos no `/perfil/editar`.
  - **Totais:** subtotal = soma dos itens preenchidos; desconto digitado (%
    da soma ou R$); valor total = digitado > subtotal − desconto > IA. Preço
    digitado ABAIXO da soma sem desconto explícito vira desconto no PDF (o
    cliente vê a conta fechar). Orçamento antigo (sem `servicos`) vira uma
    linha com o preço; `itens` {desc, valor} do vanilla também.
  - **Aprovar/Recusar são links `wa.me`** pro telefone do pintor com a
    mensagem pronta — não existe página de aprovação pelo cliente (quote
    criada pelo wizard não tem `client_id`). `digitosDoTelefone` segue a
    regra do `normalizeWhatsAppTarget` (11 dígitos só é BR com 3º = 9).
  - **O botão PDF do wizard gera pelo jsPDF** (`generateQuotePdfBlob` +
    `shareOrDownloadPdfBlob`), não mais `window.print()` — que é no-op na
    WebView. O `Visualizar` mostra o `OrcamentoDocumento` e o print do
    navegador fica como opção dentro dele.

- **AR GRAFITE: "Capturar" NÃO FAZIA NADA NO APP ANDROID (2026-09-07).** O
  `ArtAROverlay` compositava vídeo + arte no canvas e disparava um
  `<a download>` de `blob:` — funciona no navegador do PC e a WebView do
  Capacitor ignora em silêncio. Agora entrega por `shareOrDownloadImage`
  (share nativo → Filesystem da casca → download), o mesmo caminho que o
  Arte pra IG já usava, com toast de resultado e erro visível (CORS que
  tainta o canvas virava exceção muda).
  - **REGRA: salvar imagem gerada no cliente = `shareOrDownloadImage`, nunca
    `<a download>` direto.** É a 2ª vez que o anchor cru passa (Arte pra IG
    foi a 1ª).
  - Junto: botões **↔ Espelhar / ↕ Espelhar / ↻ Girar 90°** (nunca existiram
    nessa tela; o usuário lembrava deles). `Transform` ganhou `flipX/flipY`, e
    CSS e canvas usam a MESMA ordem (`cssTransform`: translate → rotate →
    scale com sinal) — senão a prévia mente sobre a captura.
  - **"Girar em pé" e "Inclinar" (2026-09-08)** — o que o usuário lembrava era
    o "🔄 Girar" 3D do modo **WebXR** (`ArtArWebXR`), que só existe no Chrome
    Android com ARCore; no app (WebView) e no PC cai no overlay 2D, que não
    tinha isso. O overlay ganhou `yaw`/`pitch` (0-360) com `rotateY`/`rotateX`
    **ORTOGRÁFICOS** (sem `perspective`) de propósito: sem perspectiva o CSS é
    exatamente "largura × cos(ângulo)", e o canvas 2D reproduz com um
    `scale` — com perspectiva a prévia ficaria mais bonita e a captura
    mentiria sobre ela. Duplo clique no slider zera.

- **ORÇAMENTO (Crie e envie) = VÁRIOS SERVIÇOS, cada um com espaço, material
  e itens da TABELA ABRAPP (2026-09-07, pedido do usuário, em duas rodadas).
  SEM SQL.** O `QuoteWizard` perdeu os cards únicos "Espaço" e "Material e
  técnica": eles viraram campos DE CADA SERVIÇO. A seção **🧾 Serviços** tem
  um bloco por serviço (tipo, área, pé direito, cômodos, superfície, acesso,
  tinta, cor, demãos, preparação) + os **itens** daquele serviço escolhidos na
  Tabela de Preços (o MESMO catálogo do tile, via `usePriceTable`/
  `price_table_items`) ou avulsos, com quantidade e valor por unidade.
  Logística, observações, escopo e valor final seguem únicos por orçamento.
  - **A SEÇÃO COMEÇA VAZIA — o bloco NASCE do item (3ª rodada, decisão do
    usuário: "não precisa esse Serviço 1 aqui").** Não há bloco pré-montado:
    escolher uma linha na tabela (ou "+ Avulso") cria o serviço em volta dela
    (`servicoComItem`, herdando acesso e tinta do anterior). Gravar com zero
    serviços bloqueia com toast.
  - **O BLOCO MOSTRA SÓ O ITEM (4ª rodada: "veio esse Serviço 1 de pintura
    interna que nem pedi").** Espaço e material ficam atrás de "▸ Detalhes do
    serviço" (fechado; abre sozinho só se já tem algo preenchido) e
    `novoServico` nasce TODO vazio — sem "Pintura interna", "2.8", "2 demãos"
    nem "Massa corrida" pré-escolhidos, porque default vira afirmação no PDF.
    Sem tipo, o nome do serviço (cabeçalho, `service_type`, PDF) é o do
    primeiro item da tabela (`nomeDoServico`). Os selects têm "Selecione…".
  - **A 1ª rodada tinha UMA lista de itens pro orçamento inteiro** e o
    usuário corrigiu no mesmo dia: "pode ter múltiplos serviços" — sala e
    fachada têm tinta, acesso e área diferentes; um Espaço só não descreve
    a obra. `servicosDoQuoteData` ainda LÊ aquele formato (itens direto na
    lista → vira um serviço único com os campos do topo do `quote_data`),
    porque a versão ficou ~1h em produção.
  - **O valor do item NASCE VAZIO e a sugestão da tabela (mín/média/máx)
    fica do lado, com "Usar média"** — a tabela sugere, quem assina é o
    pintor; preencher sozinho mandaria preço de tabela sem decisão.
  - **Valor final: digitado > soma dos itens preenchidos (de todos os
    serviços) > IA.** A soma "com a sugestão da tabela nos que faltam" aparece
    como dica com botão "Usar", nunca entra sozinha no campo. O campo lê por
    `parseBRL` (o botão escreve "1.616,00"; `parseFloat` leria 1,616 — P1).
  - **`quotes.service_type`/`title` = `tituloDosServicos`** (um serviço → o
    tipo; vários → tipos distintos com " + "); `area_m2` = soma das áreas.
  - **Lógica pura em `lib/orcamentoServicos.ts`** (testada em
    `__tests__/orcamentoServicos.test.ts`): opções dos campos (fonte única),
    `novoServico`, `itemDaTabela`/`itemAvulso`, quantidade vazia vale 1,
    valor vazio é `null` (não zero), subtotal a centavo, `totaisDosItens`/
    `totaisDoOrcamento` separam `preenchido` × `sugerido`, `resumoDoServico`/
    `detalhesDoServico`/`descreverServico` (tela, PDF, WhatsApp e prompt da
    IA usam o MESMO texto), `servicosDoQuoteData` lê o jsonb descartando
    linha malformada. **Tela, PDF e pipeline usam a MESMA conta.**
  - Gravado em **`quotes.quote_data.servicos`** (jsonb já existente — por
    isso sem SQL). Aparece no preview do wizard, no `QuotePdfSheet`, no
    `quotePdf.ts` (jsPDF) e no detalhe `/orcamentos/[id]`, um bloco por
    serviço. Orçamento antigo (sem `servicos`) segue renderizando a tabela
    plana de antes; o `itens` legado (`{desc, valor}`) do vanilla também.
  - **O seletor é modal em portal com `zIndex: 1100`**, não lista inline: o
    wizard vive dentro de um BottomSheet (z-1000) e 328 itens ali seria
    rolagem dentro de rolagem. O "Acesso" DO SERVIÇO pré-seleciona o filtro
    de altura (`alturaDoAcesso`: andaime/suspensa → acima de 3 m).
  - A tabela é de pintura, mas a seção aparece pra TODO papel que vê o tile
    (grafiteiro, automotivo, arquiteto): pra eles serve o **"+ Avulso"**, e a
    tabela segue sendo `SELECT` liberado pra `authenticated`.
  - Item avulso sem nome BLOQUEIA o Gravar com toast, em vez de sumir em
    silêncio (poderia estar precificado).

- **ADMIN APAGA POST DE OUTRA PESSOA (2026-09-07) — SEM SQL PENDENTE.** O
  app já deixava o admin apagar COMENTÁRIO de qualquer um (Wave 9), mas não
  POST: mesma tela, duas regras pro mesmo ato de moderar. O que impedia era
  o `.eq('user_id', userId)` do UPDATE em `deletePost` — filtrando pelo
  dono, o admin nunca casava linha. `comoAdmin` remove só esse filtro; **a
  permissão continua sendo da RLS**, e cliente adulterado mandando a flag
  sem ser admin bate na policy e volta zero linhas.
  - **CONFERIDO NO BANCO (2026-09-07): `moderacao_ok = true`,
    `update_restritivas = 0`.** A policy `posts_owner_update` viva JÁ aceita
    `is_portal_admin()`. **Não pedir pra rodar
    `/migrations/2026-09-07-posts-admin-moderation.sql`** — o arquivo é
    conferência re-executável, e os passos de DROP/CREATE existem só pro caso
    de a conferência voltar false.
  - **`update` que não acha linha é SUCESSO com zero linhas** — a mesma
    armadilha do `/completar-perfil`. Aqui seria pior: o post sumiria pelo
    update otimista, voltaria no refetch, e o admin concluiria que o app está
    quebrado. `deletePost`/`undoDeletePost` agora pedem `.select('id')` e
    **estouram** em zero linhas, com mensagem que aponta pra policy
    (moderação) ou pro post (dono). Conferido que isso não gera falso erro: a
    policy de SELECT (`View posts active`) enxerga a linha depois do UPDATE
    tanto pro dono quanto pro admin.
  - **`SELECT public.is_portal_admin()` NO SQL EDITOR NÃO RESPONDE "minha
    conta é admin?"** — ali a sessão é `postgres`/`service_role`, `auth.uid()`
    é NULL e a função devolve **false mesmo com a conta sendo admin**.
    Escrevi essa checagem, ela voltou false e não provou nada. Mesmo erro de
    método do `profiles_role_check`: **checagem que responde false pra sempre
    é pior que checagem nenhuma.** Pra valer: ler `prosrc` da função + a linha
    do perfil por `to_jsonb` (coluna ausente vira 42703 num `select` direto).
  - **Colar bloco de SQL com DROP+CREATE juntos faz o CREATE rodar sozinho**
    (42710 aqui; 42601 na Wave 26). Postgres não tem `CREATE POLICY IF NOT
    EXISTS`, então a ordem importa — **uma instrução por vez**. E, por sorte,
    o DROP não passou: ele teria derrubado e recriado uma policy que já
    estava certa. **Conferir SEMPRE antes de alterar RLS de produção.**
  - **LACUNA CONHECIDA, não resolvida:** apagar post alheio **não deixa
    rastro de quem apagou**. `audit_log` não tem policy de INSERT pra
    `authenticated`, então gravar isso exigiria rota nova. O soft delete é
    recuperável por 30 dias, mas hoje ninguém sabe qual admin agiu.

- **ENQUADRAMENTO DA FOTO AO PUBLICAR + LEGENDA COM QUEBRA DE LINHA
  (2026-09-07).** Um pintor publicou um quadro em pé (80×120) e a obra saiu
  cortada em cima e embaixo, e a descrição (Título/Artista/Dimensões em
  linhas) virou um bloco só.
  - **Legenda:** `whiteSpace: 'pre-wrap'` na legenda e nos comentários do
    `PostCard` — o HTML colapsa `\n` em espaço a menos que o CSS peça pra
    preservar. Nada muda no banco: o texto sempre foi gravado com as
    quebras. Teste de fonte em `__tests__/legendaQuebraDeLinha.test.ts`.
  - **Enquadramento:** seção nova no composer (`app/publicar/Enquadramento
    .tsx`) — proporção Original / 1:1 / 4:5 / 16:9, modo **Preencher**
    (corta a sobra; arrasta a foto pra escolher o que aparece) ou
    **Ajustar** (foto inteira, sobra fundo desfocado). **"Original" é o
    padrão e não passa pelo canvas**: quem não mexe publica como sempre.
    - **O recorte é feito NO ARQUIVO antes do upload** (`lib/services/
      enquadrarImagem.ts`), não em CSS: feed, perfil, carrossel e "Em alta"
      renderizam a mesma URL de jeitos diferentes, e a primeira tela que
      esquecesse um deslocamento gravado voltaria a cortar a obra.
    - **A prévia e o recorte usam a MESMA conta** (`lib/enquadramento.ts`,
      pura e testada): `estiloPreview` (CSS em %) e `recorteCover` (px do
      canvas) descrevem a mesma janela. Se fossem duas contas, a prévia
      mentiria.
    - **Falha no recorte NÃO sobe cru em silêncio** — diferente da
      compressão (que é otimização). A pessoa escolheu um quadro; publicar
      a obra cortada no meio depois disso é trair a escolha. Estoura
      `ValidationError` com o nome do arquivo.
    - Story (tela cheia) e vídeo não têm enquadramento.
  - **Carrossel: todas as fotos no quadro da PRIMEIRA.** Só a foto 1 tinha
    dimensões gravadas; as outras caíam no 1:1 com `object-cover` — a foto
    2 de um quadro em pé saía sem cabeça. `PostMedia` ganhou a prop
    `aspectRatio` e o `PostCarousel` impõe a proporção da primeira a todas.
    Post novo enquadra todas iguais no composer, então nada corta; post
    antigo ganha altura constante (a foto 2 corta na proporção da 1, não
    mais no quadrado).

- **QUICK REPLY DE TEMPLATE CHEGAVA COMO BOLHA VAZIA (2026-09-06).** Quem
  tocava num botão do template de abordagem mandava `type='button'` com
  `{text, payload}` — e NADA em `text.body`. O `parseInboundMessages` só
  olhava `text.body` e `caption`, então o corpo saía vazio: a conversa
  mostrava bolha em branco e o `if (!texto) continue` do webhook **pulava a
  mensagem**, ou seja, justamente quem demonstrou interesse ficava sem
  resposta. `type='interactive'` (button_reply/list_reply) tinha o mesmo
  buraco. Agora o rótulo do botão vira o corpo, e o `payload` (identificador
  estável que a gente define no template) é guardado à parte.
  - **"Não tenho interesse" é opt-out com desfecho PRÓPRIO.** O `PARE` cala
    e não responde; aqui a pessoa respondeu a uma mensagem NOSSA, e sumir é
    grosseria — vai um agradecimento curto (`textoRecusaAgradecida`, sem
    preço e sem anunciar PARE, decisão de 29/08) e o lead sai da abordagem.
    `ehRecusaDeAbordagem` compara SEM ACENTO E SEM CAIXA: o rótulo do botão
    é editado no painel da Meta e pode voltar como "Nao tenho interesse"
    sem ninguém aqui saber.
  - **`leads.opted_out_at`** (`/migrations/2026-09-06-leads-opt-out.sql`,
    uma linha) — **JÁ EXECUTADA no Supabase (2026-09-06). Não pedir pra
    rodar de novo.** Sem ela, `whatsapp_ai_state.opted_out` cala a
    IA e o follow-up, mas o botão "Abordar" da lista segue oferecendo o
    contato e o operador dispara de novo pra quem acabou de dizer não. O
    código TOLERA a coluna ausente (o opt-out da IA já valeu) — recurso novo
    não derruba o que funciona por SQL pendente. Coluna nova em vez de
    `status='perdido'`: "perdido" quer dizer "não fechou", e sobrescrever o
    status apagaria o funil de um lead talvez já qualificado.
  - **Template de 3 variáveis (`{{1}}` nome, `{{2}}` CIDADE, `{{3}}`
    segmento) é OPT-IN.** `escolherTemplate` só sobe pra ele com PROVA de
    que existe: o servidor pela env `WHATSAPP_TEMPLATE_ABORDAGEM_CIDADE`, o
    portal pela lista viva que vem da Meta. Ligar por padrão faria todo lead
    com os dois dados falhar com 132001 (template não aprovado). **Faltando
    UM dos dois, desce pro `calicolors_nome`** — meia personalização não
    existe: `{{2}}` vazio é envio recusado ou frase quebrada na tela do
    cliente. `valorDeVariavel` recusa também os marcadores da base importada
    ("n/a", "não informado"), que chegariam como texto literal.
    - **`{{2}}` ERA BAIRRO e virou CIDADE (2026-09-07, decisão do usuário)**
      — o template aprovado na Meta é `calicolors_abordagem_v2` ("Vi que
      você atende em {{2}} e trabalha com {{3}}"), e cidade quase todo lead
      tem; bairro faltava na maioria. A env também mudou de nome
      (`..._BAIRRO` → `..._CIDADE`; a antiga nunca foi setada).
    - **O modal de abordagem PREENCHE as três sozinho.** Antes só `{{1}}`
      vinha com o nome; `{{2}}`/`{{3}}` mostravam o exemplo da Meta como
      placeholder e o operador copiava a cidade da tabela à mão.
      `<EnvioDeTemplate dadosContato={{cidade, segmento}}>` — a abordagem
      passa `lead.city` + `ramoDoLead(lead)`; a aba WhatsApp passa quando o
      número casa com um lead (perfil do app/pushName não têm cidade nem
      ramo, e chutar seria dado errado). Campos seguem editáveis.
    - **`{{3}}` NÃO é o rótulo da tabela.** "trabalha com Funilaria/Auto"
      soa como planilha. `LEAD_PITCH[cat].ramo` guarda a frase ("funilaria
      e pintura automotiva", "engenharia civil"); categoria fora do mapa cai
      no segmento (`RAMO_POR_SEGMENTO`) e, por fim, na categoria em
      minúsculo. Sem pista nenhuma → null, campo vazio, botão travado.
      `__tests__/portalRamoDoLead.test.ts` obriga toda categoria nova a ter
      `ramo`.

- **UPLOAD DE MÍDIA SEM SEGUNDA CHANCE — "Falha de rede ao enviar a mídia
  (1,3 MB)" (2026-09-06).** Um pintor levou esse erro publicando um story com
  foto de 1,3 MB — abaixo do `COMPRESS_THRESHOLD`, então nem passa pelo
  compressor: a foto era pequena e o upload morreu assim mesmo. O que o
  caminho de publicar NÃO tinha era **retentativa**: um soluço do rádio na
  WebView (o mesmo que fez o service worker ganhar retry em 22/08) custava a
  publicação inteira. `uploadMedia` agora repete UMA vez após
  `UPLOAD_RETRY_MS`, e **num caminho NOVO** — com `upsert:false`, repetir o
  mesmo path depois de uma tentativa que chegou no servidor e só perdeu a
  resposta devolveria `Duplicate` (409), um erro inventado por nós no lugar
  do de verdade. O órfão da tentativa perdida cai no `cleanup_orphan_media()`.
  - **"Falha de rede" era um balde grande demais.** Quando o blob perde o
    lastro (o app reiniciou depois que a pessoa escolheu a foto — o acidente
    que o `pickerRecovery` cobre), o `fetch` também estoura o TypeError cru,
    e a frase "verifique a conexão" faz a pessoa tentar pra sempre com uma
    foto morta. O sinal que faltava já existia e era jogado fora: o
    `sha256Hex` lia o arquivo inteiro e **engolia a falha de leitura** num
    `catch` mudo. Virou `lerEHashear`, que devolve `ilegivel` — e a mensagem
    passa a ser "selecione ela de novo". **Só concluímos "arquivo morto"
    quando leitura E upload falham:** ler 50 MB de vídeo pode estourar
    memória num aparelho fraco enquanto o upload segue bem, e barrar aí
    quebraria quem estava conseguindo publicar.
  - **REGRA: a mensagem amigável não pode ser a única que sobra.** O
    `reportFailure` gravava só a frase traduzida, então o `/admin/errors`
    mostrava "Falha de rede ao enviar a mídia" e nada do que o servidor
    disse — RLS, mime recusado, quota e queda de rede chegavam idênticos.
    Agora ele anexa `| causa: <mensagem crua>` quando o erro tem `cause`.
  - Arquivo de zero byte é recusado antes do upload: subir isso grava post
    com mídia quebrada, que ninguém conserta depois.
  - **Não há prova de qual dos dois disparou no caso do fabio** — a linha
    dele no `/admin/errors` é anterior a essa mudança e não carrega a causa.
    A próxima ocorrência diz.
  - **A investigação esbarrou numa ferramenta cega — e essa é a lição maior
    (2026-09-06).** Mandei "abra o /admin/errors, filtre `publish-fail` e
    procure o `user_id` do fabio". **Nenhuma das três coisas existia.** O
    `reportFailure` grava 12 tipos e a tela tinha 5 chips escritos à mão,
    com `scrollpin-diag` (apagado em 30/08) no lugar de destaque; a linha
    NUNCA mostrava o `user_id`, embora o campo viesse do servidor; e a busca
    filtra `msg ilike`, onde o id de usuário não aparece nunca. Corrigido:
    os chips saem do `FAILURE_TYPE_LABELS` (um `Record<FailureType,string>`
    — **tipo novo sem rótulo não compila**, então o dashboard não envelhece
    em silêncio de novo), a linha mostra o dono e clicar nele filtra, e
    `user_id` virou filtro de verdade na rota (só UUID: a coluna é `uuid` e
    texto solto viraria 400, que a tela mostraria como "falha ao consultar
    logs" — erro nosso disfarçado de erro do banco).
  - **REGRA: painel de diagnóstico com lista escrita à mão é lista que
    mente.** Mesma doença da lista de "SQL pendente" deste arquivo: barato
    de escrever, ninguém revalida, e o custo aparece justo na hora do
    incidente. Quando existir a lista canônica (aqui, os tipos que o
    `reportFailure` aceita), o painel deriva dela.

- **🚫 WEBINTOAPP ESTÁ MORTO — NÃO CITAR, NÃO CONSIDERAR (2026-09-04, decisão
  do usuário).** As DUAS lojas saem do **Codemagic + Capacitor**, deste repo:
  **Android AAB** pelo workflow `android-aab` (→ Internal Testing da Play) e
  **iOS IPA** pelo `ios-ipa` (→ TestFlight). O wrapper WebIntoApp e o repo
  `queroumacor-ios` estão **descontinuados**: não são plano B, não são
  referência, não entram em comparação, explicação ou diagnóstico. Ao falar de
  build, casca, permissão, push, deep link ou identidade do app, a resposta é
  sempre Capacitor/Codemagic. As menções a WebIntoApp que sobraram mais abaixo
  neste arquivo são **registro histórico** de incidentes já resolvidos — servem
  pra entender o passado, nunca pra orientar o presente.

- **REVISTA CLICK RUA — tile só pra GRAFITEIRO (2026-09-05).** Banca da
  revista digital de graffiti dentro do app: tile **Click Rua** em
  `ROLE_TILES` (`roles: ['grafiteiro']`, admin vê como em todos), abre uma
  grade de edições; a #01 (setembro/2020, 8 páginas, B.Girl LU BSB) está
  pronta e as outras 5 aparecem como "Em breve". Rota `/click-rua`.
  - **AS PÁGINAS FORAM PRO BUCKET (2026-09-06) — a decisão anterior caiu
    junto com a premissa.** No PR #228 elas eram arquivo estático porque
    edição nova só chegava com um commit meu. Quando o usuário pediu upload
    PELO PORTAL, deixou de existir onde gravar em runtime: virou bucket
    `click-rua` + tabela `click_rua_editions` (migration
    `/migrations/2026-09-06-click-rua-bucket.sql`). **JÁ EXECUTADA no
    Supabase (2026-09-06) — não pedir pra rodar de novo.** Conferido nos
    dois lados: a consulta de conferência devolveu as 6 edições (a #01
    `pronta`), e `storage.objects` mostra `ed01/<ts>/1..24.webp` + `capa.webp`
    no bucket. Ou seja, a #01 **já está no bucket** (24 páginas, publicadas
    pelo portal), e não mais nos arquivos estáticos.
    - **A tabela guarda a URL de CADA página, não um padrão de caminho.** É
      isso que deixa a #01 (que nasceu em `/click-rua/ed01/`, publicada junto
      com o app) conviver com as que a loja sobe: o leitor só usa a string como
      `src`. O botão "Copiar páginas do site para o bucket" no portal migra
      quando quiserem, sem downtime.
    - **`lib/clickRua.ts` guarda um catálogo de FALLBACK** usado só enquanto
      a tabela não existir (42P01) — deploy antes do SQL não pode deixar a
      banca vazia. Depois de migrar tudo, os arquivos de `public/click-rua/`
      podem sair (menos o `logo.webp`, que a tela usa direto).
    - **Edição marcada 'pronta' SEM página volta a ser "em breve"**
      (`edicaoDeLinha`): a linha existe antes do upload, e abrir um leitor
      de zero páginas é tela preta sem saída.
  - **Portal converte pra WebP NO NAVEGADOR** (canvas + `toBlob`, qualidade
    82), então a loja manda PNG/JPG direto. O que o canvas não decodifica
    (HEIC de iPhone) o bucket recusa e a tela diz QUAL arquivo foi.
    **A pasta do bucket leva carimbo de tempo (`edNN/<ts>/`) de propósito:**
    republicar sobrescrevendo a mesma URL faria o navegador e o CDN
    continuarem servindo a página velha — a loja trocaria o conteúdo e não
    veria diferença. O custo é deixar a publicação anterior no bucket.
  - **Mexeu no `app.jsx` do portal? O `app.js` é compilado e o `index.html`
    tem hash SRI — hash errado = portal eternamente em "Carregando".**
    O build é reproduzível byte a byte, e vale CONFERIR isso antes de
    confiar na saída: compile o `app.jsx` do HEAD e compare com o `app.js`
    do HEAD. Opções: `@babel/preset-react` com `runtime:'classic'`,
    `generatorOpts.jsescOption.minimal:**false**` (com `true` o arquivo sai
    ~900 bytes menor e o hash não bate), `compact:false`, `configFile:false`,
    sem quebra de linha no fim.
  - **O leitor é TELA CHEIA (portal no body), não continua no bottom-sheet**:
    a página é quadrada e cheia de texto e, dentro do sheet, nasceria com
    metade da largura útil. Truque do histórico do `StoryViewer` pro botão
    VOLTAR do Android fechar. Tem zoom (toque duplo 1x/2,5x + arrastar)
    porque página de entrevista a 1483px encolhida pra 390px é ilegível.
    - **z-[1100], NÃO z-[400].** Copiei o z-index do `StoryViewer` e o leitor
      abriu ATRÁS do sheet — o `BottomSheet` é **z-[1000]**, e este leitor é
      aberto de dentro dele (o story não é). No desktop dava pra ver o leitor
      no fundo; no celular o sheet cobre a tela toda e parecia que o toque
      não fazia nada. **Overlay aberto de dentro de um sheet tem que passar
      de 1000.**
    - **A virada é uma FOLHA girando na lombada** (`transformOrigin: left`,
      rotateY 0 → -180, `backfaceVisibility: hidden` pra sumir aos 90° e
      revelar a de baixo), não scroll-snap horizontal. Acompanha o dedo e, ao
      soltar, completa ou desiste conforme passou da metade. A conta vive em
      `lib/clickRua.ts` (`anguloDaVirada`/`confirmaVirada`) e é testada —
      inclusive a trava dos extremos, sem a qual arrastar demais faz a página
      reaparecer girando ao contrário.
  - **Gradiente novo `revista`** (laranja+preto da Click Rua) no
    `BusinessCard`. **NÃO reaproveitar `graf`**: aquele valor dá o gradiente
    certo e o ícone ERRADO — faz o card desenhar a foto da Fê no lugar do
    emoji.
  - **O logo em `public/click-rua/logo.webp` foi RECORTADO DA CAPA** da #01 —
    o zip trazia só as 8 páginas. Se aparecer o arquivo original do logo, é
    só trocar esse WebP; nada mais referencia o recorte.

- **TABELA DE PREÇOS DA ABRAPP 2026 — tile novo, SQL JÁ EXECUTADO (2026-09-05).**
  O PDF da ABRAPP ("Sugestão de Preços de Pintura 2026", 26 folhas) virou
  ferramenta no app: tile **Tabela de Preços** no `BusinessGrid`, ao lado da
  Calculadora (uma calcula material, a outra o preço da mão de obra), **visível
  só pra `role='pintor'`** (e admin) — a tabela é de mão de obra de PINTURA.
  O gate fica no filtro `visibleTiles`, junto com o das personas de IA, e NÃO
  em `ROLE_TILES`: aquele array renderiza antes de tudo e jogaria o tile pro
  topo da tela, longe da Calculadora. Com
  busca, filtro por categoria e por altura, faixas mín/média/máx e uma
  calculadora de quantidade por item. Rota `/tabela-precos` pra deep link.
  - **SQL COMPLETO no Supabase (2026-09-05).** Schema + os 19 blocos de dados.
    **Não pedir pra rodar de novo.** O que sustenta essa afirmação não é
    "alguém disse que rodou": é a consulta de conferência devolvendo
    **328 itens · 212 com `altura` · 19 folhas**, os três números que o
    arquivo de dados prevê. Reconferir por
    `/migrations/2026-09-05-conferencia-pendencias.sql` (2 linhas) antes de
    afirmar qualquer coisa, nos dois sentidos.
  - **DOIS ERROS MEUS NO CAMINHO, os dois pegos por essa consulta** — vale
    mais que a feature em si:
    1. Marquei "todas as migrations executadas" a partir de um "rodei todas"
       no chat. A consulta devolveu `97 itens / 5 folhas`: só as folhas 1-5
       tinham entrado. **Relato não é evidência, nem vindo do usuário.**
    2. A própria linha de conferência exigia **213** linhas com altura —
       número que estimei de cabeça. O real, contado do arquivo de dados
       simulando o `UPDATE`, é **212**. Checagem com número errado reporta
       `false` pra sempre e ensina a ignorar a checagem, que é pior do que
       não ter checagem. **Número de conferência se conta do fonte.**
    O `UPDATE` de `altura` é o último statement do arquivo e é o fácil de
    pular: sem ele nada quebra, o filtro de altura da tela só para de
    filtrar, **em silêncio**. Cada bloco do arquivo de dados é uma folha e é
    **idempotente** (upsert por `(edicao, sheet_no, sort_order)`): repetir não
    duplica, e corrigir um valor no arquivo e rodar de novo ATUALIZA a linha.
  - **O PDF é IMAGEM PURA** (print-to-PDF do CorelDRAW, sem camada de texto):
    os 328 itens foram transcritos à mão a partir de recortes em 300 dpi das
    colunas de preço. Por isso existe
    `__tests__/priceTableData.test.ts`, que lê o arquivo de migration e trava
    estrutura, vocabulário de unidade e **mínimo ≤ média ≤ máximo** em toda
    linha — erro de transcrição não quebra build, vira preço errado no
    orçamento de um cliente.
  - **Nada de dado embutido no bundle**: o banco é fonte única, então a loja
    corrige um valor com UPDATE, sem deploy. O texto editorial (folhas 20-25:
    as 13 variáveis, "tabela do jeitinho") é que fica em código
    (`lib/priceTableGuide.ts`) — é editorial, não muda de ano em ano e
    ninguém consulta em cima dele.
  - **Fidelidade ao impresso é regra**: erro de digitação do PDF fica
    ("Econônico", "chapisto", "Fléxivel"), linha zerada da folha 13 vira "sem
    valor publicado" na tela em vez de "R$ 0,00", e as descrições cortadas da
    folha 12/19 NÃO foram completadas por dedução. As colunas `grupo`/`tipo`
    trazem os termos escritos certo, então a busca acha mesmo assim.

- **A LISTA DE "SQL PENDENTE" DESTE ARQUIVO NÃO É EVIDÊNCIA (2026-09-05).**
  Conferido contra o banco: das quatro migrations marcadas como pendentes,
  **três já tinham sido rodadas** (Wave 41 `exports` + policies, Wave 53
  `quotes.post_id`, Wave 49 mídia do WhatsApp) e uma entrada se contradizia
  dentro de si mesma. A anotação é escrita à mão e envelhece; o banco não.
  **REGRA: antes de dizer que um SQL falta — e antes de pedir pra alguém
  rodar de novo — rodar `/migrations/2026-09-05-conferencia-pendencias.sql`**
  (só leitura, uma linha por item, `ok` true/false). Item novo marcado como
  pendente aqui = linha nova naquela consulta.
  - **Vale pra TODA pendência, não só SQL.** Na mesma varredura caíram mais
    três que estavam erradas: Image Resizing (ligado), APNs/`App.entitlements`
    (feitos) e "esconder a compra do PRO no iOS" (já não existe compra no
    app). Depois disso caiu mais uma, por leitura do código e não por
    verificação externa: "tirar a sessão do Supabase do `localStorage`" era
    pendência MAL FORMULADA — o `hybridAuthStorage` já resolveu o problema que
    a motivou, e o supabase-js impede a única versão dela que melhoraria
    segurança (cookie httpOnly). **Não sobrou nenhuma pendência acionável**: a
    importação dos leads está ADIADA POR DECISÃO do usuário, e os três itens
    não-verificáveis abaixo dependem dele.
  - **PADRÃO A NOTAR:** de 9 pendências listadas, 7 estavam erradas — 6 já
    feitas e 1 sem sentido. Lista de pendência envelhece pior que código, e
    ninguém a revalida porque parece barato confiar nela. Custou repetir por
    semanas que o degrau 2 do PDF estava quebrado e que faltava ligar o Image
    Resizing, as duas coisas falsas.
  - **O job `validate` É CHECK OBRIGATÓRIO — verificado em 2026-09-06.** Não
    havia ferramenta de branch protection no MCP pra consultar, mas o merge do
    PR #240 respondeu `405 Required status check "validate" is in progress`, o
    que só a proteção configurada produz. Some da lista de pendências (estava
    aberta desde a auditoria de 03/09, item C5).
  - **NÃO VERIFICÁVEIS deste ambiente** (a política de rede só libera
    GitHub/npm/Anthropic; o proxy recusa DNS-over-HTTPS e a produção): DMARC do
    `calicolors.com.br` e o opt-in do CSAM Scanning. Não afirmar nada sobre
    esses dois sem o usuário conferir — o que já se sabe é que a proteção da
    `main` EXISTE (push direto recusado com "protected branch hook declined").

- **PORTAL: FIM DOS `prompt()` DO NAVEGADOR — um modal edita a pessoa inteira
  (2026-09-07).** Editar alguém nas listas de Pessoas abria a caixa "www
  .queroumacor.com.br says" do Chrome, **uma por campo**: sete diálogos pra
  trocar nome, e-mail, telefone, tipo, @tag, cidade, UF e especialidades.
  Agora é UM lápis por linha (no nome) que abre o `EditarPessoaModal`.
  - **ESPECIALIDADE VIROU CHECKBOX, e esse é o ganho que não é estético.** O
    `prompt()` era texto livre: o mesmo item entrava como "Piso Epoxi", "piso
    epoxi" e "Piso Epóxi" — três valores distintos pro filtro da busca do app,
    que compara string. O catálogo é o MESMO do app (`ROLE_SPECS`), por papel.
  - **O portal é arquivo único sem imports, então o catálogo está duplicado
    lá** (`PERFIL_SPECS`). `__tests__/portalEspecialidades.test.ts` lê o fonte
    do portal e compara com o do app — mexeu num, tem que mexer no outro.
  - **Valor fora do catálogo (o que o texto livre gravou antes) aparece
    marcado, com borda tracejada, pra dar pra LIMPAR.** Esconder viraria dado
    invisível que ninguém corrige.
  - O modal manda **um pedido por campo alterado** (as actions da rota admin já
    são por assunto) e, se algum falhar, diz qual — o resto fica gravado.
  - As sete funções `editUser*` foram APAGADAS junto. Código morto que ninguém
    chama é pior que arquivo a menos.

- **PERFIL NOVO: ARQUITETO / ENGENHEIRO (2026-09-07) — SQL JÁ EXECUTADO no
  Supabase (2026-09-07, informado pelo usuário). Não pedir pra rodar de novo.**
  `/migrations/2026-09-07-role-arquiteto.sql` fazia duas coisas, e as duas
  eram obrigatórias porque falhavam em SILÊNCIO: o `profiles_user_type_check`
  recusava o valor (a trigger engole a exceção com RAISE WARNING e a conta
  nascia SEM perfil) e a `handle_new_user` tem lista branca própria que
  **rebaixa o papel desconhecido pra 'cliente'** (a pessoa escolhia Arquiteto
  e virava Cliente, sem aviso).
  - **O bloco 2 recriou a `handle_new_user`, que atende TODO cadastro** — não
    só o do papel novo. É superconjunto da versão de 18/06 (mesmos campos,
    mais os sinônimos e o `LOWER` na @tag). Reconferir por
    `/migrations/2026-09-05-conferencia-pendencias.sql` antes de afirmar
    qualquer coisa sobre ela.
  - **PROVADO NO APARELHO (2026-09-07):** cadastro ponta a ponta escolhendo
    "Arquiteto / Engenheiro" funcionou. Só passou a funcionar depois dos DOIS
    CHECKs e do NOT NULL do `username` — ou seja, quando eu dei o perfil como
    pronto na primeira vez, ele não estava.
  - **É os DOIS lados (decisão do usuário):** presta serviço (busca,
    portfólio, orçamento, avaliação) E contrata (avalia obra, tabela ABRAPP,
    lista na loja). Persona = **Seu Zé**.
  - **`engenheiro` é sinônimo de `arquiteto`**, igual `funileiro` é de
    `automotivo`: mesmo papel, `profession` diferente.
  - **`lib/roles.ts` virou a FONTE ÚNICA dos papéis.** A lista de "quem é
    profissional" estava copiada à mão em NOVE arquivos e as cópias já
    divergiam (umas sem `funileiro` — quem era funileiro perdia o CTA de
    orçamento no próprio perfil; o rótulo do automotivo era um no cadastro e
    outro no onboarding do OAuth). Papel novo = uma entrada lá.
  - O portal duplica a lista (é JSX sem imports) e o `?v=`/SRI foram
    refeitos. Aba nova "Arquitetos / Engenheiros".

- **SÃO DOIS CHECKs DE PAPEL, e eu só corrigi um (2026-09-07).**
  `public.profiles` tem `profiles_user_type_check` **e**
  `profiles_role_check`. A migration do arquiteto arrumou o primeiro; o
  segundo barrava `role='arquiteto'` com 23514 e — como a trigger engole a
  exceção — o cadastro de arquiteto nascia SEM PERFIL, calado. Complemento em
  `/migrations/2026-09-07-role-check-arquiteto.sql`.
  - **A conferência que eu escrevi perguntava por UM nome conhecido e voltou
    `true`** enquanto o cadastro seguia quebrado — confiança falsa.
    **REGRA: conferência de constraint LISTA (`pg_constraint` da tabela), não
    pergunta por nome.** Nome só cobre o que você já sabe que existe.

- **CADASTRO: NADA É OPCIONAL, e o passo 2 mudou (2026-09-07, pedido do
  usuário).** Telefone, cidade e estado viraram obrigatórios (a **foto** é a
  única exceção — ver abaixo); o
  rótulo "WhatsApp" virou **"Telefone"**.
  - **Nome sai em Maiúscula Inicial sozinho** (`formatarNomeProprio`), com
    conectivo minúsculo ("João da Silva") — menos no começo ("Da Costa").
    `limparNome` agora aceita **só letra e espaço**: hífen e apóstrofo saíram
    junto com número e ponto. Custo conhecido e testado: "Maria-José" vira
    "MariaJosé". Se incomodar, é uma linha.
  - **A sugestão de @tag ENTRA no campo**, em vez do botão "Usar @fulano"
    embaixo, que quase ninguém tocava — e tag vazia era o começo do loop do
    /completar-perfil. Só escreve enquanto a pessoa não mexeu no campo.
  - **Estado ANTES de cidade**, os dois em `<ComboBox>` (digitar filtra,
    clique escolhe). `<select>` no celular abre a roleta do sistema: achar
    uma cidade entre as 645 de SP é rolagem. Cidade carrega do IBGE pela UF
    escolhida, e trocar de estado LIMPA a cidade.
    - **Não é `<datalist>`**: o suporte no Safari do iPhone é irregular e o
      app roda em WebView.
    - **Cidade aceita texto livre de propósito** (`allowFree`): se o IBGE não
      responder, travar o cadastro é pior que aceitar o nome digitado.
  - **A FOTO CONTINUA OPCIONAL — a exceção da regra "nada é opcional".** Ela
    foi obrigatória por algumas horas em 07/09 e voltou atrás no mesmo dia,
    por decisão do usuário depois de ver o risco: no Android, abrir a galeria
    manda o app pro fundo e o sistema pode MATAR o processo, então foto
    obrigatória vira porta trancada (foi o incidente de 28/08). Tem teste
    travando isso pra ela não voltar a ser porta sem querer.
  - **O `onPersist` FICOU**: o passo 2 salva o rascunho ANTES de abrir o
    seletor. Vale de todo jeito — quem escolhe foto e perde o processo não
    perde mais o que já digitou. Era um buraco real: os campos viviam só no
    RHF, e o rascunho só era salvo na troca de passo.

- **MODO ESCURO: `text-white` era texto ESCURO (2026-09-07).** No dark, o logo
  "QueroUmaCor" e o "Loja Cali Colors" sumiam. Causa: o Tailwind compila
  `text-white` pra `var(--color-white)` — e esse token **inverte**, porque
  também é a superfície dos cards. Sobre a barra (que segue escura de
  propósito, via `--color-ink-fixed`), virava escuro no escuro.
  - Token novo **`--color-white-fixed`**, par do `--color-ink-fixed`: não
    inverte. Chrome fixo (TopNav, BottomNav, topo da Loja, ProfileHeader) usa
    ele no texto e nos fundos translúcidos.
  - `__tests__/temaEscuroChrome.test.ts` falha se `text-white` ou `bg-white/N`
    voltarem a esses quatro arquivos, ou se alguém redefinir o token no dark.

- **CADASTRO CONSERTADO E CONFIRMADO NO APARELHO (2026-09-07).** Cadastro
  novo entra direto no feed, sem passar pelo `/completar-perfil`, e o
  `contas_sem_perfil` do backfill foi a **0** — todas as contas que ficaram
  presas no loop voltaram. Foram TRÊS defeitos de schema empilhados, cada um
  descoberto só depois de derrubar o anterior: `username` NOT NULL,
  `profiles_role_check` sem 'arquiteto' e `profiles_user_type_check` sem
  'arquiteto'.

- **CAUSA RAIZ DO CADASTRO QUEBRADO: `profiles.username` era NOT NULL
  (2026-09-07). SQL em `/migrations/2026-09-07-username-not-null.sql`.**
  Provado no SQL Editor, DUAS vezes (a segunda com a @tag preenchida):
  `ERROR 23502: null value in column "username" of relation "profiles"
  violates not-null constraint`.
  - **A corrente inteira, e é uma corrente de silêncios:** a
    `handle_new_user` grava `tag` e NÃO grava `username`; o gatilho que
    deveria espelhar tag→username não roda no INSERT; a coluna é NOT NULL, o
    INSERT estoura, e a trigger **engole a exceção com RAISE WARNING**. A
    conta de auth nasce e o perfil NÃO. Depois, `update` que não acha linha é
    SUCESSO com zero linhas — o app "salvava" o formulário, nada era gravado,
    a tela voltava. Nenhum erro em lugar nenhum, dos dois lados.
  - **NENHUM cadastro conseguia criar perfil** — nem por e-mail, nem por
    Google/Apple. Explica também o "cadastro pela metade (OAuth)" que este
    arquivo registrava como coisa de redirect.
  - **O NOT NULL foi SOLTO, e não preenchido automático.** `username` é
    sinônimo de `tag`, e `isProfileComplete` aceita qualquer um dos dois:
    inventar um username faria o perfil de quem entra por Google/Apple
    PARECER completo sem ter @tag — a pessoa nunca mais veria a tela que pede
    a @tag, sumiria da busca e ficaria sem link de perfil, calada. Trocar um
    bug barulhento por um silencioso é o pior negócio possível.
  - **LIÇÃO DE MÉTODO (a maior do dia):** três correções minhas no lado do
    app erraram o alvo porque eu estava deduzindo. O que fechou o caso foi
    (1) o usuário relatar o sintoma exato — "clica em Concluir e VOLTA" —,
    (2) o `/diag` mostrando `Linha de perfil no banco: NÃO EXISTE`, e (3)
    rodar À MÃO o INSERT que a trigger faz, pra o Postgres cuspir o erro que
    ela engole. **Trigger que engole a própria exceção transforma erro de
    schema em bug de produto que sobrevive a três correções.**

- **O LOOP DO /completar-perfil: "clica em Concluir e volta" (2026-09-07) —
  a peça que FECHOU o caso.** Depois de três correções erradas, o sintoma que
  resolveu a investigação foi este: o botão salva e a tela volta. Isso só
  acontece de um jeito — **a linha de `profiles` não existe**.
  - **`update` no Supabase que não acha linha é SUCESSO com zero linhas**, não
    erro. Então: a pessoa preenche, o `update` "dá certo", nada é gravado,
    `isProfileComplete` continua falso e o guarda do AppShell traz de volta.
    Para sempre, e sem uma única mensagem de erro.
  - **Por que a linha some:** a `handle_new_user` engole a própria exceção com
    `RAISE WARNING`. Qualquer coisa que faça o INSERT dela falhar (um CHECK, a
    UNIQUE da @tag, uma coluna que sumiu) deixa a conta de auth criada e o
    perfil não. O app nunca fica sabendo.
  - **`updateProfile` agora CRIA a linha** quando o UPDATE não acha nenhuma (a
    policy "Users can insert own profile" permite o dono criar a própria). Se
    o INSERT também falhar, **ESTOURA** — erro visível é melhor que loop mudo.
    Isso cobre quem se cadastra agora E as contas que já ficaram presas.
  - **As três "correções" anteriores não eram inúteis, mas nenhuma era A
    causa**: reafirmar a identidade no signup, preencher o formulário e criar
    a linha no signup só ajudam quem passa PELO signup — quem já estava preso
    continuava preso, e o loop era mudo dos dois lados.
  - **REGRA (a mesma do `signUp`, agora em toda escrita de perfil): onde a
    identidade importa, `update` sem `.select()` é escrita sem confirmação.**

- **QUAL BUILD O APARELHO ESTÁ RODANDO — `/diag` responde (2026-09-07).** A
  pergunta apareceu em TRÊS investigações (o 500, a rejeição da Apple, o
  cadastro duplicado) e nunca teve resposta: testar depois de um deploy era
  ato de fé. O app carrega o site ao vivo, então "fiz o deploy" e "o aparelho
  pegou" são coisas diferentes — e o `sw.js` serve `/_next/static/`
  **cache-first**, então um aparelho PODE ficar preso numa build anterior.
  `NEXT_PUBLIC_BUILD` (SHA do Cloudflare Pages, ou o horário do build fora
  dele) aparece como "Build do site" no `/diag`. **Antes de concluir que uma
  correção não funcionou, conferir essa linha.**
  - O `/diag` também mostra agora o ESTADO DO PERFIL no banco (linha existe?,
    user_type, role, tag, username, e a conta final do `isProfileComplete`).
    É a resposta direta pro "o cadastro pede tudo de novo", no aparelho, sem
    depender de acesso ao banco nem ao `/admin/errors`.

- **CADASTRO DUPLICADO — 3ª TENTATIVA, AGORA COM INSTRUMENTO (2026-09-07).**
  Depois de duas correções (reafirmar a identidade no UPDATE pós-signup e
  preencher o formulário), o usuário testou com app reinstalado e o problema
  CONTINUA. Ou seja: as duas causas que eu tinha eram reais mas não eram A
  causa. **Não escrever uma 4ª correção às cegas** — o app agora responde.
  - **A HIPÓTESE que sobrou, e o que ela explica:** a linha de `profiles` pode
    NÃO EXISTIR. A `handle_new_user` engole a própria exceção com
    `RAISE WARNING`, então quando ela falha a conta de auth nasce e o perfil
    não. E aí **todo UPDATE no perfil vira no-op silencioso** — `update` que
    não acha linha não é erro, volta sucesso com zero linhas. O app manda pro
    `/completar-perfil`, a pessoa preenche, nada é gravado, a tela volta. É
    também a explicação do "loop infinito no /completar-perfil" que outra
    sessão tentou corrigir.
  - **O signUp passou a CONFERIR:** `update(...).select('id')` — zero linhas
    significa perfil ausente, e aí ele cria a linha (a policy "Users can
    insert own profile" permite). Grava `profile-incomplete` no
    `/admin/errors` dizendo se o insert funcionou.
  - **O AppShell diz POR QUE redirecionou:** perfil existe?, user_type/role/
    tag preenchidos? Uma linha por redirecionamento no `/admin/errors`. Na
    próxima tentativa a causa aparece escrita, em vez de deduzida.
  - **REGRA: `update` no Supabase não avisa quando não acha a linha.** Onde
    isso importa (identidade, dinheiro, permissão), pedir `.select()` e olhar
    quantas linhas voltaram.

- **CADASTRO PEDIA TUDO DE NOVO (2026-09-07).** Quem terminava o cadastro por
  e-mail caía no `/completar-perfil` e redigitava nome, telefone, cidade e
  data. Duas causas, as duas corrigidas:
  - **A trigger pode ser a versão velha.** `isProfileComplete` exige categoria
    E @tag; a `handle_new_user` anterior a 18/06/2026 gravava só
    name/user_type/role, então o perfil nascia SEM tag e o guarda do AppShell
    mandava a pessoa recém-cadastrada pro formulário. Não dá pra saber daqui
    qual versão está viva — então o `signUp` **reafirma** name/tag/user_type/
    phone no UPDATE pós-signup: no-op se a trigger gravou, conserto se não.
  - **O formulário só preenchia o nome.** Agora preenche telefone, UF, cidade,
    data e **a categoria** — esta era a pior: nascia sempre em "pintor", então
    quem se cadastrou como grafiteiro e não reparasse **trocava o próprio
    papel** ao salvar.

- **APPLE REJEITOU A BUILD 17 (2.1 App Completeness) — a tela "Sem conexão"
  no login social (2026-09-07).** No iPad da revisão, tocar em "Continuar com
  Apple" pintava o `offline.html` em tela cheia, com a internet funcionando.
  Não era alerta nativo nem falha de rede: era a `errorPath` da casca.
  - **O MECANISMO, lido no fonte do Capacitor (não deduzido):**
    `WebViewDelegationHandler.swift` → `decidePolicyFor` vê navegação de TOPO
    pra host fora de `server.allowNavigation`, entrega a URL ao sistema
    (`UIApplication.shared.open`) **e CANCELA** a navegação. O cancelamento
    chega em `didFailProvisionalNavigation`, e ali o Capacitor carrega a
    `errorPath` — o nosso `offline.html`. Ou seja: **toda navegação de topo
    pra fora do app vira "Sem conexão" na casca**, com internet perfeita.
  - **REGRA: dentro da casca, `window.location.href = <url externa>` é
    PROIBIDO.** O caminho seguro é `window.open(url,'_blank')`, que passa por
    `createWebViewWith` e abre no sistema SEM cancelar navegação nenhuma.
    Helper único: `abrirLinkExterno` em `lib/native/browser.ts`.
    - **PEGADINHA: nesse caminho o `window.open` devolve `null` MESMO DANDO
      CERTO** (o delegate abre no sistema e retorna `nil` pro WebKit). Ler
      esse null como falha faz o app mostrar erro em cima de link que abriu —
      por isso o helper ignora o retorno quando é casca, e só confia nele no
      browser (onde null é bloqueio de pop-up de verdade).
  - **O gatilho no login:** `signInWithOAuth` caía pro fluxo web do
    supabase-js (que navega a própria WebView pro provedor) sempre que o
    fluxo nativo dizia `unavailable` — comentado no código como "corrida
    rara". Agora **não existe fallback dentro da casca**: ou o fluxo nativo
    funciona, ou a pessoa recebe uma frase acionável. 4 testes em
    `__tests__/components/AuthOAuthNativo.test.tsx`; 2 deles falham se o
    fallback voltar.
  - **A varredura achou o mesmo padrão em mais 4 lugares**, todos corrigidos:
    `mailto:` do orçamento (2 telas), o `if (!aba) location.href = wa.me` do
    PDF de orçamento e do `abrirDestino` — este último era gatilho GARANTIDO,
    porque na casca o `window.open` sempre devolve null — e o redirect do
    checkout do Mercado Pago (sem call site de UI hoje, corrigido do mesmo
    jeito).
  - **CASO FECHADO EM 2026-09-07, confirmado NO APARELHO pelo usuário** ("já
    funcionou"): login social entra e sair da conta não pinta mais a tela.
  - **CORREÇÃO DO MEU PRÓPRIO DIAGNÓSTICO — quem consertou foi o #245, não o
    #243.** Se o login agora completa, o fluxo NATIVO estava disponível
    naquele iPad o tempo todo (com ele indisponível o app mostraria a frase
    de erro, não a tela de "Sem conexão"). Logo o velho código nunca chegou
    ao fallback web: o que quebrava era o PASSO SEGUINTE ao login dar certo —
    o `window.location.assign('/completar-perfil')`, navegação de DOCUMENTO,
    o mesmo buraco de sair da conta. **Uma causa só para os dois sintomas.**
    A regra do #243 continua valendo (fluxo web na casca É um perigo real, e
    o mecanismo foi lido no fonte do Capacitor), mas ela não era o gatilho
    deste caso. Registrado porque a próxima sessão precisa saber qual dos
    dois PRs carregou a correção de verdade.
  - **A instrumentação FICA** (`native.plugins()`, a linha "Login social
    nativo" no `/diag`, o tipo `oauth-fail` no `/admin/errors`): foi ela que
    permitiria distinguir os dois casos em um print, em vez de dedução. Da
    próxima rejeição, é o primeiro lugar a olhar.
  - **SAIR DA CONTA CAÍA NO MESMO BURACO (2026-09-07) — e a lição é maior que
    o login.** O relato "acontece ao sair da conta também" MATOU a explicação
    de que o problema era URL externa: `/login` é o MESMO domínio. O que os
    dois casos têm em comum é serem **navegação de DOCUMENTO**, e na casca
    qualquer navegação de documento que falhe OU seja cancelada faz o
    Capacitor pintar a `errorPath`. Não é preciso saber POR QUE aquela
    navegação falhou pra saber que não fazê-la resolve.
    - Telas agora trocam de tela por `router.push/replace` (SPA, não
      recarrega nada). Convertidos: os dois "Sair da conta", a exclusão de
      conta, os dois "enviar pelo chat" e o pouso do OAuth nativo em
      `/completar-perfil` (este era cruel: a pessoa concluía o login e via
      "Sem conexão").
    - **O `queryClient.clear()` no logout NÃO é enfeite**: a recarga garantia
      de graça que nada em cache do dono anterior sobrevivia pro próximo
      login. Tirar a recarga sem isso seria trocar um bug por um vazamento.
    - **REGRA, com teste que varre `app/` e `components/`**
      (`__tests__/lib/navegacao-documento.test.ts`): tela não escreve em
      `window.location`. Os usos legítimos vivem em `lib/` (o `intent:` do
      Android, o download do PDF por URL assinada, e o fallback web do
      `abrirLinkExterno`).
  - **A correção NÃO precisa de build nova**: o app carrega o site de
    `server.url`, então o deploy do Cloudflare Pages já entrega. Build nova só
    seria preciso se o defeito estivesse na casca.

- **CORES DO ANO NA LOJA — modal de uma vez só (2026-09-06).** Ao abrir a
  `/loja`, um diálogo mostra as Cores do Ano das fabricantes (Sherwin-Williams
  **Universal Khaki SW 6150**; Suvinil **Tempestade D177** e **Cipó da Amazônia
  N879** — a Suvinil elegeu DUAS em 2026) com quadro da cor, nome, código e
  NCS, e um botão "Entendi" que fecha pra sempre. Dados em `lib/coresDoAno.ts`,
  tela em `app/loja/CorDoAnoModal.tsx`.
  - **A chave do "já vi" carrega o ANO (`cor_do_ano_visto_2026`).** Com chave
    fixa, a edição do ano que vem nunca apareceria pra quem já viu esta — o
    modal morreria em silêncio. Trocar `ANO_DAS_CORES` + a lista faz todo mundo
    ver uma vez de novo.
  - **O `hex` é só pro quadradinho da tela** e NÃO substitui o código de
    fórmula: tela de celular não reproduz tinta, e o modal diz isso ("peça pelo
    código no balcão") pra não virar reclamação de cor diferente.
  - **Não mexe no histórico do navegador.** StoryViewer e Click Rua empurram
    entrada pro VOLTAR do Android fechar o overlay, mas os dois são tela cheia;
    aqui o `BackGuard` já cuida do voltar e o modal vive dentro da /loja.
    Empilhar entrada por um diálogo de um botão arriscaria a sentinela do
    BackGuard sem ganho.
  - Fechar por Entendi, Esc ou toque no fundo conta igual — reabrir o que a
    pessoa acabou de fechar é o que ensina a ignorar aviso.

- **DOCUMENTOS LEGAIS: o app não cobra nada de ninguém (2026-09-06, #240).**
  A Privacidade listava o **Mercado Pago** como operador que recebe dados pra
  "processamento de pagamentos do plano PRO e da loja", e os Termos do Cliente
  prometiam **reembolso integral em 7 dias do Plano PRO**. Os dois descreviam o
  mundo anterior a 18/06: desde então o PRO é ativado por **troca de pontos**
  (item 13 dos Termos gerais) e o carrinho da loja só registra o pedido — a
  venda fecha com a Cali Colors fora do app (compliance Apple 3.1.3(e)).
  `startProCheckout` existe em `lib/services/billing-platform.ts` mas **não tem
  call site de UI nenhum**, então nenhum dado sai do app pro MP.
  - **Operador que não recebe nada sai da lista de compartilhamento** — deixar
    ali sugere um fluxo de dados que não existe. No lugar entrou a frase que
    diz o fato ("não há pagamento dentro do aplicativo").
  - **Direito prometido sobre cobrança inexistente também é erro**: o reembolso
    virou a regra real (sem cobrança → sem fatura nem reembolso), preservando o
    prazo do CDC pras compras feitas com a loja FORA do app.
  - **A data de "última atualização" da Privacidade estava em 22/05** — antes
    de metade do que este arquivo registra. Documento legal com data velha é do
    mesmo tipo da lista de pendências: envelhece e ninguém revalida.
  - **Escopo declarado pelo usuário:** portal, mídia do WhatsApp, os 1072 leads
    e o Dualhook são **back-office**, não aparecem pra quem usa o app — a
    política do app fala do app. A ressalva registrada aqui, porque é dele a
    decisão: a LGPD prende no TITULAR, não na tela; os leads e quem tem áudio
    transcrito por terceiro nos EUA são titulares da Cali Colors de todo jeito.
    Se um dia quiserem cobrir isso, é uma seção de prospecção/portal separada,
    não uma linha na política do app.

- **VÍDEO EM `<img>` — miniaturas quebradas no "Em alta" (2026-09-05).** A
  tela `/explore` mostrava metade do grid como ícone de imagem quebrada, e
  uma miniatura exibia a LEGENDA como texto (o `alt` de um `<img>` que não
  carregou). Causa: post de VÍDEO renderizado dentro de `<img>`.
  - **A regra vivia em QUATRO lugares de TRÊS jeitos**: `PostMedia` (extensão
    OU `media_type` — o certo), `StoryViewer` (só extensão),
    `PortfolioSection` (só `media_type`) e `TrendingGrid`/`HashtagFeed`
    (nenhum dos dois). Agora é `isVideoPost(url, mediaType)` em
    `lib/utils.ts`, usada por todas — regra duplicada é regra que diverge.
  - **`media_type` NÃO diz se a mídia é vídeo** — ele marca que o post é
    STORY. Vídeo com `media_type` 'story' ou nulo escapa de qualquer teste
    que olhe só esse campo. E só a extensão também não basta: upload legado
    tem path sem extensão. Por isso os DOIS sinais.
  - O helper é type predicate (`url is string`): quem chama usa `media_url`
    direto no `<video>` sem repetir guard de nulo.
  - Grade nova que mostra post = `isVideoPost`, nunca `<img>` seco.

- **PAR CRUZADO DE ENV DO SUPABASE — a causa do "Faça login" em TODA a IA
  (2026-09-04, PR #202, FECHADO).** Usuário perfeitamente logado levava
  `Faça login (token_invalid)` em toda rota de IA. Evidência do painel do CF
  Pages (Production): `SUPABASE_URL` **não existe**; `SUPABASE_ANON_KEY` existe
  como Secret, **de OUTRO projeto** (herança do app vanilla); o par
  `NEXT_PUBLIC_*` existe e está certo. Como `getSupabaseUrl()` e
  `getSupabaseAnonKey()` resolviam INDEPENDENTES, cada uma com a sua ordem, a
  URL caía no NEXT_PUBLIC e a chave vinha do secret legado. O GoTrue recebia
  apikey de um projeto e token de outro, respondia 401 "Invalid API key" pra
  QUALQUER token, e o `requireAuth` colapsava todo `!res.ok` em
  `token_invalid`.
  - **A assimetria que custou dias:** o PostgREST seguia funcionando porque
    quem o chama é o **cliente**, com a chave boa do bundle (ele valida só
    assinatura e expiração). Só a verificação do **servidor** usava a chave
    divergente. Isso derrubou 6 hipóteses de sessão/token que vieram antes —
    **o token nunca foi o problema**.
  - **REGRA: URL e anon key saem SEMPRE do mesmo par.** `resolveSupabaseEnv()`
    em `lib/api/security.ts` é o resolvedor ÚNICO: tenta o par `NEXT_PUBLIC_*`
    INTEIRO, cai pro par sem prefixo INTEIRO, **nunca meio a meio**.
    `getSupabaseAnonKey()` exige par completo; `getSupabaseUrl()` mantém
    fallback só-URL de propósito — os caminhos de SERVICE ROLE (audit,
    log-error, push-notify) legitimamente não têm anon key.
  - **REGRA: quem fala com o GoTrue pega as duas metades do MESMO objeto.**
    `requireAuth`/`requireAuthStrict`/`verifySupabaseToken`/`validateToken`/
    `getUserFromToken` fazem `const {url, anonKey} = resolveSupabaseEnv()`.
    Duas resoluções independentes dentro do caminho de auth é a FORMA do bug.
  - Guarda nova: o `ref` do JWT anon × o `<ref>` do host `<ref>.supabase.co`.
    Divergindo, o gate devolve `env_project_mismatch` (não `token_invalid`) e
    o texto do 401 carrega os dois refs.
  - **SEIS resolvedores divergentes existiam** (`security.ts`, `health`,
    `_admin-helpers`, `auth-server`, `set-session-cookie`, `moderate-video`,
    mais um escondido em `lib/api/env.ts` que lia só as `NEXT_PUBLIC_*`).
    Dois guards de arquitetura em `__tests__/lib/supabase-env-single-resolver
    .test.ts` falham se qualquer arquivo de `lib/api`/`app/api` voltar a ler
    essas envs cruas ou a pedir a anon key solta.
  - **Nenhum secret do painel foi tocado** — o `SUPABASE_ANON_KEY` divergente
    simplesmente deixou de ser lido. Não apagar: é inerte.

- **MICROFONE NEGADO COM A PERMISSÃO ATIVA — faltava MODIFY_AUDIO_SETTINGS
  (2026-09-04, PR #204).** O Seu Zé dizia "Permissão de microfone negada" com
  o microfone CONCEDIDO na tela de permissões do Android. O
  `BridgeWebChromeClient` do Capacitor 6, ao receber `onPermissionRequest` de
  `AUDIO_CAPTURE`, pede **DUAS** permissões de uma vez —
  `MODIFY_AUDIO_SETTINGS` **e** `RECORD_AUDIO` — e só chama `request.grant()`
  se TODAS voltarem concedidas (o callback faz um AND sobre o Map de
  resultados). Permissão não declarada no Manifest o sistema nega na hora,
  **sem diálogo**: o AND dava false, a WebView recusava, e o `getUserMedia`
  rejeitava com `NotAllowedError`.
  - **REGRA: permissão que a WebView usa vem em PAR — conferir o que o
    Capacitor pede, não o que parece óbvio.** Ler
    `node_modules/@capacitor/android/.../BridgeWebChromeClient.java` antes de
    concluir que o Manifest está completo. `MODIFY_AUDIO_SETTINGS` é NORMAL:
    não abre diálogo, só precisa existir.
  - O `catch {}` mudo virou `mensagemDeMicrofone(e)` (lê o `name` do
    DOMException): bloqueio ≠ sem hardware ≠ ocupado por outro app. A frase de
    bloqueio NÃO afirma mais que a permissão está negada — ela pode estar
    concedida e quem recusou ser a WebView.
  - Manifest tem 8 permissões e o teste `__tests__/microfone.test.ts` trava o
    par. **Só vale com AAB novo.**

- **"Failed to fetch" AO PUBLICAR — a foto subia CRUA (2026-09-04, PR #204).**
  Gerar a legenda com IA funcionava e o "Postar" logo depois morria, na MESMA
  foto. A assimetria era a pista: o "Gerar legenda" do Composer comprime acima
  de `COMPRESS_THRESHOLD` (2 MB) antes de subir; o publicar mandava o arquivo
  ORIGINAL. Desde a **Onda B** a câmera NATIVA (quality 90, resolução cheia) é
  o caminho principal, então "cru" passou a significar 5-12 MB — e o upload
  grande morre na rede móvel dentro da WebView, com o supabase-js devolvendo o
  TypeError cru do fetch como mensagem final. Confirmado em produção.
  - **REGRA: caminho novo que sobe mídia escolhida pela pessoa comprime acima
    de `COMPRESS_THRESHOLD`** — e as dimensões da Wave 17 se leem do arquivo
    QUE SUBIU (comprimir muda W/H; gravar as do original reserva o espaço
    errado no feed). Vídeo não passa pelo compressor de imagem; falha ao
    comprimir cai no original (HEIC que a WebView não decodifica rejeita ali,
    e sobe cru sem problema — comprimir é otimização, não porta).
  - `uploadMedia` não repassa mais "Failed to fetch": vira "Falha de rede ao
    enviar a mídia (X MB)". O número separa conexão ruim de arquivo grande.
  - **ARMADILHA DE TESTE (custou um falso verde):** `toEqual` em `File`
    compara ESTRUTURA, e `File` não tem propriedade própria enumerável
    (`name`/`size`/`type` moram no protótipo) — dois arquivos DIFERENTES
    passam como iguais. O 1º teste passou com a correção revertida. **Comparar
    File por IDENTIDADE (`toBe`), nunca `toEqual`/`toHaveBeenCalledWith`.**

- **P0 da auditoria de arquitetura FECHADOS no código (2026-09-03).** Ver
  `ARCHITECTURE_AUDIT_2026-08-26.md`. Status:
  - **C1 ✓** `gateProAI`/`gateProAIForm` agora retornam 401 pra anônimo/token
    inválido (antes: requisição SEM token chegava na IA sem PRO, rate limit
    nem cota). 6 testes de regressão em `__tests__/api/gate-anon.test.ts`.
  - **C2 ✓ — CSP validada em produção (PR #163).** A fonte ÚNICA dos headers
    de segurança é o `headers()` do `next.config.mjs` (CSP + Permissions-
    Policy + COOP/CORP + CORS restrito em `/api/*`). O `_headers` da raiz NÃO
    entra no output do Next-on-Pages (`.vercel/output/static`) — por isso a
    política vive no next.config. NÃO recriar `next-app/public/_headers` com
    CSP: seria uma segunda CSP divergente. `app/robots.ts` criado.
    `assetlinks.json` servido de `next-app/public/.well-known/`. A CSP tem
    `*.onrender.com` (Evolution API do WhatsApp) — revalidar com `curl -I` a
    cada mudança.
  - **C3/A-D1 ✓ — SQL JÁ EXECUTADO no Supabase (2026-09-03)**:
    `/migrations/2026-09-03-fix-quotes-policy-and-is-portal-admin.sql`
    (DROP da policy furada "View quotes active" + `is_portal_admin()`
    recriada com padrão to_jsonb). Lado código do A-D1 feito:
    `auth-server.ts` não seleciona mais `is_admin`. Não pedir pra rodar de
    novo. (Sanidade rápida se admin sumir do /admin/*:
    `SELECT prosrc FROM pg_proc WHERE proname='is_portal_admin';` — o corpo
    deve conter `to_jsonb`.)
  - **C4 ✓ — resolvido por PR #163 (2026-09-03).** Identidades são DISTINTAS
    e corretas assim: **Android package = `br.com.queroumacor`** (Play
    Console, `twa-manifest.json`, `.well-known/assetlinks.json` — SHA-256
    real do App Signing Key já bate); **iOS bundle + scheme de deep link =
    `br.com.queroumacor.app`** (Info.plist, `br.com.queroumacor.app://auth/
    callback`). NÃO tentar "unificar" os dois — são de stores diferentes. O
    product ID de billing segue `com.calicolors.queroumacor.pro.monthly`
    (configurado nas stores; não renomear sem mexer lá).
  - **C5 ✓ FECHADO (2026-09-06).** Suíte 100% verde, 0 erros de lint, ci.yml
    roda também em push pra main, typecheck.yml duplicado deletado. E a branch
    protection exigindo o job `validate` EXISTE — provada pela recusa
    `405 Required status check "validate" is in progress` no merge do #240.
  - **C6 ✓** jspdf 2→4.2.1 (CRITICAL eliminada); next pinado EXATO em
    `15.5.2` (teto do peer range do @cloudflare/next-on-pages — NÃO subir
    next sem subir next-on-pages junto; caret ali quebra o npm ci). As ~26
    vulns restantes do audit são upstream (advisory do next cobre todas as
    versões; postcss/sharp vendored dele; resto só fecha com Sentry 10 major).
  - **SQL Wave 39 — JÁ EXECUTADO no Supabase (2026-09-03)**:
    `/migrations/2026-09-03-push-device-tokens.sql` (tabela
    `push_device_tokens`, RLS user-owned, canal FCM/APNs separado do web
    push). Rodado em 3 blocos de linha única — o editor do Supabase mutila
    quebras de linha em paste grande (mesma pegadinha 42601 da Wave 26);
    pra SQLs futuros, preferir statements em linha única no chat. Client
    grava via `lib/services/pushTokens.ts` + `<NativePushOptIn>` no
    ProfileFooter (só aparece na casca com plugin). O ENVIO server-side via
    FCM AGORA EXISTE em código: `lib/api/_services/fcm.ts` (FCM HTTP v1,
    RS256 JWT no edge, zero deps) plugado no `/api/push-notify` como canal
    NATIVO independente do web push (VAPID) — cada canal envia sozinho, sem
    503 se um faltar. Falta só CONFIG (não código): projeto Firebase +
    `google-services.json`/`GoogleService-Info.plist` no nativo + 3 envs
    Secret no CF Pages (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`,
    `FCM_PRIVATE_KEY`) + APNs Auth Key no Firebase pra iOS. Ver
    `docs/NATIVE_BRIDGE.md`. Deps dos plugins Capacitor já no package.json da
    raiz; `npx cap add android`/`cap sync` é na máquina de build (SDK nativo,
    não roda no remoto). Não pedir pra rodar de novo.
  - **Onda A de capacidades nativas (2026-09-04, PR #178)** — "parar de
    parecer site". 4 plugins novos na RAIZ (`@capacitor/{haptics,status-bar,
    splash-screen,keyboard}`, acessados só via `window.Capacitor`, nunca
    importados no bundle web) + wrappers em `lib/native/`
    (`haptics`/`statusBar`/`splash`/`keyboard`/`appState`) + componente
    `<NativeChrome>` montado no `AppShell` (inicializa StatusBar temática,
    Keyboard `resize:native`, esconde a splash no 1º frame, reaplica StatusBar
    no `resume`). Háptico fiado em: trocar aba (BottomNav), curtir e salvar
    (`usePostInteractions` onMutate), publicar (`usePublishPost` onSuccess).
    Config de Splash/Keyboard no `capacitor.config.ts`. Tudo feature-detected
    com fallback web (`navigator.vibrate` p/ haptics; no-op p/ o resto) — 12
    testes novos em `__tests__/native.test.ts`. **Só vale no aparelho com AAB
    novo** (plugin entra no bundle nativo). Doc: `docs/NATIVE_BRIDGE.md`.
  - **Onda B de capacidades nativas (2026-09-04, PR #180)** — mídia robusta.
    Câmera NATIVA (`@capacitor/camera` getPhoto source CAMERA) vira o caminho
    PRINCIPAL do botão "tirar foto" em 3 telas (MediaUploader do publicar,
    EditProfileForm, SignupStep2) — pede a permissão real (aparece nos ajustes
    do app) e corrige EXIF/qualidade; `CameraCapture` (getUserMedia) fica de
    fallback quando o plugin não existe. `pickImagesNative` (novo em
    `lib/native/camera.ts`, plugin `pickImages`) = picker nativo de galeria,
    fiado nos fluxos SÓ-IMAGEM (avatar do editar/signup) via `onClick` do label
    com `preventDefault`+fallback pro `<input>`; **NÃO** no dropzone do composer
    porque `pickImages` é só-imagem e o composer aceita vídeo (regressão). Novo
    `lib/native/filesystem.ts` (`saveFileNative`+`blobToBase64`, plugin
    `Filesystem`→Documents) plugado no `shareOrDownloadImage` como caminho
    confiável de salvar imagem na WebView (antes do anchor que falha lá). PDF de
    orçamento é print-to-PDF (sem blob), então filesystem não se aplica a ele.
    `@capacitor/filesystem` novo na raiz; sem permissão nova no Manifest
    (pickImages usa o Photo Picker do sistema; Filesystem grava app-scoped).
    9 testes novos; suíte 1492/1492. Só vale no aparelho com AAB novo.
  - **Onda C de capacidades nativas (2026-09-04, PR #181)** — utilidades.
    Wrappers novos em `lib/native/`: `network` (plugin Network + eventos web),
    `clipboard` (plugin Clipboard → Web Clipboard → execCommand), `browser`
    (`openExternal` via plugin Browser/Custom Tab — DIFERENTE de
    `lib/utils/openInBrowser`, que é o escape-hatch `intent:` pra sair pro
    Chrome), `device` (`getDeviceInfo` de Device+App) e `badge` (`setAppBadge`
    via `@capawesome/capacitor-badge`). Componentes novos no `AppShell`:
    `<OfflineBanner>` (faixa "sem conexão") e `<NativeBadge>` (nº no ícone =
    não-lidas de aviso+mensagem). `PostActions` passou a compartilhar/copiar
    pelos wrappers (share nativo → Web Share → copiar). `DiagView` mostra
    modelo/OS/versão/build nativos. Plugins novos na raiz: `@capacitor/{network,
    clipboard,device}` + `@capawesome/capacitor-badge`. Sem permissão nova no
    Manifest. 16 testes novos; suíte 1502/1502. Só vale no aparelho com AAB
    novo. **Onda D NÃO será feita (decisão do usuário).**
  - **BOOT LOGADO QUEBROU — assinatura realtime duplicada (2026-09-04, PR
    #184).** Depois da Onda C, todo usuário LOGADO caía em "Algo deu errado"
    (error boundary), no app E no Chrome; incognito também. Causa: o
    `<NativeBadge>` (Onda C) usa `useUnreadMessageCount` + `useUnreadNotification
    Count`, mas o **TopNav já usava** o de mensagem e o **BottomNav já usava** o
    de notificação. O Supabase **deduplica canais realtime pelo NOME**
    (`msg-count:<uid>` / `notif-count:<uid>`): o 2º consumidor chamava `.on()`
    num canal já `subscribe()`-ado e estourava `cannot add postgres_changes
    callbacks after subscribe()`, que sobe pelo React até o error boundary. Fix:
    **nome de canal ÚNICO por instância** do hook (`useId()` no sufixo) — os
    dois hooks agora são reutilizáveis por N componentes. **REGRA: hook com
    canal realtime = nome único por instância** (`useId`), senão dois
    consumidores colidem. `next build`/tsc/vitest NÃO pegam (o mock de supabase
    não deduplica canal); só o console do navegador com o supabase real. Achado
    lendo o console (F12); `error.tsx` passou a gravar `render-error` na tabela
    `errors` p/ o próximo caso aparecer no /admin/errors sem depender do Sentry.
  - Câmera no fluxo de publicar: usa o sistema do `MediaUploader` já
    existente no main (`CameraCapture` + `useOfereceCamera` + recuperação de
    galeria) — NÃO o botão `native.camera` que a auditoria tinha proposto
    (superado). `lib/native/camera` fica como primitivo do bridge (testado),
    disponível pra outros usos.

- **Fronteira nativa `lib/native/` + OAuth pelo browser do sistema
  (2026-09-03).** Decisão de arquitetura: casca mobile continua CAPACITOR
  (não React Native) — nativo entra como capacidade, não como segunda UI;
  RN+Expo arquivado até o dia em que o roadmap pedir telas nativas.
  `next-app/lib/native/` é a ÚNICA fronteira do web com a casca (acessa
  `window.Capacitor` injetado, NUNCA importa `@capacitor/*` no bundle):
  `platform` (detecção), `auth` (fluxo A de OAuth: `skipBrowserRedirect` →
  `Browser.open` no navegador do sistema → deep link
  `br.com.queroumacor.app://auth/callback` → `appUrlOpen` → parse do
  fragment → `setSession` — resolve o `disallowed_useragent` do Google e o
  App-Bound Domains do iOS), `camera` (base64→File; `cancelled` ≠
  `unavailable`), `share`, `push` (só registro/token; persistência+FCM é o
  próximo passo). Integrado no `AuthProvider.signInWithOAuth` com
  feature-detection — browser/PWA/casca velha seguem no fluxo web intocado.
  Tudo com timeout (promessa pendurada em WebView não rejeita). 12 testes
  em `__tests__/native.test.ts`. Doc: `docs/NATIVE_BRIDGE.md`.
  - **Componente novo NUNCA importa plugin/`window.Capacitor` direto — só
    `@/lib/native`.**
  - **PENDENTE (painel/casca, não código):** (1) adicionar
    `br.com.queroumacor.app://auth/callback` nas Redirect URLs do Supabase
    (sem isso o callback cai no Site URL e o login nativo não completa);
    (2) na casca, instalar `@capacitor/{browser,app,camera,share}` +
    **`@capacitor-firebase/messaging`** (NÃO `@capacitor/push-notifications`:
    no iOS aquele devolve token APNs, e o `fcm.ts` envia por FCM v1 que quer
    token FCM; o firebase/messaging devolve FCM nos dois SOs) + `npx cap
    sync`; (3) config do Firebase + 3 envs FCM (ver `docs/NATIVE_BRIDGE.md`).
- **"502 Bad gateway" VOLTOU no envio de WhatsApp — agora na ABORDAGEM DE
  LEAD (2026-08-31).** Não é a causa de 28/08 (número estrangeiro): o
  telefone do caso (`11 96268-0094`) é celular BR e passa correto pelo
  `normalizeWhatsAppTarget`. A página de 502 é do PRÓPRIO Cloudflare — ou
  seja, a function do edge morreu antes de responder. Duas falhas de
  estrutura, as duas corrigidas:
  - **A rota não tinha ORÇAMENTO TOTAL.** Cada hop tinha o seu teto (auth
    10s + rate limit 10s + envio 25s + gravar 8s + audit 5s = **até 58s**),
    mas ninguém somava — e o CF mata a function bem antes disso. Agora:
    `ROUTE_DEADLINE_MS` de 22s embrulha o handler inteiro (`Promise.race`,
    responde 504 explicando em vez de deixar o CF responder HTML cru),
    `SEND_TIMEOUT_MS` caiu 25s → **14s**, e gravar+audit passaram a rodar
    **em paralelo** com teto próprio de 6s (`BOOKKEEPING_BUDGET_MS`).
    Escrituração depois do envio era caminho real pro 502 **com a mensagem
    já entregue** — o operador via "falhou" e mandava de novo.
    **REGRA: rota de edge = orçamento total, não só timeout por hop.**
  - **A abordagem nunca aquecia a Evolution.** `aquecerEvolution` /
    `acordarEvolution` viviam DENTRO do componente da tela de WhatsApp;
    a `AbordagemModal` (aba Leads) chamava `/api/whatsapp/send` direto, com
    o servidor possivelmente frio, e pagava o cold start DENTRO do edge —
    exatamente o que a arquitetura diz que só o navegador pode fazer. As
    duas funções subiram pra escopo de MÓDULO (estado compartilhado: aquecer
    numa tela vale na outra); o modal aquece ao abrir (enquanto o operador
    lê o texto) e mostra "Acordando o servidor…" antes de enviar.
    **REGRA: tela nova que chama `/api/whatsapp/send` chama
    `acordarEvolution` antes.**
  - **Bônus: o erro de timeout deixou de mentir.** Dizia sempre "o Render
    dorme após 15min" — falso desde 29/08 (plano pago). Agora, ao estourar,
    o service sonda `GET /instance/connectionState/<instância>` (4s) e diz a
    causa: `close`/`connecting` → "reconecte o QR no Manager" (aí o Baileys
    pendura pra sempre e timeout maior não resolve); `open` → "só lentidão,
    a mensagem NÃO saiu, tente de novo". 4 testes novos.
  - **Ainda não confirmado qual dos dois gatilhos disparou** (Render frio ×
    sessão do WhatsApp caída) — sem acesso ao banco nem à rede daqui. O
    próprio erro passa a dizer na próxima vez. Diagnóstico manual:
    `GET /api/whatsapp-evo/ping` com token de admin (a rota continua no ar,
    só o botão saiu da tela).

- **DIREÇÃO MOBILE MUDOU (2026-09-03): AGORA É CAPACITOR, não WebIntoApp.**
  A regra antiga "NÃO EXISTE BUILD NATIVO / WebIntoApp empacota / Capacitor
  fora de escopo" está **SUPERADA** por decisão do usuário nesta sessão. Foi
  VERIFICADO (não presumido) que a casca WebIntoApp é **WebView pura, sem
  Capacitor** — então `lib/native/` (câmera, push, OAuth pelo browser do
  sistema) NÃO funciona nela, e push nativo é impossível ali. O AAB
  DEFINITIVO passa a sair do **Capacitor**. O `capacitor.config.ts` (raiz)
  deixou de ser "resto abandonado" e é o config vigente da casca.
  - **Firebase (feito 2026-09-03):** projeto `queroumacor-245ef`; app Android
    `br.com.queroumacor` + Apple `br.com.queroumacor.app` registrados;
    `google-services.json`/`GoogleService-Info.plist` baixados; FCM API V1
    Enabled. 3 secrets FCM setados no CF Pages + redeploy.
  - **Fatos do build real (verificados):** `applicationId br.com.queroumacor`,
    `versionCode 10100`, `minSdk 24`; app em produção (release 1.1, ~19
    instalados) sob a conta **`queroumacor@gmail.com`** (NÃO `jackson.guerra@`);
    Play App Signing ativo; upload key (`my-release-key.jks`) confere com o
    Play (NÃO precisa resetar). O host do deep link (App Links) é
    **`www.queroumacor.com.br` COM www**.
  - **PEGADINHA:** a pasta `deeplinks/` que o WebIntoApp deixou tem
    `assetlinks.json` com o fingerprint ERRADO — ignorar. O válido é o de
    `next-app/public/.well-known/assetlinks.json` (package `br.com.queroumacor`,
    SHA-256 do App Signing Key), que é o servido em produção.
  - **`capacitor.config.ts` carrega o APEX `https://queroumacor.com.br`** (sem
    www), mas o deep link é `www.*`. `allowNavigation` cobre `*.queroumacor
    .com.br`, então navegar não quebra; se a casca DEVE carregar o www,
    trocar `server.url`. Confirmar antes do build.
  - **Plano nativo pendente na casca (build machine):** capability de Push +
    `AppDelegate.swift` (iOS), plugin `google-services` no Gradle (Android),
    permissão `POST_NOTIFICATIONS` (Android 13+, o plugin pede via
    `requestPermissions`), intent-filter do scheme `br.com.queroumacor.app`
    pro OAuth. Doc: `docs/NATIVE_BRIDGE.md`.
  - **Nota histórica:** o corolário de 2026-09-02 ("mudança de wrapper só
    chega com AAB novo") continua VERDADEIRO pra qualquer casca — o que
    muda é que o AAB agora nasce do Capacitor, não do WebIntoApp.
  - **Casca Android JÁ NO REPO (2026-09-03, PR #171):** `android/` scaffoldado
    (`npx cap add android`), `applicationId br.com.queroumacor`, versionCode
    10200, minSdk 24, compileSdk/targetSdk 36, deep link OAuth + `POST_NOTIFICATIONS`
    no Manifest, 5 plugins (incl. `@capacitor-firebase/messaging`). `assets/public`
    e config JSONs gerados ficam GITIGNORED (o app carrega de `server.url`).
  - **AAB gerado pelo CODEMAGIC, não GitHub Actions (2026-09-03).** `codemagic.yaml`
    na raiz (workflow `android-aab`, disparo manual). Assinatura via
    `signingConfig` CONDICIONAL no `android/app/build.gradle` que lê
    `android/key.properties` (gitignored) — o Codemagic monta esse arquivo do
    keystore do painel (`CM_KEYSTORE_*`, reference `queroumacor_keystore`);
    build local sem o arquivo sai não-assinado, sem quebrar. `google-services.json`
    entra por env `GOOGLE_SERVICES_JSON` (base64) do grupo `firebase`. **GitHub
    Actions foi DESCARTADO pra build de AAB** (PR #172 fechado sem merge) —
    Codemagic é melhor pra mobile (iOS/macOS + assinatura Apple no mesmo lugar).
    Doc: `docs/ANDROID_AAB_CODEMAGIC.md`.
  - **Deploy AUTOMÁTICO na Play (2026-09-04, PR #182):** `publishing.google_play`
    sobe o AAB direto na faixa **`internal`** (Internal Testing); produção
    continua MANUAL (regra do projeto). Credencial no grupo `google_credentials`
    (`GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS`, JSON da service account — lido
    automaticamente pelo CLI). **`versionCode` virou automático**: 1º step roda
    `google-play get-latest-build-number --package-name br.com.queroumacor`
    (maior de todas as tracks) +1, com fallback pra `ANDROID_VERSION_CODE`/10202
    se o CLI falhar (nunca derruba a build). O AAB SEGUE saindo por e-mail +
    artifact também. Lado Play (não-código): a service account precisa de
    permissão de Releases no app + Google Play Android Developer API habilitada.
  - **iOS AGORA SAI DO CODEMAGIC (Capacitor), não do GitHub Actions
    (2026-09-04, verificado na `main`).** O `codemagic.yaml` ganhou o workflow
    **`ios-ipa` ("iOS IPA (Capacitor)")** — `app_store_connect: codemagic`
    (a mesma integração que o repo `queroumacor-ios` já usa), `ios_signing`
    `distribution_type: app_store`, sobe no **TestFlight**. O **projeto Xcode
    está VERSIONADO na `main`** (`ios/App/App.xcodeproj`, `.xcworkspace`,
    `Podfile`, `App.xcscheme`, Assets com ícone 512 + splash 2732²) — gerado por
    `npx cap add ios` e commitado; a build roda `npx cap sync ios` (NUNCA
    `cap add ios` de novo — ele sobrescreveria os arquivos curados). **NÃO usar
    o `.github/workflows/ios-build.yml`** (GitHub Actions): é o pipeline antigo,
    superado, e ele roda `rm -rf ios && npx cap add ios` (a armadilha que apaga
    os curados) — pendente de deleção. **Numeração iOS:** `CFBundleShortVersion
    String` (versão, ex.: `1.2.0`) é à mão no `Info.plist`; **build number é
    automático** (Codemagic pergunta o último à App Store +1) — o último do
    WebIntoApp foi 9, então a 1ª build Capacitor sai como **10**. Segredos em
    painel do Codemagic: `GOOGLE_SERVICE_INFO_PLIST`/`GOOGLE_SERVICES_JSON`
    (grupo `firebase`), integração App Store Connect (`codemagic`). Identidade:
    bundle `br.com.queroumacor.app`, Apple ID `6784256495` (mesma ficha do
    WebIntoApp — um substitui o outro, não vira app novo). **Pendências iOS não
    bloqueantes de TestFlight (revisado em 2026-09-05):** APNs `.p8`
    ✓ FEITO (Key ID `2R6FW9F2F6`, Sandbox & Production, nos dois slots do
    Firebase) e `App.entitlements` ✓ EXISTE com `aps-environment: production`,
    referenciado no projeto Xcode — e a capability Push
    Notifications no App ID `br.com.queroumacor.app` ✓ LIGADA E SALVA
    (2026-09-05). **O lado Apple do push está COMPLETO.**
    - **`Certificates (0)` nessa tela é o CERTO — não "consertar".** O botão
      "Configure" ali abre "Apple Push Notification service SSL Certificates",
      que é o caminho ANTIGO do APNs (um certificado por App ID, vence todo
      ano, renovação manual). Nós usamos a Auth Key `.p8`, que não expira e é
      team-scoped, então a contagem fica em 0 pra sempre. **NÃO criar
      certificado ali**: viraria uma credencial paralela que ninguém usa e
      que, ao vencer em 12 meses, faria alguém concluir que o push quebrou
      quando não quebrou.
    - **Build iOS que tenha COMEÇADO antes desse Save precisa rodar de novo:**
      o provisioning profile é gerado durante a build, e o dela não carrega o
      direito. Falha visível = `entitlement not supported` na assinatura;
      falha TRAIÇOEIRA = a build passa e o app no TestFlight simplesmente
      nunca recebe push. Antes da REVIEW: esconder compra do PRO no
    iOS ✓ JÁ SATISFEITO (`startProCheckout` existe em
    `lib/services/billing-platform.ts` mas **não tem call site de UI nenhum**;
    o `ProView` oferece o WhatsApp da loja — não há compra dentro do app pra
    esconder); fallback offline ✓ FEITO (PR #201). **"Tirar a sessão do Supabase do
    `localStorage`" — FECHADO como NÃO SE APLICA (2026-09-05).** A pendência
    vinha de auditoria antiga e não descreve mais uma ação útil:
    - o problema que a motivou (perder a sessão quando o storage é limpo) foi
      resolvido em 2026-08-28 pelo `hybridAuthStorage` — grava em localStorage
      **E** em cookies fatiados, e na leitura vale quem sobreviveu;
    - tirar do localStorage só melhoraria a segurança se a sessão fosse pra um
      cookie **httpOnly** — e o supabase-js no client **precisa ler o token em
      JavaScript**, então o cookie que sobra é legível por script: mesma
      exposição a XSS, troca de seis por meia dúzia (o próprio cabeçalho de
      `sessionStorageHybrid.ts` já registra isso);
    - a Apple **não exige** nada disso.
    **A ação real por trás dela**, se um dia for prioridade, é outra e muito
    maior: sessão httpOnly com validação no servidor — reescrita do modelo de
    auth do app, não ajuste pré-review. Não reabrir como se fosse tarefa
    pequena de véspera de submissão. Doc
    `docs/IOS_BUILD.md` está DESATUALIZADO (bundle/repo/fluxo Xcode manual
    errados) — reescrever com esta realidade.
  - **R8 QUEBROU O BOOT — REVERTIDO (2026-09-04, PR #183).** O R8 ligado no
    #179 (`minifyEnabled`/`shrinkResources true`) fez o app **não passar da
    splash** no Internal Testing: apesar das keep-rules, removeu classe(s) que
    o Capacitor registra por reflexão e a WebView nunca carregou. Agravado pela
    splash `launchAutoHide:false` da Onda A — quando a WebView não carrega, a
    splash fica CONGELADA pra sempre (o `launchShowDuration` é ignorado com
    autoHide false). Reversão: `minifyEnabled false`/`shrinkResources false`
    (as keep-rules ficam pro dia de reativar COM smoke-test de aparelho) +
    `SplashScreen.launchAutoHide:true` + `launchShowDuration:2500` (a splash
    SEMPRE some, mesmo se o site demorar/falhar). **REGRA: nunca publicar R8
    (nem mudança de boot da casca) sem instalar o AAB e ABRIR antes.** Num app
    WebView o ganho do R8 é modesto e não vale o risco.

- **Wave 56 (2026-08-30) — nome do cliente no orçamento — JÁ EXECUTADA
  no Supabase (2026-08-30). Não pedir pra rodar de novo.** O PDF dizia
  "Cliente não informado" em pedido de cliente LOGADO:
  `create_quote_from_post` grava `client_id` mas nunca preencheu
  `client_name`/`client_phone`. Forma final: **trigger BEFORE INSERT**
  `trg_fill_quote_client_info` em `quotes` (não a recriação da RPC — o
  bloco grande corrompia na colagem pelo celular, e o trigger cobre
  qualquer caminho de criação futuro). Congela nome+telefone do perfil na
  ÉPOCA do pedido; só preenche se `client_id` existe e o nome veio vazio.
  Backfill feito. `OrcamentoSheet` mostra "Em nome de <nome> · <fone>" no
  topo. **Colagem de SQL pelo CELULAR corta/emenda blocos grandes — SQL
  pra rodar no aparelho tem que ser curto, e a aba precisa estar vazia.**

- **Wave 54 (2026-08-30) — contador de seguidores em DOBRO — JÁ
  EXECUTADA no Supabase (2026-08-30). Não pedir pra rodar de novo.**
  Perfil novo com 3 follows mostrava 6 (2× exato, sem backfill no meio =
  veio só de trigger; o app não escreve nos contadores). Causa: DOIS
  triggers de contador vivos em `follows` — um legado além do
  `trg_maintain_follow_counts` da Wave 40, que só derruba o homônimo.
  `/migrations/2026-08-30-follow-counts-dedupe.sql` derruba todo trigger
  de contador não-canônico (filtro: a função toca followers/following/
  posts_count — triggers de pontos/notificação passam) e RECONTA os três
  contadores da verdade. **Lição: wave nova de trigger precisa varrer
  duplicatas por FUNÇÃO, não só pelo próprio nome.**

- **Wave 55 (2026-08-30) — origem das mensagens do WhatsApp — JÁ
  EXECUTADA no Supabase (2026-08-30). Não pedir pra rodar de novo.**
  `whatsapp_messages.origin` ('portal'|'ia'|'celular'): rota de envio
  grava portal; runner da IA + follow-up gravam ia; o webhook grava
  celular em toda 'out' que chega de fora (o eco do que portal/IA
  enviaram colide no `message_id` UNIQUE e o ignore-duplicates descarta —
  só sobra o que nasceu no aparelho). Portal (v=20260830a): chip
  📱 celular / 🖥️ portal / 🤖 IA por conversa (lista + cabeçalho),
  decidido pela ÚLTIMA 'out' com origem conhecida; histórico sem pista
  fica sem chip. Backfill só do afirmável (sent_by NOT NULL = portal).

- **PDF do orçamento: as DUAS causas de produção nomeadas (2026-08-30).**
  A telemetria `pdf-link-fail` provou: (1) o bucket `exports` EXISTE mas as
  **policies da Wave 41 nunca rodaram** ("new row violates row-level
  security policy" no upload direto — desde o primeiro dia); (2) o GoTrue
  recusa token cuja SESSÃO rotacionou ("401 token inválido") enquanto
  Storage/PostgREST aceitam o mesmo token — eles validam só a assinatura.
  Correções: rota `/api/quote-pdf-upload` (edge) com autenticação em DOIS
  degraus — GoTrue ok → service role (imune a policy, cria o bucket se
  faltar); GoTrue recusou → upload com o token do PRÓPRIO usuário e quem
  valida é a policy do Storage (path amarrado ao `auth.uid()`; o `sub`
  decodificado do JWT NÃO é prova de identidade, só prefixo). Client tenta
  direto → rota; 401 na rota ganha UMA `refreshSession` com teto de 6s.
  **Wave 41 CONFERIDA NO BANCO em 2026-09-05: o bucket `exports` E as 3
  policies EXISTEM.** A anotação anterior dizia "PENDENTE" e estava errada —
  os dois degraus funcionam. Não pedir pra rodar. **Regra nova: fluxo do app que
  autentica em rota própria NÃO deve depender só do GoTrue `/auth/v1/user`
  — token session-stale é estado normal de WebView.**

- **`quotes.post_id` — Wave 53 (2026-08-30). CONFERIDA NO BANCO em
  2026-09-05: a coluna EXISTE. Não pedir pra rodar de novo.** (A anotação
  ficou meses dizendo "PENDENTE" depois de já ter sido executada.)
  "Enviar orçamento" morria com `42703: column "post_id" of relation
  "quotes" does not exist`. A **Wave 42** recriou `create_quote_from_post`
  passando a GRAVAR `post_id` (antes a RPC recebia `p_post_id` e jogava
  fora em silêncio), mas a coluna nunca existiu — a migration foi escrita a
  partir do que o CÓDIGO mandava, não do schema real. Enquanto o parâmetro
  era ignorado ninguém notava; ao passar a gravar, estourou na cara do
  cliente. **Mesmo erro de `leads.city`.** `/migrations/
  2026-08-30-quotes-post-id.sql` cria a coluna (FK pra `posts` com ON
  DELETE SET NULL) + índice parcial `(painter_id, post_id)`, que é o que o
  filtro de leads comprados consulta (`lib/services/leads.ts`) e que nunca
  casou por falta da coluna.
  - **REGRA: conferir o schema real antes de escrever INSERT/UPDATE em SQL.**
    A lista de colunas do código não é a da tabela. Já custou dois
    incidentes em dois dias.

- **Coluna TELEFONE nas listas de pessoas (2026-08-29, v=20260829zb).**
  Nenhuma aba mostrava o telefone de quem se cadastrou, embora
  `profiles.phone` já viesse no `select('*')`. Coluna nova (com ✏️ pra
  editar e 📱 que abre o wa.me) em **Pintores** — logo Grafiteiros e
  Funileiros, que reusam `PintoresList` —, **Clientes** e **Usuários com
  acesso ao Portal**; entre as três, todo perfil cadastrado aparece
  (`isClienteProfile` pega quem não é profissional nem admin). Célula
  `PhoneCell` + `editUserPhone`; a action `set_info` de
  `/api/admin/users` passou a aceitar `phone`.
  - **A normalização segue `normalizeWhatsAppTarget`, NÃO
    `normalizeBrPhone`:** com 11 dígitos só é celular BR quando o 3º é 9;
    10 dígitos = fixo BR; 11-15 em outro formato = estrangeiro, guardado
    verbatim. A primeira versão colava '55' em qualquer coisa com 11
    dígitos — o mesmo erro que transformou o contato dos EUA
    `16503154274` em `5516503154274` e derrubou o envio com 502. Guardar
    com máscara também está proibido: o número deixaria de casar com
    `whatsapp_messages` e com os leads, que comparam dígitos. 4 testes
    novos em `__tests__/api/admin-users.test.ts`.
  - **Campo novo no body de `/api/admin/users` = campo novo no TIPO do
    `body`** (o `let body: { … }` no topo do `route.ts`). Esquecer disso
    QUEBRA O DEPLOY: `next build` roda "Checking validity of types" e
    falha com TS2339 ("Property 'phone' does not exist on type…"), o
    Cloudflare não gera deployment nenhum e o painel mostra só "No
    deployment available" — inclusive pros commits seguintes, que herdam
    o erro. Aconteceu com `phone` em 2026-08-29. `vitest` NÃO pega isso
    (roda por transpilação, sem type-check).

- **Produtos do portal: carregamento (2026-08-29, v=20260829z).** O catálogo
  passou de **21 mil** linhas e a tela ficava minutos em "Carregando
  produtos...": eram até 22 requisições `select('*')` **em fila** (cada uma
  esperando a anterior) e, no fim, o React montava **um card por produto** —
  em "Todos", 21 mil cards de uma vez. Agora: (1) só as colunas do card
  (`PRODUTO_COLS`) — `description` e a ficha técnica saíram do payload e a
  gaveta busca a linha inteira (`select('*')` de UMA linha) no "Editar";
  (2) a 1ª página pinta a tela e **tira o "Carregando"**, o resto vem em
  paralelo (4 conexões) e é emendado — `paginas[n]` guarda cada lote na sua
  posição, senão a ordem por nome embaralha; (3) **janela de 60 cards**
  crescendo por IntersectionObserver (`PRODUTOS_JANELA`); (4) `_cat` e `_q`
  calculados uma vez em `prepararProduto` (antes `classify` e o
  `toLowerCase` do filtro rodavam 21 mil vezes por tecla) + busca com 250ms
  de atraso; (5) cache em memória (`_produtosCache`) — sair da tela e voltar
  não refaz nada, e há o botão "↻ Atualizar"; (6) salvar/excluir emendam a
  linha na lista (`aplicarLinha`) em vez de recarregar tudo — por isso
  `productsService.upsert` agora termina em `.select()`.
  - **Wave 52** (`/migrations/2026-08-29-products-name-index.sql`) — **JÁ
    EXECUTADA no Supabase (2026-08-29). Não pedir pra rodar de novo.**
    `CREATE INDEX CONCURRENTLY idx_products_name` (roda sozinho, fora de
    transação): sem ele cada uma das ~22 páginas reordenava as 21 mil
    linhas. Confirmado pelo `EXPLAIN ANALYZE`: "Index Scan using
    idx_products_name on products", 3,0 ms na fatia OFFSET 5000.
  - **Foto do produto cortada (2026-08-29, v=20260829za).** A caixa da
    imagem era uma faixa de 60px com `cover` — a foto entrava cortada pelo
    meio (quem cadastra não reconhecia a peça). Agora a área de mídia tem
    96px (`PRODUTO_MIDIA_H`) e a foto entra INTEIRA (`contain`) sobre fundo
    creme; sem foto, a mesma caixa vira o bloco de cor. Mesma correção na
    LOJA DO APP, que tinha o mesmo `cover`: miniatura do `ProductCard`
    (quadrado de 64px) e hero do `ProductDetailSheet` (140px) passaram a
    `object-contain`.

- **Captação de leads por WhatsApp com IA (2026-08-29).** Duas etapas, as
  duas no ar; SQL Wave 46 JÁ EXECUTADA (2026-08-29).
  - **Etapa A — botão "💬 Abordar"** na lista de Leads (portal). Abre
    `AbordagemModal`: mostra categoria, sub-funil (fornece obra × precisa
    de obra, via `LEAD_PITCH`), telefone e se é celular ou fixo
    (`tipoDeLinha`); sugere produtos do catálogo por palavras no NOME
    (`LEAD_PITCH[].termos`, marcáveis + busca manual); monta o texto
    personalizado (`montarAbordagem`) e envia pelo canal da loja. Ao
    enviar, lead vira `contactado`. Ícone 📱 ao lado mantém o wa.me no
    aparelho do operador. `normalizeLeadPhone` cobre celular antigo de 8
    dígitos (ganha o nono).
  - **REGRA DA LOJA (inegociável):** mensagem e IA **NUNCA** falam preço,
    valor, desconto, condição de pagamento nem fazem orçamento — isso é
    de pessoa. Aplicada em DOIS pontos: no prompt E em trava de código
    (`clientAsksForPrice` escala antes de chamar o modelo;
    `replyLeaksPrice` barra vazamento na saída). 14 testes em
    `__tests__/services/whatsapp-ai.test.ts`.
  - **Etapa B — IA meio-termo.** `whatsapp-ai.ts` (prompt + travas +
    horário comercial de Brasília 8h-19h, sem domingo + opt-out PARE +
    modelo por env `WHATSAPP_AI_MODEL`, default gpt-4o-mini). **Teto de
    30 respostas automáticas por CONVERSA por DIA** (anti-loop/custo) —
    o "dia" é o de Brasília via `diaBrt()`, não o UTC (com `toISOString`
    cru o contador virava às 21h daqui e cortava conversa de noite). e
    `whatsapp-ai-runner.ts` (cola com o webhook; ordem: opt-out > IA
    desligada > fora do horário > teto de 12/dia > responde). Ao escalar,
    DESLIGA a IA na conversa e cria alerta. Runner é best-effort: nunca
    derruba o 200 do webhook. Chamado SÓ em mensagem `in` de texto.
  - **Wave 46** (`/migrations/2026-08-29-whatsapp-ai.sql`):
    `whatsapp_ai_state` (chave por conversa + contador diário) e
    `portal_alerts` (preco/orcamento/humano), RLS só `is_portal_admin()`.
  - **Wave 47** (`/migrations/2026-08-29-whatsapp-ai-config.sql`) — JÁ
    EXECUTADA (2026-08-29). `whatsapp_ai_config` (linha única id=1:
    `hours` '8-19'|'0-24'|'8-19 +dom', `default_on`) + `last_why`/
    `last_at` em `whatsapp_ai_state`. **NÃO usar `app_settings` pra
    config que o portal ESCREVE** — ela guarda segredo de sistema
    (`push_internal_secret`, `push_notify_url`) e a RLS recusa a escrita,
    corretamente (erro visto em produção: "new row violates row-level
    security policy for table app_settings").
  - **MENSAGEM DE AUSÊNCIA (2026-08-29, junto da Wave 48).** As duas
    saídas silenciosas do runner deixaram de ser silêncio: fora do horário
    OU com a chave desligada, o cliente recebe UMA cortesia fixa ("aqui é
    da Cali Colors, obrigado pelo contato, retornamos em breve" — texto
    fixo, não é a IA falando, então nem chega perto de preço).
    `textoAusencia` + `shouldSendAway` em `whatsapp-ai.ts` (puros,
    testados); `enviarAusencia` no runner. Travas: nada pra `opted_out`,
    1 a cada 12h por conversa (`whatsapp_ai_state.away_at`), e silêncio
    se uma PESSOA respondeu nas últimas 2h (ela está no volante). Também
    abre alerta no portal (`humano`) já marcado `followed_up_at` — a loja
    vê quem escreveu de madrugada, a varredura cobra depois ("sem resposta
    há Xh") e NÃO repete a promessa. Config: `whatsapp_ai_config.away_on`
    (chave no portal) + `away_text` (texto custom, NULL = padrão).
  - **Wave 48** (`/migrations/2026-08-29-whatsapp-followup.sql`) — **JÁ
    EXECUTADA no Supabase (2026-08-29), incluindo os complementos
    `away_on`/`away_text`/`away_at` e `last_read_at`. Cron confirmado:
    `run_whatsapp_followup()` devolveu 200 com
    `{"ok":true,"ran":true,"conversas":5}` e o `app_settings.
    whatsapp_followup_url` já está com o token real. Não pedir pra rodar
    de novo.** FOLLOW-UP AUTOMÁTICO: varredura de
    hora em hora (pg_cron → pg_net → `POST /api/whatsapp-evo/followup
    ?token=<EVOLUTION_WEBHOOK_TOKEN>`, URL guardada em `app_settings.
    whatsapp_followup_url`) que olha TODAS as conversas já existentes
    (janela de 30 dias) e faz 3 coisas: (1) alerta parado vira "⏰ sem
    resposta há Xh" — cutucão interno, qualquer hora; (2) cobra o cliente
    UMA vez ("seu pedido está na fila"), só em horário de atendimento;
    (3) reengaja quem sumiu depois que a LOJA falou por último (inclui o
    lead que nunca respondeu à abordagem), 1 toque por semana. **Nenhum
    texto automático anuncia o "responda PARE"** (decisão da loja,
    2026-08-29) — a palavra continua valendo no runner: quem responde vira
    `opted_out` e não recebe mais nada. Teto de 10
    envios por varredura. Nunca fala com quem pediu PARE (`opted_out`)
    nem com a conversa cuja chave o operador desligou na mão. Lógica pura
    em `lib/api/_services/whatsapp-followup.ts` (`planFollowups`), 25
    testes. **"Resposta de gente" = `whatsapp_messages.sent_by NOT NULL`**
    — a IA grava NULL; é o único discriminador que existe.
    - **Correção junto (importante):** `whatsapp_ai_state.enabled` era
      NOT NULL DEFAULT false, mas várias escritas criam a linha de raspão
      (`registrarDecisao`, marca de follow-up) — cada uma DESLIGAVA a IA
      naquela conversa sem ninguém pedir (invisível só porque o padrão
      global também é off). Agora **NULL = "nunca decidido" → vale o
      padrão global**; a wave faz backfill (`enabled=false` sem PARE volta
      pra NULL). Servidor (`isAiEnabledFor`) e portal (`iaLigada`) checam
      `typeof enabled === 'boolean'`. **Nunca escrever `enabled` em
      upsert que não seja a chave de propósito.**
  - Portal (v=20260829n): chave "IA ligada/desligada" por conversa +
    botão "💬 Auto-resposta ligada/desligada" (mensagem de ausência) +
    botão "🔁 Follow-up ligado/desligado" + "👀 Simular follow-up" (dryRun, mostra o
    que a varredura FARIA sem enviar) + "▶ Rodar follow-up agora" + linha com a última
    varredura (`last_sweep_at`/`last_sweep_note`) +
    botão 🕐 "Só horário comercial ⟷ Responde 24h" + faixa de alertas
    com "Abrir conversa" + botão "✨ Sugerir" (copiloto: rota
    `/api/whatsapp-evo/suggest`, ignora horário e teto porque quem pediu
    foi uma pessoa; travas de preço seguem valendo). Embaixo da chave, a
    ÚLTIMA DECISÃO da IA naquela conversa (`last_why`) — silêncio da IA
    deixa de ser caça ao fantasma. Nome do contato resolve por 3 fontes:
    usuário do app > lead > pushName do WhatsApp. **NÃO LIDAS
    (2026-08-29):** contador de mensagens recebidas na lista de conversas
    + badge total no menu lateral. Marca em
    `whatsapp_ai_state.last_read_at` (banco, não localStorage — vale em
    qualquer computador); **resposta da IA NÃO zera** — só o operador
    abrir a conversa. `loadWaBadge` no root (realtime + poll 45s + evento
    `wa-lidas-mudou`) é separado do `loadBadges` (caro e quase estático);
    por isso `loadBadges` MESCLA o state em vez de substituir. Componente
    `Ajuda`
    (o "?" ao lado dos botões, abre no hover E no clique pra funcionar em
    tablet) explica cada controle da barra — conteúdo em
    `AJUDA_WHATSAPP`; **botão novo ali = item novo nessa lista**.
  - **Próximas fases (não feitas):** classificação automática do lead
    pela IA (temperatura/resumo) e os funis de PROs e Clientes — a
    máquina foi construída pra ser reaproveitada trocando roteiro e
    público.

- **Foto do seletor do wrapper vem SEM MIME TYPE (2026-09-01).** "Trocar
  foto" morria com "Selecione um arquivo de imagem" — na cara de quem
  tinha selecionado exatamente isso. O seletor do WebIntoApp **não é a
  galeria do sistema**: é um diálogo próprio, **"Files Chooser"
  (Camera × Files)**, e pelo ramo Files o `File` volta com `type` VAZIO ou
  `application/octet-stream` (o content:// provider não declarou o tipo).
  Pelo Chrome o mesmo arquivo vem `image/jpeg` — daí o clássico "no
  navegador funciona".
  - **REGRA MAIS IMPORTANTE: recusar só com PROVA.** "Não provei que é
    imagem" ≠ "provei que NÃO é". A 1ª regra punia a pessoa pela omissão do
    Android e foi o que travou a troca de foto. Use `provadoNaoImagem`
    (false quando ninguém identificou → passa; o Storage dá a palavra
    final). Extensões de não-mídia (.pdf/.csv/…) estão no mapa DE PROPÓSITO:
    servem pra recusar com prova e pro certificado em PDF subir certo.
  - **Mensagem de erro tem que carregar a EVIDÊNCIA** (`descreverArquivo`).
    Em 01/09 a mensagem antiga e a nova eram a mesma frase e não deu pra
    saber qual código rodava no aparelho — um dia perdido em adivinhação.
  - **REGRA: nunca validar mídia por `file.type` sozinho.**
    `lib/utils/mediaType.ts` decide em TRÊS degraus, nesta ordem: tipo
    declarado → **extensão** do nome → **bytes** do arquivo (magic numbers).
    O 3º degrau existe porque alguns content providers do Android devolvem
    nome SEM extensão (um id puro) — aí só o conteúdo responde; `ftyp`
    precisa da MARCA no offset 8 pra separar HEIC de MP4. Caminho novo que
    aceita arquivo escolhido pela pessoa = `await normalizarArquivo(file)`
    ANTES de `ehImagem`/`ehVideo`, nunca `startsWith('image/')`.
  - **A varredura de 01/09 achou 6 caminhos além do avatar** — todos
    derivavam `contentType` de `file.type` vazio, e dois RECUSAVAM o
    arquivo: `chat-attachments` ("Tipo de arquivo não permitido" ao mandar
    foto no chat) e `artReferences` ("Formato não suportado", + extensão
    sempre .jpg). Também `stories`, `aiLogo`, `QualsSection` (PDF virava
    image/jpeg) e `posts.uploadMedia`, que chutava `image/jpeg` pra toda
    imagem sem tipo — acertava .jpg por sorte e etiquetava png/webp/heic
    errado. **Em `uploadMedia` o fallback `image/jpeg` FICA de propósito**
    pro caso sem nenhuma das três pistas: recusar quebraria justamente o
    fluxo que isso conserta.
  - **Corrigir o `type` não é cosmético:** os buckets têm
    `allowed_mime_types`, então subir como octet-stream seria recusado pelo
    **Storage** mesmo depois de passar pela validação da tela. Por isso o
    helper devolve o File com o tipo certo, e os 8 pontos de entrada
    (avatar, logo, publicar, cadastro passo 2, arte-ig, aiLogo, aiArt,
    dimensões) passam por ele.
  - **O aviso "A galeria não abriu" era FALSO POSITIVO** nesse wrapper: o
    "Files Chooser" é um DIÁLOGO do próprio app, e diálogo **não tira o
    foco da página** — o relógio de 1,8s do `filePickerWatch` estourava
    enquanto a pessoa ainda lia Camera × Files. Agora a espera padrão é
    **8s** (`PADRAO_ESPERA_MS`) e, se o app sair DEPOIS do aviso, ele é
    **retirado da tela** (`onAbriuAtrasado`) e a marca de recuperação volta
    a valer. **Aviso errado ensina a ignorar o aviso certo.**

- **"500 | Server Error" ao APAGAR E ACENDER a tela (2026-09-01).** Relato:
  app aberto, apaga a tela do celular, acende — vem 500, e **fica assim até
  reiniciar o app**. Mecanismo: com a tela apagada o Android mata o processo
  do **RENDERIZADOR** da WebView (não o app); ao voltar, a WebView recria o
  renderizador e **RE-NAVEGA** pra URL atual. Se essa navegação pega um
  soluço do edge, vem 500 — e a página interna do Next não tem UMA LINHA de
  JS nosso: nem SW, nem boundary, nem retry. Uma lápide. Por isso só saía
  reiniciando: **nada mais navegava**.
  - **`pages/500.tsx`** substitui aquela página e se recupera sozinha
    (mesmo freio do `autoRetry`: 2,5s + n·1,5s, teto 6 em 2min, reload no
    evento `online`). O retry é `<script>` INLINE, não `useEffect`: se a
    pessoa vê essa tela, o servidor acabou de falhar — apostar que os
    chunks vão baixar e hidratar é apostar no que está quebrado.
  - **Por que em `pages/` num app App Router:** `error.tsx` e
    `global-error.tsx` só pegam erro de RENDER do React. Falha ABAIXO disso
    (carga de módulo, roteamento, soluço da function) nunca chega neles — e
    é essa que produz a tela. `pages/500` é o único ponto de override.
  - **PEGADINHA: criar `pages/` MUDA A TIPAGEM GLOBAL.** `useSearchParams()`
    passa a ser anulável e o build quebra em quem não trata (era
    `LoginForm.tsx`). **`npx tsc --noEmit` NÃO pega isso** — só o
    `next build`, que usa os tipos gerados em `.next/types`. Rodar
    `next build` de verdade antes de publicar mudança estrutural.
  - **Causa raiz provável do 500, corrigida junto:** `lib/api/env-check.ts`
    lia `process.env` DIRETO e era chamado no **MODULE-LOAD** de
    `security.ts` — as duas coisas que este arquivo proíbe. No edge os
    secrets não estão em `process.env`, e `process.env[k]` com `k` variável
    nem é substituído no build (só a forma literal). Ou seja: a lista podia
    sair TODA "ausente" e o throw derrubar a CARGA DO MÓDULO com as envs
    perfeitamente configuradas — o que o Next devolve como 500 puro. Agora
    lê por `getRuntimeEnv` e **não roda mais no boot**; o fail-closed que
    importa (CRIT-5) já é por request em `requirePro`/`gateAiUsage`.
  - **Continua sem prova de qual dos dois disparou** — falta saber se o SW
    controla a página na WebView. **`/diag` já responde isso** (linha
    "Service Worker controlando a página"): abrir no app instalado.

- **"500 | Server Error" CRU no app instalado — o SW NÃO está no comando
  (2026-09-01, EM ABERTO).** O `sw.js` v5 prova por construção que 5xx
  nunca vai cru pra tela em navegação de documento (troca pela página
  "Reconectando…" com auto-retry). A tela crua apareceu mesmo assim → **o
  service worker não controlava aquela navegação** no app empacotado. Os
  boundaries do React também não renderizaram (`error.tsx` e
  `global-error.tsx` existem e têm auto-retry), logo a falha é da própria
  function do edge, **abaixo do render do Next** — e o `middleware.ts` está
  fora (só casa `/api/*`).
  - **Estamos CEGOS nisso:** a telemetria `sw-nav-5xx` só dispara com o SW
    no comando, que é justamente o que falta. O `ServiceWorkerRegister`
    engole falha de registro num `.catch()` vazio, e o ping com o campo
    `sw=` foi removido em 30/08. **Próximo passo: telemetria de
    registro/controle do SW antes de qualquer palpite sobre a causa do
    500.** Não escrever correção especulativa antes disso.

- **CAUSA DO "500 | Server Error" FECHADA (2026-09-01) — era o payload
  RSC, não a navegação.** O `/diag` do usuário no app instalado entregou o
  dado que faltava: **"Service Worker controlando a página: sim"**. Com o SW
  no comando, o `sw.js` v5 tornava impossível um 5xx cru chegar na tela em
  navegação de DOCUMENTO — logo, não era navegação de documento.
  - **O que era:** o 5xx vinha no fetch do **payload RSC**. O SW devolvia
    esse 500 CRU pro router, apostando que "o router trata" fazendo
    hard-nav. Não trata: o runtime do Next pinta a PRÓPRIA tela de erro (a
    marcação `next-error-h1` está no bundle do cliente, `main-*.js`). Como
    não houve navegação de documento, nenhuma defesa do SW rodou; e como não
    é erro de render, `error.tsx`/`global-error.tsx` também não pegaram.
    Uma lápide que só saía reiniciando o app.
  - **Correção (sw.js v6):** 5xx de RSC recebe o MESMO tratamento da rede
    morta — 503 sem corpo, que é o caminho comprovado: o router descarta,
    faz hard-nav, a navegação volta como documento e ganha a página
    "Reconectando…" com auto-retry. Incidente logado como `sw-nav-5xx` com
    sufixo `(rsc)`.
  - **O teste TROCOU DE LADO** — antes exigia o 5xx cru "porque o router
    trata". Teste que codifica uma suposição errada protege o bug.
  - **Lição de método:** `pages/500.tsx` e `pages/_error.tsx` foram DUAS
    tentativas erradas seguidas, ambas escritas antes de eu ter evidência.
    O que fechou o caso foi procurar a string no output publicado
    (`.vercel/output/static`) e pedir UM dado do aparelho. As duas páginas
    ficam — cobrem o erro de servidor de verdade —, mas não eram isto.

- **O 500 do App Router NÃO passa por `pages/500` nem por `pages/_error`
  (2026-09-01, PROVADO).** Duas tentativas minhas falharam pela MESMA razão,
  e só a evidência fechou a questão. No output publicado
  (`.vercel/output/static`): o `500.html` é a minha tela ("Reconectando…",
  sem `next-error-h1`), mas a marcação da tela padrão do Next
  (`next-error-h1`) vive dentro do **worker**
  (`_worker.js/__next-on-pages-dist__/webpack/*.js`) — ou seja, quem
  responde é o runtime do Next DENTRO do worker, em rota de App Router, e
  ali os arquivos do Pages Router não são consultados. `error.tsx` e
  `global-error.tsx` também não pegam, porque a falha não é de render.
  - **Não escrever uma 3ª tentativa às cegas.** Restam dois caminhos, e a
    escolha depende de UM dado: o service worker controla a página no app?
    Se controla, o `sw.js` v5 já resolve (troca 5xx pela tela de reconexão)
    e o bug é outro; se não controla, a única interceptação possível é
    embrulhar o `_worker.js` gerado num passo pós-build — o que amarra o
    deploy a um script nosso e precisa ser decidido com o usuário.
  - O dado chega sozinho: `sw-status` no `/admin/errors` (1 linha por
    aparelho por dia) ou o link "Diagnóstico do aparelho" no rodapé do
    perfil.

- **Story: o X existia, mas ficava POR BAIXO das barras do app
  (2026-09-01).** O relato foi "não tem um X pra fechar?". Tinha — só que o
  `StoryViewer` era `fixed inset-0 z-50` e a **BottomNav é `z-[300]`**, a
  TopNav `z-50`. As barras de progresso (`top-2`) e o botão de fechar
  (`top-6`) nasciam atrás delas. O `fixed inset-0` sempre cobriu a tela
  toda; o que faltava era z-index. Agora **`z-[400]`**, o story fica
  imersivo (as barras do app somem enquanto ele está aberto, como no
  Instagram), o viewer é montado em **portal no `<body>`** (o z-index
  sozinho bastaria hoje, mas basta um ancestral ganhar `transform` pra o
  `fixed` deixar de cobrir a tela) e o X virou alvo de 40px com fundo
  próprio — antes era um `×`
  de texto solto, invisível sobre story claro. Progresso e header respeitam
  `env(safe-area-inset-top)`.
  - **Botão VOLTAR do Android fecha o story.** Ao abrir, o viewer empurra
    uma entrada no histórico; o "voltar" consome ela e dispara `popstate`,
    que fecha sem navegar. Fechando pelo X ou pelo arrasto, a entrada
    fantasma é desfeita na limpeza — senão o próximo "voltar" não sairia da
    tela, só apagaria a sobra. `onClose` fica numa ref pra o efeito não
    rearmar e empilhar uma entrada por render.
  - **PLAY gigante no vídeo:** a WebView bloqueia `autoPlay` até haver gesto
    (`setMediaPlaybackRequiresUserGesture` é true por padrão no wrapper) e o
    player nativo desenha o botão. Correção em dois tempos: `play()`
    explícito quando o story entra em cena (aproveita o gesto que abriu o
    viewer) + `poster` 1×1 transparente, pra que o intervalo até o primeiro
    quadro fique preto em vez de exibir a arte do player.

- **Auditoria 2 (2026-09-01) — A1..A4 corrigidos.**
  - **A1: o selo PRO mentia pra quem venceu.** Havia DUAS fontes de verdade:
    o `TopNav` dizia PRO com `is_pro=true` sozinho, enquanto
    `canSeeProFeature` (o portão real, usado em Agenda/CRM/Anotações) exige
    `is_pro=true` **E** data futura quando há data. E **nada limpa `is_pro`
    no vencimento** — não há cron nem trigger, e o portal ativa PRO gravando
    `is_pro=true` + expiração. Ou seja, "is_pro com data vencida" é estado
    PERMANENTE: a pessoa via PRO na barra e levava "exclusivo do Plano PRO"
    em toda ferramenta. O `TopNav` agora usa `usePolicyUser` +
    `canSeeProFeature`/`isAdmin`. **REGRA: selo e portão perguntam à mesma
    função.** (Há uma 3ª implementação no banco, `is_pro_active`.)
  - **A2: "hoje" saía do fuso do APARELHO.** O patch de fuso do `layout.tsx`
    cobre só `toLocale{Date,Time,}String` — **`getTimezoneOffset()` passa
    direto**, e era ele que decidia o dia em 5 lugares. O Brasil tem mais de
    um fuso (Manaus, UTC−4): entre meia-noite e 1h o aparelho diz um dia e
    Brasília já está no seguinte. Deslocava o destaque de "hoje" na agenda,
    o recorte do dia no Financeiro e a data de follow-up do pipeline.
    Helpers novos em `utils.ts`: **`ymdBrt()`** (que dia é hoje em Brasília,
    via `Intl` com `timeZone` — não depende do patch, que mexe só em
    `Date.prototype`) e **`ymdDeCampos()`** (formata um Date montado a
    partir de ano/mês/dia, como os limites de mês do grid — ali passar por
    fuso é que introduziria deslocamento). `agYmd` virou apelido depreciado.
    **Nada de acesso depende disso** — os 4 usos são de tela/data, nenhum em
    auth, RLS ou rota de API. Pra quem está FORA do Brasil o efeito é o
    pretendido pela regra do projeto: "hoje" passa a ser o mesmo dia que as
    datas já exibidas na tela (antes o destaque vinha do celular e o resto de
    Brasília — inconsistentes entre si). `ymdBrt` tem fallback: se o `Intl`
    falhar (WebView sem ICU completo), cai no fuso do aparelho em vez de
    devolver `"--"`, que a coluna `date` do Postgres recusaria — o Financeiro
    grava a data direto dali. Suíte verde em São Paulo, Manaus, UTC, Tóquio,
    Los Angeles e Lisboa.
  - A3 (legenda/comentário sem `overflowWrap` — palavra longa era cortada
    pelo `overflow-x: hidden` do AppShell; comentário precisou de
    `minWidth: 0` por ser flex item) e A4 (`cartTotal` somava float e
    gravava 269.70000000000005 no pedido; agora soma em centavos).
  - **Descartado após verificar:** rotas "sem gate" (autenticam uma camada
    abaixo, no service) e 97 "botões sem `aria-label`" (regex meu estava
    errado; as amostras têm texto ou o atributo em linha seguinte).

- **A página 500 do Next tem DOIS caminhos — cobrir só um não adianta
  (2026-09-01).** Criei `pages/500.tsx`, confirmei no build que a tela nova
  estava lá dentro (`grep Reconectando .next/server/pages/500.html`) e o
  aparelho SEGUIU recebendo o "500 | Server Error" cru. Motivo: `500.tsx`
  cobre a 500 **estática**; erro em **runtime** cai no **`pages/_error.tsx`**,
  que continuava sendo o padrão do Next. Os dois agora renderizam
  `components/TelaReconectando` (auto-retry inline). O `_error` trata 404 à
  parte — recarregar sozinho uma página que não existe só repetiria o "não
  existe". **Conferir `.next/server/pages/_error.js`, não só o `500.html`.**

- **Auditoria 2026-09-01 — 9 achados corrigidos (P1..P9).** Os que valem
  virar regra:
  - **P1 (o mais grave): `parseBRL` multiplicava por 100.** Apagava TODO
    ponto como milhar antes de trocar a vírgula: `"1500.50"` → 150050,
    `"0.99"` → 99, e até `parseBRL(1500.5)` → 15005 (número passava por
    `String()`). O campo de preço usa `inputMode="decimal"` e o teclado do
    Android oferece PONTO — era o caminho comum, não caso de canto.
    Atingia preço de arte à venda, Financeiro, Agenda e o `brlSchema`. Pior:
    os comentários em `utils.ts` e `schemas.ts` JÁ AFIRMAVAM aceitar
    `"1500.50"`. **Regra nova: vírgula sempre é decimal; ponto é decimal com
    1-2 casas (ou parte inteira zerada) e milhar com 3.** 7 testes novos —
    o antigo só cobria `"1.500,50"`, vazio e o inteiro `42`.
  - **P3: busca aproximada NUNCA decide destinatário de mensagem.**
    `resolveCalicolorsUserId` caía em `.ilike('name','%cali%').limit(1)` sem
    `order` — casava com Calixto/Micaeli/Carlos Calisto e escolhia de forma
    não-determinística. Esse id abre a conversa "🎨 Loja": dava pra mandar
    pra um estranho. Agora só igualdade exata (tags conhecidas → nome
    exato), e **erro do Supabase não é mais lido como "não existe"**.
  - **P2 foi FALSO ALARME e a lição é essa.** `linkUrl` faltava nas deps do
    `useCallback` de submit, mas não causava bug: `autosave` também está nas
    deps e o `useAutosave` devolve **objeto novo a cada render**, então o
    callback era recriado sempre. A correção do link dependia de um acidente
    em outra dependência — estabilizar o retorno do `useAutosave` (o certo
    pra perf) reintroduziria o bug em silêncio. **Só confirmei porque o
    teste de regressão passou SEM o fix.** Teste que não falha sem a
    correção não é teste de regressão.
  - **P4/P5: `catch {}` mudo esconde bug por meses.** O upload da foto no
    CADASTRO falhava em silêncio (nem toast, nem `/admin/errors`) — foi o
    que escondeu o bug de MIME em todo cadastro novo. O perfil público
    engolia falha de quals/cursos/avaliações e renderizava **vazio**: pintor
    com 20 avaliações aparecia sem nenhuma, na tela onde o cliente decide
    contratar. Os `.catch` individuais dentro de `Promise.all` também
    precisam marcar a falha.
  - P6 (`linkUrl`/`artType` não limpos após publicar), P7 (regressão minha:
    `armarSelecao` sem cancelar no unmount deixava ouvintes vivos e marca no
    localStorage → aviso falso "o app reiniciou"), P8 (`??` não é fallback
    pra efeito colateral: `handler?.(err) ?? console.warn(...)` logava
    sempre) e P9 (pílulas `bg-gray-100` sem inversão no dark).
  - **`eslint.ignoreDuringBuilds: true`** no `next.config.mjs`: os ~17
    avisos do linter nunca aparecem no deploy. Rodar `next lint` na mão.

- **57 leituras de `process.env` cruas corrigidas (2026-09-01).** A regra de
  22/08 ("ler sempre por `getRuntimeEnv()`, nunca `process.env` direto")
  estava sendo violada em **38 arquivos**: toda a camada de IA (legenda,
  transcrição, TTS, moderação, análise financeira, OCR, arte-IG, resolver
  cor, as 4 personas) e os pagamentos (`checkout`, `mp-webhook`), além do
  `/api/health` — que por isso podia reportar saúde errada. No edge do
  Cloudflare esses secrets não estão em `process.env`, então ou essas
  funções estavam quebradas em produção, ou a regra é mais forte do que
  precisa ser — a conversão é segura nos dois casos, porque `getRuntimeEnv`
  tenta o contexto da request e CAI PRO `process.env`.
  - **Teste de arquitetura novo** (`__tests__/lib/env-runtime-rule.test.ts`)
    varre `lib/api` e `app/api` e falha se a leitura crua voltar. Regra que
    ninguém verifica é sugestão.
  - Verificado no worker REAL (`wrangler pages dev .vercel/output/static`):
    `/api/health` responde `supabase: true` e as rotas seguem de pé.

- **Carrossel de fotos no post — Wave 57 (2026-09-01) — JÁ EXECUTADA no
  Supabase (2026-09-01). Não pedir pra rodar de novo.** O
  composer sempre deixou escolher **até 5 fotos**, subia TODAS pro bucket
  `posts` e gravava **só a primeira** em `posts.media_url` — as outras
  quatro viravam arquivo órfão, pagas em banda e storage, invisíveis. O
  próprio tipo já dizia: `mediaUrls: string[]; // resto ignorado`.
  - `/migrations/2026-09-01-posts-media-urls.sql`: **uma linha**
    (`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_urls text[]`) — curta
    de propósito, porque colar SQL grande pelo celular corta o bloco.
  - **Post ANTIGO não ganha carrossel**: as fotos extras dele foram
    descartadas no ato da publicação (nunca chegaram a `media_url` nem a
    lugar nenhum consultável), então só post novo tem o conjunto. Os
    arquivos órfãos velhos seguem no bucket — `cleanup_orphan_media()` os
    lista como órfãos, e quem apaga é `execute_cleanup_orphan_media()` na
    mão.
  - **`media_url` NÃO muda de papel**: segue sendo a primeira foto, e é o
    que o RPC `get_feed_v2`, o grid do perfil e todo post antigo leem. Foi o
    que permitiu **não recriar a `get_feed_v2`** (bloco grande, arriscado no
    aparelho): o feed busca as extras numa consulta leve à parte
    (`anexarFotosExtras`), que só traz os posts com mais de uma foto.
  - **`createPost` tolera 42703**: se a migration ainda não rodou, o insert
    é refeito sem `media_urls` e o post sai com a primeira foto. Publicar
    não pode quebrar por causa de SQL pendente — foi exatamente o que
    aconteceu com `quotes.post_id` e `leads.city`.
  - `PostCarousel` usa **scroll-snap**, não arrasto por JS: o gesto fica com
    o navegador (inércia e encaixe nativos) e não briga com o scroll
    vertical do feed — `overscrollBehaviorX: 'contain'` corta o
    encadeamento. Contador `1/5` no canto e bolinhas clicáveis. Só a
    PRIMEIRA foto usa `media_width/height` gravados; aplicar nas outras
    reservaria o espaço errado e causaria salto.

- **Story com SOM (2026-09-01).** O `<video muted>` era fixo — `muted` é o
  que a WebView exige pra tocar SEM gesto, então todo story rodava mudo. Mas
  ali existe gesto (um toque abriu o viewer): agora tenta com áudio e, se o
  aparelho recusar o `play()`, cai pra mudo e acende o botão 🔊/🔇 no
  cabeçalho, em vez de deixar o vídeo parado com o PLAY gigante.

- **Story virou só a mídia (2026-09-01, decisão da loja).** Sem legenda e
  sem link "ver mais": é conteúdo que some em 24h, e pedir texto só atrasa
  quem quer postar a foto da obra e seguir trabalhando. O payload vai com
  `caption: ''` e `linkUrl: null` — sem isso um rascunho antigo restaurado
  pelo autosave mandaria texto que a pessoa não tem mais como ver nem
  editar. A coluna `posts.link_url` e o CTA do `StoryViewer` continuam
  existindo pros stories antigos; só não há mais como criar novos. A aba
  "Foto / Vídeo" passou a se chamar **"Post"**.

- **A galeria ABRE, mas o app MORRE no meio da escolha (2026-09-01).** O
  AAB de 31/08 resolveu o `onShowFileChooser` — o seletor aparece
  (confirmado no aparelho do Bruno). Só que apareceu o problema seguinte:
  ele toca na foto e **o app volta pra tela inicial**, sem foto e sem
  legenda. Não é permissão: o seletor de fotos é OUTRA activity, pesada de
  memória; o Android encerra o processo do app que ficou atrás; na volta o
  wrapper recria tudo e carrega a **URL inicial**, e o `ValueCallback` que
  receberia o arquivo morreu junto.
  - **Nenhum código web impede isso** — a correção de raiz é do WebIntoApp
    (`ValueCallback` + `WebView.saveState()/restoreState()` na recriação da
    activity; `docs/AAB_PROXIMA_VERSAO.md` §1.1b). O que o app faz é não
    deixar a pessoa no escuro: `lib/utils/pickerRecovery.ts` grava uma marca
    em **localStorage** (sobrevive à morte do processo; `sessionStorage`
    NÃO — WebView nova nasce com ele vazio) antes de abrir o seletor e a
    apaga em TODO final normal (arquivo chegou / cancelou / nem abriu).
    Marca sobrevivendo num documento recém-carregado = aquele documento
    morreu com a escolha pendente.
  - `components/PickerRecovery.tsx` (montado no `AppShell`) leva de volta
    pra rota da marca; quem **consome** a marca é a tela dona dela (filtro
    por `ctx`), porque só ela sabe o que fazer com a foto. Se o boot
    consumisse, o app navegaria em silêncio e ninguém entenderia nada.
  - Janela de 5min: escolher foto leva segundos. Fora dela é sessão nova, e
    avisar seria mentira. **Só arma no Android** (mesmo gate `ehAndroid` do
    `filePickerWatch`, agora exportado — se os dois divergirem, uma tela
    marca e a outra não limpa).
  - A **câmera é imune** (`getUserMedia` roda na própria página, não sai pra
    outra activity) — por isso o `GaleriaBloqueadaSheet` segue sendo a
    saída, agora com título/texto por prop: dizer "a galeria não abriu"
    aqui seria mentira, ela abriu.
  - `Composer` grava o rascunho NO GESTO que abre o seletor
    (`onAntesDeAbrir` → `writeDraft`): o autosave é throttled em 5s e quem
    digita e toca em seguida perderia o texto junto com a foto.
  - Telemetria nova: `picker-restart` no `/admin/errors`.
  - **Permissões (conferido em 01/09):** Câmera concedida e com uso real
    registrado → o wrapper implementa `onPermissionRequest`. Fotos/mídia
    **não aparece** na lista → o toggle de storage provavelmente gerou a
    antiga `READ_EXTERNAL_STORAGE`, ignorada no Android 13+. Não bloqueia o
    seletor (ele entrega o arquivo por Intent).

- **App instalado NÃO ABRE A GALERIA — a saída pela CÂMERA (2026-08-30).**
  Voltou em 30/08 com DOIS pintores (Bruno Valentim e Leo): não trocam a
  foto de perfil nem publicam portfólio. Causa é a mesma de 29/08 e não é
  código nosso: as duas telas usam o mesmo `<input type="file">` e a
  WebView do WebIntoApp só abre a galeria se o wrapper implementar
  `onShowFileChooser` + permissões de mídia. Sem isso o toque **não faz
  nada** — sem erro, sem log. **Correção de raiz continua no painel do
  WebIntoApp** (`docs/AAB_PROXIMA_VERSAO.md` §1.1).
  - **O que mudou agora: o beco virou saída.** `filePickerWatch` (relógio
    de 1,8s; se a página não perdeu o foco, o seletor não abriu) deixou de
    mostrar um toast vermelho — o toast some em 3s, manda DIGITAR
    "queroumacor.com.br" e não resolve nada. No lugar entra o
    `components/GaleriaBloqueadaSheet` com duas saídas: **📷 tirar foto
    agora** (`components/CameraCapture.tsx` — `getUserMedia` + canvas
    geram o File na mão, sem passar pelo seletor) e **🌐 abrir no
    navegador** (`lib/utils/openInBrowser.ts`: URL `intent:` com
    `action=VIEW`, que é o que a WebView entende como "sair pro Chrome";
    `window.open` dentro dela abre outra tela do próprio app). Se nem o
    intent abrir, copia o link.
  - O botão de câmera também aparece **sem precisar falhar antes**: ao
    lado de "Trocar foto" (`/perfil/editar`), embaixo do dropzone de
    `/publicar` e no passo 2 do cadastro. Só em tela de toque com câmera
    (`ofereceCamera`) — no desktop o seletor funciona e o botão só poluiria.
  - **A câmera na WebView é a MESMA classe de dependência** (o wrapper
    precisa responder `onPermissionRequest` + `android.permission.CAMERA`):
    pode falhar também. A diferença é que ela falha **visível** — a
    promessa rejeita, a tela diz o que fazer e o `/admin/errors` recebe
    `camera-fail`. Também tem TETO DE TEMPO de 12s no `getUserMedia`: em
    WebView promessa pendurada não rejeita (mesma lição do `getSession`).
  - **Bug real achado junto — o aviso DUPLICADO da foto do pintor.** O
    `inputRef.click()` do `MediaUploader` sobe (bubbling) até a div do
    dropzone, que tem `onClick={handleSelect}`: um toque armava DOIS
    relógios e mostrava a mensagem duas vezes (a segunda chamada de
    `click()` é barrada pelo próprio browser, então parava em 2). Corrigido
    com `stopPropagation` no input + cancelar o relógio anterior antes de
    armar outro. Teste de regressão em
    `__tests__/components/MediaUploaderPicker.test.tsx` (falha sem o fix).
  - Foto tirada aqui sai no máximo com 1600px no lado maior e JPEG 0.9 —
    foto crua de celular passa dos 5MB do avatar.

- **Conta NOVA barrada de publicar: sessão diz "e-mail não confirmado"
  (2026-08-29).** `getSession()` devolve o usuário GUARDADO no
  localStorage, **não** o do servidor. Quem confirma o e-mail FORA do app
  (abre o link no Chrome ou no app de e-mail) fica com uma cópia dizendo
  não-confirmado → `usePublishPost` barra com "Confirme seu email antes de
  publicar" e a faixa amarela não sai. O snapshot só se atualiza no refresh
  do token (1h), que **no WebView quase nunca acontece** (o app é morto e
  restaurado antes). Por isso só pega conta nova — as antigas já
  refrescaram alguma vez. Agora, e SÓ quando a cópia local diz
  não-confirmado, o `AuthProvider` chama `getUser()` (servidor, mesma
  corrida contra `SESSION_TIMEOUT_MS`) e adota o usuário fresco.
  - **Falha capturada NÃO chega no `/admin/errors`** — só erro não
    capturado chega. O catch do avatar vira toast e o erro do publish vira
    faixa vermelha; os dois morrem na tela. Concluir "a tabela `errors`
    está vazia, logo não houve falha" é **errado**. `lib/utils/
    reportFailure.ts` (best-effort, nunca lança) manda
    `type='avatar-fail'` e `'publish-fail'` com `user_id`, mensagem, UA e
    URL. **Fluxo novo que engole erro em catch = chamar `reportFailure`.**

- **NÃO LIDAS nos Chats 3-Way (2026-08-29, v=20260829y, Wave 51 — JÁ
  EXECUTADA no Supabase em 2026-08-29; não pedir pra rodar de novo).** O
  número da conversa era `conv.messages.length` (total da
  conversa) e o do menu era o COUNT de `messages` inteiro — o famoso "23".
  Nenhum dos dois baixava ao abrir. Agora vale a marca em
  `portal_chat_reads` (`/migrations/2026-08-29-portal-chat-reads.sql`),
  separada de propósito de `messages.read_at`, que é do APP: se a loja
  escrevesse ali, apagaria o não-lido de quem é o destinatário de verdade.
  Não conta o que o próprio operador mandou; abrir a conversa zera; chegou
  mensagem com a conversa aberta, já entra lida. O badge do menu passou pro
  `loadWaBadge` (agora calcula WhatsApp + chats) e saiu do `loadBadges`.

- **Foto de produto no portal (2026-08-29, v=20260829x).** Dois bugs
  empilhados: (1) o handler chamava `setAiBusy`, que **não existe** nesse
  componente — sobra de copy/paste; ele estourava na PRIMEIRA linha do
  try, então o upload nunca acontecia (o alerta "setAiBusy is not
  defined" era o próprio bug); (2) atrás dele, o path era
  `products/<arquivo>`, e a **Wave 27 exige que o path no bucket `posts`
  comece no `auth.uid()`** — a RLS teria recusado assim que o (1) fosse
  corrigido. Agora sobe em `<uid>/products/<arquivo>`, com validação de
  tipo/tamanho e "Enviando…". **Wave 50** (`/migrations/
  2026-08-29-cleanup-preserva-foto-produto.sql`) — **JÁ EXECUTADA no
  Supabase (2026-08-29), não pedir pra rodar de novo** — ensina
  `cleanup_orphan_media()` a poupar `products.image_url`; sem ela a foto
  entraria na lista de órfãos em 7 dias (o cron só LISTA; quem apaga é
  `execute_cleanup_orphan_media()` na mão, então era mina desarmada).

- **Compartilhar PDF de orçamento NO APP INSTALADO (2026-08-29).** A
  WebView do wrapper não expõe `navigator.share`, então anexar o ARQUIVO
  é impossível pelo lado web — o botão caía no download e o pintor tinha
  que achar o PDF em Downloads e anexar na mão. Agora
  `shareOrDownloadPdfBlob` aceita `whatsapp?: {text, phone}` e, no
  WebView, sobe o PDF pro bucket `exports` e abre o **wa.me com o LINK**
  (já na conversa do cliente quando há telefone) — mesmo mecanismo do
  botão de WhatsApp que já funciona ali. Ordem: share sheet nativo >
  link por WhatsApp (app) > download (desktop). Retorno virou
  `ShareResult` com `'shared-link'`. `window.open` pode ser bloqueado
  (o await do upload sai do gesto do toque) → cai pra
  `window.location.href`. **Anexo de arquivo de verdade só com build
  nativo** (Capacitor Share plugin) — não sai por código web.

- **"Trocar foto" do perfil não salvava (2026-08-29).** A pessoa escolhia
  a foto, via a cara nova na tela, saía e nada tinha mudado — sem
  mensagem, porque de fato nada acontecia: o avatar só virava PREVIEW
  (`createObjectURL`) e o upload esperava o submit lá no fim da página.
  Pior: o **logo do negócio, no MESMO formulário, já salvava sozinho** —
  dois controles vizinhos com comportamentos opostos. Agora o avatar sobe
  na hora (`uploadAvatar` → `update({avatar_url})` → toast), igual ao logo.
  - **Bug 2, o que escondia o primeiro:** `handleSubmit(onSubmit)` sem
    `onInvalid`. Perfil antigo com cidade/UF/telefone vazio reprovava na
    validação e o botão "Salvar" **não fazia nada visível** — o erro
    aparecia ao lado do campo, fora da tela. Agora `onInvalid` mostra
    "Falta corrigir: …" e rola até o campo.

- **MÍDIA do WhatsApp no portal (2026-08-29, Wave 49) — SQL JÁ EXECUTADO
  (2026-08-29; o título dizia PENDENTE contradizendo o próprio corpo).**
  Foto, áudio, vídeo e documento chegavam como MARCADOR de texto
  (`[áudio]`, `[imagem]`): o evento do WhatsApp não traz o arquivo, só o
  aviso. Agora `whatsapp-media.ts` pega o base64 (do payload, se o
  Manager estiver com **Webhook Base64** ligado, senão busca em
  `/chat/getBase64FromMediaMessage`), sobe pro bucket PRIVADO
  `whatsapp-media` e grava o PATH em `whatsapp_messages.media_url` (path,
  não URL — assinatura expira). Portal (`BolhaConteudo`) pede URL
  assinada em lote (`createSignedUrls`, 1h) e renderiza foto com lightbox,
  player de áudio, vídeo e link de documento; a lista de conversas mostra
  a transcrição em vez de "[áudio]".
  - **Áudio é transcrito** (Whisper, coluna `transcript`) e **entra no
    histórico que a IA lê** — antes ela respondia no vácuo quando o
    cliente mandava voz. `loadTurns` usa `transcript || body` e descarta
    marcador sem transcrição.
  - Tudo best-effort: falha de download/upload/Whisper não impede a
    mensagem de ser gravada nem derruba o 200 do webhook.
  - **O `readBody` do webhook subiu de 1MB pra 20MB** por causa disso: com
    Base64 ligado o ARQUIVO viaja dentro do JSON e infla ~37%. No limite
    antigo uma foto grande estourava e a mensagem INTEIRA era descartada
    (o catch devolve 200 sem gravar) — a foto da parede sumia do portal.
  - Migration `/migrations/2026-08-29-whatsapp-media.sql` — **JÁ
    EXECUTADA (2026-08-29)** e "Webhook Base64" JÁ LIGADO no Manager.

- **Leads: "Busca AI" REMOVIDO, importador de planilha no lugar
  (2026-08-29, portal v=20260829o).** O botão "✨ Busca AI" NÃO buscava
  nada: mandava o modelo INVENTAR empresas plausíveis (nome, telefone,
  nota, avaliações) e salvava como lead `source='ai_search'`. Telefone
  inventado em formato válido é o telefone de alguém — e com o botão
  "💬 Abordar" ao lado, viram mensagem pra estranho. A base tinha 0
  `ai_search` (os 88 originais são `captacao`), então nada a limpar.
  No lugar entrou **"📥 Importar planilha"** (`ImportarPlanilhaModal`):
  lê CSV (xlsx é ZIP+XML e exigiria biblioteca; o portal não tem
  bundler), **detecta separador `;`/`,`/tab e re-decodifica em
  windows-1252** quando o UTF-8 falha (Excel pt-BR salva ANSI e com
  ponto-e-vírgula — sem isso vem tudo numa coluna ou com acento
  quebrado), casa as colunas sozinho por nome de cabeçalho com correção
  manual, mostra prévia, deduplica pelos 8 últimos dígitos do telefone e
  grava em lotes de 200 com `source='planilha'`.
  - **Importação de 986 leads do Google Maps (2026-08-29)** —
    `/migrations/2026-08-29-import-leads-planilha.sql`. **JÁ IMPORTADOS —
    confirmado pelo usuário em 2026-09-05 ("já importamos esses leads, estão
    no BD"); o portal mostra 1072 leads. Não pedir pra rodar, não listar como
    pendência.**
    - **A anotação anterior dizia "NÃO RODADA, confirmado no banco" e estava
      ERRADA.** A verificação procurou `source='planilha'` e não achou —
      mas a importação aconteceu por outro caminho, ou depois da consulta.
      Ou seja: nem uma verificação pontual imuniza a anotação, porque ela
      envelhece a partir do instante em que foi escrita. Mesmo padrão das 7
      pendências falsas de 2026-09-05. **Quando o usuário disser que algo
      está feito, ele ganha da anotação — ele vê o banco, o arquivo não.** Da planilha de 1000 do usuário (13 telefones repetidos + 1
    sem telefone ficaram fora). Categoria crua do Maps ("Architect",
    "Closed") traduzida pras chaves de `LEAD_PITCH`; segmento vence
    quando a categoria briga com ele; "Região" separada em cidade ×
    bairro (696 linhas traziam o TERMO DE BUSCA, tipo "arquiteto Osasco
    SP", não região); prioridade pela distância (alta = Guarulhos +
    vizinhos 422, media = metropolitana 311, baixa = interior 253).
    `LEAD_PITCH` ganhou a chave **'Engenharia'** (funil `fornece`) — 234
    leads caem nela.
  - **Cabeçalho da tabela de Leads (2026-08-29, v=20260829q):** as setas
    "↕" eram DECORATIVAS — o header era `['NOME ↕', …].map()`. Agora cada
    coluna ordena de verdade (`ThLead`/`ordenarPor`, clique inverte) e tem
    filtro próprio no "▾" (`OpcoesFiltro`): Nome e Telefone por texto,
    Cidade/Segmento/Categoria/Prioridade/Status por lista com contagem,
    Rating por nota mínima. Coluna **CIDADE** nova na tabela (o endereço
    desceu pra linha de baixo do nome). O select "Ordenar" do topo saiu
    (virou redundante) e no lugar entrou "✕ Limpar N filtros", que só
    aparece com filtro ativo. Segmento/Categoria/Status do header escrevem
    nos MESMOS states dos chips do topo — uma fonte de verdade só.
  - **PEGADINHA (2026-08-29): `leads` NÃO tinha `city` nem
    `neighborhood`.** O portal lê `l.neighborhood || l.city` em 4 lugares
    (por isso todo lead mostrava "—" embaixo do nome) e o antigo Busca AI
    também mandava as duas no INSERT — o banco recusava com 42703 e o erro
    era engolido. A migration de importação cria as duas colunas antes de
    inserir. **Conferir o schema real antes de escrever INSERT em `leads`**
    (a lista de colunas do código não bate com a tabela).

- **REGRA: TODO horário do QueroUmaCor é BRASÍLIA (2026-08-28).** App e
  portal exibem sempre `America/Sao_Paulo`, independente do fuso do
  aparelho/computador. Implementado por patch na RAIZ (não em cada
  chamada): script inline no `<head>` do `app/layout.tsx` (app) e no
  `public/portal/index.html` (portal) sobrescreve
  `Date.prototype.toLocale{Date,Time,}String` injetando
  `timeZone:'America/Sao_Paulo'` + locale `pt-BR` por default — quem
  passa `timeZone` explícito continua mandando. Cobre as ~36 chamadas
  existentes e qualquer tela futura de graça. Datas gravadas no banco
  seguem em UTC (correto); a conversão é só de exibição.

- **WhatsApp do PORTAL: Evolution API (2026-08-28) — canal ÚNICO até a
  Meta autenticar.** Evolution API self-hosted (Baileys) em Docker no
  Render FREE (`https://evolution-api-8arv.onrender.com`, Manager em
  `/manager`; dorme ~15min → 1ª request pós-sono até 50s; DB no schema
  `evolution_api` do Supabase). Instância `meu-whatsapp` conectada ao
  número SECUNDÁRIO +55 11 92072-5935 (o oficial +55 11 95976-5031 fica
  reservado pra Cloud API da Meta, que ainda NÃO autenticou). Service
  `lib/api/_services/whatsapp-evo.ts` (config + sendEvolutionText com
  timeout 55s pro cold start + jidToPhone + parseEvolutionWebhook);
  webhook `POST /api/whatsapp-evo/webhook?token=<EVOLUTION_WEBHOOK_TOKEN>`
  (Evolution não assina eventos → segredo na URL; pós-token sempre 200;
  MESSAGES_UPSERT; fromMe→'out'; grupos ignorados; grava na MESMA
  `whatsapp_messages` → aparece em /admin/whatsapp). A rota
  `/api/whatsapp/send` DESPACHA: texto → Evolution quando configurada
  (senão Meta); template → SÓ Meta (503 amigável sem ela). 4 ENVS no CF
  Pages (JÁ CONFIGURADAS em 2026-08-28, confirmadas pelo ping):
  `EVOLUTION_API_URL`,
  `EVOLUTION_API_KEY` (= AUTHENTICATION_API_KEY do Render, secret),
  `EVOLUTION_INSTANCE` (opcional, default meu-whatsapp),
  `EVOLUTION_WEBHOOK_TOKEN` (string aleatória nossa, secret). Depois do
  deploy: configurar a URL do webhook no Manager (Configurations →
  Webhook, evento MESSAGES_UPSERT). 21 testes em
  `__tests__/services/whatsapp-evo.test.ts`.
  - **CAUSA DO "502 Bad gateway" NO ENVIO (2026-08-28, fechada):** era
    número ESTRANGEIRO tratado como BR. O envio usava `normalizeBrPhone`,
    que cola '55' em qualquer coisa com 10-11 dígitos → contato dos EUA
    `16503154274` (+1 650 315-4274) virava `5516503154274`, inexistente;
    o Baileys pendurava tentando resolver o JID e o CF matava a function
    ANTES de qualquer resposta nossa (por isso o 502 cru, com o
    diagnóstico do edge todo verde). Agora o envio usa
    `normalizeWhatsAppTarget` (BR local ganha 55; **11 dígitos só é
    celular BR se o 3º for 9**; 11-15 dígitos em outro formato = DDI
    estrangeiro, passa VERBATIM). `fmtWaPhone` do portal e o "+" (nova
    conversa) seguem a mesma regra. NÃO usar `normalizeBrPhone` no
    caminho da Evolution.
  - **SQL Wave 45 (2026-08-28) — JÁ EXECUTADA no Supabase (2026-08-29).
    Não pedir pra rodar de novo.**
    (`/migrations/2026-08-28-whatsapp-realtime.sql`) Põe
    `whatsapp_messages` na publication `supabase_realtime` (+ REPLICA
    IDENTITY FULL). Sem ela a aba do portal só descobre mensagem nova no
    poll. Com ela: banco AVISA, mensagem entra em ~1s. Realtime respeita
    RLS → só `is_portal_admin()` recebe evento. A tela já está pronta
    (v=20260828m): subscribe em INSERT + poll de 60s como rede de
    segurança + `setMsgs` só troca o array quando MUDOU (matava a
    "piscada" do poll) + auto-scroll só se o operador já estava no fim +
    eco local otimista no envio.
  - **Diagnóstico**: `GET /api/whatsapp-evo/ping` (admin-only) mede
    conectividade + apikey + estado da instância a partir do edge e
    reporta as envs sem vazar segredo. O botão "🔌 Testar conexao" SAIU da
    tela em 2026-08-29 (era ferramenta do 502 do envio, já resolvido) —
    a rota continua no ar, chamar direto com token de admin se precisar.
  - **Render é PAGO desde 2026-08-29 (Starter US$7/mês) — NÃO dorme mais.**
    O plano free dormia com 15min parado e derrubava a conexão do
    WhatsApp junto (o pior efeito; a lentidão de ~50s era só o sintoma
    visível). O keep-alive por cron do GitHub
    (`.github/workflows/keepalive-evolution.yml`) foi **removido**: além
    de nunca ter disparado nenhuma execução AGENDADA, o histórico do
    outro cron `*/10` deste repo (o "Uptime monitor", 1118 runs) mostra
    o que o agendador do GitHub entrega de verdade — 12 a 36min de
    intervalo de dia e **45 a 79min de madrugada**, contra os 15min de
    sono do Render. Ou seja: não resolveria. Não recriar esse workflow.
    O pré-aquecimento do portal (`aquecerEvolution`, v=20260829b) FICA:
    agora só cobre os segundos de reinício pós-deploy do Evolution, e
    `acordarEvolution` virou fallback que praticamente nunca espera
    (TTL de 5min). Mantido também o `SEND_TIMEOUT_MS` de 25s — sem cold
    start, sobra folga.

- **Portal: alterar o PERÍODO do PRO (2026-08-29, v=20260829t).** Antes, quem
  já era PRO só tinha "Remover" — pra esticar ou encurtar o plano era
  desligar e habilitar de novo (perdendo a data atual de vista). Agora o
  `ProBadgeCell` tem um ✏️ ao lado do "até DD/MM/AAAA" que reabre o mesmo
  modal em modo edição. `askProDate(opts)` virou reutilizável
  (`title`/`desc`/`confirmLabel`/`current`/`paid`): mostra a expiração
  vigente, já vem com ela preenchida e tem atalhos **+1 mês / +3 / +6 /
  +1 ano** que somam A PARTIR da data que ainda vale (renovação empilha em
  cima do que sobrou; se já venceu, conta de hoje). Por baixo é o MESMO
  `set_pro` com `value:true` + `expiresAt` — nenhuma rota nova, nenhum SQL.
  Assinatura paga do Mercado Pago (`mp_preapproval_id`) também pode ser
  editada, mas o modal AVISA que a próxima renovação automática pode
  sobrescrever a data (o botão "Remover" segue escondido nesse caso, como
  era).

- **Portal: e-mail sumido ("—") e sem lápis — consertado (2026-08-29,
  v=20260829e).** Duas coisas diferentes apareciam como um bug só. (1)
  `profiles.email` é só um ESPELHO: quem se cadastrou por um fluxo que não
  preenchia a coluna (ou nasceu antes dela) fica com `email` NULL e o
  portal mostra "—" pra sempre — o login de verdade mora em `auth.users`,
  invisível pra chave anon do portal. Agora a action `sync_email` de
  `/api/admin/users` (service `syncEmailFromAuth`) lê o e-mail no GoTrue
  admin, devolve pro portal e ESPELHA em `profiles.email`; o botão 🔄 na
  `EmailCell` (só aparece quando o espelho está vazio) dispara isso.
  Perfil órfão sem login responde 404 com texto explicando (aí é usar o
  lápis, que cria/troca o login via `set_email`). (2) A coluna de e-mail
  só existia na aba Clientes: **Pintores** (e Grafiteiros/Funileiros, que
  reusam `PintoresList`) ganharam a coluna Email, e a lista "Usuarios com
  acesso ao Portal" trocou nome/e-mail em texto puro por `NameCell` +
  `EmailCell`. Helper novo `adminUsersData` (irmão do `adminUsers`) devolve
  o CORPO da resposta — `adminUsers` virou wrapper booleano dele.

- **SQL Wave 44 (2026-08-28) — JÁ EXECUTADA no Supabase (verificado em
  2026-08-29: `admin_delete_user(p_user_id uuid, p_force_admin boolean)`
  existe e 0 FKs public→profiles/auth.users com NO ACTION/RESTRICT).
  Não pedir pra rodar de novo.**
  (`/migrations/2026-08-28-delete-user-fk-sweep.sql`) CAUSA RAIZ do 502
  de exclusão comprovada: `quotes_painter_id_fkey` (e possivelmente
  outras FKs) referencia profiles SEM ON DELETE → conta com orçamento
  não excluía (era o que derrubava GoTrue/edge). A wave (1) varre
  dinamicamente TODAS as FKs public→profiles/auth.users com NO ACTION/
  RESTRICT e recria: coluna nullable → SET NULL, NOT NULL → CASCADE;
  (2) recria `admin_delete_user(uuid, boolean)` com `p_force_admin` —
  portal (v=20260828g) manda true após 3ª confirmação pra excluir
  conta admin/portal ("habilitar para excluir aqui tbm"); a PRÓPRIA
  conta segue sempre bloqueada. Trocar pra "JÁ EXECUTADO" após rodar.

- **Portal: editar nome, e-mail, cidade, UF e especialidades
  (2026-08-28, v=20260828h).** Células com lápis igual TagCell:
  `NameCell` (Pintores + Clientes), `EmailCell` (Clientes), `CityCell` +
  `StateCell` (Pintores + Clientes), `SpecialtiesCell` (Pintores). As
  abas Grafiteiros e Funileiros REUTILIZAM o componente `PintoresList`
  (roleFilter) — edição neles vem de graça. Actions na rota
  `/api/admin/users`: `set_name` (2-60 chars), `set_email` (PUT no
  GoTrue admin — troca o LOGIN — + espelho em profiles.email; 409 se em
  uso; critical no audit_log; perfil órfão ganha só o espelho) e
  `set_info` (city ≤60 / state UF 2 letras / specialties ≤200; string
  vazia LIMPA o campo).

- **SQL Wave 43 (2026-08-28) — JÁ EXECUTADA no Supabase (2026-08-28). Não
  pedir pra rodar de novo.**
  (`/migrations/2026-08-28-admin-delete-user-rpc.sql`) Exclusão
  permanente de conta pelo portal: a rota `/api/admin/users`
  (action delete_user) morria com a página "502 Bad Gateway" do PRÓPRIO
  Cloudflare (corpo capturado no relatório do portal comprovou) — o
  edge era derrubado durante a chamada HTTP ao GoTrue. Solução: RPC
  `admin_delete_user(uuid)` SECURITY DEFINER que roda a cascata inteira
  dentro do Postgres (guardas: is_portal_admin, nunca a própria conta,
  nunca admin/portal — colunas via to_jsonb; audit_log antes do
  delete). O portal (v=20260828f) chama a RPC direto via supabase-js;
  a rota edge segue existindo pras outras actions (set_tag/set_pro/…).

- **SQL Wave 42 (2026-08-28) — JÁ EXECUTADA no Supabase (2026-08-28,
  verificação retornou security_definer=true pras 2 RPCs). Não pedir
  pra rodar de novo.**
  (`/migrations/2026-08-28-quotes-insert-fix.sql`) Fix do "new row
  violates row-level security policy for table quotes" ao Gravar/Enviar
  orçamento: as RPCs `create_painter_draft` e `create_quote_from_post`
  só existiam no `supabase_init.sql` (nenhuma wave incremental as criou
  no banco vivo na forma SECURITY DEFINER) e as policies de INSERT
  direto em `quotes` foram derrubadas no hardening → o INSERT da função
  viva batia na RLS. A wave derruba TODAS as overloads vivas, recria as
  2 RPCs canônicas (SECURITY DEFINER + search_path), passa a gravar
  `post_id` (a versão do init recebia `p_post_id` e NÃO gravava — o
  filtro de leads comprados nunca casava) e adiciona policy de INSERT
  fallback (cliente = quote própria; pintor = só rascunho sem
  client_id).

- **SQL Waves 40 e 41 (2026-08-28) — JÁ EXECUTADAS no Supabase (2026-08-28). Não pedir pra rodar de novo.**
  - **Wave 40** (`/migrations/2026-08-28-profile-counters-triggers.sql`):
    os contadores `followers_count`/`following_count`/`posts_count` de
    `profiles` NUNCA tiveram trigger de manutenção no repo (a migration
    2026-06-14 só recriou a view assumindo que existiam) → o perfil
    mostrava "0 seguindo" com dezenas de follows reais. Cria os triggers
    (SECURITY DEFINER — sem isso a RLS barra o UPDATE no profile do OUTRO
    usuário) + BACKFILL a partir de follows/posts.
  - **Wave 41** (`/migrations/2026-08-28-exports-bucket.sql`): bucket
    `exports` (público, 10MB, só application/pdf, escrita no próprio
    path). No WebView do wrapper NENHUM download local funciona (share de
    arquivo ausente; blob: o nativo não lê; data: o DownloadManager
    recusa) — o app sobe o PDF pro bucket e entrega o LINK público com
    `?download=` (quotePdf.uploadPdfForLink). Sem o bucket, cai no
    fallback data URL (que no wrapper não salva).

- **Respostas automáticas do chat — consertadas, SQL Wave 39 JÁ EXECUTADO
  no Supabase (2026-08-28).** Dois bugs: (1) `auto_responses` nasceu SEM unique em
  `(user_id, trigger_type)` → o upsert `onConflict` do AutoRespostaSheet
  falhava com 42P10 em TODO salvamento, e o código não conferia o `error`
  do supabase-js (não lança!) → toast "salvas!" mentiroso, toggle voltava
  desligado; agora o save é 1 upsert em lote com erro conferido. (2) O
  disparo rodava no NAVEGADOR do pintor (useChatRealtime.maybeAutoReply)
  — só respondia com o app aberto; o listener foi REMOVIDO e o disparo
  virou trigger no banco. **Wave 39**
  (`/migrations/2026-08-28-auto-responses-fix.sql`): limpa duplicatas,
  cria a UNIQUE e o trigger `trg_auto_reply_on_message` (responde mesmo
  com app fechado; anti-loop pelo marcador "🤖 Resposta automática:";
  máx 1 por conversa/12h; EXCEPTION WHEN OTHERS igual Wave 36). **Wave 39 rodada em 2026-08-28 — não pedir pra rodar de
  novo.** Follow-up (3 dias) segue não implementado (precisa de
  pg_cron; só o slot new_message dispara).

- **Pull-to-refresh nativo do AAB (WebIntoApp) — neutralizado pelo lado web
  (2026-08-28).** O AAB da Play Store envolve a WebView num
  `SwipeRefreshLayout`; ele arma o reload quando `canChildScrollUp()` é
  false, e como o app é shell 100dvh + overflow hidden (só o `<main>` rola),
  o documento vivia em scrollY 0 → reload armado na tela INTEIRA (arrasto
  rápido pra baixo = círculo de recarregar, em qualquer posição). CSS/JS não
  alcançam o toque nativo, mas o ESTADO consultado sim. Defesa em 3
  camadas, em QUALQUER Android (gate largado em 2026-08-28 de "UA com
  token wv" pra "/Android/i" — o wrapper pode customizar o UA e o pin
  ficava mudo; no Chrome/PWA o pin é inofensivo e ainda mata o
  pull-to-refresh do próprio Chrome; iOS/desktop são no-op): (1) script
  inline no `<head>` do layout.tsx pina ANTES da hidratação (senão o boot
  ficava desprotegido); (2) hook `useAndroidWebViewScrollPin` (montado no
  RootLayout via `<AndroidWebViewScrollPin>`) estica o body em 4px — em
  `dvh` com fallback `vh`, senão a barra de URL do Chrome ganharia ~60px
  de scroll real — e PINA o documento em `scrollY = 2`, com re-pin em
  scroll/resize/pageshow/visibilitychange (retomada do WebView); (3)
  guarda de dreno: touchmove no document cancela arrasto descendente que
  nasce fora de qualquer scroller (TopNav, /login) — sem ela o gesto
  drenava o pin 2→0 e re-armava o reload no meio do movimento. Com o
  documento fora do topo, o nativo responde "pode subir" e o gesto nunca
  arma. **Constantes espelhadas** entre o hook e o script inline do
  layout — mudou um, mudar o outro. **Diagnóstico `scrollpin-diag`
  REMOVIDO em 2026-08-30** — cumpriu a missão: os pings de produção
  provaram que o UA do wrapper é `Dalvik/2.1.0 (Linux; U; Android 16;
  SM-...)` (sem token `wv`, sem "Chrome") → o gate `/Android/i` pega o
  app instalado; qualquer gate estrito de WebView ficaria mudo nele. O
  filtro segue no `/admin/errors` pras linhas históricas. AAB novo com
  "Pull to Refresh" desmarcado no painel foi publicado em 2026-08-30.
  Testes em `__tests__/hooks/useAndroidWebViewScrollPin.test.tsx`.

- **WhatsApp Cloud API — LIVE ponta a ponta (2026-08-25).** O número
  oficial (+55 11 95976-5031) está na Cloud API da Meta (WABA
  `102067872689175`, Phone Number ID `109293361953640`, app "CaliColors
  Integracao API"). Service em `lib/api/_services/whatsapp.ts` (builders
  puros + `sendWhatsAppText/Template` + `verifyMetaSignature` +
  `parseInboundMessages`); rotas `/api/whatsapp/send` (admin-only, mesmo
  gate do `/api/admin/users`, rate limit 30/min, audit_log com preview de
  80 chars) e `/api/whatsapp/webhook` (GET verificação + POST autenticado
  por `WHATSAPP_WEBHOOK_AUTH_MODE`: `payload` (default, Dualhook — valida
  WABA + phone_number_id do envelope via `isExpectedWebhookPayload`) ou
  `hmac` (app próprio — `X-Hub-Signature-256` com `META_APP_SECRET`);
  pós-autenticação sempre 200, anti-retry-storm igual mp-webhook). Testes
  em `__tests__/services/whatsapp.test.ts`. Doc: `docs/WHATSAPP_CLOUD_API.md`.
  - **Dualhook (2026-09-05)**: o webhook do número em Coexistence passou a
    ser registrado via Dualhook (Webhook Override). Nesse fluxo o
    `X-Hub-Signature-256` é assinado pelo app Meta DO DUALHOOK (secret não
    exposto) → HMAC com `META_APP_SECRET` nunca bate; por isso o modo
    `payload`. IDs da conexão Dualhook: Phone Number ID
    `1220273824510260`, WABA `1320667299892030` (≠ defaults do código, que
    são do número antigo +55 11 95976-5031) → precisam das envs
    `WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_WABA_ID` no CF Pages. Como os
    IDs são públicos, o modo `payload` TAMBÉM exige
    `WHATSAPP_WEBHOOK_URL_SECRET` no `?token=` da URL cadastrada no
    Dualhook (fail-closed sem ela) — payload sozinho não autentica.
    `WHATSAPP_WEBHOOK_VERIFY_TOKEN` = Verify Token gerado pelo Dualhook
    (já trocado no CF Pages + redeploy + GET verificado em 2026-09-05).
    **`WHATSAPP_WEBHOOK_URL_SECRET` gerado em 2026-09-05** (`openssl rand
    -hex 24`, 48 hex). O VALOR vive só no painel do CF Pages (marcado como
    Secret) e colado no fim da URL cadastrada no Dualhook — **nunca neste
    arquivo nem em lugar nenhum do repo**, mesma regra do keystore e do
    access token da Meta.
    - **É um PAR: os dois lados têm que ser idênticos.** Trocar o segredo no
      CF Pages sem reeditar a URL no Dualhook (ou o contrário) derruba o
      recebimento — o endpoint responde 401 `token inválido` e a mensagem
      não chega. Pra rotacionar: gerar o novo, colar nos DOIS, redeploy.
    - Perdeu o valor? Não dá pra recuperar de lugar nenhum: gera outro e
      atualiza os dois lados. Não há nada que dependa do valor antigo.
    **ENVIO TAMBÉM PELO DUALHOOK desde 2026-09-05.**
    `sendWhatsAppMessage` faz `POST https://api.dualhook.com/v25.0/
    <phone_number_id>/messages` com `Authorization: Bearer
    DUALHOOK_API_KEY` (env nova, Secret). O `WHATSAPP_ACCESS_TOKEN` e o
    `graph.facebook.com` SAÍRAM do caminho de envio: o número em
    Coexistence é gerenciado pelo app Meta DELES, e o token do nosso app
    não tem permissão nesse `phone_number_id`.
    - O Dualhook **espelha o contrato da Cloud API** — mesmo path, mesmo
      corpo, mesma forma de erro —, então os builders de payload
      (`buildTextPayload`/`buildTemplatePayload`) não mudaram.
    - **401/403 SEM `code` também vira erro de credencial.** O Dualhook
      recusa a API key com um 401 próprio, que não carrega o `code: 190`
      da Meta; sem essa ramificação a mensagem mandaria quem depura olhar
      o painel da Meta, que não é mais onde a credencial vive.
    - **REGRA: falha de envio NUNCA responde 502 nem 504.** O Cloudflare
      substitui o corpo dessas duas pela página de erro DELE, e a
      explicação se perde — o operador vê "502 Bad gateway" e não sabe se
      foi credencial, janela de 24h ou número errado. 4xx do Dualhook →
      **400**; 5xx e falha de rede → **500**; os dois com
      `{ error, upstreamStatus }` no corpo. O `deadlineResponse` da rota
      (orçamento de 22s) também deixou de ser 504 pelo mesmo motivo.
      131047 fica em 422 e config ausente em 503 — nenhum dos dois é
      sequestrado pelo CF.
    - Toda falha loga `dualhook_send_failed { status, body }` com o corpo
      CRU. O corpo é lido como texto ANTES do parse: resposta não-JSON
      (HTML de proxy, corpo vazio) é o caso que mais precisa ser visto, e
      `res.json()` o engoliria.
    - O portal já exibe o `error` na faixa "Falha no envio" (lê `res.error`
      do JSON) — não precisou de mudança, e por isso o `app.js`/SRI ficou
      intocado.
  - **IA E FOLLOW-UP RELIGADOS no Dualhook (2026-09-05).** Com a Evolution
    aposentada, os três `sendEvolutionText` do `whatsapp-ai-runner.ts` e do
    `whatsapp-followup.ts` apontavam pra um serviço morto, e o
    `maybeAutoReply` só era chamado pelo webhook DELA — ou seja, a IA parou
    de responder sem ninguém notar, porque a mensagem continuava chegando
    no portal normalmente.
    - `maybeAutoReply` agora é chamado pelo webhook da META, dentro do
      `runAfterResponse` (a IA pode levar o tempo dela sem atrasar o 200).
    - **REGRA: `sendWhatsAppText` usa `normalizeWhatsAppTarget`, NUNCA
      `normalizeBrPhone`.** O segundo cola '55' em qualquer coisa com 10-11
      dígitos — foi o que transformou o contato dos EUA `16503154274` em
      `5516503154274` e causou o 502 de 2026-08-28. Com o Dualhook virando
      canal único, o mesmo erro voltaria por este caminho. Tem teste.
    - **JANELA DE 24h — o que a troca de canal custou.** O follow-up existe
      pra falar com quem SUMIU, ou seja, quase sempre FORA da janela; a
      Cloud API recusa texto livre aí (131047 → 422) e só template aprovado
      passa. Não há template cadastrado no WhatsApp Manager, então esses
      envios NÃO SAEM. O sweep trata isso como desfecho conhecido, não como
      erro: conta em `SweepResult.foraDaJanela` (contador próprio) e marca
      como tentado, senão martelaria o mesmo contato de hora em hora pra
      sempre. **A resposta automática e a mensagem de ausência NÃO são
      afetadas** — as duas reagem a uma mensagem que o cliente acabou de
      mandar, então a janela está aberta por definição.
    - Pra o follow-up voltar a sair: criar template no WhatsApp Manager,
      esperar aprovação e trocar `sendWhatsAppText` por
      `sendWhatsAppTemplate` nos dois textos (cobrança e reengajamento).
  - **DEFAULTS DOS IDs APONTAVAM PRO REGISTRO ANTIGO (2026-09-05).** O
    telefone é O MESMO de sempre; o que mudou ao entrar em Coexistence foi o
    REGISTRO — a Meta emitiu `phone_number_id` e WABA novos pro mesmo
    aparelho. Os defaults do código seguiam nos antigos (`109293361953640` /
    `102067872689175`), então SEM as envs no painel: o envio ia pra um
    número que não é nosso, e o webhook recusava **toda** entrega com 403.
    - **O modo de falha do recebimento é SILÊNCIO**, não erro: o 403 vai pro
      Dualhook, o portal simplesmente não mostra nada, e não há mensagem em
      lugar nenhum dizendo por quê. Um default errado não falha — ele mente.
    - Defaults agora são os da conexão Dualhook (`1220273824510260` /
      `1320667299892030`), travados por teste. As envs seguem podendo
      sobrescrever; a diferença é que o caminho SEM env passou a ser o certo.
    - O log da recusa passou a nomear os DOIS lados (`resumirEnvelope`):
      recebido × esperado. IDs são públicos, e essa linha é a única pista
      que sobra quando a entrega some.
  - **WEBHOOK RESPONDIA 500 — `waitUntil` chamado SOLTO (2026-09-05).
    CORRIGIDO E CONFIRMADO EM PRODUÇÃO pelo usuário no mesmo dia:** a
    mensagem chega no portal. Isso fecha a corrente inteira do recebimento
    (segredo de URL → envelope → parse → `persistWhatsAppMessage` →
    `whatsapp_messages` → tela), que até então nunca tinha sido provada
    ponta a ponta — o 500 mascarava tudo que vinha depois dele. Em
    produção o log mostrava a mensagem já reconhecida (`msg de ... preview=
    "oiii"`) e logo depois `TypeError: Illegal invocation: function called
    with incorrect \`this\` reference`. Causa: `runAfterResponse` fazia
    `const waitUntil = ctx?.waitUntil` e chamava `waitUntil(seguro)`. O
    ExecutionContext do workerd é NATIVO: sem o `this` certo ele lança — e
    lança de forma **SÍNCRONA, dentro do handler**, então o erro não ficava
    contido no trabalho de fundo, ele derrubava a resposta.
    - **REGRA: método de API nativa se chama NO OBJETO DONO.** Vale pra
      `ctx.waitUntil`, `crypto.subtle.*`, `fetch`, `TextEncoder` — extrair
      pra variável ou passar como callback solto quebra no edge. Varri o
      repo: não há outro caso.
    - **O teste antigo não pegava e isso é a lição de método.** Um `vi.fn()`
      dentro de objeto literal é função JS comum, que não liga pro `this`;
      só um objeto que EXIGE o `this` reproduz. Os testes agora usam isso.
    - **Faltava teste NO NÍVEL DA ROTA** — o unitário do helper não cobria
      "a Meta recebe 200 aconteça o que acontecer".
      `__tests__/api/whatsapp-webhook.test.ts` trava o 200 com o `waitUntil`
      recusando e com o atendimento automático lançando. Confirmado que os
      dois falham com o código antigo.
  - **Evento que NÃO é de mensagem agora responde 200, não 403
    (2026-09-05).** A Meta manda `message_template_status_update`,
    `account_update` e afins no MESMO webhook. Todos caíam em 403 — e 403
    pra ela significa "não entreguei", então ela **reenviava
    indefinidamente** um evento que nunca íamos processar.
    `classifyWebhookPayload` devolve três desfechos: `processar` (nosso
    WABA + `field='messages'` + nosso número), `ignorar` (nosso WABA, sem
    change de mensagem → 200 sem trabalho) e `rejeitar` (outra conta ou
    malformado → 403). **Mensagem endereçada a OUTRO número continua
    `rejeitar`**: ali não é "evento que não me interessa", é entrega no
    endereço errado, e engolir com 200 esconderia erro de configuração.
  - **ABORDAGEM DE LEAD SAI COMO TEMPLATE (2026-09-05).** Número que nunca
    escreveu pra loja não tem janela de 24h: a Cloud API recusa texto livre
    (131047 → 422) e só template aprovado passa. E **quem abre a janela é a
    RESPOSTA da pessoa**, não o nosso envio — enquanto ela não responder, só
    dá pra mandar template. O `AbordagemModal` agora tem dois modos, com
    **template como padrão** (`TEMPLATE_ABORDAGEM = 'calicolors'`, pt_BR,
    categoria Marketing) e "Texto livre" pra quando a janela está aberta.
    - **O template aprovado NÃO tem variáveis**, então o texto personalizado
      do `montarAbordagem` (produtos por segmento) **não entra** na primeira
      mensagem — a tela diz isso explicitamente, senão o operador marca
      produto achando que muda algo. Pra personalizar a 1ª mensagem seria
      preciso um template com `{{1}}`, que passa por nova aprovação.
    - **Nome do template tem que bater com o do Dualhook.** Renomear lá
      quebra o envio (o erro aparece na faixa vermelha, não em silêncio).
      `TEMPLATE_ABORDAGEM_TEXTO` é só um ESPELHO pra tela — o texto de
      verdade vive na Meta; mudou lá, mudar aqui.
    - **Template não viaja com corpo**: o banco guarda só o NOME, e a
      conversa mostrava `[template]` seco. `textoDeTemplate` renderiza o
      texto espelhado na bolha e na prévia da lista.
    - **`sendWhatsAppTemplate` usava `normalizeBrPhone`** — o #215 corrigiu
      só o `sendWhatsAppText` e este passou batido. É o caminho da abordagem,
      onde número estrangeiro aparece de verdade (a planilha tinha um).
      Corrigido pra `normalizeWhatsAppTarget`, com teste que falha sem o fix.
      A função **não tinha teste nenhum** até aqui.
  - **TEMPLATE COM NOME + MODAL DE CONTATOS (2026-09-05).** Dois templates
    aprovados (Marketing, pt_BR): `calicolors` (fixo) e `calicolors_nome`
    (`{{1}}` = primeiro nome, **padrão**). Env
    `WHATSAPP_TEMPLATE_ABORDAGEM` sobrescreve o de variável.
    - **REGRA: nunca mandar `{{1}}` vazio.** Faria a Meta entregar "Oi ,"
      ou recusar. `escolherTemplate(nome)` decide: nome utilizável → o de
      variável; senão → o fixo. `primeiroNome` recusa vazio, **telefone no
      lugar do nome** (a base importada tem lead assim) e inicial solta.
    - **A MESMA regra existe nos DOIS lados** — `lib/api/_services/
      whatsapp.ts` (follow-up automático) e no portal. Um teste roda os dois
      contra a mesma lista de casos e falha se divergirem; sem ele, um dos
      caminhos acabaria mandando nome vazio.
    - **Follow-up:** tenta texto livre e, no 131047, cai pro template. O
      gatilho é a resposta da Meta, não uma previsão nossa — quem tem o
      relógio da janela é ela, e o banco pode não ter registrado alguma
      mensagem. Grava `type='template'` + nome + parâmetro no histórico.
    - **132001** (template inexistente/não aprovado) vira 422 com texto
      acionável, apontando pro painel do Dualhook — o detalhe da Meta é
      genérico e manda procurar no lugar errado.
    - **`prompt()` do Chrome saiu do "+ Nova conversa".** Virou modal do
      portal com busca nos contatos que a loja já conhece (leads + perfis
      com telefone), validação do número à vista e campo de nome. **Contato
      novo é salvo em `leads`** (`source='portal'`) de propósito: tabela
      nova exigiria SQL e criaria duas listas de contato pra manter em
      sincronia. Os `prompt()` das abas de Pessoas continuam lá — outro
      fluxo, não foi tocado.
    - Espelho de texto de template é só pra TELA. `calicolors_nome` ainda
      não tem espelho: a prévia diz que o texto vive no painel, em vez de
      inventar um diferente do que a pessoa recebe.
  - **BANNER DE "ATUALIZE O APP" — ADIADO POR DECISÃO (2026-09-05).** O
    usuário perguntou como o app pediria atualização depois de uma build
    nova, avaliamos disparar no boot/resume, e ele encerrou: "não faça nada,
    vamos avaliar melhor depois". **Nada foi implementado e não é
    esquecimento.** Se voltar, o ponto em aberto era a frequência: checar a
    cada abertura incomoda, e a versão instalada não é legível do lado web
    sem o plugin nativo (`lib/native/device` já expõe build/versão na casca
    Capacitor).
  - **iOS: BUILDS FEITAS, EM REVIEW NA APPLE (2026-09-05, informado pelo
    usuário).** Várias builds já subiram pelo workflow `ios-ipa` do
    Codemagic; a espera agora é da Apple, não de código. **NÃO listar
    "disparar build iOS" como pendência** — a recusa por
    `NSUserTrackingUsageDescription` foi resolvida na `main` (#200/#203) e
    já saiu em build.
  - **FOLLOW-UP ESTAVA PARADO — rota nova, SQL JÁ EXECUTADO (2026-09-05,
    confirmado pelo usuário: `app_settings.whatsapp_followup_url` já aponta
    pra `/api/whatsapp/followup?token=<segredo do webhook>`). Não pedir pra
    rodar de novo.** A rota antiga (`/api/whatsapp-evo/followup`) autentica
    o cron com `EVOLUTION_WEBHOOK_TOKEN`, env **removida** do Cloudflare
    quando a Evolution foi aposentada. Sem ela `expected` fica vazio, o
    caminho do cron nunca autentica, a chamada cai na exigência de token de
    admin — que o cron não tem — e volta **403 de hora em hora, sem ninguém
    ver**. A varredura estava morta desde a remoção das envs.
    - A rota nova aceita `WHATSAPP_WEBHOOK_URL_SECRET` (e ainda o token
      antigo, como ponte). A antiga continua no ar **delegando** pra ela:
      trocar código e configuração ao mesmo tempo deixaria a varredura sem
      chamador no intervalo.
    - `delivery_error_code`/`delivery_error_title` também rodaram nessa leva.
- **TELA CORTADA NA DIREITA NAS IAs — o culpado não era o topo
  (2026-09-05).** Ao abrir a Alice num celular estreito, o ícone de mensagem
  do `TopNav` aparecia CORTADO pela direita.
  - **O `TopNav` é `sticky`, não `fixed`** — ele tem a largura do
    CONTAINER, não da janela. Quando um filho da página é mais largo que o
    viewport, o container estica e a barra vai junto; o que sai da tela é a
    ponta direita dela. **Barra cortada = overflow em OUTRO lugar da
    página.** Procurar o defeito no topo é procurar no lugar errado.
  - O filho largo era a linha de digitar: `<textarea class="flex-1">` +
    microfone (44px) + botão Enviar. **Item de flex não encolhe abaixo da
    largura intrínseca sem `min-w-0`**, e `<textarea>` tem intrínseca alta
    (cols=20 ≈ 190px) — a linha passava de 360px.
  - **REGRA: `flex-1` em campo de texto pede `min-w-0`**; o que fica ao lado
    (botão, ícone) pede `shrink-0`. O CLAUDE.md já registrava o mesmo padrão
    no comentário do feed (A3, 2026-09-01) — virou teste agora porque são
    QUATRO telas clonadas, e corrigir uma esquecendo as outras é o modo de
    falha natural delas.

  - **MÍDIA RECEBIDA PELA CLOUD API (2026-09-05).** A conversa mostrava
    `[audio]` e `[sticker]` secos: o webhook da Meta **não tratava mídia
    nenhuma**. Toda a Wave 49 (`whatsapp-media.ts`) foi escrita pra
    **Evolution**, que mandava base64 dentro do próprio evento — e só o
    webhook DELA chamava `processarMidia`.
    - **Na Cloud API o arquivo não vem no webhook**: vem um `id`, e os bytes
      se buscam em DOIS passos (`GET /{id}` devolve URL temporária; a URL
      entrega o arquivo). Os dois pedem o mesmo Bearer.
      `baixarMidiaCloudApi` faz isso; upload, transcrição e nome de arquivo
      são os mesmos da Wave 49.
    - **O objeto da mídia vem numa chave com o NOME DO TIPO** (`audio`,
      `image`, `sticker`, `video`, `document`), não numa chave fixa — é o
      detalhe que o parser tinha que acertar.
    - Legenda de foto/vídeo (`caption`) vira o corpo da mensagem; áudio
      continua sendo transcrito, que é o que faz voz entrar na prévia e no
      histórico que a IA lê.
    - Tudo best-effort: falhar deixa a mensagem com o marcador do tipo, que
      é pior que ter o arquivo e MUITO melhor que perder a mensagem.
    - **Incerteza declarada:** a URL temporária costuma apontar pro CDN da
      Meta, e a nossa credencial é do Dualhook. Se o CDN recusar, o corpo da
      recusa vai pro log — é a única pista de que o caminho precisa de outra
      credencial.
  - **"ABORDAR" É SÓ TEMPLATE (2026-09-05, decisão do usuário).** O modal
    tinha aba de "texto livre" com seletor de produtos e campo de mensagem
    (o pitch do `montarAbordagem`). Saiu inteiro:
    - Abordagem é, por definição, a PRIMEIRA mensagem pra quem nunca
      escreveu — janela fechada, só template passa. O campo de texto ali
      nunca ia enviar nada; era um convite pro 131047.
    - Depois que a pessoa responde, a conversa vive na aba WhatsApp, que já
      tem campo, sugestão da IA e histórico. Dois lugares pra escrever a
      mesma conversa espalham o atendimento.
    - **`montarAbordagem` foi APAGADA junto** — existia só pra alimentar
      aquele campo. O follow-up tem textos próprios no servidor
      (`textoCobranca`/`textoReengajamento`); não dependia dela. Código
      morto com comentário dizendo que alguém usa é pior que apagar.
    - Bug corrigido de brinde: o seletor de produtos e o campo de mensagem
      apareciam TAMBÉM no modo template, onde não faziam nada.
  - **TEMPLATES VÊM DA META, não de lista escrita à mão (2026-09-05).**
    `GET /api/whatsapp/templates` consulta o Dualhook
    (`/{WABA}/message_templates`), filtra `APPROVED` e devolve nome,
    categoria, idioma, corpo e as VARIÁVEIS; cache de 5min no isolate. O
    portal cai na lista embutida se a consulta falhar. Lista à mão envelhece
    igual lista de pendência — e se o nome mudar no painel, o envio quebra
    com 132001 enquanto a tela mostra o nome velho.
    - `<EnvioDeTemplate>` monta um campo por variável, prévia com os valores
      já substituídos e botão travado enquanto faltar variável. A regra
      "nunca mandar `{{1}}` vazio" virou "nenhuma variável vazia".
    - **Aviso de MARKETING pra número dos EUA** (a Meta não entrega; volta
      `failed` 131049). Não bloqueia — exige confirmação. Detectar por "11
      dígitos começando com 1" NÃO basta: `11987654321` (celular de SP sem
      DDI) tem a mesma forma; o desempate é a regra do NANP (código de área
      dos EUA nunca começa com 0 nem 1).
  - **ARMADILHA: `route.ts` do Next só aceita exports fechados
    (2026-09-05).** Exportar um helper de um arquivo de rota quebra o build
    com `"X is not a valid Route export field"` — e **nem `tsc` nem vitest
    pegam**, só o `next build`. Derrubou o deploy do #227. Função pura de
    rota vai pra `lib/api/_services/`. Vale também pra `runtime`: o Next
    **não** reconhece o campo re-exportado de outro arquivo (avisa e usa o
    default, tirando a rota do edge).
    - **REGRA: rodar `next build` antes de subir mudança estrutural de
      rota.** Suíte verde e tsc limpo não provam que o deploy vai passar.
  - **LISTA DE CONTATOS: busca NO BANCO + índice A-Z (2026-09-05).** A 1ª
    versão do modal trazia 500 leads + 500 perfis e filtrava em memória. Com
    **1072 leads**, quem estava fora dos primeiros 500 ficava INVISÍVEL pra
    busca — digitar o nome não achava nada, e a tela não dava pista de que
    faltava gente. **Lista truncada que se parece com lista completa é pior
    que lista vazia.** Agora a busca consulta o banco (ilike em nome E
    telefone, 250ms de atraso) e há índice A-Z que também consulta — clicar
    numa letra não filtra o que já está na tela, senão sofreria do mesmo
    problema. A tela mostra o total e diz que está exibindo um pedaço.
  - **STATUS DE ENTREGA — Wave 58 (2026-09-05). SQL JÁ EXECUTADO
    (2026-09-05, confirmado pelo usuário). Não pedir pra rodar de novo.**
    `/migrations/2026-09-05-whatsapp-delivery-status.sql` (3 `ALTER TABLE`
    de uma linha). Motivo: um template de abordagem foi enviado com sucesso
    (o portal registrou) e não apareceu no celular do cliente — e não havia
    como separar "número sem WhatsApp" de "recusou marketing" de "limite da
    Meta". Os três produzem o MESMO silêncio.
    - A Meta manda esses avisos no MESMO webhook das mensagens (`field=
      'messages'`, com `statuses` no lugar de `messages`). Eles já passavam
      pela validação do envelope e eram **descartados**: `parseInboundMessages`
      devolvia lista vazia e nada mais olhava o payload.
    - `parseStatusUpdates` + `persistStatusEntrega` (PATCH por `message_id`,
      que já é UNIQUE; não cria linha). Bolha mostra ✓ / ✓✓ / ✓✓ azul, e
      `failed` mostra **o motivo por extenso na bolha**, não só no tooltip.
    - **`statusAvanca` impede o status de andar pra trás**: a Meta entrega
      fora de ordem e reenvia, e um `sent` atrasado sobrescreveria um `read`.
      `failed` é desfecho e vence tudo.
    - **Tolera a coluna ausente nos DOIS lados** (servidor loga e segue; o
      portal refaz o `select` sem elas). Recurso novo não derruba o que já
      funcionava por SQL pendente — lição de `quotes.post_id`/`leads.city`.
  - **ARMADILHA DE TESTE: arquivo "skipped" é verde na contagem
    (2026-09-05).** `__tests__/portalJanela24h.test.ts` lê o FONTE do portal
    (que não tem módulos) e avalia o trecho com `new Function`. Ao inserir um
    componente JSX dentro do trecho extraído, o parse quebrou e o vitest
    reportou o arquivo como **skipped** — `Tests 1619 passed | 12 skipped`,
    e eu quase mergeei olhando só a contagem de testes.
    - **REGRA: conferir a linha `Test Files`, não só `Tests`.** Suíte com
      arquivo falhando ainda soma "passed" nos outros.
    - A extração agora usa marcadores nomeados (`// [teste:janela-inicio]`
      etc.) e há um teste que falha ALTO se um marcador sumir ou se entrar
      JSX entre eles — ele não depende da extração, então sobrevive ao
      acidente que precisa denunciar.
  - **Aquecimento da Evolution REMOVIDO do portal (2026-09-05).** A tela de
    WhatsApp e a abordagem de lead cutucavam
    `https://evolution-api-8arv.onrender.com` antes de cada envio — ao
    abrir, a cada 5min e A CADA TECLA digitada. Aquilo existia porque a
    Evolution dormia no plano free do Render; o Dualhook é gerenciado, não
    há o que acordar. O que sobrava era uma chamada a um host morto
    atrasando o envio e exibindo "Acordando o servidor…" sem motivo.
  - **O access token NÃO está no código** (IDs públicos são default; token
    só via env). Se o token vazar/expirar (erro 190 do Graph): regenerar no
    painel Meta e trocar só a env + redeploy.
  - **Janela de 24h da Meta**: texto livre só pra quem escreveu nas últimas
    24h; fora dela o Graph dá 131047 e a rota responde 422 "use um template
    aprovado". Templates se criam no WhatsApp Manager.
  - **SQL Wave 38 — JÁ EXECUTADO no Supabase (2026-08-25)**
    (`/migrations/2026-08-25-whatsapp-messages.sql`):
    tabela `whatsapp_messages` (direction in/out, `message_id` UNIQUE pra
    dedupe de retry da Meta, RLS SELECT só `is_portal_admin()`, escrita só
    service_role). Webhook grava inbound e `/api/whatsapp/send` grava
    outbound via `persistWhatsAppMessage` (best-effort — falha nunca custa
    o 200 do webhook nem a mensagem enviada; sem a tabela, tudo segue
    funcionando só com log). Tela `/admin/whatsapp` (RSC guard
    `requireAdminServer` + `WhatsAppAdmin` client): lista em estilo conversa
    (poll 15s), filtros in/out, form de envio de texto livre e botão
    "Responder". NÃO misturar com a tabela `messages` do chat interno
    (user↔user, FK em profiles) — aqui o interlocutor é telefone externo.

- **WebView: "erro 500 e não abre mais" / "sem internet" — 4 causas
  corrigidas (2026-08-22).** Sintomas: no Android, sair e voltar (ou no meio
  do uso) dava 500 e o app não abria mais; no iOS, "não tem internet" ao
  tentar conectar.
  - **Cache envenenado (a causa do 500 permanente).** O `sw.js` gravava a
    resposta de NAVEGAÇÃO sem olhar o status: um 500 passageiro do Cloudflare
    virava conteúdo permanente do cache e voltava a cada falha de rede — e o
    WebView do Android SEMPRE falha por um instante ao voltar do background
    (rádio ainda subindo). Internet boa, erro vindo do disco. Agora
    `isCacheable()` (só 200, não-redirecionado, não-opaco) barra a escrita,
    `matchUsable()` nunca devolve resposta de erro guardada, e o último
    recurso é uma página "Sem conexão" gerada na hora com botão de recarregar.
    **`CACHE_VERSION` foi pra `quc-v3` — é o bump que limpa os caches já
    envenenados de quem está preso hoje** (o `activate` apaga toda chave fora
    da versão). Bumpar de novo em qualquer mudança de estratégia do SW.
    **v5 (2026-08-28): 5xx cru NUNCA mais chega na tela em navegação de
    documento.** O v4 preferia o cache mas, sem cópia boa (comum: SPA quase
    não gera navegação de documento), devolvia o 500 cru — era a tela
    "500 | Server Error" morta ao reabrir a tela do celular com o app aberto
    (renderer morto → re-navegação → soluço 5xx do edge). Agora o último
    recurso pra 5xx é a página "Reconectando…" com AUTO-RETRY (backoff
    2.5s+n·1.5s, teto 6/2min via sessionStorage, reload também no evento
    `online`) — o app volta sozinho sem matar o processo. RSC segue
    recebendo status cru (router faz hard-nav). Incidente 5xx pós-retry
    loga `type='sw-nav-5xx'` no /admin/errors (best-effort). O ping
    `scrollpin-diag` ganhou o campo `sw=` (SW controlando a página?).
  - **Sem retentativa.** Navegação agora repete UMA vez (600ms) em falha de
    rede e em 5xx. Cobre a retomada do WebView e cold start ruim do edge.
    `install` também deixou de ser all-or-nothing (`addAll` → puts tolerantes):
    um asset 404 abortava o install inteiro e o SW nunca ativava.
  - **`getSession()` sem teto = "Carregando…" eterno.** Não é só leitura de
    localStorage — com token vencido ele faz refresh pela rede, e no WebView
    esse fetch fica pendurado pra sempre quando o sistema congela a tela.
    Como `loading` só virava false no `.then`, o `AppShell` ficava travado.
    Agora corre contra `SESSION_TIMEOUT_MS` (8s), refaz a leitura em
    `visibilitychange`/`online`/`pageshow`, e o `/login` redireciona sozinho
    se a sessão chegar depois. **Qualquer await de rede no caminho de boot
    precisa de timeout — no WebView promessa pendurada não rejeita.**
  - **iOS: App-Bound Domains sem o Supabase.** `WKAppBoundDomains` +
    `limitsNavigationsToAppBoundDomains: true` fazem a WKWebView SÓ enxergar
    os domínios da lista, que tinha só `queroumacor.com.br`. Requisição
    bloqueada chega no JS como falha de rede genérica → `errors-friendly.ts`
    traduz pra "Sem conexão. Verifique sua internet". Supabase adicionado ao
    plist e ao `allowNavigation`. Limite da Apple: 10 domínios.
  - **Pendências conhecidas (não corrigidas aqui):** (1) `webDir` aponta pra
    `next-app/.next/static`, que NÃO é web build (sem `index.html`) — não
    existe bundle local de fallback, então sem rede na abertura o app não tem
    uma tela sequer pra mostrar; (2) login Google/Apple navega a própria
    WebView pro provedor — o Google recusa OAuth em WebView embarcada
    (`disallowed_useragent`) e o App-Bound Domains do iOS bloqueia a
    navegação; o certo é `@capacitor/browser` + deep link de callback.
  - Testes em `next-app/__tests__/sw.test.ts` (11): carregam o `sw.js` num
    escopo falso e travam a regra "erro nunca entra nem sai do cache".

- **Logos do app aparecem no /portal (Camisetas) — 2026-08-22.** Antes, o que
  o pintor gerava com o Seu Zé ("Gerar Logo") era uma **data URL base64** de
  ~1.5MB que só existia no state da tela; as 2 variantes não escolhidas
  sumiam e a loja não tinha como saber qual arte estampar. Agora
  `/api/generate-logo` materializa cada imagem no bucket `posts`
  (`<userId>/logos/<uuid>.png`, via service_role) e grava uma linha em
  `brand_logos` com dono + prompt. O upload "Já tenho meu logo" faz o mesmo
  pelo cliente (`lib/services/brandLogos.ts`) e o path deixou de ser fixo
  (`business_logo.<ext>` com upsert apagava o arquivo antigo e invalidava o
  histórico).
  - **Persistir é best-effort**: se o storage/insert falhar, a rota devolve as
    data URLs da IA como antes — nunca custar ao pintor o logo recém-gerado.
  - `/portal` → "Camisetas Personalizadas" ganhou a galeria "Logos dos
    pintores": foto + nome/@tag/telefone/cidade + prompt + badge IA/Enviado +
    "★ logo atual" (comparando com `profiles.business_logo_url`), busca,
    filtro por fonte, "Usar na camiseta" (entra no mockup e no Gerar Pedido)
    e atalho de WhatsApp. Query em 2 passos (sem embed PostgREST), igual
    Pedidos da Loja.
  - No app, a tela Camisetas ganhou "🗂️ Meus logos" — o mesmo histórico,
    tocar aplica o logo no perfil.
  - **SQL Wave 37 — JÁ EXECUTADO no Supabase (2026-08-22)**:
    `/migrations/2026-08-22-brand-logos.sql`. Cria `brand_logos` (RLS
    owner + `is_portal_admin()` pra SELECT), índice único
    `(user_id, md5(image_url))` pra retry não duplicar, backfill do
    `business_logo_url` atual e **recria `cleanup_orphan_media()`** — a
    versão da Wave 5 considerava órfão TODO arquivo do bucket `posts` sem
    post, o que incluía os logos.

- **Push com o app fechado — TUDO codado, NADA ligado (2026-08-22).** Service
  worker (`public/sw.js`, handlers `push` + `notificationclick`), rota
  `/api/push-notify` e o componente `PushOptIn` já existem. O que falta é
  configuração, em 4 passos: (1) gerar VAPID (`npx web-push
  generate-vapid-keys`); (2) 4 envs no CF Pages Production —
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (**plain text**, é lida no build),
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_INTERNAL_SECRET` — e refazer o
  deploy; (3) rodar `/migrations/2026-06-11-push-subscriptions.sql` +
  os 2 inserts em `app_settings` (`push_notify_url`, `push_internal_secret`,
  este igual ao do CF); (4) cada aparelho toca "Ativar notificações" no
  perfil. **Sem a env pública o `PushOptIn` retorna null** — é por isso que a
  opção "não aparece" no celular.
  - **SQL Wave 36 — JÁ EXECUTADA (verificado em 2026-08-29: trigger
    `trg_notify_on_message` existe e `notif_actor_label` também).** O gatilho de push escuta `notifications`, e
    só `likes`/`comments` criavam linha lá: **mensagem de chat não gerava
    notificação nenhuma**, então nunca viraria push. Migration em
    `/migrations/2026-08-22-notify-on-message.sql` cria
    `trg_notify_on_message` (agrupa rajada: pula se já há aviso não lido do
    mesmo remetente nos últimos 5 min; `EXCEPTION WHEN OTHERS` pra falha em
    notificar nunca derrubar o INSERT da mensagem) e recria
    `dispatch_push_on_notification` mandando `type='message'` pro `/chat`.
  - iOS: só 16.4+ e **só em modo PWA** (Adicionar à Tela de Início).
  - **WebView não tem Web Push — nem iOS nem Android (2026-08-22).** O app
    empacotado (Capacitor) roda em WebView, então TODO o caminho web push
    acima só vale pra quem usa pelo navegador/PWA. O `PushOptIn` agora
    **some** quando o ambiente não suporta, em vez de mostrar "instale como
    app na tela inicial" — dica sem sentido pra quem já está num app
    instalado. Push no app das lojas exige push NATIVO (plugin
    `@capacitor/push-notifications` + FCM/APNs, tabela de tokens e envio via
    FCM no servidor); vai junto do próximo build nativo. Backend web push
    validado ponta a ponta em 2026-08-22: `{"ok":true,"sent":0,"total":0}`
    (200, sem inscritos).
- **Edge do Cloudflare: secret NÃO chega em `process.env` (2026-08-22).**
  Descoberto depurando o portal admin em produção. As variáveis do painel do
  Pages só existem no request context, publicado no symbol global
  `Symbol.for('__cloudflare-request-context__')`. **Ler sempre por
  `getRuntimeEnv()` (`lib/api/env.ts`), nunca `process.env` direto**, pra
  qualquer secret/config de runtime — ele tenta o symbol e cai pro
  `process.env` (build, dev, vitest).
  - `env.ts` NÃO pode importar `@cloudflare/next-on-pages`: o entrypoint faz
    `require('server-only')`, pacote não instalado, e isso derruba a CARGA de
    ~40 arquivos de teste ("Cannot find module 'server-only'" → 197 testes a
    mais quebrados). Lemos o symbol na mão.
  - Corolário que causou o 403 do portal: nada que dependa de env pode ser
    lido no MODULE-LOAD — no boot não existe request, logo não existe env.
    `admin-config.ts` parseava `ADMIN_EMAILS` no boot e o cache nascia
    sempre vazio → `isAdminEmail()` sempre false → "não autorizado (email
    não admin)". Virou preguiçoso (parse na 1ª chamada).
  - Baseline da suíte: **0 falhas / 1181+ testes** desde 2026-09-03 (as 11
    falhas crônicas — mocks de supabase sem .or/.gte + drifts de mktClassify/
    searchUsers/signup — foram zeradas). QUALQUER falha agora é regressão
    real: nunca mais normalizar teste vermelho.
- **Chat 3-way (cliente + pintor + loja) — 2026-08-22.** Não existe tabela de
  conversas: tudo é `messages` com `conversation_id` texto (`uuidA_uuidB`
  ordenado no 1:1, prefixo `3way:` quando criado por essa via,
  `store_calicolors_<uuid>` na conversa direta com a loja). A loja entra pelo
  banner dentro da conversa (só profissional vê — `isPainter` no
  `ChatConversation`), que insere `__STORE_ADDED__` (type=system, marcador) +
  saudação (type=store). O `/portal` → "Chats 3-Way" lista agrupando por
  `conversation_id` e responde com type=store.
  - **Fix 1 — a tela não percebia a loja.** `is3way` olhava só o prefixo do
    convId, mas adicionar a loja NÃO troca o convId. Resultado: cabeçalho
    nunca virava "+ Cali Colors" e o convite continuava na tela (dava pra
    adicionar de novo e duplicar a saudação). Agora deriva de 3 sinais:
    prefixo, `convMeta.is3way` (marcador) ou qualquer mensagem `type='store'`
    já carregada. `findOrCreate3WayWithStore` segue sem caller (código morto).
  - **Fix 2 — atalho "🎨 Loja" na lista de conversas** (`ChatList`), que abre
    ou cria a conversa direta com a loja. Antes só existia a ABA "Cali
    Colors", que FILTRA conversas existentes — quem nunca tinha falado com a
    loja precisava adivinhar o nome dela na busca do "+".
  - **SQL Wave 35 — JÁ EXECUTADA no Supabase (2026-08-29).** A policy de SELECT em `messages`
    liberava só sender/receiver, e a loja responde escolhendo UM destinatário
    → o terceiro não via a mensagem. A policy nova acrescenta participante
    ESTRUTURAL: `POSITION(auth.uid()::text IN conversation_id) > 0`. **Não usar
    a regra "tem mensagem sua nessa conversa"** — o convId é derivado de UUIDs
    públicos, então qualquer um poderia inserir uma mensagem na conversa
    alheia e passar a ler o histórico. Migration em
    `/migrations/2026-08-22-messages-conversation-visibility.sql`.
- **Corte de tela no iPhone — 4 causas corrigidas (2026-08-21).**
  - **Zoom automático do iOS**: campo com `font-size < 16px` faz o Safari
    ampliar ao focar; o viewport de layout fica maior que a tela e o
    conteúdo "corta" (bolha de chat sumindo pela direita, campo de digitar
    fora de vista). Regra no fim do `globals.css`, escopada em
    `@media (pointer: coarse)`, força 16px em input/textarea/select
    (checkbox/radio/range de fora). Desktop mantém `text-sm`. **Não usar
    `maximum-scale=1` no meta viewport** — iOS moderno ignora e mataria o
    pinch-zoom de acessibilidade.
  - **`100vh` no `AppShell`**: no Safari do iPhone o `vh` conta a área atrás
    das barras do navegador, então BottomNav/composer nasciam abaixo da
    dobra. Virou `height: 100dvh` inline (classe `h-screen` fica de
    fallback). **Preferir `dvh` em qualquer altura de tela cheia daqui pra
    frente.**
  - **Personas de IA** (Alice/Seu Zé/Fê/Senna): `height: min(70vh, 600px)`
    virou `min(70dvh, 600px)` + `maxHeight: 100%` — sem o teto, o painel
    estourava o espaço do bottom-sheet e empurrava o campo de digitar pra
    fora. Modal de histórico: `calc(100vh - 80px)` → `100dvh`.
  - **`min-h-screen` dentro do AppShell** (19 pages): forçava 100vh de
    altura dentro de um `<main>` que já é menor que isso (TopNav +
    BottomNav), criando scroll fantasma e jogando o fim do conteúdo sob a
    barra. Virou `min-h-full`. Páginas `/admin/*` (fora do AppShell)
    seguem com `min-h-screen`, corretamente.
- **Tour guiado da 1ª abertura (coach marks) — 2026-08-21.** `components/
  AppTour.tsx` escurece a tela, abre um "buraco" de luz em cima de um botão
  real da navegação e mostra um balão explicando pra que ele serve (tom
  simples, PT-BR). Tocar em qualquer lugar (ou no balão / "Próximo") avança;
  "Sair do tutorial" e `Esc` fecham. Roteiro em `lib/tour/steps.ts` (9 passos:
  boas-vindas → Início → Mensagens → Buscar → Loja → Avisos → Perfil → Plano
  → fim), geometria pura testável em `lib/tour/position.ts`, flag
  `app_tour_seen_v1` em `lib/tour/storage.ts`.
  - Os alvos são marcados com `data-tour="nav-*"` no `BottomNav` (feed/
    search/loja/notif/perfil) e no `TopNav` (chat/plano). **Se mexer nesses
    componentes, preservar os `data-tour`** — sem eles o passo é pulado.
  - Montado no `AppShell` (precisa de TopNav+BottomNav na tela pra medir).
    Auto-abre SÓ em `/feed`, SÓ logado e SÓ uma vez por dispositivo. Passos
    cujo alvo não existe são pulados automaticamente.
  - O holofote é `box-shadow: 0 0 0 9999px preto` numa div vazia; animar
    top/left/width/height faz a luz "voar" entre os botões. Keyframes
    (`.tour-ring`, `.tour-balloon-in/-fade`) no fim do `globals.css`.
    Respeita `prefers-reduced-motion`.
  - Rever depois: botão "Ver tutorial de novo" no `ProfileFooter` (chama
    `startTour()`), roda ali mesmo no `/perfil`.
  - `components/OnboardingModal.tsx` + `lib/hooks/useOnboarding.ts` foram
    **deletados** — eram um modal de 5 passos que nunca chegou a ser
    renderizado em lugar nenhum, e virou duplicata deste tour.
  - `vitest.config.ts` ganhou `plugins: [react()]` pra rodar testes de
    componente (`.test.tsx`, com `// @vitest-environment jsdom`).
- **Tour 2 — ferramentas do Perfil (1 passo por tile) — 2026-08-21.** Mesmo
  `<AppTour>`, agora parametrizado por props (`tour` / `steps` / `autoPath`).
  Roteiro `PROFILE_TOUR_STEPS` em `lib/tour/steps.ts`: boas-vindas + um passo
  explicando CADA quadradinho do `BusinessGrid` (AR Grafite, Arte pra venda,
  Avaliar, Pedidos, Orçamento, Orçamentos, Pontos, Portfolio, Calculadora,
  Agenda, Reativar clientes, Financeiro, Anotações, Arte pra IG, Camisetas,
  Formação, Seu Zé, Alice, Fê, Senna) + fim.
  - Alvos: `data-tour={`tile-${tile.sheet}`}` no botão do `BusinessCard` —
    derivado da chave `sheet`, então **tile novo no grid = passo novo no
    steps.ts** (o teste `__tests__/tour.test.ts` lê o fonte do BusinessGrid
    e QUEBRA se faltar/sobrar passo; é de propósito).
  - Como os tiles são condicionais ao papel, cada usuário só vê os passos
    das ferramentas que tem — pintor não vê AR Grafite, cliente não vê
    Financeiro, cada papel vê só a sua persona de IA. Quem filtra é o
    `resolveVisibleSteps` (alvo ausente = passo pulado).
  - Montado dentro do `BusinessGrid` (não no AppShell) porque é lá que os
    alvos existem. Auto-abre em `/perfil`, flag própria
    `profile_tour_seen_v1` — independente da flag do tour de navegação.
  - Rever depois: botão "Ver tutorial das ferramentas" no `ProfileFooter`
    (`startTour('profile')`). O evento de start virou `CustomEvent` com
    `detail.tour`, então cada instância do AppTour só responde ao seu.
  - Dois detalhes que o tour comprido exigiu: (1) o passo dá
    `scrollIntoView({block:'center'})` no tile fora da dobra — por isso o
    lock de scroll deixou de ser `overflow:hidden` no body (que mataria o
    scroll programático) e virou `preventDefault` em touchmove/wheel;
    (2) acima de 10 passos as bolinhas de progresso viram barra + "3 de 21".
- **Composer: venda só pra profissional + story sem legenda IA — 2026-08-21.**
  `canMarkPostForSale` em `lib/policies.ts` (nega `role='cliente'`, libera o
  resto inclusive role vazio, admin sempre pode) esconde o "Marcar como
  venda" do `Composer`; `CaptionInput` ganhou prop `showGenerate` e o botão
  "✨ Gerar legenda (IA)" some na aba Story (story expira em 24h e a chamada
  consome cota de IA). O payload do publish reconfere a permissão em vez de
  confiar no state — o `forSale` sobrevivia a troca de aba/autosave/deep-link
  `?forSale=1` e vazava `for_sale=true` pra story.
  - **SQL Wave 34 (2026-08-21) — D1 FECHADO, JÁ EXECUTADO no Supabase.** A
    regra também vive no banco: trigger `trg_enforce_post_for_sale_role`
    (BEFORE INSERT OR UPDATE em `posts`) zera `for_sale`/`price`/`art_type`
    quando o autor tem `role='cliente'` — admin e role vazio passam, igual
    ao `canMarkPostForSale`. Os 3 posts antigos que violavam foram limpos
    (só a marcação de venda; os posts seguem no feed). Migration em
    `/migrations/2026-08-21-posts-for-sale-role-guard.sql`.
  - **Pegadinha do schema:** `profiles.is_admin` NÃO existe na tabela real,
    apesar de aparecer no código legado e em migrations antigas (a v1 desta
    migration quebrou com 42703 por causa disso). Por isso a função lê a
    linha do autor via `to_jsonb(p) ->> 'campo'`: coluna ausente vira chave
    ausente → NULL, em vez de abortar. **Usar esse padrão em qualquer SQL
    novo que toque colunas de admin do `profiles`.** Suspeita aberta: a
    função `is_portal_admin()` (usada nas policies de RLS de ~13 tabelas)
    referencia `is_admin` na migration que a criou — se estiver mesmo assim
    no banco, está quebrada em runtime. Checar com `SELECT is_portal_admin();`
- **Portal: formulário de produto virou gaveta lateral (2026-08-21).** Era
  um card no TOPO da lista — ao rolar pra achar a cor/produto, ele sumia de
  vista. Agora é `position:fixed` colado na direita (460px, altura cheia),
  com cabeçalho fixo (título + X, `Esc` fecha), corpo rolável só dos campos
  e rodapé fixo com Ativo/Cancelar/Salvar. A lista ganha `paddingRight`
  enquanto a gaveta está aberta pra nenhum card ficar embaixo dela; os grids
  do form caíram de 3-4 pra 2 colunas por causa da largura. Keyframe
  `drawerIn` no `<style>` do `index.html`.
  - **Como recompilar o portal** (o `app.js` commitado é reproduzível byte a
    byte a partir do `app.jsx`): `@babel/core` + `@babel/preset-react`
    (`runtime: 'classic'`), `generatorOpts: { jsescOption: { minimal: false } }`,
    `compact: false`, e o arquivo final SEM quebra de linha no fim. Depois
    refazer o `integrity` (ver item abaixo).
- **Portal: mexeu no `app.js`, refaz o `integrity` (2026-08-21).** O
  `public/portal/index.html` carrega os scripts com Subresource Integrity
  (`integrity="sha384-…"`). Se o arquivo muda e o hash não, o navegador
  **se recusa a executar** — sem erro na tela, o portal fica eternamente em
  "Carregando Portal Cali Colors…". Aconteceu ao corrigir a URL da API
  dentro do `app.js`. Receita: `openssl dgst -sha384 -binary
  public/portal/app.js | openssl base64 -A`, colar no `integrity` e bumpar
  o `?v=`. **E editar também o `app.jsx`** — ele é o FONTE do `app.js`
  compilado; corrigir só o compilado some na próxima compilação. O teste
  `__tests__/portalApiRoutes.test.ts` agora confere o hash do index contra
  o arquivo real (e varre `.jsx` junto com `.js`).
- **Portal admin chama `/api/admin/users` (2026-08-21).** "Habilitar PRO" e
  "Promover" davam `HTTP 404`: o `public/portal/app.js` (estático, chama a
  API por string) ainda apontava pra `/api/admin-users`, nome da antiga
  Cloudflare Function — na migração pro Next a rota virou
  `app/api/admin/users/route.ts`. As `action` (promote/revoke/set_pro/
  set_role/verify) e o `accessToken` no body já batiam; era só o caminho.
  Teste `__tests__/portalApiRoutes.test.ts` lê o fonte do portal e quebra se
  alguma URL de API não tiver `route.ts` — o type-check não pega string.
- **Login social Google + Apple (2026-06-18).** OAuth via Supabase.
  `AuthProvider.signInWithGoogle()`/`signInWithApple()` chamam
  `supabase.auth.signInWithOAuth({ provider })` com
  `redirectTo=${origin}/completar-perfil`. Botões reutilizáveis em
  `components/SocialAuthButtons.tsx` (Google branco + Apple preto),
  renderizados no `/login` (LoginForm, abaixo do "Entrar") e `/signup`
  (SignupFlow, topo do passo 1). **Provider Google e Apple já habilitados
  no painel Supabase** (Client ID/Secret + redirect URLs) — não pedir pra
  configurar. **Onboarding pós-OAuth**: `/completar-perfil` (page +
  `CompleteProfileForm`) é o landing do `redirectTo` — se o perfil já tem
  categoria (`user_type`/`role`) + `@tag`, manda pro `/feed`; senão pede
  categoria + nome + @tag (cidade/UF opcionais) e grava via
  `useProfile.update`. `ProfilePatch` ganhou `user_type` (o trigger
  `trg_sync_role_from_user_type` preenche `role`). O `/perfil/editar` NÃO
  serve pra isso (tag é readonly lá e não tem seletor de categoria).
  Lembrete: no Supabase, as Redirect URLs precisam cobrir
  `/completar-perfil` (recomendado wildcard `…/**` + preview pages.dev).
  - **Guard de cadastro incompleto (2026-08-21).** O `/completar-perfil` era
    a ÚNICA chance de preencher categoria + @tag: se o redirect do provedor
    não pousasse lá (Redirect URL fora da allowlist manda pro Site URL) ou a
    pessoa fechasse a aba, ficava com perfil pela metade pra sempre — sem
    @tag não aparece na busca nem tem link de perfil. Apareceram vários no
    `/portal` (Clientes com @TAG "—"). Agora o `AppShell` refaz o pedido:
    `isProfileComplete` (`lib/profileCompletion.ts`, regra compartilhada com
    o formulário) + `router.replace('/completar-perfil')`, e a tela privada
    não renderiza enquanto isso. **Só redireciona com o profile carregado
    sem erro** — query em voo ou falha de rede NÃO expulsam ninguém.
    Usuários antigos sem tag são pegos na próxima abertura.
- **Compliance Apple 3.1.3(e) — loja sem pagamento no app (2026-06-18).**
  A loja Cali Colors NÃO processa pagamento dentro do app: o cliente só
  monta a "Lista de Pedido" e a loja fecha a venda fora do app (WhatsApp).
  - **Removido o fluxo Mercado Pago da LOJA** (físicos): deletados
    `next-app/app/api/mp-checkout-loja/route.ts`,
    `next-app/lib/api/_services/mp-checkout-loja.ts` e o teste. `CartView`
    agora só chama `useCart.checkout()` → `submitOrder` (grava order
    `status='pending'` no Supabase), esvazia a lista e mostra "Pedido
    enviado! A equipe da Cali Colors entrará em contato via WhatsApp em
    breve.". Sem redirect pra URL externa de pagamento. Botões/títulos:
    "Selecionar" / "+ Selecionar item" / "Minha Lista de Pedido" /
    "Enviar Lista". Não havia rota de retorno (`?compra=` apontava pra `/`).
  - **PRO mantido, MAS sem checkout no app (por enquanto).** `ProView`
    (`next-app/app/pro/ProView.tsx`) não chama mais `startProCheckout` —
    mostra nota "Para ativar o plano PRO, entre em contato com a loja
    física Cali Colors pelo telefone (11) 95976-5031" + botão WhatsApp.
    Ativação é MANUAL (a loja seta `profiles.is_pro` no perfil). O
    `billing-platform.ts` + `/api/checkout` + `/api/mp-webhook` continuam
    no repo intactos (não deletados) pra retomar depois se decidirem.
  - `MP_ACCESS_TOKEN` ainda é usado por `/api/checkout` (PRO web) e
    `/api/mp-webhook` — NÃO remover a env.
- **Modo visitante (guest) — REMOVIDO (2026-06-18, a pedido do usuário).**
  O app voltou a EXIGIR login. O guard fica no `AppShell` (`components/
  AppShell.tsx`): se `!loading && !user`, `router.replace('/login?next=…')`
  e não renderiza o conteúdo privado. Toda tela embrulhada em AppShell é
  privada; páginas públicas (`/login`, `/signup`, `/`, `/info/*`,
  `/delete-account`, `/completar-perfil`) NÃO usam AppShell, então seguem
  acessíveis. Raiz `/` agora manda logado→`/feed`, deslogado→`/login`. O
  botão "Explore o app sem cadastro" já tinha sido removido do `/login`. O
  `AuthGate` continua no repo mas fica inerte dentro do AppShell (user
  sempre presente) — não removido. As policies anon-read da loja
  (`2026-06-15-loja-anon-read.sql`) seguem no banco, inofensivas (sem anon
  agora); não precisa reverter.
- **Badge de chat não lido (TopNav) — fix LIVE (2026-06-15).**
  `useUnreadMessageCount` revalida tb no INSERT de `notifications` (mesmo
  evento que acende o sininho, comprovadamente entregue) + refetchOnWindowFocus
  + staleTime 15s. O realtime da tabela `messages` não disparava o badge no DB
  live; piggyback no sininho garante que acenda junto.
- **Perf loja (2026-06-15) — LIVE.** `useProducts` filtra busca debounced
  (250ms); `ProductsList` renderiza em janela (40 cards, cresce via
  IntersectionObserver) em vez de montar a lista flat inteira (~4k).

- **RELEASE_AUDIT.md (2026-06-11) — 9 blockers atacados.** Auditoria de
  release nas lojas (Apple App Store + Google Play) em `RELEASE_AUDIT.md`.
  Status atual:
  - **C1 Billing platform**: abstração em `next-app/lib/services/billing-platform.ts`
    detecta web/iOS-wrapper/Android-wrapper e roteia checkout pra
    MP/StoreKit/Play Billing. `/api/play-billing-verify` e
    `/api/apple-iap-verify` são STUBS (aceitam token sem call ao server
    do Apple/Google) — TODO antes de production. Doc: `docs/BILLING_STRATEGY.md`.
  - **C2+C7 iOS scaffold**: `capacitor.config.ts` + `ios/App/App/Info.plist`
    + `ios/App/App/PrivacyInfo.xcprivacy` + `AppDelegate.swift` versionados.
    Falta user instalar Capacitor + rodar `npx cap add ios` em macOS +
    Xcode. Doc: `docs/IOS_BUILD.md`.
  - **C3 Android TWA**: `twa-manifest.json` raiz, `docs/ANDROID_BUILD.md`.
    `.well-known/assetlinks.json` tem SHA-256 + package_name placeholders;
    user precisa gerar keystore via `bubblewrap build` e atualizar.
  - **C4 CSAM (SQL Wave 29)**: tabelas `media_hash_blocklist` +
    `media_review_queue` + coluna `posts.media_hash`. `/api/moderate` agora
    aceita `mediaUrl`, calcula hash SHA-256, checa blocklist (curto-circuita
    Gemini em hit), enfileira review em severity hard+. Admin queue em
    `/admin/media-review`. **SQL JÁ EXECUTADO (2026-06-12).** Falta o
    Cloudflare CSAM Scanning Tool: **NÃO é toggle de painel** (a página
    `/stream/csam` carrega em branco) — exige opt-in legal manual, o
    titular da conta tem que contatar o suporte CF ou mandar email pra
    `cloudflare-csam@cloudflare.com` e assinar o NCMEC Reporting
    Agreement. Doc: `docs/CSAM_POLICY.md`.
  - **C5 age gate <16**: `MIN_AGE=16` em `lib/schemas.ts`, `birthDateSchema`
    obrigatório no signup, revalidação server-side em `signup.ts`. Tests
    cobrindo. ✓ Live.
  - **C6 email verification enforce**: `AuthProvider.emailVerified`
    bloqueia `usePublishPost`, `useComments.add`, `useSendMessage`.
    `<EmailVerifyBanner>` amarelo global com botão reenviar. ✓ Live.
  - **C8 Push Notifications (SQL Wave 30)**: Web Push API end-to-end —
    VAPID JWT ES256 + aes128gcm AES-GCM em `/api/push-notify` (zero deps).
    Tabela `push_subscriptions` + RLS user-owned + trigger pg_net dispara
    push em insert de `notifications`. `<PushOptIn>` no ProfileFooter.
    **SQL RODADO e a corrente PROVADA EM PRODUÇÃO (2026-09-05):** o push
    nativo chegou no aparelho, o que exige `push_subscriptions`,
    `push_device_tokens`, o trigger `trg_dispatch_push_notification`, o
    `pg_net` e as chaves `push_notify_url`/`push_internal_secret` em
    `app_settings` — tudo conferido `true` no banco. O que NÃO está provado
    é o canal WEB push (VAPID): os dois canais são independentes, e o nativo
    funcionar não diz nada sobre o do navegador. Falta gerar VAPID keys e setar 4 ENVs no
    CF Pages: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
    `VAPID_SUBJECT`, `PUSH_INTERNAL_SECRET`. Doc: `docs/PUSH_NOTIFICATIONS.md`.
    iOS: só funciona iOS 16.4+ em modo PWA "Adicionar à Tela de Início".
  - **C9 `/delete-account` web URL**: página pública pra Google Play Policy
    2023. Logado: renderiza DeleteAccountSection. Deslogado: CTA login
    com `?next=/delete-account` (whitelist em `LoginForm`). ✓ Live.
- **5 CRITICALs do audit 2026-06-12 FECHADOS.** Detalhes em
  `next-app/lib/utils/sanitize.ts`, `next-app/lib/auth-server.ts`,
  `next-app/lib/api/env-check.ts` e nos commits `22b6dc9`, `91927d2`,
  `650e7b8`, `047a147`, `948c21a`:
  - **CRIT-1 IAP stubs**: `/api/{play-billing,apple-iap}-verify` agora
    retornam 503 sem `IAP_PRODUCTION_VERIFICATION_ENABLED=true`. NÃO
    setar essa env até implementar verificação real (Google Play
    Developer API + Apple verifyReceipt).
  - **CRIT-2 MP webhook**: fail-closed em prod sem `MP_WEBHOOK_SECRET`.
    Rejeição vai pra `audit_log` (`action='mp.webhook.rejected_no_secret'`).
  - **CRIT-3 XSS Search**: `sanitizeSearchSnippet()` no frontend
    (escape HTML + sentinelas `⟦HL_OPEN⟧`/`⟦HL_CLOSE⟧` viram `<b>`).
    **SQL Wave 31 JÁ EXECUTADO** (`search_all` recria com sentinelas
    no `ts_headline`). Defesa em profundidade ativa.
  - **CRIT-4 Admin RSC auth**: `requireAdminServer()` em todas as 6
    pages `/admin/*`. Login agora grava cookie httpOnly
    `sb-session-token` via `/api/auth/set-session-cookie` (POST=set,
    DELETE=clear no signOut). **Admins precisam logar uma vez após
    o deploy pra gerar o cookie.** Sessões anteriores não habilitam
    `/admin/*` (vão pra 404).
  - **CRIT-5 requirePro fail-closed**: `requirePro()` e `gateAiUsage()`
    em prod sem `SUPABASE_SERVICE_ROLE_KEY` retornam 503. Boot check
    `assertProductionEnvs()` chama no module-load do `security.ts`;
    em vitest skipa salvo `{ force: true }`.
- **Fase 4 etapa 2 da modularização: COMPLETA (2026-05-31).** `app.js`
  caiu de **9176 → 1299 linhas (-86%)**. 338 funções foram extraídas em
  44 módulos sob `modules/*.js` (cada um é um IIFE registrando
  `window.Modules.X`). O bridge `shims.js` republica
  `Modules.X.fn → window.fn` (+ `Utils.X → window.X`) e carrega ANTES do
  `app.js` no `index.html` pra que bare calls em boot-code já tenham as
  globals wireadas. **HTML inline handlers (`onclick="loadFeed()"`)
  continuam funcionando** — toda função visível ao HTML segue exposta como
  `window.X` via shim. NÃO refatorar HTML pra `addEventListener` sem
  necessidade; o padrão IIFE+shim é deliberado pra preservar o contrato.
  85 testes unitários cobrem o que migrou (shims + policies + db +
  schemas + security). Para detalhes ver `ARCHITECTURE.md`.
- **Sentry** **JÁ ESTÁ CONECTADO ao GitHub do projeto** (integração de
  releases/commits/issues entre Sentry ↔ GitHub). Convive com a tabela
  caseira `errors` + dashboard `/admin/errors`; ainda não há decisão se o
  Sentry vira a fonte primária ou só complemento. Se o usuário quiser ligar
  o DSN do Sentry no frontend (sendo carregado pelo browser) ou no
  `/api/log-error` (forwarding server-side), perguntar a variável de env
  exata (`SENTRY_DSN` provavelmente) e os hosts permitidos no CSP
  (`https://*.sentry.io` em `connect-src`).
- O SQL de correção do cadastro ("Database error saving new user" — gatilho
  `handle_new_user` + colunas de `profiles`) **JÁ FOI EXECUTADO no Supabase**.
  Não perguntar de novo nem pedir para rodar.
- Regra de fluxo: após cada correção/melhoria concluída, fazer commit no
  branch de trabalho e **merge para `main`** automaticamente (deploy do
  Cloudflare Pages é automático a partir do `main`).
- **Preview deploys do Cloudflare Pages**: toda branch que NÃO é `main`
  ganha um preview deploy automático em `<branch-slug>.queroumacorapp.pages.dev`.
  Pra features arriscadas (mudanças visuais, fluxos críticos, refactors),
  testar primeiro no preview antes do merge. App mostra banner amarelo
  "🧪 STAGING" no topo quando rodando fora de `queroumacor.com.br`. Detalhes
  do workflow em `STAGING.md`.
- **Após cada merge pra `main`**, aguardar a janela típica de deploy do
  Cloudflare Pages (~90s a partir do push) usando Bash com `run_in_background`
  (`sleep 90 && echo deploy-pronto`) e, quando a notificação chegar, avisar o
  usuário que **provavelmente** está no ar — sendo explícito que é tempo
  decorrido, não confirmação real (egress do container bloqueia
  `queroumacor.com.br` com `host_not_allowed`, e o GitHub MCP não expõe status
  de deploy do Cloudflare Pages). Pedir confirmação do lado do usuário.
- Branch de trabalho atual: `claude/new-session-V0v78`.
- `OPENAI_API_KEY` **e** `GEMINI_API_KEY` **já estão configuradas no Cloudflare
  Pages**. Não perguntar de novo. (Usadas por `chat-ai.js` e
  `resolve-color.js`.)
- A coluna `products.image_url` (text) **já foi criada no Supabase**. Upload
  de foto de produto pelo portal já funciona. Não pedir para rodar o SQL.
- O SQL de persistência total (tabela `checklists` + colunas
  `profiles.service_radius` e `profiles.archived_conversations`) **JÁ FOI
  EXECUTADO no Supabase**. Checklist de obra, raio de atendimento e
  conversas arquivadas agora persistem no banco. Não pedir para rodar de
  novo. Nenhum dado de usuário fica só em `localStorage` (o que sobra lá
  são apenas caches cuja fonte de verdade já é o Supabase).
- O SQL do carrinho e estados de usuário (colunas `profiles.cart`,
  `profiles.ai_logo_gen_count` e `profiles.seen_stories`) **JÁ FOI
  EXECUTADO no Supabase**. Carrinho da loja, contador de logo IA e
  stories vistos persistem no banco. Não pedir para rodar de novo.
- Cores de produto: o botão "Preencher cores (IA)" no portal grava
  `products.color_hex` (IA primeiro, dicionário como fallback). Rodar
  **uma vez**; depois manutenção é manual via seletor de cor. O botão só
  toca em produtos sem cor — seguro reapertar.
- O SQL dos 3 furos de integração (coluna `profiles.review_count`,
  policy de INSERT em `referrals`, triggers `award_referral_points` e
  `recalc_painter_rating`) **JÁ FOI EXECUTADO no Supabase**. Indicações
  gravam linha em `referrals`, pontos por indicação/avaliação recebida
  são creditados por trigger, e `profiles.rating_avg` + `review_count`
  recalculam a cada review. Não pedir para rodar de novo.
- As tabelas `notes` (anotações) e `notifications` (sininho) **JÁ FORAM
  CRIADAS no Supabase** (com RLS e realtime). Anotações salvam/carregam
  e os avisos do `notify()` chegam no sininho. Não pedir para rodar de
  novo.
- **Dados oficiais da Cali Colors (operadora/dona do QueroUmaCor)**:
  - Razão social: **CALICOLORS TINTAS LTDA**
  - CNPJ: **47.677.346/0001-92**
  - Endereço: **Est. Presidente Juscelino Kubitschek de Oliveira, 1071**
  - Bairro: **Jardim dos Pimentas**
  - Cidade/UF: **Guarulhos/SP**
  - CEP: **07.272-345**

  Usar esses dados nos documentos legais (termos, privacidade, sobre),
  metadados do Play Console / App Store, headers do CNPJ no PDF de
  orçamento se o pintor for da Cali Colors, e onde mais precisar de
  identificação formal do controlador LGPD. Já gravados em
  `next-app/app/info/privacidade/page.tsx`, `.../termos/page.tsx`,
  `.../sobre/page.tsx`.

- **Contato da Cali Colors** (atendimento / suporte / "Fale Conosco" /
  solicitações de exclusão de conta LGPD): WhatsApp `(11) 95976-5031`
  (formato wa.me `5511959765031`), e-mail `loja@calicolors.com.br`. Já
  configurado no objeto `SUPPORT` em `app.js`. Usar esse contato sempre
  que precisar de um canal de atendimento/suporte no app.
- **Cache-busting (IMPORTANTE):** `index.html` carrega `head.js` e
  `app.js` com `?v=AAAAMMDD<letra>` (ex.: `?v=20260522a`). **SEMPRE que
  mudar `app.js` ou `head.js`, bump esse `?v=`** nas duas tags `<script>`
  (ex.: `20260522a` → `20260522b`). Se não bumpar, o navegador serve o JS
  velho do cache e a correção não chega no usuário.
- **Regra de SQL:** sempre que criar ou alterar qualquer SQL/migration,
  **colar o conteúdo completo do SQL no chat, em texto** (bloco de código),
  para o usuário copiar e rodar no Supabase SQL Editor. Criar só o arquivo
  no repo não basta — o SQL tem que aparecer no chat. Claude não tem acesso
  ao banco para rodar.
- **SQL Wave 3 (hardening pós-auditoria 26/05) JÁ FOI EXECUTADO no Supabase.**
  Inclui: trigger `protect_profile_columns` BEFORE INSERT OR UPDATE (impede
  escalada de `is_pro`/`portal_access`/`role=admin` via INSERT), UNIQUE em
  `points(source, reference_id)` (anti double-credit), policies de SELECT
  restritas a `authenticated` em `follows`/`likes`/`comments`/`qualifications`/
  `courses`, view `announcements_public` (esconde `created_by`), policy
  deny-all em `rate_limits`, restauração do SELECT público de `reviews`, e FK
  `announcements.created_by` com `ON DELETE SET NULL`. Não pedir para rodar
  de novo.
- **Coluna `profiles.birth_date` (date) JÁ FOI CRIADA no Supabase.** Campo
  preenchido no signup, sem bloqueio etário. Não pedir para rodar de novo.
- **Mailbox `loja@calicolors.com.br` está ativa e responde.** Não perguntar.
- **Turnstile (CAPTCHA)** — está carregado no `index.html` mas nenhum
  endpoint server-side valida o token (`siteverify`). O usuário pediu para
  deixar assim por enquanto. Não wirar a validação sem ele pedir.
- **Google Search Console verificado** via DNS TXT em `queroumacor.com.br`.
  Meta tag também está no `<head>` do `index.html`. Sitemap submetido em
  `https://www.queroumacor.com.br/sitemap.xml`. Não mexer/remover a meta tag.
- **HSTS preload — SUBMETIDO (2026-05-31).** Header em `_headers` agora é
  `max-age=31536000; includeSubDomains; preload`. **Pegadinha resolvida**:
  Cloudflare Edge HSTS (SSL/TLS → Edge Certificates → HSTS) estava
  sobrescrevendo o `_headers` com a flag Preload OFF — foi ativado no
  painel CF. Domínio `queroumacor.com.br` submetido em hstspreload.org,
  validado verde, na fila pra entrar na preload list do Chromium
  (~semanas-meses pra propagar via update de Chrome → Firefox/Safari).
  **Não submeter outros subdomínios sem garantir HTTPS perpétuo** —
  remoção da preload list leva 6+ meses.
- **DMARC pendente em `calicolors.com.br`** (não-bloqueante). O domínio
  `queroumacor.com.br` já tem DMARC `p=reject`. Falta o usuário adicionar
  no GoDaddy o TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:dpo@calicolors.com.br`.
  Não é code-actionable — só ele pode mexer no DNS.
- **SQL Wave 4 — tabelas `reports` e `feature_interest` JÁ FORAM CRIADAS no
  Supabase.** Fixa 2 bugs achados na auditoria de rede social: (1) `app.js
  submitReport()` que estourava erro porque a tabela `reports` não existia;
  (2) `app.js abrirMaquininha/entrarListaMaquininha` que perdiam silenciosamente
  os cliques de interesse (tabela `feature_interest` inexistente). Não pedir
  para rodar de novo.
- **SQL Wave 5 (2026-05-31) — JÁ EXECUTADO no Supabase.** Tabelas
  `consent_log` (LGPD trilha de consentimento por tipo/versão, RLS user-owned),
  `audit_log` (auditoria de ações administrativas — admin reads via
  `is_portal_admin()`; convive com `audit_events` granular trigger-driven),
  `invite_codes` (expiração default 30 dias + `invite_code_valid(text)` RPC),
  função `cleanup_orphan_media()` + `execute_cleanup_orphan_media()`
  (admin-only, deleta arquivos do bucket `posts` sem post referenciando, com
  janela de 7 dias). Cleanup retroativo de `audit_log > 1 ano` via
  `cleanup_old_audit_log()`. Migration única em
  `/migrations/2026-05-31-consent-audit-invites-cleanup.sql`. Client TS de
  consent em `next-app/lib/services/consent.ts`. Trocar para "JÁ EXECUTADO"
  após o usuário rodar no SQL Editor.
- **Bucket Supabase `style-refs` JÁ FOI CRIADO** (público pra leitura, com
  policy `"style-refs public read"` em `storage.objects` só pra SELECT, sem
  policy de INSERT/UPDATE/DELETE — só o endpoint `/api/upload-style-ref`
  escreve via `service_role` depois de validar `ADMIN_EMAILS`). Usado pela
  feature "Arte pra Instagram" pra armazenar templates visuais por estilo
  (`profissional.jpg`, `trabalho.jpg`, `antesdepois.jpg`) que admin sobe pelo
  botão ✏️ no tile. Backend `ig-art.js` carrega de lá primeiro, com fallback
  pra `/style-refs/<key>.jpg` no repo. Não pedir pra rodar SQL desse bucket
  de novo.
- **Plano Supabase: PRO ($25/mês).** Não estamos mais no free tier. Recursos
  adicionais: 8GB DB, 50GB bandwidth, 7 dias de PITR (point-in-time recovery),
  100GB storage, sem project pause por inatividade, log retention de 7 dias.
  Quando sugerir feature que precisa de mais compute / storage / backup,
  pode contar com isso.
- **Plano Cloudflare: PRO.** Recursos adicionais disponíveis: WAF managed
  rules customizáveis, Image Resizing/Polish, mobile redirect, web analytics
  RUM, page rules adicionais. Workers/Pages tem cota maior. Quando sugerir
  feature de perf/edge (image optim, custom WAF rule), pode contar com isso.
- **Backlog / roadmap:** ver `BACKLOG.md` na raiz. Lista categorizada de
  features pendentes (sociais estilo IG, perf, observability, segurança
  externa). Sempre consultar antes de propor features novas — se já está
  no backlog, referenciar pelo ID (ex.: "atacar S1 + S6 do BACKLOG.md").
- **NUNCA consultar o MCP Supabase no queroumacor** a menos que o usuário
  peça explicitamente. O MCP atual está conectado a OUTRO projeto Supabase
  (não o queroumacor `uwqebaqweehiljsqkifm.supabase.co`), então qualquer
  `execute_sql`/`list_tables`/`apply_migration` via MCP vai pro projeto
  errado. Pra mexer em SQL do queroumacor, colar o SQL no chat e o usuário
  roda no SQL Editor.
- **Bucket `posts` agora aceita vídeo.** `allowed_mime_types` inclui
  `image/jpeg|png|webp|gif|heic|heif` + `video/mp4|quicktime|webm`, e
  `file_size_limit` em 50 MB. SQL já foi rodado no SQL Editor. Frontend
  já manda `contentType` explícito no upload. Não pedir pra rodar de novo.
- **`profiles.tag` e `profiles.username` agora são sinônimos sincronizados
  automaticamente.** SQL já rodado: trigger `sync_profile_tag_username`
  BEFORE INSERT/UPDATE preenche o lado vazio com o outro e propaga
  mudanças entre os dois campos. View `profiles_public` projeta
  `tag = coalesce(tag, username)` e `username = coalesce(username, tag)`,
  então frontend continua usando `p.tag` (e o app só escreve em `tag`) —
  pega valor de qualquer coluna que esteja preenchida. View NÃO tem mais
  as colunas `palette` nem `country` (não existem no banco real, foram
  removidas em algum momento). Não pedir pra rodar de novo.
- **SQL Wave 6 (2026-05-31) — JÁ EXECUTADO no Supabase.** Full-text
  search (Banco#9): colunas geradas `search_vector tsvector` em `posts`
  (caption), `products` (name + description com pesos A/B) e `profiles`
  (name + bio + tag com pesos A/B/A), todas com índice GIN. Função RPC
  `search_all(p_query text, p_limit int)` agrega resultados das 3 tabelas
  (com `plainto_tsquery('portuguese')`, `ts_headline` pra snippet e
  `ts_rank` pra score), filtrando posts por `status='approved'`. Migration
  única em `/migrations/2026-05-31-fulltext-search.sql`. Service TS em
  `next-app/lib/services/search.ts`, hook `useSearch` com debounce 300ms,
  página `/search` com input + grupos (Pintores/Posts/Produtos). Trocar
  para "JÁ EXECUTADO" após o usuário rodar no SQL Editor.
- **SQL Wave 7 (2026-05-31) — JÁ EXECUTADO no Supabase.**
  Hardening pagamentos/subscription (Pagamentos#11, #17, #18, #19):
  (1) tabela `invoices` (rastreio de cobrança/refund pra conciliação MP, RLS
  user-owned read; write só via service_role); (2) coluna
  `profiles.pro_grace_until` + função `is_pro_active(uuid)` que considera
  grace period de 3 dias (canSeeProFeature client + gateAiUsage server-side
  usam); (3) tabela `ai_usage` (audit de uso de IA por feature, RLS
  user-owned read; write só via service_role) + RPC
  `ai_usage_this_month(uuid, text?)`; (4) tabela `plan_limits` (free=30,
  pro=500, admin=99999 calls/mês, public read); (5) trigger
  `handle_invoice_paid` (transição `invoices.status → 'paid'` em
  type=subscription propaga `is_pro=true + pro_expires_at +30d` no profile);
  (6) RPC `upsert_invoice(...)` (idempotente por `external_id`, usado pelo
  mp-webhook). Migration única em
  `/migrations/2026-05-31-payments-hardening.sql`. Service novo em
  `next-app/lib/services/billing.ts`; helpers REST edge-friendly em
  `next-app/lib/api/_services/_billing-helpers.ts`; security wrapper
  `gateAiUsage` + `recordAiUsage` em `next-app/lib/api/security.ts`. Todas
  as 14 rotas de IA (`chat-ai`, `caption`, `transcribe`, `tts`,
  `generate-logo`, `area-from-photo`, `pricing-suggest`, `fin-analysis`,
  `crm-draft`, `agenda-order`, `resolve-color`, `moderate`,
  `moderate-video`, `ig-art`) agora chamam `gateAiUsage` antes da IA e
  `recordAiUsage` depois do sucesso. `policies.ts canSeeProFeature` foi
  estendida pra considerar `pro_grace_until`. 21 testes novos em
  `__tests__/services/billing.test.ts` + 5 testes novos em
  `__tests__/policies.test.ts`. Trocar para "JÁ EXECUTADO" após o usuário
  rodar no SQL Editor.
- **SQL Wave 8 (2026-05-31) — soft delete + undo — JÁ EXECUTADO no
  Supabase.** Mira UX#5 (undo de delete) + Banco#13 (soft delete em vez de
  hard). Adiciona coluna `deleted_at timestamptz` em `posts`, `notes`,
  `messages`, `comments`, `quotes`, `checklists`. Atualiza policies de
  SELECT pra esconder rows soft-deleted; admin (`is_portal_admin()`) e
  owner ainda enxergam pra desfazer/auditoria. Indexes parciais
  `idx_<tbl>_active` (`WHERE deleted_at IS NULL`) otimizam queries normais.
  Função `cleanup_soft_deleted()` (SECURITY DEFINER, GRANT só pra
  `service_role`) faz hard delete em rows soft-deleted > 30 dias — chamar
  por cron (pg_cron) ou manualmente. Frontend só em `next-app/`: services
  `postInteractions.deletePost/undoDeletePost/softDeleteComment/undoDeleteComment`,
  `notes.softDeleteNote/undoDeleteNote`, `chat-messages.softDeleteMessage/undoDeleteMessage`,
  todos retornam `{ undoToken }`. Hooks `useDeletePost`, `useDeleteComment`,
  `useDeleteMessage`, `useNotes` expõem `remove + undo`. UI: componente
  `<UndoSnackbar message onUndo>` (countdown 10s) + hook genérico
  `useUndoable<TArgs>` empacotando ciclo. Migration única em
  `/migrations/2026-05-31-soft-delete.sql`. Trocar para "JÁ EXECUTADO"
  após o usuário rodar no SQL Editor.
- **SQL Wave 15 (2026-06-09) — índices de perf — JÁ EXECUTADO no
  Supabase.** 3 índices parciais cobrindo caminho crítico:
  `idx_comments_post_active_created` (post_id + created_at WHERE
  deleted_at IS NULL) acelera `fetchComments`;
  `idx_notifications_user_unread_created` (user_id + created_at WHERE
  read=false) acelera o badge do sininho;
  `idx_posts_approved_active_created` (created_at WHERE status=approved
  AND deleted_at IS NULL) acelera o feed "Todos". Criados
  CONCURRENTLY (sem lock). Migration em
  `/migrations/2026-06-09-perf-indexes.sql`. Não pedir pra rodar de novo.
- **SQL Wave 16 (2026-06-09) — RPC `get_feed_v2` — JÁ EXECUTADO no
  Supabase.** Função SQL agregando posts + autor + like_count +
  comment_count + liked_by_me + saved_by_me + top 3 comments em UMA
  chamada. Substitui o trio Wave A + Wave B do `fetchFeed` (5
  round-trips → 1). **A função existe mas o frontend AINDA NÃO chama
  ela** — swap em `next-app/lib/services/feed.ts:127 fetchFeed()` é a
  Sprint 1.5 (ficou pendente porque user pulou pro Sprint 2 antes).
  Migration em `/migrations/2026-06-09-rpc-get-feed-v2.sql`. Não pedir
  pra rodar SQL de novo.
- **B7 (Web Vitals RUM via Sentry) — DEPLOYADO em 2026-06-09.**
  `sentry.client.config.ts` agora carrega `browserTracingIntegration`
  com `tracesSampleRate: 1.0`. Sentry → Performance → Web Vitals
  começa a popular ~24h depois do primeiro acesso. Não mexer no sample
  rate sem checar quota.
- **B2 (Cloudflare Image Resizing) — LIGADO E FUNCIONANDO, verificado em
  2026-09-05.** Helper `next-app/lib/cfImg.ts` reescreve URLs pra
  `/cdn-cgi/image/w=...,q=85,f=auto/<original-url>`; Avatar e PostMedia usam
  srcset 1x/2x/3x. Ficou meses anotado como "requer toggle no painel" sem
  ninguém conferir.
  - **COMO CONFERIR (mede o EFEITO, não a configuração):** abrir
    `https://queroumacor.com.br/cdn-cgi/image/w=64,f=auto/https://queroumacor
    .com.br/icon-192.png`. Imagem pequena = ligado. 404 **comum** = desligado.
  - **PEGADINHA que quase virou conclusão errada:** com uma origem inexistente
    a resposta é `ERROR 9404: ... HTTP error 404`. Ler só o "404" diz
    "desligado" — mas o prefixo `ERROR 9xxx` é emitido PELO Image Resizing,
    ou seja, prova o contrário. Desligado devolve 404 seco, sem o código.
    Usar uma origem que EXISTE (`/icon-192.png`) evita a ambiguidade.
- **SQL Wave 17 (2026-06-09) — width/height em posts (CLS=0) — JÁ
  EXECUTADO no Supabase.** P4 do BACKLOG. Adiciona `posts.media_width`
  e `posts.media_height` (int, opcionais). `usePublishPost` captura
  W/H da primeira imagem via `readImageDimensions()` antes do upload e
  grava no insert. `PostMedia` seta `width={...} height={...}` no
  `<img>` quando presente — browser reserva espaço exato e CLS = 0.
  Posts antigos sem W/H caem no `aspect-ratio: 1/1` CSS (sem
  regressão). RPC `get_feed_v2` foi DROP+CREATE pra incluir as 2
  colunas no RETURNS TABLE. Migration em
  `/migrations/2026-06-09-posts-media-dimensions.sql`. Não pedir pra
  rodar de novo.
- **SQL Wave 18 (2026-06-09) — policies admin pra `reports` — JÁ
  EXECUTADO no Supabase.** O3 do BACKLOG. Adiciona `reports_select_admin`
  e `reports_update_admin` (USING/WITH CHECK `is_portal_admin()`).
  Convive com as policies restritivas existentes via OR. Dashboard em
  `/admin/reports` (RSC shell + `ReportsAdmin` client component) lista
  denúncias por status (pending/reviewed/resolved/dismissed/all) com
  botões Resolver/Dispensar/Marcar revisado. Service em
  `next-app/lib/services/adminReports.ts`. Migration em
  `/migrations/2026-06-09-admin-reports-policies.sql`. Não pedir pra
  rodar de novo.
- **S13 (Modo escuro) — REINTRODUZIDO como OPT-IN (2026-06-18, a pedido
  do usuário).** Foi revertido em 2026-06-10 (commit `d0d0e7d`) e voltou
  agora. App continua **claro por padrão**; o escuro só liga quando o
  usuário ativa o `ThemeToggle` (`components/ThemeToggle.tsx`, renderizado
  no `ProfileFooter`). Hook `lib/hooks/useTheme.ts` (recriado) grava
  `localStorage.theme`; o script inline no `<head>` do `layout.tsx` lê a
  chave antes do paint e seta `data-theme` (`dark` só se salvo
  explicitamente — NÃO seguimos `prefers-color-scheme`). Os tokens dark
  vivem em `:root[data-theme='dark']` no `globals.css` (Tailwind v4 compila
  `bg-white`/cores arbitrárias pra `var(--color-*)`, então sobrescrever os
  tokens cobre quase tudo). `--color-ink-fixed` NÃO inverte (TopNav/
  BottomNav/ProfileHeader seguem escuros com texto branco fixo). Pendência
  conhecida menor: 3 badges em `/admin/*` usam `bg-gray-100 text-gray-700`
  (pílula clara em página escura, mas texto escuro = legível; admin-only).
- **SQL Wave 19 (2026-06-09) — policy admin pra `feature_interest` —
  JÁ EXECUTADO no Supabase.** O2 do BACKLOG. Adiciona
  `feature_interest_select_admin` (SELECT TO authenticated USING
  `is_portal_admin()`). Sem UPDATE/DELETE — tabela é append-only.
  Dashboard em `/admin/feature-interest` (RSC shell +
  `FeatureInterestAdmin` client component) mostra resumo agregado por
  feature (count + último click) com drill-down em lista de cliques
  recentes (usuário + ação + contato + tempo). Service em
  `next-app/lib/services/adminFeatureInterest.ts`. Migration em
  `/migrations/2026-06-09-admin-feature-interest-policy.sql`.
- **Telemetria fetchFeed (Sprint 4 polish) — DEPLOYADO em 2026-06-09.**
  `lib/services/feed.ts` agora chama `addFeedBreadcrumb()` em 3 caminhos:
  `rpc_ok` (sucesso, com row count), `rpc_error` (RPC retornou error,
  fallback legacy), `rpc_throw` (RPC throw, fallback). Breadcrumb vai
  pro Sentry e aparece como contexto em qualquer erro futuro do feed.
  Usar pra decidir quando remover o fallback legacy: se Sentry mostra
  só `rpc_ok` por semanas → seguro firmar.
- **SQL `/migrations/2026-06-09-perf-indexes-check.sql` — NÃO É
  MIGRATION, é auditoria.** Roda EXPLAIN ANALYZE nas 3 queries
  esperadas pelos índices Wave 15 + lista tamanho/scan count via
  `pg_stat_user_indexes`. Cole no SQL Editor pra confirmar que os
  índices estão sendo escolhidos pelo planner. "Seq Scan" no plano =
  índice não cobre, refazer.
- **SQL Wave 22 (2026-06-09) — boost + trending (S11/S12) — JÁ
  EXECUTADO no Supabase.** Coluna `posts.boosted_until timestamptz`
  (NULL = sem destaque) + índice parcial
  `idx_posts_boosted_active WHERE boosted_until > now()`. RPCs:
  `boost_post(uuid, int days=7)` valida ownership + PRO/portal, atomic
  swap (limpa boost ativo anterior do mesmo user antes de aplicar; 1-30
  dias); `unboost_post(uuid)` cancela. `get_feed_v2` recriada
  inserindo até 3 posts boosted no TOPO da PRIMEIRA página (cursor
  NULL); páginas seguintes não inflam — boosted reaparece só por
  created_at. `get_trending_posts(limit, window_days)` retorna posts
  ordenados por score = likes_window + 3*comments_window, exclui
  blocked do user logado, default 7 dias. Frontend: serviços
  `boost.ts` + `trending.ts`, badge "Em destaque" no topo do PostCard
  com gradient laranja, menu opt "Destacar 7 dias (PRO)" / "Remover
  destaque" no opts (só dono), página `/explore` (RSC + client
  `TrendingGrid`) grid 3 colunas com score no canto, atalho
  "Em alta esta semana" no `/search` quando input vazio.
  Migration em `/migrations/2026-06-09-boost-trending.sql`.
- **SQL Wave 23 (2026-06-09) — fix B1 badge verified no feed — JÁ
  EXECUTADO no Supabase.** `get_feed_v2` (Wave 22) omitia `verified` no
  jsonb_build_object do author, então o badge ✓ S1 (Wave 20) só
  renderizava no fallback legacy. DROP+CREATE adicionando
  `'verified', pr.verified` no author_json. Toda a lógica de
  boosted_until + blocks idêntica à Wave 22. Migration em
  `/migrations/2026-06-09-feed-verified-fix.sql`. Não pedir pra rodar
  de novo.
- **SQL Wave 24 (2026-06-10) — unread chat (TopNav badge) — JÁ
  EXECUTADO no Supabase.** Coluna `messages.read_at timestamptz`
  (NULL = não lida) + índice parcial `idx_messages_receiver_unread`
  (receiver_id + created_at WHERE read_at IS NULL AND deleted_at IS
  NULL). RPCs `mark_conversation_read(p_conv_id text)` (SECURITY
  DEFINER, marca todas as msgs da conv onde receiver = auth.uid()) e
  `unread_message_count()` (count total do user logado). Frontend:
  service `chat-messages.markConversationRead/fetchUnreadMessageCount`,
  hook `useUnreadMessageCount` (espelha o de notif: COUNT + realtime
  subscribe em messages filtered by receiver_id), TopNav lê do hook e
  renderiza badge com número (99+ pra >99) — prop `hasUnreadChat`
  removida (era sempre false). ChatConversation chama
  `markConversationRead` em useEffect ao montar. Migration em
  `/migrations/2026-06-10-messages-read-at.sql`.
- **SQL Wave 25 (2026-06-10) — variantes de tamanho de produto — JÁ
  EXECUTADO no Supabase.** Tabela `product_variants(id, product_id FK
  products ON DELETE CASCADE, size_label text, volume_ml int, price
  numeric CHECK >= 0, stock int, sort_order int, created/updated_at)`
  com UNIQUE em (product_id, size_label), índice
  idx_product_variants_product_sort, trigger updated_at via
  set_updated_at(). RLS: SELECT public (anon+authenticated) pra
  catálogo aberto; INSERT/UPDATE/DELETE só `is_portal_admin()`. Modelo
  1:N — products.price segue valendo como fallback quando o produto
  não tem variantes cadastradas (compat). Frontend: service
  `fetchProductVariants` (cast manual pq tabela ainda não está no
  schema TS gerado, rodar `supabase gen types` depois), hook
  `useProductVariants`, ProductDetailSheet renderiza seletor visual
  de chips quando há variantes (cada chip mostra label + preço,
  clique muda preço/CTA). addItemToCart compõe id do CartItem como
  `productId:variantId` pra cada tamanho contar como linha separada
  no carrinho. CartItem já mostra `volume` que agora carrega
  size_label. Base atual da Cali Colors tem 4171 produtos SEM
  variantes — admin precisa popular `product_variants` pra ativar
  seletor (decisão pendente: botão "Gerar variantes" no admin ou
  SQL bulk com regra de preço por proporção). Migration em
  `/migrations/2026-06-10-product-variants.sql`.
- **SQL Wave 26 (2026-06-10) — biblioteca de artes (AR Grafite) — JÁ
  EXECUTADO no Supabase.** Tabela `art_references(id, user_id FK
  profiles ON DELETE CASCADE, title, image_url, tags text[], width,
  height, created/updated_at)` com índices b-tree em (user_id,
  created_at DESC) e GIN em tags, RLS owner-only, trigger updated_at.
  Bucket Supabase Storage `art-refs` (criado pela UI: public read,
  20MB, mime jpeg/png/webp) com policies em `storage.objects` gating
  por `split_part(name, '/', 1) = auth.uid()::text` (path pattern
  `userId/uuid.ext`). Sprint 1 da feature AR Grafite: pintor/grafiteiro/
  admin sobe imagens em `/perfil/grafites` (tile na BusinessGrid
  '🎨 AR Grafite' via ROLE_TILES + ROUTE_TILES pra navegar em vez de
  bottom-sheet). Service `artReferences.ts` faz upload no bucket +
  insert na tabela; cast manual no `from` (tabela fora do schema TS
  gen). Hook `useArtReferences`. **Sprint 2 entregue (2026-06-10)**:
  componente novo `ArtAROverlay` (`app/perfil/grafites/ArtAROverlay.tsx`)
  — câmera ao vivo via getUserMedia (back facing), `<img>` absoluto
  com transform translate/scale/rotate sobre vídeo, touch handlers
  (1 dedo = drag, 2 dedos = pinch + rotate), slider de opacidade
  (10-100%), botão Capturar que composita vídeo + imagem num canvas
  e baixa PNG. Botão "🪄 Projetar na parede" em cada card da
  biblioteca abre o overlay. Migration em
  `/migrations/2026-06-10-art-references.sql` (versão atualizada sem
  INSERT INTO storage.buckets — bucket criado via UI). SQL rodado em
  6 blocos separados pra contornar erro 42601 com `text[] NOT NULL
  DEFAULT '{}'` em alguns editores Supabase managed; default usado foi
  `ARRAY[]::text[]`.
- **SQL Wave 27 (2026-06-10) — RLS hardening pós LAUNCH_AUDIT — JÁ
  EXECUTADO no Supabase.** Fecha os 4 blockers críticos B2-B5 do
  `LAUNCH_AUDIT.md`:
  (B2) `orders` INSERT/UPDATE com `auth.uid()=user_id` no WITH CHECK
  (antes era `WITH CHECK (true)` — user A podia criar order pra B);
  (B3) `messages` ganha UPDATE policy (sender/receiver), SELECT filtra
  `deleted_at IS NULL` (admin via `is_portal_admin()` ainda enxerga);
  (B4) `quotes` SELECT restrito a `client_id` + `painter_id` + admin
  (antes USING `true` expunha phone/address de leads — LGPD);
  (B5) storage `posts` + `avatars` com path validation
  `split_part(name, '/', 1) = auth.uid()::text` (antes qualquer auth
  user podia escrever em qualquer path — path traversal). Path pattern
  `{userId}/...` já era seguido por todos uploads no Next. Migration
  em `/migrations/2026-06-10-wave-27-rls-hardening.sql`. Idempotente.
- **SQL Wave 28 (2026-06-10) — pg_cron pros cleanups — JÁ EXECUTADO no
  Supabase.** Agenda automática das 3 funções de limpeza criadas em
  waves anteriores: `cleanup_old_audit_log()` diário 03:00 UTC,
  `cleanup_soft_deleted()` diário 03:30 UTC, `cleanup_orphan_media()`
  (scan, não execute) semanal domingo 04:00 UTC. Migration em
  `/migrations/2026-06-10-cron-cleanups.sql`. `cron.schedule` é
  idempotente (substitui job de mesmo nome). Inspecionar com
  `SELECT * FROM cron.job`.
- **SQL Waves 29/32/33 (2026-06-12) — JÁ EXECUTADAS no Supabase.** Pacote
  de hardening pré-produção rodado de uma vez:
  - **Wave 29 (CSAM, C4)**: `posts.media_hash` + tabelas
    `media_hash_blocklist` + `media_review_queue` (RLS admin-only via
    `is_portal_admin()`). `/migrations/2026-06-11-csam-media-hash.sql`.
    Falta o Cloudflare CSAM Scanning Tool — **opt-in legal manual**
    (email `cloudflare-csam@cloudflare.com` + NCMEC Agreement), NÃO é
    toggle de painel.
  - **Wave 32 (R-H7)**: `profiles_public` recriada SEM `portal_access`
    (não vazar identidade de admin pra spear-phishing). **A view foi
    rodada SEM as colunas `palette`/`country`** (não existem na tabela
    real) — o arquivo no repo foi corrigido pra refletir isso.
    `/migrations/2026-06-12-profiles-public-hide-admin.sql`.
  - **Wave 33 (R-H8)**: UPDATE policy `"art-refs owner update"` no bucket
    `art-refs` com path enforcement `split_part(name,'/',1)=auth.uid()`.
    `/migrations/2026-06-12-art-refs-update-policy.sql`.
- **QA fixes de produção (2026-06-12) — 2 SQLs JÁ EXECUTADOS.** Pacote de 8
  bugs do QA (BUG-01..07 + UX-04); 6 são código puro, 2 dependiam de SQL:
  - **BUG-02 (busca)**: `profiles.search_vector` recriada incluindo
    `profession` (peso A) + `specialties` (peso B) — buscar "pintor"/
    "grafiteiro"/"textura" agora casa. `search_all` inalterada.
    `/migrations/2026-06-12-search-include-profession.sql`. ✓ Live.
  - **BUG-04 (filtros de feed)**: signup grava `user_type` mas `get_feed_v2`
    filtra por `role` (ficava NULL → filtro vazio). Backfill
    `role ← user_type` + trigger `trg_sync_role_from_user_type` BEFORE
    INSERT/UPDATE (só preenche role vazio, nunca sobrescreve 'admin').
    `/migrations/2026-06-12-role-from-user-type.sql`. ✓ Live. Efeito
    colateral bom: badges de role + chat + suggestions também passam a ver
    a categoria de quem se cadastrou pelo fluxo novo.
- **LAUNCH_AUDIT.md** (na raiz do repo) — auditoria de
  production-readiness via 6 sub-auditorias paralelas. 5 blockers
  iniciais: B1 (vanilla legado) **EM ANDAMENTO** (ports `/avaliar` +
  Maquininha entregues, killswitch SW deployado, delete dos 122
  arquivos pendente); B2-B5 (RLS) **RESOLVIDOS via Wave 27**. Médios
  M6 (Seu Zé visibility), M7 (`/alice` role gate), M8 (ESLint dep
  corruption) **RESOLVIDOS**. Restantes M1-M5+M9-M10: ver audit.
- **SQL Wave 21 (2026-06-09) — plataforma social (S2/S6/S7/S8) — JÁ
  EXECUTADO no Supabase.** Tabela `blocks(blocker_id, blocked_id)` com
  UNIQUE, CHECK (blocker <> blocked), índices em ambas colunas, RLS
  owner-only (SELECT/INSERT/DELETE só pra blocker = auth.uid()). RPC
  `list_blocked_ids()` retorna uuid[] do user logado (cliente filtra
  feed/notif sem N+1). RPC `get_feed_v2` recriada incluindo filtro
  `NOT EXISTS (SELECT 1 FROM blocks WHERE blocker_id=p_user_id AND
  blocked_id=p.user_id)`. RPC nova `suggest_to_follow(limit)` retorna
  top pintores não-seguidos (exclui blocked, admin, portal_access),
  ordenando por mesma cidade > mesma UF > rating_avg > review_count >
  created_at. Frontend: serviços `blocks.ts` + `suggestions.ts`, hooks
  `useBlockedList/useBlockedIds/useBlockMutations`, componente
  `<SuggestionsList>` (renderizado no FeedView quando `posts.length=0`
  estilo IG primeira sessão), tela `/perfil/bloqueados`, item no
  ProfileFooter linkando, "Bloquear usuário" no menu opts do PostCard,
  `fetchFeed` legacy também filtra client-side via `listBlockedIds()`
  (defesa em profundidade). Parser `renderRichText(text)` em
  `lib/utils/richText.tsx` transforma `@user` em link `/perfil/<tag>`,
  `#hashtag` em link `/hashtag/<tag>`, e URLs em `<a target=_blank>`.
  Aplicado em PostCard caption + comments. Página `/hashtag/[tag]`
  (RSC + client `HashtagFeed`) lista posts via ILIKE `'%#tag%'` em
  caption — adequado pra volume médio; quando virar gargalo, adicionar
  índice GIN trigram. Migration em `/migrations/2026-06-09-blocks.sql`.
- **SQL Wave 20 (2026-06-09) — quick wins sociais (S1/S4/S5) — JÁ
  EXECUTADO no Supabase.** Adiciona `profiles.verified` (boolean, S1),
  `profiles.instagram_url` + `profiles.website_url` (text, S4),
  `posts.link_url` (text, S5). View `profiles_public` recriada
  incluindo instagram_url + website_url (públicos por design).
  Trigger `protect_profile_columns` revisado pra também impedir
  escalada de `verified=true` por usuário comum (admin-only via
  is_portal_admin). Frontend: PostCard + ProfileHeader mostram badge
  ✓ azul pra `verified || is_pro` (backward compat); EditProfileForm
  ganhou inputs Instagram + Site; ProfileHeader renderiza ícones IG+Site
  no header dark quando preenchidos (normaliza `@user` pra URL completa
  de IG); Composer mostra input "Link 'ver mais'" só em postType='story'
  e grava em `posts.link_url`; StoryViewer renderiza CTA "Ver mais"
  flutuante quando story tem `link_url`. S3 (editar caption) já estava
  implementado em `PostCard.tsx` (modal editOpen + service
  `updatePostCaption`) — item BACKLOG obsoleto. Migration em
  `/migrations/2026-06-09-social-quick-wins.sql`.


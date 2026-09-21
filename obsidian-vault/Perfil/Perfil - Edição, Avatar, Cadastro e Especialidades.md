---
tags: [perfil, cadastro, avatar, especialidades, roles, onboarding]
---

# Perfil — Edição, Avatar, Cadastro e Especialidades

> Nota: login social (Google/Apple), PKCE mobile, `resolveSupabaseEnv()` e RLS hardening genérico de sessão são cobertos em [[Auth - OAuth, Cadastro e RLS de Sessão]]. Esta nota foca no **dado do perfil em si**: o formulário de cadastro, a trava que travava a criação da linha `profiles`, os papéis (roles), a edição de avatar/especialidades e a sincronização `tag`/`username`.

## A cadeia completa do "cadastro quebrado" (2026-09-07) — cronologia do incidente

Esta foi uma investigação de um dia inteiro, com **três correções erradas antes de achar a causa real**. Registrado na ordem em que aconteceu, porque a ordem é a lição.

### 1ª tentativa: "CADASTRO PEDIA TUDO DE NOVO"
Quem terminava o cadastro por e-mail caía no `/completar-perfil` e redigitava nome, telefone, cidade e data. Duas causas, as duas corrigidas (mas nenhuma era a causa raiz):
- **A trigger pode ser a versão velha.** `isProfileComplete` exige categoria E @tag; a `handle_new_user` anterior a 18/06/2026 gravava só `name`/`user_type`/`role`, então o perfil nascia SEM tag e o guarda do AppShell mandava a pessoa recém-cadastrada pro formulário. Não dá pra saber daqui qual versão está viva — então o `signUp` **reafirma** `name`/`tag`/`user_type`/`phone` no UPDATE pós-signup: no-op se a trigger gravou, conserto se não.
- **O formulário só preenchia o nome.** Agora preenche telefone, UF, cidade, data e **a categoria** — esta era a pior: nascia sempre em "pintor", então quem se cadastrou como grafiteiro e não reparasse **trocava o próprio papel** ao salvar.

### 2ª tentativa: "CADASTRO DUPLICADO — 3ª TENTATIVA, AGORA COM INSTRUMENTO"
Depois de duas correções (reafirmar a identidade no UPDATE pós-signup e preencher o formulário), o usuário testou com app reinstalado e o problema CONTINUA. Ou seja: as duas causas anteriores eram reais mas não eram A causa. **Decisão de método: não escrever uma 4ª correção às cegas — instrumentar primeiro.**
- **A HIPÓTESE que sobrou**: a linha de `profiles` pode NÃO EXISTIR. A `handle_new_user` engole a própria exceção com `RAISE WARNING`, então quando ela falha a conta de auth nasce e o perfil não. E aí **todo UPDATE no perfil vira no-op silencioso** — `update` que não acha linha não é erro, volta sucesso com zero linhas. O app manda pro `/completar-perfil`, a pessoa preenche, nada é gravado, a tela volta.
- **O `signUp` passou a CONFERIR:** `update(...).select('id')` — zero linhas significa perfil ausente, e aí ele cria a linha (a policy "Users can insert own profile" permite). Grava `profile-incomplete` no `/admin/errors` dizendo se o insert funcionou.
- **O `AppShell` passou a dizer POR QUE redirecionou:** perfil existe?, `user_type`/`role`/`tag` preenchidos? Uma linha por redirecionamento no `/admin/errors`.
- **REGRA: `update` no Supabase não avisa quando não acha a linha.** Onde isso importa (identidade, dinheiro, permissão), pedir `.select()` e olhar quantas linhas voltaram.

### A peça que fechou o caso: "O LOOP DO /completar-perfil: clica em Concluir e volta"
Depois de três correções erradas, o sintoma que resolveu a investigação foi este relato exato do usuário: o botão salva e a tela volta. Isso só acontece de um jeito — **a linha de `profiles` não existe**.
- **`update` no Supabase que não acha linha é SUCESSO com zero linhas**, não erro. Então: a pessoa preenche, o `update` "dá certo", nada é gravado, `isProfileComplete` continua falso e o guarda do AppShell traz de volta. Para sempre, e sem uma única mensagem de erro.
- **Por que a linha some:** a `handle_new_user` engole a própria exceção com `RAISE WARNING`. Qualquer coisa que faça o INSERT dela falhar (um CHECK, a UNIQUE da @tag, uma coluna que sumiu) deixa a conta de auth criada e o perfil não. O app nunca fica sabendo.
- **`updateProfile` agora CRIA a linha** quando o UPDATE não acha nenhuma (a policy "Users can insert own profile" permite o dono criar a própria). Se o INSERT também falhar, **ESTOURA** — erro visível é melhor que loop mudo. Isso cobre quem se cadastra agora E as contas que já ficaram presas.
- **As três "correções" anteriores não eram inúteis, mas nenhuma era A causa**: reafirmar a identidade no signup, preencher o formulário e criar a linha no signup só ajudam quem passa PELO signup — quem já estava preso continuava preso, e o loop era mudo dos dois lados.
- **REGRA (a mesma do `signUp`, agora em toda escrita de perfil): onde a identidade importa, `update` sem `.select()` é escrita sem confirmação.**

### A causa raiz: "`profiles.username` era NOT NULL"
SQL em `/migrations/2026-09-07-username-not-null.sql`. Provado no SQL Editor, DUAS vezes (a segunda com a @tag preenchida): `ERROR 23502: null value in column "username" of relation "profiles" violates not-null constraint`.
- **A corrente inteira, e é uma corrente de silêncios:** a `handle_new_user` grava `tag` e NÃO grava `username`; o gatilho que deveria espelhar tag→username não roda no INSERT; a coluna é NOT NULL, o INSERT estoura, e a trigger **engole a exceção com RAISE WARNING**. A conta de auth nasce e o perfil NÃO. Depois, `update` que não acha linha é SUCESSO com zero linhas — o app "salvava" o formulário, nada era gravado, a tela voltava. Nenhum erro em lugar nenhum, dos dois lados.
- **NENHUM cadastro conseguia criar perfil** — nem por e-mail, nem por Google/Apple. Explica também o "cadastro pela metade (OAuth)" que ficou registrado por meses como coisa de redirect.
- **O NOT NULL foi SOLTO, e não preenchido automático.** `username` é sinônimo de `tag`, e `isProfileComplete` aceita qualquer um dos dois: inventar um username faria o perfil de quem entra por Google/Apple PARECER completo sem ter @tag — a pessoa nunca mais veria a tela que pede a @tag, sumiria da busca e ficaria sem link de perfil, calada. **Trocar um bug barulhento por um silencioso é o pior negócio possível.**
- **LIÇÃO DE MÉTODO (a maior do dia):** três correções erraram o alvo porque estavam sendo feitas por dedução. O que fechou o caso foi (1) o usuário relatar o sintoma exato — "clica em Concluir e VOLTA" —, (2) o `/diag` mostrando `Linha de perfil no banco: NÃO EXISTE`, e (3) rodar À MÃO o INSERT que a trigger faz, pra o Postgres cuspir o erro que ela engole. **Trigger que engole a própria exceção transforma erro de schema em bug de produto que sobrevive a três correções.**

### Confirmação final: "CADASTRO CONSERTADO E CONFIRMADO NO APARELHO"
Cadastro novo entra direto no feed, sem passar pelo `/completar-perfil`, e o `contas_sem_perfil` do backfill foi a **0** — todas as contas que ficaram presas no loop voltaram. Foram TRÊS defeitos de schema empilhados, cada um descoberto só depois de derrubar o anterior: `username` NOT NULL, `profiles_role_check` sem 'arquiteto' e `profiles_user_type_check` sem 'arquiteto' (ver seção "Dois CHECKs de papel" abaixo).

### `/diag` — a ferramenta que faltava nas três investigações anteriores
A pergunta "qual build o aparelho está rodando" apareceu em TRÊS investigações (o 500, a rejeição da Apple, o cadastro duplicado) e nunca teve resposta: testar depois de um deploy era ato de fé. O app carrega o site ao vivo, então "fiz o deploy" e "o aparelho pegou" são coisas diferentes — e o `sw.js` serve `/_next/static/` **cache-first**, então um aparelho PODE ficar preso numa build anterior. `NEXT_PUBLIC_BUILD` (SHA do Cloudflare Pages, ou o horário do build fora dele) aparece como "Build do site" no `/diag`. **Antes de concluir que uma correção não funcionou, conferir essa linha.**
- O `/diag` também mostra o ESTADO DO PERFIL no banco (linha existe?, `user_type`, `role`, `tag`, `username`, e a conta final do `isProfileComplete`). É a resposta direta pro "o cadastro pede tudo de novo", no aparelho, sem depender de acesso ao banco nem ao `/admin/errors`.

## Papel novo: Arquiteto / Engenheiro (2026-09-07)

**SÃO DOIS CHECKs DE PAPEL, e a 1ª migration só corrigiu um.** `public.profiles` tem `profiles_user_type_check` **e** `profiles_role_check`. A migration do arquiteto (`/migrations/2026-09-07-role-arquiteto.sql`) arrumou o primeiro; o segundo barrava `role='arquiteto'` com `23514` e — como a trigger engole a exceção — o cadastro de arquiteto nascia SEM PERFIL, calado. Complemento em `/migrations/2026-09-07-role-check-arquiteto.sql`.
- **A conferência escrita perguntava por UM nome conhecido e voltou `true`** enquanto o cadastro seguia quebrado — confiança falsa. **REGRA: conferência de constraint LISTA (`pg_constraint` da tabela), não pergunta por nome.** Nome só cobre o que você já sabe que existe.

**A migration original** (`/migrations/2026-09-07-role-arquiteto.sql`, **SQL JÁ EXECUTADO no Supabase, 2026-09-07, informado pelo usuário**) fazia duas coisas, ambas obrigatórias porque falhavam em SILÊNCIO: o `profiles_user_type_check` recusava o valor (a trigger engole a exceção com RAISE WARNING e a conta nascia SEM perfil) e a `handle_new_user` tem lista branca própria que **rebaixa o papel desconhecido pra 'cliente'** (a pessoa escolhia Arquiteto e virava Cliente, sem aviso).
- **O bloco 2 recriou a `handle_new_user`, que atende TODO cadastro** — não só o do papel novo. É superconjunto da versão de 18/06 (mesmos campos, mais os sinônimos e o `LOWER` na @tag). Reconferir por `/migrations/2026-09-05-conferencia-pendencias.sql` antes de afirmar qualquer coisa sobre ela.
- **PROVADO NO APARELHO (2026-09-07):** cadastro ponta a ponta escolhendo "Arquiteto / Engenheiro" funcionou. Só passou a funcionar depois dos DOIS CHECKs e do NOT NULL do `username` — ou seja, quando o perfil foi dado como pronto na primeira vez, ele não estava.
- **É os DOIS lados (decisão do usuário):** presta serviço (busca, portfólio, orçamento, avaliação) E contrata (avalia obra, tabela ABRAPP, lista na loja). Persona de IA associada = **Seu Zé**.
- **`engenheiro` é sinônimo de `arquiteto`**, igual `funileiro` é de `automotivo`: mesmo papel, `profession` diferente.
- **`lib/roles.ts` virou a FONTE ÚNICA dos papéis.** A lista de "quem é profissional" estava copiada à mão em NOVE arquivos e as cópias já divergiam (umas sem `funileiro` — quem era funileiro perdia o CTA de orçamento no próprio perfil; o rótulo do automotivo era um no cadastro e outro no onboarding do OAuth). Papel novo = uma entrada lá.
- O portal duplica a lista (é JSX sem imports) e o `?v=`/SRI foram refeitos. Aba nova "Arquitetos / Engenheiros" no `/portal`.

## Cadastro: nada é opcional, e o passo 2 mudou (2026-09-07, pedido do usuário. SEM SQL)

Telefone, cidade e estado viraram obrigatórios (a **foto** é a única exceção — ver abaixo); o rótulo "WhatsApp" virou **"Telefone"**.

- **Nome sai em Maiúscula Inicial sozinho** (`formatarNomeProprio`), com conectivo minúsculo ("João da Silva") — menos no começo ("Da Costa"). `limparNome` agora aceita **só letra e espaço**: hífen e apóstrofo saíram junto com número e ponto. Custo conhecido e testado: "Maria-José" vira "MariaJosé". Se incomodar, é uma linha.
- **A sugestão de @tag ENTRA no campo**, em vez do botão "Usar @fulano" embaixo, que quase ninguém tocava — e tag vazia era o começo do loop do `/completar-perfil`. Só escreve enquanto a pessoa não mexeu no campo.
- **Estado ANTES de cidade**, os dois em `<ComboBox>` (digitar filtra, clique escolhe). `<select>` no celular abre a roleta do sistema: achar uma cidade entre as 645 de SP é rolagem. Cidade carrega do IBGE pela UF escolhida, e trocar de estado LIMPA a cidade.
  - **Não é `<datalist>`**: o suporte no Safari do iPhone é irregular e o app roda em WebView.
  - **Cidade aceita texto livre de propósito** (`allowFree`): se o IBGE não responder, travar o cadastro é pior que aceitar o nome digitado.
- **A FOTO CONTINUA OPCIONAL — a exceção da regra "nada é opcional".** Ela foi obrigatória por algumas horas em 07/09 e voltou atrás no mesmo dia, por decisão do usuário depois de ver o risco: no Android, abrir a galeria manda o app pro fundo e o sistema pode MATAR o processo, então foto obrigatória vira porta trancada (foi o incidente do picker de 28/08 — ver [[Mobile - Bugs de WebView e Picker]]). Tem teste travando isso pra ela não voltar a ser porta sem querer.
- **O `onPersist` FICOU**: o passo 2 salva o rascunho ANTES de abrir o seletor. Vale de todo jeito — quem escolhe foto e perde o processo não perde mais o que já digitou. Era um buraco real: os campos viviam só no RHF, e o rascunho só era salvo na troca de passo.

## "Trocar foto" do perfil não salvava (2026-08-29)

A pessoa escolhia a foto, via a cara nova na tela, saía e nada tinha mudado — sem mensagem, porque de fato nada acontecia: o avatar só virava PREVIEW (`createObjectURL`) e o upload esperava o submit lá no fim da página. Pior: o **logo do negócio, no MESMO formulário, já salvava sozinho** — dois controles vizinhos com comportamentos opostos. Agora o avatar sobe na hora (`uploadAvatar` → `update({avatar_url})` → toast), igual ao logo.

- **Bug 2, o que escondia o primeiro:** `handleSubmit(onSubmit)` sem `onInvalid`. Perfil antigo com cidade/UF/telefone vazio reprovava na validação e o botão "Salvar" **não fazia nada visível** — o erro aparecia ao lado do campo, fora da tela. Agora `onInvalid` mostra "Falta corrigir: …" e rola até o campo.

## `profiles.tag` e `profiles.username` — sinônimos sincronizados automaticamente

SQL já rodado: trigger `sync_profile_tag_username` BEFORE INSERT/UPDATE preenche o lado vazio com o outro e propaga mudanças entre os dois campos. View `profiles_public` projeta `tag = coalesce(tag, username)` e `username = coalesce(username, tag)`, então frontend continua usando `p.tag` (e o app só escreve em `tag`) — pega valor de qualquer coluna que esteja preenchida. View NÃO tem mais as colunas `palette` nem `country` (não existem no banco real, foram removidas em algum momento).

**Contexto que essa sincronização não resolveu sozinha**: mesmo com o trigger de sincronização existindo, o `username` continuou sendo NOT NULL na tabela até 2026-09-07 (ver seção acima) — o trigger de sincronização "não roda no INSERT" da forma que a `handle_new_user` grava, então o gatilho de sincronização e o NOT NULL coexistiram por meses produzindo o bug de cadastro quebrado. A correção definitiva foi soltar o NOT NULL, não reforçar o trigger.

## Especialidades — catálogo unificado app ↔ portal

A edição de especialidades no `/perfil/editar` usa o catálogo `ROLE_SPECS` (por papel). O mesmo catálogo é duplicado no portal como `PERFIL_SPECS` (arquivo JSX sem imports) para o modal `EditarPessoaModal` — ver [[Portal - Pessoas, Produtos e Ferramentas]] pra história completa de como isso substituiu `prompt()` de texto livre (que gerava "Piso Epoxi"/"piso epoxi"/"Piso Epóxi" como três valores distintos pro filtro de busca do app, que compara string). `__tests__/portalEspecialidades.test.ts` lê o fonte do portal e compara com o do app — mexeu num, tem que mexer no outro. Valor fora do catálogo (herança de texto livre antigo) aparece marcado com borda tracejada, pra dar pra LIMPAR — nunca escondido, porque dado invisível é dado que ninguém corrige.

## Guard de perfil incompleto (contexto compartilhado com Auth)

O `AppShell` redireciona pra `/completar-perfil` sempre que `isProfileComplete` (`lib/profileCompletion.ts`) é falso — regra compartilhada com o formulário de completar perfil. Só redireciona com o profile carregado sem erro (query em voo ou falha de rede NÃO expulsam ninguém). Ver [[Auth - OAuth, Cadastro e RLS de Sessão]] pro fluxo de OAuth que alimenta esse guard e pro "guard de cadastro incompleto" adicionado em 2026-08-21.

---
## Ver também
[[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Portal - Pessoas, Produtos e Ferramentas]] · [[Mobile - Bugs de WebView e Picker]] · [[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Posts, Stories e Feed]]

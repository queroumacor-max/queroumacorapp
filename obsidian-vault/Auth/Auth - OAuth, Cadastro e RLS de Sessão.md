---
tags: [auth, oauth, cadastro, rls, supabase]
---

# Autenticação — OAuth, Cadastro, Completar Perfil e RLS de Sessão

## Login social (Google + Apple), 2026-06-18
OAuth via Supabase. `AuthProvider.signInWithGoogle()`/`signInWithApple()` chamam `supabase.auth.signInWithOAuth({ provider })` com `redirectTo=${origin}/completar-perfil`. Botões reutilizáveis em `components/SocialAuthButtons.tsx` (Google branco + Apple preto), renderizados no `/login` (LoginForm, abaixo do "Entrar") e `/signup` (SignupFlow, topo do passo 1). Provider Google e Apple já habilitados no painel Supabase (Client ID/Secret + redirect URLs) — não pedir pra configurar.

**Onboarding pós-OAuth**: `/completar-perfil` (page + `CompleteProfileForm`) é o landing do `redirectTo` — se o perfil já tem categoria (`user_type`/`role`) + `@tag`, manda pro `/feed`; senão pede categoria + nome + @tag (cidade/UF opcionais) e grava via `useProfile.update`. `/perfil/editar` NÃO serve pra isso (tag é readonly lá e não tem seletor de categoria). `ProfilePatch` ganhou `user_type` (o trigger `trg_sync_role_from_user_type` preenche `role`). Lembrete: no Supabase, as Redirect URLs precisam cobrir `/completar-perfil` (recomendado wildcard `…/**` + preview pages.dev).

### Guard de cadastro incompleto (2026-08-21)
O `/completar-perfil` era a ÚNICA chance de preencher categoria + @tag: se o redirect do provedor não pousasse lá (Redirect URL fora da allowlist manda pro Site URL) ou a pessoa fechasse a aba, ficava com perfil pela metade pra sempre — sem @tag não aparece na busca nem tem link de perfil. Apareceram vários no `/portal` (Clientes com @TAG "—"). Agora o `AppShell` refaz o pedido: `isProfileComplete` (`lib/profileCompletion.ts`, regra compartilhada com o formulário) + `router.replace('/completar-perfil')`, e a tela privada não renderiza enquanto isso. **Só redireciona com o profile carregado sem erro** — query em voo ou falha de rede NÃO expulsam ninguém. Usuários antigos sem tag são pegos na próxima abertura.

## PKCE no mobile (M1, 2026-09-15)
OAuth migrou de implicit flow pra PKCE: `lib/supabase.ts` ganhou `flowType:'pkce'`; o callback nativo (`lib/native/auth.ts`) agora recebe `br.com.queroumacor.app://auth/callback?code=...` (código de uso único) em vez de `#access_token=...&refresh_token=...` crus no fragment — o que o Android loga no Logcat deixa de ser um token de sessão utilizável (o `code` sozinho não abre sessão sem o `code_verifier`, que nunca sai do storage da WebView). `exchangeCodeForSession` troca o code pela sessão; o `setSession` com tokens crus virou fallback defensivo, nunca acionado com PKCE ligado. **O fluxo WEB não precisou de nenhuma mudança** — o supabase-js já troca `?code=` sozinho no boot (`detectSessionInUrl`, default true). Testes novos cobrindo `parseAuthCallbackUrl` (code via query) e 3 casos de `nativeSignInWithOAuth` mockando o client. Suíte (163/2119), typecheck e `next build` verdes. Na época: **AINDA NÃO TESTADO EM APARELHO REAL nem contra Google/Apple de verdade** — instalar o AAB/IPA e fazer login social de verdade uma vez em cada plataforma antes de confiar cegamente (o app já quebrou OAuth várias vezes em produção — waves de 2026-09-06/07). **Isso foi feito e confirmado**: ver "Apple rejeitou a build 17" em [[Mobile - Build, Deploy e Push Nativo]] — no aparelho real da revisão da Apple, o fluxo NATIVO funcionou (o que quebrava era a navegação de documento pós-login, corrigido em 2026-09-07 e confirmado pelo usuário no aparelho: "já funcionou").

## Causa raiz do cadastro quebrado: `profiles.username` era NOT NULL (2026-09-07)
SQL em `/migrations/2026-09-07-username-not-null.sql`. Provado no SQL Editor, DUAS vezes (a segunda com a @tag preenchida): `ERROR 23502: null value in column "username" of relation "profiles" violates not-null constraint`.

**A corrente inteira, e é uma corrente de silêncios:** a `handle_new_user` grava `tag` e NÃO grava `username`; o gatilho que deveria espelhar tag→username não roda no INSERT; a coluna é NOT NULL, o INSERT estoura, e a trigger **engole a exceção com RAISE WARNING**. A conta de auth nasce e o perfil NÃO. Depois, `update` que não acha linha é SUCESSO com zero linhas — o app "salvava" o formulário, nada era gravado, a tela voltava. Nenhum erro em lugar nenhum, dos dois lados.

**NENHUM cadastro conseguia criar perfil** — nem por e-mail, nem por Google/Apple. Explica também o "cadastro pela metade (OAuth)" que este arquivo registrava como coisa de redirect.

**O NOT NULL foi SOLTO, e não preenchido automático.** `username` é sinônimo de `tag`, e `isProfileComplete` aceita qualquer um dos dois: inventar um username faria o perfil de quem entra por Google/Apple PARECER completo sem ter @tag — a pessoa nunca mais veria a tela que pede a @tag, sumiria da busca e ficaria sem link de perfil, calada. Trocar um bug barulhento por um silencioso é o pior negócio possível.

**LIÇÃO DE MÉTODO (a maior do dia):** três correções minhas no lado do app erraram o alvo porque eu estava deduzindo. O que fechou o caso foi (1) o usuário relatar o sintoma exato — "clica em Concluir e VOLTA" —, (2) o `/diag` mostrando `Linha de perfil no banco: NÃO EXISTE`, e (3) rodar À MÃO o INSERT que a trigger faz, pro Postgres cuspir o erro que ela engole. **Trigger que engole a própria exceção transforma erro de schema em bug de produto que sobrevive a três correções.**

## O loop do /completar-perfil: "clica em Concluir e volta" (2026-09-07) — a peça que FECHOU o caso
Depois de três correções erradas, o sintoma que resolveu a investigação foi este: o botão salva e a tela volta. Isso só acontece de um jeito — **a linha de `profiles` não existe**.

**`update` no Supabase que não acha linha é SUCESSO com zero linhas**, não erro. Então: a pessoa preenche, o `update` "dá certo", nada é gravado, `isProfileComplete` continua falso e o guarda do AppShell traz de volta. Para sempre, e sem uma única mensagem de erro.

**Por que a linha some:** a `handle_new_user` engole a própria exceção com `RAISE WARNING`. Qualquer coisa que faça o INSERT dela falhar (um CHECK, a UNIQUE da @tag, uma coluna que sumiu) deixa a conta de auth criada e o perfil não. O app nunca fica sabendo.

`updateProfile` agora **CRIA a linha** quando o UPDATE não acha nenhuma (a policy "Users can insert own profile" permite o dono criar a própria). Se o INSERT também falhar, **ESTOURA** — erro visível é melhor que loop mudo. Isso cobre quem se cadastra agora E as contas que já ficaram presas.

**As três "correções" anteriores não eram inúteis, mas nenhuma era A causa**: reafirmar a identidade no signup, preencher o formulário e criar a linha no signup só ajudam quem passa PELO signup — quem já estava preso continuava preso, e o loop era mudo dos dois lados.

**REGRA (a mesma do `signUp`, agora em toda escrita de perfil): onde a identidade importa, `update` sem `.select()` é escrita sem confirmação.**

## Qual build o aparelho está rodando — `/diag` responde (2026-09-07)
A pergunta apareceu em TRÊS investigações (o 500, a rejeição da Apple, o cadastro duplicado) e nunca teve resposta: testar depois de um deploy era ato de fé. O app carrega o site ao vivo, então "fiz o deploy" e "o aparelho pegou" são coisas diferentes — e o `sw.js` serve `/_next/static/` **cache-first**, então um aparelho PODE ficar preso numa build anterior. `NEXT_PUBLIC_BUILD` (SHA do Cloudflare Pages, ou o horário do build fora dele) aparece como "Build do site" no `/diag`. **Antes de concluir que uma correção não funcionou, conferir essa linha.**

O `/diag` também mostra agora o ESTADO DO PERFIL no banco (linha existe?, user_type, role, tag, username, e a conta final do `isProfileComplete`). É a resposta direta pro "o cadastro pede tudo de novo", no aparelho, sem depender de acesso ao banco nem ao `/admin/errors`.

## Cadastro duplicado — 3ª tentativa, agora com instrumento (2026-09-07)
Depois de duas correções (reafirmar a identidade no UPDATE pós-signup e preencher o formulário), o usuário testou com app reinstalado e o problema CONTINUA. Ou seja: as duas causas que eu tinha eram reais mas não eram A causa. Não escrever uma 4ª correção às cegas — o app agora responde.

**A HIPÓTESE que sobrou, e o que ela explica:** a linha de `profiles` pode NÃO EXISTIR. A `handle_new_user` engole a própria exceção com `RAISE WARNING`, então quando ela falha a conta de auth nasce e o perfil não. E aí **todo UPDATE no perfil vira no-op silencioso** — `update` que não acha linha não é erro, volta sucesso com zero linhas. O app manda pro `/completar-perfil`, a pessoa preenche, nada é gravado, a tela volta. É também a explicação do "loop infinito no /completar-perfil" que outra sessão tentou corrigir.

**O signUp passou a CONFERIR:** `update(...).select('id')` — zero linhas significa perfil ausente, e aí ele cria a linha (a policy "Users can insert own profile" permite). Grava `profile-incomplete` no `/admin/errors` dizendo se o insert funcionou.

**O AppShell diz POR QUE redirecionou:** perfil existe?, user_type/role/tag preenchidos? Uma linha por redirecionamento no `/admin/errors`. Na próxima tentativa a causa aparece escrita, em vez de deduzida.

**REGRA: `update` no Supabase não avisa quando não acha a linha.** Onde isso importa (identidade, dinheiro, permissão), pedir `.select()` e olhar quantas linhas voltaram.

## Cadastro pedia tudo de novo (2026-09-07)
Quem terminava o cadastro por e-mail caía no `/completar-perfil` e redigitava nome, telefone, cidade e data. Duas causas, as duas corrigidas:
- **A trigger pode ser a versão velha.** `isProfileComplete` exige categoria E @tag; a `handle_new_user` anterior a 18/06/2026 gravava só name/user_type/role, então o perfil nascia SEM tag e o guarda do AppShell mandava a pessoa recém-cadastrada pro formulário. Não dá pra saber daqui qual versão está viva — então o `signUp` **reafirma** name/tag/user_type/phone no UPDATE pós-signup: no-op se a trigger gravou, conserto se não.
- **O formulário só preenchia o nome.** Agora preenche telefone, UF, cidade, data e **a categoria** — esta era a pior: nascia sempre em "pintor", então quem se cadastrou como grafiteiro e não reparasse **trocava o próprio papel** ao salvar.

## Dois CHECKs de role, e só um foi corrigido primeiro (2026-09-07)
`public.profiles` tem `profiles_user_type_check` **e** `profiles_role_check`. A migration do papel "arquiteto" (ver [[Portal - Pessoas, Produtos e Ferramentas]] ou o registro de perfis por papel) arrumou o primeiro; o segundo barrava `role='arquiteto'` com 23514 e — como a trigger engole a exceção — o cadastro de arquiteto nascia SEM PERFIL, calado. Complemento em `/migrations/2026-09-07-role-check-arquiteto.sql`.

**A conferência que eu escrevi perguntava por UM nome conhecido e voltou `true`** enquanto o cadastro seguia quebrado — confiança falsa. **REGRA: conferência de constraint LISTA (`pg_constraint` da tabela), não pergunta por nome.** Nome só cobre o que você já sabe que existe.

## Par cruzado de env do Supabase — a causa do "Faça login" em TODA a IA (2026-08-22/2026-09-04, PR #202, FECHADO)
Usuário perfeitamente logado levava `Faça login (token_invalid)` em toda rota de IA. Evidência do painel do CF Pages (Production): `SUPABASE_URL` **não existe**; `SUPABASE_ANON_KEY` existe como Secret, de **OUTRO projeto** (herança do app vanilla); o par `NEXT_PUBLIC_*` existe e está certo. Como `getSupabaseUrl()` e `getSupabaseAnonKey()` resolviam INDEPENDENTES, cada uma com a sua ordem, a URL caía no NEXT_PUBLIC e a chave vinha do secret legado. O GoTrue recebia apikey de um projeto e token de outro, respondia 401 "Invalid API key" pra QUALQUER token, e o `requireAuth` colapsava todo `!res.ok` em `token_invalid`.

**A assimetria que custou dias:** o PostgREST seguia funcionando porque quem o chama é o **cliente**, com a chave boa do bundle (ele valida só assinatura e expiração). Só a verificação do **servidor** usava a chave divergente. Isso derrubou 6 hipóteses de sessão/token que vieram antes — **o token nunca foi o problema**.

**REGRA: URL e anon key saem SEMPRE do mesmo par.** `resolveSupabaseEnv()` em `lib/api/security.ts` é o resolvedor ÚNICO: tenta o par `NEXT_PUBLIC_*` INTEIRO, cai pro par sem prefixo INTEIRO, **nunca meio a meio**. `getSupabaseAnonKey()` exige par completo; `getSupabaseUrl()` mantém fallback só-URL de propósito — os caminhos de SERVICE ROLE (audit, log-error, push-notify) legitimamente não têm anon key.

**REGRA: quem fala com o GoTrue pega as duas metades do MESMO objeto.** `requireAuth`/`requireAuthStrict`/`verifySupabaseToken`/`validateToken`/`getUserFromToken` fazem `const {url, anonKey} = resolveSupabaseEnv()`. Duas resoluções independentes dentro do caminho de auth é a FORMA do bug.

Guarda nova: o `ref` do JWT anon × o `<ref>` do host `<ref>.supabase.co`. Divergindo, o gate devolve `env_project_mismatch` (não `token_invalid`) e o texto do 401 carrega os dois refs.

**SEIS resolvedores divergentes existiam** (`security.ts`, `health`, `_admin-helpers`, `auth-server`, `set-session-cookie`, `moderate-video`, mais um escondido em `lib/api/env.ts` que lia só as `NEXT_PUBLIC_*`). Dois guards de arquitetura em `__tests__/lib/supabase-env-single-resolver.test.ts` falham se qualquer arquivo de `lib/api`/`app/api` voltar a ler essas envs cruas ou a pedir a anon key solta.

**Nenhum secret do painel foi tocado** — o `SUPABASE_ANON_KEY` divergente simplesmente deixou de ser lido. Não apagar: é inerte.

## Edge do Cloudflare: secret NÃO chega em `process.env` (2026-08-22)
Descoberto depurando o portal admin em produção. As variáveis do painel do Pages só existem no request context, publicado no symbol global `Symbol.for('__cloudflare-request-context__')`. **Ler sempre por `getRuntimeEnv()` (`lib/api/env.ts`), nunca `process.env` direto**, pra qualquer secret/config de runtime — ele tenta o symbol e cai pro `process.env` (build, dev, vitest).
- `env.ts` NÃO pode importar `@cloudflare/next-on-pages`: o entrypoint faz `require('server-only')`, pacote não instalado, e isso derruba a CARGA de ~40 arquivos de teste ("Cannot find module 'server-only'" → 197 testes a mais quebrados). Lê-se o symbol na mão.
- **Corolário que causou o 403 do portal**: nada que dependa de env pode ser lido no MODULE-LOAD — no boot não existe request, logo não existe env. `admin-config.ts` parseava `ADMIN_EMAILS` no boot e o cache nascia sempre vazio → `isAdminEmail()` sempre false → "não autorizado (email não admin)". Virou preguiçoso (parse na 1ª chamada).
- **SEIS resolvedores divergentes existiam** pro Supabase (`security.ts`, `health`, `_admin-helpers`, `auth-server`, `set-session-cookie`, `moderate-video`, mais um escondido em `lib/api/env.ts` que lia só as `NEXT_PUBLIC_*`). Dois guards de arquitetura em `__tests__/lib/supabase-env-single-resolver.test.ts` falham se qualquer arquivo de `lib/api`/`app/api` voltar a ler essas envs cruas ou a pedir a anon key solta.
- Baseline da suíte desde 2026-09-03: **0 falhas** — qualquer falha agora é regressão real.

## Conta nova barrada de publicar: sessão diz "e-mail não confirmado" (2026-08-29)
`getSession()` devolve o usuário GUARDADO no localStorage, **não** o do servidor. Quem confirma o e-mail FORA do app (abre o link no Chrome ou no app de e-mail) fica com uma cópia dizendo não-confirmado → `usePublishPost` barra com "Confirme seu email antes de publicar" e a faixa amarela não sai. O snapshot só se atualiza no refresh do token (1h), que **no WebView quase nunca acontece** (o app é morto e restaurado antes). Por isso só pega conta nova — as antigas já refrescaram alguma vez. Agora, e SÓ quando a cópia local diz não-confirmado, o `AuthProvider` chama `getUser()` (servidor, mesma corrida contra `SESSION_TIMEOUT_MS`) e adota o usuário fresco.

**Falha capturada NÃO chega no `/admin/errors`** — só erro não capturado chega. O catch do avatar vira toast e o erro do publish vira faixa vermelha; os dois morrem na tela. Concluir "a tabela `errors` está vazia, logo não houve falha" é **errado**. `lib/utils/reportFailure.ts` (best-effort, nunca lança) manda `type='avatar-fail'` e `'publish-fail'` com `user_id`, mensagem, UA e URL. **Fluxo novo que engole erro em catch = chamar `reportFailure`.**

## RLS hardening (Wave 27, `posts`/`orders`/`messages`/`quotes`/storage) — 2026-06-10
Fecha os 4 blockers críticos B2-B5 do `LAUNCH_AUDIT.md`:
- **(B2)** `orders` INSERT/UPDATE com `auth.uid()=user_id` no WITH CHECK (antes era `WITH CHECK (true)` — user A podia criar order pra B).
- **(B3)** `messages` ganha UPDATE policy (sender/receiver), SELECT filtra `deleted_at IS NULL` (admin via `is_portal_admin()` ainda enxerga).
- **(B4)** `quotes` SELECT restrito a `client_id` + `painter_id` + admin (antes USING `true` expunha phone/address de leads — LGPD).
- **(B5)** storage `posts` + `avatars` com path validation `split_part(name, '/', 1) = auth.uid()::text` (antes qualquer auth user podia escrever em qualquer path — path traversal). Path pattern `{userId}/...` já era seguido por todos uploads no Next.

Migration em `/migrations/2026-06-10-wave-27-rls-hardening.sql`. Idempotente.

## Modo visitante (guest) — REMOVIDO (2026-06-18, decisão do usuário)
O app voltou a EXIGIR login. O guard fica no `AppShell` (`components/AppShell.tsx`): se `!loading && !user`, `router.replace('/login?next=…')` e não renderiza o conteúdo privado. Toda tela embrulhada em AppShell é privada; páginas públicas (`/login`, `/signup`, `/`, `/info/*`, `/delete-account`, `/completar-perfil`) NÃO usam AppShell, então seguem acessíveis. Raiz `/` agora manda logado→`/feed`, deslogado→`/login`. O botão "Explore o app sem cadastro" já tinha sido removido do `/login`. O `AuthGate` continua no repo mas fica inerte dentro do AppShell (user sempre presente) — não removido. As policies anon-read da loja (`2026-06-15-loja-anon-read.sql`) seguem no banco, inofensivas (sem anon agora); não precisa reverter.

## Roteiro guiado (tours)
`AppTour.tsx` (coach marks) — escurece a tela, abre um "buraco" de luz em cima de um botão real da navegação e mostra um balão explicando pra que ele serve (tom simples, PT-BR). Tocar em qualquer lugar (ou no balão / "Próximo") avança; "Sair do tutorial" e `Esc` fecham. Roteiro em `lib/tour/steps.ts` (9 passos: boas-vindas → Início → Mensagens → Buscar → Loja → Avisos → Perfil → Plano → fim), geometria pura testável em `lib/tour/position.ts`, flag `app_tour_seen_v1` em `lib/tour/storage.ts`.
- Alvos marcados com `data-tour="nav-*"` no `BottomNav` (feed/search/loja/notif/perfil) e no `TopNav` (chat/plano). **Se mexer nesses componentes, preservar os `data-tour`** — sem eles o passo é pulado.
- Montado no `AppShell` (precisa de TopNav+BottomNav na tela pra medir). Auto-abre SÓ em `/feed`, SÓ logado e SÓ uma vez por dispositivo. Passos cujo alvo não existe são pulados automaticamente.
- Respeita `prefers-reduced-motion`.
- **Tour 2 — ferramentas do Perfil (um passo por tile)**: mesmo `<AppTour>`, parametrizado por props (`tour`/`steps`/`autoPath`). `PROFILE_TOUR_STEPS` — boas-vindas + um passo explicando CADA quadradinho do `BusinessGrid`. Alvos: `data-tour={\`tile-${tile.sheet}\`}` — derivado da chave `sheet`, então **tile novo no grid = passo novo no steps.ts** (`__tests__/tour.test.ts` lê o fonte do BusinessGrid e QUEBRA se faltar/sobrar passo, de propósito). Como os tiles são condicionais ao papel, cada usuário só vê os passos das ferramentas que tem. Montado dentro do `BusinessGrid`, flag própria `profile_tour_seen_v1`. Acima de 10 passos as bolinhas de progresso viram barra + "3 de 21".
- `components/OnboardingModal.tsx` + `lib/hooks/useOnboarding.ts` foram **deletados** — eram um modal de 5 passos que nunca chegou a ser renderizado em lugar nenhum, e virou duplicata deste tour.

---
## Ver também
[[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Mobile - Bugs de WebView e Picker]] · [[Mobile - Build, Deploy e Push Nativo]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]]

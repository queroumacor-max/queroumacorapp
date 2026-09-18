---
tags: [auth, oauth, cadastro, rls, supabase]
---

# Autenticação — OAuth, Cadastro, Completar Perfil e RLS de Sessão

## Login social (Google + Apple), 2026-06-18
`AuthProvider.signInWithGoogle/Apple()` via `supabase.auth.signInWithOAuth`. `/completar-perfil` é o landing pós-OAuth — se perfil já tem categoria + @tag, manda pro feed; senão pede os dois.
**Guard de cadastro incompleto (2026-08-21)**: sem @tag, a pessoa some da busca e fica sem link de perfil pra sempre se fechar a aba antes de completar. `AppShell` agora refaz o pedido via `isProfileComplete` + redirect — só quando o profile carregou sem erro (query em voo não expulsa ninguém).

## PKCE no mobile (M1, 2026-09-15)
OAuth migrou de implicit flow pra PKCE: `lib/supabase.ts` com `flowType:'pkce'`. Callback nativo recebe `?code=` (uso único) em vez de tokens crus no fragment — o que o Android loga no Logcat deixa de ser sessão utilizável. `exchangeCodeForSession` troca o code; `setSession` com tokens crus virou fallback nunca acionado. Fluxo WEB não precisou de mudança (supabase-js já troca `?code=` sozinho).

## Causa raiz do cadastro quebrado: `profiles.username` era NOT NULL (2026-09-07)
Corrente inteira: `handle_new_user` grava `tag`, não `username`; gatilho que deveria espelhar não roda no INSERT; coluna NOT NULL recusa o INSERT; **a trigger engole a exceção com RAISE WARNING** — conta de auth nasce, perfil não. Depois, `update` que não acha linha é SUCESSO com zero linhas (Supabase) — app "salvava", nada gravava, tela voltava. **NOT NULL foi SOLTO, não preenchido automático** (inventar username faria perfil sem @tag parecer completo, sumindo da busca em silêncio — bug barulhento trocado por silencioso é o pior negócio).
**Lição de método**: três correções anteriores erraram o alvo por dedução. Fechou o caso: (1) usuário relatando o sintoma exato "clica em Concluir e volta", (2) `/diag` mostrando "Linha de perfil: NÃO EXISTE", (3) rodar o INSERT à mão pro Postgres cuspir o erro que a trigger engole.

## Dois CHECKs de role (arquiteto)
`profiles_user_type_check` **e** `profiles_role_check` são constraints DIFERENTES — a migration do papel "arquiteto" corrigiu só o primeiro, cadastro de arquiteto nasceu sem perfil, calado, até o segundo ser corrigido. **Regra: conferência de constraint LISTA (`pg_constraint`), não pergunta por nome conhecido.**

## `updateProfile` agora CRIA a linha se o UPDATE não achar nenhuma
Policy "Users can insert own profile" permite o dono criar. Se o INSERT também falhar, ESTOURA (erro visível > loop mudo). `/diag` mostra estado do perfil no banco direto no aparelho.

## Par cruzado de env do Supabase (URL de um projeto + anon key de outro)
Causou `Faça login (token_invalid)` em TODA rota de IA pra usuário logado — PostgREST seguia OK (cliente usa a chave do bundle), só o SERVIDOR verificava com par divergente. **Regra: URL e anon key saem SEMPRE do mesmo par** — `resolveSupabaseEnv()` é o resolvedor único, nunca meio a meio. Guarda: `ref` do JWT anon × `<ref>` do host — divergindo, devolve `env_project_mismatch` explícito.

## Edge do Cloudflare: secret não chega em `process.env`
Variáveis do painel só existem no request context (`Symbol.for('__cloudflare-request-context__')`). **Regra: ler sempre por `getRuntimeEnv()`, nunca `process.env` direto.** Corolário: nada que dependa de env pode ser lido no MODULE-LOAD (não existe request no boot) — causou 403 silencioso no portal admin (`ADMIN_EMAILS` parseado no boot, cache sempre vazio).

## RLS hardening (Wave 27, `posts`/`orders`/`messages`/`quotes`/storage)
`orders` INSERT/UPDATE com `auth.uid()=user_id` no WITH CHECK; `messages` ganhou UPDATE policy + filtro `deleted_at IS NULL`; `quotes` SELECT restrito a `client_id`+`painter_id`+admin (antes vazava LGPD); storage `posts`/`avatars` com path validation `split_part(name,'/',1)=auth.uid()`.

## Roteiro guiado (tours)
`AppTour` (coach marks) — tour de navegação + tour de ferramentas do perfil, um passo por tile, geometria pura testável.

---
## Ver também
[[Segurança - Auditoria Supabase (RLS e Banco)]] · [[Mobile - Bugs de WebView e Picker]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]]

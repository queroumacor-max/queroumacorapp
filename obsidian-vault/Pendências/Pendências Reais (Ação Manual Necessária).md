---
tags: [pendências, ação-manual, checklist]
---

# Pendências Reais — Ação Manual Necessária

> Antes de tratar qualquer item aqui como resolvido ou como ainda pendente, reconferir — a lição repetida no projeto é que listas de pendência escritas à mão envelhecem rápido e a maioria delas historicamente já tinha sido resolvida sem atualização da nota. Ver [[Convenções Gerais de Desenvolvimento]]. Esta nota foi revisada em 2026-09-21 contra o `CLAUDE.md` mais recente — dois itens que a versão anterior desta nota listava como pendentes (DNSSEC, PKCE mobile em aparelho real) já estão RESOLVIDOS e foram removidos/corrigidos abaixo.

## Cloudflare — deploy e domínio (painel resolve)
- **Erro de permissão no deploy do Worker `queroumacor-next-production`** (`/zones/.../workers/routes`, "No access to the specified resource") — 3 ocorrências confirmadas (2026-09-20). Upload do código sempre funciona; só o passo de sincronizar rotas falha. **Ação**: conferir no dashboard Cloudflare → My Profile → API Tokens se o `CLOUDFLARE_API_TOKEN` (secret do GitHub Actions) tem `Zone > Workers Routes > Edit` explicitamente escopado pra zona de `queroumacor.com.br` (zone id `9f9e32d439524affe34c4b53fe4ceb08`), não só permissão de conta pra Workers Scripts. Ver [[Infraestrutura - Cloudflare, Env Vars e Deploy]].
- **Custom Domain pode estar duplicado entre Worker e Pages** — depois do corte de DNS (P8, 2026-09-20) pro Worker `queroumacor-next-production`, não está confirmado se o Custom Domain foi REMOVIDO do lado do projeto Pages `queroumacor-next` ou se ainda está lá conflitando. Só resolve olhando as duas abas "Custom Domains" no painel — nenhum teste de HTTP de fora distingue qual dos dois está de fato vinculado ao hostname hoje.
- **"Build output directory" do Cloudflare Pages** pode estar desatualizado (`next-app/.vercel/output/static` em vez de `next-app/.open-next/assets`) desde a migração OpenNext (PR #344). Pode ter ficado IRRELEVANTE pelo corte de DNS pro Worker, mas isso não está confirmado — não descartar até alguém confirmar que o Pages saiu de cena de vez.
- **Cloudflare Image Resizing — "Resize images from any origin" está LIGADO** (achado da auditoria externa HostedScan, 2026-09-20, confirmado no painel pelo usuário) — endpoint `/cdn-cgi/image/.../<qualquer-url>` aceita redimensionar imagem de qualquer origem da web, não só do domínio próprio. Duas opções levantadas, nenhuma implementada: (a) desligar agora (perde otimização de imagens do Supabase); (b) proxiar o Supabase Storage por trás do próprio domínio, o que permitiria desligar "any origin" sem perder otimização — precisa antes auditar quanto da URL de mídia hoje passa por proxy vs. Supabase direto. Ver [[Performance - Índices, RPCs e Paginação]] e [[Segurança - Cloudflare]] pro detalhe completo de impacto.

## Deploy pendente (código já mergeado, aguardando disparo)
- **PR #381 (fix de "Imprimir"/desconto % no orçamento) e PR #383 (troca da splash de boot)** — ambas MERGEADAS em `main` em 2026-09-21, mas o deploy (`deploy.yml`, `workflow_dispatch`) ainda não foi disparado. Esperando o usuário confirmar se quer que seja acionado manualmente ou se prefere disparar ele mesmo.

## SQL com execução não confirmada
- **RPC `claim_wa_followup_nudge`** (`/migrations/2026-09-17-whatsapp-followup-claim.sql`) — código já é fail-safe (reengajamento pausa em silêncio até confirmar). Ver [[WhatsApp - IA, Follow-up e Leads]].
- **`migrations/2026-09-16-business-logic-security-audit.sql`** — sem confirmação "JÁ EXECUTADO" explícita encontrada no histórico, ao contrário de toda outra migration relevante (auditoria "Bloco 21", 2026-09-18). Ver domínio de segurança/Supabase.

## DNS / domínio (só o usuário pode mexer)
- **DMARC de `calicolors.com.br`**: confirmado ausente via DNS (NXDOMAIN, `_dmarc.calicolors.com.br`) — falta TXT `_dmarc` no GoDaddy. **Ainda pendente.**
- ~~DNSSEC de `queroumacor.com.br`~~ — **RESOLVIDO (2026-09-17).** DS record publicado na Registro.br (Key Tag 2371, Algoritmo 13, Digest Type 2/SHA-256), confirmado "DNS atualizado com sucesso!" pela Registro.br. Não é mais pendência.

## Decisões de produto em aberto (não é bug, é escolha pendente)
- **Cloudflare Access na frente de `*.pages.dev`**: não configurado, decisão do usuário.
- **Captcha/Turnstile em `/login` e `/signup`**: desligado nos dois lados (Cloudflare WAF e Supabase Auth "Enable Captcha protection").
- **Cloudflare CSAM Scanning Tool**: não é toggle self-service — exige contato manual (`cloudflare-csam@cloudflare.com`) e assinatura do NCMEC Reporting Agreement.
- **Ampliar fail-closed de moderação pra além do 429**: decisão de produto em aberto, não feita.
- **Gap: insert direto em `posts` via PostgREST pula `/api/moderate`**: fechar de verdade exige mover a criação do post pro servidor (mudança arquitetural maior) — opções avaliadas (RPC `create_post_secure` + REVOKE do INSERT direto; trigger que força `status='pending'` + promoção por service_role; fila de revisão passiva, descartada) documentadas na auditoria "Pentest Integrado Final" (2026-09-18). Nenhuma implementada.

## Verificação não possível deste ambiente
- Build nativo real (AAB/APK/IPA): sem Android SDK/Xcode neste ambiente — precisa Codemagic ou build local.
- ~~Login social PKCE no mobile: só testável instalando o AAB/IPA num aparelho real~~ — **RESOLVIDO/CONFIRMADO.** Testado em aparelho real durante a revisão da Apple (build 17, 2026-09-07): o fluxo nativo funcionou (o que quebrava era a navegação de documento pós-login, corrigido no mesmo dia e confirmado pelo usuário no aparelho: "já funcionou"). Ver [[Mobile - Build, Deploy e Push Nativo]].

## Backlog de produto
Ver `BACKLOG.md` na raiz do repo (não migrado neste vault — é uma lista de features categorizada, não decisões já tomadas). Consultar antes de propor features novas.

---
## Ver também
[[Segurança - Cloudflare]] · [[WhatsApp - IA, Follow-up e Leads]] · [[Moderação de Conteúdo (Gemini e CSAM)]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]] · [[Convenções Gerais de Desenvolvimento]]

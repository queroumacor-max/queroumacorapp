# External Security Baseline — QueroUmaCor

> Auditoria de **identidade, contas administrativas e infraestrutura externa**
> (IAM, MFA, recovery, break-glass, service accounts, tokens, ownership).
> **Diferente** das auditorias de código/RLS já registradas em
> `SECURITY_AUDIT_LOG.md` — aqui a pergunta é "se uma conta ou credencial
> externa for comprometida, qual o blast radius, detectamos, contemos e
> recuperamos, e existe alguém que sozinho derruba o sistema inteiro?".
> Complementa (não substitui) `docs/INCIDENT_RESPONSE.md` (resposta
> operacional a incidentes) e `docs/RUNBOOK.md` (deploy). Recovery
> passo-a-passo por cenário está em
> [`ACCOUNT_RECOVERY_RUNBOOK.md`](./ACCOUNT_RECOVERY_RUNBOOK.md).

**Data da auditoria:** 2026-09-17
**Branch:** `claude/inspiring-thompson-yh6hc9`
**Revisão sugerida:** a cada 3 meses, ou imediatamente após qualquer
offboarding, rotação de credencial ou achado CRITICAL/HIGH não corrigido.

---

## 0. Limitações de acesso desta sessão (leia antes do resto)

Esta sessão roda num container isolado, sem browser e sem sessão logada em
nenhum console externo. Duas fontes de evidência real foram usadas:

1. **GitHub via API/MCP** — o único provedor com acesso programático real
   nesta sessão. Dados abaixo marcados com evidência real são deste tipo.
2. **O próprio repositório** (código, configs, `.github/workflows/*`,
   `codemagic.yaml`, `.env.example`, `.gitleaks*`) — varredura completa
   feita nesta sessão.
3. **Histórico já registrado no `CLAUDE.md`** — verificações de console
   feitas em sessões ANTERIORES (via "Claude in Chrome", logado como
   `queroumacor@gmail.com`), citadas aqui com a data original. Tratadas
   como evidência de quando foram verificadas, não revalidadas agora.

**Tentativa registrada e falhou**: tentei consultar DNS público
(NS/CAA/DS/DMARC de `queroumacor.com.br` e `calicolors.com.br`) via
DNS-over-HTTPS (`dns.google`), sem precisar de nenhuma credencial. O proxy
de rede do ambiente **bloqueou com 403** qualquer host fora da allowlist
(só `registry.npmjs.org`, `pypi.org`, `api.anthropic.com` etc. passam).
Ou seja: **nem informação pública de DNS é verificável desta sessão** —
não só consoles autenticados.

**Nunca marcado PASS por suposição.** Todo item que dependeria de login em
Cloudflare, Supabase, Google Cloud/Firebase/Play, Apple Developer/App
Store Connect, Codemagic, Sentry, Meta Business/WhatsApp, Mercado Pago ou
qualquer registrar está `NOT VERIFIED` abaixo, com a data da última
verificação humana conhecida (se houver) e o que precisa ser conferido.

---

## 1. Inventário de serviços externos

| Serviço | Owner conhecido | Admins conhecidos | Service accounts | Tokens/keys (nomes) | MFA | Recovery | Audit log | Criticidade | Status |
|---|---|---|---|---|---|---|---|---|---|
| **GitHub** (repo `queroumacor-max/queroumacorapp`) | `queroumacor-max` (conta pessoal, admin/dono) | `jacksongmatos` (write) | Claude GitHub App (integração desta sessão) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `LOAD_TEST_URL`, `GITHUB_TOKEN` (default) | NOT VERIFIED | NOT VERIFIED (conta pessoal) | GitHub Audit Log existe mas não consultado (sem tool) | CRITICAL | PARTIALLY VERIFIED |
| **Cloudflare** (Pages + DNS + WAF) | Presumido `queroumacor@gmail.com` (não confirmado nesta sessão) | NOT VERIFIED (nº de membros/roles nunca documentado) | n/a | `CLOUDFLARE_API_TOKEN` (escopo `Pages:Edit`, confirmado 2026-09-16) | NOT VERIFIED | NOT VERIFIED | Não verificado | CRITICAL | NOT VERIFIED (exceto o escopo do token, herdado de 2026-09-16) |
| **Supabase** (projeto + Auth + DB) | NOT VERIFIED | NOT VERIFIED | n/a (sem service account GCP-style; usa `service_role` key) | `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (+ variantes) | Auth do APP verificado 2026-09-16 (Captcha OFF, leaked-password ON); MFA da CONTA Supabase (quem loga no dashboard) NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | CRITICAL | NOT VERIFIED |
| **Google Cloud / Firebase** (proj. `queroumacor-245ef`) | Presumido `queroumacor@gmail.com` | 1 owner + 2 service accounts (verificado 2026-09-16) | `codemagic-play-publisher` + 1 outra (não nomeada no histórico) | `FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | HIGH | PARTIALLY VERIFIED (2026-09-16, desatualizando) |
| **Google AI Studio (Gemini)** | Mesma conta `queroumacor@gmail.com` (confirmado por ela administrar 2 projetos: "Quero uma cor" e "JR Erp") | NOT VERIFIED | n/a | `GEMINI_API_KEY` (chave ativa termina `...iVmQ`) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | MEDIUM | PARTIALLY VERIFIED (2026-09-16) |
| **Apple Developer / App Store Connect** | **Account Holder**: `queroumacor@gmail.com` | Admin adicional: `beatrisporsebon@icloud.com` (**CONFIRMADO INTENCIONAL pelo dono em 2026-09-16**) | n/a | APNs Auth Key `2R6FW9F2F6` (.p8, não expira) | NOT VERIFIED (Apple exige 2FA por política, mas não confirmado nestas 2 contas especificamente) | NOT VERIFIED | NOT VERIFIED | CRITICAL | PARTIALLY VERIFIED |
| **Google Play Console** | NOT VERIFIED (presumido mesma conta) | NOT VERIFIED | `codemagic-play-publisher` (GCP SA usada via Play Developer API) | Play App Signing (upload key `my-release-key.jks`, confirmado consistente) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | CRITICAL | PARTIALLY VERIFIED |
| **Codemagic** | NOT VERIFIED | NOT VERIFIED | n/a | Env groups `firebase`, `google_credentials`; keystore `queroumacor_keystore`; integração App Store Connect `codemagic` | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | HIGH | NOT VERIFIED |
| **Sentry** | NOT VERIFIED | NOT VERIFIED | n/a | `SENTRY_AUTH_TOKEN` (confirmado AUSENTE do build de produção CF Pages, 2026-09-16) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | MEDIUM | NOT VERIFIED |
| **Meta Business Manager / WhatsApp Cloud API** | NOT VERIFIED | NOT VERIFIED | System users NOT VERIFIED | `META_APP_SECRET`, `WHATSAPP_WEBHOOK_URL_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | HIGH | NOT VERIFIED |
| **Dualhook** (proxy 3º-party entre app↔Meta Cloud API, desde 2026-09-05) | **NÃO estava no inventário original do pedido** — vendor externo descoberto nesta varredura | NOT VERIFIED | n/a | `DUALHOOK_API_KEY` | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | HIGH (tem acesso de envio/recebimento no canal WhatsApp) | NOT VERIFIED — **novo item de inventário** |
| **Evolution API** (self-host Baileys no Render, "aposentada" 2026-09-05) | NOT VERIFIED | NOT VERIFIED | n/a | `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_TOKEN` (`.env.example` marcado como deprecated em 2026-09-17, mas isso NÃO desliga nada — a instância real no Render e as envs no Cloudflare Pages continuam existindo até ação manual) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | MEDIUM→HIGH se ainda ativa | **DORMANT — ação manual pendente, ver §14** |
| **Mercado Pago** | NOT VERIFIED | NOT VERIFIED | n/a | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (código vivo, mas sem call-site de UI ativo — ver §15) | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | HIGH (financeiro) | NOT VERIFIED |
| **Domain registrar — Registro.br** (`queroumacor.com.br`) | NOT VERIFIED | NOT VERIFIED | n/a | n/a | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | CRITICAL | NOT VERIFIED |
| **Domain registrar — GoDaddy** (`calicolors.com.br`) | NOT VERIFIED | NOT VERIFIED | n/a | n/a | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | CRITICAL | NOT VERIFIED |
| **Email crítico** (`loja@calicolors.com.br`, contas admin em `@gmail.com`) | NOT VERIFIED (provedor da mailbox `calicolors.com.br` não documentado) | NOT VERIFIED | n/a | n/a | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | CRITICAL (raiz de recovery de quase tudo) | NOT VERIFIED |
| **Password manager** | NOT VERIFIED — nenhuma menção em todo o histórico do projeto | — | — | — | — | — | — | — | **NOT VERIFIED — possível ausência total, ver §16** |

---

## 2. Identidade principal por serviço (owner/root/account holder)

| Serviço | Identidade presumida como owner | Evidência | Confiança |
|---|---|---|---|
| GitHub (repo) | `queroumacor-max` | API `list_repository_collaborators` (2026-09-17, esta sessão): `admin` role | Alta (verificado agora) |
| GitHub (colaborador) | `jacksongmatos` | Mesma API: `write` role. É a identidade usada pelas sessões Claude Code para commitar/PR | Alta (verificado agora) |
| Firebase/GCP, Apple Developer, Google AI Studio, (presumivelmente) Cloudflare e Play Console | `queroumacor@gmail.com` | Sessões "Claude in Chrome" anteriores logaram com esse e-mail para verificar IAM do Firebase/GCP e Apple Developer | Média-alta (documentado, mas não re-confirmado nesta sessão; Cloudflare/Play nunca tiveram o e-mail do operador confirmado explicitamente, só inferido pelo padrão) |
| Supabase, Sentry, Codemagic, Meta Business, Mercado Pago, registrar Registro.br, registrar GoDaddy | **NOT VERIFIED** | Nenhuma sessão registrou qual conta/e-mail é dona destes | Nenhuma — gap real de documentação |

**Achado direto**: se a suposição acima estiver certa, **`queroumacor@gmail.com` é uma conta pessoal Gmail (não um Google Workspace da empresa)** que concentra Firebase, GCP, Apple Developer, Google AI Studio e provavelmente Cloudflare/Play. Isso é exatamente o cenário do item 3 do pedido ("infraestrutura crítica presa a email pessoal") — ver §8 (Single Points of Failure).

---

## 3. Conta pessoal vs. conta da empresa

- **CNPJ da operadora**: CALICOLORS TINTAS LTDA (`47.677.346/0001-92`), já documentado em `CLAUDE.md` para uso em documentos legais.
- **Nenhuma evidência de Google Workspace corporativo** (`@calicolors.com.br` ou `@queroumacor.com.br` como domínio de conta administrativa) em nenhum dos consoles do Google/Apple mapeados — a conta usada é `@gmail.com` pessoal.
- **`loja@calicolors.com.br`** existe e responde (confirmado ativo), mas é usada como **caixa de atendimento ao cliente/suporte**, não como identidade administrativa de infraestrutura — não há registro de nenhum console logado com esse e-mail.
- **Não alterado automaticamente** (regra do pedido). Recomendação registrada em §16: migrar identidade administrativa de infraestrutura crítica para uma conta com domínio próprio da empresa (Google Workspace ou equivalente) é uma decisão do usuário, não executada aqui.

---

## 4. IAM Matrix

| Principal | Serviço | Role | Necessário? | MFA | Último uso | Status |
|---|---|---|---|---|---|---|
| `queroumacor-max` | GitHub (repo) | Admin | Sim (owner) | NOT VERIFIED | NOT VERIFIED | AUTHORIZED |
| `jacksongmatos` | GitHub (repo) | Write | Sim (operação diária/CI de sessões Claude) | NOT VERIFIED | Ativo (usado por esta sessão) | AUTHORIZED |
| `queroumacor@gmail.com` (presumido) | GCP/Firebase `queroumacor-245ef` | Owner | Owner é role ampla — avaliar se uma role menor bastaria para operação diária (item 4/58 do pedido) | NOT VERIFIED | Verificado ativo em 2026-09-16 | AUTHORIZED, mas ROLE AMPLA — ver §16 |
| `codemagic-play-publisher` | GCP (service account) | Usado via Google Play Developer API para publish | Sim, escopo específico | N/A (service account) | Ativo (builds mobile) | AUTHORIZED — **permissões exatas no Play Console NOT VERIFIED** |
| 2ª service account GCP (não nomeada no histórico) | GCP `queroumacor-245ef` | NOT VERIFIED | NOT VERIFIED — **precisa identificar propósito** | N/A | Chave ~13-16 dias (em 2026-09-16) | UNKNOWN — HIGH PRIORITY REVIEW (ver §15) |
| `queroumacor@gmail.com` | Apple Developer | Account Holder + Admin | Sim (é o dono) | NOT VERIFIED | NOT VERIFIED | AUTHORIZED |
| `beatrisporsebon@icloud.com` | Apple Developer | Admin | **Confirmado intencional pelo dono em 2026-09-16** | NOT VERIFIED | NOT VERIFIED | **AUTHORIZED** (não é achado novo — reconfirmação do pedido item 8) |
| Claude GitHub App | GitHub (repo) | Integração (escopo da instalação não listado por esta sessão) | Sim, para as sessões Claude Code operarem | N/A | Ativo (usado agora) | AUTHORIZED — **escopo exato de permissões NOT VERIFIED** |

---

## 5. Critical Account Matrix

| Conta | Serviços recuperáveis por ela | MFA | Recovery | Blast radius | Status |
|---|---|---|---|---|---|
| `queroumacor@gmail.com` (presumido) | Firebase/GCP, Google AI Studio (2 projetos, incluindo um de OUTRA empresa "JR Erp"), Apple Developer (Account Holder), provavelmente Cloudflare e Google Play | NOT VERIFIED | **Provavelmente e-mail/telefone de recovery do próprio Google — circular com o Gmail em si** (ver §9) | **MUITO ALTO** — comprometer esta conta expõe mobile publishing (Android+iOS), push (FCM/APNs), Gemini keys de 2 empresas, e possivelmente DNS/CDN (Cloudflare) e loja mobile (Play) | **SINGLE POINT OF FAILURE — não confirmado 2º admin em nenhum destes exceto Apple** |
| `queroumacor-max` (GitHub) | Todo o histórico do repo, Actions secrets (`CLOUDFLARE_API_TOKEN` escopado a Pages:Edit), branch protection config, capacidade de criar/apagar workflows | NOT VERIFIED | Conta pessoal GitHub — recovery via e-mail cadastrado, NOT VERIFIED qual é | **ALTO** — code execution em CI (workflows), força-push via `rollback.yml`, mas token CF é least-privilege (Pages only) | Single admin do repo, mas há um 2º colaborador (`jacksongmatos`, write) — não é SPOF total no GitHub |
| `beatrisporsebon@icloud.com` | Apple Developer (Admin) — pode gerenciar certificados, apps, TestFlight | NOT VERIFIED | NOT VERIFIED | **MÉDIO-ALTO** dentro do escopo Apple | AUTHORIZED (confirmado 2026-09-16) |

---

## 6. Service Account Matrix

| Service account | Propósito | Roles | Nº de chaves | Idade da chave | Último uso | Status |
|---|---|---|---|---|---|---|
| `codemagic-play-publisher` (GCP) | Publicar AAB assinado na track `internal` do Google Play via Codemagic | Play Developer API (escopo exato NOT VERIFIED — deveria ser só "Release to testing tracks", nunca "Financial data"/"Manage users") | 1 (verificado 2026-09-16) | ~13-16 dias em 2026-09-16 (desatualizado agora, precisa reverificar) | Builds mobile Android | AUTHORIZED — reverificar escopo exato (item 79/80 do pedido) |
| 2ª service account GCP não nomeada | NOT VERIFIED — só "existe" no IAM (3 principals: 1 owner + 2 SAs) | NOT VERIFIED | 1 (verificado 2026-09-16) | ~13-16 dias em 2026-09-16 | NOT VERIFIED | **UNKNOWN — precisa nomear/confirmar propósito, HIGH PRIORITY** |
| FCM service account (`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY`) | Enviar push nativo via FCM HTTP v1 (RS256 JWT no edge) | Firebase Cloud Messaging API | NOT VERIFIED se é a mesma das 2 acima ou uma 3ª | NOT VERIFIED | Ativo (push funcionando, confirmado em produção 2026-09-05) | AUTHORIZED — confirmar se é uma das 2 já listadas ou uma 3ª chave não contabilizada |
| Dualhook (`DUALHOOK_API_KEY`) | Enviar/receber WhatsApp via proxy 3º-party pro número em Coexistence | Bearer token, escopo total do que o Dualhook permite nesse número | NOT VERIFIED (não é GCP, é vendor externo — não tem "rotação de chave" documentada) | NOT VERIFIED | Ativo (canal de produção) | AUTHORIZED — **vendor sem processo de rotação documentado, ver §11** |

---

## 7. API Token Matrix (sem valores)

| Token | Serviço | Propósito | Escopo | Expiração | Último uso conhecido | Status |
|---|---|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare | Deploy via `wrangler pages deploy` (GH Actions + local `deploy:prod`) | **Confirmado (2026-09-16): só `Cloudflare Pages:Edit`** — least privilege | NOT VERIFIED (tokens Cloudflare podem ter expiração configurada) | Usado em todo deploy manual/CI | GOOD — escopo mínimo confirmado |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare | Não é secret (é um ID), usado junto ao token acima | n/a | n/a | — | Informational |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Bypassa TODA RLS — usado só server-side (`getRuntimeEnv`, nunca client) | Alto — é o token mais privilegiado do projeto Supabase | NOT VERIFIED (Supabase não expira essa key por padrão; só rotação manual) | Ativo (toda rota admin/service-role do app) | **TRATAR COMO ROOT CREDENTIAL — ver §13** |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Cliente público, protegido por RLS | Baixo (por design, é pública) | n/a | Ativo | GOOD (intencionalmente pública, documentada no `.gitleaks.toml` como allowlist) |
| `GEMINI_API_KEY` | Google AI Studio | Chamadas de IA (14+ rotas) | **Restrições de API/IP/referrer: NOT VERIFIED** | NOT VERIFIED | Ativo | Reverificar restrições (item 60/61 do pedido) |
| `OPENAI_API_KEY` | OpenAI | Chamadas de IA (chat/transcrição/TTS) | NOT VERIFIED | NOT VERIFIED | Ativo | NOT VERIFIED |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | Mercado Pago | Pagamento (checkout PRO web + webhook) | NOT VERIFIED (produção vs teste) | NOT VERIFIED | **Código vivo, mas SEM call-site de UI ativo no app pra PRO checkout** — ver §15 | **CANDIDATO A REVISÃO — token de produção sem uso ativo confirmado** |
| `DUALHOOK_API_KEY` | Dualhook (WhatsApp proxy) | Enviar mensagens via `api.dualhook.com` | Total, dentro do número WhatsApp | NOT VERIFIED | Ativo (canal de produção) | Sem processo de rotação documentado |
| `WHATSAPP_WEBHOOK_URL_SECRET` / `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta/Dualhook | Autenticar webhook de entrada | Par que precisa rotacionar junto (documentado em `CLAUDE.md`) | Não expira sozinho | Ativo | GOOD — processo de rotação já documentado (par CF Pages + Dualhook) |
| `META_APP_SECRET` | Meta | HMAC do webhook (modo alternativo, hoje não é o modo ativo — ativo é `payload`) | NOT VERIFIED se ainda é usado | NOT VERIFIED | Modo atual é `payload`, não usa este secret | Candidato a confirmar se ainda necessário |
| `EVOLUTION_API_KEY` / `EVOLUTION_WEBHOOK_TOKEN` | Evolution API (Render, aposentada) | Legado — código atual não referencia mais | N/A | NOT VERIFIED | **Não usado desde 2026-09-05** | **DORMANT — ver §15, candidato a revogar** |
| `FCM_PRIVATE_KEY` | Firebase (service account) | JWT RS256 pra enviar push nativo | Escopo FCM apenas | Chave de service account não expira sozinha | Ativo (confirmado em produção) | AUTHORIZED |
| `PUSH_INTERNAL_SECRET` | Interno | Proteger `/api/push-notify` de chamada externa | Interno ao app | n/a | Ativo | GOOD |
| `SENTRY_AUTH_TOKEN` | Sentry | Upload de source maps no build | **Confirmado AUSENTE do ambiente de build de produção CF Pages (2026-09-16)** | n/a | Não usado em produção atualmente | Informational — reduz superfície, mas confirmar se existe em outro lugar (Codemagic? local?) |
| GitHub `GITHUB_TOKEN` (default, por workflow) | GitHub Actions | Token efêmero por execução, escopo por `permissions:` do próprio workflow | **Confirmado (via scan do repo): todos os 8 workflows têm bloco `permissions:` explícito, least-privilege** | Efêmero (por execução) | — | GOOD |

---

## 8. MFA Matrix

| Serviço | MFA do owner | MFA dos admins | Enforced? | Método | Status |
|---|---|---|---|---|---|
| GitHub | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED (conta pessoal — GitHub permite orgs forçarem MFA, mas isto não é uma org) | NOT VERIFIED | NOT VERIFIED |
| Cloudflare | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Supabase (Auth do PROJETO, não do dashboard) | N/A — isto é o Auth de usuários finais do app, já auditado: Captcha OFF, leaked-password protection ON, MFA TOTP disponível/SMS OFF (2026-09-16) | — | — | — | Ver §0 — MFA da CONTA que administra o Supabase (dashboard) é o que falta, não o Auth do app |
| Google Cloud/Firebase | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Apple Developer | NOT VERIFIED (Apple exige 2FA por política de plataforma desde 2021, mas não confirmado explicitamente para estas 2 contas) | NOT VERIFIED | Presumível (política Apple), não confirmado | NOT VERIFIED | NOT VERIFIED |
| Google Play Console | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Codemagic | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Sentry | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Meta Business Manager | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Mercado Pago | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| Registro.br | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| GoDaddy | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED |
| E-mail (`@gmail.com` administrativo) | NOT VERIFIED | — | — | — | **CRÍTICO enquanto não verificado — é a raiz de recovery de quase tudo, ver §9** |

**Nenhum item desta tabela pode ser marcado PASS.** Todos exigem login em console que esta sessão não tem. **MANUAL VERIFICATION REQUIRED em toda a linha.**

---

## 9. Recovery Matrix / Cadeia de recuperação

| Serviço | Owner primário | Método de recovery | 2º admin com recovery independente | Single point of failure? | Status |
|---|---|---|---|---|---|
| GitHub | `queroumacor-max` | NOT VERIFIED | `jacksongmatos` tem write, **mas não é admin/owner** — não consegue restaurar configurações de repo (branch protection, secrets) se `queroumacor-max` for perdido | **SIM, para funções de admin** (branch protection, secrets, transferência de repo) | SPOF parcial |
| Apple Developer | `queroumacor@gmail.com` (Account Holder) | NOT VERIFIED — Account Holder tem processo de recovery próprio da Apple, historicamente lento/manual | `beatrisporsebon@icloud.com` é Admin, **mas Admin não substitui Account Holder** em billing/contratos legais da Apple | **SIM** — perda do Account Holder é o pior cenário aqui, mitigado só parcialmente pelo 2º admin | SPOF para funções de Account Holder |
| Firebase/GCP, Google AI Studio, (presumivelmente) Cloudflare/Play | `queroumacor@gmail.com` (mesma conta em todos) | NOT VERIFIED | **Nenhum 2º admin confirmado em nenhum destes** | **SIM, e é o pior item desta lista** — uma única conta Gmail pessoal concentra recovery de 4-5 serviços críticos | **SINGLE POINT OF FAILURE CRÍTICO** |
| Supabase, Sentry, Codemagic, Meta, Mercado Pago, registrars | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | **NOT VERIFIED — não sabemos nem se há um único owner conhecido** |

### Cadeia de recuperação (email comprometido → o que cai)

Se `queroumacor@gmail.com` for comprometido (phishing, senha vazada, SIM
swap no telefone de recovery):

1. **Google Account** inteiro (Gmail, Drive, etc.) — ponto de entrada.
2. **Firebase/GCP** (`queroumacor-245ef`) — atacante vira Owner: pode criar
   novas service account keys, alterar IAM, desabilitar FCM, ler configs.
3. **Google AI Studio** — pode ler/rotacionar `GEMINI_API_KEY` de **duas**
   contas de negócio (a desta app E "JR Erp").
4. **Apple Developer** — Account Holder: pode revogar certificados,
   remover o admin `beatrisporsebon@icloud.com`, publicar builds
   maliciosas, ou pior, transferir/deletar a conta de developer.
5. **Provavelmente Google Play Console e Cloudflare** (não confirmado, mas
   é o padrão observado em todo o resto) — se sim, atacante publica AAB
   malicioso direto na Play Store E controla DNS/CDN/WAF da produção web.
6. **Password managers ou 2FA apps vinculados a este Gmail** (NOT
   VERIFIED se existem) também cairiam.

**Isso é o achado mais grave desta auditoria** (ver §13, §16 CRITICAL).
Não foi corrigido automaticamente — só documentado, conforme a regra do
pedido.

---

## 10. Blast Radius Matrix

| Ativo comprometido | O que o atacante ganha | Próximos sistemas em risco | Impacto máximo | Mitigações já existentes |
|---|---|---|---|---|
| `queroumacor@gmail.com` (conta Google pessoal) | Controle de Firebase/GCP, Google AI Studio (2 empresas), Apple Developer Account Holder, provavelmente Play/Cloudflare | Push nativo (FCM/APNs), mobile publishing (Android+iOS), Gemini keys, possivelmente DNS/CDN/WAF de produção | **Total** — supply-chain completo do app mobile + IA + possivelmente o site inteiro | Apple tem 2º admin (`beatrisporsebon@icloud.com`), mas ele não recupera o Account Holder. Nenhuma outra mitigação confirmada. |
| `queroumacor-max` (GitHub, admin) | Controle total do código-fonte, Actions secrets (`CLOUDFLARE_API_TOKEN` escopado), branch protection, workflows (incl. `rollback.yml` que força-push `main`) | Deploy Cloudflare Pages (mas só `Pages:Edit`, não a conta CF inteira) | Alto — pode inserir código malicioso e forçar deploy | Branch protection com check `validate` obrigatório (histórico confirmado); CF token é least-privilege (limita o blast radius pro lado Cloudflare) |
| `SUPABASE_SERVICE_ROLE_KEY` (se vazar do ambiente Cloudflare Pages) | Bypass total de RLS — lê/escreve/apaga qualquer linha de qualquer tabela, inclusive `profiles`, `orders`, `quotes` (dados de leads/clientes) | Todo o banco de produção | **Total sobre os dados** (não sobre infra externa) | Nunca exposta ao client (confirmado por múltiplas auditorias de código); mas **quem tem acesso ao painel Cloudflare Pages consegue LER essa key em texto puro nas env vars** — a segurança dela hoje depende inteiramente de "quem acessa o Cloudflare", que é NOT VERIFIED (ver §8) |
| `DUALHOOK_API_KEY` | Enviar/receber mensagens como a loja no WhatsApp oficial, ler histórico de conversas do webhook | Reputação do número WhatsApp Business, possível engenharia social contra clientes | Alto (canal de atendimento e vendas) | Rotação manual documentada; nenhuma alarmística automatizada de uso anômalo confirmada |
| `MP_ACCESS_TOKEN` de produção | Ler/alterar cobranças, criar preferências de pagamento falsas | Receita/reputação financeira | Alto (financeiro) | Token de produção sem call-site de UI ativo hoje — **reduz a EXPOSIÇÃO de uso, mas não o risco se o valor vazar** |
| Evolution API / Render (se ainda ativo) | Se o serviço aposentado ainda estiver rodando com API key válida, um atacante que descubra a URL do Render pode operar o WhatsApp por um canal que a equipe acredita estar desligado | Canal WhatsApp paralelo não monitorado | Médio-alto, exatamente por ser esquecido | **Nenhuma — este é o ponto cego típico de serviço aposentado**, ver §15 |

---

## 11. Cross-service trust graph (quem confia em quem)

```
GitHub (queroumacor-max/queroumacorapp)
  └─ CLOUDFLARE_API_TOKEN (Pages:Edit) ──────► Cloudflare Pages (deploy de produção)
  └─ Codemagic (webhook/integração lê o repo) ─► Google Play Console (publish AAB, track internal)
                                              └─► App Store Connect (publish IPA, TestFlight)
       └─ env group "firebase" ──────────────► Firebase (google-services.json / GoogleService-Info.plist)
       └─ env group "google_credentials" ────► Google Play Developer API (service account)

Cloudflare Pages (runtime do next-app)
  └─ SUPABASE_SERVICE_ROLE_KEY ──────────────► Supabase (bypass total de RLS)
  └─ GEMINI_API_KEY / OPENAI_API_KEY ────────► Google AI Studio / OpenAI
  └─ FCM_PRIVATE_KEY ─────────────────────────► Firebase Cloud Messaging
  └─ DUALHOOK_API_KEY ────────────────────────► Dualhook ──► Meta WhatsApp Cloud API
  └─ MP_ACCESS_TOKEN ─────────────────────────► Mercado Pago
  └─ SENTRY_AUTH_TOKEN (ausente hoje) ────────► Sentry (upload de source maps, hoje não roda)

queroumacor@gmail.com (Google Account pessoal, presumido)
  └─ Firebase/GCP (Owner)
  └─ Google AI Studio (2 projetos, incl. de outra empresa)
  └─ Apple Developer (Account Holder)
  └─ (presumido, NOT VERIFIED) Cloudflare, Google Play Console
```

**Leitura de propagação de comprometimento** (item 292 do pedido):

- **GitHub comprometido → Cloudflare**: SIM, mas limitado — o token CF só
  faz `Pages:Edit`, não dá acesso à conta Cloudflare inteira (não altera
  DNS, WAF, billing). **Mitigação já existente e eficaz.**
- **Cloudflare comprometido (conta inteira, não só o token) → Supabase**:
  SIM, total — quem acessa o painel de env vars do Cloudflare Pages lê o
  `SUPABASE_SERVICE_ROLE_KEY` em texto puro. **Nenhuma mitigação além de
  controlar quem acessa a conta Cloudflare** (que é justamente o item
  NOT VERIFIED mais crítico desta auditoria).
- **`queroumacor@gmail.com` comprometido → quase tudo**: ver §9. **Pior
  cenário do sistema inteiro.**
- **Codemagic comprometido → Google Play + App Store**: SIM — Codemagic
  guarda as credenciais de publish de ambas as lojas. Se um atacante
  alterar `codemagic.yaml` (via GitHub, já que é lido do repo) OU
  comprometer a conta Codemagic diretamente, pode publicar update
  malicioso assinado. **Mitigação parcial**: publish de produção é manual
  nas duas lojas (só a track/TestFlight interna é automática) — reduz mas
  não elimina o risco (usuário em TestFlight/Internal Testing ainda
  recebe o malicioso).

---

## 12. Single Points of Failure (lista explícita)

1. **`queroumacor@gmail.com`** — concentra Firebase/GCP, Google AI Studio
   (2 empresas), Apple Developer Account Holder e presumivelmente
   Cloudflare/Play. **Nenhum 2º admin confirmado** exceto no Apple
   Developer. **O maior SPOF do sistema.**
2. **`queroumacor-max`** no GitHub — único admin do repo; `jacksongmatos`
   tem write mas não administra configurações de segurança do repo
   (branch protection, secrets, Actions settings).
3. **Quem quer que tenha acesso ao painel Cloudflare Pages** — hoje
   NOT VERIFIED quantas pessoas são, mas essa conta sozinha lê em texto
   puro o `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `DUALHOOK_API_KEY`
   e todos os outros secrets de runtime — é o cofre de fato de quase todo
   segredo do sistema.
4. **Ausência de password manager compartilhado documentado** — se
   nenhum existir (não há nenhuma menção em `CLAUDE.md`/docs), a
   recuperação de qualquer credencial hoje depende só da memória/acesso
   pessoal de quem já está logado — reforça todos os SPOFs acima.

---

## 13. Root credentials (o que cada uma consegue destruir)

| Credencial | Consegue apagar banco? | Consegue mudar DNS? | Consegue deployar código? | Consegue publicar app mobile? | Consegue acessar pagamentos? |
|---|---|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **SIM** (bypassa RLS total) | Não | Não | Não | Não (mas lê dados de `orders`/`quotes`) |
| Conta Cloudflare (não só o token) | Não diretamente, mas lê o service_role acima | **SIM** | **SIM** (Pages) | Não | Não |
| `queroumacor@gmail.com` | Indireto (via Cloudflare/Supabase, NOT VERIFIED se tem acesso direto) | **Provável (SIM)**, se administrar Cloudflare | **Provável** | **SIM** (Apple + presumivelmente Play) | Indireto |
| GitHub admin (`queroumacor-max`) | Não diretamente | Não diretamente | **SIM** (via Actions/CF token) | Não diretamente (mas pode alterar `codemagic.yaml`) | Não |
| `MP_ACCESS_TOKEN` | Não | Não | Não | Não | **SIM** (dentro do escopo de produção) |
| Codemagic (conta) | Não | Não | Não | **SIM** | Não |

---

## 14. Dormant / unknown access

| Item | Classificação | Evidência | Ação recomendada (NÃO executada) |
|---|---|---|---|
| **Evolution API (Render, self-host Baileys)** | **DORMANT — candidata a desligar/revogar** | Código atual (`next-app/lib/api/_services/whatsapp.ts` e afins) não referencia mais `EVOLUTION_*`; migração pro Dualhook documentada em 2026-09-05. Variáveis ainda existem em `.env.example` | **MANUAL VERIFICATION REQUIRED**: confirmar no painel do Render se a instância ainda está rodando; se sim, decidir com o usuário se desliga (para de cobrar) e revoga a API key; se as envs `EVOLUTION_*` ainda existem no Cloudflare Pages, também são candidatas a remoção |
| **`WHATSAPP_ACCESS_TOKEN` / `graph.facebook.com` direto** (token Meta pré-Dualhook) | Possivelmente órfão | Código não usa mais para envio desde a migração pro Dualhook (2026-09-05); não confirmado se a env ainda existe no Cloudflare Pages | **MANUAL VERIFICATION REQUIRED**: conferir se a env ainda está configurada; se sim e não usada, candidata a remoção/revogação |
| **`MP_ACCESS_TOKEN` / checkout PRO web** | Credencial de produção sem call-site de UI ativo | `startProCheckout` existe em código mas "não tem call site de UI nenhum" (documentado em `CLAUDE.md`, decisão de compliance Apple 3.1.3e) | **MANUAL VERIFICATION REQUIRED**: confirmar se a rota `/api/checkout` ainda é alcançável por algum caminho e se o token de PRODUÇÃO (não teste) precisa continuar ativo, ou se pode ser trocado por credencial de teste até a feature voltar |
| **2ª service account GCP não nomeada** | UNKNOWN — não identificado propósito no histórico | IAM do GCP mostra "1 owner + 2 service accounts", só uma foi nomeada (`codemagic-play-publisher`) | **HIGH PRIORITY REVIEW**: nomear e confirmar propósito da 2ª service account na próxima verificação de console |
| **`beatrisporsebon@icloud.com`** (Apple Developer Admin) | **NÃO é dormant/unknown** — confirmado intencional pelo dono em 2026-09-16 | Registrado explicitamente em `CLAUDE.md` | Nenhuma — **AUTHORIZED**, incluído aqui só para não deixar dúvida (item 8 do pedido) |
| Colaboradores/admins de Cloudflare, Supabase, Sentry, Codemagic, Meta, Mercado Pago, registrars | **NOT VERIFIED se há alguém além do owner presumido** | Nenhum destes teve lista de membros documentada em nenhuma sessão | **MANUAL VERIFICATION REQUIRED em todos** — não é possível classificar como dormant/unknown/authorized sem ver a lista real |

---

## 15. Achados por severidade

### CRITICAL

1. **Conta pessoal única (`queroumacor@gmail.com`, presumida) concentra
   recovery de Firebase/GCP, Google AI Studio, Apple Developer Account
   Holder e provavelmente Cloudflare/Play, sem 2º admin confirmado em
   nenhum deles exceto Apple.**
   - Cenário de ataque: phishing/senha vazada/SIM-swap nesta conta →
     atacante controla push mobile, publica app malicioso nas duas
     lojas, rotaciona chaves de IA de 2 negócios, possivelmente altera
     DNS/CDN de produção.
   - Blast radius: total, sobre múltiplos provedores simultaneamente.
   - Evidência: padrão observado em todas as verificações de console já
     feitas (todas logadas com este e-mail), sem nenhuma menção de 2º
     admin fora do Apple Developer.
   - Correção/recomendação: (a) confirmar 2FA forte (preferencialmente
     passkey/security key) nesta conta; (b) avaliar 2º admin de
     confiança em pelo menos Firebase/GCP e Google Play; (c) migrar
     identidade administrativa pra domínio próprio da empresa a médio
     prazo.
   - **Ação manual do usuário — não executado aqui.**

2. **Ninguém confirmou MFA em NENHUM dos 12 provedores externos críticos
   nesta sessão** (Cloudflare, Supabase, GCP, Firebase, Apple, Play,
   Codemagic, Sentry, Meta, Mercado Pago, 2 registrars). Não é evidência
   de ausência de MFA — é ausência de VERIFICAÇÃO, que é por si um
   achado (regra do próprio pedido: "não marcar PASS sem verificar").
   - **MANUAL VERIFICATION REQUIRED em todos.**

3. **Cadeia "Cloudflare comprometido → lê `SUPABASE_SERVICE_ROLE_KEY` em
   texto puro"** — quem tem acesso ao painel do Cloudflare Pages tem, de
   fato, acesso equivalente a bypass total de RLS do Supabase, sem
   precisar comprometer o Supabase diretamente. Combinado com o item 1
   (Cloudflare provavelmente administrado pela mesma conta pessoal), a
   conta Google única pode ser, na prática, root de todo o backend.

### HIGH

4. **Evolution API (Render) — serviço aposentado com credenciais
   possivelmente ainda ativas.** Ver §14. Serviço esquecido com token
   vivo é o padrão clássico de brecha que ninguém audita porque "já foi
   desligado" sem confirmação.
5. **2ª service account GCP não identificada.** Ver §14 — precisa nome e
   propósito confirmados.
6. **`MP_ACCESS_TOKEN` de produção sem call-site de UI ativo.** Risco
   financeiro latente sem uso corrente.
7. **Dualhook (vendor WhatsApp) não estava no inventário original do
   usuário** — é um provedor com acesso total de envio/recebimento no
   número oficial da loja, sem MFA/ownership/rotação documentados.
8. **✅ FIXADO EM CÓDIGO (2026-09-17)** — checklist de offboarding
   criado em `ACCOUNT_RECOVERY_RUNBOOK.md` §5, cobrindo os 12
   provedores da tabela de inventário. **Continua exigindo execução
   MANUAL a cada saída** (o checklist não automatiza revogação).
9. **Nenhuma evidência de password manager compartilhado** — se
   realmente não existe, toda credencial depende de acesso pessoal
   individual, sem trilha de auditoria de "quem tem a senha".

### MEDIUM

10. **🟡 PARCIALMENTE FIXADO (2026-09-17)** — `rollback.yml` ganhou
    `environment: production-rollback` no job. Isso deixa o workflow
    PRONTO pra ser gated, mas **é inerte até uma ação MANUAL**: criar a
    proteção de "required reviewers" nesse environment em
    Settings → Environments → `production-rollback`. Sem esse passo,
    o comportamento do workflow não muda em nada.
11. **🟡 PARCIALMENTE FIXADO (2026-09-17)** — `CODEOWNERS` criado na
    raiz, escopado só a `.github/workflows/`, `migrations/`,
    `.github/SECURITY.md` e o próprio `CODEOWNERS` (não ao repo
    inteiro, pra não travar PR de rotina). **Também é inerte até uma
    ação MANUAL**: ligar "Require review from Code Owners" em
    Settings → Branches → `main`.
12. **Nenhum rulesets/branch-protection-as-code versionado** — a
    configuração de proteção de branch existe (confirmada por evidência
    indireta: recusa histórica com "Required status check"), mas não
    está em código, então mudanças nela não passam por PR/review.
13. **API restrictions do `GEMINI_API_KEY` (HTTP referrer/IP) não
    verificadas** — sem isso, se a key vazar de qualquer forma, não há
    trava adicional no lado do Google.

### LOW

14. Documentação de ownership/baseline não existia até esta auditoria
    (este próprio documento resolve o item, mas fica registrado como
    "não havia baseline antes").
15. `WHATSAPP_ACCESS_TOKEN`/`graph.facebook.com` possivelmente ainda
    configurado sem uso — mesma classe do item 4/6, mas menor
    criticidade por não ter sido usado desde a migração documentada.

---

## 16. Active compromise indicators

**NONE FOUND BASED ON AVAILABLE EVIDENCE.**

Esta frase se aplica só ao que foi possível examinar: o próprio
repositório (nenhum segredo real commitado, histórico de git limpo,
nenhum workflow malicioso, nenhum colaborador desconhecido no GitHub) e
o histórico já documentado em `CLAUDE.md` (nenhuma menção a sessão
desconhecida, token desconhecido ou role grant inesperado nos consoles
já verificados anteriormente).

**Isto NÃO significa "nenhum compromisso" nos provedores não verificados
nesta sessão** (Cloudflare, Supabase, GCP além do já registrado, Apple
além do já registrado, Play, Codemagic, Sentry, Meta, Mercado Pago,
registrars) — para esses, o correto é **NOT VERIFIED**, não "sem
compromisso".

---

## 17. Verificação (PASS / FAIL / NOT VERIFIED)

| Item | Status |
|---|---|
| External service inventory | PASS (compilado; ver §1) |
| GitHub owners/members | **PASS** — verificado agora via API: `queroumacor-max` (admin), `jacksongmatos` (write), sem outros |
| GitHub MFA | NOT VERIFIED |
| GitHub PATs/apps | NOT VERIFIED (Claude GitHub App confirmada em uso pela integração; escopo exato e outras apps não verificados) |
| GitHub Actions external settings (permissions/pinning/persist-credentials) | **PASS** — verificado via varredura do repo: todos os 8 workflows com `permissions:` explícito, sem `pull_request_target`, actions de terceiros pinadas por SHA, `persist-credentials:false` em todos exceto `rollback.yml` (por design) |
| Cloudflare IAM | NOT VERIFIED |
| Cloudflare MFA | NOT VERIFIED |
| Cloudflare API token scope | **PASS** (herdado de verificação 2026-09-16: `Pages:Edit` apenas) |
| Supabase organization access | NOT VERIFIED |
| Supabase MFA | NOT VERIFIED |
| Supabase DB admin access | NOT VERIFIED |
| GCP IAM | PARTIALLY VERIFIED (herdado de 2026-09-16: 3 principals, sem detalhe de roles exatas) |
| Firebase IAM | PARTIALLY VERIFIED (mesma fonte) |
| Service account keys | PARTIALLY VERIFIED (1 chave por SA, ~13-16 dias em 2026-09-16 — desatualizado, precisa reconferir) |
| Apple Developer access | PARTIALLY VERIFIED (Account Holder + 1 Admin confirmado e classificado AUTHORIZED) |
| Apple 2FA | NOT VERIFIED |
| APNs keys | PARTIALLY VERIFIED (1 chave `.p8`, não expira, sandbox+production — herdado de histórico) |
| Google Play access | NOT VERIFIED |
| Play service account | PARTIALLY VERIFIED (nome conhecido, permissões exatas NOT VERIFIED) |
| Codemagic access | NOT VERIFIED |
| Meta Business access | NOT VERIFIED |
| Meta 2FA | NOT VERIFIED |
| WhatsApp account access | NOT VERIFIED (+ achado: Dualhook como vendor adicional não estava no radar) |
| Mercado Pago access | NOT VERIFIED |
| Sentry access | NOT VERIFIED |
| Domain registrar MFA | NOT VERIFIED |
| Domain lock | NOT VERIFIED |
| DNS ownership | NOT VERIFIED (tentativa de checagem pública via DoH bloqueada pelo proxy do ambiente — nem dado público de DNS foi possível confirmar nesta sessão) |
| Email recovery security | NOT VERIFIED |
| Dormant admin accounts | PARTIALLY VERIFIED (Evolution API identificada como serviço dormant candidato; demais NOT VERIFIED) |
| Unknown accounts | PASS no GitHub (nenhum desconhecido); NOT VERIFIED nos demais |
| Secret ownership inventory | PASS (ver §7, sem valores) |
| Recovery procedures | FAIL (não documentados antes desta auditoria; ver `ACCOUNT_RECOVERY_RUNBOOK.md`) |
| Break-glass | **NOT IMPLEMENTED** (nenhuma evidência de conta break-glass em nenhum provedor) |
| Single points of failure | PASS — identificados e documentados em §12 |
| External security baseline | PASS — este documento |

---

## 18. FINAL STATUS

## **HIGH ACCOUNT-TAKEOVER RISK**

Justificativa (qualquer um destes já desqualifica "HARDENED", e há
múltiplos presentes):

- Um único e-mail pessoal (`queroumacor@gmail.com`, presumido) parece
  concentrar recovery de Firebase/GCP, Google AI Studio, Apple Developer
  Account Holder e provavelmente Cloudflare/Play, sem 2º admin
  confirmado fora do Apple.
- MFA não confirmado em NENHUM dos 12 provedores externos críticos.
- Serviço aposentado (Evolution API) com credenciais potencialmente
  ainda ativas, não confirmado como desligado.
- Nenhum break-glass documentado em nenhum provedor.
- Nenhum password manager compartilhado confirmado.

Isto **não é evidência de comprometimento ativo** (ver §16) — é o
estado real de verificação possível hoje: a maior parte da superfície
crítica está fora do alcance desta sessão e nunca foi documentada em
detalhe suficiente nas sessões anteriores (que verificaram RLS/código,
não IAM/identidade). A classificação reflete risco estrutural
(concentração + falta de verificação), não um ataque em andamento.

**Não pode ser promovido a "PARTIALLY HARDENED" até**: (a) confirmar
MFA nos provedores CRITICAL (Cloudflare, Supabase, GCP/Firebase, Apple,
Play, registrars, e-mail administrativo); (b) resolver o status do
Evolution API dormant; (c) mapear quem tem acesso de fato ao painel
Cloudflare (hoje o gap mais explorável, por concentrar o
`SUPABASE_SERVICE_ROLE_KEY` em texto puro).

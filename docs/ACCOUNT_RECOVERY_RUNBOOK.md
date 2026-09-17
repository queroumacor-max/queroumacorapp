# Account Recovery Runbook — QueroUmaCor

> Foco em **identidade, consoles e administrative takeover** — "se a
> conta X for perdida/comprometida, como recuperamos acesso?". Não
> duplica `docs/INCIDENT_RESPONSE.md` (que cobre resposta operacional a
> incidentes de produção/dados). Ver `EXTERNAL_SECURITY_BASELINE.md` para
> o inventário completo e os achados por severidade.

**Baseline desta versão:** 2026-09-17, branch `claude/inspiring-thompson-yh6hc9`.
**Revisão sugerida:** junto com a baseline, a cada 3 meses.

---

## 1. Break-glass — estado atual

**NÃO EXISTE nenhuma conta/procedimento de break-glass documentado em
nenhum provedor.** Isso é, por si, um achado (item 218 do pedido de
auditoria: "pode ser operational risk").

O que "existir break-glass" significaria aqui, provedor a provedor:
- Uma conta/credencial de emergência, **não usada no dia a dia**, com
  MFA forte, monitorada, e cujo acesso físico/lógico (senha, chave de
  recovery) fica guardado com segurança (idealmente separado da conta
  administrativa principal).
- Testável periodicamente sem afetar produção.

**Recomendação (não implementada — decisão do usuário)**: para os
provedores CRITICAL (Cloudflare, Supabase, GCP/Firebase, Apple
Developer, domain registrars, e-mail administrativo), avaliar um 2º
admin de confiança OU uma conta de recovery cofrada, especialmente onde
hoje só `queroumacor@gmail.com` sozinho consegue recuperar.

---

## 2. Ordem de rotação de emergência (se uma credencial vazar)

Em caso de suspeita de vazamento, esta é a ordem sugerida por blast
radius (mais alto primeiro) — **rotação real não foi executada por
esta auditoria, é só o runbook**:

1. **`SUPABASE_SERVICE_ROLE_KEY`** — bypassa RLS total. Rotacionar no
   dashboard Supabase (gera nova key) e atualizar imediatamente no
   Cloudflare Pages (env var de Production E Preview). Testar
   `/api/health` depois.
2. **Senha + MFA da conta que administra o Cloudflare** — se essa conta
   for a mesma `queroumacor@gmail.com`, priorizar junto com o item 4.
3. **`CLOUDFLARE_API_TOKEN`** — revogar no painel Cloudflare (My
   Profile → API Tokens), gerar novo com o MESMO escopo mínimo
   (`Pages:Edit`), atualizar no GitHub Actions secret.
4. **Senha + 2FA de `queroumacor@gmail.com`** (ou a conta que de fato
   for confirmada como owner) — reset de senha, remoção de qualquer
   dispositivo/sessão desconhecida, nova chave de segurança se
   disponível.
5. **`DUALHOOK_API_KEY`** e o par `WHATSAPP_WEBHOOK_URL_SECRET`/
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`** — rotacionar juntos (o processo já
   está documentado em `CLAUDE.md`: gerar novo segredo, colar nos DOIS
   lados — Cloudflare Pages e painel Dualhook — antes do redeploy).
6. **`GEMINI_API_KEY`** / **`OPENAI_API_KEY`** — regenerar no console
   correspondente, atualizar no Cloudflare Pages. Confirmar que a key
   antiga não aparece mais listada como ativa.
7. **`MP_ACCESS_TOKEN`** — regenerar no Mercado Pago, atualizar env.
8. **`FCM_PRIVATE_KEY`** (service account Firebase) — gerar nova chave
   JSON no GCP, revogar a antiga, atualizar env. Cuidado: revogar a
   antiga ANTES de confirmar a nova funciona quebra push até o deploy
   propagar — coordenar com uma janela de baixo tráfego.
9. **Certificado/keystore de assinatura mobile** (Android
   `queroumacor_keystore`, Apple APNs `.p8` / certificados de
   distribuição) — **NÃO rotacionar sem necessidade**: trocar a chave
   de assinatura do Android invalida updates existentes na Play Store
   (usuários não recebem mais atualização até reinstalar). Só rotacionar
   se houver evidência concreta de vazamento do arquivo `.jks`/`.p8`.

---

## 3. Tabletops — "se X for comprometido"

Para cada cenário: DETECTION / BLAST RADIUS / CONTAINMENT / RECOVERY /
MISSING CONTROL.

### 3.1 GitHub owner (`queroumacor-max`) comprometido

- **DETECTION**: GitHub envia alerta de novo login/dispositivo (se
  ativado — NOT VERIFIED); mudança inesperada em branch protection,
  Actions ou workflows apareceria no histórico de commits/PRs.
- **BLAST RADIUS**: código-fonte inteiro, capacidade de alterar
  workflows (incl. `rollback.yml`, que força-push `main`), Actions
  secrets (`CLOUDFLARE_API_TOKEN` — mas escopado a `Pages:Edit`).
- **CONTAINMENT**: `jacksongmatos` (write) não consegue remover o
  admin comprometido sozinho — **precisa do suporte do GitHub** para
  recuperar uma conta pessoal sem 2º owner. Revogar sessões/tokens da
  conta comprometida assim que o acesso for recuperado.
- **RECOVERY**: restaurar branch protection e settings a partir do que
  está documentado aqui e em `CLAUDE.md`; revisar todo commit desde a
  última verificação íntegra; rotacionar `CLOUDFLARE_API_TOKEN` (item 3
  da ordem acima) por precaução.
- **MISSING CONTROL**: sem 2º owner no repo, a recuperação depende do
  processo de suporte do GitHub para conta pessoal comprometida — mais
  lento que teria um segundo owner confirmado.

### 3.2 Cloudflare comprometido

- **DETECTION**: NOT VERIFIED se há alerta de novo login/API token
  configurado.
- **BLAST RADIUS**: DNS (pode redirecionar o domínio inteiro), Pages
  (pode alterar env vars — inclusive **ler o `SUPABASE_SERVICE_ROLE_KEY`
  em texto puro**), Workers, WAF (pode desligar as regras que já
  bloqueiam scraping/bots).
- **CONTAINMENT**: revogar todos os API tokens Cloudflare; se possível,
  suspender temporariamente o zone até confirmar o alcance do acesso.
- **RECOVERY**: seguir a ordem de rotação (§2, itens 1-3); reverificar
  DNS/CAA/DNSSEC/WAF contra o estado documentado em `CLAUDE.md`
  (Full Strict, HSTS preload, CAA com as 3 CAs, DNSSEC pendente de DS
  no Registro.br).
- **MISSING CONTROL**: nº de membros/roles da conta Cloudflare nunca
  foi documentado — não há como hoje dizer "revogamos o acesso do
  atacante e mantivemos o dos legítimos" sem antes levantar quem tem
  acesso.

### 3.3 Supabase admin comprometido

- **DETECTION**: NOT VERIFIED (audit logs do Supabase não verificados
  nesta sessão).
- **BLAST RADIUS**: acesso ao SQL Editor = acesso equivalente ao
  `service_role` (bypass de RLS), Storage, configuração de Auth, e
  possivelmente rotação/leitura de secrets do projeto e backups.
- **CONTAINMENT**: revogar sessões do usuário Supabase comprometido no
  dashboard da organização; rotacionar `SUPABASE_SERVICE_ROLE_KEY`
  imediatamente (isso não depende de saber quem foi comprometido).
- **RECOVERY**: revisar `pg_stat_activity`/logs de query recentes por
  atividade anômala (DELETE/UPDATE em massa); restaurar via PITR (o
  projeto está no plano PRO, com 7 dias de point-in-time recovery,
  conforme já documentado em `CLAUDE.md`) se houver dano confirmado.
- **MISSING CONTROL**: membros da organização Supabase e MFA nunca
  verificados — mesmo gap do Cloudflare.

### 3.4 E-mail administrativo comprometido (`queroumacor@gmail.com`, presumido)

- **DETECTION**: alertas de novo login do próprio Google (se
  habilitados — NOT VERIFIED); e-mails de "password reset solicitado"
  em serviços que usam esse e-mail para recovery chegando de forma
  inesperada.
- **BLAST RADIUS**: **o maior de todo o sistema** — ver
  `EXTERNAL_SECURITY_BASELINE.md` §9 (cadeia de recuperação completa:
  Firebase/GCP → Google AI Studio (2 empresas) → Apple Developer →
  provavelmente Play/Cloudflare).
- **CONTAINMENT**: trocar a senha do Google Account IMEDIATAMENTE,
  revisar dispositivos/sessões conectadas, revogar qualquer app OAuth
  desconhecido conectado à conta Google.
- **RECOVERY**: seguir a ordem completa do §2; adicionalmente, verificar
  no Apple Developer se `beatrisporsebon@icloud.com` (o Admin já
  confirmado) ainda é a única outra pessoa com acesso, e usá-la como
  canal alternativo de confirmação/2º fator humano durante a
  recuperação.
- **MISSING CONTROL**: nenhum 2º canal de recovery independente
  confirmado para NENHUM dos serviços que dependem deste e-mail.

### 3.5 Telefone/SIM comprometido (se SMS for usado como MFA em algum lugar)

- **DETECTION**: perda de sinal inesperada no telefone (indício clássico
  de SIM swap).
- **BLAST RADIUS**: depende de quais serviços usam SMS como fator —
  **Supabase Auth já tem SMS OFF** (confirmado 2026-09-16, TOTP
  disponível), mas o MFA das CONTAS administrativas (Google, Apple,
  Cloudflare, etc.) não foi verificado quanto ao método usado.
- **CONTAINMENT**: contatar a operadora para bloquear o SIM comprometido
  assim que houver suspeita.
- **RECOVERY**: trocar qualquer MFA baseado em SMS para TOTP/passkey
  assim que o número for recuperado.
- **MISSING CONTROL**: método de MFA usado em cada conta administrativa
  crítica não foi levantado nesta sessão (ver `EXTERNAL_SECURITY_BASELINE.md`
  §8) — não dá pra saber hoje quais contas dependeriam de SMS.

### 3.6 Apple Developer — Account Holder perdido/comprometido

- **DETECTION**: notificação da Apple sobre mudança de credenciais (se
  configurada).
- **BLAST RADIUS**: capacidade de publicar update malicioso em ambas as
  plataformas (via revisão de certificados/App Store Connect),
  revogação de certificados legítimos (derruba push e assinatura de
  builds existentes), remoção do Admin (`beatrisporsebon@icloud.com`).
- **CONTAINMENT**: contatar suporte Apple Developer imediatamente
  (processo de recovery de Account Holder é historicamente manual e
  mais lento que troca de senha comum — documentar isso como
  expectativa realista, não promessa de recovery rápido).
- **RECOVERY**: uma vez recuperado o Account Holder, revisar
  certificados ativos, revogar qualquer um desconhecido, confirmar que
  `beatrisporsebon@icloud.com` continua sendo o único 2º admin
  (nenhum admin novo foi adicionado pelo atacante).
- **MISSING CONTROL**: sem um 2º Account Holder possível (a Apple só
  permite um por conta de developer — é uma limitação da própria
  plataforma, não do processo do QueroUmaCor), o "Admin" é o teto do
  que se pode delegar. **Não há solução de código para isso — é uma
  restrição estrutural da Apple.**

### 3.7 Google Play Console — admin perdido/comprometido

- **DETECTION**: NOT VERIFIED (nº de admins do Play Console nunca
  levantado).
- **BLAST RADIUS**: publicar update malicioso, alterar dados
  financeiros/de pagamento do app, remover o app da loja.
- **CONTAINMENT**: revogar acesso da conta comprometida; verificar se a
  service account `codemagic-play-publisher` ainda tem só o escopo
  necessário (Release management, nunca "Financial data"/"Manage
  users").
- **RECOVERY**: confirmar Play App Signing intacto (upload key
  `my-release-key.jks` — se o atacante tentar resetar, isso pode
  invalidar updates futuros até reconciliar com o Play).
- **MISSING CONTROL**: nº de admins do Play Console e suas permissões
  exatas nunca foram verificados (ver `EXTERNAL_SECURITY_BASELINE.md`
  §7 — Play Service Account Matrix).

### 3.8 Domain registrar comprometido (Registro.br ou GoDaddy)

- **DETECTION**: NOT VERIFIED (nenhum alerta de mudança de DNS/
  transferência conhecido como configurado).
- **BLAST RADIUS**: **CRÍTICO** — atacante pode alterar nameservers
  (tirar o domínio do Cloudflare), interceptar e-mail (MX), completar
  transferência do domínio pra outro registrador, invalidar o
  `assetlinks.json`/deep links do app mobile.
- **CONTAINMENT**: contatar o registrador imediatamente para congelar
  qualquer transferência pendente (transfer lock, se ainda não
  estiver ativo — NOT VERIFIED, ver item 121 do pedido).
- **RECOVERY**: restaurar nameservers para o par esperado do Cloudflare;
  reverificar CAA/DNSSEC (o DS record em Registro.br ainda está
  pendente, então DNSSEC hoje NÃO protege contra esse cenário
  especificamente — outro motivo pra completar o item pendente).
- **MISSING CONTROL**: MFA e transfer lock em ambos os registradores
  nunca foram verificados. **Este é provavelmente o cenário de maior
  impacto e menor visibilidade de todo o sistema** — um domínio
  sequestrado derruba site, e-mail, deep links do app e OAuth callback
  simultaneamente.

### 3.9 Meta Business Manager / WhatsApp admin comprometido

- **DETECTION**: NOT VERIFIED.
- **BLAST RADIUS**: atacante pode migrar/deregistrar o número
  WhatsApp oficial, alterar o webhook (redirecionar mensagens de
  clientes para si), gerar novos tokens de acesso.
- **CONTAINMENT**: revogar tokens de acesso do Meta Business Manager;
  contatar o Dualhook (vendor da conexão atual) para confirmar/travar
  a configuração do número.
- **RECOVERY**: reconfigurar webhook com novo `WHATSAPP_WEBHOOK_URL_SECRET`/
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (par, atualizar nos dois lados);
  confirmar Phone Number ID / WABA ID batem com os esperados
  (`1220273824510260` / `1320667299892030`, documentados em
  `CLAUDE.md`).
- **MISSING CONTROL**: admins/system users do Meta Business Manager
  nunca foram listados; Dualhook (o vendor que hoje intermedia o envio)
  não tem processo de recovery documentado do lado deles.

### 3.10 Conta de pagamento (Mercado Pago) comprometida

- **DETECTION**: NOT VERIFIED.
- **BLAST RADIUS**: alterar dados bancários de recebimento, ler
  histórico de transações, gerar credenciais de produção falsas.
- **CONTAINMENT**: contatar o suporte do Mercado Pago imediatamente,
  revogar credenciais de API ativas.
- **RECOVERY**: regenerar `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`,
  reconfirmar dados bancários de recebimento não foram alterados.
- **MISSING CONTROL**: usuários/roles da conta Mercado Pago nunca
  verificados; **nota**: hoje o checkout PRO web não tem call-site de
  UI ativo (ver achado HIGH #6 na baseline) — reduz a superfície de
  exploração cotidiana, mas não o valor da credencial se vazar.

---

## 4. Contatos de segurança por provedor (a preencher pelo usuário)

Esta tabela fica **intencionalmente vazia de nomes/e-mails pessoais**
além do que já é público — preencher com quem de fato deve ser acionado
em cada incidente, sem colocar senhas aqui:

| Provedor | Canal de suporte oficial | Owner interno designado |
|---|---|---|
| GitHub | https://support.github.com | `queroumacor-max` (admin do repo) |
| Cloudflare | https://dash.cloudflare.com/?to=/:account/support | NOT VERIFIED |
| Supabase | https://supabase.com/dashboard/support | NOT VERIFIED |
| Google Cloud/Firebase | https://cloud.google.com/support | Presumido `queroumacor@gmail.com` |
| Apple Developer | https://developer.apple.com/contact/ | `queroumacor@gmail.com` (Account Holder) |
| Google Play Console | https://support.google.com/googleplay/android-developer | NOT VERIFIED |
| Codemagic | https://codemagic.io/support/ | NOT VERIFIED |
| Sentry | https://sentry.io/support/ | NOT VERIFIED |
| Meta Business Manager | https://business.facebook.com/business/help | NOT VERIFIED |
| Dualhook | (painel do vendor — URL não documentada aqui) | NOT VERIFIED |
| Mercado Pago | https://www.mercadopago.com.br/ajuda | NOT VERIFIED |
| Registro.br | https://registro.br/ajuda/ | NOT VERIFIED |
| GoDaddy | https://www.godaddy.com/help | NOT VERIFIED |
| Incidentes de produto/app (usuário final) | WhatsApp `(11) 95976-5031` / `loja@calicolors.com.br` | Já documentado em `CLAUDE.md` |

**Ação manual recomendada**: o usuário preencher os campos NOT VERIFIED
acima com quem de fato deve ser contatado — isto vira o índice rápido
em caso de incidente real.

---

## 5. Checklist de offboarding (item 10/13 da auditoria — não existia)

Quando alguém (colaborador, contractor) deixa de precisar de acesso,
revisar CADA linha abaixo — nenhuma é automática:

- [ ] **GitHub**: remover de `list_repository_collaborators` (Settings →
  Collaborators) — hoje só 2 pessoas têm acesso
  (`queroumacor-max` admin, `jacksongmatos` write); revogar qualquer PAT
  pessoal que a pessoa tenha gerado.
- [ ] **Cloudflare**: remover da lista de Members da conta (Manage
  Account → Members) — **hoje esta lista nunca foi levantada**, então o
  primeiro passo real é levantá-la (ver `EXTERNAL_SECURITY_BASELINE.md`
  §17).
- [ ] **Supabase**: remover da organização (Organization → Team).
- [ ] **Google Cloud/Firebase**: remover principal do IAM do projeto
  `queroumacor-245ef`.
- [ ] **Apple Developer**: remover de Users and Access — hoje só
  `queroumacor@gmail.com` (Account Holder) e `beatrisporsebon@icloud.com`
  (Admin, intencional).
- [ ] **Google Play Console**: remover usuário/permissão de release.
- [ ] **Codemagic**: remover da equipe/organização.
- [ ] **Sentry**: remover da organização.
- [ ] **Meta Business Manager**: remover admin/employee/system user.
- [ ] **Dualhook**: remover acesso ao painel.
- [ ] **Mercado Pago**: remover usuário da equipe.
- [ ] **Registro.br / GoDaddy**: revisar se a pessoa tinha acesso ao
  painel do registrador (raramente deveria ter).
- [ ] **E-mail administrativo / password manager**: revogar acesso a
  qualquer caixa ou cofre compartilhado.
- [ ] **Rotacionar** qualquer secret que a pessoa tenha visto em texto
  puro (ex.: se ela teve acesso ao painel Cloudflare Pages, tratar
  `SUPABASE_SERVICE_ROLE_KEY` e os demais secrets de runtime como
  potencialmente vistos — ver ordem de rotação no §2).

**Isto é um checklist, não uma automação** — nenhum item acima é
executado por software; cada um exige entrar no console do provedor.

---

## 6. O que este runbook explicitamente NÃO cobre

- Resposta operacional a incidente de produção (bug, downtime, dado
  incorreto) — isso é `docs/INCIDENT_RESPONSE.md`.
- Procedimento de deploy/rollback de código — isso é `docs/RUNBOOK.md`.
- Qualquer ação executada automaticamente: **nenhuma credencial foi
  rotacionada, nenhum acesso foi removido, nenhum MFA foi resetado por
  esta auditoria.** Tudo acima é runbook para ação manual futura.

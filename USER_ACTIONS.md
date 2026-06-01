# Action items pendentes do usuário (Jackson)

> Tudo que depende de você fazer manualmente (no painel CF, GoDaddy, Sentry, etc.) — não é code-actionable pelo Claude.
> Use este arquivo como checklist. Marque os feitos com [x].

## 🚀 Cutover Next.js (`next-app/`) — bloqueado em CF Pages setup

Sem isso o app Next.js só existe no repo, sem deploy.

### Setup inicial (uma vez, ~30min)

- [x] **CF Pages → criar novo project** `queroumacor-next` ✅ FEITO
  - Repo: `queroumacor-max/queroumacorapp`
  - Production branch: `main`
  - Build command: `cd next-app && npm install && npm run build:cf`
  - Build output: `next-app/.vercel/output/static`
  - Root directory: `/` (não next-app)
  - Compatibility flag: `nodejs_compat`

- [x] **KV namespace binding** no novo project ✅ FEITO
  - Variable: `KV`
  - Namespace: `queroumacorapp-cidades` (reaproveitado do vanilla)

- [x] **Environment variables** (Production + Preview) ✅ FEITO
  - Supabase URL/keys, Sentry DSN/AUTH_TOKEN, MP, OpenAI, Gemini, ADMIN_EMAILS

- [x] **CNAME preview**: `app2.queroumacor.com.br` → `queroumacor-next.pages.dev` ✅ FEITO (em propagação DNS)

- [x] **Compatibility flag `nodejs_compat`** ✅ FEITO

- [⏸] **MP_ACCESS_TOKEN + MP_WEBHOOK_SECRET** — ON HOLD por opção (decisão consciente: ativar quando quiser testar checkout/webhook em prod). Sem isso, `/api/checkout`, `/api/mp-checkout-loja` e `/api/mp-webhook` ficam inativos em `app2.queroumacor.com.br`. Vanilla em `queroumacor.com.br` continua usando os tokens originais sem alteração.

- [ ] **Substituir `REPLACE_WITH_KV_NAMESPACE_ID`** em `next-app/wrangler.toml`
  - Só necessário se for usar deploy via `wrangler` CLI. UI do Pages não precisa.

### Smoke test (1-2 semanas)

- [ ] **Login + cadastro** funciona em `app2.queroumacor.com.br`
- [ ] **Feed carrega** + paginação infinita + filtro por role
- [ ] **Stories**: carrega carousel + viewer + mark as seen + upload story
- [ ] **Like/comment/share/report/save** em posts (com otimistic UI)
- [ ] **Publicar post**: imagem, vídeo, com legenda IA
- [ ] **Chat 1:1** + 3-way (Cali Colors) + attachments + realtime entrega
- [ ] **Pedidos** + filtro
- [ ] **Leads** + comprar obra (RPC)
- [ ] **Notificações** + realtime badge
- [ ] **Profile edit** + upload avatar + especialidades + raio
- [ ] **Pipeline** orçamentos kanban + suggest price IA + send/approve/reject
- [ ] **CRM**: lista clientes + intervalo + draft IA + WhatsApp link
- [ ] **Agenda** calendário + criar job + status
- [ ] **Financeiro** entries + IA analysis
- [ ] **Marketplace**: produtos + filtros + busca + cart + checkout MP
- [ ] **Camisetas** com logo
- [ ] **Arte IG** (PRO): gerar com foto + style + aspect
- [ ] **Seu Zé** chat + voz (mic recording)
- [ ] **Ai-logo** generate + apply + save
- [ ] **Quals + courses** add/list/delete
- [ ] **Archive conversations**
- [ ] **Info pages** (sub-pages /info/* — algumas podem retornar 404 ainda)
- [ ] **Mercado Pago webhook** funciona em `app2.queroumacor.com.br/api/mp-webhook` (testar via sandbox MP)

### Cutover DNS (após smoke test passar)

- [ ] **Backup do vanilla CF Pages project** (snapshot do deploy atual, doc env vars)
- [ ] **Atualizar MP webhook URL no painel Mercado Pago** pra `https://queroumacor.com.br/api/mp-webhook` (será o Next.js)
- [ ] **DNS swap**:
  - `queroumacor.com.br` → CNAME `queroumacor-next.pages.dev`
  - `legacy.queroumacor.com.br` → CNAME `queroumacorapp.pages.dev` (fallback 30 dias)
- [ ] **Comunicar usuários PRO ativos** sobre rollout (se necessário)
- [ ] **Monitorar Sentry** primeiras 48h pós-cutover (erros novos > 0.5%?)
- [ ] **Monitorar Mercado Pago webhook** primeiros 7 dias (todos pagamentos processando?)

### Cleanup (~30 dias após cutover estável)

- [ ] **Deletar vanilla CF Pages project** `queroumacorapp` no painel CF
- [ ] **Limpar repo**: remover `/app.js`, `/modules/*`, `/functions/api/*`, `/shims.js`, `/head.js`, `/db.js`, `/utils.js`, `/policies.js`, `/schemas/*`, `/errors.js`, `/logger.js`, `/config.js`, `/events.js`, `/validators.js` (já não existe), `/index.html`, `/styles.css`
- [ ] **Manter como histórico**: `/ARCHITECTURE_PLAN.md`, `/MIGRATION_PLAN.md`, `/docs/adr/*`, `/LAYERS.md`
- [ ] **Atualizar CLAUDE.md** removendo referências vanilla, deixar só Next.js conventions

## 🔒 Outros action items não-bloqueantes

### DMARC em calicolors.com.br (~2min, segurança email)

- [ ] **GoDaddy → DNS → Add TXT record**
  - Host: `_dmarc`
  - Value: `v=DMARC1; p=none; rua=mailto:dpo@calicolors.com.br`
- [ ] Depois de 2-4 semanas vendo relatórios, escalar pra `p=quarantine` (spam) e depois `p=reject` (bloqueia)
- Por que: emails saindo de @calicolors.com.br hoje têm chance maior de cair em spam no Gmail/Yahoo (que desde 2024 exigem DMARC pra remetentes em volume).

### HSTS preload propagação (auto — só acompanhar)

- [x] ~Header `_headers` atualizado com `; preload`~ (feito 2026-05-31)
- [x] ~Cloudflare Edge HSTS Preload ativado no painel~ (feito 2026-05-31)
- [x] ~Submetido em hstspreload.org~ (feito 2026-05-31)
- [ ] **Aguardar 6-12 semanas** pra propagar via update do Chrome → Firefox → Safari (fila normal, sem ação necessária)
- ⚠️ **NÃO submeter outros subdomínios** sem garantir HTTPS perpétuo — sair da preload list leva 6+ meses.

### Sentry portal (já feito)

- [x] ~Loader Script ativado em ambos projetos~
- [x] ~Performance + Session Replay~
- [x] ~Code Mappings GitHub~

### KV cache (já feito)

- [x] ~Namespace `queroumacorapp-cidades` criado~
- [x] ~Binding `KV` no Pages project vanilla~
- [ ] **Reusar mesmo namespace** quando criar o project Next.js (passo de setup acima)

## 📊 Estado de migração (referência rápida)

```
VANILLA (queroumacor.com.br) — EM PRODUÇÃO
├─ Arquitetura: 37/40 ✅
├─ Tests: 142 verdes
├─ ESLint: 0 errors
└─ Status: estável, intacto até cutover

NEXT-APP (app2.queroumacor.com.br quando você criar) — DEV
├─ Phases 1-9: ✅ todas
├─ Features: 44/44 portadas
├─ Backend endpoints: 28/28 portados
├─ Tests: 694 verdes
├─ TS strict: 0 errors
└─ Status: aguardando você criar o CF Pages project pra ativar
```

## 🆘 Se algo der errado no cutover

1. **Vanilla ainda está rodando** em `queroumacorapp.pages.dev` — rollback é trocar DNS de volta
2. **Sentry vai alertar** erros novos imediatamente
3. **Próxima sessão Claude**: descrever o erro, eu hot-fixo no next-app, deploy automático em ~90s
4. **Plano B**: manter vanilla mais 30 dias enquanto debugamos — sem pressa pra deletar

## 📞 Quando me chamar (próxima sessão)

- Bug em produção (vanilla OU next-app)
- Feature nova
- Polish / refator
- Dúvida arquitetural
- "Tudo que está pendente?" → eu releio este arquivo e te falo

---

**Última atualização**: 2026-05-31 (sessão de migração completa Path C)

## Atualização 2026-05-31 (continuação)

- [x] **5 SQL waves rodadas no Supabase SQL Editor** ✅ FEITO
  - Wave 5: consent_log + audit_log + invite_codes + cleanup_orphan_media
  - Wave 6: full-text search (tsvector + GIN + search_all)
  - Wave 7: payments hardening (invoices + grace + ai_usage + plan_limits + triggers)
  - Wave 8: soft delete (6 tabelas com deleted_at + cleanup_soft_deleted)
  - feature_flags + rollout RPC

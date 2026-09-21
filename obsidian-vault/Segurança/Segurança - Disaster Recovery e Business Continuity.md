---
tags: [segurança, auditoria, disaster-recovery, backup, business-continuity]
---

# Auditoria de Disaster Recovery / Business Continuity

**Data:** 2026-09-17, branch `claude/elegant-mayer-a04g5h`. Relatório completo em `docs/DR_AUDIT_2026-09-17.md`; runbooks operacionais em `docs/DR_RUNBOOK.md`. **Status final: PARTIALLY RESILIENT.**

Pergunta central: *"se perdermos banco/storage/deploy/secrets/conta admin/um provider inteiro, dá pra restaurar de forma segura e previsível?"* — ainda não totalmente, e os motivos ficam documentados, não escondidos.

## Segunda rodada (mesma sessão): correção de código sem esperar decisão de produto
Pedido do usuário: "corrija o que for possível no código". `next-app/lib/drAuditTrail.ts` (`captureDrAuditEvent`, fail-safe, mesmo padrão de `lib/api/errors.ts`) espelha no Sentry — sistema EXTERNO ao Postgres, não rola pra trás junto com um PITR restore — dois eventos:
1. Bloqueio permanente de hash CSAM (`blockMediaPermanent`/`escalateToNcmec`, `lib/services/mediaReviewAdmin.ts`).
2. Exclusão de conta (`/api/delete-account` e a rota admin), além do `deletion_tombstones` (mesma DB, ver abaixo).

Replicar só hash/id/categoria/timestamp (nunca conteúdo) é o mesmo princípio das listas de hash do NCMEC — não precisou de decisão de compliance pra ser seguro.

**Limite que continua em aberto**: isto é um SINAL pra reconciliação MANUAL, não um job automático — depois de um restore, alguém ainda precisa procurar `dr_audit:account_deletion`/`dr_audit:media_hash_blocked` no Sentry e reaplicar à mão. Também não cobre a exclusão de conta feita direto pela RPC a partir do **portal vanilla** (`public/portal/app.js` chama `admin_delete_user` via supabase-js sem passar por `next-app`) — instrumentar isso exigiria recompilar o bundle do portal e refazer o hash SRI, o que este ambiente não tem como validar com segurança, então ficou de fora.

## 2 achados CRITICAL/HIGH de fundo, mitigados mas SEM reconciliação automática
1. Um PITR restore pra antes de um hash ser bloqueado em `media_hash_blocklist` reverte a proteção CSAM.
2. Restore pra antes de uma exclusão de conta ressuscita a conta.

A correção acima (espelho no Sentry) dá o sinal externo; reaplicar continua manual.

## Correção de código aplicada
`/migrations/2026-09-17-dr-deletion-tombstone-and-integrity.sql` — **JÁ EXECUTADO** no Supabase (2026-09-20, confirmado pelo usuário: `deletion_tombstones` existe com RLS habilitada, `admin_delete_user` e `dr_integrity_report` existem, e a primeira grava tombstone antes do delete). **Não pedir pra rodar de novo.**

- Tabela `deletion_tombstones` (ledger append-only, sem NENHUMA policy de UPDATE/DELETE pra ninguém logado — só SECURITY DEFINER escreve).
- `admin_delete_user` recriado (mesma assinatura/guardas) pra gravar nela antes do delete.
- `dr_integrity_report()`, função read-only admin-gated que fecha uma lacuna real confirmada pela auditoria — **não existia NENHUMA checagem de reconciliação Storage↔DB na direção "banco referencia arquivo que sumiu do bucket"**, só a oposta (`cleanup_orphan_media()`, que já existia). Rodar `select * from public.dr_integrity_report();` como parte de qualquer restore, e como checagem periódica de saúde.

## `docs/RUNBOOK.md` ganhou aviso
**NUNCA rodar `execute_cleanup_orphan_media()` logo depois de um restore parcial** (PITR do Postgres e Storage do Supabase não são garantidamente restaurados no mesmo instante — a janela pode fazer a limpeza apagar mídia de post que "ainda não existe" no banco recém-restaurado, mas vai voltar a existir assim que a reconciliação terminar).

## `.github/workflows/rollback.yml` tinha uma afirmação FALSA
No passo final ("deploy.yml vai rodar automaticamente") — `deploy.yml` é `workflow_dispatch`-only, quem redeploya a versão antiga é o Cloudflare Pages Git integration observando `main` direto. Corrigido a mensagem; travado por teste novo (`__tests__/dr/rollbackWorkflowSafety.test.ts`) pra não regredir.

## Mitigados com guarda de código (2ª rodada), hazard de fundo continua exigindo disciplina manual
- Replay ingênuo das 101 migrations em ordem de arquivo REGRIDE `get_feed_v2` e `is_portal_admin()` pra versões supersedidas — `__tests__/dr/migrationCanonicalOrder.test.ts` (novo) trava o conjunto EXATO de arquivos que redefinem essas duas funções e falha se um novo arquivo redefinir sem atualizar conscientemente `migrations/MIGRATIONS.md`; corrigir o hazard DE VERDADE (não só detectar regressão silenciosa) ainda exige ferramenta de migration real, fora de escopo.
- Nenhum dump lógico independente do banco existia — `scripts/dr/pg-logical-backup.sh` (novo) fecha isso: script MANUAL (nunca CI, de propósito), `pg_dump --schema-only` por padrão (dado real só com `--with-data` explícito), output `chmod 600`, checksum SHA-256, nunca ecoa a connection string, remove dump parcial se falhar. `__tests__/dr/backupScriptSafety.test.ts` (novo, 9 casos) valida essas propriedades e roda o script de verdade contra uma falha esperada.

## Achados confirmados, sem correção de código possível nesta sessão
- Supabase Storage **sem backup confirmável** (PITR cobre só o Postgres — Storage é MANUAL VERIFICATION, pode não ter proteção nenhuma).
- 2 buckets (`art-refs`, `style-refs`) existem só no dashboard, nunca em migration versionada.
- `audit_log` sem cópia fora do Postgres pra TODO tipo de evento (só exclusão de conta e bloqueio CSAM ganharam espelho externo nesta sessão — o resto do `audit_log` continua só no Postgres).
- `supabase_init.sql` desatualizado desde 2026-09-07 (achado já conhecido de auditoria anterior, não piorado nem corrigido aqui).
- Owner único (Jackson) pra GitHub/Cloudflare/Supabase/Codemagic/Google Play/Firebase — só Apple Developer tem segundo admin documentado (Beatris, já confirmado intencional). Ver [[Segurança - Identidade Externa e Contas Administrativas]] pra contexto completo.

## Confirmado seguro por desenho, sem ação necessária
- Mercado Pago é tratado como fonte de verdade a cada webhook (`GET /v1/payments/{id}`/`GET /preapproval/{id}` ao vivo), então um restore de banco reconcilia sozinho sem duplicar benefício — o único domínio do audit com reconciliação automática completa.
- `message_id UNIQUE` faz reenvio do WhatsApp/Meta ser idempotente pra mensagem em si.
- Push é `AFTER INSERT`-driven sem fila persistente, então não há replay fantasma num restore.
- `requirePro`/`gateAiUsage`/webhook do MP são fail-closed em produção (reconfirmado no código atual, não só por citação do CLAUDE.md).
- Nenhum secret real nem dump de produção commitado no histórico do git (varredura completa, incluindo `git log --all --diff-filter=A`) — trava nova, `__tests__/dr/noCommittedBackupArtifacts.test.ts`, pra isso continuar verdade.

## RISCO HIGH sem correção automática, exige checagem manual
Opt-out de WhatsApp (`opted_out_at`) pode reverter num restore — se o Meta/Dualhook reenviar ou o cliente escrever de novo depois do restore, o runner pode tratar como opt-in outra vez. **Nunca reabrir IA/follow-up automático logo após um restore sem checar manualmente quem pediu PARE no intervalo** (fora do nosso banco, nos logs do Dualhook).

## Dado sensível permanente no histórico do git
986 contatos reais (`migrations/2026-08-29-import-leads-planilha.sql`) seguem commitados permanentemente no histórico do git — não é achado novo de disponibilidade, mas relevante pra DR: qualquer estratégia de "clone do repo é backup" também propaga esse dado pra onde o repo for clonado. Não removido (reescrever histórico do git é decisão do usuário, fora do escopo desta sessão).

## RPO/RTO não definidos
NÃO estão definidos como decisão de negócio — a tabela de propostas em `docs/DR_AUDIT_2026-09-17.md §5` marca `BUSINESS DECISION REQUIRED`, não inventa meta.

Suíte completa (185 arquivos / 2307 testes, após a 2ª rodada), typecheck e `next build` verdes com as mudanças desta auditoria.

---
## Ver também
[[Segurança - Auditoria de Privacidade e LGPD]] · [[Moderação de Conteúdo (Gemini e CSAM)]] · [[Segurança - Identidade Externa e Contas Administrativas]] · [[Segurança - Logging, Observabilidade e Audit Trails]]

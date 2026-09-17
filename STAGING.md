# Staging / Preview Deploys

## ✅ RISCO DE SEGURANÇA CONHECIDO — VERIFICADO E FECHADO (2026-09-16)

A auditoria Cloudflare de 2026-09-13 (ver histórico abaixo) tinha levantado
como risco ALTO que as env vars de **Preview** pudessem ser as MESMAS de
produção — o que exporia `SUPABASE_SERVICE_ROLE_KEY`, chaves de IA/
pagamento/WhatsApp a qualquer build de Preview (disparado por push em
QUALQUER branch, sem precisar de PR aprovado).

**Checado ao vivo no painel em 2026-09-16** (sessão "Claude in Chrome",
`queroumacor@gmail.com`): Pages → `queroumacor-next` → Settings →
Environment variables → **Preview** tem hoje só **5 variáveis, todas
públicas** (`NEXT_PUBLIC_*` + `VAPID_SUBJECT`) — **nenhum secret de
produção configurado** (`SUPABASE_SERVICE_ROLE_KEY`, chaves de IA/MP/
WhatsApp/FCM ausentes). O risco descrito nesta seção **não reflete a
configuração real hoje** — ou o usuário já tinha corrigido isso no painel
antes desta auditoria, ou o texto anterior nunca bateu com o estado real.
De qualquer forma, o estado ATUAL é seguro: um build de Preview comprometido
não teria acesso a nenhum segredo de produção.

**O que ainda vale do risco original, sem mudança:** a URL de preview
(`<branch>.queroumacorapp.pages.dev`) continua sem autenticação adicional
— **Cloudflare Access não está configurado** (confirmado, zero aplicações)
— e `X-Robots-Tag: noindex` só impede indexação por buscador, não acesso
direto por quem tem/adivinha a URL. Isso é decisão em aberto do usuário
(ver `SECURITY_AUDIT_LOG.md`), não mais bloqueante de segredo de produção.

**Vale reconferir periodicamente** (não é uma garantia permanente): alguém
pode adicionar um secret de produção ao ambiente de Preview no futuro sem
perceber a implicação. Antes de configurar qualquer env var nova em
Preview, perguntar: "se um build malicioso rodar com isso, o que ele
consegue fazer?".

## Visão geral

Cloudflare Pages cria **automaticamente** um preview deploy pra cada commit
em qualquer branch que NÃO é `main`. Não precisa configurar nada — é o
comportamento default do Pages.

Cada push em `claude/<feature>`, `staging`, ou qualquer outra branch ganha:

- URL única do tipo `https://<commit-hash>.queroumacorapp.pages.dev`
- URL estável por branch: `https://<branch-name>.queroumacorapp.pages.dev`
  (slug derivado do nome — caracteres especiais viram `-`)
- Header `X-Robots-Tag: noindex` automático (Google não indexa)
- Banner amarelo "🧪 STAGING · <hostname>" no topo da tela
  (injetado em `index.html`, só aparece quando host ≠ `queroumacor.com.br`)

## Workflow recomendado

```
feature branch (claude/<x>)
  ↓ push
preview deploy automático em <branch>.queroumacorapp.pages.dev
  ↓ testa lá
merge na main
  ↓ deploy automático em queroumacor.com.br
```

**Regra de ouro:** abrir a URL de preview e validar a feature ANTES de
mergear pra `main`. Especialmente importante pra mudanças visuais e fluxos
críticos (signup, login, checkout, follow, post).

## Como achar a URL de preview

Três caminhos:

1. **Painel Cloudflare** → Pages → queroumacorapp → Deployments → procurar
   pelo commit/branch.

2. **GitHub** (se Pages estiver linkado): aparece como deployment status
   no PR / commit.

3. **Convenção direta**: substitua os caracteres não-alfanuméricos da
   branch por `-` e prefixe:
   ```
   branch: claude/loading-timeout-issue-5GLvI
   slug:   claude-loading-timeout-issue-5glvi
   url:    https://claude-loading-timeout-issue-5glvi.queroumacorapp.pages.dev
   ```
   (Cloudflare normaliza pra minúsculas.)

## Diferenças entre staging e produção

- **Mesmo banco** (Supabase é compartilhado). Cuidado com mutações em dados
  reais durante testes — use um usuário de teste se precisar criar/apagar
  coisas.
- **Env vars PRÓPRIAS de Preview, mais restritas que produção** — preview
  herda as variáveis "Preview" configuradas no painel do Cloudflare Pages,
  que hoje são só 5 públicas (`NEXT_PUBLIC_*` + `VAPID_SUBJECT`, checado
  ao vivo em 2026-09-16). **Não são as mesmas de produção**: nenhum secret
  (`SUPABASE_SERVICE_ROLE_KEY`, chaves de IA/pagamento/WhatsApp/FCM) está
  configurado em Preview. Na prática isso significa que rotas que dependem
  desses secrets (admin, IA, pagamento, WhatsApp) **não funcionam** em
  preview — é a troca aceita pra manter o ambiente de Preview seguro pra
  builds disparados por qualquer push, sem PR aprovado.
- **Sem cache do navegador** entre preview e prod (hostnames diferentes).

## Como saber que estou no staging

O banner amarelo no topo da tela mostra `🧪 STAGING · <hostname>`. Se ele
não aparece, você está em produção (`queroumacor.com.br`).

## Quando NÃO usar preview

- Hotfix urgente em produção bem isolado e seguro: pode mergear direto na
  `main`. Use bom senso.
- Mudanças que afetam DADOS (migrations, seeds): rodar primeiro em ambiente
  controlado, não confiar só no preview que compartilha banco.

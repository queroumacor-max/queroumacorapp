# Staging / Preview Deploys

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
- **Mesmas env vars** do Cloudflare Pages (OPENAI/GEMINI keys etc.) — preview
  herda as variáveis "Preview" configuradas no painel; se ainda não estiverem
  diferenciadas, vai usar as mesmas de produção.
- **Sem cache do navegador** entre preview e prod (hostnames diferentes).

## Como saber que estou no staging

O banner amarelo no topo da tela mostra `🧪 STAGING · <hostname>`. Se ele
não aparece, você está em produção (`queroumacor.com.br`).

## Quando NÃO usar preview

- Hotfix urgente em produção bem isolado e seguro: pode mergear direto na
  `main`. Use bom senso.
- Mudanças que afetam DADOS (migrations, seeds): rodar primeiro em ambiente
  controlado, não confiar só no preview que compartilha banco.

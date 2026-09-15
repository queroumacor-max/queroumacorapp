# Staging / Preview Deploys

## ⚠️ RISCO DE SEGURANÇA CONHECIDO (auditoria Cloudflare, 2026-09-13)

Este documento já avisava "Mesmas env vars ... se ainda não estiverem
diferenciadas, vai usar as mesmas de produção" — mas o que isso significa
na prática precisa ficar explícito: **qualquer push em QUALQUER branch
dispara um build automático do Cloudflare Pages** (é o comportamento
default do Git integration, independente do GitHub Actions), e esse build
roda `npm install && npm run build:cf` com as env vars de **Preview**
injetadas no ambiente do processo. Se essas vars ainda forem as mesmas de
produção, isso inclui `SUPABASE_SERVICE_ROLE_KEY` (ignora RLS),
`OPENAI_API_KEY`, `GEMINI_API_KEY`, `MP_ACCESS_TOKEN`,
`WHATSAPP_ACCESS_TOKEN`/`DUALHOOK_API_KEY`, `FCM_PRIVATE_KEY` etc.

**Isso é uma superfície real de exfiltração de segredos de produção via
supply-chain**: um `postinstall` malicioso em qualquer dependência (ou
código de build comprometido em qualquer branch, mesmo sem PR aprovado —
o build dispara SÓ com o push) roda com acesso de rede e a esses secrets
no ambiente. A URL de preview em si (`<branch>.queroumacorapp.pages.dev`)
também não tem NENHUMA autenticação adicional (Cloudflare Access não está
configurado) — `X-Robots-Tag: noindex` só impede indexação por buscador,
não impede acesso direto por quem tem/adivinha a URL.

**MANUAL ACTION REQUIRED** (Cloudflare Dashboard, fora do repo):
1. Verificar HOJE se as env vars de **Preview** em Pages → Settings →
   Environment variables são de fato as MESMAS de produção. Se forem,
   separar — idealmente um projeto Supabase de staging próprio, ou no
   mínimo remover `SUPABASE_SERVICE_ROLE_KEY` e as chaves de IA/pagamento/
   WhatsApp do ambiente de Preview (aceitando que rotas admin/IA não
   funcionem em preview).
2. Considerar Cloudflare Access (Zero Trust) na frente de `*.pages.dev`
   pra exigir login antes de qualquer preview responder.
3. Restringir quem tem permissão de push/criar branch no repositório,
   já que isso sozinho já dispara um build com os secrets configurados.

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

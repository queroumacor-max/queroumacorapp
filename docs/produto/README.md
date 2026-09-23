# Documentação de produto — QueroUmaCor

Documentos que descrevem **o que o produto é e como ele se organiza**. Os
outros documentos do repo (runbooks, auditorias, `CLAUDE.md`) descrevem
**como ele opera e o que já deu errado** — os dois conjuntos se completam.

| Documento | Pergunta que responde |
|---|---|
| [BRIEF.md](BRIEF.md) | Em uma página: o que é, pra quem, por quê |
| [PRD.md](PRD.md) | O que o produto faz, pra quem, e com quais regras de negócio |
| [TRD.md](TRD.md) | Como ele é construído: stack, arquitetura, requisitos técnicos |
| [APP_FLOW.md](APP_FLOW.md) | Quais telas existem e como a pessoa anda entre elas |
| [UI_UX.md](UI_UX.md) | Como ele parece e se comporta: tokens, componentes, padrões |
| [BACKEND_SCHEMA.md](BACKEND_SCHEMA.md) | Tabelas, RLS, funções, triggers, buckets, cron e rotas de API |
| [PLANO_DE_IMPLEMENTACAO.md](PLANO_DE_IMPLEMENTACAO.md) | O que está pronto, o que está em aberto e em que ordem atacar |

## Como manter

- **Escritos em 2026-09-23 a partir do código**, não de memória. Onde o
  código e um documento antigo divergirem, vale o código.
- **O esquema vivo está no banco, não no `supabase_init.sql`** (desatualizado
  desde 2026-09-07). O `BACKEND_SCHEMA.md` foi montado das migrations
  aplicadas em ordem; para recriar uma função, usar `pg_get_functiondef`.
- Mudou uma regra de negócio → atualizar o PRD. Criou tela → APP_FLOW.
  Criou tabela/RPC → BACKEND_SCHEMA. Fechou um item → PLANO.
- O `BACKLOG.md` da raiz está **desatualizado** (lista como pendentes itens já
  feitos: carrossel, web push, Image Resizing). O plano vigente é o
  [PLANO_DE_IMPLEMENTACAO.md](PLANO_DE_IMPLEMENTACAO.md).

# Estado do projeto / convenções (não perguntar de novo)

- O SQL de correção do cadastro ("Database error saving new user" — gatilho
  `handle_new_user` + colunas de `profiles`) **JÁ FOI EXECUTADO no Supabase**.
  Não perguntar de novo nem pedir para rodar.
- Regra de fluxo: após cada correção/melhoria concluída, fazer commit no
  branch de trabalho e **merge para `main`** automaticamente (deploy do
  Cloudflare Pages é automático a partir do `main`).
- Branch de trabalho atual: `claude/new-session-V0v78`.

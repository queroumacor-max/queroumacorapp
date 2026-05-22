# Estado do projeto / convenções (não perguntar de novo)

- O SQL de correção do cadastro ("Database error saving new user" — gatilho
  `handle_new_user` + colunas de `profiles`) **JÁ FOI EXECUTADO no Supabase**.
  Não perguntar de novo nem pedir para rodar.
- Regra de fluxo: após cada correção/melhoria concluída, fazer commit no
  branch de trabalho e **merge para `main`** automaticamente (deploy do
  Cloudflare Pages é automático a partir do `main`).
- Branch de trabalho atual: `claude/new-session-V0v78`.
- `OPENAI_API_KEY` **e** `GEMINI_API_KEY` **já estão configuradas no Cloudflare
  Pages**. Não perguntar de novo. (Usadas por `chat-ai.js` e
  `resolve-color.js`.)
- A coluna `products.image_url` (text) **já foi criada no Supabase**. Upload
  de foto de produto pelo portal já funciona. Não pedir para rodar o SQL.
- Cores de produto: o botão "Preencher cores (IA)" no portal grava
  `products.color_hex` (IA primeiro, dicionário como fallback). Rodar
  **uma vez**; depois manutenção é manual via seletor de cor. O botão só
  toca em produtos sem cor — seguro reapertar.
- **Regra de SQL:** sempre que criar ou alterar qualquer SQL/migration,
  **colar o conteúdo completo do SQL no chat, em texto** (bloco de código),
  para o usuário copiar e rodar no Supabase SQL Editor. Criar só o arquivo
  no repo não basta — o SQL tem que aparecer no chat. Claude não tem acesso
  ao banco para rodar.


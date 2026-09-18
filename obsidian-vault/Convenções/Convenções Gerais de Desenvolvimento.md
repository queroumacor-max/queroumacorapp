---
tags: [convenções, regras, processo]
---

# Convenções Gerais de Desenvolvimento (regras que se repetem em todo o projeto)

## Fluxo de trabalho
- Commit + **merge automático pra `main`** após cada correção/melhoria concluída (deploy Cloudflare é automático a partir da `main`).
- Toda migration nova: **colar o SQL completo no chat**, nunca só criar o arquivo — Claude não roda SQL no Supabase.
- Preview deploys (`<branch>.queroumacorapp.pages.dev`) pra testar features arriscadas antes do merge.

## Regras técnicas recorrentes (cada uma custou um incidente real)
1. **Env de runtime**: sempre `getRuntimeEnv()`, nunca `process.env` cru no edge. Nada que dependa de env roda no module-load.
2. **RLS de função em policy**: sempre `(select is_portal_admin())`, nunca solto — senão o Postgres chama por linha.
3. **Telefone de WhatsApp**: sempre `normalizeWhatsAppTarget`, nunca `normalizeBrPhone`.
4. **Dentro da casca mobile**: nunca `window.location.href` pra navegação — usar `router.push/replace` (SPA) ou `window.open` (externo).
5. **API nativa do edge/workerd**: método se chama NO OBJETO DONO (`ctx.waitUntil(...)`), nunca extraído pra variável solta.
6. **Mídia de arquivo escolhido pelo usuário**: nunca validar só por `file.type` — checar extensão e bytes (magic numbers) também. E só recusar com PROVA de que não é o tipo esperado.
7. **`update()` do Supabase sem `.select()`** não avisa quando não acha linha nenhuma — onde importa (identidade, dinheiro, permissão), pedir `.select()` e conferir a contagem.
8. **Schema real antes de escrever SQL**: a lista de colunas do código não é garantia da tabela real (já custou 2+ incidentes com `leads.city`, `quotes.post_id`).
9. **Conferência de constraint/pendência**: LISTAR do catálogo real (`pg_constraint`, query de conferência), nunca confiar em anotação escrita à mão ou perguntar só pelo nome já conhecido.
10. **Campo novo no body de rota admin** precisa entrar no TIPO do `body` no topo do arquivo — senão quebra o `next build` (não pega no `tsc --noEmit` isolado nem no vitest).
11. **`route.ts` do Next só aceita exports fechados** (sem helpers extras) — só aparece no `next build`.
12. **Hook com canal Realtime do Supabase**: nome de canal único por instância (`useId()`), senão dois consumidores colidem.
13. **Fuso horário**: tudo no QueroUmaCor é exibido em `America/Sao_Paulo`, independente do fuso do aparelho.
14. **Filho de coluna flex de altura fixa que pode crescer**: precisa de `overflow` + `minHeight:0`.
15. **`flex-1` em campo de texto**: precisa de `min-w-0`; vizinho fixo (botão/ícone) precisa de `shrink-0`.
16. **Salvar imagem gerada no cliente (mobile)**: sempre `shareOrDownloadImage`, nunca `<a download>` cru (não funciona na WebView).

## Regras de processo / memória do projeto
- **"Verificar que X está desligado" ≠ "ligar X"** — confirmar estado não é executar a ação.
- **Lista de pendências escrita à mão envelhece e ninguém revalida** — reconferir com query real antes de afirmar (e antes de pedir pra rodar de novo).
- **Relato no chat não é evidência**, nem vindo do usuário — mas quando o usuário CONFIRMA que algo está feito olhando o banco/painel real, ele ganha da anotação escrita (a anotação pode estar desatualizada, o usuário está vendo o estado atual).
- **Toda sessão que fizer auditoria de segurança registra no CLAUDE.md imediatamente**, não no fim, não numa sessão futura.
- **Painel de diagnóstico com lista de filtros escrita à mão é lista que mente** — derivar de um `Record` tipado que o compilador força a manter completo.

## WEBINTOAPP MORTO
Ver [[00 - Índice]] e [[Mobile - Build, Deploy e Push Nativo]] — não citar como referência nunca mais.

---
## Ver também
[[Incidentes Notáveis]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]]

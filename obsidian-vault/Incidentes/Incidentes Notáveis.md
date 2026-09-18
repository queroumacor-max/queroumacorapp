---
tags: [incidentes, bugs, produção, postmortem]
---

# Incidentes Notáveis (resolvidos)

Consolidado de incidentes de produção com causa raiz e lição — muitos já detalhados nas notas de domínio; aqui fica o resumo cronológico/temático pra busca rápida.

## Parsing de valores (`parseBRL`) multiplicava por 100
Apagava todo ponto como milhar antes de trocar vírgula: `"1500.50"` → 150050. Teclado Android oferece PONTO no campo de preço — era caminho comum, não canto. Atingia preço de arte, Financeiro, Agenda. **Regra: vírgula sempre decimal; ponto é decimal com 1-2 casas ou milhar com 3.**

## Busca aproximada decidindo destinatário de mensagem
`resolveCalicolorsUserId` usava `.ilike('name','%cali%').limit(1)` sem `order` — não-determinístico, podia mandar mensagem "da Loja" pra estranho. Corrigido pra igualdade exata.

## `catch {}` mudo escondendo bugs por meses
Upload de foto no cadastro falhava em silêncio (nem toast nem log) — foi o que escondeu o bug de MIME do Android por muito tempo. Perfil público engolia falha e renderizava vazio (pintor com 20 avaliações aparecia sem nenhuma). **Regra: fluxo que engole erro em catch precisa chamar `reportFailure`.**

## `eslint.ignoreDuringBuilds: true` escondendo ~17 avisos do deploy
Avisos nunca aparecem no CI — rodar `next lint` manualmente.

## Cache do portal / SRI
Mexer no `app.js` do portal sem refazer o hash SRI do `index.html` → navegador recusa em silêncio, "Carregando..." eterno pra sempre. Regra registrada em [[Portal - Pessoas, Produtos e Ferramentas]].

## Contador de seguidores em dobro (Wave 54)
Dois triggers de contador vivos em `follows` simultaneamente. **Lição: wave nova de trigger precisa varrer duplicatas por FUNÇÃO, não só pelo próprio nome do trigger.**

## `File` comparado por `toEqual` em teste — falso verde
`File` não tem propriedade própria enumerável — dois arquivos diferentes passam como iguais em `toEqual`. **Regra: comparar `File` por IDENTIDADE (`toBe`), nunca `toEqual`.**

## Teste "skipped" contando como verde
Vitest reporta arquivo com erro de parse como "skipped", não "failed" — contagem de `Tests passed` sobe normalmente enquanto `Test Files` teria a pista. **Regra: conferir a linha `Test Files`, não só `Tests`.**

## Fuso horário — "hoje" saía do aparelho, não de Brasília
`getTimezoneOffset()` não é coberto pelo patch de `toLocaleString`. Deslocava "hoje" na agenda pra quem estava em fuso diferente do Brasil. Helpers `ymdBrt()`/`ymdDeCampos()` corrigem sem depender do patch.

## Página 500 do Next tem DOIS caminhos internos
`pages/500.tsx` cobre só erro ESTÁTICO; erro em runtime cai em `pages/_error.tsx`. E nenhum dos dois cobre erro de App Router abaixo do render (esse caso é do Service Worker interceptando RSC — ver [[Mobile - Bugs de WebView e Picker]]).

## `waitUntil` chamado solto → 500 síncrono no webhook do WhatsApp
Ver [[WhatsApp - Canais e Envio (Evolution, Cloud API, Dualhook)]].

---
## Ver também
[[Convenções Gerais de Desenvolvimento]] · [[Mobile - Bugs de WebView e Picker]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]

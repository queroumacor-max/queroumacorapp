---
tags: [mobile, webview, bugs, service-worker, picker, câmera]
---

# Mobile — Bugs de WebView, Service Worker, Picker e Câmera

## "500 | Server Error" ao apagar/acender a tela — causa fechada
Renderizador da WebView é morto pelo Android e re-navega ao voltar; sem SW no comando, um soluço de rede vira 500 cru. **Causa real provada (2026-09-01)**: o SW estava SIM no comando (`/diag` confirmou), mas o 500 vinha do fetch do **payload RSC**, não de navegação de documento — o SW devolvia esse 500 cru pro router, que pinta a PRÓPRIA tela de erro do Next (não passa por `error.tsx`/`pages/500`, porque não é render nem navegação de documento). **Fix (sw.js v6)**: 5xx de RSC recebe o mesmo tratamento de rede morta (503 sem corpo → router faz hard-nav → vira navegação de documento → cai na tela "Reconectando..." com auto-retry).
**Lição de método**: duas tentativas anteriores (`pages/500.tsx`, `pages/_error.tsx`) foram escritas sem evidência e não resolveram — o que fechou o caso foi procurar a string no output publicado e pedir 1 dado real do aparelho (`/diag`).

## Cache envenenado (sw.js)
`sw.js` gravava resposta de NAVEGAÇÃO sem olhar status — 500 passageiro virava conteúdo permanente. Fix: `isCacheable()` só aceita 200; `matchUsable()` nunca devolve erro guardado; página "Sem conexão" gerada na hora como último recurso, com retry.

## Foto do seletor vem sem MIME type
"Files Chooser" do wrapper devolve `type` vazio/`application/octet-stream`. **Regra: nunca validar mídia só por `file.type`** — `lib/utils/mediaType.ts` decide em 3 degraus: tipo declarado → extensão → bytes (magic numbers). **Regra mais importante: recusar só com PROVA** (`provadoNaoImagem` — "não provei que é imagem" ≠ "provei que não é").

## App morre no meio da escolha de foto (picker restart)
Seletor de fotos é outra activity pesada; Android mata o processo do app atrás; volta pra URL inicial, perde o `ValueCallback`. Correção do lado web (raiz é do wrapper): marca em `localStorage` antes de abrir o seletor, `PickerRecovery` leva de volta pra rota da marca; janela de 5min; só arma no Android.

## Microfone negado com permissão ativa
`BridgeWebChromeClient` do Capacitor pede `MODIFY_AUDIO_SETTINGS` **e** `RECORD_AUDIO` juntas (AND sobre o resultado) — faltando a primeira no Manifest, a WebView recusa sem diálogo. **Regra: permissão que a WebView usa vem em PAR.**

## Pull-to-refresh nativo recarregando a tela inteira
`SwipeRefreshLayout` arma reload quando `canChildScrollUp()` é false — app é shell 100dvh, documento sempre em scrollY 0. Defesa em 3 camadas: pin do scroll antes da hidratação, hook de re-pin, guarda de dreno em touchmove.

## Cadastro conta nova: "e-mail não confirmado" mentiroso
`getSession()` devolve usuário GUARDADO no localStorage, não o do servidor. Snapshot só atualiza no refresh do token (1h), que quase nunca acontece em WebView. Fix: quando a cópia local diz não-confirmado, chama `getUser()` (servidor) com timeout.

## Apple rejeitou build (2.1 App Completeness) — tela "Sem conexão" no login social
Mecanismo lido no fonte do Capacitor: navegação de TOPO pra host fora de `allowNavigation` é cancelada e cai na `errorPath` (nosso `offline.html`), com internet perfeita. **Regra: dentro da casca, `window.location.href = <url externa>` é PROIBIDO** — usar `window.open(url,'_blank')` (`abrirLinkExterno`). Depois descoberto: sair da conta caía no MESMO buraco — qualquer navegação de DOCUMENTO que falhe pinta a `errorPath`. **Regra com teste**: tela não escreve em `window.location`, usa `router.push/replace`.

## AAB "não abre a galeria"
WebView do wrapper só abre galeria se implementar `onShowFileChooser` — sem isso, toque não faz nada, sem erro. Correção do lado app: `GaleriaBloqueadaSheet` com saída por câmera (`getUserMedia`) ou abrir no navegador (`intent:` URL).

---
## Ver também
[[Mobile - Build, Deploy e Push Nativo]] · [[Incidentes Notáveis]] · [[Auth - OAuth, Cadastro e RLS de Sessão]]

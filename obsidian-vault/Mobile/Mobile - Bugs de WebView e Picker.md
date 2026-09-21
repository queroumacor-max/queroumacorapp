---
tags: [mobile, webview, bugs, service-worker, picker, câmera]
---

# Mobile — Bugs de WebView, Service Worker, Picker e Câmera

## "500 | Server Error" ao apagar/acender a tela — série de investigações (2026-09-01)
Relato: app aberto, apaga a tela do celular, acende — vem 500, e **fica assim até reiniciar o app**. **Mecanismo**: com a tela apagada o Android mata o processo do RENDERIZADOR da WebView (não o app); ao voltar, a WebView recria o renderizador e RE-NAVEGA pra URL atual. Se essa navegação pega um soluço do edge, vem 500 — e a página interna do Next não tinha UMA LINHA de JS nosso (nem SW, nem boundary, nem retry): uma lápide. Por isso só saía reiniciando: nada mais navegava.

**1ª tentativa: `pages/500.tsx`.** Página que se recupera sozinha (retry 2,5s + n·1,5s, teto 6 em 2min, reload no evento `online`), retry INLINE via `<script>` (não `useEffect`: se a pessoa vê essa tela, o servidor acabou de falhar — apostar que os chunks vão baixar e hidratar é apostar no que está quebrado).
**Por que `pages/`**: `error.tsx`/`global-error.tsx` só pegam erro de RENDER do React. Falha ABAIXO disso (carga de módulo, roteamento, soluço da function) nunca chega neles — `pages/500` é o único ponto de override no App Router.
**Pegadinha: criar `pages/` MUDA A TIPAGEM GLOBAL.** `useSearchParams()` passa a ser anulável e o build quebra em quem não trata (era `LoginForm.tsx`). **`npx tsc --noEmit` NÃO PEGA isso** — só `next build`, que usa os tipos gerados em `.next/types`. **REGRA: rodar `next build` de verdade antes de publicar mudança estrutural.**

**Causa raiz provável, corrigida junto**: `lib/api/env-check.ts` lia `process.env` DIRETO e era chamado no MODULE-LOAD de `security.ts` — as duas coisas que este projeto proíbe. No edge os secrets não estão em `process.env`, e `process.env[k]` com `k` variável nem é substituído no build (só a forma literal). A lista podia sair TODA "ausente" e o throw derrubar a CARGA DO MÓDULO com as envs perfeitamente configuradas — o que o Next devolve como 500 puro. Agora lê por `getRuntimeEnv` e não roda mais no boot; o fail-closed que importa (CRIT-5) já é por request em `requirePro`/`gateAiUsage`.
Continuava sem prova de qual dos dois disparou — faltava saber se o SW controla a página na WebView (`/diag` já responde isso).

### 500 CRU no app instalado — o SW NÃO estava no comando (em aberto na época)
O `sw.js` v5 prova por construção que 5xx nunca vai cru pra tela em navegação de documento (troca pela página "Reconectando…" com auto-retry). A tela crua apareceu mesmo assim → o service worker não controlava aquela navegação no app empacotado. Os boundaries do React também não renderizaram — logo a falha é da própria function do edge, ABAIXO do render do Next. Telemetria `sw-nav-5xx` só dispara com o SW no comando (justamente o que faltava) — cegueira reconhecida, sem palpite especulativo escrito antes de ter o dado.

### Causa fechada: era o payload RSC, não a navegação (2026-09-01)
O `/diag` do usuário no app instalado entregou o dado que faltava: **"Service Worker controlando a página: sim"**. Com o SW no comando, o `sw.js` v5 tornava impossível um 5xx cru chegar na tela em navegação de DOCUMENTO — logo, não era navegação de documento.
**O que era:** o 5xx vinha no fetch do **payload RSC**. O SW devolvia esse 500 CRU pro router, apostando que "o router trata" fazendo hard-nav. Não trata: o runtime do Next pinta a PRÓPRIA tela de erro (a marcação `next-error-h1` está no bundle do cliente, `main-*.js`). Como não houve navegação de documento, nenhuma defesa do SW rodou; e como não é erro de render, `error.tsx`/`global-error.tsx` também não pegaram. Uma lápide que só saía reiniciando o app.
**Correção (sw.js v6)**: 5xx de RSC recebe o MESMO tratamento da rede morta — 503 sem corpo, que é o caminho comprovado: o router descarta, faz hard-nav, a navegação volta como documento e ganha a página "Reconectando…" com auto-retry. Incidente logado como `sw-nav-5xx` com sufixo `(rsc)`.
**O teste TROCOU DE LADO** — antes exigia o 5xx cru "porque o router trata". Teste que codifica uma suposição errada protege o bug.
**Lição de método**: `pages/500.tsx` e `pages/_error.tsx` foram DUAS tentativas erradas seguidas, ambas escritas antes de haver evidência. O que fechou o caso foi procurar a string no output publicado (`.vercel/output/static`) e pedir UM dado do aparelho. As duas páginas ficam — cobrem o erro de servidor de verdade —, mas não eram isto.

### O 500 do App Router NÃO passa por `pages/500` nem `pages/_error` (PROVADO)
No output publicado (`.vercel/output/static`): o `500.html` é a minha tela ("Reconectando…", sem `next-error-h1`), mas a marcação da tela padrão do Next (`next-error-h1`) vive dentro do **worker** (`_worker.js/__next-on-pages-dist__/webpack/*.js`) — ou seja, quem responde é o runtime do Next DENTRO do worker, em rota de App Router, e ali os arquivos do Pages Router não são consultados. `error.tsx`/`global-error.tsx` também não pegam, porque a falha não é de render. Restavam dois caminhos, e a escolha dependia de UM dado: o service worker controla a página no app? Se controla, o `sw.js` v5 já resolve (é o caso acima); se não controla, a única interceptação possível seria embrulhar o `_worker.js` gerado num passo pós-build — decisão maior, que amarraria o deploy a um script próprio.

## Cache envenenado do Service Worker (2026-08-22)
`sw.js` gravava a resposta de NAVEGAÇÃO sem olhar o status: um 500 passageiro do Cloudflare virava conteúdo permanente do cache e voltava a cada falha de rede — e o WebView do Android SEMPRE falha por um instante ao voltar do background (rádio ainda subindo). Internet boa, erro vindo do disco. Fix: `isCacheable()` (só 200, não-redirecionado, não-opaco) barra a escrita, `matchUsable()` nunca devolve resposta de erro guardada, e o último recurso é uma página "Sem conexão" gerada na hora com botão de recarregar. `CACHE_VERSION` foi pra `quc-v3` — é o bump que limpa os caches já envenenados de quem está preso hoje (o `activate` apaga toda chave fora da versão). **Bumpar de novo em qualquer mudança de estratégia do SW.**

**4 causas corrigidas na mesma leva (2026-08-22)** — sintomas: no Android, sair e voltar (ou no meio do uso) dava 500 e o app não abria mais; no iOS, "não tem internet" ao tentar conectar:
1. Cache envenenado (acima).
2. **Sem retentativa.** Navegação agora repete UMA vez (600ms) em falha de rede e em 5xx. Cobre a retomada do WebView e cold start ruim do edge. `install` também deixou de ser all-or-nothing (`addAll` → puts tolerantes): um asset 404 abortava o install inteiro e o SW nunca ativava.
3. **`getSession()` sem teto = "Carregando…" eterno.** Não é só leitura de localStorage — com token vencido ele faz refresh pela rede, e no WebView esse fetch fica pendurado pra sempre quando o sistema congela a tela. Como `loading` só virava false no `.then`, o `AppShell` ficava travado. Agora corre contra `SESSION_TIMEOUT_MS` (8s), refaz a leitura em `visibilitychange`/`online`/`pageshow`, e o `/login` redireciona sozinho se a sessão chegar depois. **Qualquer await de rede no caminho de boot precisa de timeout — no WebView promessa pendurada não rejeita.**
4. **iOS: App-Bound Domains sem o Supabase.** `WKAppBoundDomains` + `limitsNavigationsToAppBoundDomains: true` fazem a WKWebView SÓ enxergar os domínios da lista, que tinha só `queroumacor.com.br`. Requisição bloqueada chega no JS como falha de rede genérica → `errors-friendly.ts` traduz pra "Sem conexão. Verifique sua internet". Supabase adicionado ao plist e ao `allowNavigation`. Limite da Apple: 10 domínios.

**Pendências conhecidas na época (não corrigidas ali)**: (1) `webDir` apontava pra `next-app/.next/static`, que NÃO é web build (sem `index.html`) — sem bundle local de fallback, sem rede na abertura o app não tinha uma tela sequer pra mostrar; (2) login Google/Apple navegava a própria WebView pro provedor — Google recusa OAuth em WebView embarcada (`disallowed_useragent`) e o App-Bound Domains do iOS bloqueava a navegação — resolvido depois pelo Fluxo A de OAuth (`@capacitor/browser` + deep link, ver [[Mobile - Build, Deploy e Push Nativo]]).
Testes em `next-app/__tests__/sw.test.ts` (11): carregam o `sw.js` num escopo falso e travam a regra "erro nunca entra nem sai do cache".

## Foto do seletor do wrapper vem SEM MIME TYPE (2026-09-01)
"Trocar foto" morria com "Selecione um arquivo de imagem" — na cara de quem tinha selecionado exatamente isso. O seletor do WebIntoApp **não é a galeria do sistema**: é um diálogo próprio, **"Files Chooser" (Camera × Files)**, e pelo ramo Files o `File` volta com `type` VAZIO ou `application/octet-stream` (o content:// provider não declarou o tipo). Pelo Chrome o mesmo arquivo vem `image/jpeg` — daí o clássico "no navegador funciona".

**REGRA MAIS IMPORTANTE: recusar só com PROVA.** "Não provei que é imagem" ≠ "provei que NÃO é". A 1ª regra punia a pessoa pela omissão do Android e foi o que travou a troca de foto. Use `provadoNaoImagem` (false quando ninguém identificou → passa; o Storage dá a palavra final). Extensões de não-mídia (.pdf/.csv/…) estão no mapa DE PROPÓSITO: servem pra recusar com prova e pro certificado em PDF subir certo.

**Mensagem de erro tem que carregar a EVIDÊNCIA** (`descreverArquivo`). Em 01/09 a mensagem antiga e a nova eram a mesma frase e não deu pra saber qual código rodava no aparelho — um dia perdido em adivinhação.

**REGRA: nunca validar mídia por `file.type` sozinho.** `lib/utils/mediaType.ts` decide em TRÊS degraus, nesta ordem: tipo declarado → **extensão** do nome → **bytes** do arquivo (magic numbers). O 3º degrau existe porque alguns content providers do Android devolvem nome SEM extensão (um id puro) — aí só o conteúdo responde; `ftyp` precisa da MARCA no offset 8 pra separar HEIC de MP4. Caminho novo que aceita arquivo escolhido pela pessoa = `await normalizarArquivo(file)` ANTES de `ehImagem`/`ehVideo`, nunca `startsWith('image/')`.

**A varredura de 01/09 achou 6 caminhos além do avatar** — todos derivavam `contentType` de `file.type` vazio, e dois RECUSAVAM o arquivo: `chat-attachments` ("Tipo de arquivo não permitido" ao mandar foto no chat) e `artReferences` ("Formato não suportado", + extensão sempre .jpg). Também `stories`, `aiLogo`, `QualsSection` (PDF virava image/jpeg) e `posts.uploadMedia`, que chutava `image/jpeg` pra toda imagem sem tipo — acertava .jpg por sorte e etiquetava png/webp/heic errado. **Em `uploadMedia` o fallback `image/jpeg` FICA de propósito** pro caso sem nenhuma das três pistas: recusar quebraria justamente o fluxo que isso conserta.

**Corrigir o `type` não é cosmético:** os buckets têm `allowed_mime_types`, então subir como octet-stream seria recusado pelo **Storage** mesmo depois de passar pela validação da tela. Por isso o helper devolve o File com o tipo certo, e os 8 pontos de entrada (avatar, logo, publicar, cadastro passo 2, arte-ig, aiLogo, aiArt, dimensões) passam por ele.

**O aviso "A galeria não abriu" era FALSO POSITIVO** nesse wrapper: o "Files Chooser" é um DIÁLOGO do próprio app, e diálogo **não tira o foco da página** — o relógio de 1,8s do `filePickerWatch` estourava enquanto a pessoa ainda lia Camera × Files. Agora a espera padrão é **8s** (`PADRAO_ESPERA_MS`) e, se o app sair DEPOIS do aviso, ele é **retirado da tela** (`onAbriuAtrasado`) e a marca de recuperação volta a valer. **Aviso errado ensina a ignorar o aviso certo.**

## A galeria ABRE, mas o app MORRE no meio da escolha (2026-09-01)
O AAB de 31/08 resolveu o `onShowFileChooser` — o seletor aparece (confirmado no aparelho do Bruno). Só que apareceu o problema seguinte: ele toca na foto e **o app volta pra tela inicial**, sem foto e sem legenda. Não é permissão: o seletor de fotos é OUTRA activity, pesada de memória; o Android encerra o processo do app que ficou atrás; na volta o wrapper recria tudo e carrega a **URL inicial**, e o `ValueCallback` que receberia o arquivo morreu junto.

**Nenhum código web impede isso** — a correção de raiz é do WebIntoApp (`ValueCallback` + `WebView.saveState()/restoreState()` na recriação da activity; `docs/AAB_PROXIMA_VERSAO.md` §1.1b). O que o app faz é não deixar a pessoa no escuro: `lib/utils/pickerRecovery.ts` grava uma marca em **localStorage** (sobrevive à morte do processo; `sessionStorage` NÃO — WebView nova nasce com ele vazio) antes de abrir o seletor e a apaga em TODO final normal (arquivo chegou / cancelou / nem abriu). Marca sobrevivendo num documento recém-carregado = aquele documento morreu com a escolha pendente.

`components/PickerRecovery.tsx` (montado no `AppShell`) leva de volta pra rota da marca; quem **consome** a marca é a tela dona dela (filtro por `ctx`), porque só ela sabe o que fazer com a foto. Se o boot consumisse, o app navegaria em silêncio e ninguém entenderia nada.

Janela de 5min: escolher foto leva segundos. Fora dela é sessão nova, e avisar seria mentira. **Só arma no Android** (mesmo gate `ehAndroid` do `filePickerWatch`, agora exportado — se os dois divergirem, uma tela marca e a outra não limpa).

A **câmera é imune** (`getUserMedia` roda na própria página, não sai pra outra activity) — por isso o `GaleriaBloqueadaSheet` segue sendo a saída, agora com título/texto por prop: dizer "a galeria não abriu" aqui seria mentira, ela abriu.

`Composer` grava o rascunho NO GESTO que abre o seletor (`onAntesDeAbrir` → `writeDraft`): o autosave é throttled em 5s e quem digita e toca em seguida perderia o texto junto com a foto.

Telemetria nova: `picker-restart` no `/admin/errors`.

**Permissões (conferido em 01/09):** Câmera concedida e com uso real registrado → o wrapper implementa `onPermissionRequest`. Fotos/mídia **não aparece** na lista → o toggle de storage provavelmente gerou a antiga `READ_EXTERNAL_STORAGE`, ignorada no Android 13+. Não bloqueia o seletor (ele entrega o arquivo por Intent).

## App instalado NÃO ABRE A GALERIA — a saída pela CÂMERA (2026-08-30)
Voltou em 30/08 com DOIS pintores (Bruno Valentim e Leo): não trocam a foto de perfil nem publicam portfólio. Causa é a mesma de 29/08 e não é código nosso: as duas telas usam o mesmo `<input type="file">` e a WebView do WebIntoApp só abre a galeria se o wrapper implementar `onShowFileChooser` + permissões de mídia. Sem isso o toque **não faz nada** — sem erro, sem log. **Correção de raiz continua no painel do WebIntoApp** (`docs/AAB_PROXIMA_VERSAO.md` §1.1).

**O que mudou: o beco virou saída.** `filePickerWatch` (relógio de 1,8s; se a página não perdeu o foco, o seletor não abriu) deixou de mostrar um toast vermelho — o toast some em 3s, manda DIGITAR "queroumacor.com.br" e não resolve nada. No lugar entra o `components/GaleriaBloqueadaSheet` com duas saídas: **📷 tirar foto agora** (`components/CameraCapture.tsx` — `getUserMedia` + canvas geram o File na mão, sem passar pelo seletor) e **🌐 abrir no navegador** (`lib/utils/openInBrowser.ts`: URL `intent:` com `action=VIEW`, que é o que a WebView entende como "sair pro Chrome"; `window.open` dentro dela abre outra tela do próprio app). Se nem o intent abrir, copia o link.

O botão de câmera também aparece **sem precisar falhar antes** (ao lado de "Trocar foto" em `/perfil/editar`, embaixo do dropzone de `/publicar` e no passo 2 do cadastro), só em tela de toque com câmera (`ofereceCamera`).

**A câmera na WebView é a MESMA classe de dependência** (o wrapper precisa responder `onPermissionRequest` + `android.permission.CAMERA`): pode falhar também. A diferença é que ela falha **visível** — a promessa rejeita, a tela diz o que fazer e o `/admin/errors` recebe `camera-fail`. Também tem TETO DE TEMPO de 12s no `getUserMedia` (promessa pendurada não rejeita em WebView).

**Bug real achado junto — o aviso DUPLICADO da foto do pintor.** O `inputRef.click()` do `MediaUploader` sobe (bubbling) até a div do dropzone, que tem `onClick={handleSelect}`: um toque armava DOIS relógios e mostrava a mensagem duas vezes (a segunda chamada de `click()` é barrada pelo próprio browser, então parava em 2). Corrigido com `stopPropagation` no input + cancelar o relógio anterior antes de armar outro. Teste de regressão em `__tests__/components/MediaUploaderPicker.test.tsx` (falha sem o fix).

Foto tirada aqui sai no máximo com 1600px no lado maior e JPEG 0.9 — foto crua de celular passa dos 5MB do avatar.

## "Failed to fetch" AO PUBLICAR — a foto subia CRUA (2026-09-04, PR #204)
Gerar a legenda com IA funcionava e o "Postar" logo depois morria, na MESMA foto. A assimetria era a pista: o "Gerar legenda" do Composer comprime acima de `COMPRESS_THRESHOLD` (2 MB) antes de subir; o publicar mandava o arquivo ORIGINAL. Desde a **Onda B** a câmera NATIVA (quality 90, resolução cheia) é o caminho principal, então "cru" passou a significar 5-12 MB — e o upload grande morre na rede móvel dentro da WebView, com o supabase-js devolvendo o TypeError cru do fetch como mensagem final. Confirmado em produção.

**REGRA: caminho novo que sobe mídia escolhida pela pessoa comprime acima de `COMPRESS_THRESHOLD`** — e as dimensões (Wave 17) se leem do arquivo QUE SUBIU (comprimir muda W/H; gravar as do original reserva o espaço errado no feed). Vídeo não passa pelo compressor de imagem; falha ao comprimir cai no original (HEIC que a WebView não decodifica rejeita ali, e sobe cru sem problema — comprimir é otimização, não porta).

`uploadMedia` não repassa mais "Failed to fetch": vira "Falha de rede ao enviar a mídia (X MB)". O número separa conexão ruim de arquivo grande.

**ARMADILHA DE TESTE (custou um falso verde):** `toEqual` em `File` compara ESTRUTURA, e `File` não tem propriedade própria enumerável (`name`/`size`/`type` moram no protótipo) — dois arquivos DIFERENTES passam como iguais. O 1º teste passou com a correção revertida. **Comparar File por IDENTIDADE (`toBe`), nunca `toEqual`/`toHaveBeenCalledWith`.**

## Upload de mídia sem segunda chance (2026-09-06)
Um pintor levou "Falha de rede ao enviar a mídia (1,3 MB)" publicando um story com foto ABAIXO do `COMPRESS_THRESHOLD` (não passa pelo compressor): a foto era pequena e o upload morreu assim mesmo. O caminho de publicar NÃO tinha **retentativa**: um soluço do rádio na WebView (o mesmo que fez o service worker ganhar retry em 22/08) custava a publicação inteira. `uploadMedia` agora repete UMA vez após `UPLOAD_RETRY_MS`, e **num caminho NOVO** — com `upsert:false`, repetir o mesmo path depois de uma tentativa que chegou no servidor e só perdeu a resposta devolveria `Duplicate` (409), um erro inventado por nós no lugar do de verdade. O órfão da tentativa perdida cai no `cleanup_orphan_media()`.

**"Falha de rede" era um balde grande demais.** Quando o blob perde o lastro (o app reiniciou depois que a pessoa escolheu a foto — o acidente que o `pickerRecovery` cobre), o `fetch` também estoura o TypeError cru, e a frase "verifique a conexão" faz a pessoa tentar pra sempre com uma foto morta. O sinal que faltava já existia e era jogado fora: o `sha256Hex` lia o arquivo inteiro e **engolia a falha de leitura** num `catch` mudo. Virou `lerEHashear`, que devolve `ilegivel` — e a mensagem passa a ser "selecione ela de novo". **Só concluímos "arquivo morto" quando leitura E upload falham:** ler 50 MB de vídeo pode estourar memória num aparelho fraco enquanto o upload segue bem, e barrar aí quebraria quem estava conseguindo publicar.

**REGRA: a mensagem amigável não pode ser a única que sobra.** O `reportFailure` gravava só a frase traduzida, então o `/admin/errors` mostrava "Falha de rede ao enviar a mídia" e nada do que o servidor disse — RLS, mime recusado, quota e queda de rede chegavam idênticos. Agora ele anexa `| causa: <mensagem crua>` quando o erro tem `cause`.

Arquivo de zero byte é recusado antes do upload: subir isso grava post com mídia quebrada, que ninguém conserta depois.

**A investigação esbarrou numa ferramenta cega — e essa é a lição maior.** Mandei "abra o /admin/errors, filtre `publish-fail` e procure o `user_id` do fabio". **Nenhuma das três coisas existia.** O `reportFailure` grava 12 tipos e a tela tinha 5 chips escritos à mão; a linha NUNCA mostrava o `user_id`, embora o campo viesse do servidor; e a busca filtra `msg ilike`, onde o id de usuário não aparece nunca. Corrigido: os chips saem do `FAILURE_TYPE_LABELS` (um `Record<FailureType,string>` — **tipo novo sem rótulo não compila**), a linha mostra o dono e clicar nele filtra, e `user_id` virou filtro de verdade na rota (só UUID). **REGRA: painel de diagnóstico com lista escrita à mão é lista que mente.**

## Corte de tela no iPhone — 4 causas corrigidas (2026-08-21)
1. **Zoom automático do iOS**: campo com `font-size < 16px` faz o Safari ampliar ao focar; o viewport de layout fica maior que a tela e o conteúdo "corta" (bolha de chat sumindo pela direita, campo de digitar fora de vista). Regra no fim do `globals.css`, escopada em `@media (pointer: coarse)`, força 16px em input/textarea/select (checkbox/radio/range de fora). Desktop mantém `text-sm`. **Não usar `maximum-scale=1` no meta viewport** — iOS moderno ignora e mataria o pinch-zoom de acessibilidade.
2. **`100vh` no `AppShell`**: no Safari do iPhone o `vh` conta a área atrás das barras do navegador, então BottomNav/composer nasciam abaixo da dobra. Virou `height: 100dvh` inline (classe `h-screen` fica de fallback). **Preferir `dvh` em qualquer altura de tela cheia daqui pra frente.**
3. **Personas de IA** (Alice/Seu Zé/Fê/Senna): `height: min(70vh, 600px)` virou `min(70dvh, 600px)` + `maxHeight: 100%` — sem o teto, o painel estourava o espaço do bottom-sheet e empurrava o campo de digitar pra fora. Modal de histórico: `calc(100vh - 80px)` → `100dvh`.
4. **`min-h-screen` dentro do AppShell** (19 pages): forçava 100vh de altura dentro de um `<main>` que já é menor que isso (TopNav + BottomNav), criando scroll fantasma e jogando o fim do conteúdo sob a barra. Virou `min-h-full`. Páginas `/admin/*` (fora do AppShell) seguem com `min-h-screen`, corretamente.

## Pull-to-refresh nativo do AAB (WebIntoApp) — neutralizado pelo lado web (2026-08-28)
O AAB da Play Store envolve a WebView num `SwipeRefreshLayout`; ele arma o reload quando `canChildScrollUp()` é false, e como o app é shell 100dvh + overflow hidden (só o `<main>` rola), o documento vivia em scrollY 0 → reload armado na tela INTEIRA (arrasto rápido pra baixo = círculo de recarregar, em qualquer posição). CSS/JS não alcançam o toque nativo, mas o ESTADO consultado sim. Defesa em 3 camadas, em QUALQUER Android (gate largado em 2026-08-28 de "UA com token wv" pra "/Android/i" — o wrapper pode customizar o UA e o pin ficava mudo; no Chrome/PWA o pin é inofensivo e ainda mata o pull-to-refresh do próprio Chrome; iOS/desktop são no-op):
1. Script inline no `<head>` do layout.tsx pina ANTES da hidratação (senão o boot ficava desprotegido).
2. Hook `useAndroidWebViewScrollPin` (montado no RootLayout via `<AndroidWebViewScrollPin>`) estica o body em 4px — em `dvh` com fallback `vh`, senão a barra de URL do Chrome ganharia ~60px de scroll real — e PINA o documento em `scrollY = 2`, com re-pin em scroll/resize/pageshow/visibilitychange (retomada do WebView).
3. Guarda de dreno: touchmove no document cancela arrasto descendente que nasce fora de qualquer scroller (TopNav, /login) — sem ela o gesto drenava o pin 2→0 e re-armava o reload no meio do movimento.

**Constantes espelhadas** entre o hook e o script inline do layout — mudou um, mudar o outro. **Diagnóstico `scrollpin-diag` REMOVIDO em 2026-08-30** — cumpriu a missão: os pings de produção provaram que o UA do wrapper é `Dalvik/2.1.0 (Linux; U; Android 16; SM-...)` (sem token `wv`, sem "Chrome") → o gate `/Android/i` pega o app instalado; qualquer gate estrito de WebView ficaria mudo nele. O filtro segue no `/admin/errors` pras linhas históricas. AAB novo com "Pull to Refresh" desmarcado no painel foi publicado em 2026-08-30. Testes em `__tests__/hooks/useAndroidWebViewScrollPin.test.tsx`.

## Apple rejeitou build / Microfone negado com permissão ativa
Mecanismo exato (`WebViewDelegationHandler.swift`, `abrirLinkExterno`, `MODIFY_AUDIO_SETTINGS`+`RECORD_AUDIO`) documentado com detalhe completo em [[Mobile - Build, Deploy e Push Nativo]].

## Edge do Cloudflare: secret não chega em `process.env`
Detalhe completo (regra `getRuntimeEnv()`, corolário "nada que dependa de env roda no module-load", os 6 resolvedores divergentes do Supabase) em [[Infraestrutura - Cloudflare, Env Vars e Deploy]] e [[Auth - OAuth, Cadastro e RLS de Sessão]] — descoberto originalmente depurando o portal admin, mas explica também vários bugs de WebView que pareciam de rede e eram de env resolvida errado no boot.

---
## Ver também
[[Mobile - Build, Deploy e Push Nativo]] · [[Incidentes Notáveis]] · [[Auth - OAuth, Cadastro e RLS de Sessão]] · [[Infraestrutura - Cloudflare, Env Vars e Deploy]]

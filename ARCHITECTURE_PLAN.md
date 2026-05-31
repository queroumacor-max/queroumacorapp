# Plano de Modularização do `app.js`

> Auditoria estática de `/home/user/queroumacorapp/app.js` (vanilla JS, sem
> ES modules). Plano de organização por feature mantendo o contrato atual
> (funções globais via `<script defer>`).

## Sumário
- `app.js`: **9100** linhas, **350** funções top-level, **76** marcadores `// ══`.
- `head.js` (fora do escopo): ~40 funções utilitárias e auth.
- Módulos propostos: **27**.
- Utilitários compartilhados (→ `utils.js`): `parseBRL`, `fmtBRL`, `toast`,
  `showModal`, `closeModals`, `hideModal`, `escapeHtml`, `escapeJsArg`,
  `getTimeAgo`, `stripEmail`, `cleanHandle`, `getMediaType`,
  `_compressImageFile`, `_normTxt`, `_hashStr`, `isVideoUrl`,
  `_extractVideoFrame`, `_agYmd`, `crmNormName`, `crmMonthsSince`, `_starStr`.
- Já em `head.js` (não duplicar): `cfImg`, `avatarUrl`, `brl`, `dateBR`,
  `dateTimeBR`, `appConfirm`, `appPrompt`, `appAlert`, `requireSession`,
  `gateProClient`, `withTimeout`, `safeAwait`, `debounce`, `getMyProfile`,
  `apiPost`, `withErrorHandling`, `abortableFetch`.

---

## Mapa por módulo

| Módulo | Faixa em `app.js` | ~Linhas | Funções top-level (linha) |
|---|---|---|---|
| `nav` | 1–181 | 155 | `showScreen` (50), `_navSyncHistory` (90), `_bootstrapFromUrl` (156) |
| `ui-utils` | 182–245 | 60 | `toast` (188), `showModal` (199), `_injectSheetCloseButtons` (213), `closeModals` (228), `hideModal` (235) |
| `profile-mock` | 242–383 | 140 | `openProfile` (247), `showPainterCard` (356), `openPainterPopupProfile` (368), `switchTab` (377) |
| `calc` | 384–442 | 60 | `setD` (386), `calcTinta` (394), `estimarAreaPorFoto` (407) |
| `pro` | 439–605 + 1417–1442 | 190 | `refreshProStatus` (443), `applyProUI` (457), `checkProAccess` (495), `handleProReturn` (499), `abrirParceriaMP` (520), `handleCompraReturn` (531), `handleReferralParam` (582), `startProCheckout` (1417) |
| `info` | 607–710 | 105 | `openInfoPage` (626), `infoBack` (645), `supportWhatsApp` (649), `supportEmail` (654), `requestAccountDeletion` (660), `baixarMeusDados` (678) |
| `notif` | 728–744 + 3541–3686 | 160 | `notify` (728), `loadNotifications` (3542), `updateNotifBadge` (3620), `setupNotifSubscription` (3627) |
| `pipeline` | 711–1109 + 3683–3706 | 420 | `buildQuoteSnapshot` (745), `syncQuotesToJobs` (762), `loadPipeline` (799), `renderPipeline` (820), `renderPipelineCard` (851), `salvarOrcamento` (912), `enviarQuote` (936), `enviarQuoteConfirmar` (952), `sugerirPrecoQuote` (976), `aprovarQuoteManual` (1011), `recusarQuote` (1027), `setQuoteStage` (1036), `aprovarQuoteCliente` (1049), `verSnapshot` (1070), `setupPipelineSubscription` (3687) |
| `crm` | 1110–1442 | 330 | `loadCrm` (1135), `renderCrm` (1234), `renderCrmCard` (1276), `saveCrmInterval` (1328), `crmDraft` (1343), `crmSend` (1377) |
| `admin-mod` | 1443–1615 | 175 | `getAccessToken` (1446), `checkAdminEntry` (1454), `openModQueue` (1466), `modAction` (1506) |
| `ai-chat` | 1522–1974 | 450 | `openAiOrcamento` (1522), `openAiChat` (1531), `sendAiChat` (1552), `aiChatToggleVoice` (1625), `aiChatStopVoice` (1661), `aiChatHandleVoice` (1668), `falarSeuZe` (1684), `sugerirEscopoIA` (1713), `addOrcItem` (1745), `gerarOrcamentoIA` (1771) |
| `orcamento-pdf` | 1940–2052 | 110 | `ensureJsPDF` (1940), `compartilharOrcamento` (1953), `_buildOrcDoc` (1978), `gerarPDFOrcamento` (2029), `loadMaterialSuggestions` (2038) |
| `agenda` | 2053–2225 | 175 | `loadAgenda` (2060), `agMonth` (2072), `agSelect` (2078), `renderAgendaCal` (2080), `renderAgendaDay` (2111), `salvarJob` (2140), `updateJobStatus` (2160), `prefillNovoProjeto` (2166), `otimizarDiaAgenda` (2171) |
| `checklist` | 2226–2293 | 70 | `renderChecklist` (2236), `addChecklistItem` (2246), `loadChecklistTemplate` (2253), `loadChecklist` (2258), `saveChecklist` (2275) |
| `notes` | 2294–2375 | 85 | `startEditNote`/`cancelEditNote` (2296), `saveEditNote` (2298), `loadNotes` (2311), `salvarNota` (2352), `deletarNota` (2366) |
| `audio-stt` | 2376–2451 | 80 | `iniciarGravacaoNota` (2384), `pararGravacaoNota` (2420), `transcreverAudio` (2431) |
| `financeiro` | 2452–2595 | 145 | `loadFinanceiro` (2453), `salvarFinEntry` (2502), `deleteFinEntry` (2530), `analisarFinanceiroIA` (2539) |
| `autoresp` | 2596–2673 | 80 | `arToggle` (2600), `arSync` (2606), `loadAutoRespostas` (2613), `maybeAutoReply` (2632), `salvarAutoRespostas` (2660) |
| `ranking` | 2674–2694 | 20 | `loadRanking` (2675) |
| `points/refs` | 2695–2787 | 95 | `loadReferrals` (2696), `loadPoints` (2708), `trocarPontosPorPRO` (2742) |
| `leads` | 2766–2921 | 155 | `distribuirLead` (2767), `comprarObra` (2793), `openChatWithUser` (2812), `abrirOrcamentoChat` (2819) |
| `orcamento-form` | 2922–3046 + 4757–5304 | 670 | `addOrcPhotos` (2923), `renderOrcPhotos` (2933), `removeOrcPhoto` (2945), `enviarOrcamentoForm` (2951), `toggleOrcOutros` (4758), `sendOrc` (4765), `openChat` (4838) |
| `content-mod` | 3047–3127 | 80 | `moderateContent` (3079), `moderateContentAsync` (3088), `getMediaType` (3120, →utils) |
| `chat` | 3128–3540 + 4267–4439 + 4589–4649 + 5008–5303 | 1175 | `chatTab` (3137), `applyChatFilter` (3143), `convDisplayName` (3150), `getLocalConvKey/_Msgs*` (3163–3251), `loadChatList` (3253), `_proLabel` (3351), `renderConvList` (3359), `_searchNewChatUsersImpl` (3420), `getChatReceiverId` (3460), `startNewChat` (3475), `_markProcessed` (4271), `setupGlobalMsgSubscription` (4288), `handleRealtimeMsg` (4313), `openChatConversation` (4438), `sendChatMsg` (4590), `_msgKind`/`_msgColors` (5008–5038), `renderMessages` (5039), `sendMsg` (5104), `appendMsg` (5145), `handleChatAttachment` (5184), `addStoreToChat` (5234) |
| `pedidos` | 3706–3890 + 4579–4588 | 195 | `loadPedidos` (3707), `filterPedidos` (4580) |
| `profile-edit` | 3795–4438 | 565 | `previewAvatar` (3795), `_epShowLogo` (3804), `previewEpLogo` (3819), `removeEpLogo` (3831), `openEditProfile` (3839), `loadCidadesDoEstado` (3904), `_epStateChanged` (3921), `openEditEspecialidades` (3935), `saveEspecialidades` (3956), `openEditRaio` (3969), `saveRaio` (3984), `_epSpecRole` (4000), `_epSpecsSetup` (4008), `toggleEpSpecs` (4026), `_epSpecsApply` (4031), `saveEditProfile` (4040), `sharePost` (4259) |
| `signup-flow` | 4443–4577 | 135 | `selectRole` (4445), `validateInvite` (4454), `signupNext` (4489), `doSignup` (4504), `loadSpecsForRole` (4541), `toggleSpec` (4548), `isProfessionalRole` (4550), `selectProfession` (4552), `getSelectedProfession` (4557), `setMode` (4562) |
| `avaliacao` | 4650–4756 | 108 | `setStar` (4653), `toggleCriteria` (4659), `loadAvaliarScreen` (4663), `renderAvaliarServiceList` (4702), `selectAvaliarService` (4713), `submitAvaliacao` (4726) |
| `mkt` (loja) | 5305–5983 + 6868 | 680 | `resolveColorHex` (5331), `productBg`/`hasProductColor` (5338, 5343), `mktClassify` (5362), `_mktMountInfinite` (5377), `mktTab` (5405), `loadUserState` (5429), `saveCart` (5443), `updateCartBadge` (5461), `addToCart` (5471), `changeCartQty` (5491), `renderCartModal` (5501), `removeFromCart` (5533), `submitCartOrder` (5541), `getCategoryEmoji` (5587), `getProductImage` (5591), `_isArteUrbanaSpray` (5722), `renderProductRow` (5727), `_mktSearchImpl` (5755), `openProductDetail` (5787), `renderMktUI` (5823), `_isMktHidden` (5901), `loadMktProducts` (5903), `changeQty` (5939), `setSizeBtn` (5947), `setShirtColor` (5952), `openShirtZoom`/`closeShirtZoom` (5965, 5978), `buyShirt` (6868) |
| `ai-logo` | 5984–6170 + 6722–6871 | 340 | `_renderAiLogoSvg` (6014), `_aiLogoGenCount`/`_aiLogoBumpCount`/`_aiLogoUpdateBtn` (6036–6068), `gerarLogoIA` (6069), `_aiLogoCurrentSrc` (6141), `_applyLogoToShirt` (6151), `selectAiLogo` (6722), `usarLogoIA` (6729), `salvarLogoNoPerfil` (6746), `baixarLogo` (6775), `_applyOwnLogoToShirt` (6786), `uploadBusinessLogo` (6802), `loadBusinessLogo` (6849) |
| `ai-art` | 6171–6721 | 555 | `openAiArt` (6183), `_aiArtCreditsKey/Get/Inc/Max/UpdateUI` (6196–6240), `_aiArtToggleAdminButtons` (6241), `_aiArtLoadTemplates` (6255), `_aiArtTryLoadFirstAvailable` (6272), `_aiArtUploadTemplate` (6287), `_aiArtPickFile` (6363), `_aiArtSetStyle` (6400), `_aiArtSetAspect` (6436), `gerarArteIG` (6449), `_aiArtToggleLogo` (6519), `_aiArtComposeWithLogo` (6556), `_aiArtDownload` (6618), `_aiArtReset` (6627), `_aiArtPost` (6671) |
| `feed-publish` | 6882–6913 + 8205–8456 | 285 | `setPostType` (6886), `openPortfolioComposer` (6902), `previewPublicProfile` (6909), `handlePostFiles` (8210), `clearPostImages` (8229), `gerarLegendaPost` (8239), `publishPost` (8341) |
| `quals-courses` | 6914–7036 | 125 | `openManageQuals` (6915), `loadQualsList` (6921), `addQualification` (6936), `deleteQualification` (6962), `openManageCourses` (6974), `loadCoursesList` (6980), `addCourse` (6995), `deleteCourse` (7023) |
| `feed` | 7037–7538 | 500 | `setFeedFilter` (7037), `filterFeedPosts` (7049), `fetchPublicProfiles` (7063), `_feedCacheKey`/`paintFeedFromCache`/`scheduleFeedCacheSave` (7086–7126), `loadFeed` (7127), `renderFeedRetry`/`retryLoadFeed` (7189–7217), `invalidateFollowingIds`/`getFollowingIds` (7218–7242), `_feedVolIcon`/`toggleFeedVideoMute`/`toggleFeedVideoPlay`/`observeFeedVideos` (7244–7287), `buildFeedPostHTML` (7288), `loadPosts` (7390), `loadMoreFeed` (7532) |
| `auth-pw` | 7559–7610 | 50 | `sendPasswordReset` (7559), `doSetNewPassword` (7571), `_initUpdatePasswordScreen` (7594) |
| `feed-interactions` | 7611–7864 | 250 | `togglePostLike` (7611), `toggleCommentInput` (7654), `submitComment` (7671), `deleteComment` (7712), `toggleSavePost` (7724), `openPostOpts` (7756), `shareCurrentPost` (7764), `saveCurrentPost` (7768), `copyCurrentPostLink` (7776), `deleteCurrentPost` (7781), `reportPost` (7808), `submitReport` (7816), `deleteCurrentStory` (7840) |
| `stories` | 7866–8204 | 340 | `_stopStoryAnim` (7888), `loadStories` (7893), `isStoryGroupSeen`/`markStoryGroupSeen` (8047–8057), `openStoryViewer` (8058), `closeStoryViewer` (8066), `renderCurrentStory` (8074), `storyNext` (8177), `storyPrev` (8193) |
| `screen-hooks` | 8457–8465+ | 80 | wrapper que reatribui `showScreen` adicionando dispatchers por tela (`loadFeed`, `loadChatList`, `loadPedidos`, `loadPipeline`, `loadCrm`, `loadNotifications`, `initLeafletMap`) |
| `map` | 8466–8762 | 300 | `ensureLeaflet` (8466), `initLeafletMap` (8503), `createPinIcon` (8529), `_invalidatePaintersIndex`/`_buildPaintersIndex` (8554–8564), `loadMapPainters` (8565), `_matchType` (8616), `exploreType` (8624), `renderPainterList` (8640), `_filterExplorePaintersImpl` (8666), `loadLocalPaintersOnMap` (8724) |
| `archive` | 8763–8851 | 95 | `loadArchivedConvs` (8763), `saveArchivedConvs` (8774), `initArchiveButtons` (8781), `archiveConversation` (8799), `unarchiveConversation` (8808), `applyArchivedState` (8815), `toggleArchivedSection` (8847) |
| `signup-tag` | 8853–8922 | 70 | `validateAndGoStep3` (8888), `checkTagAvailability` (8924) |
| `invite` | 8923–9058 | 95 | `generateInviteCode` (8963), `shareInviteCode` (9007), `_consumeInviteFromUrl` (9028) |
| `maquininha` | 9059–9100 | 40 | `abrirMaquininha` (9061), `entrarListaMaquininha` (9081) |

> Há também blocos pequenos sem função top-level (`_msgColors`, `pedidos`
> filtro, `mode toggle` 6873–6881, `typing CSS` 6877–6881) e a área
> `4267–4287` (`chatData`, `_processedMsgIds`, `MAX_PROCESSED_IDS`,
> `_chatListDebounce`) que mora no módulo `chat`.

---

## Dependências cruzadas problemáticas

1. **`showScreen` é reescrito em runtime** (linha 8459: `_origShowScreen =
   showScreen; showScreen = function …`). Move-se com o módulo `nav`, mas
   só funciona se carregado **depois** de todos os módulos que ele despacha
   (`feed`, `chat`, `pedidos`, `map`, etc.). Inverter ordem dos `<script>`
   quebra hooks silenciosamente.
2. **`feed ↔ stories ↔ profiles-fetch`**: `loadFeed` (7127) chama
   `loadStories` (7893) + `loadPosts` (7390). Ambos chamam
   `fetchPublicProfiles` (7063, no `feed`) e `getFollowingIds` (7220, no
   `feed`). Não é ciclo verdadeiro, mas `stories` depende fortemente de
   `feed`.
3. **`chat ↔ autoresp ↔ notif`**: `handleRealtimeMsg` (4313, chat) dispara
   `maybeAutoReply` (2632, autoresp), que volta a usar `saveMsgLocal`
   (3227, chat). `autoresp` não é folha.
4. **Duas `openChat`**: `openChat(id)` em 4838 (modal orçamento) e
   `openChatConversation(userId,userName)` em 4438. Ambas viram pintor/cliente.
   Nome colide com `onclick="openChat(...)"` no HTML — risco de bug.
5. **`crm → leads → chat`**: `crmSend` (1377) → `openChatWithUser` (2812) →
   `startNewChat` (3475). Cadeia transitiva crm → leads → chat.
6. **`pipeline.aprovarQuoteCliente` → `distribuirLead`** (leads) → caminhos
   internos que tocam chat/notif.
7. **`mkt ↔ chat`** (leve): `addStoreToChat` (5234, chat) injeta produtos da
   loja; `submitCartOrder` (5541, mkt) cria mensagem em chat. Acoplamento
   bidirecional baixo, mas existe.
8. **`profile-edit` fisicamente fragmentado**: linhas 3795–4438 estão
   intercaladas com `pedidos` (3707) e `chat realtime` (4267). Extrair vai
   exigir varredura manual.
9. **`screen-hooks`** (8459) conhece **todos os módulos** — não pertence a
   nenhum, deve virar `boot.js`.

---

## Ordem de extração recomendada

1. **`utils.js`** — folha, zero deps. Mover `parseBRL`, `fmtBRL`, `toast`,
   `showModal`, `closeModals`, `hideModal`, `escapeHtml`, `escapeJsArg`,
   `getTimeAgo`, `stripEmail`, `cleanHandle`, `getMediaType`,
   `_compressImageFile`, `isVideoUrl`, `_extractVideoFrame`, `_normTxt`,
   `_hashStr`, `_starStr`, `_agYmd`, `crmNormName`, `crmMonthsSince`.
2. **`info.js`** — só consome utils + `apiPost`. Folha.
3. **`calc.js`** — folha.
4. **Folhas pequenas em paralelo:** `checklist.js`, `notes.js`,
   `autoresp.js`, `ranking.js`, `points.js`/`referrals.js`, `invite.js`,
   `maquininha.js`, `signup-tag.js`. Cada um < 100 linhas.
5. **Médias autocontidas:** `agenda.js`, `financeiro.js`, `audio-stt.js`,
   `avaliacao.js`, `quals-courses.js`.
6. **`pro.js`** — cliente de tudo, produtor de pouco.
7. **`pipeline.js`**, **`crm.js`** — features grandes mas coesas.
8. **`pedidos.js`**, **`leads.js`** — cuidar do bridge `abrirOrcamentoChat`.
9. **`mkt.js`** — 680 L, autossuficiente.
10. **`ai-logo.js`**, **`ai-art.js`**, **`orcamento-pdf.js`** — gordos, mas
    isolados.
11. **`map.js`** — depende de carregar Leaflet on-demand. OK isolado.
12. **`signup-flow.js`** + **`auth-pw.js`** — toca `head.js::doRegister`.
13. **`profile-edit.js`** — 565 L, fragmentado.
14. **`orcamento-form.js`** + **`ai-chat.js`** — Seu Zé fala com pdf,
    pipeline, voz. Penúltimos.
15. **`notif.js`** — `notify()` é usado em 14+ sites. Pode subir na ordem
    se você fixar contrato cedo.
16. **`chat.js`** — 1175 L, o mais entrelaçado. Penúltimo.
17. **`feed.js` + `feed-interactions.js` + `stories.js` + `feed-publish.js`** —
    ~1375 L combinadas. Considerar **um único `social.js`** se a separação
    custar muito ginástica.
18. **`nav.js` + `boot.js` (screen-hooks)** — por último. `showScreen` ser
    reescrito em runtime é o maior risco do refactor.

---

## Riscos

- **Cache-busting:** `index.html` carrega `app.js?v=…`. Cada novo `.js`
  precisa virar `<script src="X.js?v=…" defer>` próprio. Esquecer = telas
  brancas em produção via Cloudflare.
- **`onclick` inline no HTML:** boa parte do HTML chama `onclick="loadFeed()"`,
  `onclick="toggleSavePost(this)"`, etc. Funções **têm que continuar
  globais** (`window.X = …` no fim de cada módulo). Não usar `import/export`
  sem reescrever o HTML.
- **Ordem `<script defer>`:** preserva ordem do DOM, mas wrappers que
  executam no tempo de parse (screen-hooks reatribuindo `showScreen`)
  exigem ordem correta. Documentar dependência em comentário no topo.
- **Estado global compartilhado:** `currentUser` (head.js), `currentChat`,
  `chatData`, `_isPro`, `_isAdmin`, `painters`, `_processedMsgIds`,
  `postSelectedFiles`, `_aiVoice*`. Decidir cedo: `window.AppState = {…}`
  ou continuar com globais soltas.
- **`head.js` ↔ `app.js` overlap:** `loadMyProfileData`, `openUserProfile`,
  `toggleFollow` já estão em `head.js`. `painters` mock + `openProfile`
  fallback em `app.js:247` deveria morrer antes do refactor.
- **Sem teste funcional de UI:** `tests/` não cobre fluxo de tela. Smoke
  test manual por feature após cada extração.

---

## Próximo passo recomendado

Começar por **`utils.js`** porque:

1. **Zero dependências** — funções puras. Sem ciclo possível.
2. **Maior alavanca** — `escapeHtml`, `toast`, `closeModals`, `getTimeAgo`
   batem em 80%+ dos outros módulos. Encolhe `app.js` em ~150 L sem
   regressão.
3. **Risco mínimo** — smoke test = abrir home, ver se toast e modal
   funcionam.
4. **Habilita o resto** — uma vez fixado, todo módulo pode mover-se
   referenciando `window.utils.escapeHtml`/`toast` em vez de redeclarar.

Depois de `utils.js`, atacar `info.js + calc.js + checklist.js + notes.js`
em paralelo (folhas pequenas) pra validar a pipeline de extração antes de
mexer em `chat` ou `feed`. **Não extrair `nav` cedo** — `showScreen` tem
reatribuição em runtime na linha 8459; deixar por último.

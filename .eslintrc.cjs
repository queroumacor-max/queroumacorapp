// ESLint config (legacy/eslintrc) — ESLint v8.x.
//
// O projeto é vanilla JS PWA com dois padrões coexistindo:
//   1) Classic scripts (sourceType 'script'): app.js, head.js, shims.js,
//      utils.js, db.js, validators.js, errors.js, logger.js, policies.js,
//      config.js, events.js, schemas/*.js, modules/*.js. Carregados por
//      <script> no index.html. Os de /modules são IIFE; app.js e head.js
//      DELIBERADAMENTE declaram globais top-level (HTML inline handlers
//      como onclick="loadFeed()" dependem disso — vide CLAUDE.md).
//   2) ES modules (sourceType 'module'): functions/api/*, scripts/*,
//      tests/*, e2e/*, types.js (tem `export {}`).
//
// Objetivo do config: pegar a classe de bug que motivou criar o lint —
// TDZ refs, dead refs, no-undef, no-unused-vars. SEM regras de estilo.
//
// Estratégia das rules:
//   - `no-undef` + `no-use-before-define` ON em todo lugar (ERROR).
//   - `no-implicit-globals` + `no-redeclare` ON SÓ em /modules (onde a
//     convenção exige IIFE). DESLIGADO em app.js/head.js/utils.js/…
//     porque eles legitimamente declaram globais top-level (esse é o
//     ponto da ponte de migração).
//   - Globals listam todas as funções shimadas (shims.js republica
//     Modules.X.fn → window.fn) + estado top-level de app.js/head.js,
//     senão no-undef explodiria com falso-positivos.

// Lista de funções expostas via shims.js (espelha o que esse arquivo
// republica como window.X). Mantém aqui pra não ter que editar dois
// lugares — mas se shims.js mudar, atualizar aqui também.
const SHIMMED_GLOBALS = [
  // utils.js (helpers puros)
  'parseBRL','fmtBRL','toast','showModal','closeModals','hideModal',
  'escapeHtml','escapeJsArg','getTimeAgo','stripEmail','cleanHandle',
  'getMediaType','_compressImageFile','isVideoUrl','_extractVideoFrame',
  '_normTxt','_hashStr','_starStr','_agYmd','crmNormName','crmMonthsSince',
  // UX helpers (utils.js): setButtonLoading, emptyState, errorState, skeletonRows
  'setButtonLoading','emptyState','errorState','skeletonRows',
  // info
  'SUPPORT','openInfoPage','infoBack','supportWhatsApp','supportEmail',
  'requestAccountDeletion','baixarMeusDados',
  // calc
  'setD','calcTinta','estimarAreaPorFoto',
  // checklist
  'renderChecklist','addChecklistItem','loadChecklistTemplate','loadChecklist','saveChecklist',
  // notes
  'startEditNote','cancelEditNote','saveEditNote','loadNotes','salvarNota','deletarNota',
  // autoresp
  'arToggle','arSync','loadAutoRespostas','maybeAutoReply','salvarAutoRespostas',
  // ranking
  'loadRanking',
  // points-refs
  'loadReferrals','loadPoints','trocarPontosPorPRO',
  // invite
  'generateInviteCode','shareInviteCode',
  // maquininha
  'abrirMaquininha','entrarListaMaquininha',
  // signup-tag
  'validateAndGoStep3','checkTagAvailability',
  // agenda
  'loadAgenda','agMonth','agSelect','renderAgendaCal','renderAgendaDay',
  'salvarJob','updateJobStatus','prefillNovoProjeto','otimizarDiaAgenda',
  // financeiro
  'loadFinanceiro','salvarFinEntry','deleteFinEntry','analisarFinanceiroIA',
  // audio-stt
  'iniciarGravacaoNota','pararGravacaoNota','transcreverAudio',
  // avaliacao
  'setStar','toggleCriteria','loadAvaliarScreen','renderAvaliarServiceList',
  'selectAvaliarService','submitAvaliacao',
  // quals-courses
  'openManageQuals','loadQualsList','addQualification','deleteQualification',
  'openManageCourses','loadCoursesList','addCourse','deleteCourse',
  // pro
  'refreshProStatus','applyProUI','checkProAccess','handleProReturn',
  'abrirParceriaMP','handleCompraReturn','handleReferralParam','startProCheckout',
  // archive
  'loadArchivedConvs','saveArchivedConvs','initArchiveButtons',
  'archiveConversation','unarchiveConversation','applyArchivedState','toggleArchivedSection',
  // auth-pw
  'sendPasswordReset','doSetNewPassword',
  // content-mod
  'moderateContent','moderateContentAsync',
  // map
  'ensureLeaflet','initLeafletMap','createPinIcon','loadMapPainters',
  'exploreType','renderPainterList','filterExplorePainters','loadLocalPaintersOnMap',
  // mkt
  'resolveColorHex','productBg','hasProductColor','mktClassify','loadUserState',
  'saveCart','updateCartBadge','addToCart','changeCartQty','renderCartModal',
  'removeFromCart','submitCartOrder','getCategoryEmoji','getProductImage',
  'renderProductRow','openProductDetail','mktTab','mktSearch','renderMktUI',
  'loadMktProducts','changeQty','setSizeBtn','setShirtColor','openShirtZoom',
  'closeShirtZoom','buyShirt',
  // feed
  'setFeedFilter','filterFeedPosts','fetchPublicProfiles','paintFeedFromCache',
  'scheduleFeedCacheSave','loadFeed','renderFeedRetry','retryLoadFeed',
  'invalidateFollowingIds','getFollowingIds','toggleFeedVideoMute',
  'toggleFeedVideoPlay','observeFeedVideos','buildFeedPostHTML','loadPosts','loadMoreFeed',
  // feed-publish
  'setPostType','openPortfolioComposer','previewPublicProfile','handlePostFiles',
  'clearPostImages','gerarLegendaPost','publishPost',
  // stories
  'loadStories','isStoryGroupSeen','markStoryGroupSeen','openStoryViewer',
  'closeStoryViewer','renderCurrentStory','storyNext','storyPrev',
  // orcamento-form
  'abrirOrcamentoChat','addOrcPhotos','renderOrcPhotos','removeOrcPhoto',
  'enviarOrcamentoForm','toggleOrcOutros','sendOrc',
  // ai-art
  'openAiArt','gerarArteIG',
  // ai-chat
  'openAiOrcamento','openAiChat','sendAiChat','aiChatToggleVoice',
  'aiChatStopVoice','aiChatHandleVoice','falarSeuZe','sugerirEscopoIA',
  'addOrcItem','gerarOrcamentoIA',
  // ai-logo
  'gerarLogoIA','selectAiLogo','usarLogoIA','salvarLogoNoPerfil','baixarLogo',
  'uploadBusinessLogo','loadBusinessLogo',
  // pipeline
  'QUOTE_STATUS','buildQuoteSnapshot','syncQuotesToJobs','loadPipeline',
  'renderPipeline','renderPipelineCard','salvarOrcamento','enviarQuote',
  'enviarQuoteConfirmar','sugerirPrecoQuote','aprovarQuoteManual','recusarQuote',
  'setQuoteStage','aprovarQuoteCliente','verSnapshot','setupPipelineSubscription',
  // crm
  'loadCrm','renderCrm','renderCrmCard','saveCrmInterval','crmDraft','crmSend',
  // chat
  'chatTab','applyChatFilter','convDisplayName','getLocalConvKey','getLocalMsgsKey',
  'saveConvLocal','loadConvsLocal','saveMsgLocal','loadMsgsLocal','loadChatList',
  'renderConvList','searchNewChatUsers','startNewChat','openChatConversation',
  'getChatReceiverId','setupGlobalMsgSubscription','handleRealtimeMsg',
  'sendChatMsg','sendMsg','handleChatAttachment','renderMessages','appendMsg','addStoreToChat',
  // profile-edit
  'previewAvatar','previewEpLogo','removeEpLogo','openEditProfile',
  'loadCidadesDoEstado','openEditEspecialidades','saveEspecialidades',
  'openEditRaio','saveRaio','toggleEpSpecs','saveEditProfile','sharePost',
  // feed-interactions
  'togglePostLike','toggleCommentInput','submitComment','deleteComment',
  'toggleSavePost','openPostOpts','shareCurrentPost','saveCurrentPost',
  'copyCurrentPostLink','deleteCurrentPost','reportPost','submitReport','deleteCurrentStory',
  // pedidos
  'loadPedidos','filterPedidos',
  // leads
  'distribuirLead','comprarObra','openChatWithUser',
  // signup-flow
  'selectRole','validateInvite','signupNext','doSignup','loadSpecsForRole',
  'toggleSpec','isProfessionalRole','selectProfession','getSelectedProfession','setMode',
  // admin-mod
  'checkAdminEntry','openModQueue','modAction','openErrorsAdmin',
  'loadErrorsAdmin','errsPager','renderErrorsAdmin',
  // notif
  'notify','loadNotifications','updateNotifBadge','setupNotifSubscription',
  // orcamento-pdf
  'ensureJsPDF','compartilharOrcamento','gerarPDFOrcamento','loadMaterialSuggestions',
  // profile-mock
  'openProfile','showPainterCard','openPainterPopupProfile','switchTab',
  // nav
  'showScreen',
];

// Helpers globais definidos em head.js / utils.js (não passam pelo shims
// porque já são top-level no head.js, mas precisam estar em globals para
// que módulos que os referenciam não disparem no-undef).
const HEAD_HELPERS = [
  'getSupabase','reportError','showError','safeAwait','cfImg','avatarUrl',
  'avatarOf','avatarImgTag','appConfirm','appAlert','appPrompt','requireSession',
  'handleSbError','gateProClient','dateBR','withTimeout','autoDetectRole',
  'getMyProfile','apiPost','updateMyStoryAvatar','doRegisterSupabase',
  'safeUrl','openUserProfile','loadMyProfileData','startChatWith',
  'getSearchEmpty','invalidateMyProfile','_authRateCheck','getAccessToken',
  // Funções com prefixo `_` que shims.js republica intencionalmente
  // (IIFE-private em módulos mas chamadas bare por outros módulos / boot).
  '_consumeInviteFromUrl','_flushConvs','_flushMsgs','openChat',
  '_initUpdatePasswordScreen','_applyOwnLogoToShirt','_resetMsgColors',
];

// Estado top-level declarado em app.js (var X) que outros módulos leem/escrevem.
const APP_STATE = [
  'currentUser','currentChat','chatData','painters','currentMode',
  'storyGroups','currentStoryGroup','currentStoryIndex','_seenStories',
  '_isPro','_isAdmin','_processedMsgIds','MAX_PROCESSED_IDS','renderedMsgIds',
  '_searchNewChatToken','_pipelineSub','_notifSub','_globalMsgSub',
  'validatedInviteCode','cartItems','shirtQty','mktProducts','STORY_DURATION',
  'calicolorsUserId','CALICOLORS_EMAIL','leafletMap','_roleSpecs',
  '_lastOrcData','chatStoreAdded','cartCount','logoState','_aiLogoCount',
  'POST_COLS','SUPABASE_URL',
];

// Namespaces de módulos / SDK terceiros (Leaflet UMD expõe `L`).
const NAMESPACES = [
  'Modules','DB','Utils','Policies','Validators','Schemas','Errors',
  'Logger','Config','Events','Sentry','L',
];

const ALL_WRITABLE = [...APP_STATE];
const ALL_READONLY = [...SHIMMED_GLOBALS, ...HEAD_HELPERS, ...NAMESPACES];

const buildGlobals = () => {
  const g = {};
  ALL_WRITABLE.forEach(n => { g[n] = 'writable'; });
  ALL_READONLY.forEach(n => { g[n] = 'readonly'; });
  return g;
};

module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script',
  },
  globals: buildGlobals(),
  rules: {
    // CRÍTICAS — bloqueiam o merge (severity 'error')
    'no-undef': 'error',
    'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],

    // QUALIDADE — só avisam, não bloqueiam
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'eqeqeq': ['warn', 'smart'],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'prefer-const': 'warn',
  },
  overrides: [
    // ── MODULES — IIFE-wrapped, exigem no-implicit-globals.
    // Aqui é onde a convenção de IIFE+window.Modules.X precisa ser
    // mecanicamente garantida.
    {
      files: ['modules/**/*.js'],
      rules: {
        'no-implicit-globals': 'error',
        'no-redeclare': 'error',
      },
    },
    // ── CAMADA-BRIDGE — classic scripts que LEGITIMAMENTE declaram
    // globais top-level (HTML inline handlers dependem disso). Desliga
    // no-implicit-globals e no-redeclare aqui — eles são feature, não bug.
    {
      files: [
        'app.js','head.js','shims.js','utils.js','db.js','validators.js',
        'errors.js','logger.js','policies.js','config.js','events.js',
        'schemas/_core.js','schemas/primitives.js','schemas/documents.js',
        'schemas/social.js','schemas/index.js',
      ],
      rules: {
        'no-implicit-globals': 'off',
        'no-redeclare': 'off',
      },
    },
    // ── ES modules — Cloudflare functions, scripts node, tests, e2e.
    {
      files: [
        'functions/**/*.js',
        'scripts/**/*.js',
        'tests/**/*.js',
        'e2e/**/*.js',
        'types.js',
        'vitest.config.js',
        'playwright.config.js',
      ],
      parserOptions: {
        sourceType: 'module',
      },
      env: {
        // browser ON também aqui — e2e usa `window` em page.evaluate(),
        // e functions/api/* usa Web APIs (Response, Request, fetch).
        browser: true,
        node: true,
        es2022: true,
      },
    },
    // ── Service worker
    {
      files: ['sw.js'],
      env: {
        browser: false,
        worker: true,
        serviceworker: true,
      },
      rules: {
        // sw.js é top-level com `function cacheFirst(...)` etc. — não vamos
        // exigir IIFE aqui; o SW roda no próprio escopo de worker.
        'no-implicit-globals': 'off',
      },
    },
    // ── Tests (vitest globals + mocks relaxados)
    {
      files: ['tests/**/*.js', 'tests/**/*.cjs'],
      env: {
        node: true,
        browser: true,
        es2022: true,
      },
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
      rules: {
        'no-unused-vars': 'off',
        'no-console': 'off',
        'no-use-before-define': 'off',
      },
    },
    // ── Playwright e2e
    {
      files: ['e2e/**/*.js'],
      rules: {
        'no-console': 'off',
      },
    },
    // ── Este próprio config
    {
      files: ['.eslintrc.cjs'],
      env: {
        node: true,
        browser: false,
      },
      parserOptions: {
        sourceType: 'script',
      },
    },
  ],
};

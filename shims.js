// shims.js — ponte de migração Fase 4 etapa 2.
//
// Mapeia exports de window.Modules.X.* para window.* (globals), permitindo
// deletar funções duplicadas do app.js sem quebrar HTML inline handlers
// (onclick="..."), addEventListener inline, e chamadas bare em código
// não-migrado.
//
// Carregado APÓS app.js no index.html — então sobrepõe qualquer função
// remanescente no app.js com a versão modular.
//
// Convenção: só shim funções públicas (sem prefixo _) e objetos exportados.
// Internals/state ficam encapsulados no IIFE do módulo.
(function(){
  'use strict';
  if(!window.Modules){
    console.warn('[shims] window.Modules indefinido — módulos não carregaram?');
    return;
  }
  const M = window.Modules;
  // Helper: atribui Modules.<ns>[k] -> window[k] para cada k em keys
  function expose(ns, keys){
    const mod = M[ns];
    if(!mod){ console.warn('[shims] módulo ausente:', ns); return; }
    keys.forEach(k=>{
      if(typeof mod[k] === 'undefined'){
        console.warn('[shims]', ns+'.'+k, 'indefinido');
        return;
      }
      window[k] = mod[k];
    });
  }

  // ── info (Fale Conosco / LGPD / SUPPORT)
  expose('info', ['SUPPORT','openInfoPage','infoBack','supportWhatsApp','supportEmail','requestAccountDeletion','baixarMeusDados']);

  // ── calc (calculadora de tinta)
  expose('calc', ['setD','calcTinta','estimarAreaPorFoto']);

  // ── checklist (checklist de obra)
  expose('checklist', ['renderChecklist','addChecklistItem','loadChecklistTemplate','loadChecklist','saveChecklist']);

  // ── notes (anotações)
  expose('notes', ['startEditNote','cancelEditNote','saveEditNote','loadNotes','salvarNota','deletarNota']);

  // ── autoresp (auto-respostas)
  expose('autoresp', ['arToggle','arSync','loadAutoRespostas','maybeAutoReply','salvarAutoRespostas']);

  // ── ranking (ranking por cidade)
  expose('ranking', ['loadRanking']);

  // ── points-refs (pontos / indicações)
  expose('pointsRefs', ['loadReferrals','loadPoints','trocarPontosPorPRO']);

  // ── invite (convite entre pintores)
  expose('invite', ['generateInviteCode','shareInviteCode']);

  // ── maquininha (maquininha)
  expose('maquininha', ['abrirMaquininha','entrarListaMaquininha']);

  // ── signup-tag (validação de tag)
  expose('signupTag', ['validateAndGoStep3','checkTagAvailability']);

  // ── agenda (agenda de obras)
  expose('agenda', ['loadAgenda','agMonth','agSelect','renderAgendaCal','renderAgendaDay','salvarJob','updateJobStatus','prefillNovoProjeto','otimizarDiaAgenda']);

  // ── financeiro (financeiro pro)
  expose('financeiro', ['loadFinanceiro','salvarFinEntry','deleteFinEntry','analisarFinanceiroIA']);

  // ── audio-stt (gravação de áudio + STT)
  expose('audioStt', ['iniciarGravacaoNota','pararGravacaoNota','transcreverAudio']);

  // ── avaliacao (avaliação pós-serviço)
  expose('avaliacao', ['setStar','toggleCriteria','loadAvaliarScreen','renderAvaliarServiceList','selectAvaliarService','submitAvaliacao']);

  // ── quals-courses (qualificações + cursos)
  expose('qualsCourses', ['openManageQuals','loadQualsList','addQualification','deleteQualification','openManageCourses','loadCoursesList','addCourse','deleteCourse']);

  // ── pro (gating PRO + checkout Mercado Pago)
  expose('pro', ['refreshProStatus','applyProUI','checkProAccess','handleProReturn','abrirParceriaMP','handleCompraReturn','handleReferralParam','startProCheckout']);

  // ── archive (conversas arquivadas)
  expose('archive', ['loadArchivedConvs','saveArchivedConvs','initArchiveButtons','archiveConversation','unarchiveConversation','applyArchivedState','toggleArchivedSection']);

  // ── auth-pw (reset / update password)
  expose('authPw', ['sendPasswordReset','doSetNewPassword']);

  // ── content-mod (moderação de conteúdo)
  expose('contentMod', ['moderateContent','moderateContentAsync']);

  // ── map (Leaflet + mapa de pintores)
  expose('map', ['ensureLeaflet','initLeafletMap','createPinIcon','loadMapPainters','exploreType','renderPainterList','filterExplorePainters','loadLocalPaintersOnMap']);

  // ── mkt (Cali Colors marketplace)
  expose('mkt', ['resolveColorHex','productBg','hasProductColor','mktClassify','loadUserState','saveCart','updateCartBadge','addToCart','changeCartQty','renderCartModal','removeFromCart','submitCartOrder','getCategoryEmoji','getProductImage','renderProductRow','openProductDetail','mktTab','mktSearch','renderMktUI','loadMktProducts','changeQty','setSizeBtn','setShirtColor','openShirtZoom','closeShirtZoom','buyShirt']);

  // ── feed (feed principal)
  expose('feed', ['setFeedFilter','filterFeedPosts','fetchPublicProfiles','paintFeedFromCache','scheduleFeedCacheSave','loadFeed','renderFeedRetry','retryLoadFeed','invalidateFollowingIds','getFollowingIds','toggleFeedVideoMute','toggleFeedVideoPlay','observeFeedVideos','buildFeedPostHTML','loadPosts','loadMoreFeed']);

  // ── feed-publish (composer)
  expose('feedPublish', ['setPostType','openPortfolioComposer','previewPublicProfile','handlePostFiles','clearPostImages','gerarLegendaPost','publishPost']);

  // ── stories (stories carousel + viewer)
  expose('stories', ['loadStories','isStoryGroupSeen','markStoryGroupSeen','openStoryViewer','closeStoryViewer','renderCurrentStory','storyNext','storyPrev']);

  // ── orcamento-form (formulário de orçamento)
  expose('orcamentoForm', ['abrirOrcamentoChat','addOrcPhotos','renderOrcPhotos','removeOrcPhoto','enviarOrcamentoForm','toggleOrcOutros','sendOrc']);

  // ── ai-art (Arte IG / imagens IA)
  expose('aiArt', ['openAiArt','gerarArteIG']);

  // ── ai-chat (Chat IA / orçamento IA)
  expose('aiChat', ['openAiOrcamento','openAiChat','sendAiChat','aiChatToggleVoice','aiChatStopVoice','aiChatHandleVoice','falarSeuZe','sugerirEscopoIA','addOrcItem','gerarOrcamentoIA']);

  // ── ai-logo (Logo IA / camiseta personalizada)
  expose('aiLogo', ['gerarLogoIA','selectAiLogo','usarLogoIA','salvarLogoNoPerfil','baixarLogo','uploadBusinessLogo','loadBusinessLogo']);

  // ── pipeline (kanban de orçamentos / pipeline)
  expose('pipeline', ['QUOTE_STATUS','buildQuoteSnapshot','syncQuotesToJobs','loadPipeline','renderPipeline','renderPipelineCard','salvarOrcamento','enviarQuote','enviarQuoteConfirmar','sugerirPrecoQuote','aprovarQuoteManual','recusarQuote','setQuoteStage','aprovarQuoteCliente','verSnapshot','setupPipelineSubscription']);

  // ── crm (CRM seguir clientes)
  expose('crm', ['loadCrm','renderCrm','renderCrmCard','saveCrmInterval','crmDraft','crmSend']);

  // ── chat (DM 1:1 + 3-way Cali)
  expose('chat', ['chatTab','applyChatFilter','convDisplayName','getLocalConvKey','getLocalMsgsKey','saveConvLocal','loadConvsLocal','saveMsgLocal','loadMsgsLocal','loadChatList','renderConvList','searchNewChatUsers','startNewChat','openChatConversation','getChatReceiverId','setupGlobalMsgSubscription','handleRealtimeMsg','sendChatMsg','sendMsg','handleChatAttachment','renderMessages','appendMsg','addStoreToChat','CALICOLORS_EMAIL']);

  // ── profile-edit (editar perfil + especialidades + raio)
  expose('profileEdit', ['previewAvatar','previewEpLogo','removeEpLogo','openEditProfile','loadCidadesDoEstado','openEditEspecialidades','saveEspecialidades','openEditRaio','saveRaio','toggleEpSpecs','saveEditProfile','sharePost']);

  // ── feed-interactions (like / comment / share / report / save / delete)
  expose('feedInteractions', ['togglePostLike','toggleCommentInput','submitComment','deleteComment','toggleSavePost','openPostOpts','shareCurrentPost','saveCurrentPost','copyCurrentPostLink','deleteCurrentPost','reportPost','submitReport','deleteCurrentStory']);

  // ── pedidos (pedidos Cali Colors)
  expose('pedidos', ['loadPedidos','filterPedidos']);

  // ── leads (leads / comprar obra)
  expose('leads', ['distribuirLead','comprarObra','openChatWithUser']);

  // ── signup-flow (fluxo de cadastro)
  expose('signupFlow', ['selectRole','validateInvite','signupNext','doSignup','loadSpecsForRole','toggleSpec','isProfessionalRole','selectProfession','getSelectedProfession','setMode']);

  // ── admin-mod (moderação + console de erros)
  expose('adminMod', ['checkAdminEntry','openModQueue','modAction','openErrorsAdmin','loadErrorsAdmin','errsPager','renderErrorsAdmin']);

  // ── notif (notificações)
  expose('notif', ['notify','loadNotifications','updateNotifBadge','setupNotifSubscription']);

  // ── orcamento-pdf (gerar PDF de orçamento)
  expose('orcamentoPdf', ['ensureJsPDF','compartilharOrcamento','gerarPDFOrcamento','loadMaterialSuggestions']);

  // ── profile-mock (perfil + popup)
  expose('profileMock', ['openProfile','showPainterCard','openPainterPopupProfile','switchTab']);

  // ── nav (showScreen)
  expose('nav', ['showScreen']);
})();

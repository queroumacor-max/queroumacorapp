// modules/nav.js — navegação entre telas (showScreen + history sync + bootstrap)
// extraída do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
//
// IMPORTANTE: o app.js sobrescreve `showScreen` em runtime (linha ~8459) com um
// wrap que dispatcha eventos pós-troca de tela. Esse wrap é responsabilidade do
// módulo screen-hooks (agente paralelo) e NÃO está aqui — esta cópia espelha
// apenas a versão ORIGINAL (linha ~50 do app.js).
//
// Listeners auto-executáveis (history.replaceState inicial, popstate handler,
// DOMContentLoaded → _bootstrapFromUrl) NÃO estão neste módulo — continuam
// como boot code no app.js (linhas ~109, ~119, ~178).
//
// Depende de globals do app.js: closeModals, _lastFeedLoad, loadFeed,
// loadMktProducts, updateCartBadge, loadMyProfileData, refreshProStatus,
// loadChatList, getSearchEmpty, loadNotifications, loadPedidos,
// loadAvaliarScreen, loadBusinessLogo, openInfoPage, loadPipeline, loadCrm,
// _initUpdatePasswordScreen, currentUser, toast.
(function(){
  'use strict';

  // ══ SCREENS ══
  const screens=['login','signup','feed','explore','search','profile','orcamento','myprofile','calc','notif','chat','chatconv','pedidos','avaliar','mkt','camisetas','info','pipeline','crm','update-password'];

  const bnMap={feed:'bn-feed',search:'bn-search',mkt:'bn-mkt',notif:'bn-notif',myprofile:'bn-myprofile'};
  const noNav=['login','signup','chatconv'];

  // Mapa de screen → path da URL pública. Telas sem entrada aqui ficam como /.
  // Note: nomes das telas batem com os IDs em index.html (screen-NAME). `mkt` é a loja,
  // `myprofile` é o perfil do usuário, `orcamento` é a tela de orçamentos/pedidos.
  const SCREEN_TO_PATH = {
    'feed': '/',
    'explore': '/explore',
    'mkt': '/loja',
    'myprofile': '/perfil',
    'chat': '/chat',
    'orcamento': '/orcamentos',
    'pedidos': '/pedidos',
    'avaliar': '/avaliar',
    'info': '/info',
    'search': '/search',
    'notif': '/notificacoes',
    'crm': '/crm',
    'pipeline': '/pipeline',
    'calc': '/calculadora',
    'camisetas': '/camisetas',
    'profile': '/profissional',
    'login': '/login',
    'signup': '/signup',
    'update-password': '/update-password'
  };
  const PATH_TO_SCREEN = Object.fromEntries(Object.entries(SCREEN_TO_PATH).map(([k, v]) => [v, k]));

  function showScreen(n, _fromPop){
    screens.forEach(s=>{
      const el=document.getElementById('screen-'+s);
      if(el)el.classList.toggle('active',s===n);
    });
    Object.values(bnMap).forEach(id=>{document.getElementById(id)?.classList.remove('active');});
    if(bnMap[n])document.getElementById(bnMap[n]).classList.add('active');
    if(['pedidos','avaliar','camisetas','info','pipeline','crm'].includes(n)){document.getElementById('bn-myprofile')?.classList.add('active');}
    if(['chatconv'].includes(n)){/* chat is in top nav, no bottom nav highlight */}
    const topNav=document.querySelector('.top-nav');
    const botNav=document.querySelector('.bot-nav');
    if(topNav)topNav.style.display=noNav.includes(n)?'none':'flex';
    if(botNav)botNav.style.display=noNav.includes(n)?'none':'flex';
    const scrollArea=document.getElementById('scroll-area');
    if(scrollArea)scrollArea.scrollTop=0;
    closeModals();
    const pp=document.getElementById('painter-popup');
    if(pp)pp.classList.remove('show');
    if(n==='chatconv'){setTimeout(()=>{const a=document.getElementById('msgs-area');if(a)a.scrollTop=a.scrollHeight;},150);}
    if(n==='feed'){
      // _lastFeedLoad agora vive IIFE-private no módulo feed (não vaza por let
      // entre scripts), então lemos via accessor. Gate de 30s preservado.
      const last = (window.Modules && window.Modules.feed && window.Modules.feed.getLastFeedLoad)
        ? window.Modules.feed.getLastFeedLoad() : 0;
      if(!last || Date.now()-last > 30000){ loadFeed(); }
    }
    if(n==='mkt') { loadMktProducts(); updateCartBadge(); }
    if(n==='myprofile'){ loadMyProfileData(); refreshProStatus(); }
    if(n==='chat'){ loadChatList(); const cb=document.getElementById('chat-badge-dot'); if(cb) cb.style.display='none'; }
    if(n==='search'){ const sr=document.getElementById('search-results'); if(sr) sr.innerHTML = getSearchEmpty(); }
    if(n==='notif') loadNotifications();
    if(n==='pedidos') loadPedidos();
    if(n==='avaliar') loadAvaliarScreen();
    if(n==='camisetas') loadBusinessLogo();
    if(n==='info') openInfoPage('menu');
    if(n==='pipeline') loadPipeline();
    if(n==='crm') loadCrm();
    if(n==='update-password') _initUpdatePasswordScreen();
    _navSyncHistory(n, _fromPop);
  }

  // ══ BOTÃO VOLTAR (Android / PWA) — navega entre telas em vez de fechar o app ══
  // Estado encapsulado no módulo. O app.js mantém suas próprias cópias enquanto
  // a migração de call sites não rodou; depois esse estado vira a fonte única.
  let _navCurScreen = 'feed';
  let _navBackStack = [];
  let _navExitArmed = false;

  function _navSyncHistory(n, fromPop){
    if(n === _navCurScreen) return;
    const path = SCREEN_TO_PATH[n] || '/';
    if(n === 'login' || n === 'signup'){
      _navBackStack = [];
      _navCurScreen = n;
      try { history.replaceState({ qs:n, screen:n }, '', path); } catch(e){}
      return;
    }
    if(!fromPop){
      _navBackStack.push(_navCurScreen);
      try {
        if(location.pathname !== path) history.pushState({ qs:n, screen:n }, '', path);
        else history.pushState({ qs:n, screen:n }, '');
      } catch(e){}
    }
    _navCurScreen = n;
  }

  // ══ BOOTSTRAP: deep-link / refresh em rota não-raiz ══
  // Quando o usuário abre /explore, /loja etc. direto, mostra a tela correspondente.
  // Aguarda auth resolver pra telas que precisam de currentUser (até ~3s).
  function _bootstrapFromUrl(){
    const screen = PATH_TO_SCREEN[location.pathname];
    if(!screen || screen === 'feed') return;
    if(typeof showScreen !== 'function') return;
    // Telas públicas (não precisam de auth) podem ser mostradas direto.
    const publicScreens = ['login','signup','info','explore','mkt','search','update-password'];
    if(publicScreens.includes(screen)){
      showScreen(screen, true);
      return;
    }
    // Telas privadas: aguarda currentUser
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if(typeof currentUser !== 'undefined' && currentUser){
        clearInterval(t);
        showScreen(screen, true);
      } else if(tries > 30){
        clearInterval(t);
      }
    }, 100);
  }

  // ══ POPSTATE HANDLER (botão voltar do Android / browser back) ══
  // Migrado do app.js boot code pra usar o estado IIFE-private deste módulo.
  try {
    const _initPath = SCREEN_TO_PATH['feed'] || '/';
    if(location.pathname === '/' || location.pathname === '') {
      history.replaceState({ qs:'feed', screen:'feed' }, '', _initPath);
    } else {
      history.replaceState({ qs:'feed', screen:'feed' }, '');
    }
  } catch(e){}
  window.addEventListener('popstate', function(e){
    if(document.querySelector('.overlay.open')){
      closeModals();
      try { history.pushState({ qs:_navCurScreen, screen:_navCurScreen }, ''); } catch(e){}
      return;
    }
    const urlScreen = (e && e.state && e.state.screen) || PATH_TO_SCREEN[location.pathname];
    if(urlScreen && urlScreen !== _navCurScreen){
      showScreen(urlScreen, true);
      return;
    }
    if(_navBackStack.length){
      const prev = _navBackStack.pop();
      showScreen(prev, true);
      return;
    }
    if(_navCurScreen !== 'feed'){
      showScreen('feed', true);
      try { history.pushState({ qs:'feed', screen:'feed' }, '', SCREEN_TO_PATH['feed'] || '/'); } catch(e){}
      return;
    }
    if(_navExitArmed) return;
    _navExitArmed = true;
    if(typeof toast === 'function') toast('Toque em voltar de novo para sair');
    try { history.pushState({ qs:'feed', screen:'feed' }, '', SCREEN_TO_PATH['feed'] || '/'); } catch(e){}
    setTimeout(function(){ _navExitArmed = false; }, 2000);
  });

  // ══ BOOTSTRAP: agendado pra rodar quando o DOM estiver pronto ══
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrapFromUrl);
  } else {
    _bootstrapFromUrl();
  }

  window.Modules = window.Modules || {};
  window.Modules.nav = {
    showScreen,
    _navSyncHistory,
    _bootstrapFromUrl
  };
})();

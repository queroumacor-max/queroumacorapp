// modules/screen-hooks.js — wrapper de `showScreen` extraído do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
//
// ⚠️ NÃO auto-executa. app.js ainda tem o wrap original na linha ~8952
// rodando no boot. Se este módulo auto-instalasse, `showScreen` seria
// reembrulhado: o wrap aqui chamaria `_origShowScreen` (que já é o wrap
// do app.js) → chamaria `_origShowScreen` interno → recursão infinita.
//
// Quando a etapa 2 da migração remover o wrap original do app.js, basta
// chamar `window.Modules.screenHooks.install()` no boot pra reativar os
// dispatchers.
//
// Depende de globals do app.js: showScreen, autoDetectRole, loadFeed,
// initLeafletMap, leafletMap, initArchiveButtons.
(function(){
  'use strict';

  function install(){
    if(typeof showScreen !== 'function'){
      console.warn('Modules.screenHooks.install: showScreen não existe');
      return;
    }
    const _origShowScreen = showScreen;
    window.showScreen = function(n, _fromPop){
      _origShowScreen(n, _fromPop);
      if(n === 'myprofile'){
        autoDetectRole();
      }
      if(n === 'feed'){
        loadFeed();
      }
      if(n === 'explore'){
        setTimeout(async () => {
          await initLeafletMap();
          if(leafletMap) leafletMap.invalidateSize();
        }, 200);
      }
      if(n === 'chat'){
        setTimeout(initArchiveButtons, 100);
      }
    };
  }

  window.Modules = window.Modules || {};
  window.Modules.screenHooks = { install };
})();

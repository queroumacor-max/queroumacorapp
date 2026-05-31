// modules/feed-interactions.js — feature "Interações no feed" (curtir, comentar,
// salvar, denunciar, deletar post/story) extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: getSupabase, currentUser, toast,
// appConfirm, handleSbError, escapeHtml, escapeJsArg, showModal,
// closeModals, sharePost, moderateContentAsync, storyGroups,
// currentStoryGroup, currentStoryIndex, closeStoryViewer, loadStories,
// renderCurrentStory.
(function(){
  'use strict';

  // ══ Estado dos menus/modais de post ══
  let _currentOptPostId = null;
  let _currentOptUserId = null;
  let _reportPostId = null;
  let _reportUserId = null;

  // ══ CURTIR ══
  // Anti-double-emit: dedupe via flag por postId. Sem isso, double-click rápido
  // pode disparar 2x o emit de post.liked (UI vira/desvira, mas o handler de
  // notif via Events.on rodaria 2x). O flag protege também contra raça do DB.
  const _liking = Object.create(null);

  async function togglePostLike(btn){
    if(!btn) return;
    const svg = btn.querySelector('svg');
    const postEl = btn.closest('.mpost');
    const postId = postEl ? postEl.dataset.postId : null;
    const isLiked = svg && svg.style.fill === 'var(--p4)';
    if(!svg) return;

    // Toggle UI immediately
    if(isLiked){
      svg.style.fill = 'none';
      svg.style.stroke = 'var(--ink)';
    } else {
      svg.style.fill = 'var(--p4)';
      svg.style.stroke = 'var(--p4)';
    }

    // Update like count in label
    const labelEl = btn.querySelector('.act-label');
    const currentLabel = labelEl ? labelEl.textContent : 'Curtir';
    const countMatch = currentLabel.match(/(\d+)/);
    let currentCount = countMatch ? parseInt(countMatch[1]) : 0;
    currentCount += isLiked ? -1 : 1;
    if(currentCount < 0) currentCount = 0;
    if(labelEl) labelEl.textContent = currentCount > 0 ? 'Curtir · '+currentCount : 'Curtir';
    // Update text below actions
    const likeTextEl = postEl ? postEl.querySelector('div[style*="padding:0 14px 2px"]') : null;
    if(likeTextEl){
      if(currentCount > 0) likeTextEl.textContent = currentCount + ' curtida' + (currentCount>1?'s':'');
      else likeTextEl.style.display = 'none';
    }

    // Save to DB
    if(!postId) return;
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    if(_liking[postId]) return; // dedupe rajada de cliques
    _liking[postId] = true;
    try {
      if(isLiked){
        await sb.from('likes').delete().eq('user_id', currentUser.id).eq('post_id', postId);
      } else {
        const { error } = await sb.from('likes').insert({ user_id: currentUser.id, post_id: postId });
        if(error) throw error;
        // Fluxo principal via Events.post.liked agora; quem precisa de side-
        // effect (notif pro autor, analytics) escuta no bus. Só emite QUANDO
        // o INSERT em likes confirmou — não no flip otimista da UI.
        if(window.Events){
          const postOwnerId = postEl ? postEl.dataset.authorId || null : null;
          window.Events.emit('post.liked', {
            postId: postId,
            postOwnerId: postOwnerId,
            likedByUserId: currentUser.id
          });
        }
      }
    } catch(e){ console.warn('togglePostLike error:', e && e.message || e); }
    finally { delete _liking[postId]; }
  }

  // ══ COMENTAR ══
  function toggleCommentInput(btn){
    if(!btn) return;
    const postEl = btn.closest('.mpost');
    if(!postEl) return;
    let box = postEl.querySelector('.comment-input-box');
    if(box){ box.style.display = box.style.display === 'none' ? 'flex' : 'none'; box.querySelector('input')?.focus(); return; }
    box = document.createElement('div');
    box.className = 'comment-input-box';
    box.style.cssText = 'display:flex;padding:8px 14px 10px;gap:8px;align-items:center;border-top:1px solid var(--border);';
    box.innerHTML = '<input type="text" placeholder="Adicionar comentario..." style="flex:1;border:1px solid var(--border);border-radius:20px;padding:8px 14px;font-size:13px;font-family:DM Sans,sans-serif;outline:none;background:var(--cream);">'
      + '<button onclick="submitComment(this)" style="background:var(--p1);color:#fff;border:none;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Enviar</button>';
    const timeEl = postEl.querySelector('.post-time');
    if(timeEl) postEl.insertBefore(box, timeEl);
    else postEl.appendChild(box);
    box.querySelector('input').focus();
    box.querySelector('input').addEventListener('keydown', function(e){ if(e.key==='Enter') submitComment(box.querySelector('button')); });
  }

  // Guard de double-submit: o botão "Enviar" do comentário pode receber
  // double-click rápido OU dois Enter consecutivos (o keydown listener no
  // input chama submitComment direto, contornando o disabled visual). Usa
  // dataset._loading (compatível com setButtonLoading do Utils) como
  // flag in-flight e devolve o estado no finally.
  async function submitComment(btn){
    if(!btn) return;
    if(btn.dataset._loading) return;
    const box = btn.closest('.comment-input-box');
    if(!box) return;
    const input = box.querySelector('input');
    if(!input) return;
    const text = (input.value || '').trim();
    if(!text) return;
    const postEl = box.closest('.mpost');
    const postId = postEl ? postEl.dataset.postId : null;
    if(!postId || !currentUser) return;
    input.value = '';
    const restoreBtn = setButtonLoading(btn, 'Enviando...');
    const sb = getSupabase();
    if(!sb){ restoreBtn(); return; }
    try {
      const mod = await moderateContentAsync(text, null);
      if (!mod.approved) {
        input.value = text;  // devolve o texto
        toast(mod.severity === 'hard' ? 'Comentário bloqueado pela moderação' : 'Comentário enviado para revisão');
        return;
      }
      const { data: comment, error } = await sb.from('comments').insert({ post_id: postId, user_id: currentUser.id, text: text }).select('id').single();
      if(error || !comment){ toast('Erro ao comentar'); return; }
      // Show comment in UI
      let commentsArea = postEl.querySelector('.comments-area');
      if(!commentsArea){
        commentsArea = document.createElement('div');
        commentsArea.className = 'comments-area';
        commentsArea.style.cssText = 'padding:4px 14px 2px;';
        postEl.insertBefore(commentsArea, box);
      }
      const userName = document.getElementById('myprofile-name')?.textContent || 'Voce';
      const commentDiv = document.createElement('div');
      commentDiv.setAttribute('data-comment-id', comment.id || '');
      commentDiv.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;color:var(--ink);margin-bottom:4px;';
      commentDiv.innerHTML = '<span style="flex:1"><b>'+escapeHtml(userName)+'</b> '+escapeHtml(text)+'</span>'
        + '<span onclick="deleteComment(this,\''+escapeJsArg(comment.id || '')+'\')" style="cursor:pointer;color:var(--muted);font-size:16px;padding:2px 4px;" title="Apagar">&times;</span>';
      commentsArea.appendChild(commentDiv);
    } catch(e){ toast('Erro ao comentar'); console.warn('comment error:', e && e.message || e); }
    finally { restoreBtn(); }
  }

  async function deleteComment(el, commentId){
    if(!currentUser || !commentId) return;
    if(!el) return;
    const sb = getSupabase();
    if(!sb) return;
    const commentEl = el.closest('[data-comment-id]');
    try {
      const { error } = await sb.from('comments').delete().eq('id', commentId);
      if(error){ toast('Erro ao apagar'); return; }
      if(commentEl) commentEl.remove();
    } catch(e){ toast('Erro ao apagar'); console.warn('delete error:', e && e.message || e); }
  }

  // ══ SALVAR POST ══
  async function toggleSavePost(btn){
    const svg = btn.querySelector('svg');
    const postEl = btn.closest('.mpost');
    const postId = postEl ? postEl.dataset.postId : null;
    if(!postId || !currentUser) return;
    const sb = getSupabase();
    if(!sb) return;
    const isSaved = svg.style.fill === 'var(--p1)';
    // Toggle UI immediately
    if(isSaved){
      svg.style.fill = 'none';
      svg.style.stroke = 'var(--ink)';
      toast('Removido dos salvos');
    } else {
      svg.style.fill = 'var(--p1)';
      svg.style.stroke = 'var(--p1)';
      toast('Salvo!');
    }
    // Save to DB
    try {
      if(isSaved){
        await sb.from('saved_posts').delete().eq('user_id', currentUser.id).eq('post_id', postId);
      } else {
        await sb.from('saved_posts').insert({ user_id: currentUser.id, post_id: postId });
      }
    } catch(e){ console.warn('toggleSavePost error:', e && e.message || e); }
  }

  // ══ MENU DE OPÇÕES DO POST ══
  function openPostOpts(postId, userId){
    _currentOptPostId = postId;
    _currentOptUserId = userId;
    const isOwn = currentUser && currentUser.id === userId;
    document.getElementById('opt-delete-post').style.display = isOwn ? 'flex' : 'none';
    showModal('post-opts-modal');
  }

  function shareCurrentPost(){
    if(_currentOptPostId) sharePost(_currentOptPostId);
  }

  function saveCurrentPost(){
    const postEl = document.querySelector('.mpost[data-post-id="'+_currentOptPostId+'"]');
    if(postEl){
      const saveBtn = postEl.querySelector('.save-btn');
      if(saveBtn) toggleSavePost(saveBtn);
    } else { toast('Salvo!'); }
  }

  function copyCurrentPostLink(){
    const url = window.location.origin + '/?post=' + _currentOptPostId;
    navigator.clipboard.writeText(url).then(()=>toast('Link copiado!')).catch(()=>toast('Erro ao copiar'));
  }

  async function deleteCurrentPost(){
    if(!_currentOptPostId || !currentUser) return;
    if(!(await appConfirm('Tem certeza que deseja deletar este post?', { okLabel:'Deletar' }))) return;
    const sb = getSupabase();
    if(!sb) return;
    try {
      // Delete related data first
      await Promise.all([
        sb.from('likes').delete().eq('post_id', _currentOptPostId),
        sb.from('comments').delete().eq('post_id', _currentOptPostId),
        sb.from('saved_posts').delete().eq('post_id', _currentOptPostId)
      ]);
      // Delete the post
      const { error } = await sb.from('posts').delete().eq('id', _currentOptPostId).eq('user_id', currentUser.id);
      if(handleSbError(error, 'Erro ao deletar')) return;
      // Remove from DOM
      const postEl = document.querySelector('.mpost[data-post-id="'+_currentOptPostId+'"]');
      if(postEl) postEl.remove();
      toast('Post deletado!');
      _currentOptPostId = null;
    } catch(e){ toast('Erro ao deletar'); console.warn('post delete error:', e && e.message || e); }
  }

  // ══ DENUNCIAR POST ══
  function reportPost(){
    if(!currentUser){ toast('Faça login para denunciar'); return; }
    if(!_currentOptPostId){ toast('Post não encontrado'); return; }
    _reportPostId = _currentOptPostId;
    _reportUserId = _currentOptUserId;
    showModal('report-reason-modal');
  }

  // Guard de double-submit: o modal "Denunciar" tem 4-5 botões de motivo e
  // double-click rápido em um deles (ou click em dois motivos antes do modal
  // fechar) gerava 2 reports no DB. Flag de módulo + checagem antes do
  // insert. closeModals() roda imediatamente pra esconder o modal, mas o
  // _reportSubmitting fica true até o insert resolver.
  let _reportSubmitting = false;
  async function submitReport(reason){
    if(_reportSubmitting) return;
    if(!currentUser || !_reportPostId){ closeModals(); toast('Não foi possível enviar a denúncia'); return; }
    const sb = getSupabase();
    if(!sb){ closeModals(); toast('Não foi possível enviar a denúncia'); return; }
    _reportSubmitting = true;
    closeModals();
    try {
      const { error } = await sb.from('reports').insert({
        reporter_id: currentUser.id,
        post_id: _reportPostId,
        target_user_id: _reportUserId || null,
        reason: reason
      });
      if(handleSbError(error, 'Erro ao enviar denúncia')) return;
      toast('Denúncia enviada. Obrigado — nossa equipe vai analisar.');
    } catch(e){
      console.warn('submitReport error:', e && e.message || e);
      toast('Erro ao enviar denúncia');
    } finally {
      _reportPostId = null;
      _reportUserId = null;
      _reportSubmitting = false;
    }
  }

  // ══ DELETAR STORY ══
  async function deleteCurrentStory(){
    if(!currentUser) return;
    const group = storyGroups[currentStoryGroup];
    if(!group || group.user_id !== currentUser.id) return;
    const story = group.stories[currentStoryIndex];
    if(!story) return;
    if(!(await appConfirm('Deletar este story?', { okLabel:'Deletar' }))) return;
    const sb = getSupabase();
    if(!sb) return;
    try {
      const { error } = await sb.from('posts').delete().eq('id', story.id).eq('user_id', currentUser.id);
      if(error){ toast('Erro ao deletar story'); return; }
      // Remove from group
      group.stories.splice(currentStoryIndex, 1);
      if(group.stories.length === 0){
        storyGroups.splice(currentStoryGroup, 1);
        closeStoryViewer();
        loadStories();
      } else {
        if(currentStoryIndex >= group.stories.length) currentStoryIndex = group.stories.length - 1;
        renderCurrentStory();
      }
      toast('Story deletado!');
    } catch(e){ toast('Erro ao deletar story'); console.warn('story delete error:', e && e.message || e); }
  }

  window.Modules = window.Modules || {};
  window.Modules.feedInteractions = {
    togglePostLike,
    toggleCommentInput, submitComment, deleteComment,
    toggleSavePost,
    openPostOpts, shareCurrentPost, saveCurrentPost, copyCurrentPostLink, deleteCurrentPost,
    reportPost, submitReport,
    deleteCurrentStory
  };
})();

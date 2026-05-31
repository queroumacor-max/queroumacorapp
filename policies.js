// policies.js — autorização pura (RBAC + ownership). Decisões locais SEM
// DOM/rede: recebe currentUser + recurso, devolve boolean. Mantém a lógica
// de autz testável e centralizada; call sites legados (_isAdmin/_isPro em
// app.js) seguem funcionando — a migração será gradual.
(function(){
  'use strict'

  // Admin = is_admin true OU role 'admin'. Aceitamos os dois sinais porque
  // o banco grava em colunas diferentes dependendo do path de promoção.
  function isAdmin(user){
    if(!user) return false
    return user.is_admin === true || user.role === 'admin'
  }

  // Edita próprio perfil; admin edita qualquer um (moderação/correção).
  function canEditProfile(user, targetProfile){
    if(!user || !user.id || !targetProfile || !targetProfile.id) return false
    if(user.id === targetProfile.id) return true
    return isAdmin(user)
  }

  // Dono do post sempre pode deletar; admin sempre pode (moderação).
  function canDeletePost(user, post){
    if(!user || !user.id || !post) return false
    if(post.user_id && user.id === post.user_id) return true
    return isAdmin(user)
  }

  // Pintor edita seu próprio orçamento ENQUANTO ele está "vivo" — depois
  // que o cliente aceitou/recusou/concluiu, o orçamento vira histórico
  // imutável (auditoria e contagem de status no painel do cliente).
  function canEditQuote(user, quote){
    if(!user || !user.id || !quote) return false
    if(user.id !== quote.painter_id) return false
    const finais = ['aceito', 'recusado', 'concluido']
    if(finais.indexOf(quote.status) !== -1) return false
    return true
  }

  // Só o pintor avaliado pode responder à própria review. Admin NÃO
  // responde em nome do pintor (seria forjar fala alheia).
  function canReplyToReview(user, review, painterId){
    if(!user || !user.id || !painterId) return false
    return user.id === painterId
  }

  // Moderação (remover post, banir, esconder review) é só admin.
  function canModerateContent(user){
    return isAdmin(user)
  }

  // Features PRO: liberadas para assinantes PRO e para admins (admin
  // testa/dá suporte sem precisar de PRO próprio).
  function canSeeProFeature(user){
    if(!user) return false
    if(user.is_pro === true) return true
    return isAdmin(user)
  }

  // Não pode seguir a si mesmo, e ambos os ids precisam existir.
  function canFollowUser(user, targetUserId){
    if(!user || !user.id) return false
    if(!targetUserId) return false
    if(user.id === targetUserId) return false
    return true
  }

  // Criar post exige apenas estar logado. Moderação posterior decide
  // se o post fica visível (status approved/pending no banco).
  function canCreatePost(user){
    if(!user || !user.id) return false
    return true
  }

  // Mensageria exige perfil minimamente preenchido — sem nome o
  // destinatário não consegue identificar quem está falando.
  function canSendMessage(user){
    if(!user || !user.id) return false
    const nome = user.name || user.display_name || user.tag || user.username
    if(!nome) return false
    return true
  }

  // Painel admin é estritamente para admins.
  function canViewAdminPanel(user){
    return isAdmin(user)
  }

  // Utility pra usar nos call sites: lança erro genérico se não autorizado.
  // Quando errors.js (em paralelo) expuser AuthorizationError, dá pra
  // trocar pra throw new AuthorizationError(...) aqui sem mexer nos calls.
  function requireOrThrow(allowed, message){
    if(!allowed) throw new Error(message || 'Não autorizado')
  }

  window.Policies = {
    canEditProfile: canEditProfile,
    canDeletePost: canDeletePost,
    canEditQuote: canEditQuote,
    canReplyToReview: canReplyToReview,
    canModerateContent: canModerateContent,
    canSeeProFeature: canSeeProFeature,
    canFollowUser: canFollowUser,
    canCreatePost: canCreatePost,
    canSendMessage: canSendMessage,
    canViewAdminPanel: canViewAdminPanel,
    requireOrThrow: requireOrThrow
  }
})()

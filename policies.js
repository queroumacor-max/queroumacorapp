// @ts-check
// policies.js — autorização pura (RBAC + ownership). Decisões locais SEM
// DOM/rede: recebe currentUser + recurso, devolve boolean. Mantém a lógica
// de autz testável e centralizada; call sites legados (_isAdmin/_isPro em
// app.js) seguem funcionando — a migração será gradual.

/**
 * @typedef {Object} PolicyUser
 * @property {string} [id]
 * @property {boolean} [is_admin]
 * @property {boolean} [is_pro]
 * @property {string} [role]
 * @property {string} [name]
 * @property {string} [display_name]
 * @property {string} [tag]
 * @property {string} [username]
 */

(function(){
  'use strict'

  // Admin = is_admin true OU role 'admin'. Aceitamos os dois sinais porque
  // o banco grava em colunas diferentes dependendo do path de promoção.
  /**
   * @param {PolicyUser | null | undefined} user
   * @returns {boolean}
   */
  function isAdmin(user){
    if(!user) return false
    return user.is_admin === true || user.role === 'admin'
  }

  // Edita próprio perfil; admin edita qualquer um (moderação/correção).
  /**
   * @param {PolicyUser | null | undefined} user
   * @param {{ id?: string } | null | undefined} targetProfile
   * @returns {boolean}
   */
  function canEditProfile(user, targetProfile){
    if(!user || !user.id || !targetProfile || !targetProfile.id) return false
    if(user.id === targetProfile.id) return true
    return isAdmin(user)
  }

  // Dono do post sempre pode deletar; admin sempre pode (moderação).
  /**
   * @param {PolicyUser | null | undefined} user
   * @param {{ user_id?: string } | null | undefined} post
   * @returns {boolean}
   */
  function canDeletePost(user, post){
    if(!user || !user.id || !post) return false
    if(post.user_id && user.id === post.user_id) return true
    return isAdmin(user)
  }

  // Pintor edita seu próprio orçamento ENQUANTO ele está "vivo" — depois
  // que o cliente aceitou/recusou/concluiu, o orçamento vira histórico
  // imutável (auditoria e contagem de status no painel do cliente).
  /**
   * @param {PolicyUser | null | undefined} user
   * @param {{ painter_id?: string, status?: string } | null | undefined} quote
   * @returns {boolean}
   */
  function canEditQuote(user, quote){
    if(!user || !user.id || !quote) return false
    if(user.id !== quote.painter_id) return false
    const finais = ['aceito', 'recusado', 'concluido']
    if(finais.indexOf(quote.status || '') !== -1) return false
    return true
  }

  // Só o pintor avaliado pode responder à própria review. Admin NÃO
  // responde em nome do pintor (seria forjar fala alheia).
  /**
   * @param {PolicyUser | null | undefined} user
   * @param {unknown} _review
   * @param {string | null | undefined} painterId
   * @returns {boolean}
   */
  function canReplyToReview(user, _review, painterId){
    if(!user || !user.id || !painterId) return false
    return user.id === painterId
  }

  // Moderação (remover post, banir, esconder review) é só admin.
  /**
   * @param {PolicyUser | null | undefined} user
   * @returns {boolean}
   */
  function canModerateContent(user){
    return isAdmin(user)
  }

  // Features PRO: liberadas para assinantes PRO e para admins (admin
  // testa/dá suporte sem precisar de PRO próprio).
  /**
   * @param {PolicyUser | null | undefined} user
   * @returns {boolean}
   */
  function canSeeProFeature(user){
    if(!user) return false
    if(user.is_pro === true) return true
    return isAdmin(user)
  }

  // Não pode seguir a si mesmo, e ambos os ids precisam existir.
  /**
   * @param {PolicyUser | null | undefined} user
   * @param {string | null | undefined} targetUserId
   * @returns {boolean}
   */
  function canFollowUser(user, targetUserId){
    if(!user || !user.id) return false
    if(!targetUserId) return false
    if(user.id === targetUserId) return false
    return true
  }

  // Criar post exige apenas estar logado. Moderação posterior decide
  // se o post fica visível (status approved/pending no banco).
  /**
   * @param {PolicyUser | null | undefined} user
   * @returns {boolean}
   */
  function canCreatePost(user){
    if(!user || !user.id) return false
    return true
  }

  // Mensageria exige perfil minimamente preenchido — sem nome o
  // destinatário não consegue identificar quem está falando.
  /**
   * @param {PolicyUser | null | undefined} user
   * @returns {boolean}
   */
  function canSendMessage(user){
    if(!user || !user.id) return false
    const nome = user.name || user.display_name || user.tag || user.username
    if(!nome) return false
    return true
  }

  // Painel admin é estritamente para admins.
  /**
   * @param {PolicyUser | null | undefined} user
   * @returns {boolean}
   */
  function canViewAdminPanel(user){
    return isAdmin(user)
  }

  // Utility pra usar nos call sites: lança erro genérico se não autorizado.
  // Quando errors.js (em paralelo) expuser AuthorizationError, dá pra
  // trocar pra throw new AuthorizationError(...) aqui sem mexer nos calls.
  /**
   * @param {boolean} allowed
   * @param {string} [message]
   * @returns {void}
   */
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

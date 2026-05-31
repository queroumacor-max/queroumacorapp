// db.js — fachada fina sobre o Supabase pra centralizar queries repetidas.
// Não substitui as call sites existentes; vive em paralelo a app.js/head.js
// pra que migrações futuras sejam graduais. Tudo pendurado em window.DB.
(function(){
  'use strict'

  // getSupabase() mora em head.js, que carrega ANTES daqui. Mesmo assim,
  // resolvemos lazy: capturar no parse arrisca pegar uma referência antiga
  // se head.js trocar o client (recriação em re-login, por exemplo).
  function _sb(){
    if(typeof getSupabase !== 'function') return null
    try { return getSupabase() } catch(e){ return null }
  }

  // Mesmo default usado por fetchPublicProfiles em app.js. Mantém-se em sync
  // manualmente — se a view profiles_public ganhar/perder coluna, atualizar
  // aqui também. Lista enxuta de propósito (perfis carregam cart/JSON pesados).
  const PUBLIC_COLS = 'id, name, tag, avatar_url, role, user_type'

  // Espelha POST_COLS de app.js. Idem: alterar lá implica alterar aqui.
  const POST_COLS = 'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at'

  // ─── profiles ──────────────────────────────────────────────────────────
  async function getById(id, cols){
    const sb = _sb()
    if(!sb || !id) return null
    try {
      // maybeSingle() não estoura se a linha não existir (single() estoura).
      // Pra um getter público, ausência é resultado válido, não erro.
      const r = await sb.from('profiles').select(cols || PUBLIC_COLS).eq('id', id).maybeSingle()
      if(r.error){ console.warn('DB.profiles.getById:', r.error.message); return null }
      return r.data || null
    } catch(e){
      console.warn('DB.profiles.getById exc:', e && e.message || e)
      return null
    }
  }

  async function getMany(ids, cols){
    if(!ids || !ids.length) return []
    const useCols = cols || PUBLIC_COLS
    // Delegação: fetchPublicProfiles em app.js já trata o fallback
    // profiles_public → profiles. Reaproveitar evita drift de comportamento.
    if(typeof fetchPublicProfiles === 'function'){
      const sb = _sb()
      if(!sb) return []
      try { return await fetchPublicProfiles(sb, ids, useCols) || [] }
      catch(e){ console.warn('DB.profiles.getMany delegate:', e && e.message); return [] }
    }
    const sb = _sb()
    if(!sb) return []
    try {
      const r = await sb.from('profiles').select(useCols).in('id', ids)
      if(r.error){ console.warn('DB.profiles.getMany:', r.error.message); return [] }
      return r.data || []
    } catch(e){
      console.warn('DB.profiles.getMany exc:', e && e.message || e)
      return []
    }
  }

  // ─── follows ───────────────────────────────────────────────────────────
  async function countFollowers(userId){
    const sb = _sb()
    if(!sb || !userId) return 0
    try {
      const r = await sb.from('follows').select('*', { count:'exact', head:true }).eq('following_id', userId)
      return r.count || 0
    } catch(e){ console.warn('DB.follows.countFollowers:', e && e.message); return 0 }
  }

  async function countFollowing(userId){
    const sb = _sb()
    if(!sb || !userId) return 0
    try {
      const r = await sb.from('follows').select('*', { count:'exact', head:true }).eq('follower_id', userId)
      return r.count || 0
    } catch(e){ console.warn('DB.follows.countFollowing:', e && e.message); return 0 }
  }

  async function listFollowingIds(userId){
    const sb = _sb()
    if(!sb || !userId) return []
    try {
      const { data, error } = await sb.from('follows').select('following_id').eq('follower_id', userId)
      if(error){ console.warn('DB.follows.listFollowingIds:', error.message); return [] }
      return (data || []).map(f => f.following_id)
    } catch(e){
      console.warn('DB.follows.listFollowingIds exc:', e && e.message)
      return []
    }
  }

  // Lista de quem segue um usuário (espelho de listFollowingIds).
  async function listFollowerIds(userId){
    const sb = _sb()
    if(!sb || !userId) return []
    try {
      const { data, error } = await sb.from('follows').select('follower_id').eq('following_id', userId)
      if(error){ console.warn('DB.follows.listFollowerIds:', error.message); return [] }
      return (data || []).map(f => f.follower_id)
    } catch(e){
      console.warn('DB.follows.listFollowerIds exc:', e && e.message)
      return []
    }
  }

  async function isFollowing(followerId, followingId){
    const sb = _sb()
    if(!sb || !followerId || !followingId) return false
    try {
      const r = await sb.from('follows').select('id')
        .eq('follower_id', followerId).eq('following_id', followingId).limit(1)
      if(r.error){ console.warn('DB.follows.isFollowing:', r.error.code, r.error.message); return false }
      return !!(r.data && r.data.length > 0)
    } catch(e){
      console.warn('DB.follows.isFollowing exc:', e && e.message)
      return false
    }
  }

  async function follow(followerId, followingId){
    const sb = _sb()
    if(!sb) return { ok:false, code:'no-client', message:'Supabase client indisponível' }
    if(!followerId || !followingId) return { ok:false, code:'bad-args', message:'ids obrigatórios' }
    try {
      const { error } = await sb.from('follows')
        .insert({ follower_id:followerId, following_id:followingId })
      // ANTI-PATTERN do bug 23505: o insert pode "voltar OK" e ainda assim a
      // linha NÃO existir. Triggers AFTER INSERT em follows (ex.: créditos
      // em points com UNIQUE em source+reference_id) podem dar ROLLBACK
      // devolvendo 23505 — mas o erro é de OUTRA tabela, então o frontend
      // pode interpretar "duplicate follow" e pintar UI otimista de
      // "Seguindo". Por isso confirmamos com SELECT antes de dizer ok.
      const { data: chk } = await sb.from('follows').select('id')
        .eq('follower_id', followerId).eq('following_id', followingId).limit(1)
      if(chk && chk.length > 0) return { ok:true }
      const code = (error && error.code) || 'no-row'
      const message = (error && error.message) || 'Follow não persistiu'
      return { ok:false, code, message }
    } catch(e){
      return { ok:false, code:'exception', message: (e && e.message) || String(e) }
    }
  }

  async function unfollow(followerId, followingId){
    const sb = _sb()
    if(!sb) return { ok:false, code:'no-client', message:'Supabase client indisponível' }
    if(!followerId || !followingId) return { ok:false, code:'bad-args', message:'ids obrigatórios' }
    try {
      const { error } = await sb.from('follows').delete()
        .eq('follower_id', followerId).eq('following_id', followingId)
      if(error) return { ok:false, code: error.code || 'delete-error', message: error.message || '' }
      return { ok:true }
    } catch(e){
      return { ok:false, code:'exception', message: (e && e.message) || String(e) }
    }
  }

  // ─── posts ─────────────────────────────────────────────────────────────
  // Retorna {data, error} cru — o caller (loadPosts/loadStories) já tem
  // tratamento de erro/timeout próprio; embrulhar aqui esconderia info.

  // Conta posts não-stories de um usuário (usado em stats do perfil próprio
  // e no openUserProfile de outro). Default: exclui stories pra bater com
  // o card de "posts" do perfil estilo IG. opts.includeStories pra incluir.
  async function countByUser(userId, opts){
    const sb = _sb()
    if(!sb || !userId) return 0
    try {
      let q = sb.from('posts').select('*', { count:'exact', head:true }).eq('user_id', userId)
      if(!opts || !opts.includeStories) q = q.neq('media_type', 'story')
      const r = await q
      return r.count || 0
    } catch(e){ console.warn('DB.posts.countByUser:', e && e.message); return 0 }
  }

  // Lista posts de UM usuário (portfolio). Retorna a query pra o caller
  // awaitar e ler {data, error}. opts:
  //   limit         — default 60
  //   cols          — default POST_COLS
  //   onlyApproved  — adiciona filtro de status (default false; portfolio
  //                   próprio mostra pending, perfil alheio só approved)
  //   includeStories — default false
  function getByUser(userId, opts){
    opts = opts || {}
    const sb = _sb()
    if(!sb) return Promise.resolve({ data:[], error:{ message:'no-client' } })
    const cols = opts.cols || POST_COLS
    const limit = opts.limit || 60
    let q = sb.from('posts').select(cols).eq('user_id', userId)
    if(!opts.includeStories) q = q.neq('media_type', 'story')
    if(opts.onlyApproved) q = q.or('status.eq.approved,status.is.null')
    q = q.order('created_at', { ascending:false }).limit(limit)
    return q
  }

  function getFeedPosts(opts){
    opts = opts || {}
    const sb = _sb()
    if(!sb) return Promise.resolve({ data:[], error:{ message:'no-client' } })
    const cols = opts.cols || POST_COLS
    const offset = opts.offset || 0
    const limit = opts.limit || 30
    const feedIds = opts.feedIds || []
    let q = sb.from('posts').select(cols).neq('media_type', 'story')
    // status nulo = posts antigos pré-moderação; mantemos compat aceitando ambos.
    q = q.or('status.eq.approved,status.is.null')
    if(feedIds.length > 0) q = q.in('user_id', feedIds)
    q = q.order('created_at', { ascending:false }).range(offset, offset + limit - 1)
    return q
  }

  function getStories(opts){
    opts = opts || {}
    const sb = _sb()
    if(!sb) return Promise.resolve({ data:[], error:{ message:'no-client' } })
    const cols = opts.cols || POST_COLS
    const feedIds = opts.feedIds || []
    // Default 24h pra bater com o comportamento estilo IG já em produção.
    const sinceISO = opts.sinceISO || new Date(Date.now() - 24*60*60*1000).toISOString()
    const limit = opts.limit || 100
    let q = sb.from('posts').select(cols).eq('media_type', 'story')
    q = q.or('status.eq.approved,status.is.null').not('media_url', 'is', null)
    if(feedIds.length > 0) q = q.in('user_id', feedIds)
    q = q.gte('created_at', sinceISO).order('created_at', { ascending:true }).limit(limit)
    return q
  }

  window.DB = {
    profiles: { getById, getMany, PUBLIC_COLS },
    follows: { countFollowers, countFollowing, listFollowingIds, listFollowerIds, isFollowing, follow, unfollow },
    posts: { countByUser, getByUser, getFeedPosts, getStories, COLS: POST_COLS }
  }
})()

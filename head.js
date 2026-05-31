const SUPABASE_URL = 'https://uwqebaqweehiljsqkifm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cWViYXF3ZWVoaWxqc3FraWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjYzMjgsImV4cCI6MjA4OTgwMjMyOH0.yp-z4iMifiOV3ftLVIHOFEQBLcMBdU8VFok7VKlSFg8';
let _supabase = null;
let currentUser = null;

function getSupabase() {
  if (!_supabase && window.supabase) {
    _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// Mostra erro amigável pro usuário + log técnico no console
function showError(ctx, err, fallback) {
  const msg = (err && err.message) || String(err || '');
  console.warn('['+ctx+']', msg);
  if (typeof reportError === 'function') {
    reportError({ type: 'manual', msg: msg, ctx: ctx });
  }
  if (typeof toast === 'function') {
    toast(fallback || 'Algo deu errado. Tente de novo.');
  }
}
window.showError = showError;

// Wrapper para await que mapeia erro em showError automaticamente.
// Uso: const data = await safeAwait(sb.from('x').select(), 'loadX', 'Erro ao carregar');
// Retorna { data, error } do Supabase em caso de sucesso, ou null em caso de exceção.
// Se a promise resolve com { error } (padrão Supabase), também dispara showError.
async function safeAwait(promise, ctx, fallback) {
  try {
    const res = await promise;
    if (res && res.error) {
      showError(ctx, res.error, fallback);
      return null;
    }
    return res;
  } catch (e) {
    showError(ctx, e, fallback);
    return null;
  }
}
window.safeAwait = safeAwait;

// ═══════ CLOUDFLARE IMAGE RESIZING ═══════
// Roteia URLs de imagem externa (Supabase Storage, ui-avatars, etc.) através
// de /cdn-cgi/image/{opts}/{url-crua} pra ganhar AVIF/WebP automático + resize
// no edge do Cloudflare. Reduz bandwidth do Supabase Storage (50GB/mês no Pro).
//
// IMPORTANTE: feature flag default OFF. Ligar SÓ depois de habilitar
// "Image Resizing" no dashboard do Cloudflare Pages (Settings → Speed).
// Caso contrário /cdn-cgi/image/... retorna 404 e quebra todas as imagens.
//
// Pra ligar em produção: defina window.CF_IMG_ENABLED = true antes de
// app.js rodar (ou via <script> no <head>).
window.CF_IMG_ENABLED = window.CF_IMG_ENABLED || false;

/**
 * @param {string|null|undefined} url
 * @param {{ w?: number, q?: number, fit?: 'cover'|'contain'|'scale-down' }} [opts]
 * @returns {string}
 */
function cfImg(url, opts) {
  if (!url) return '';
  if (!window.CF_IMG_ENABLED) return url;
  // Data URLs (SVG inline de avatares) passam direto — não há o que otimizar.
  if (/^data:/i.test(url)) return url;
  opts = opts || {};
  // Same-origin: Pages serve direto, sem rerotear.
  try {
    const u = new URL(url, window.location.origin);
    if (u.hostname === window.location.hostname) return url;
    // Allowlist: Cloudflare Image Resizing só aceita origens configuradas
    // como permitidas no dashboard. Pra evitar 404 silencioso, só roteia
    // o que sabemos que está autorizado (Supabase Storage do projeto).
    // ui-avatars.com, gravatar, etc. passam direto.
    const isSupabaseStorage = /\.supabase\.co$/i.test(u.hostname) && /\/storage\/v\d+\/object\//.test(u.pathname);
    if (!isSupabaseStorage) return url;
  } catch (_) { return url; }
  const params = [];
  if (opts.w)   params.push('width=' + opts.w);
  params.push('quality=' + (opts.q != null ? opts.q : 85));
  params.push('fit=' + (opts.fit || 'scale-down'));
  params.push('format=auto');
  // Cloudflare espera URL crua (NÃO encodada) depois das opções.
  return '/cdn-cgi/image/' + params.join(',') + '/' + url;
}
window.cfImg = cfImg;

// ═══════ OBSERVABILITY (lightweight) ═══════
// Captura erros não-tratados + Web Vitals e envia pra /api/log-error.
// Buffer + batch envio pra não bloquear UI.
const _obsBuffer = [];
let _obsFlushScheduled = false;
function _obsScheduleFlush() {
  if (_obsFlushScheduled) return;
  _obsFlushScheduled = true;
  setTimeout(() => {
    _obsFlushScheduled = false;
    if (!_obsBuffer.length) return;
    const batch = _obsBuffer.splice(0, _obsBuffer.length);
    batch.forEach(payload => {
      try {
        const data = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/log-error', new Blob([data], { type: 'application/json' }));
        } else {
          fetch('/api/log-error', { method: 'POST', body: data, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
        }
      } catch {}
    });
  }, 3000);
}
function reportError(payload) {
  if (!payload) return;
  payload.url = payload.url || (location && location.href) || '';
  payload.ua = navigator.userAgent || '';
  _obsBuffer.push(payload);
  _obsScheduleFlush();
}
window.reportError = reportError;

// Erros não-tratados
window.addEventListener('error', (e) => {
  if (!e || !e.message) return;
  reportError({ type: 'error', msg: e.message, stack: e.error && e.error.stack || '', ctx: 'window.onerror' });
}, { capture: true });

// Promises não-tratadas
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  reportError({ type: 'unhandledrejection', msg: (r && r.message) || String(r || 'unknown'), stack: r && r.stack || '', ctx: 'unhandledrejection' });
}, { capture: true });

// Web Vitals (LCP, CLS, INP) — simples, sem lib
try {
  // LCP — Largest Contentful Paint
  new PerformanceObserver((list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (last) reportError({ type: 'web-vital', metric: 'LCP', value: Math.round(last.startTime), ctx: '' });
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  // CLS — Cumulative Layout Shift
  let clsValue = 0;
  new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      if (!entry.hadRecentInput) clsValue += entry.value;
    });
  }).observe({ type: 'layout-shift', buffered: true });
  // Reporta CLS no `pagehide`
  window.addEventListener('pagehide', () => {
    if (clsValue > 0) reportError({ type: 'web-vital', metric: 'CLS', value: +clsValue.toFixed(3), ctx: '' });
  });

  // INP — Interaction to Next Paint
  let maxINP = 0;
  new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      if (entry.duration > maxINP) maxINP = entry.duration;
    });
  }).observe({ type: 'event', durationThreshold: 40, buffered: true });
  window.addEventListener('pagehide', () => {
    if (maxINP > 0) reportError({ type: 'web-vital', metric: 'INP', value: Math.round(maxINP), ctx: '' });
  });
} catch { /* PerformanceObserver não suportado */ }

// Pageview (analytics rudimentar)
reportError({ type: 'pageview', msg: 'visit', ctx: location.pathname });
// ═══════ /OBSERVABILITY ═══════

// ─── Helpers utilitários (B2 DRY refactor) ─────────────────────────────────

// avatarUrl: gera avatar SVG inline com as iniciais do nome. Antes
// dependia de ui-avatars.com (serviço externo) — se o DNS da rede do
// usuário bloqueia, todos os avatares ficavam quebrados. Agora é
// 100% client-side, zero round-trip, funciona offline.
function avatarUrl(name, size){
  const s = size || 96;
  const raw = String(name || '?').trim();
  // Extrai iniciais: "João Pedro" → "JP", "@biateste" → "BI"
  const clean = raw.replace(/^@/, '').replace(/[^\p{L}\p{N}\s]/gu, '');
  const parts = clean.split(/\s+/).filter(Boolean);
  let initials = '';
  if(parts.length >= 2) initials = (parts[0][0] + parts[1][0]);
  else if(parts.length === 1) initials = parts[0].slice(0, 2);
  else initials = '?';
  initials = initials.toUpperCase().slice(0, 2);
  // Cor determinística baseada no nome (hash simples → hue 0-360)
  let hash = 0;
  for(let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const bg = `hsl(${hue},55%,80%)`;
  const fg = `hsl(${hue},45%,25%)`;
  // SVG inline. font-size = 42% do raio (s/2 * 0.42 * 2 = s * 0.42).
  const fontSize = Math.round(s * 0.42);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 ' + s + ' ' + s + '">'
    + '<rect width="' + s + '" height="' + s + '" fill="' + bg + '"/>'
    + '<text x="50%" y="50%" dy=".1em" text-anchor="middle" dominant-baseline="middle" '
    + 'font-family="DM Sans, system-ui, sans-serif" font-weight="700" font-size="' + fontSize + '" fill="' + fg + '">'
    + initials.replace(/[<>&]/g, '') + '</text></svg>';
  // encodeURIComponent + decodeURIComponent dance pra escape correto.
  // Não usa base64 (btoa quebra em chars não-Latin1 como acentos nas iniciais).
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
window.avatarUrl = avatarUrl;

// displayName: nome amigável pra UI. Se profile.name é só um email puro
// (sem nome real), mostra só a parte antes do @. Cai pra tag se nada.
function displayName(profile){
  const raw = String((profile && profile.name) || '').trim();
  if(!raw) return profile && profile.tag ? '@' + profile.tag : 'Sem nome';
  const m = raw.match(/^([^@\s]+)@[^@\s]+\.[A-Za-z]{2,}$/);
  if(m) return m[1];
  return raw;
}
window.displayName = displayName;

// avatarImgTag: <img> de avatar com fallback automático pro SVG inline
// se a URL principal falhar (caso típico: profile.avatar_url aponta pra
// arquivo Supabase Storage que não existe mais). Anti-loop via dataset.fb.
function avatarImgTag(profile, size){
  const s = size || 96;
  const av = avatarOf(profile, s);
  const fb = avatarUrl(displayName(profile), s);
  const avEsc = String(av).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fbEsc = String(fb).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return '<img src="' + avEsc + '" alt="" loading="lazy" decoding="async"'
    + ' onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src=\'' + fbEsc + '\'}">';
}
window.avatarImgTag = avatarImgTag;

// safeUrl: valida que a URL é http(s):// e devolve string HTML-escapada,
// pronta pra interpolar em <a href=...>. Bloqueia javascript:, data:,
// vbscript:, file:, etc. Retorna '' se inválida. Defense-in-depth.
function safeUrl(s){
  const v = String(s == null ? '' : s).trim();
  if (!/^https?:\/\//i.test(v)) return '';
  return v.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
window.safeUrl = safeUrl;

// avatarOf: lê profile.avatar_url, cai pra avatarUrl(profile.name) se não tiver.
// Defense-in-depth: só aceita https:// ou data:image/ (já tem CHECK no DB,
// mas se algum dado legado vazou, ignora qualquer outro scheme).
// Quando CF_IMG_ENABLED, encaminha a URL final via cfImg() pra resize+AVIF/WebP
// no edge — corta bandwidth de avatares (item de maior frequência no feed).
function avatarOf(profile, size){
  const s = size || 96;
  if (profile && typeof profile.avatar_url === 'string' && profile.avatar_url) {
    const url = profile.avatar_url;
    if (/^data:image\//i.test(url)) return url; // inline, nada a otimizar
    if (/^https:\/\//i.test(url)) return cfImg(url, { w: s, fit: 'cover' });
    console.warn('avatarOf: URL inválida ignorada');
  }
  return cfImg(avatarUrl(displayName(profile), s), { w: s, fit: 'cover' });
}
window.avatarOf = avatarOf;

// ─── App dialogs (appConfirm / appPrompt / appAlert) ───────────────────────
// Substituem confirm/prompt/alert nativos do navegador pra manter identidade
// visual. Retornam Promise: appConfirm→bool, appPrompt→string|null, appAlert→void.
// Defaults pra cancelar: clique no backdrop, ESC, ou botão cancelar.
function _appDialog(opts){
  return new Promise(resolve => {
    let resolved = false;
    const done = (val) => { if(resolved) return; resolved = true; try { document.body.removeChild(ov); } catch(_){} document.removeEventListener('keydown', onKey); resolve(val); };
    const ov = document.createElement('div');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.5);display:flex;align-items:flex-end;justify-content:center;animation:appDlgFadeIn .15s ease-out;';
    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:#fff;width:100%;max-width:520px;border-radius:18px 18px 0 0;padding:20px 18px 22px;box-shadow:0 -6px 24px rgba(0,0,0,.18);font-family:\'DM Sans\',sans-serif;animation:appDlgSlideUp .22s ease-out;box-sizing:border-box;';
    if(!document.getElementById('app-dlg-anim')){
      const st = document.createElement('style');
      st.id = 'app-dlg-anim';
      st.textContent = '@keyframes appDlgFadeIn{from{opacity:0}to{opacity:1}}@keyframes appDlgSlideUp{from{transform:translateY(20px);opacity:.6}to{transform:translateY(0);opacity:1}}';
      document.head.appendChild(st);
    }
    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:14.5px;color:#1a1a2e;line-height:1.5;white-space:pre-wrap;margin-bottom:16px;';
    msg.textContent = opts.message || '';
    sheet.appendChild(msg);
    let input = null;
    if(opts.type === 'prompt'){
      input = document.createElement('input');
      input.type = 'text';
      input.value = opts.initial || '';
      input.placeholder = opts.placeholder || '';
      input.maxLength = 500;
      input.style.cssText = 'width:100%;padding:11px 12px;border:1.5px solid #ddd;border-radius:10px;font-size:15px;font-family:\'DM Sans\',sans-serif;outline:none;margin-bottom:16px;box-sizing:border-box;';
      input.onkeydown = (e) => { if(e.key === 'Enter'){ e.preventDefault(); done(input.value); } };
      sheet.appendChild(input);
    }
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';
    if(opts.type !== 'alert'){
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = opts.cancelLabel || 'Cancelar';
      cancel.style.cssText = 'flex:1;padding:13px;background:transparent;color:#1a1a2e;border:1.5px solid #ddd;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:\'DM Sans\',sans-serif;';
      cancel.onclick = () => done(opts.type === 'prompt' ? null : false);
      btnRow.appendChild(cancel);
    }
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = opts.okLabel || 'OK';
    ok.style.cssText = 'flex:1.2;padding:13px;background:linear-gradient(135deg,#ff6b35,#8338ec);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:\'DM Sans\',sans-serif;';
    ok.onclick = () => done(opts.type === 'prompt' ? (input ? input.value : '') : true);
    btnRow.appendChild(ok);
    sheet.appendChild(btnRow);
    ov.appendChild(sheet);
    ov.addEventListener('click', (e) => { if(e.target === ov) done(opts.type === 'prompt' ? null : false); });
    const onKey = (e) => { if(e.key === 'Escape') done(opts.type === 'prompt' ? null : false); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    setTimeout(() => { (input || ok).focus(); }, 80);
  });
}
function appConfirm(message, opts){ return _appDialog({ type:'confirm', message, okLabel: opts && opts.okLabel, cancelLabel: opts && opts.cancelLabel }); }
function appPrompt(message, opts){ return _appDialog({ type:'prompt', message, okLabel: opts && opts.okLabel, cancelLabel: opts && opts.cancelLabel, placeholder: opts && opts.placeholder, initial: opts && opts.initial }); }
function appAlert(message, opts){ return _appDialog({ type:'alert', message, okLabel: (opts && opts.okLabel) || 'OK' }); }
window.appConfirm = appConfirm;
window.appPrompt = appPrompt;
window.appAlert = appAlert;

// requireSession: guard pra ações que exigem login. Retorna {sb, user} ou null.
// Quando null, já mostra toast. opts.toast pode ser:
//   - false  -> silencioso
//   - string -> usa essa mensagem
//   - undefined/objeto sem .toast -> usa 'Faça login primeiro'
// Ex.: requireSession() | requireSession({toast:false}) | requireSession('Faça login para salvar')
function requireSession(opts){
  const sb = getSupabase();
  const ok = sb && currentUser;
  if (!ok) {
    let msg = 'Faça login primeiro';
    if (typeof opts === 'string') msg = opts;
    else if (opts && opts.toast === false) msg = null;
    else if (opts && typeof opts.toast === 'string') msg = opts.toast;
    if (msg && typeof toast === 'function') toast(msg);
    return null;
  }
  return { sb: sb, user: currentUser };
}
window.requireSession = requireSession;

// handleSbError: lida com erro pós-supabase. Retorna true se deve abortar.
// Uso: if (handleSbError(error, 'Salvar')) return;
function handleSbError(error, prefix){
  if (!error) return false;
  const msg = (prefix ? prefix + ': ' : 'Erro: ') + (error.message || error);
  if (typeof toast === 'function') toast(msg);
  return true;
}
window.handleSbError = handleSbError;

// apiPost: chama /api/* com token JWT do Supabase automaticamente. Retorna
// {ok, data, status, error}. Se multipart=true, body deve ser FormData.
// O token é enviado APENAS via header Authorization: Bearer ... (o servidor
// em functions/api/_security.js#getToken aceita ambos, mas mantemos só o
// header pra evitar vazar o JWT em logs de body / proxies que loggam JSON).
async function apiPost(path, body, opts){
  opts = opts || {};
  const multipart = !!opts.multipart;
  const withToken = opts.withToken !== false;
  let headers = {};
  let token = null;
  if (withToken) {
    try {
      const sb = getSupabase();
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session && session.access_token) token = session.access_token;
      }
    } catch(_) { /* ignora — segue sem token */ }
  }
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let payload;
  if (multipart) {
    payload = body;
  } else {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body || {});
  }
  try {
    const r = await fetch(path, { method: 'POST', headers: headers, body: payload });
    let data = null;
    try { data = await r.json(); } catch(_) { /* não-json */ }
    return { ok: r.ok, status: r.status, data: data, error: r.ok ? null : ((data && data.error) || ('HTTP ' + r.status)) };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e && e.message || e) };
  }
}
window.apiPost = apiPost;

// gateProClient: gate de feature PRO no client. Retorna true se pode prosseguir.
// Se não for PRO, mostra toast + abre modal. Uso: if (!gateProClient('IA Vision')) return;
function gateProClient(featureName){
  if (typeof _isPro !== 'undefined' && _isPro) return true;
  if (typeof toast === 'function') toast((featureName || 'Esta função') + ' é exclusiva do Plano PRO ⚡');
  if (typeof showModal === 'function') {
    try { showModal('pro-modal'); } catch(_) {}
  }
  return false;
}
window.gateProClient = gateProClient;

// brl: formata número em R$ brasileiro. Sempre 2 decimais.
function brl(n){
  const v = Number(n) || 0;
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
window.brl = brl;

// dateBR: formata data em DD/MM/AAAA
function dateBR(d){
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '';
    return dt.toLocaleDateString('pt-BR');
  } catch(_) { return ''; }
}
window.dateBR = dateBR;

// dateTimeBR: data + hora
function dateTimeBR(d){
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '';
    return dt.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch(_) { return ''; }
}
window.dateTimeBR = dateTimeBR;

// Mensagens de erro padronizadas + helpers de robustez.
const ERR = {
  NETWORK: 'Sem conexão. Verifique sua internet e tente de novo.',
  AUTH: 'Sessão expirada. Faça login novamente.',
  PERMISSION: 'Você não tem permissão pra essa ação.',
  RATE_LIMIT: 'Muitas tentativas. Aguarde um minuto.',
  GENERIC: 'Algo deu errado. Tente de novo em instantes.'
};
window.ERR = ERR;

async function withErrorHandling(fn, opts){
  opts = opts || {};
  try {
    return await fn();
  } catch (e) {
    const msg = (opts.prefix ? opts.prefix + ': ' : 'Erro: ') + (e && e.message || e);
    if (!opts.silent && typeof toast === 'function') toast(msg);
    console.warn(opts.prefix || 'withErrorHandling', e && e.message || e);
    return opts.fallback != null ? opts.fallback : null;
  }
}
window.withErrorHandling = withErrorHandling;

const _abortMap = new Map();
async function abortableFetch(key, url, opts){
  try {
    const prev = _abortMap.get(key);
    if (prev) { try { prev.abort(); } catch(_){} }
  } catch(_) {}
  const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  if (ac) _abortMap.set(key, ac);
  try {
    const r = await fetch(url, Object.assign({}, opts || {}, ac ? { signal: ac.signal } : {}));
    if (ac && _abortMap.get(key) === ac) _abortMap.delete(key);
    return r;
  } catch (e) {
    if (e && e.name === 'AbortError') return null;
    throw e;
  }
}
window.abortableFetch = abortableFetch;

// Race uma promise contra um timeout. Se estourar, rejeita com Error('timeout').
// Usado pra não deixar o usuário travado no skeleton quando o Supabase / rede
// engasga (queries que penduram pra sempre).
function withTimeout(promise, ms, label){
  ms = ms || 15000;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout' + (label?' '+label:''))), ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}
window.withTimeout = withTimeout;

// Cache curto do perfil do usuário logado. Evita várias queries idênticas
// a 'profiles' no login — loadMyProfileData, refreshProStatus, loadUserState
// e updateMyStoryAvatar disparam quase juntas. Com o dedup do _inflight,
// todas compartilham UMA requisição.
let _myProfileCache = null;
let _myProfileCacheAt = 0;
let _myProfileInflight = null;
async function getMyProfile(force){
  const sb = getSupabase();
  if(!sb || !currentUser) return null;
  if(!force && _myProfileCache && Date.now() - _myProfileCacheAt < 15000) return _myProfileCache;
  if(!force && _myProfileInflight) return _myProfileInflight;
  // Mantém SELECT * — é 1 linha só (~2KB), e múltiplos consumidores leem
  // colunas variadas (cart, seen_stories, business_name, etc). O risco de
  // quebrar algum não compensa o ganho de payload aqui.
  const q = sb.from('profiles').select('*').eq('id', currentUser.id).single();
  _myProfileInflight = withTimeout(q, 12000, 'getMyProfile')
    .then(({ data }) => {
      _myProfileCache = data || null;
      _myProfileCacheAt = Date.now();
      _myProfileInflight = null;
      return _myProfileCache;
    })
    .catch(e => {
      _myProfileInflight = null;
      console.warn('getMyProfile:', e && e.message || e);
      return _myProfileCache;
    });
  return _myProfileInflight;
}
function invalidateMyProfile(){ _myProfileCache = null; _myProfileCacheAt = 0; }

let _feedLoaded = false;

// Defere trabalho não-crítico pro próximo idle do navegador. Usa
// requestIdleCallback quando disponível (Chrome/FF) ou cai pra setTimeout
// 800ms (Safari). Cap de 1500ms timeout pro rIC pra não ficar pendurado
// indefinidamente em aba inativa.
function _deferIdle(fn){
  if(typeof requestIdleCallback === 'function'){
    requestIdleCallback(() => { try { fn(); } catch(e){ console.warn('_deferIdle:', e && e.message); } }, { timeout: 1500 });
  } else {
    setTimeout(() => { try { fn(); } catch(e){ console.warn('_deferIdle:', e && e.message); } }, 800);
  }
}

async function initAuth(_retry) {
  let sb = getSupabase();
  // Tolerância a CDN lento/fallback: aguarda até 6s polling 200ms se supabase-js
  // ainda não carregou (cenário: unpkg.com falhou, fallback jsdelivr ainda baixando)
  if (!sb) {
    const tries = _retry || 0;
    if (tries < 30) {
      setTimeout(() => initAuth(tries + 1), 200);
      return;
    }
    // Após 6s sem supabase: notifica user e desiste
    console.error('Supabase CDN falhou em ambos os endpoints — recarregue a página');
    try {
      const div = document.createElement('div');
      div.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:20px 24px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:99999;font-family:system-ui;text-align:center;max-width:320px;';
      div.innerHTML = '<div style="font-size:42px;margin-bottom:8px;">🌐</div><div style="font-weight:700;margin-bottom:6px;">Conexão instável</div><div style="font-size:13px;color:#666;margin-bottom:14px;">Não conseguimos carregar a base do app. Verifique sua internet e recarregue.</div><button onclick="window.location.reload()" style="padding:10px 20px;background:#ff6b35;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Recarregar</button>';
      document.body.appendChild(div);
    } catch(_){}
    return;
  }

  // Detect password recovery redirect via URL hash (Supabase appends #type=recovery)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const isRecovery = hashParams.get('type') === 'recovery';

  const { data: { session } } = await sb.auth.getSession();

  if (isRecovery) {
    currentUser = session ? session.user : null;
    // Clean the recovery hash from URL without triggering navigation
    history.replaceState(null, '', window.location.pathname + window.location.search);
    // Vai pra tela "casca" /update-password (não o feed) — senão o feed
    // carrega por trás do modal de nova senha, confundindo o usuário.
    showScreen('update-password');
    // Backup: _initUpdatePasswordScreen (chamado por showScreen) já abre o
    // modal; mantemos o setTimeout como rede de segurança caso a sessão
    // ainda esteja propagando no SDK.
    setTimeout(() => { if(typeof showModal === 'function') showModal('reset-pw-modal'); }, 80);
    sb.auth.onAuthStateChange((event, session) => {
      if(event === 'PASSWORD_RECOVERY') return; // already handled above
      currentUser = session ? session.user : null;
      invalidateMyProfile();
      if(currentUser){
        if(typeof loadUserState==='function') loadUserState();
        autoDetectRole();
        refreshProStatus();
        checkAdminEntry();
        if(!_feedLoaded){ _feedLoaded = true; loadFeed(); }
        _deferIdle(() => {
          setupGlobalMsgSubscription();
          setupNotifSubscription();
          setupPipelineSubscription();
        });
      } else {
        _isPro = false; _isAdmin = false; _feedLoaded = false;
        if(_globalMsgSub){ _globalMsgSub.unsubscribe(); _globalMsgSub=null; }
        if(typeof _notifSub !== 'undefined' && _notifSub){ _notifSub.unsubscribe(); _notifSub=null; }
        if(typeof _pipelineSub !== 'undefined' && _pipelineSub){ _pipelineSub.unsubscribe(); _pipelineSub=null; }
      }
    });
    return;
  }

  if (session) {
    currentUser = session.user;
    if(typeof loadUserState==='function') loadUserState();
    showScreen('feed');
    autoDetectRole();
    refreshProStatus();
    checkAdminEntry();
    handleProReturn();
    if(typeof handleCompraReturn==='function') handleCompraReturn();
    // Load feed PRIMEIRO — é o que o usuário vê.
    _feedLoaded = true;
    loadFeed();
    // Sobre 3 WebSockets de realtime são caros pra mobile (handshake +
    // keep-alive). Deferir pra idle time não atrasa a 1ª notificação de
    // forma perceptível e libera CPU/banda pro feed render.
    _deferIdle(() => {
      setupGlobalMsgSubscription();
      setupNotifSubscription();
      setupPipelineSubscription();
    });
  } else {
    loadFeed();
  }
  handleReferralParam();
  sb.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    invalidateMyProfile();
    if(event === 'PASSWORD_RECOVERY'){
      // Vai pra /update-password (não feed) pra não mostrar o feed atrás
      // do modal de nova senha. _initUpdatePasswordScreen abre o modal.
      if(typeof showScreen === 'function') showScreen('update-password');
      setTimeout(() => { if(typeof showModal === 'function') showModal('reset-pw-modal'); }, 80);
      return;
    }
    if(currentUser){
      if(typeof loadUserState==='function') loadUserState();
      autoDetectRole();
      refreshProStatus();
      checkAdminEntry();
      if(!_feedLoaded){ _feedLoaded = true; loadFeed(); }
      _deferIdle(() => {
        setupGlobalMsgSubscription();
        setupNotifSubscription();
        setupPipelineSubscription();
      });
    } else {
      _isPro = false;
      _isAdmin = false;
      _feedLoaded = false;
      if(_globalMsgSub){ _globalMsgSub.unsubscribe(); _globalMsgSub=null; }
      if(typeof _notifSub !== 'undefined' && _notifSub){ _notifSub.unsubscribe(); _notifSub=null; }
      if(typeof _pipelineSub !== 'undefined' && _pipelineSub){ _pipelineSub.unsubscribe(); _pipelineSub=null; }
    }
  });
}
function autoDetectRole(){
  if(!currentUser) return;
  const meta = currentUser.user_metadata || {};
  const userType = meta.user_type || meta.role || 'cliente';
  if(isProfessionalRole(userType)) setMode(userType);
  else setMode('cliente');
  // Load full profile from DB
  loadMyProfileData();
  updateMyStoryAvatar();
}

async function loadMyProfileData(){
  if(!currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  try {
    const prof = await getMyProfile();
    const nameEl = document.getElementById('myprofile-name');
    const subEl = document.getElementById('myprofile-sub');
    const avatarEl = document.querySelector('#screen-feed .ph-avatar img, #screen-feed img[style*="border-radius"]');
    if(prof){
      let name = prof.name || currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'Seu Nome';
      if(name.includes('@')) name = name.split('@')[0];
      name = name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const tag = prof.tag || currentUser.user_metadata?.tag || '';
      const city = [prof.city, prof.state].filter(Boolean).join(', ');
      const _meta = currentUser.user_metadata || {};
      const role = prof.role || prof.user_type || _meta.user_type || _meta.role || 'cliente';
      if(nameEl) nameEl.textContent = name;
      if(subEl){
        const roleLabels = {pintor:'Pintor',grafiteiro:'Grafiteiro/Muralista',automotivo:'Pintor Automotivo',cliente:'Cliente'};
        const roleColors = {pintor:'#ff6b35',grafiteiro:'#8338ec',automotivo:'#2ec4b6',cliente:'rgba(255,255,255,.4)'};
        let subHtml = '';
        if(tag) subHtml += '@' + escapeHtml(tag);
        if(city) subHtml += (subHtml?' · ':'') + escapeHtml(city);
        if(roleLabels[role]){
          subHtml += ' <span style="display:inline-block;background:'+(roleColors[role]||'var(--muted)')+';color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:4px;vertical-align:middle;">'+roleLabels[role]+'</span>';
        }
        subEl.innerHTML = subHtml || 'Configure seu perfil';
      }
      // Update myprofile avatar
      const avatarFallback = avatarUrl(name);
      const avatarSrc = prof.avatar_url || avatarFallback;
      const myAvatar = document.getElementById('myprofile-avatar');
      if(myAvatar){
        myAvatar.onerror = function(){ this.onerror=null; this.src=avatarFallback; };
        myAvatar.src = avatarSrc;
      }
      // Also update story circle avatar
      const storyAv = document.getElementById('my-story-avatar');
      if(storyAv){
        storyAv.onerror = function(){ this.onerror=null; this.src=avatarFallback; };
        storyAv.src = avatarSrc;
      }
      // Set mode based on DB role (only if changed to avoid flash)
      const targetMode = isProfessionalRole(role) ? role : 'cliente';
      if(targetMode !== currentMode) setMode(targetMode);
    } else {
      // Fallback to user_metadata
      const meta = currentUser.user_metadata || {};
      let fallbackName = meta.name || currentUser.email?.split('@')[0] || 'Seu Nome';
      if(fallbackName.includes('@')) fallbackName = fallbackName.split('@')[0];
      fallbackName = fallbackName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if(nameEl) nameEl.textContent = fallbackName;
      if(subEl) subEl.textContent = meta.tag ? '@' + meta.tag : 'Configure seu perfil';
    }
    // Load stats (posts, followers, following)
    loadMyProfileStats();
  } catch(e){ console.warn('loadMyProfileData error:', e && e.message || e); }
}

async function loadMyProfileStats(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  try {
    // 3 contagens em paralelo (antes eram sequenciais — 450ms vs 150ms).
    // Follows passam por DB.follows.* (Fase 1 da refatoração arquitetural).
    const [postsRes, followersCount, followingCount] = await Promise.all([
      sb.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).neq('media_type', 'story'),
      DB.follows.countFollowers(currentUser.id),
      DB.follows.countFollowing(currentUser.id)
    ]);
    const postsEl = document.getElementById('myprofile-posts-count');
    if(postsEl) postsEl.textContent = postsRes.count || 0;
    const followersEl = document.getElementById('myprofile-followers-count');
    if(followersEl) followersEl.textContent = followersCount || 0;
    const followingEl = document.getElementById('myprofile-following-count');
    if(followingEl) followingEl.textContent = followingCount || 0;
  } catch(e){ console.warn('loadMyProfileStats error:', e && e.message || e); }
  loadMyPortfolio();
}

async function loadMyPortfolio(){
  const box = document.getElementById('myprofile-portfolio');
  if(!box) return;
  const sb = getSupabase();
  if(!sb || !currentUser){ box.innerHTML = ''; return; }
  try {
    const { data: posts, error } = await sb.from('posts').select(POST_COLS)
      .eq('user_id', currentUser.id).neq('media_type','story')
      .order('created_at',{ascending:false}).limit(60);
    if(error) throw error;
    if(!posts || posts.length === 0){
      box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px;">Você ainda não publicou trabalhos.<br>Toque em <b>+ Adicionar</b> para postar fotos e vídeos.</div>';
      return;
    }
    box.innerHTML = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;">' + posts.map(p => {
      const cap = escapeHtml(p.caption || '');
      const isVid = p.media_type === 'video';
      const pending = p.status === 'pending';
      const mediaUrl = escapeHtml(p.media_url || '');
      const media = p.media_url
        ? (isVid
            ? `<video src="${mediaUrl}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video>`
            : `<img src="${mediaUrl}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">`)
        : `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:8px;font-size:11px;color:var(--muted);text-align:center;">${cap || 'Post'}</div>`;
      return `<div onclick="showScreen('feed')" style="position:relative;aspect-ratio:1;background:var(--ink);border-radius:8px;overflow:hidden;cursor:pointer;">
        ${media}
        ${isVid ? '<div style="position:absolute;top:6px;right:6px;color:#fff;font-size:13px;text-shadow:0 1px 3px rgba(0,0,0,.6);">▶</div>' : ''}
        ${pending ? '<div style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,.7);color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;">EM ANÁLISE</div>' : ''}
        ${cap ? `<div style="position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font-size:10px;padding:14px 6px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cap}</div>` : ''}
      </div>`;
    }).join('') + '</div>';
  } catch(e){
    console.warn('loadMyPortfolio:', e && e.message || e);
    box.innerHTML = '<div style="text-align:center;color:var(--muted);padding:30px;font-size:13px;">Erro ao carregar portfólio.</div>';
  }
}

async function openFollowersModal(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const list = document.getElementById('followers-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Carregando...</div>';
  showModal('followers-modal');
  try {
    const ids = await DB.follows.listFollowerIds(currentUser.id);
    if(ids.length === 0){
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">Nenhum seguidor ainda</div>';
      return;
    }
    const { data: profs } = await sb.from('profiles_public').select('id, name, tag, avatar_url').in('id', ids);
    list.innerHTML = '';
    (profs||[]).forEach(p => {
      const name = p.name || 'Usuário';
      const tag = p.tag ? '@' + p.tag : '';
      const avatar = avatarOf({ avatar_url: p.avatar_url, name: name });
      list.innerHTML += `<div onclick="hideModal('followers-modal');openUserProfile('${escapeJsArg(p.id)}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${escapeHtml(avatar)}" style="width:100%;height:100%;object-fit:cover"></div>
        <div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div>${tag ? '<div style="font-size:12px;color:var(--muted);">'+escapeHtml(tag)+'</div>' : ''}</div>
      </div>`;
    });
  } catch(e){ list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Erro ao carregar</div>'; }
}

async function openFollowingModal(){
  const sb = getSupabase();
  if(!sb || !currentUser) return;
  const list = document.getElementById('following-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Carregando...</div>';
  showModal('following-modal');
  try {
    const ids = await DB.follows.listFollowingIds(currentUser.id);
    if(ids.length === 0){
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">Você não segue ninguém ainda</div>';
      return;
    }
    const { data: profs } = await sb.from('profiles_public').select('id, name, tag, avatar_url').in('id', ids);
    list.innerHTML = '';
    (profs||[]).forEach(p => {
      const name = p.name || 'Usuário';
      const tag = p.tag ? '@' + p.tag : '';
      const avatar = avatarOf({ avatar_url: p.avatar_url, name: name });
      list.innerHTML += `<div onclick="hideModal('following-modal');openUserProfile('${escapeJsArg(p.id)}')" style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer;">
        <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${escapeHtml(avatar)}" style="width:100%;height:100%;object-fit:cover"></div>
        <div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:700;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(name)}</div>${tag ? '<div style="font-size:12px;color:var(--muted);">'+escapeHtml(tag)+'</div>' : ''}</div>
        <button onclick="event.stopPropagation();toggleFollowFromList(this,'${escapeJsArg(p.id)}')" class="following" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:\'DM Sans\',sans-serif;background:rgba(0,0,0,.05);border:1px solid var(--border);color:var(--ink);">Seguindo</button>
      </div>`;
    });
  } catch(e){ list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">Erro ao carregar</div>'; }
}

async function toggleFollowFromList(btn, userId){
  if(!currentUser) return;
  btn.disabled = true;
  // Fase 1 da refatoração: insert/delete + verify-after-insert moraram em
  // DB.follows.follow/unfollow. Aqui só decidimos qual chamar e pintamos o
  // botão com base em {ok}.
  try {
    if(btn.classList.contains('following')){
      const r = await DB.follows.unfollow(currentUser.id, userId);
      if(!r.ok){ toast('Não foi possível deixar de seguir'); console.warn('unfollow:', r.code, r.message); return; }
      btn.textContent = 'Seguir';
      btn.classList.remove('following');
      btn.style.background = 'var(--p1)';
      btn.style.color = '#fff';
      btn.style.border = 'none';
    } else {
      const r = await DB.follows.follow(currentUser.id, userId);
      if(!r.ok){
        if(typeof reportError === 'function') reportError({ type:'follow-not-persisted', ctx:(r.code||'?')+' '+(r.message||'') });
        toast('Não foi possível seguir' + (r.code ? ' (cod '+r.code+')' : ''));
        return;
      }
      btn.textContent = 'Seguindo';
      btn.classList.add('following');
      btn.style.background = 'rgba(0,0,0,.05)';
      btn.style.color = 'var(--ink)';
      btn.style.border = '1px solid var(--border)';
    }
    if(typeof invalidateFollowingIds === 'function') invalidateFollowingIds();
    loadMyProfileStats();
  } finally {
    btn.disabled = false;
  }
}

async function shareProfile(){
  if(!currentUser){ toast('Faça login primeiro'); return; }
  const sb = getSupabase();
  let prof = {};
  try {
    if(sb){
      const { data } = await sb.from('profiles')
        .select('name, role, user_type, city, state, specialties')
        .eq('id', currentUser.id).single();
      prof = data || {};
    }
  } catch(e){ console.warn('shareProfile profile fetch:', e && e.message || e); }
  const name = prof.name || document.getElementById('myprofile-name')?.textContent || 'Profissional';
  const roleMap = { pintor:'Pintor', grafiteiro:'Grafiteiro/Muralista', automotivo:'Pintor Automotivo', funileiro:'Funileiro', cliente:'Cliente' };
  const role = roleMap[String(prof.role||prof.user_type||'').toLowerCase()] || 'Profissional';
  const local = [prof.city, prof.state].filter(Boolean).join(' - ');
  const link = window.location.origin + '/?ref=' + currentUser.id;
  let brief = '🎨 ' + name + ' — ' + role + ' no QueroUmaCor\n';
  if(local) brief += '📍 ' + local + '\n';
  if(prof.specialties) brief += '🛠️ ' + prof.specialties + '\n';
  brief += '\nVeja meu portfólio completo e crie sua conta gratuita por este link:\n' + link;
  if(navigator.share){
    navigator.share({ title: name + ' — QueroUmaCor', text: brief }).catch(()=>{});
  } else if(navigator.clipboard){
    navigator.clipboard.writeText(brief).then(()=>toast('Perfil e link copiados!')).catch(()=>toast('Link: '+link));
  } else {
    await appPrompt('Copie e compartilhe:', { initial: brief });
  }
}

async function updateMyStoryAvatar(){
  const el = document.getElementById('my-story-avatar');
  const nameEl = document.getElementById('my-story-name');
  if(!el || !currentUser) return;
  const sb = getSupabase();
  if(!sb) return;
  try {
    const profile = await getMyProfile();
    const fullName = (profile && profile.name) || currentUser.user_metadata?.name || '';
    const firstName = fullName.split(' ')[0] || 'Seu story';
    if(nameEl) nameEl.textContent = firstName;
    if(profile && profile.avatar_url){
      el.src = profile.avatar_url;
    } else {
      el.src = avatarUrl(fullName || 'U');
    }
  } catch(e){ console.warn('updateMyStoryAvatar error:', e && e.message || e); }
}

async function doLoginSupabase(email, password) {
  const sb = getSupabase();
  if (!sb) { toast('Erro: Supabase não carregou'); return; }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { toast('Erro: ' + error.message); }
    else { currentUser = data.user; autoDetectRole(); showScreen('feed'); }
  } catch(e) {
    toast('Erro de conexão: ' + e.message);
  }
}
function doLogin(){
  // Dedupe-submit: desabilita o botão Entrar enquanto a request roda
  const _btn = (typeof event !== 'undefined' && event && event.currentTarget) ||
               (typeof event !== 'undefined' && event && event.submitter) ||
               document.querySelector('#screen-login button.auth-btn:not(.secondary)');
  const email=document.getElementById('login-email').value.trim();
  const pw=document.getElementById('login-pw').value;
  if(!email||!pw){toast('⚠️ Preencha email e senha');return;}
  if(_btn) _btn.disabled = true;
  Promise.resolve(doLoginSupabase(email,pw))
    .finally(() => { if(_btn) _btn.disabled = false; });
}

async function doRegisterSupabase(name, email, password, type, tag) {
  const sb = getSupabase();
  if (!sb) { showScreen('feed'); return; }
  const phone = document.getElementById('s-phone') ? document.getElementById('s-phone').value.trim() : '';
  const cityName = document.getElementById('s-city') ? document.getElementById('s-city').value.trim() : '';
  const stateName = document.getElementById('s-state') ? document.getElementById('s-state').value.trim() : '';
  const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name: name, user_type: type || 'cliente', tag: tag } } });
  if (error) {
    // Caso comum: a pessoa já tem conta com esse e-mail. Tenta logar
    // com as mesmas credenciais (se for ela mesma) e segue o fluxo.
    if (/already registered|already exists|user_already_exists/i.test(error.message || '')) {
      const { data: si, error: siErr } = await sb.auth.signInWithPassword({ email, password });
      if (!siErr && si && si.user) {
        currentUser = si.user;
        autoDetectRole();
        toast('Bem-vindo de volta!');
        if (validatedInviteCode && validatedInviteCode.created_by && typeof openUserProfile === 'function') {
          openUserProfile(validatedInviteCode.created_by);
        } else {
          showScreen('feed');
        }
        return;
      }
      await appAlert('Esse e-mail já tem conta. Entre com sua senha na tela de login.');
      showScreen('login');
      const emEl = document.getElementById('login-email');
      if (emEl) emEl.value = email;
      return;
    }
    await appAlert('Erro: ' + error.message);
    return;
  }
  // Upload avatar if selected
  let avatarUrl = null;
  if(data && data.user){
    const avatarFile = document.getElementById('signup-avatar-input').files[0];
    if(avatarFile){
      try {
        const ext = avatarFile.name.split('.').pop();
        const path = data.user.id + '/avatar.' + ext;
        await sb.storage.from('posts').upload(path, avatarFile, { upsert: true });
        const { data: urlData } = sb.storage.from('posts').getPublicUrl(path);
        avatarUrl = urlData.publicUrl;
      } catch(e){ console.warn('Avatar upload error:', e && e.message || e); }
    }
    // Create profile record with referral tracking
    const birthdate = (document.getElementById('s-birthdate')||{}).value || null;
    const profileData = {
      id: data.user.id,
      name: name,
      tag: tag || name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.]/g, ''),
      user_type: type || 'cliente',
      role: type || 'cliente',
      city: cityName,
      state: stateName,
      phone: phone,
      avatar_url: avatarUrl,
      birth_date: birthdate,
      created_at: new Date().toISOString()
    };
    // Profession only applies to professionals, not clients
    if(isProfessionalRole(type)){
      profileData.profession = getSelectedProfession();
      const specs = [...document.querySelectorAll('#spec-grid .spec-chip.sel')].map(c=>c.textContent.trim());
      if(specs.length) profileData.specialties = specs.join(', ');
    }
    // Track who invited this user
    if(validatedInviteCode){
      if(validatedInviteCode.code) profileData.invite_code_used = validatedInviteCode.code;
      if(validatedInviteCode.created_by) profileData.invited_by = validatedInviteCode.created_by;
    }
    try {
      await sb.from('profiles').upsert(profileData, { onConflict: 'id' });
    } catch(e){ console.warn('Profile create error:', e && e.message || e); }
    // Registra a indicação — o indicador ganha pontos via trigger no banco
    if(validatedInviteCode && validatedInviteCode.created_by && validatedInviteCode.created_by !== data.user.id){
      try {
        await sb.from('referrals').insert({
          referrer_id: validatedInviteCode.created_by,
          referred_id: data.user.id,
          status: 'completed',
          bonus_points: 20
        });
      } catch(e){ console.warn('Referral insert error:', e && e.message || e); }
    }
  }
  currentUser = data.user;
  autoDetectRole();
  toast('Conta criada com sucesso!');
  // Se veio por convite, mostra direto o perfil de quem convidou —
  // o cadastrado vê quem o trouxe pro app e pode seguir / pedir orçamento.
  if (validatedInviteCode && validatedInviteCode.created_by && typeof openUserProfile === 'function') {
    openUserProfile(validatedInviteCode.created_by);
  } else {
    showScreen('feed');
  }
}

function previewSignupAvatar(input){
  const file = input.files[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  const preview = document.getElementById('signup-avatar-preview');
  preview.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
}

async function doLogoutSupabase() {
  // Limpa o estado local imediatamente — não aguarda o servidor. Se o
  // signOut travar na rede, a UI já volta pra tela de login sem ficar
  // pendurada em "Saindo...".
  // Flush pendentes ANTES de zerar currentUser, senão writes debounced
  // de chat ficam órfãos (não conseguem montar a chave de storage).
  if(typeof _flushConvs === 'function'){ try { _flushConvs(); _flushMsgs(); } catch(_){} }
  currentUser = null;
  if(typeof invalidateMyProfile === 'function') invalidateMyProfile();
  showScreen('login');
  const sb = getSupabase();
  if (sb) sb.auth.signOut().catch(e => console.warn('signOut:', e && e.message || e));
}
function doLogout() {
  if (!confirm('Tem certeza que deseja sair da sua conta?')) return;
  doLogoutSupabase();
  toast('Você saiu da conta');
}

// ══ SEARCH PEOPLE ══
function getSearchEmpty(){
  setTimeout(loadPeopleSuggestions, 0);
  return `<div style="padding:14px 14px 4px;">
    <div style="font-size:13px;font-weight:700;color:var(--ink);text-transform:uppercase;letter-spacing:.5px;">Sugestões para você</div>
    <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">Pessoas que você pode seguir</div>
  </div>
  <div id="people-suggestions"><div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Carregando sugestões...</div></div>`;
}

async function loadPeopleSuggestions(){
  const box = document.getElementById('people-suggestions');
  if(!box) return;
  const sb = getSupabase();
  if(!sb){ setTimeout(loadPeopleSuggestions, 500); return; }
  try {
    const res = await sb.from('profiles_public').select('id, name, tag, avatar_url, user_type, role, city, created_at').order('created_at', { ascending: false }).limit(60);
    if(res.error){ box.innerHTML='<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Não foi possível carregar sugestões.</div>'; return; }
    let people = res.data || [];
    const myId = currentUser ? currentUser.id : null;
    let followingIds = [];
    if(myId) followingIds = await DB.follows.listFollowingIds(myId);
    let myCity = '';
    if(myId){
      const { data: mp } = await sb.from('profiles').select('city').eq('id', myId).maybeSingle();
      myCity = ((mp && mp.city) || '').toLowerCase();
    }
    people = people.filter(p => p.id !== myId && !followingIds.includes(p.id));
    // Mesma cidade primeiro (proxy de "distância" enquanto não temos lat/lng)
    if(myCity){
      people.sort((a,b) => {
        const sa = ((a.city||'').toLowerCase()===myCity)?0:1;
        const sb_ = ((b.city||'').toLowerCase()===myCity)?0:1;
        return sa - sb_;
      });
    }
    people = people.slice(0, 18);
    if(people.length === 0){
      box.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Sem sugestões no momento.</div>';
      return;
    }
    box.innerHTML = people.map(p => {
      const isPintor = isProfessionalRole(p.role) || isProfessionalRole(p.user_type);
      const roleBadge = isPintor ? '<span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.3px;margin-left:5px;">PINTOR</span>' : '';
      const tagDisplay = p.tag ? '@' + p.tag : '';
      const niceName = displayName(p);
      return `<div class="search-result-item" onclick="openUserProfile('${escapeJsArg(p.id)}')">
        <div class="search-result-avatar">${avatarImgTag(p)}</div>
        <div class="search-result-info">
          <div class="search-result-tag">${escapeHtml(niceName)}${roleBadge}</div>
          <div class="search-result-name">${escapeHtml(tagDisplay)}${tagDisplay && p.city ? ' · ' : ''}${escapeHtml(p.city||'')}</div>
        </div>
        <button class="search-result-follow follow" onclick="event.stopPropagation();toggleFollow('${escapeJsArg(p.id)}',this)">Seguir</button>
      </div>`;
    }).join('');
  } catch(e){
    box.innerHTML = '<div style="text-align:center;padding:30px 20px;color:var(--muted);font-size:13px;">Erro ao carregar sugestões.</div>';
  }
}

let searchTimeout;
function searchPeople(query){
  clearTimeout(searchTimeout);
  const container=document.getElementById('search-results');
  if(!query||query.trim().length<2){
    container.innerHTML=getSearchEmpty();
    return;
  }
  searchTimeout=setTimeout(async()=>{
    const sb=getSupabase();
    if(!sb)return;
    // sanitiza para o padrão ilike do PostgREST (remove caracteres que quebram o .or())
    const cleanQuery=query.replace('@','').trim().toLowerCase().replace(/[,%()*]/g,' ').trim();
    if(!cleanQuery){ container.innerHTML=getSearchEmpty(); return; }
    let data = [];
    try {
      // Busca no servidor (escala sem baixar a tabela inteira)
      const pat = '%' + cleanQuery + '%';
      const res = await sb.from('profiles_public')
        .select('id, name, tag, avatar_url, user_type, role, city')
        .or('name.ilike.'+pat+',tag.ilike.'+pat+',city.ilike.'+pat)
        .limit(25);
      if(res.error) console.warn('searchPeople error:', res.error.message);
      data = res.data || [];
    } catch(e) { console.warn('searchPeople exception:', e && e.message || e); }
    if(!data||data.length===0){
      container.innerHTML=`<div style="text-align:center;padding:60px 20px;color:var(--muted);">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="var(--border)" stroke-width="1.5" style="margin-bottom:14px;"><path d="M16 16l-3.5-3.5"/><circle cx="10" cy="10" r="7"/></svg>
        <div style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:4px;">Nenhum resultado</div>
        <div style="font-size:13px;">Ninguem encontrado para "${escapeHtml(query)}"</div>
      </div>`;
      return;
    }
    let followingIds=[];
    if(currentUser) followingIds = await DB.follows.listFollowingIds(currentUser.id);
    container.innerHTML=data.map(p=>{
      const isFollowing=followingIds.includes(p.id);
      const isSelf=currentUser&&currentUser.id===p.id;
      const isPintor=isProfessionalRole(p.role)||isProfessionalRole(p.user_type);
      const roleBadge=isPintor?'<span style="background:var(--ink);color:var(--p1);font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:.3px;margin-left:5px;">PINTOR</span>':'';
      const tagDisplay=p.tag?'@'+p.tag:'';
      const niceName=displayName(p);
      return `<div class="search-result-item" onclick="openUserProfile('${escapeJsArg(p.id)}')">
        <div class="search-result-avatar">${avatarImgTag(p)}</div>
        <div class="search-result-info">
          <div class="search-result-tag">${escapeHtml(niceName)}${roleBadge}</div>
          <div class="search-result-name">${escapeHtml(tagDisplay)}${tagDisplay&&p.city?' · ':''}${escapeHtml(p.city||'')}</div>
        </div>
        ${isSelf?'':`<button class="search-result-follow ${isFollowing?'following':'follow'}" onclick="event.stopPropagation();toggleFollow('${escapeJsArg(p.id)}',this)">${isFollowing?'Seguindo':'Seguir'}</button>`}
      </div>`;
    }).join('');
  },300);
}

async function openUserProfile(userId, preview){
  const sb = getSupabase();
  if(!sb) return;
  try {
    // Dispara TUDO em paralelo: profile + 3 contagens + isFollowing.
    // Antes eram 4-5 round-trips sequenciais (~600ms+); agora ~150ms.
    // SELECT enxuto em vez de '*' (perfis têm cart/archived_conversations
    // JSON enormes que não usamos aqui).
    const PROF_COLS = 'id, name, tag, avatar_url, bio, city, state, role, user_type, is_pro, rating_avg, review_count';
    // Follows passam por DB.follows.* (Fase 1). countFollowers/countFollowing
    // retornam number direto; isFollowing retorna boolean direto.
    const queries = [
      sb.from('profiles').select(PROF_COLS).eq('id', userId).single(),
      sb.from('posts').select('*',{count:'exact',head:true}).eq('user_id',userId).neq('media_type','story'),
      DB.follows.countFollowers(userId),
      DB.follows.countFollowing(userId)
    ];
    if(currentUser) queries.push(DB.follows.isFollowing(currentUser.id, userId));
    const [profRes, postRes, followersCount, followingCount, followingFlag] = await Promise.all(queries);
    const prof = profRes.data;
    if(!prof){ toast('Perfil não encontrado'); return; }
    if(currentUser && userId === currentUser.id && !preview){
      showScreen('myprofile'); return;
    }
    const postCount = postRes.count || 0;
    const isFollowing = !!followingFlag;

    const screen = document.getElementById('screen-profile');
    const nameEl = screen.querySelector('.ph-name');
    const bioEl = screen.querySelector('.ph-bio');
    const avatarEl = screen.querySelector('.ph-avatar img');
    const name = prof.name || 'Usuário';
    const avatar = prof.avatar_url || avatarUrl(name, 200);
    const location = (prof.city||'')+(prof.state?' · '+prof.state:'');
    const _rl = prof.role||prof.user_type||'cliente';
    const role = {pintor:'Pintor',grafiteiro:'Grafiteiro/Muralista',automotivo:'Pintor Automotivo',cliente:'Cliente'}[_rl]||'Cliente';
    if(nameEl) nameEl.textContent = name;
    if(bioEl) bioEl.textContent = (prof.tag?'@'+prof.tag+' · ':'')+role+(location?' · '+location:'');
    if(avatarEl) avatarEl.src = avatar;

    const statsEl = screen.querySelector('.ph-stats');
    if(statsEl){
      statsEl.innerHTML = `
        <div class="ph-stat"><div class="ph-stat-n">${postCount}</div><div class="ph-stat-l">posts</div></div>
        <div class="ph-stat"><div class="ph-stat-n">${followersCount}</div><div class="ph-stat-l">seguidores</div></div>
        <div class="ph-stat"><div class="ph-stat-n">${followingCount}</div><div class="ph-stat-l">seguindo</div></div>
      `;
    }

    // Update buttons: Follow/Following + Chat + Cali Colors
    const btnsEl = screen.querySelector('.ph-btns');
    if(btnsEl){
      const followClass = isFollowing ? 'following' : 'follow';
      const followText = isFollowing ? 'Seguindo' : 'Seguir';
      const followStyle = isFollowing
        ? 'background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#fff;'
        : 'background:var(--p1);border:none;color:#fff;';
      btnsEl.innerHTML = `
        <button class="ph-btn ${followClass}" onclick="toggleFollow('${escapeJsArg(userId)}',this)" style="${followStyle}flex:1;padding:9px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">${escapeHtml(followText)}</button>
        <button class="ph-btn msg" onclick="startChatWith('${escapeJsArg(userId)}','${escapeJsArg(name)}')" style="padding:9px 14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:16px;cursor:pointer;">💬</button>
        <button class="ph-btn" onclick="showScreen('mkt')" style="padding:9px 14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:'DM Sans',sans-serif;">🛒 Cali</button>
      `;
    }

    switchTab('works');
    renderRealProfileTabs(userId, name);
    showScreen('profile');
  } catch(e){
    console.error('openUserProfile error:', e && e.message || e);
    toast('Erro ao abrir perfil');
  }
}

// Preenche as abas do perfil público (screen-profile) com dados reais
async function renderRealProfileTabs(userId, name){
  const sb = getSupabase();
  if(!sb) return;
  const screen = document.getElementById('screen-profile');
  if(!screen) return;
  const esc = s => String(s||'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  // Só aceita URLs http(s) — bloqueia javascript:, data:, vbscript:, etc.
  // pra interpolar em <a href=...> com segurança.
  const safeUrl = s => {
    const v = String(s||'').trim();
    if (/^https?:\/\//i.test(v)) return esc(v);
    return '';
  };
  // Empty state amigável reutilizável
  const emptyState = (icon, msg) => `<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 20px;"><div style="font-size:36px;margin-bottom:10px;">${icon}</div><div style="font-size:14px;">${msg}</div></div>`;

  try {
    const { data: posts } = await sb.from('posts').select(POST_COLS)
      .eq('user_id', userId).neq('media_type','story')
      .or('status.eq.approved,status.is.null')
      .order('created_at',{ascending:false}).limit(60);
    const all = posts || [];
    const imgs = all.filter(p => p.media_type !== 'video');
    const vids = all.filter(p => p.media_type === 'video');

    const worksGrid = screen.querySelector('#tab-works .works-grid');
    if(worksGrid){
      worksGrid.innerHTML = imgs.length
        ? imgs.map(p => `<div class="works-grid-item"><img src="${esc(p.media_url)}" alt="" loading="lazy"></div>`).join('')
        : emptyState('🎨', 'Portfólio em construção');
    }
    const vidsGrid = screen.querySelector('#tab-vids .works-grid');
    if(vidsGrid){
      vidsGrid.innerHTML = vids.length
        ? vids.map(p => `<div class="works-grid-item" style="position:relative"><video src="${esc(p.media_url)}" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;"></video><div style="position:absolute;inset:0;background:rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;"><span style="font-size:26px;color:#fff;">▶</span></div></div>`).join('')
        : emptyState('🎬', 'Nenhum vídeo publicado ainda');
    }
  } catch(e){ console.warn('renderRealProfileTabs posts:', e && e.message || e); }

  try {
    const { data: quals } = await sb.from('qualifications').select('*')
      .eq('user_id', userId).order('created_at',{ascending:false});
    const certList = screen.querySelector('#tab-certs .cert-list');
    if(certList){
      certList.innerHTML = (quals && quals.length)
        ? quals.map(q => `<div class="cert-card" style="border-left:3px solid var(--p1);">
            <div class="cert-ic" style="background:var(--cream);font-size:22px;">${esc(q.icon||'🎓')}</div>
            <div class="cert-txt" style="flex:1"><div class="cert-n">${esc(q.title)}</div><div class="cert-o">${esc(q.org||'')}${q.year?' · '+esc(q.year):''}</div></div>
          </div>`).join('')
        : emptyState('🎓', 'Nenhuma formação cadastrada');
    }
  } catch(e){ console.warn('renderRealProfileTabs quals:', e && e.message || e); }

  try {
    const { data: courses } = await sb.from('courses').select('*')
      .eq('user_id', userId).order('created_at',{ascending:false});
    const cursosTab = screen.querySelector('#tab-cursos');
    if(cursosTab){
      cursosTab.innerHTML = (courses && courses.length)
        ? `<div style="font-size:13px;color:var(--muted);margin-bottom:14px;">Cursos criados por ${esc(name)}</div>` +
          courses.map(c => `<div style="background:var(--white);border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);margin-bottom:12px;">
            ${c.cover_url?`<div style="position:relative;"><img src="${esc(c.cover_url)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block;">${c.duration?`<div style="position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:3px 9px;border-radius:20px;">${esc(c.duration)}</div>`:''}</div>`:''}
            <div style="padding:14px;">
              <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${esc(c.title)}</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:10px;">${esc(c.subtitle||'')}</div>
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:16px;font-weight:800;color:var(--ink);">${c.is_free?'Grátis':('R$'+Number(c.price||0).toFixed(2).replace('.',','))}</div>
                ${c.link && safeUrl(c.link) ? `<a href="${safeUrl(c.link)}" target="_blank" rel="noopener noreferrer" style="background:var(--p1);color:#fff;text-decoration:none;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:700;">Acessar</a>`:''}
              </div>
            </div>
          </div>`).join('')
        : emptyState('📚', 'Nenhum curso publicado');
    }
  } catch(e){ console.warn('renderRealProfileTabs courses:', e && e.message || e); }

  try {
    const { data: pq } = await sb.from('quotes').select('id').eq('painter_id', userId);
    const qIds = (pq || []).map(q => q.id);
    let reviews = [];
    if(qIds.length){
      const { data: rv } = await sb.from('reviews')
        .select('rating, criteria, comment, created_at, reviewer:profiles!reviewer_id(name, avatar_url)')
        .in('quote_id', qIds).order('created_at', { ascending:false }).limit(40);
      reviews = rv || [];
    }
    const revList = screen.querySelector('#tab-reviews .reviews-list');
    if(revList){
      if(reviews.length){
        const avg = reviews.reduce((s,r)=>s+(+r.rating||0),0) / reviews.length;
        const stars = v => { const f=Math.max(0,Math.min(5,Math.round(v))); return '★'.repeat(f)+'☆'.repeat(5-f); };
        let h = '<div style="display:flex;align-items:center;gap:14px;background:var(--white);border-radius:14px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:14px;">'
          + '<div style="text-align:center;"><div style="font-size:32px;font-weight:800;font-family:Syne,sans-serif;color:var(--ink);line-height:1;">'+avg.toFixed(1)+'</div>'
          + '<div style="color:#f4a300;font-size:13px;margin-top:3px;">'+stars(avg)+'</div></div>'
          + '<div style="font-size:13px;color:var(--muted);">'+reviews.length+' avalia'+(reviews.length>1?'ções':'ção')+'</div></div>';
        h += reviews.map(r => {
          const rv = r.reviewer || {};
          const av = rv.avatar_url || avatarUrl(rv.name||'C', 64);
          const date = r.created_at ? dateBR(r.created_at) : '';
          const crit = Array.isArray(r.criteria) ? r.criteria : [];
          return '<div style="background:var(--white);border-radius:14px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);margin-bottom:9px;">'
            + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:'+((crit.length||r.comment)?'8px':'0')+';">'
            + '<img src="'+esc(av)+'" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;">'
            + '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:700;color:var(--ink);">'+esc(rv.name||'Cliente')+'</div>'
            + '<div style="color:#f4a300;font-size:12px;">'+stars(+r.rating||0)+'</div></div>'
            + '<div style="font-size:11px;color:var(--muted);white-space:nowrap;">'+date+'</div></div>'
            + (crit.length?'<div style="display:flex;flex-wrap:wrap;gap:5px;'+(r.comment?'margin-bottom:8px;':'')+'">'+crit.map(c=>'<span style="font-size:10px;background:var(--cream);color:var(--muted);padding:2px 8px;border-radius:20px;">'+esc(c)+'</span>').join('')+'</div>':'')
            + (r.comment?'<div style="font-size:13px;color:var(--ink);line-height:1.5;">'+esc(r.comment)+'</div>':'')
            + '</div>';
        }).join('');
        revList.innerHTML = h;
      } else {
        revList.innerHTML = emptyState('⭐', 'Nenhuma avaliação ainda');
      }
    }
  } catch(e){
    console.warn('renderRealProfileTabs reviews:', e && e.message || e);
    const revList = screen.querySelector('#tab-reviews .reviews-list');
    if(revList) revList.innerHTML = emptyState('⭐', 'Nenhuma avaliação ainda');
  }
}

// Start a chat with a user from their profile
async function startChatWith(userId, userName){
  // Navigate to chat screen and create/open conversation
  showScreen('chat');
  // If openChatConversation exists, use it; otherwise just navigate
  if(typeof openChatConversation === 'function'){
    openChatConversation(userId, userName);
  } else {
    toast('Chat com ' + userName);
  }
}

async function toggleFollow(userId,btn){
  const sb=getSupabase();
  if(!sb||!currentUser){toast('Faça login primeiro');return;}
  const isFollowing=btn.classList.contains('following');
  // Botões da lista de busca/sugestões ficam sobre fundo claro: o estilo
  // vem do CSS (.search-result-follow.follow / .following), então não
  // aplicamos cor inline (senão o #fff do header escuro vaza pra cá e o
  // texto "Seguindo" some). Só o header de perfil (fundo escuro) precisa
  // dos estilos inline brancos.
  const isLightCtx = btn.classList.contains('search-result-follow');
  const paintFollowing = () => {
    btn.textContent='Seguindo';
    btn.classList.remove('follow'); btn.classList.add('following');
    if(isLightCtx){ btn.style.background=''; btn.style.border=''; btn.style.color=''; }
    else { btn.style.background='rgba(255,255,255,.12)'; btn.style.border='1px solid rgba(255,255,255,.2)'; btn.style.color='#fff'; }
  };
  const paintFollow = () => {
    btn.textContent='Seguir';
    btn.classList.remove('following'); btn.classList.add('follow');
    if(isLightCtx){ btn.style.background=''; btn.style.border=''; btn.style.color=''; }
    else { btn.style.background='var(--p1)'; btn.style.border='none'; btn.style.color='#fff'; }
  };
  // Fase 1 da refatoração: insert/delete + verify-after-insert moram em
  // DB.follows.follow/unfollow. Aqui só pintamos com base em {ok}.
  // Por que verify-after-insert: trigger em follows pode dar ROLLBACK
  // devolvendo 23505 de OUTRA tabela (ex.: points UNIQUE). Sem verify, o UI
  // virava "Seguindo" otimisticamente e o perfil (que lê do banco) mostrava
  // "Seguir" — list e perfil divergiam.
  btn.disabled = true;
  try {
    if(isFollowing){
      const r = await DB.follows.unfollow(currentUser.id, userId);
      if(!r.ok){ toast('Não foi possível deixar de seguir'); console.warn('unfollow:', r.code, r.message); return; }
      paintFollow();
      toast('Deixou de seguir');
    } else {
      const r = await DB.follows.follow(currentUser.id, userId);
      if(!r.ok){
        if(typeof reportError === 'function') reportError({ type:'follow-not-persisted', ctx:(r.code||'?')+' '+(r.message||'') });
        toast('Não foi possível seguir' + (r.code ? ' (cod '+r.code+')' : ''));
        return;
      }
      paintFollowing();
      toast('Seguindo!');
    }
    if(typeof invalidateFollowingIds === 'function') invalidateFollowingIds();
  } finally {
    btn.disabled = false;
  }
}

function togglePw(id,btn){
  const inp=document.getElementById(id);
  const show=inp.type==='password';
  inp.type=show?'text':'password';
  btn.style.opacity=show?'1':'.5';
}

function debounce(fn, ms = 250){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
window.debounce = debounce;

window.addEventListener('DOMContentLoaded', () => { initAuth(); });

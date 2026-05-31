// modules/mkt.js — feature "Loja / catálogo de produtos" (Marketplace) extraída
// do app.js. Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
//
// Depende de globals do app.js / head.js:
//   getSupabase, currentUser, requireSession, getMyProfile, DB.profiles,
//   handleSbError, apiPost, toast, escapeHtml, escapeJsArg, safeUrl, cfImg,
//   debounce, showModal, closeModals, showError.
//
// Compartilha estado mutável com app.js (top-level `let`):
//   cartItems, cartCount, shirtQty, logoState, mktProducts,
//   _aiLogoCount, _seenStories.
// Esses NÃO são redeclarados — resolvem para o binding original do app.js
// (top-level `let` em script clássico é visível pra outros scripts).
//
// Estado próprio do módulo (constantes/regex/grouped cache) é declarado
// dentro do IIFE — em etapa 2, quando app.js perder as duplicatas, este
// módulo passa a ser a fonte única.
(function(){
  'use strict';

  // ── Cores: dicionário determinístico + resolução por nome ────────────────
  const COLOR_DICT = [
    ['branco neve','#fbfbf7'],['branco gelo','#eef0ea'],['branco fosco','#f4f3ee'],['off white','#efece1'],['branco','#f6f5f0'],
    ['preto fosco','#1c1c1c'],['preto','#1a1a1a'],
    ['cinza chumbo','#4b4f54'],['cinza grafite','#3a3d40'],['grafite','#3a3d40'],['cinza claro','#c7c9c8'],['cinza escuro','#5a5d5f'],['cinza concreto','#9a9b96'],['concreto','#9a9b96'],['cinza','#9b9d9c'],['prata','#c5c7c9'],['aluminio','#b8bcc0'],
    ['azul claro','#9ec7e8'],['azul bebe','#bcd9ee'],['azul royal','#1f4ea1'],['azul marinho','#1b2a4a'],['azul petroleo','#1f5560'],['azul turquesa','#2bb6c4'],['turquesa','#2bb6c4'],['azul','#2f6fb0'],
    ['verde musgo','#5a6b3b'],['verde limao','#bcd64a'],['verde agua','#bfe3d8'],['verde bandeira','#1e7a3d'],['verde oliva','#6b6b3a'],['verde','#2e8b57'],
    ['amarelo ouro','#e0a526'],['amarelo canario','#f5d427'],['amarelo','#f2c531'],['ouro','#caa233'],['dourado','#caa233'],
    ['vermelho','#c0392b'],['vinho','#5e1f24'],['bordo','#5e1f24'],['carmim','#9b1c2e'],
    ['laranja','#e67e22'],['terracota','#b5562e'],['tijolo','#9c4a2f'],['salmao','#f0a78f'],
    ['rosa','#e79bb3'],['pink','#e84d8a'],['magenta','#c0337a'],
    ['roxo','#6b3fa0'],['lilas','#b9a5d6'],['violeta','#7a4fb0'],
    ['marrom','#6b4226'],['cafe','#4b3621'],['chocolate','#4b2e1e'],['caramelo','#a9743b'],['tabaco','#7a5230'],['imbuia','#5a3a22'],['mogno','#6e3326'],['cedro','#8a5a33'],['castanho','#5d3a22'],
    ['bege','#d8c6a8'],['areia','#d6c5a0'],['palha','#e3d5ad'],['creme','#efe6cf'],['nude','#e3c9b3'],['camurca','#c9a878'],['marfim','#efe7d2'],
    ['gelo','#eef0ea'],['perola','#ece7dd'],
  ];
  function _normTxt(s){ return ' '+String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')+' '; }
  // Cores "placeholder" que NÃO contam como cor escolhida de verdade
  const _PLACEHOLDER_HEX = /^#?(c0622d|cccccc|ddd|dddddd|e8e2d9)$/i;
  function resolveColorHex(p){
    const ch = p && p.color_hex ? String(p.color_hex).trim() : '';
    if(ch && !_PLACEHOLDER_HEX.test(ch.replace('#',''))) return ch;
    const n = _normTxt(p && p.name);
    for(const [k,hex] of COLOR_DICT){ if(n.includes(k)) return hex; }
    return ch || null;
  }
  function productBg(p){
    if(p && p.color_gradient) return 'linear-gradient(135deg,'+p.color_gradient+')';
    return resolveColorHex(p) || '#e8e2d9';
  }
  function hasProductColor(p){
    return !!(p && (p.color_gradient || resolveColorHex(p)));
  }

  // ── Classificação automática (marca/tipo no nome) ────────────────────────
  const MKT_MENUS = [
    { key:'arte_urbana',  label:'🎨 Arte Urbana & Spray',   kw:['arte urbana','colorgin','spray','aerossol','aerosol','grafit','graffit'] },
    { key:'tintas',       label:'🪣 Tintas',                 kw:['tinta','esmalte','latex','látex','acrilic','acrílic','verniz','primer','seladora','fundo preparador','base coat','automotiva','suvinil','coral','sherwin'] },
    { key:'texturas',     label:'🧱 Texturas & Massas',      kw:['textura','grafiato','massa corrida','massa acrilic','massa pva','reboco','chapisco'] },
    { key:'epoxi',        label:'⚗️ Epóxi & Poliuretano',    kw:['epoxi','epóxi','poliuretano',' pu '] },
    { key:'solventes',    label:'💧 Solventes & Aditivos',   kw:['thinner','solvente','diluente','aguarras','aguarrás','acelerador','secante','catalisador','endurecedor','aditivo','redutor','removedor'] },
    { key:'adesivos',     label:'🧪 Adesivos & Colas',       kw:['adesivo','cola','silicone','vedante','veda calha','rejunte','massa epox','durepoxi'] },
    { key:'ferramentas',  label:'🧰 Ferramentas',            kw:['alicate','tesoura','chave','martelo','abre trinca','espatula','espátula','desempenadeira','colher de pedreiro','trena','serra','furadeira','broca','lixadeira','estilete','formao','formão','grosa','lima','torques'] },
    { key:'pintura',      label:'🖌️ Acessórios de Pintura',  kw:['rolo','pincel','trincha','bandeja','fita crepe','fita','lixa','cabo extensor','extensor','gaiola','luva','mascara','máscara','respirador','oculos','óculos','lona','plastico','plástico','crepe'] },
    { key:'eletrica',     label:'🔌 Elétrica',               kw:['tomada','adaptador','extens','lampada','lâmpada','disjuntor','filtro de linha','benjamim','fio ','interruptor'] },
    { key:'equipamentos', label:'🛠️ Equipamentos',           kw:['aerografo','aerógrafo','compressor','pistola','maquina','máquina','pulverizador','airless'] },
  ];
  const MKT_MENU_LABEL = Object.assign({ outros:'📦 Outros' }, ...MKT_MENUS.map(m => ({ [m.key]: m.label })));
  function mktClassify(p){
    const n = (' ' + (p && p.name || '') + ' ').toLowerCase();
    if(n.includes('vonixx')) return 'outros';
    if(n.includes('metalatex') || n.includes('novacor')) return 'tintas';
    for(const m of MKT_MENUS){ if(m.kw.some(k => n.includes(k))) return m.key; }
    return 'outros';
  }

  // Virtualização básica: batches de 80 + IntersectionObserver sentinel.
  function _mktMountInfinite(container, items, batchSize){
    if(!container) return;
    batchSize = batchSize || 80;
    let cursor = 0;
    function appendBatch(){
      const slice = items.slice(cursor, cursor + batchSize);
      if(slice.length === 0) return;
      const sentinel = container.querySelector('.mkt-scroll-sentinel');
      if(sentinel) sentinel.remove();
      container.insertAdjacentHTML('beforeend', slice.map(renderProductRow).join(''));
      cursor += slice.length;
      if(cursor < items.length){
        const s = document.createElement('div');
        s.className = 'mkt-scroll-sentinel';
        s.style.cssText = 'grid-column:1/-1;height:1px;';
        container.appendChild(s);
        try {
          const io = new IntersectionObserver(entries => {
            if(entries[0].isIntersecting){ io.disconnect(); appendBatch(); }
          }, { rootMargin: '300px' });
          io.observe(s);
        } catch(_){ appendBatch(); }
      }
    }
    container.innerHTML = '';
    appendBatch();
  }

  function mktTab(key) {
    document.querySelectorAll('.mkt-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-key') === key));
    const si = document.getElementById('mkt-search'); if(si) si.value = '';
    const ss = document.getElementById('mkt-search-section'); if(ss) ss.style.display = 'none';
    document.querySelectorAll('#mkt-sections .mkt-menu-sec').forEach(s => {
      const on = s.getAttribute('data-key') === key;
      s.style.display = on ? 'block' : 'none';
      if(on && s.getAttribute('data-rendered') === '0'){
        const grid = s.querySelector('.mkt-products');
        if(grid){
          // eslint-disable-next-line no-use-before-define -- callback runtime; _mktGrouped declarado abaixo
          const items = key === 'todos' ? mktProducts : (_mktGrouped[key] || []);
          if(key === 'todos' && items.length > 80){
            _mktMountInfinite(grid, items, 80);
          } else {
            grid.innerHTML = items.map(renderProductRow).join('');
          }
        }
        s.setAttribute('data-rendered', '1');
      }
    });
  }

  // ── Estado do usuário (carrinho, contador de logo IA, stories vistos) ────
  async function loadUserState(){
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    try {
      const data = await getMyProfile();
      if(data){
        cartItems = Array.isArray(data.cart) ? data.cart : [];
        _aiLogoCount = +data.ai_logo_gen_count || 0;
        _seenStories = (data.seen_stories && typeof data.seen_stories === 'object') ? data.seen_stories : {};
        updateCartBadge();
      }
    } catch(e){ console.warn('loadUserState:', e && e.message || e); }
  }

  async function saveCart(){
    try {
      if(currentUser && currentUser.id){
        localStorage.setItem('cart_' + currentUser.id, JSON.stringify(cartItems));
      }
    } catch(e) { console.warn('[save-cart-local]', e && e.message); }
    const sb = getSupabase();
    if(!sb || !currentUser) return;
    try {
      const { error } = await sb.from('profiles').update({ cart: cartItems }).eq('id', currentUser.id);
      if(error) console.warn('saveCart:', error.message);
    } catch(e){
      console.warn('saveCart:', e && e.message || e);
    }
  }

  function updateCartBadge(){
    cartCount = cartItems.reduce((s,c) => s + (c.qty||1), 0);
    const el = document.getElementById('cart-count');
    if(el){
      el.textContent = cartCount;
      el.style.display = cartCount > 0 ? '' : 'none';
    }
  }

  function addToCart(productId, qty, name, price) {
    qty = Math.max(1, parseInt(qty) || 1);
    if(productId){
      let p = mktProducts.find(x => x.id === productId);
      if(!p && name){ p = { id: productId, name: name, price: Number(price) || 0 }; }
      if(p){
        const existing = cartItems.find(x => x.id === p.id);
        if(existing){
          existing.qty = (existing.qty || 1) + qty;
        } else {
          cartItems.push({ id:p.id, name:p.name, price:p.price, color_hex:p.color_hex, color_gradient:p.color_gradient, volume:p.volume, qty:qty });
        }
      }
    }
    saveCart();
    updateCartBadge();
    toast('Adicionado ao carrinho!');
    setTimeout(() => { renderCartModal(); showModal('cart-modal'); }, 300);
  }

  function changeCartQty(index, delta){
    if(!cartItems[index]) return;
    const newQty = (cartItems[index].qty || 1) + delta;
    if(newQty < 1){ removeFromCart(index); return; }
    cartItems[index].qty = newQty;
    saveCart();
    updateCartBadge();
    renderCartModal();
  }

  function renderCartModal(){
    const container = document.getElementById('cart-items-container');
    if(!container) return;
    if(cartItems.length === 0){
      container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Carrinho vazio</div>';
      document.getElementById('cart-total').textContent = 'R$0,00';
      return;
    }
    let total = 0;
    container.innerHTML = cartItems.map((item, i) => {
      const qty = item.qty || 1;
      const subtotal = Number(item.price || 0) * qty;
      total += subtotal;
      const bg = productBg(item);
      return '<div class="cart-item">'
        + '<div class="cart-item-icon" style="background:'+bg+'"></div>'
        + '<div class="cart-item-info">'
          + '<div class="cart-item-name">'+escapeHtml(item.name||'')+'</div>'
          + (item.volume ? '<div class="cart-item-vol">'+escapeHtml(item.volume)+'</div>' : '')
          + '<div class="cart-qty-ctrl">'
            + '<button class="cart-qty-btn" onclick="changeCartQty('+i+',-1)">−</button>'
            + '<span class="cart-qty-num">'+qty+'</span>'
            + '<button class="cart-qty-btn" onclick="changeCartQty('+i+',1)">+</button>'
          + '</div>'
        + '</div>'
        + '<div class="cart-item-price">R$'+subtotal.toFixed(2).replace('.',',')+'</div>'
        + '<button class="cart-remove" onclick="removeFromCart('+i+')" aria-label="Remover">×</button>'
      + '</div>';
    }).join('');
    document.getElementById('cart-total').textContent = 'R$' + total.toFixed(2).replace('.',',');
  }

  function removeFromCart(index){
    if (!confirm('Remover este item do carrinho?')) return;
    cartItems.splice(index, 1);
    saveCart();
    updateCartBadge();
    renderCartModal();
  }

  async function submitCartOrder(){
    if(cartItems.length === 0){ toast('Carrinho vazio!'); return; }
    const btn = document.getElementById('cart-submit-btn');
    // Double-submit guard: action cria pedido + cobra cliente, NUNCA pode rodar 2x.
    if(btn && btn.dataset._loading) return;
    const ctx = requireSession('Faça login primeiro');
    if(!ctx) return;
    const sb = ctx.sb;
    const restore = setButtonLoading(btn, 'Criando pedido...');
    let redirecting = false;
    try {
      const total = cartItems.reduce((sum, item) => sum + Number(item.price || 0) * (item.qty || 1), 0);
      const { data: inserted, error } = await sb.from('orders').insert({
        user_id: currentUser.id,
        items: cartItems,
        total: total,
        status: 'pending',
        created_at: new Date().toISOString()
      }).select('id').single();
      if(error) throw error;
      const orderId = inserted && inserted.id;
      if(!orderId) throw new Error('Pedido criado sem ID');

      if(btn) btn.textContent = 'Gerando pagamento...';
      const { data:{ session } } = await sb.auth.getSession();
      if(!session){ throw new Error('Sessão expirada — faça login'); }
      const { ok, status, data } = await apiPost('/api/mp-checkout-loja', { orderId });
      if(!ok || !data || !data.init_point){
        if(status === 503){
          toast('Pedido recebido! A loja entrará em contato (pagamento online em breve).');
          cartItems = []; saveCart(); updateCartBadge(); closeModals();
          return;
        }
        throw new Error((data && data.error) || ('Erro ' + status));
      }

      cartItems = []; saveCart(); updateCartBadge();
      toast('Redirecionando para o Mercado Pago...');
      // Botão FICA travado até o redirect efetivar — pular o restore no finally.
      redirecting = true;
      window.location.href = data.init_point;
    } catch(e){
      showError('cart-checkout', e, 'Não foi possível finalizar a compra. Tente novamente.');
    } finally {
      if(!redirecting) restore();
    }
  }

  function getCategoryEmoji(cat){
    return cat === 'texturas' ? '🖌️' : cat === 'epoxi' ? '⚗️' : cat === 'acessorios' ? '🎭' : '🪣';
  }

  function getProductImage(p){
    if(p.image_url){
      const safe = (typeof safeUrl === 'function') ? safeUrl(p.image_url) : '';
      if(safe) return cfImg(safe, { w: 280, fit: 'cover' });
    }
    if(p._imgCache !== undefined) return p._imgCache;
    const _setImg = (v) => { p._imgCache = v; return v; };
    const n = (p.name||'').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g,''); // strip accents for matching

    // Tintas Brazilian — fotos reais do catálogo, sem sufixo de tamanho
    const brMap = [
      [['alta emborrachada','tinta emborrachada','alta performance'],'br-alta-performance'],
      [['piso dura'],'br-piso-dura-premium'],
      [['pinta super','pinta+'],'br-pinta-super-standard'],
      [['classic standard','tinta acrilica classic'],'br-tinta-classic-standard'],
      [['economica turbo','tinta economica turbo'],'br-economica-turbo'],
      [['tinta acrilica premium','acrilica premium'],'br-tinta-acrilica-premium'],
      [['liancryl'],'br-liancryl-piso'],
      [['alkylux'],'br-alkylux-esmalte'],
      [['r.u.r.a.i','rurai'],'br-rurai-esmalte'],
      [['fundo acabamento','fundo e acabamento','fundo & acabamento'],'br-fundo-acabamento'],
      [['zarcao'],'br-fundo-zarcao'],
      [['fundo nivelador'],'br-fundo-nivelador-madeira'],
      [['galvilux'],'br-fundo-galvilux'],
      [['sintelux'],'br-sintelux-esmalte'],
      [['esmalte base agua','esmalte base d'],'br-esmalte-base-agua'],
      [['seladora concentrada','seladora madeira concentrada'],'br-seladora-madeira-conc'],
      [['colorlac'],'br-colorlac'],
      [['colorbase'],'br-colorbase'],
      [['colordur'],'br-colordur'],
      [['colorlux'],'br-colorlux'],
      [['quick primer'],'br-quick-primer'],
      [['primer pu hs 5','primer pu hs 5:1'],'br-primer-pu-hs'],
      [['primer pu hs 8','primer pu hs 8:1'],'br-primer-pu-hs-81'],
      [['primer cromato','cromato de zinco'],'br-primer-cromato-zinco'],
      [['primer sintetico'],'br-primer-sintetico'],
      [['primer colorfill','colorfill'],'br-primer-colorfill'],
      [['primer universal'],'br-primer-universal'],
      [['eliminador de cratera','aditivo cratera'],'br-aditivo-cratera'],
      [['catalisador esmalte'],'br-catalisador-esmalte'],
      [['acelerador de secagem','acelerador secagem'],'br-acelerador-secagem'],
      [['pasta fosqueante','fosqueante'],'br-pasta-fosqueante'],
      [['wash primer','preto fosco vinil'],'br-wash-primer'],
      [['batida de pedra'],'br-batida-pedra'],
      [['seladora para plastico','seladora plastico'],'br-seladora-plastico'],
      [['massa rapida'],'br-massa-rapida'],
      [['removedor pastoso'],'br-removedor-pastoso'],
      [['pano pega po','pega po'],'br-pano-pega-po'],
      [['restaura plastico','restaura plast'],'br-restaura-plastico'],
      [['vedador de capo','vedador capo'],'br-vedador-capo'],
      [['profissional economico'],'br-profissional-economico'],
      [['telhas tijolos','resina acrilica base agua'],'br-telhas-tijolos-resina'],
      [['resina acrilica base solvente','base solvente'],'br-resina-base-solvente'],
      [['gesso drywall','fundo e acabamento drywall'],'br-gesso-drywall'],
      [['verniz copal','copal verniz'],'br-verniz-copal'],
      [['verniz filtro','filtro solar verniz'],'br-verniz-filtro-solar'],
      [['verniz maritimo'],'br-verniz-maritimo'],
      [['seladora para madeira','seladora madeira'],'br-seladora-madeira'],
      [['fundo preparador'],'br-fundo-preparador'],
      [['massa corrida'],'br-massa-corrida'],
      [['massa acrilica'],'br-massa-acrilica'],
      [['selador acrilico'],'br-selador-acrilico'],
      [['thinner 6137','thinner de limpeza'],'br-thinner-diluente'],
    ];
    for(const [keys, base] of brMap){
      if(keys.some(k => n.includes(k))) return '/products/'+base+'.webp';
    }

    // Detect container size from product name
    function sizeVariant(){
      if(/0[,.]9\s*l|900\s*m[l]|quarto/.test(n)) return '-quarto';
      if(/3[,.]6\s*l|3[,.]2\s*l|[45]\s*l[ts^]|[45]\s*lts|gal[aã]o|1\/4/.test(n)) return '-galao';
      return '';
    }

    const suf = sizeVariant();

    const m = [
      [['aguarras','diluente aguarras'],'diluente-aguarras'],
      [['aquacryl super premium'],'aquacryl-super-premium'],
      [['metalatex litoral'],'metalatex-litoral'],
      [['metalatex elastic'],'metalatex-elastic'],
      [['metalatex bactercryl','bactercryl'],'metalatex-bactercryl'],
      [['metalatex super lavavel brilho','lavavel brilho'],'metalatex-super-lavavel-brilho'],
      [['metalatex super lavavel fosco','lavavel fosco'],'metalatex-super-lavavel-fosco'],
      [['metalatex requinte','requinte'],'metalatex-requinte'],
      [['efeitos especiais'],'efeitos-especiais'],
      [['texturarte'],'texturarte'],
      [['eco resina termica','resina termica'],'eco-resina-termica'],
      [['esmalte sintetico super secagem'],'esmalte-sintetico-super-secagem'],
      [['esmalte sintetico super protecao'],'esmalte-sintetico-super-protecao'],
      [['eco esmalte'],'eco-esmalte'],
      [['esmalte sintetico'],'esmalte-sintetico-tradicional'],
      [['eco epoxi'],'eco-epoxi'],
      [['novacor piso ultra','piso ultra'],'novacor-piso-ultra'],
      [['novacor piso premium','piso premium'],'novacor-piso-premium'],
      [['novacor extra'],'novacor-extra'],
      [['novacor cobre mais','cobre mais'],'novacor-cobre-mais'],
      [['novacor esmalte','esmalte novacor'],'novacor-esmalte-sintetico'],
      [['kem tone','kemtone'],'kem-tone'],
      [['gesso','drywall'],'novacor-gesso-drywall'],
      [['massa corrida'],'massa-corrida'],
      [['massa acrilica'],'massa-acrilica'],
      [['fundo preparador','eco fundo'],'eco-fundo-preparador'],
      [['restauracao'],'restauracao'],
      [['novacor resina impermeabilizante'],'novacor-resina-impermeabilizante'],
      [['eco resina impermeabilizante','resina impermeabilizante'],'eco-resina-impermeabilizante'],
      [['super galvite','galvite'],'super-galvite'],
      [['verniz shertol','shertol'],'verniz-shertol'],
      [['verniz filtro solar','filtro solar'],'verniz-filtro-solar'],
      [['verniz maritimo'],'verniz-maritimo'],
      [['verniz copal','copal'],'verniz-copal'],
      [['seladora para madeira','seladora madeira'],'seladora-madeira'],
      [['corante xadrez','xadrez'],'corante-xadrez'],
      [['corante globocor','globocor'],'corante-globocor'],
      [['tinta premium'],'tinta-premium'],
    ];
    for(const [keys, base] of m){
      if(keys.some(k => n.includes(k))){
        if(suf) return _setImg('/products/'+base+suf+'.webp');
        return _setImg('/products/'+base+'.webp');
      }
    }
    return _setImg(null);
  }

  function _isArteUrbanaSpray(p){
    const n = (p.name||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    return n.includes('arte urbana') || n.includes('arte-urbana');
  }

  function renderProductRow(p){
    const isSpray = _isArteUrbanaSpray(p);
    const img = isSpray ? null : getProductImage(p);
    const bg = productBg(p);
    const emoji = getCategoryEmoji(p.category);
    const price = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
    const stk = (p.stock !== undefined && p.stock !== null) ? ' · ' + p.stock + ' un' : '';
    let icContent, icStyle;
    if(isSpray){
      icStyle = 'background:'+bg+';overflow:hidden;padding:0;position:relative;';
      icContent = '<img src="/products/arte-urbana-can.webp" alt="" style="position:absolute;bottom:0;left:50%;transform:translateX(-50%);height:100%;width:auto;object-fit:contain;">';
    } else {
      icContent = img
        ? '<img src="'+img+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">'
        : (hasProductColor(p) ? '' : emoji);
      icStyle = img ? 'background:#f5f5f5;overflow:hidden;padding:0;' : 'background:'+bg+';';
    }
    const inactive = p.active === false;
    const pidJs = escapeJsArg(p.id);
    return '<div class="mkt-row"'+(inactive?' style="opacity:.5"':'')+' onclick="openProductDetail(\''+pidJs+'\')">'
      + '<div class="mkt-row-ic" style="'+icStyle+'">'+icContent+'</div>'
      + '<div class="mkt-row-info"><div class="mkt-row-name">'+escapeHtml(p.name||'')+(inactive?' <span style="font-size:10px;color:var(--muted);">(inativo)</span>':'')+'</div>'
      + '<div class="mkt-row-sub">'+(p.code?('Cód '+escapeHtml(String(p.code))):'')+stk+'</div>'
      + '<div class="mkt-row-price">'+price+'</div></div>'
      + '<button class="mkt-row-add" onclick="event.stopPropagation();openProductDetail(\''+pidJs+'\')">+ Carrinho</button>'
      + '</div>';
  }

  function _mktSearchImpl(q){
    q = (q||'').trim().toLowerCase();
    const searchSec = document.getElementById('mkt-search-section');
    const secs = document.querySelectorAll('#mkt-sections .mkt-menu-sec');
    if(!q){
      if(searchSec) searchSec.style.display = 'none';
      const activeTab = document.querySelector('.mkt-tab.active');
      const activeKey = activeTab ? activeTab.getAttribute('data-key') : null;
      let shown = false;
      secs.forEach(s => {
        const on = s.getAttribute('data-key') === activeKey;
        s.style.display = on ? 'block' : 'none';
        if(on) shown = true;
      });
      if(!shown && secs[0]) secs[0].style.display = 'block';
      return;
    }
    secs.forEach(s => { s.style.display = 'none'; });
    const res = (mktProducts||[]).filter(p =>
      (p.name||'').toLowerCase().includes(q) || String(p.code||'').toLowerCase().includes(q));
    const grid = document.getElementById('mkt-search-grid');
    const title = document.getElementById('mkt-search-title');
    if(title) title.textContent = res.length > 60
      ? (res.length + ' resultados (mostrando 60 — refine a busca)')
      : (res.length + ' resultado(s)');
    if(grid){
      if(res.length){
        grid.innerHTML = res.slice(0,60).map(renderProductRow).join('');
      } else if(typeof emptyState === 'function'){
        grid.innerHTML = emptyState({
          icon: '🔎',
          title: 'Nenhum produto encontrado',
          message: 'Tente buscar outra palavra ou volte pra todos os produtos.',
          actionLabel: 'Limpar busca',
          actionOnclick: "var i=document.getElementById('mkt-search');if(i){i.value='';i.dispatchEvent(new Event('input'));}"
        });
      } else {
        grid.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nenhum produto encontrado</div>';
      }
    }
    if(searchSec) searchSec.style.display = 'block';
  }
  const mktSearch = (typeof window !== 'undefined' && window.debounce ? window.debounce(_mktSearchImpl, 200) : _mktSearchImpl);

  function openProductDetail(productId){
    const p = mktProducts.find(x => x.id === productId);
    if(!p){ showModal('product-detail-modal'); return; }
    const bg = productBg(p);
    const emoji = getCategoryEmoji(p.category);
    const modal = document.getElementById('product-detail-modal');
    const sheet = modal.querySelector('.sheet');
    const priceFormatted = 'R$' + Number(p.price||0).toFixed(2).replace('.',',');
    sheet.innerHTML = '<div class="sheet-handle"></div>'
      + '<div style="height:140px;background:'+(getProductImage(p)?'#f5f5f5':bg)+';border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:60px;margin-bottom:16px;overflow:hidden;">'+(getProductImage(p)?'<img src="'+getProductImage(p)+'" alt="" style="width:100%;height:100%;object-fit:cover;">':(hasProductColor(p)?'':emoji))+'</div>'
      + '<div style="font-size:20px;font-weight:800;font-family:Syne,sans-serif;">'+escapeHtml(p.name||'')+'</div>'
      + '<div style="font-size:12px;color:var(--muted);margin-top:2px;margin-bottom:10px;">'+(p.code ? 'Cód. '+escapeHtml(p.code)+' · ' : '')+escapeHtml(p.line||'')+'</div>'
      + (p.description ? '<div style="font-size:13.5px;color:#555;line-height:1.5;margin-bottom:14px;">'+escapeHtml(p.description)+'</div>' : '')
      + '<div style="display:flex;gap:10px;margin-bottom:14px;">'
      + (p.rendimento ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Rendimento</div><div style="font-size:14px;font-weight:700;">'+escapeHtml(String(p.rendimento))+'</div></div>' : '')
      + (p.demaos ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Demãos</div><div style="font-size:14px;font-weight:700;">'+escapeHtml(String(p.demaos))+'</div></div>' : '')
      + (p.secagem ? '<div style="flex:1;background:var(--cream);border-radius:12px;padding:10px;text-align:center;"><div style="font-size:11px;color:var(--muted);">Secagem</div><div style="font-size:14px;font-weight:700;">'+escapeHtml(String(p.secagem))+'</div></div>' : '')
      + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">'
        + '<div style="font-size:22px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">'+priceFormatted+'</div>'
        + '<div class="qty-picker">'
          + '<button class="qty-btn" onclick="var i=document.getElementById(\'detail-qty\');i.value=Math.max(1,+i.value-1);document.getElementById(\'detail-qty-total\').textContent=\'R$\'+(Math.max(1,+i.value)*'+Number(p.price||0)+').toFixed(2).replace(\'.\',\',\')">−</button>'
          + '<input id="detail-qty" type="number" min="1" value="1" class="qty-input" oninput="var v=Math.max(1,+this.value||1);this.value=v;document.getElementById(\'detail-qty-total\').textContent=\'R$\'+(v*'+Number(p.price||0)+').toFixed(2).replace(\'.\',\',\')">'
          + '<button class="qty-btn" onclick="var i=document.getElementById(\'detail-qty\');i.value=+i.value+1;document.getElementById(\'detail-qty-total\').textContent=\'R$\'+(+i.value*'+Number(p.price||0)+').toFixed(2).replace(\'.\',\',\')">+</button>'
        + '</div>'
      + '</div>'
      + '<button onclick="addToCart(\''+escapeJsArg(p.id)+'\',+document.getElementById(\'detail-qty\').value);closeModals()" style="width:100%;padding:14px;background:var(--p1);color:#fff;border:none;border-radius:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">+ Adicionar ao Carrinho · <span id="detail-qty-total">'+priceFormatted+'</span></button>';
    showModal('product-detail-modal');
  }

  // Estado interno do mkt (cache + agrupamento por categoria).
  let _mktLoadedAt = 0;
  let _mktGrouped = {};
  const _MKT_TTL = 5 * 60 * 1000; // 5 min

  function renderMktUI(){
    _mktGrouped = {};
    mktProducts.forEach(p => { const k = mktClassify(p); (_mktGrouped[k] = _mktGrouped[k] || []).push(p); });
    const orderedKeys = MKT_MENUS.map(m => m.key).concat(['outros']).filter(k => _mktGrouped[k] && _mktGrouped[k].length);
    const total = mktProducts.length;

    const tabsEl = document.getElementById('mkt-tabs');
    if(tabsEl){
      const todosTab = total
        ? '<div class="mkt-tab active" data-key="todos" onclick="mktTab(\'todos\')">📦 Todos ('+total+')</div>'
        : '';
      const catTabs = orderedKeys.map(k =>
        '<div class="mkt-tab" data-key="'+k+'" onclick="mktTab(\''+k+'\')">'
        + MKT_MENU_LABEL[k] + ' (' + _mktGrouped[k].length + ')</div>'
      ).join('');
      tabsEl.innerHTML = todosTab + catTabs || '<div class="mkt-tab active">Sem produtos</div>';
    }
    const secEl = document.getElementById('mkt-sections');
    if(secEl){
      if(orderedKeys.length === 0){
        secEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">Nenhum produto cadastrado</div>';
      } else {
        const firstBatch = mktProducts.slice(0, 80);
        const needsSentinel = mktProducts.length > 80;
        const todosHtml = '<div class="mkt-menu-sec" data-key="todos" data-rendered="1" style="display:block">'
          + '<div class="mkt-section-title">📦 Todos os produtos · '+total+' itens</div>'
          + '<div class="mkt-products" id="mkt-todos-grid">'+firstBatch.map(renderProductRow).join('')
            + (needsSentinel ? '<div class="mkt-scroll-sentinel" style="grid-column:1/-1;height:1px;"></div>' : '')
          + '</div>'
          + '</div>';
        const catHtml = orderedKeys.map(k =>
          '<div class="mkt-menu-sec" data-key="'+k+'" data-rendered="0" style="display:none">'
          + '<div class="mkt-section-title">'+MKT_MENU_LABEL[k]+' · '+_mktGrouped[k].length+' itens <span style="color:var(--muted);font-weight:600;">(de '+total+' no total)</span></div>'
          + '<div class="mkt-products"></div>'
          + '</div>'
        ).join('');
        secEl.innerHTML = todosHtml + catHtml;
        if(mktProducts.length > 80){
          const grid = document.getElementById('mkt-todos-grid');
          const sentinel = grid && grid.querySelector('.mkt-scroll-sentinel');
          if(grid && sentinel){
            let cursor = 80;
            function _mktAppendBatch(){
              const slice = mktProducts.slice(cursor, cursor + 80);
              if(slice.length === 0) return;
              const s = grid.querySelector('.mkt-scroll-sentinel');
              if(s) s.remove();
              grid.insertAdjacentHTML('beforeend', slice.map(renderProductRow).join(''));
              cursor += slice.length;
              if(cursor < mktProducts.length){
                const ns = document.createElement('div');
                ns.className = 'mkt-scroll-sentinel';
                ns.style.cssText = 'grid-column:1/-1;height:1px;';
                grid.appendChild(ns);
                try {
                  const io = new IntersectionObserver(entries => {
                    if(entries[0].isIntersecting){ io.disconnect(); _mktAppendBatch(); }
                  }, { rootMargin: '300px' });
                  io.observe(ns);
                } catch(_){ _mktAppendBatch(); }
              }
            }
            try {
              const io = new IntersectionObserver(entries => {
                if(entries[0].isIntersecting){ io.disconnect(); _mktAppendBatch(); }
              }, { rootMargin: '300px' });
              io.observe(sentinel);
            } catch(_){ _mktAppendBatch(); }
          }
        }
      }
    }
  }

  const _MKT_HIDDEN = /\bbase\s+(vy|z|xy|w|ly|e|f)\b/i;
  function _isMktHidden(p){ return _MKT_HIDDEN.test(p.name||''); }

  async function loadMktProducts(_attempt){
    _attempt = _attempt || 0;
    const el = () => document.getElementById('mkt-sections');
    const setSec = (msg) => { const e = el(); if(e) e.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--muted);font-size:13px;">'+msg+'</div>'; };
    if(mktProducts.length && (Date.now() - _mktLoadedAt) < _MKT_TTL){
      renderMktUI();
      return;
    }
    // Skeleton loading (só na primeira carga, não no retry que mostra erro acima)
    if(_attempt === 0){
      const e = el();
      if(e && typeof skeletonRows === 'function'){
        e.innerHTML = '<div style="grid-column:1/-1;">' + skeletonRows(6, { height: '70px' }) + '</div>';
      }
    }
    const sb = getSupabase();
    if(!sb){
      if(_attempt < 20){ setTimeout(() => loadMktProducts(_attempt + 1), 500); return; }
      const e = el();
      if(e && typeof errorState === 'function'){
        e.innerHTML = '<div style="grid-column:1/-1;">' + errorState('Não foi possível conectar.', () => loadMktProducts(0)) + '</div>';
      } else {
        setSec('Não foi possível conectar. <a href="#" onclick="loadMktProducts(0);return false" style="color:var(--p1);font-weight:700;">Tentar de novo</a>');
      }
      return;
    }
    try {
      const PAGE = 1000;
      const byId = new Map();
      for(let pageNo = 0; pageNo < 30; pageNo++){
        const from = pageNo * PAGE;
        const { data, error } = await sb.from('products').select('*').order('name').range(from, from + PAGE - 1);
        if(error) throw error;
        if(!data || data.length === 0) break;
        const before = byId.size;
        data.forEach(p => { byId.set(p.id, p); });
        if(byId.size === before) break;       // sem progresso → evita loop infinito
        if(data.length < PAGE) break;          // última página
      }
      mktProducts = Array.from(byId.values()).filter(p => !_isMktHidden(p));
      _mktLoadedAt = Date.now();
      renderMktUI();
    } catch(e){
      console.error('loadMktProducts error:', e && e.message || e);
      const target = el();
      if(target && typeof errorState === 'function'){
        target.innerHTML = '<div style="grid-column:1/-1;">' + errorState('Erro ao carregar produtos: ' + String(e && e.message || e), () => loadMktProducts(0)) + '</div>';
      } else {
        setSec('Erro ao carregar produtos: ' + escapeHtml(String(e && e.message || e)) + ' <a href="#" onclick="loadMktProducts(0);return false" style="color:var(--p1);font-weight:700;">Tentar de novo</a>');
      }
    }
  }

  // ── Camiseta personalizada (loja interna) ────────────────────────────────
  function changeQty(delta) {
    shirtQty = Math.max(1, shirtQty + delta);
    document.getElementById('shirt-qty').textContent = shirtQty;
    const base = 39.90;
    const disc = shirtQty >= 5 ? 0.85 : 1;
    document.getElementById('shirt-total').textContent = 'R$' + (base * shirtQty * disc).toFixed(2).replace('.',',');
  }

  function setSizeBtn(el) {
    document.querySelectorAll('.shirt-size-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }

  function setShirtColor(el, color) {
    document.querySelectorAll('.shirt-color-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    const body = document.getElementById('shirt-body');
    if (body) {
      body.setAttribute('fill', color);
      const isDark = ['#1a1a2e','#000','#8338ec','#e63946'].includes(color);
      const placeholder = document.getElementById('shirt-chest-placeholder');
      if (placeholder) placeholder.style.color = isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.45)';
      if (placeholder) placeholder.style.borderColor = isDark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.25)';
    }
  }

  function openShirtZoom() {
    const overlay = document.getElementById('shirt-zoom-overlay');
    const inner = document.getElementById('shirt-zoom-inner');
    const mockup = document.getElementById('shirt-mockup');
    if (!overlay || !inner || !mockup) return;
    const clone = mockup.cloneNode(true);
    inner.querySelectorAll('.shirt-mockup-clone').forEach(n => n.remove());
    clone.classList.add('shirt-mockup-clone');
    inner.appendChild(clone);
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeShirtZoom() {
    const overlay = document.getElementById('shirt-zoom-overlay');
    if (overlay) overlay.classList.remove('show');
    document.body.style.overflow = '';
  }

  function buyShirt() {
    // Double-click guard: addToCart() abre modal do carrinho com setTimeout 300ms;
    // sem guard, dois taps rápidos somam quantidade dupla. Trava o botão por 1s.
    const btn = document.getElementById('buy-shirt-btn');
    if(btn && btn.dataset._loading) return;
    const restore = setButtonLoading(btn, 'Adicionando...');
    try {
      const unit = shirtQty >= 5 ? 39.90 * 0.85 : 39.90;
      addToCart('shirt-personalizada', shirtQty, 'Camiseta Personalizada', unit);
    } finally {
      setTimeout(restore, 1000);
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.mkt = {
    // cores / classificação
    resolveColorHex, productBg, hasProductColor, mktClassify,
    // estado do usuário (carrinho, ai_logo_gen_count, seen_stories)
    loadUserState, saveCart, updateCartBadge,
    // carrinho
    addToCart, changeCartQty, renderCartModal, removeFromCart, submitCartOrder,
    // catálogo
    getCategoryEmoji, getProductImage, renderProductRow, openProductDetail,
    mktTab, mktSearch, renderMktUI, loadMktProducts,
    // camiseta personalizada
    changeQty, setSizeBtn, setShirtColor, openShirtZoom, closeShirtZoom, buyShirt,
  };
})();

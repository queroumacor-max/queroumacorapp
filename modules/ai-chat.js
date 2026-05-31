// modules/ai-chat.js — feature "Seu Zé" (assistente IA + gerador de orçamento
// por IA) extraída do app.js. Fase 4 da modularização (etapa 1: COPIA pra
// criar a camada; próximo PR migra call sites e remove duplicatas do app.js).
//
// Depende de globals do app.js:
//   showModal, checkProAccess, gateProClient, apiPost, toast, escapeHtml,
//   appAlert, parseBRL, fmtBRL, dateBR, showError, loadMaterialSuggestions,
//   gerarPDFOrcamento, compartilharOrcamento, salvarOrcamento, window.ERR.
//
// Observação: `_lastOrcData` permanece declarado em app.js como `let` de top
// level (compartilhado com `_buildOrcDoc` / `salvarOrcamento` / PDF). Este
// módulo, na etapa de COPIA, mantém sua própria cópia local e também espelha
// em `window._lastOrcData` pra próxima etapa (migração de call sites) já
// achar o estado pronto.
(function(){
  'use strict';

  function openAiOrcamento(){
    // Fazer orçamento é livre; só a geração por IA exige PRO.
    // Zera os itens detalhados a cada abertura (senão vazam de um cliente pro
    // próximo, já que o modal persiste no DOM).
    const items = document.getElementById('ai-orc-items');
    if(items) items.innerHTML = '';
    showModal('ai-orc-modal');
  }

  function openAiChat(){
    if(!checkProAccess()){ showModal('pro-modal'); return; }
    showModal('ai-chat-modal');
  }

  // AI Chat - knowledge base for painting professionals
  const _aiKnowledge = {
    'tinta':    'Para paredes internas, recomendo tinta acrílica acetinada (melhor custo-benefício). Para áreas úmidas, use tinta acrílica semi-brilho. Para fachadas, tinta elastomérica. Rendimento médio: 10-12m²/L por demão.',
    'textura':  'Texturas mais pedidas: Grafiato (rolo texturizado), Marmorato (efeito mármore com espátula), Cimento Queimado (2-3 demãos de massa + verniz). Preço médio: R$35-60/m² dependendo da técnica.',
    'preco':    'Valores médios de mão de obra: Pintura simples R$18-25/m², Textura R$35-60/m², Epóxi R$50-80/m², Fachada R$25-40/m². Sempre inclua material + mão de obra + deslocamento no orçamento.',
    'epoxi':    'Piso epóxi: lixar o piso, aplicar primer epóxi, 2-3 demãos de epóxi (intervalo de 12h). Rendimento: 4-6m²/L. Cura total: 7 dias. Preço médio: R$50-80/m² com material.',
    'rendimento':'Tinta acrílica: 10-12m²/L. Massa corrida: 4-6m²/L. Selador: 8-10m²/L. Textura: 2-4m²/L. Sempre compre 10% a mais como margem de segurança.',
    'preparo':  'Preparação é 70% do resultado! 1) Limpe a parede. 2) Lixe com lixa 150. 3) Aplique massa corrida nas imperfeições. 4) Lixe novamente com 220. 5) Aplique selador. 6) Pinte com rolo de lã.',
    'cor':      'Tendências: tons terrosos (terracota, argila), verde-salvia, azul petróleo. Para ambientes pequenos: cores claras ampliam. Para destaque: parede accent em tom mais escuro. Sempre teste uma amostra antes!',
    'ferramenta':'Kit básico: rolo de lã 23cm, trincha 2" e 3", bandeja, fita crepe, lona plástica, espátula, lixa 150 e 220, escada. Para textura: desempenadeira de aço e espátula de plástico.',
    'infiltracao':'Antes de pintar parede com infiltração: 1) Resolva a causa da infiltração. 2) Raspe a área afetada. 3) Aplique impermeabilizante. 4) Massa corrida após secar. 5) Selador. 6) Pintura. Sem resolver a causa, volta sempre.',
    'calculo':  'Cálculo rápido: meça comprimento × altura de cada parede. Subtraia portas (1.6m²) e janelas (2.4m²). Multiplique pelo número de demãos. Divida pelo rendimento da tinta (10m²/L). Adicione 10% de margem.'
  };

  let _aiChatHistory = [];

  async function sendAiChat(textArg, speakReply){
    if (!gateProClient('Chat com o Seu Zé')) return;
    let text;
    if(textArg){
      text = String(textArg).trim();
    } else {
      const input = document.getElementById('ai-chat-input');
      text = input ? input.value.trim() : '';
      if(input) input.value = '';
    }
    if(!text) return;
    const msgsEl = document.getElementById('ai-chat-msgs');

    msgsEl.innerHTML += '<div style="display:flex;gap:8px;margin-bottom:12px;justify-content:flex-end;"><div style="background:var(--ink);color:#fff;border-radius:14px;padding:10px 14px;font-size:13px;max-width:85%;">'+escapeHtml(text)+'</div></div>';
    msgsEl.scrollTop = msgsEl.scrollHeight;

    const typingId = 'typing-' + Date.now();
    msgsEl.innerHTML += '<div id="'+typingId+'" style="display:flex;gap:8px;margin-bottom:12px;"><img src="img/seu-ze.webp" alt="Seu Zé" style="width:28px;height:28px;border-radius:50%;object-fit:cover;object-position:center top;background:#1a1a2e;flex-shrink:0;"><div style="background:var(--cream);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--muted);max-width:85%;"><span style="display:inline-block;animation:typing 1.2s infinite;">•</span><span style="display:inline-block;animation:typing 1.2s infinite .15s;">•</span><span style="display:inline-block;animation:typing 1.2s infinite .3s;">•</span></div></div>';
    msgsEl.scrollTop = msgsEl.scrollHeight;

    let reply = null;
    let aiError = null;
    let aborted = false;
    try {
      // Cancela qualquer chat-ai anterior em voo (usuário mandou pergunta
      // nova antes da primeira terminar — só queremos a última resposta).
      // Se o user sair da tela do modal, openAiChat/closeModals chama
      // cancelApi('ai-chat:send') e a Promise resolve com aborted=true.
      const res = await apiPostCancellable('ai-chat:send', '/api/chat-ai', { message: text, history: _aiChatHistory });
      if (res && res.aborted) { aborted = true; }
      else if (res && res.ok && res.data && res.data.reply) reply = res.data.reply;
      else aiError = (res && res.data && res.data.error) || (res && res.error);
    } catch(e) {
      aiError = String(e?.message || e);
    }

    // Cancelamento silencioso: usuário saiu da tela ou disparou nova pergunta.
    // Remove o typing indicator e segue — NÃO pinta resposta órfã.
    if (aborted) {
      const typingEl = document.getElementById(typingId);
      if (typingEl) typingEl.remove();
      return;
    }

    if (!reply) {
      console.warn('chat-ai fallback:', aiError && aiError.message || aiError);
      const query = text.toLowerCase();
      for(const [key, answer] of Object.entries(_aiKnowledge)){
        if(query.includes(key)){ reply = answer; break; }
      }
      if(!reply){
        if(query.match(/quanto|valor|cobr|preci/)) reply = _aiKnowledge['preco'];
        else if(query.match(/quant|litro|galao|lata/)) reply = _aiKnowledge['rendimento'];
        else if(query.match(/prepar|lixa|massa|antes/)) reply = _aiKnowledge['preparo'];
        else if(query.match(/umid|mofo|infiltr|vazam/)) reply = _aiKnowledge['infiltracao'];
        else if(query.match(/qual tinta|melhor tinta|tipo.*tinta/)) reply = _aiKnowledge['tinta'];
        else if(query.match(/calcul|medir|medid|area/)) reply = _aiKnowledge['calculo'];
        else if(query.match(/tend|cor|tom|paleta/)) reply = _aiKnowledge['cor'];
        else if(query.match(/ferrament|rolo|pincel|trincha/)) reply = _aiKnowledge['ferramenta'];
        else reply = 'Conexão com o Seu Zé falhou no momento. Tente novamente em alguns segundos.';
      }
      if (!/^(Sou o Seu Zé|Sou um assistente virtual)/i.test(reply)) {
        reply = 'Sou o Seu Zé (assistente virtual). Qualquer confirmação de informações ditas aqui eu recomendo checar com o representante da marca ou lojista que você escolher.\n\n' + reply;
      }
    } else {
      _aiChatHistory.push({ role: 'user', content: text });
      _aiChatHistory.push({ role: 'assistant', content: reply });
      if (_aiChatHistory.length > 20) _aiChatHistory = _aiChatHistory.slice(-20);
    }

    const typingEl = document.getElementById(typingId);
    if (typingEl) typingEl.remove();
    const formatted = escapeHtml(reply).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    msgsEl.innerHTML += '<div style="display:flex;gap:8px;margin-bottom:12px;"><img src="img/seu-ze.webp" alt="Seu Zé" style="width:28px;height:28px;border-radius:50%;object-fit:cover;object-position:center top;background:#1a1a2e;flex-shrink:0;"><div style="background:var(--cream);border-radius:14px;padding:10px 14px;font-size:13px;color:var(--ink);max-width:85%;line-height:1.45;">'+formatted+'</div></div>';
    msgsEl.scrollTop = msgsEl.scrollHeight;
    if(speakReply && reply) falarSeuZe(reply);
  }

  // ══ MODO CONVERSAÇÃO POR VOZ COM O SEU ZÉ (PRO) ══
  // Grava a fala → Whisper transcreve → manda no chat-ai → resposta do
  // Seu Zé é falada de volta via OpenAI TTS.
  let _aiVoiceRecorder = null;
  let _aiVoiceChunks = [];
  let _aiVoiceStream = null;
  let _aiVoiceAutoStop = null;
  let _aiVoiceAudio = null;

  async function aiChatToggleVoice(){
    if(_aiVoiceRecorder && _aiVoiceRecorder.state === 'recording'){
      aiChatStopVoice();
      return;
    }
    // Se está tocando uma resposta, corta
    if(_aiVoiceAudio && !_aiVoiceAudio.paused){
      try { _aiVoiceAudio.pause(); } catch(e){}
      _aiVoiceAudio = null;
    }
    if (!gateProClient('Conversa por voz com o Seu Zé')) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ toast('Seu navegador não suporta gravação de áudio'); return; }
    if(typeof MediaRecorder === 'undefined'){ toast('Seu navegador não suporta MediaRecorder'); return; }
    try { _aiVoiceStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch(e){ toast('Permissão de microfone negada'); return; }
    _aiVoiceChunks = [];
    try { _aiVoiceRecorder = new MediaRecorder(_aiVoiceStream); }
    catch(e){
      toast('Erro ao iniciar gravação: ' + e.message);
      if(_aiVoiceStream){ _aiVoiceStream.getTracks().forEach(t => t.stop()); _aiVoiceStream = null; }
      return;
    }
    _aiVoiceRecorder.ondataavailable = e => { if(e.data && e.data.size > 0) _aiVoiceChunks.push(e.data); };
    _aiVoiceRecorder.onstop = async () => {
      const mimeType = _aiVoiceRecorder.mimeType || 'audio/webm';
      const blob = new Blob(_aiVoiceChunks, { type: mimeType });
      if(_aiVoiceStream){ _aiVoiceStream.getTracks().forEach(t => t.stop()); _aiVoiceStream = null; }
      await aiChatHandleVoice(blob);
    };
    _aiVoiceRecorder.start();
    const btn = document.getElementById('ai-chat-mic-btn');
    if(btn){ btn.innerHTML = '⏹'; btn.style.background = '#c00'; btn.title = 'Parar e enviar'; }
    if(_aiVoiceAutoStop) clearTimeout(_aiVoiceAutoStop);
    _aiVoiceAutoStop = setTimeout(() => { if(_aiVoiceRecorder && _aiVoiceRecorder.state === 'recording') aiChatStopVoice(); }, 60000);
  }

  function aiChatStopVoice(){
    if(_aiVoiceRecorder && _aiVoiceRecorder.state === 'recording') _aiVoiceRecorder.stop();
    if(_aiVoiceAutoStop){ clearTimeout(_aiVoiceAutoStop); _aiVoiceAutoStop = null; }
    const btn = document.getElementById('ai-chat-mic-btn');
    if(btn){ btn.innerHTML = '🎤'; btn.style.background = 'linear-gradient(135deg,#8338ec,var(--p1))'; btn.title = 'Falar com o Seu Zé'; }
  }

  async function aiChatHandleVoice(blob){
    toast('Transcrevendo sua fala...');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'voice.webm');
      const { ok, data } = await apiPost('/api/transcribe', fd, { multipart: true });
      if(!ok || !data || !data.text){
        toast('Não consegui entender: ' + ((data && data.error) || 'tente de novo'));
        return;
      }
      await sendAiChat(data.text, true);
    } catch(e){
      showError('ai-chat-voice', e, 'Não foi possível processar o áudio. Tente novamente.');
    }
  }

  async function falarSeuZe(text){
    if(!text) return;
    // Registra um AbortController sob a chave 'ai-chat:tts'. Se uma nova
    // resposta chegar (ou cancelApi for chamado no fechamento do modal),
    // o fetch é abortado e não toca áudio órfão.
    const ac = (typeof registerApiCtrl === 'function') ? registerApiCtrl('ai-chat:tts') : null;
    try {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 1500) })
      };
      if (ac) init.signal = ac.signal;
      const r = await fetch('/api/tts', init);
      if(!r.ok){
        console.warn('tts error: status', r.status);
        try { if(_aiVoiceAudio){ _aiVoiceAudio.pause(); } } catch(_) {}
        _aiVoiceAudio = null;
        if(r.status === 429){ try { toast(window.ERR ? window.ERR.RATE_LIMIT : 'Muitas tentativas.'); } catch(_) {} }
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if(_aiVoiceAudio){ try { _aiVoiceAudio.pause(); } catch(e){} }
      _aiVoiceAudio = new Audio(url);
      _aiVoiceAudio.play().catch(e => console.warn('audio play:', e && e.message || e));
      _aiVoiceAudio.onended = () => { URL.revokeObjectURL(url); _aiVoiceAudio = null; };
    } catch(e){
      // AbortError = cancelamento silencioso (modal fechou ou nova resposta
      // chegou). Não mostra toast nem zera audio que esteja tocando algo válido.
      if (e && e.name === 'AbortError') return;
      console.warn('falarSeuZe:', e && e.message || e);
      try { if(_aiVoiceAudio){ _aiVoiceAudio.pause(); } } catch(_) {}
      _aiVoiceAudio = null;
      try { toast(window.ERR ? window.ERR.NETWORK : 'Sem conexão.'); } catch(_) {}
    }
  }

  async function sugerirEscopoIA(btn){
    if(!checkProAccess()){ showModal('pro-modal'); return; }
    const servico = document.getElementById('ai-orc-servico').value;
    const area = document.getElementById('ai-orc-area').value || '?';
    const comodos = document.getElementById('ai-orc-comodos').value || '?';
    const numDemaos = document.getElementById('ai-orc-demaos').value || '2';
    const condEl = document.getElementById('ai-orc-condicao');
    const condTxt = condEl && condEl.options[condEl.selectedIndex] ? condEl.options[condEl.selectedIndex].text : '';
    const obsEl = document.getElementById('ai-orc-obs');
    const orig = btn ? btn.innerHTML : '';
    if(btn){ btn.disabled = true; btn.innerHTML = '✨ Gerando...'; }
    const prompt = 'Você é um pintor profissional. Escreva, em português, um escopo de serviço objetivo (4 a 6 linhas, sem títulos) para um orçamento de "'+servico+'", área aproximada de '+area+' m², '+comodos+' cômodo(s), '+numDemaos+' demão(s), condição da superfície: "'+condTxt+'". Liste preparação, aplicação, prazo estimado e garantia. Texto pronto para colar no orçamento.'+(obsEl && obsEl.value.trim() ? ' Considere também: '+obsEl.value.trim() : '');
    try {
      // Cancela qualquer "sugerir escopo" anterior em voo. Idêntico ao
      // padrão de ai-chat:send — usuário pode clicar 2x; só importa o último.
      const res = await apiPostCancellable('ai-orc:escopo', '/api/chat-ai', { message: prompt, history: [] });
      if (res && res.aborted) return;
      const { ok, status, data } = res;
      if(ok && data && data.reply){
        // Remove a linha de disclaimer do assistente, se vier
        let txt = String(data.reply).replace(/^\s*Sou (o Seu Zé|um assistente virtual)[^\n]*\n+/i, '').trim();
        if(obsEl) obsEl.value = txt;
        toast('Escopo sugerido pelo Seu Zé ✨');
      } else if(status === 503){
        await appAlert('A sugestão pelo Seu Zé ainda não está ativa: configure OPENAI_API_KEY ou GEMINI_API_KEY no Cloudflare Pages (Environment variables) e refaça o deploy.\n\nVocê pode preencher "Observações" manualmente e usar "Gerar Orçamento" normalmente.');
      } else {
        await appAlert('Não foi possível gerar o escopo agora.\n\n' + ((data && data.error) || ('HTTP ' + status)) + '\n\nTente novamente em instantes.');
      }
    } catch(e){
      await appAlert('Falha ao chamar o Seu Zé: ' + (e?.message || 'tente de novo'));
    } finally {
      if(btn){ btn.disabled = false; btn.innerHTML = orig; }
    }
  }

  // Adiciona uma linha de "item detalhado" no orçamento (descrição + valor).
  function addOrcItem(desc, valor){
    const wrap = document.getElementById('ai-orc-items');
    if(!wrap) return;
    const row = document.createElement('div');
    row.className = 'ai-orc-item-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;';
    const d = document.createElement('input');
    d.className = 'auth-input ai-orc-item-desc';
    d.type = 'text'; d.placeholder = 'Ex: Aplicação de massa corrida';
    d.style.cssText = 'flex:2;font-size:15px;min-width:0;';
    if(desc) d.value = desc;
    const v = document.createElement('input');
    v.className = 'auth-input ai-orc-item-val';
    v.type = 'text'; v.inputMode = 'decimal'; v.placeholder = 'R$ (opcional)';
    v.style.cssText = 'flex:1;font-size:15px;min-width:0;';
    v.setAttribute('onblur', 'fmtBRL(this)');
    if(valor) v.value = valor;
    const rm = document.createElement('button');
    rm.type = 'button'; rm.textContent = '×'; rm.setAttribute('aria-label', 'Remover');
    rm.style.cssText = 'background:none;border:none;color:var(--p4);font-size:22px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;';
    rm.onclick = () => row.remove();
    row.appendChild(d); row.appendChild(v); row.appendChild(rm);
    wrap.appendChild(row);
    d.focus();
  }

  function gerarOrcamentoIA(){
    if (!gateProClient('Orçamento com Seu Zé')) return;
    const cliente = document.getElementById('ai-orc-cliente').value.trim() || 'Cliente';
    const servico = document.getElementById('ai-orc-servico').value;
    const area = parseFloat(document.getElementById('ai-orc-area').value) || 0;
    const comodos = parseInt(document.getElementById('ai-orc-comodos').value) || 0;
    const numDemaos = parseInt(document.getElementById('ai-orc-demaos').value) || 2;
    const fator = parseFloat(document.getElementById('ai-orc-condicao').value) || 1;
    const precoM2 = parseBRL(document.getElementById('ai-orc-preco').value);
    const obs = document.getElementById('ai-orc-obs').value.trim();
    const cobranca = (document.getElementById('ai-orc-cobranca')||{}).value || 'm2';
    const valorFechado = parseBRL((document.getElementById('ai-orc-valorfechado')||{}).value);
    const materialMode = (document.getElementById('ai-orc-material')||{}).value || 'incluso';
    const matInc = materialMode !== 'cliente';
    const extras = ((document.getElementById('ai-orc-extras')||{}).value || '').trim();
    const formaPgto = (document.getElementById('ai-orc-pgto')||{}).value || 'À vista';
    const parcelas = parseInt((document.getElementById('ai-orc-parcelas')||{}).value) || 0;
    const entrada = parseBRL((document.getElementById('ai-orc-entrada')||{}).value);
    const tiposPgto = [...document.querySelectorAll('#ai-orc-tipos input[type=checkbox]:checked')].map(c=>c.value);
    const garantia = ((document.getElementById('ai-orc-garantia')||{}).value || '').trim();
    const prazoManual = ((document.getElementById('ai-orc-prazo')||{}).value || '').trim();
    // Itens detalhados que o pintor adicionou (descrição + valor opcional).
    const customItems = [...document.querySelectorAll('#ai-orc-items .ai-orc-item-row')].map(r => ({
      desc: ((r.querySelector('.ai-orc-item-desc')||{}).value || '').trim(),
      valorNum: parseBRL((r.querySelector('.ai-orc-item-val')||{}).value)
    })).filter(it => it.desc);

    if(area <= 0){ toast('Informe a área em m²'); return; }
    if(cobranca === 'fechado'){
      if(valorFechado <= 0){ toast('Informe o valor fechado'); return; }
    } else if(precoM2 <= 0){ toast('Informe o valor por m²'); return; }

    // Cálculos
    const litros = Math.ceil((area * fator * numDemaos) / 11 * 1.1);
    const l18 = Math.ceil(litros / 18);
    const custoTinta = matInc ? l18 * 320 : 0; // estimativa R$320/galão 18L premium
    const custoMaoObra = cobranca === 'fechado' ? valorFechado : area * precoM2;
    // Itens detalhados com valor somam ao total (serviços avulsos precificados).
    const customTotal = customItems.reduce((s,it)=> s + (it.valorNum > 0 ? it.valorNum : 0), 0);
    const total = (cobranca === 'fechado' ? valorFechado : (custoTinta + custoMaoObra)) + customTotal;

    const pintorName = document.getElementById('myprofile-name')?.textContent || 'Pintor';
    const hoje = dateBR(new Date());

    // Condição por extenso
    const condicaoMap = {'1':'Parede nova / massa corrida','1.2':'Parede antiga (demão extra)','1.5':'Concreto / tijolo aparente','0.8':'Teto liso'};
    const condicaoText = condicaoMap[String(fator)] || 'Parede nova';

    // Gerar itens detalhados
    let itensHtml = '';
    // Preparação
    const prepItems = [];
    if(fator >= 1.2) prepItems.push('Raspagem e lixamento de parede antiga');
    if(fator >= 1.5) prepItems.push('Aplicação de selador para concreto/tijolo');
    prepItems.push('Proteção de pisos e mobília com lona');
    prepItems.push('Fita crepe em rodapés, batentes e interruptores');
    if(fator >= 1.2) prepItems.push('Massa corrida para correção de imperfeições');
    prepItems.forEach(item => {
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>'+item+'</span><span style="color:var(--muted);">Incluso</span></div>';
    });

    // Materiais
    if(matInc){
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Tinta premium ('+litros+'L ≈ '+l18+' galões 18L)</span><span style="font-weight:600;">R$ '+custoTinta.toLocaleString('pt-BR')+'</span></div>';
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Lixa, massa, selador, fita crepe</span><span style="color:var(--muted);">Incluso</span></div>';
    } else {
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Tinta e materiais</span><span style="color:var(--muted);">Por conta do cliente</span></div>';
    }
    if(extras){
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Extras: '+escapeHtml(extras)+'</span><span style="color:var(--muted);">Incluso</span></div>';
    }

    // Mão de obra / serviço
    const diasEstimados = Math.ceil(area / 40); // ~40m²/dia
    if(cobranca === 'fechado'){
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Serviço (preço fechado)</span><span style="font-weight:600;">R$ '+valorFechado.toLocaleString('pt-BR')+'</span></div>';
    } else {
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>Mão de obra ('+area+'m² × R$'+precoM2+'/m²)</span><span style="font-weight:600;">R$ '+custoMaoObra.toLocaleString('pt-BR')+'</span></div>';
    }

    // Itens detalhados (serviços avulsos com valor individual)
    customItems.forEach(it => {
      const val = it.valorNum > 0 ? ('R$ ' + it.valorNum.toLocaleString('pt-BR')) : 'Incluso';
      const bold = it.valorNum > 0 ? 'font-weight:600;' : 'color:var(--muted);';
      itensHtml += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;"><span>'+escapeHtml(it.desc)+'</span><span style="'+bold+'">'+val+'</span></div>';
    });

    // Forma de pagamento
    const pgtoLines = [];
    pgtoLines.push('Forma: ' + formaPgto + (parcelas>1 ? ' ('+parcelas+'x)' : ''));
    if(entrada > 0) pgtoLines.push('Entrada/sinal: R$ ' + entrada.toLocaleString('pt-BR'));
    if(parcelas > 1){
      const base = Math.max(total - entrada, 0);
      pgtoLines.push(parcelas + 'x de R$ ' + (base/parcelas).toLocaleString('pt-BR',{maximumFractionDigits:2}));
    }
    if(tiposPgto.length) pgtoLines.push('Aceita: ' + tiposPgto.join(', '));
    let pgtoHtml = pgtoLines.map(l=>'<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+escapeHtml(l)+'</div>').join('');

    // Observações da IA
    // Prazo: usa o que o pintor digitou; se vazio, cai no automático pela área.
    const prazoTxt = prazoManual || (diasEstimados + ' dia' + (diasEstimados>1?'s':'') + ' úteis');
    // Garantia: editável; se vazio, assume "1 ano".
    const garantiaTxt = garantia || '1 ano';
    let aiNotes = '';
    if(obs) aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+escapeHtml(obs)+'</div>';
    aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• Prazo estimado: '+escapeHtml(prazoTxt)+'</div>';
    aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+numDemaos+' demão'+(numDemaos>1?'s':'')+' de tinta para acabamento perfeito</div>';
    aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• Condição: '+condicaoText+'</div>';
    aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• Garantia da mão de obra: '+escapeHtml(garantiaTxt)+'</div>';
    if(comodos > 0) aiNotes += '<div style="font-size:12px;color:var(--ink);margin-bottom:4px;">• '+comodos+' cômodo'+(comodos>1?'s':'')+' inclusos no serviço</div>';

    const resultHtml = `
      <div style="background:#fff;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.08);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <div style="font-family:Syne,sans-serif;font-size:18px;font-weight:800;color:var(--ink);">ORÇAMENTO</div>
            <div style="font-size:11px;color:var(--muted);">${hoje}</div>
          </div>
          <div style="background:var(--cream);color:var(--muted);font-size:10px;font-weight:700;padding:4px 10px;border-radius:20px;">ORÇAMENTO</div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:14px;padding-bottom:14px;border-bottom:2px solid var(--border);">
          <div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Profissional</div><div style="font-size:13px;font-weight:700;">${escapeHtml(pintorName)}</div></div>
          <div style="text-align:right;"><div style="font-size:11px;color:var(--muted);text-transform:uppercase;">Cliente</div><div style="font-size:13px;font-weight:700;">${escapeHtml(cliente)}</div></div>
        </div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Serviço: ${escapeHtml(servico)}</div>
        <div style="margin-bottom:14px;">${itensHtml}</div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Observações</div>
        <div style="margin-bottom:14px;">${aiNotes}</div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Forma de pagamento</div>
        <div style="margin-bottom:14px;">${pgtoHtml}</div>
        <div style="background:var(--cream);border-radius:12px;padding:14px;display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:14px;font-weight:700;color:var(--ink);">TOTAL</div>
          <div style="font-size:22px;font-weight:800;color:var(--p1);font-family:Syne,sans-serif;">R$ ${total.toLocaleString('pt-BR')}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button onclick="gerarPDFOrcamento()" style="flex:1;padding:12px;background:var(--p1);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">📄 Baixar PDF</button>
        <button onclick="compartilharOrcamento()" style="flex:1;padding:12px;background:var(--ink);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">📤 Enviar</button>
      </div>
      <button onclick="salvarOrcamento()" style="width:100%;margin-top:8px;padding:12px;background:#2ec4b6;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif;">💾 Salvar no Pipeline de orçamentos</button>
      <div id="ai-orc-materiais" style="margin-top:14px;"></div>
    `;

    // Save data for PDF.
    // Nesta etapa de COPIA, o estado canônico ainda é o `let _lastOrcData` de
    // app.js (lido por `_buildOrcDoc` / `salvarOrcamento`). Espelhamos em
    // `window._lastOrcData` pra próxima etapa (migração de call sites) já
    // achar o estado pronto sem mudar app.js agora.
    const pItens = [];
    prepItems.forEach(item=>pItens.push({desc:item,valor:'Incluso'}));
    if(matInc){
      pItens.push({desc:'Tinta premium ('+litros+'L aprox. '+l18+' galoes 18L)',valor:'R$ '+custoTinta.toLocaleString('pt-BR')});
      pItens.push({desc:'Lixa, massa, selador, fita crepe',valor:'Incluso'});
    } else {
      pItens.push({desc:'Tinta e materiais',valor:'Por conta do cliente'});
    }
    if(extras) pItens.push({desc:'Extras: '+extras,valor:'Incluso'});
    if(cobranca === 'fechado') pItens.push({desc:'Servico (preco fechado)',valor:'R$ '+valorFechado.toLocaleString('pt-BR')});
    else pItens.push({desc:'Mao de obra ('+area+'m2 x R$'+precoM2+'/m2)',valor:'R$ '+custoMaoObra.toLocaleString('pt-BR')});
    customItems.forEach(it => pItens.push({desc: it.desc, valor: it.valorNum > 0 ? ('R$ '+it.valorNum.toLocaleString('pt-BR')) : 'Incluso'}));
    window._lastOrcData = {pintor:pintorName,cliente,servico,area,demaos:numDemaos,condicao:condicaoText,hoje,total,itens:pItens,obs:[obs,numDemaos+' demaos','Prazo: '+prazoTxt,'Garantia: '+garantiaTxt].filter(Boolean),pagamento:pgtoLines};

    const resultEl = document.getElementById('ai-orc-result');
    resultEl.innerHTML = resultHtml;
    resultEl.style.display = 'block';
    resultEl.scrollIntoView({ behavior: 'smooth' });
    loadMaterialSuggestions(litros);
  }

  window.Modules = window.Modules || {};
  window.Modules.aiChat = {
    openAiOrcamento, openAiChat,
    sendAiChat, aiChatToggleVoice, aiChatStopVoice, aiChatHandleVoice,
    falarSeuZe,
    sugerirEscopoIA, addOrcItem, gerarOrcamentoIA
  };
})();

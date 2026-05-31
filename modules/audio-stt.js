// modules/audio-stt.js — feature "Gravação de áudio + transcrição (STT)" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Depende de globals do app.js: gateProClient, toast, apiPost, showError.
// Backend: POST /api/transcribe (Whisper).
(function(){
  'use strict';

  // ══ GRAVAÇÃO DE ÁUDIO → TRANSCRIÇÃO (PRO) ══
  // Grava até 5 min de áudio, manda pro Whisper e cola o texto na nota.
  let _recMediaRecorder = null;
  let _recChunks = [];
  let _recStartTime = 0;
  let _recTimerInterval = null;
  const REC_MAX_MS = 5 * 60 * 1000;

  async function iniciarGravacaoNota(){
    if (!gateProClient('Gravação por áudio')) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      toast('Seu navegador não suporta gravação de áudio'); return;
    }
    if(typeof MediaRecorder === 'undefined'){
      toast('Seu navegador não suporta MediaRecorder'); return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch(e){ toast('Permissão de microfone negada'); return; }
    _recChunks = [];
    try { _recMediaRecorder = new MediaRecorder(stream); }
    catch(e){ toast('Erro ao iniciar gravação: ' + e.message); return; }
    _recMediaRecorder.ondataavailable = e => { if(e.data && e.data.size > 0) _recChunks.push(e.data); };
    _recMediaRecorder.onstop = async () => {
      const mimeType = _recMediaRecorder.mimeType || 'audio/webm';
      const blob = new Blob(_recChunks, { type: mimeType });
      stream.getTracks().forEach(t => t.stop());
      await transcreverAudio(blob);
    };
    _recMediaRecorder.start();
    _recStartTime = Date.now();
    const statusEl = document.getElementById('rec-status');
    if(statusEl) statusEl.style.display = 'block';
    const btn = document.getElementById('rec-audio-btn');
    if(btn) btn.disabled = true;
    _recTimerInterval = setInterval(() => {
      const elapsed = Date.now() - _recStartTime;
      const sec = Math.floor(elapsed / 1000);
      const t = document.getElementById('rec-timer');
      if(t) t.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      if(elapsed >= REC_MAX_MS) pararGravacaoNota();
    }, 250);
  }

  function pararGravacaoNota(){
    if(_recMediaRecorder && _recMediaRecorder.state === 'recording'){
      _recMediaRecorder.stop();
    }
    if(_recTimerInterval){ clearInterval(_recTimerInterval); _recTimerInterval = null; }
    const statusEl = document.getElementById('rec-status');
    if(statusEl) statusEl.style.display = 'none';
    const btn = document.getElementById('rec-audio-btn');
    if(btn) btn.disabled = false;
  }

  async function transcreverAudio(blob){
    toast('Transcrevendo áudio...');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'note.webm');
      const { ok, data } = await apiPost('/api/transcribe', fd, { multipart: true });
      if(!ok || !data || !data.text){
        toast('Erro: ' + ((data && data.error) || 'falha na transcrição'));
        return;
      }
      const ta = document.getElementById('note-new');
      if(ta){
        ta.value = (ta.value ? ta.value + '\n' : '') + data.text;
        ta.focus();
      }
      toast('Áudio transcrito ✅');
    } catch(e){
      showError('transcribe-audio', e, 'Falha ao transcrever áudio. Tente novamente.');
    }
  }

  window.Modules = window.Modules || {};
  window.Modules.audioStt = {
    iniciarGravacaoNota, pararGravacaoNota, transcreverAudio
  };
})();

// modules/calc.js — feature "Calculadora de tinta" extraída do app.js.
// Fase 4 da modularização (etapa 1: COPIA pra criar a camada;
// próximo PR migra call sites e remove duplicatas do app.js).
// Tudo pendurado em window.Modules.calc.
//
// Dependências globais (ainda no app.js): toast, gateProClient, apiPost.
(function(){
  'use strict';

  // ══ CALCULATOR ══
  let demaos=2;
  function setD(n){
    demaos=n;
    [1,2,3].forEach(i=>{
      const b=document.getElementById('db'+i);
      if(b){b.classList.toggle('active',i===n);}
    });
    calcTinta();
  }
  function calcTinta(){
    const area=parseFloat(document.getElementById('ci-area')?.value)||0;
    const fator=parseFloat(document.getElementById('ci-tipo')?.value)||1;
    const res=document.getElementById('calc-res');
    if(area<=0){res.style.display='none';return;}
    const litros=Math.ceil((area*fator*demaos)/11*1.1);
    const l36=Math.ceil(litros/3.6), l18=Math.ceil(litros/18);
    document.getElementById('cr-val').textContent=litros+'L';
    document.getElementById('cr-latas').textContent=`≈ ${l36} latas 3,6L  ou  ${l18} galão 18L`;
    res.style.display='block';
  }

  // ══ ESTIMATIVA DE METRAGEM POR FOTO (PRO) ══
  function estimarAreaPorFoto(){
    if (!gateProClient('Estimativa de metragem por foto')) return;
    const input = document.getElementById('calc-photo-input');
    if(!input){ toast('Erro: input de foto não encontrado'); return; }
    input.onchange = async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if(!file) return;
      if(file.size > 8 * 1024 * 1024){ toast('Foto acima de 8 MB. Tente uma menor.'); return; }
      toast('Analisando foto...');
      try {
        const fd = new FormData();
        fd.append('image', file);
        const { ok, status, data, error } = await apiPost('/api/area-from-photo', fd, { multipart: true });
        if(!ok){ toast('Erro ao analisar foto: ' + (error || status)); return; }
        const area = Number(data?.area_m2);
        const just = String(data?.justification || '').trim();
        if(!isFinite(area) || area <= 0){ toast('Não foi possível estimar a área desta foto'); return; }
        const areaRounded = Math.round(area * 10) / 10;
        const areaInput = document.getElementById('ci-area');
        if(areaInput){
          areaInput.value = areaRounded;
          calcTinta();
        }
        toast(`Estimativa: ${areaRounded} m²` + (just ? ` · ${just}` : ''));
      } catch(e){
        toast('Erro ao analisar foto: ' + (e?.message || e));
      }
    };
    input.click();
  }

  window.Modules = window.Modules || {};
  window.Modules.calc = {
    setD, calcTinta, estimarAreaPorFoto
  };
})();

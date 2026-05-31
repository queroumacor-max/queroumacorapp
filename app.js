// ══ SCREENS / NAV / BOTÃO VOLTAR / BOOTSTRAP → modules/nav.js (Fase 4 etapa 2).
//    showScreen, _navSyncHistory, _bootstrapFromUrl, popstate handler e o
//    setup inicial de history.replaceState vivem todos no IIFE de nav.js.

// Helpers de formatação de R$ (pt-BR): aceita "500", "500,00", "1.500,00",
// "1500.50" no input e devolve Number; o blur formata pra "1.500,00".
// parseBRL → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.
// fmtBRL → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ TOAST ══
// A11y: o elemento #toast-el em index.html DEVE ter role="status" e
// aria-live="polite" pra leitores de tela anunciarem mensagens. Wave 2-html
// adiciona esses atributos no HTML — não setar aqui por toast() pra evitar
// recriar o live region a cada chamada (quebra anúncio).
// tt → state encapsulado em modules/avaliacao.js (Fase 4 etapa 2 cleanup).
// toast → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MODALS ══
// showModal → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.
// Injeta um botão X no canto superior direito de TODOS os .sheet (modais
// bottom-sheet). Antes só dava pra fechar tocando fora ou arrastando — pediram
// um X visível. Injeção única no DOMContentLoaded, idempotente. Não foi pra
// utils.js porque é um one-shot de boot, não um helper reutilizável.
function _injectSheetCloseButtons(){
  document.querySelectorAll('.sheet').forEach(s => {
    if(s.querySelector(':scope > .sheet-close-x')) return; // já tem
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-close-x';
    btn.setAttribute('aria-label', 'Fechar');
    btn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); closeModals(); });
    s.insertBefore(btn, s.firstChild);
  });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _injectSheetCloseButtons);
else _injectSheetCloseButtons();

// closeModals → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.
// hideModal → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PAINTER DATA ══
const painters={};

// ══ LOAD PROFILE DYNAMICALLY ══
var currentPainter='carlos';
// openProfile → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ EXPLORE MAP ══
// showPainterCard → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.
// "Ver perfil" no popup do mapa — abre o perfil real do profissional guardado em data-painter-id
// openPainterPopupProfile → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.
// ══ PROFILE TABS ══
// switchTab → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.
// ══ CALCULATOR ══
var demaos=2;
// setD → modules/calc.js (Fase 4 etapa 2). Shim em /shims.js.
// calcTinta → modules/calc.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ESTIMATIVA DE METRAGEM POR FOTO (PRO) ══
// estimarAreaPorFoto → modules/calc.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AI FEATURES (PRO) ══
var _isPro = false;
// _proExpires → state encapsulado em modules/pro.js (Fase 4 etapa 2 cleanup).

// refreshProStatus → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// Quando o perfil ja e PRO, troca o banner de upsell por "PRO ativo"
// applyProUI → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// checkProAccess → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// handleProReturn → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// CTA — Parceria Mercado Pago pra pintores (receber dos próprios clientes
// via PIX/cartão/maquininha). Abre o cadastro do MP em nova aba.
// abrirParceriaMP → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// Retorno do checkout Mercado Pago (Loja). URL: /?compra=<orderId>&status=success|failure|pending
// Faz polling no status da order pra confirmar quando o webhook chegou.
// handleCompraReturn → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// Link de perfil compartilhado (?ref=<userId>): funciona como convite —
// pula o passo do código e registra quem indicou (invited_by).
// handleReferralParam → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MAIS INFORMAÇÕES E SUPORTE ══
// SUPPORT → state encapsulado em modules/info.js (Fase 4 etapa 2 cleanup).
// _infoTitles → state encapsulado em modules/info.js (Fase 4 etapa 2 cleanup).
// _infoPage → state encapsulado em modules/info.js (Fase 4 etapa 2 cleanup).
// openInfoPage → modules/info.js (Fase 4 etapa 2). Shim em /shims.js.
// infoBack → modules/info.js (Fase 4 etapa 2). Shim em /shims.js.
// supportWhatsApp → modules/info.js (Fase 4 etapa 2). Shim em /shims.js.
// supportEmail → modules/info.js (Fase 4 etapa 2). Shim em /shims.js.
// requestAccountDeletion → modules/info.js (Fase 4 etapa 2). Shim em /shims.js.
window.requestAccountDeletion = requestAccountDeletion;

// LGPD — baixar todos os dados do usuário (chama /api/me-export que retorna JSON).
// baixarMeusDados → modules/info.js (Fase 4 etapa 2). Shim em /shims.js.
window.baixarMeusDados = baixarMeusDados;

// ══════════════════════════════════════════
// FEATURE 1 — APROVAÇÃO DE ORÇAMENTO (pipeline)
// Ciclo: rascunho/pending → enviado → aprovado → em_execucao → concluido (+ recusado)
// ══════════════════════════════════════════

// QUOTE_STATUS → state encapsulado em modules/pipeline.js (Fase 4 etapa 2 cleanup).
// _pipelineCache → state encapsulado em modules/pipeline.js (Fase 4 etapa 2 cleanup).

// Notificação in-app: cria uma linha em notifications para o usuário destino.
// notify → modules/notif.js (Fase 4 etapa 2). Shim em /shims.js.

// Congela o escopo+valor do orçamento como referência imutável.
// buildQuoteSnapshot → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// Integra o Pipeline com a Agenda/Financeiro: orçamento aprovado / em
// execução / concluído vira um projeto (job). Idempotente — só cria o
// que falta e nunca rebaixa o status de um job já existente.
// syncQuotesToJobs → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// loadPipeline → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// renderPipeline → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// renderPipelineCard → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// salvarOrcamento → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// _quotePriceTarget → state encapsulado em modules/pipeline.js (Fase 4 etapa 2 cleanup).

// enviarQuote → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// enviarQuoteConfirmar → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// IA sugere o preço para um orçamento pendente/rascunho (feature PRO).
// Em caso de aceite, injeta o valor no cache e delega para enviarQuote.
// sugerirPrecoQuote → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// aprovarQuoteManual → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// recusarQuote → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// setQuoteStage → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// Aprovação nativa: o cliente (usuário do app) aprova o orçamento recebido.
// aprovarQuoteCliente → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// verSnapshot → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════════════════
// FEATURE 2 — MINI-CRM DE FOLLOW-UP (reativar clientes)
// O sistema RASCUNHA, o pintor DISPARA. Nunca disparo automático.
// Recurso PRO. Consentimento (LGPD) é cidadão de primeira classe.
// ══════════════════════════════════════════

// _crmCache → state encapsulado em modules/crm.js (Fase 4 etapa 2 cleanup).
// _crmIntervalMonths → state encapsulado em modules/crm.js (Fase 4 etapa 2 cleanup).

// Normaliza nome de cliente para dedup (lowercase + trim + colapsa espaços).
// crmNormName → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// Meses inteiros entre uma data e hoje.
// crmMonthsSince → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// loadCrm → modules/crm.js (Fase 4 etapa 2). Shim em /shims.js.

// renderCrm → modules/crm.js (Fase 4 etapa 2). Shim em /shims.js.

// renderCrmCard → modules/crm.js (Fase 4 etapa 2). Shim em /shims.js.

// saveCrmInterval → modules/crm.js (Fase 4 etapa 2). Shim em /shims.js.

// crmDraft → modules/crm.js (Fase 4 etapa 2). Shim em /shims.js.

// REGRA DE OURO: o sistema rascunha, o PINTOR dispara. Nunca automático.
// crmSend → modules/crm.js (Fase 4 etapa 2). Shim em /shims.js.

// startProCheckout → modules/pro.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MODERAÇÃO ADMIN ══
var _isAdmin = false;

async function getAccessToken(){
  try {
    const sb = getSupabase();
    const { data:{ session } } = await sb.auth.getSession();
    return session?.access_token || '';
  } catch(e){ return ''; }
}

// checkAdminEntry → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// ── Dashboard de erros (admin) ───────────────────────────────────────────
// Substitui Sentry: lê a tabela `errors` via /api/admin-errors-list (que
// usa service_role e gate por ADMIN_EMAILS). Sem novo SaaS externo.
// _errsState → state encapsulado em modules/admin-mod.js (Fase 4 etapa 2 cleanup).

// openErrorsAdmin → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// loadErrorsAdmin → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// errsPager → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// renderErrorsAdmin → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// openModQueue → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// modAction → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// openAiOrcamento → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// openAiChat → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// AI Chat - knowledge base for painting professionals
// _aiKnowledge → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).

// _aiChatHistory → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).

// sendAiChat → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MODO CONVERSAÇÃO POR VOZ COM O SEU ZÉ (PRO) ══
// Grava a fala → Whisper transcreve → manda no chat-ai → resposta do
// Seu Zé é falada de volta via OpenAI TTS.
// _aiVoiceRecorder → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).
// _aiVoiceChunks → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).
// _aiVoiceStream → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).
// _aiVoiceAutoStop → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).
// _aiVoiceAudio → state encapsulado em modules/ai-chat.js (Fase 4 etapa 2 cleanup).

// aiChatToggleVoice → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// aiChatStopVoice → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// aiChatHandleVoice → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// falarSeuZe → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// sugerirEscopoIA → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Adiciona uma linha de "item detalhado" no orçamento (descrição + valor).
// addOrcItem → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// gerarOrcamentoIA → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Garante que window.jspdf está carregado antes de gerar PDF.
// Se já estiver presente (tag estática no index.html), no-op. Senão, carrega
// dinamicamente do path local — abrindo caminho pra remover a tag estática
// num próximo passo e reduzir bundle inicial.
// ensureJsPDF → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.

// compartilharOrcamento → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PDF GENERATION ══
var _lastOrcData = {};
// Monta o documento jsPDF do orçamento e o retorna (null se sem dados/lib)
// _buildOrcDoc → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.
// gerarPDFOrcamento → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MATERIAL LIST LINKED TO STORE ══
// loadMaterialSuggestions → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AGENDA DE PROJETOS (calendário) ══
// _agCur → state encapsulado em modules/agenda.js (Fase 4 etapa 2 cleanup).
// _agSel → state encapsulado em modules/agenda.js (Fase 4 etapa 2 cleanup).
// _agJobs → state encapsulado em modules/agenda.js (Fase 4 etapa 2 cleanup).

// _agYmd → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// loadAgenda → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// agMonth → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// agSelect → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// renderAgendaCal → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// renderAgendaDay → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// salvarJob → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// updateJobStatus → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// prefillNovoProjeto → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// otimizarDiaAgenda → modules/agenda.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ CHECKLIST DE OBRA ══
// _checklistItems → state encapsulado em modules/checklist.js (Fase 4 etapa 2 cleanup).
// _checklistRowId → state encapsulado em modules/checklist.js (Fase 4 etapa 2 cleanup).
// _checklistSaveQueue → state encapsulado em modules/checklist.js (Fase 4 etapa 2 cleanup).
// _checklistTemplates → state encapsulado em modules/checklist.js (Fase 4 etapa 2 cleanup).

// renderChecklist → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// addChecklistItem → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// loadChecklistTemplate → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// loadChecklist → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// Salva no Supabase. Os saves são enfileirados para que o primeiro
// INSERT termine (e fixe _checklistRowId) antes do próximo, evitando
// criar linhas duplicadas em cliques rápidos.
// saveChecklist → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ANOTAÇÕES (notas do pintor) ══
// _editingNoteId → state encapsulado em modules/notes.js (Fase 4 etapa 2 cleanup).
// startEditNote → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.
// cancelEditNote → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.
// saveEditNote → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// loadNotes → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// salvarNota → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// deletarNota → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ GRAVAÇÃO DE ÁUDIO → TRANSCRIÇÃO (PRO) ══
// Grava até 5 min de áudio, manda pro Whisper e cola o texto na nota.
// _recMediaRecorder → state encapsulado em modules/audio-stt.js (Fase 4 etapa 2 cleanup).
// _recChunks → state encapsulado em modules/audio-stt.js (Fase 4 etapa 2 cleanup).
// _recStartTime → state encapsulado em modules/audio-stt.js (Fase 4 etapa 2 cleanup).
// _recTimerInterval → state encapsulado em modules/audio-stt.js (Fase 4 etapa 2 cleanup).
// REC_MAX_MS → state encapsulado em modules/audio-stt.js (Fase 4 etapa 2 cleanup).

// iniciarGravacaoNota → modules/audio-stt.js (Fase 4 etapa 2). Shim em /shims.js.

// pararGravacaoNota → modules/audio-stt.js (Fase 4 etapa 2). Shim em /shims.js.

// transcreverAudio → modules/audio-stt.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ FINANCEIRO / LUCRO ══
// loadFinanceiro → modules/financeiro.js (Fase 4 etapa 2). Shim em /shims.js.

// salvarFinEntry → modules/financeiro.js (Fase 4 etapa 2). Shim em /shims.js.

// deleteFinEntry → modules/financeiro.js (Fase 4 etapa 2). Shim em /shims.js.

// Análise IA do mês — PRO. Agrega últimos 30 dias vs 30 dias anteriores e
// pede ao backend (gpt-4o-mini) um parecer curto e acionável.
// analisarFinanceiroIA → modules/financeiro.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AUTO-RESPOSTAS ══
// _autoReplyCfg → state encapsulado em modules/autoresp.js (Fase 4 etapa 2 cleanup).
// _autoRepliedConvs → state encapsulado em modules/autoresp.js (Fase 4 etapa 2 cleanup).

// arToggle → modules/autoresp.js (Fase 4 etapa 2). Shim em /shims.js.
// arSync → modules/autoresp.js (Fase 4 etapa 2). Shim em /shims.js.

// loadAutoRespostas → modules/autoresp.js (Fase 4 etapa 2). Shim em /shims.js.

// maybeAutoReply → modules/autoresp.js (Fase 4 etapa 2). Shim em /shims.js.

// salvarAutoRespostas → modules/autoresp.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ RANKING POR CIDADE ══ → modules/ranking.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ INDICAÇÃO ENTRE PINTORES ══
// loadReferrals → modules/points-refs.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PONTOS / CASHBACK ══
// loadPoints → modules/points-refs.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ TROCAR 100 PTS POR 1 MÊS PRO EXTRA ══
// Chama a RPC redeem_pro_with_points (SECURITY DEFINER) que valida o
// saldo, debita os pontos e estende o PRO em transação atômica no
// servidor — assim o cliente NÃO consegue mais bypassar fazendo
// UPDATE direto em profiles.is_pro pelo devtools.
// trocarPontosPorPRO → modules/points-refs.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ DISTRIBUIÇÃO DE LEADS ══
// distribuirLead → modules/leads.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MANIFESTAR INTERESSE EM OBRA ══
// Antes inseria uma row em orders com status='pending' eterno. Removido
// porque (a) não tinha fluxo de pagamento real, (b) admin malicioso podia
// marcar a order como 'paid' e disparar trigger de pontos. Hoje só
// notifica o artista; venda real vai usar fluxo MP quando existir.
// comprarObra → modules/leads.js (Fase 4 etapa 2). Shim em /shims.js.

// Alias para o wrapper canônico startChatWith (em head.js). Mantido pelos
// callers inline (ex.: app.js:~6787 onclick="openChatWithUser('...')").
// openChatWithUser → modules/leads.js (Fase 4 etapa 2). Shim em /shims.js.

// abrirOrcamentoChat → modules/leads.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ Helpers das fotos do pedido (escopo global pq onclick inline usa) ══
// addOrcPhotos → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.
// renderOrcPhotos → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.
// removeOrcPhoto → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.

// enviarOrcamentoForm → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PUBLISH VIDEO (REELS) ══
// Updated publishPost to handle video media_type
// ══ CONTENT MODERATION ══
// Filtro local enxuto: só termos quase sempre problemáticos, com casamento
// por palavra inteira (\b…\b). Antes o substring bloqueava "armário"
// (arma), "pistolão" (pistola), "matar a sede" (matar), nome "Cornélio"
// (corno). Contexto fica pra IA decidir em /api/moderate.
// _blockedWords → state encapsulado em modules/content-mod.js (Fase 4 etapa 2 cleanup).

// _blockedRe → state encapsulado em modules/content-mod.js (Fase 4 etapa 2 cleanup).

// Padrões fortes de scam: encurtadores e domínios típicos de golpe.
// URL normal (https://meusite.com.br, www.instagram.com/foo) NÃO bloqueia
// mais — autopromoção legítima de pintor passa, Gemini avalia contexto.
// _scamLinkRe → state encapsulado em modules/content-mod.js (Fase 4 etapa 2 cleanup).

// moderateContent → modules/content-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// moderateContentAsync → modules/content-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// getMediaType → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MODAL LOADERS (called on open) ══
(function(){
  const _orig = showModal;
  const _loaders = {'agenda-modal':loadAgenda,'agenda-add-modal':prefillNovoProjeto,'auto-resp-modal':loadAutoRespostas,'checklist-modal':loadChecklist,'lucro-modal':loadFinanceiro,'referral-modal':loadReferrals,'points-modal':loadPoints,'notes-modal':loadNotes};
  showModal = function(id){ _orig(id); if(_loaders[id]) _loaders[id](); };
})();

// ══ CHAT SYSTEM ══
var currentChat = null;
// chatTab → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// applyChatFilter → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// convDisplayName → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ LOCAL STORAGE CHAT PERSISTENCE ══
// Cache em memória + flush debounced (300ms). Antes, cada mensagem em
// realtime triggava read+parse+stringify+write síncronos (~5-10ms cada
// em mobile). Em rajada de 10 msgs = 50-100ms travados na main thread.
// getLocalConvKey → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// getLocalMsgsKey → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// _convsCache → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _convsCacheUid → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _convsDirty → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _convsFlushTimer → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgsCache → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgsDirty → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgsFlushTimer → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).

// _ensureConvsCache → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// _flushConvs → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// _flushMsgs → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Listeners pagehide+visibilitychange → modules/chat.js (movidos junto com
// _flushConvs/_flushMsgs, que ficam IIFE-private e não eram acessíveis daqui).

// saveConvLocal → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// loadConvsLocal → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// saveMsgLocal → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// loadMsgsLocal → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ LOAD CHAT LIST (localStorage primary + Supabase background sync) ══
// loadChatList → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// _proLabel → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// renderConvList → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ NEW CHAT MODAL ══
const CALICOLORS_EMAIL = 'calicolortintas@gmail.com';
var calicolorsUserId = null;

var _searchNewChatToken = 0;
// _searchNewChatUsersImpl + searchNewChatUsers → modules/chat.js (Fase 4
// etapa 2). O módulo já cria a versão debounced internamente e expõe via
// shim em /shims.js. NÃO recriar aqui — referenciaria _searchNewChatUsersImpl
// que vive IIFE-private no módulo.

// Resolve o destinatário de uma conversa de forma confiável.
// Antes o receiver_id era deduzido quebrando o conversation_id por "_",
// o que falhava em chat com a loja/3-way (virava null e a mensagem não
// era entregue). Agora usa o otherId guardado em chatData/localStorage,
// cai para a loja em conversas store/3-way, e só por último faz o parse
// antigo (compatível com conversas 1:1 uuidA_uuidB).
// getChatReceiverId → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// startNewChat → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ LOAD NOTIFICATIONS FROM SUPABASE ══
// loadNotifications → modules/notif.js (Fase 4 etapa 2). Shim em /shims.js.

// updateNotifBadge → modules/notif.js (Fase 4 etapa 2). Shim em /shims.js.

var _notifSub = null;
// setupNotifSubscription → modules/notif.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PIPELINE AO VIVO — novo pedido aparece sem reabrir a tela ══
// SÓ pra profissional (pintor/grafiteiro/automotivo). Cliente não tem quotes
// onde é o painter_id, então o WebSocket nunca dispara — desperdício.
var _pipelineSub = null;
// setupPipelineSubscription → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ LOAD PEDIDOS FROM SUPABASE ══
// loadPedidos → modules/pedidos.js (Fase 4 etapa 2). Shim em /shims.js.

// _epAvatarFile → state encapsulado em modules/profile-edit.js (Fase 4 etapa 2 cleanup).
// _epLogoFile → state encapsulado em modules/profile-edit.js (Fase 4 etapa 2 cleanup).
// _epLogoClear → state encapsulado em modules/profile-edit.js (Fase 4 etapa 2 cleanup).

// previewAvatar → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// _epShowLogo → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// previewEpLogo → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// removeEpLogo → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// openEditProfile → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AUTOCOMPLETE: cidade pelo estado (IBGE) ══
// _citiesCache → state encapsulado em modules/profile-edit.js (Fase 4 etapa 2 cleanup).
// _ufByName → state encapsulado em modules/profile-edit.js (Fase 4 etapa 2 cleanup).
// loadCidadesDoEstado → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.
// _epStateChanged → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ESPECIALIDADES — modal dedicado ══
// openEditEspecialidades → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// saveEspecialidades → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ RAIO DE ATENDIMENTO — modal dedicado ══
// openEditRaio → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// saveRaio → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// _epSpecRole → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// _epSpecsSetup → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleEpSpecs → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// _epSpecsApply → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// saveEditProfile → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// sharePost → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

const chatData = {};
var _globalMsgSub = null;
const _processedMsgIds = new Map(); // id -> true (Map preserves insertion order for LRU)
const MAX_PROCESSED_IDS = 500;
// _markProcessed → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// _chatListDebounce → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).

// Global realtime subscription for messages - ensures new messages show up
// setupGlobalMsgSubscription → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// handleRealtimeMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Bridge function for starting chat from profile.
// Chamado por startChatWith (head.js) depois de showScreen('chat').
// Mantido como impl separada pra evitar recursão com startChatWith.
// openChatConversation → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.


// ══ AUTH ══
// selectedRole → state encapsulado em modules/signup-flow.js (Fase 4 etapa 2 cleanup).
// selectRole → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.
var validatedInviteCode = null;

// validateInvite → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// signupNext → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// doSignup → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.
const _roleSpecs = {
  pintor: ['Residencial','Comercial','Textura','Grafiato','Piso Epóxi','Fachada','Degradê','Stencil','Industrial','Caiação'],
  grafiteiro: ['Grafite Artístico','Mural Decorativo','Painel Comercial','Arte Urbana','Lettering','Realismo','Abstrato','3D / Ilusão','Stencil Urbano','Lambe-lambe'],
  automotivo: ['Pintura Automotiva','Funilaria','Envelopamento','Polimento','Cristalização','Customização','Aerografia','Restauração','Martelinho de Ouro','PPF / Película']
};

// loadSpecsForRole → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleSpec → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.
// _proRoles → state encapsulado em modules/signup-flow.js (Fase 4 etapa 2 cleanup).
// isProfessionalRole → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// selectProfession → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// getSelectedProfession → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// setMode → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PEDIDOS FILTER ══
// filterPedidos → modules/pedidos.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ SIMPLE CHAT (pintor↔cliente) ══
// sendChatMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&document.activeElement?.id==='chat-input-field')sendChatMsg();
  if(e.key==='Enter'&&document.activeElement?.id==='chat-input')sendMsg();
});

// ══ AVALIAÇÃO ══
// starVal → state encapsulado em modules/avaliacao.js (Fase 4 etapa 2 cleanup).
// starLabels → state encapsulado em modules/avaliacao.js (Fase 4 etapa 2 cleanup).
// setStar → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.
// toggleCriteria → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// avaliarQuoteId → state encapsulado em modules/avaliacao.js (Fase 4 etapa 2 cleanup).
// _avaliarQuotes → state encapsulado em modules/avaliacao.js (Fase 4 etapa 2 cleanup).
// loadAvaliarScreen → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// renderAvaliarServiceList → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// selectAvaliarService → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// submitAvaliacao → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ORCAMENTO ══
// toggleOrcOutros → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.

// sendOrc → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.
var chatStoreAdded = false;

// Track which message IDs are already rendered to avoid duplicates
const renderedMsgIds = new Set();

// openChat → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.

// _msgKind → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Cor do balao por PESSOA (cada participante uma cor estavel), nao por papel.
// _msgMeColor → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgStoreColor → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgPalette → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgColorMap → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _msgColorIdx → state encapsulado em modules/chat.js (Fase 4 etapa 2 cleanup).
// _resetMsgColors → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// _msgColors → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// renderMessages → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// sendMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// appendMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// handleChatAttachment → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// addStoreToChat → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.


// ══ MARKETPLACE ══
var cartCount = 0;
var cartItems = [];
var shirtQty = 1;
var logoState = {pintor: true, cali: true};
var mktProducts = [];

// Dicionário determinístico: cor escrita no nome → hex. Compostos primeiro.
// COLOR_DICT → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// _normTxt → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
// Cores "placeholder" que NÃO contam como cor escolhida de verdade
// _PLACEHOLDER_HEX → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// resolveColorHex → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
// productBg → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
// true quando o produto tem cor (gradiente, hex real ou cor pelo nome) → mostrar swatch limpo, sem emoji
// hasProductColor → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// Mesma classificação automática do portal (marca/tipo no nome do produto).
// A ordem importa: o primeiro menu cuja palavra-chave casar vence.
// MKT_MENUS → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// MKT_MENU_LABEL → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// mktClassify → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// Virtualização básica: renderiza em batches de 80 com IntersectionObserver
// sentinel. Mantém comportamento (scroll mostra tudo) mas paga o custo
// de DOM aos poucos em vez de tudo no primeiro paint.
// _mktMountInfinite → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// mktTab → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// Carrega no Supabase o estado do usuário que antes ficava em
// localStorage (carrinho, contador de logo IA, stories vistos).
// loadUserState → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// saveCart → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// updateCartBadge → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
updateCartBadge();

// addToCart → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// changeCartQty → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// renderCartModal → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// removeFromCart → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// submitCartOrder → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// getCategoryEmoji → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// getProductImage → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// _isArteUrbanaSpray → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// renderProductRow → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// _mktSearchImpl + mktSearch (debounced) → modules/mkt.js (Fase 4 etapa 2).
// Não recriar aqui — _mktSearchImpl é IIFE-private no módulo e o shim já
// expõe a versão debounced via window.mktSearch.

// openProductDetail → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// _mktLoadedAt → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// _mktGrouped → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// _MKT_TTL → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).

// Constrói abas + seções. Só renderiza as linhas da 1ª seção; as demais
// são renderizadas sob demanda em mktTab() (lazy).
// renderMktUI → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// _MKT_HIDDEN → state encapsulado em modules/mkt.js (Fase 4 etapa 2 cleanup).
// _isMktHidden → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// loadMktProducts → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// changeQty → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// setSizeBtn → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// setShirtColor → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// openShirtZoom → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// closeShirtZoom → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AI LOGO GENERATOR ══
// _aiLogoPalettes → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).
// _aiLogoIcons → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).

// _hashStr → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _renderAiLogoSvg → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiLogoSelected → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).
// _aiLogoLastName → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).

// _aiLogoUrls → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).

// AI_LOGO_REGEN_PRICE_BRL → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).
// _aiLogoFmtBRL → state encapsulado em modules/ai-logo.js (Fase 4 etapa 2 cleanup).

var _aiLogoCount = 0;
// _aiLogoGenCount → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.
// Atomic via RPC SECURITY DEFINER (bump_ai_logo_count): incrementa no DB
// e devolve o novo count autoritativo. Antes era UPDATE direto com
// falha silente — atacante podia ganhar 2ª logo grátis se rede caísse.
// _aiLogoBumpCount → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiLogoUpdateBtn → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// gerarLogoIA → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiLogoCurrentSrc → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _applyLogoToShirt → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AI ART GENERATOR (Instagram) ══
// Pipeline: usuário escolhe estilo → foto(s) → /api/ig-art devolve arte (data URL)
// e legenda → usuário posta no feed ou baixa. PRO + rate-limit no backend.
// Antes/Depois usa 2 fotos (antes + depois); outros estilos usam só 1.
// _aiArtPhotoDataUrl → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtPhotoDataUrl2 → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtStyle → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtAspect → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtResultDataUrl → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtResultCaption → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtResultOriginal → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).

// openAiArt → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Contador de créditos diário (5/dia, espelha o limit do backend).
// Conta gerações com sucesso por usuário+dia; reseta automaticamente
// ao virar o dia. Fonte da verdade real é o backend — isso é só UX.
// _AI_ART_DAILY_LIMIT → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtCreditsKey → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.
// _aiArtGetUsed → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.
// _aiArtIncUsed → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.
// _aiArtMaxUsed → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.
// _aiArtUpdateCreditsUI → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Mostra o botão ✏️ de upload nos tiles só se o user logado for admin.
// _aiArtToggleAdminButtons → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Carrega o template visual de cada estilo (Supabase storage ou fallback static)
// como background do tile. Se nem o storage nem o static existirem, mantém o
// fallback CSS-gradient já desenhado no HTML.
// _aiArtLoadTemplates → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtTryLoadFirstAvailable → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Upload de template do tile (admin-only). Abre file picker → compacta →
// envia pro /api/upload-style-ref → atualiza preview do tile.
// _aiArtUploadingStyle → state encapsulado em modules/ai-art.js (Fase 4 etapa 2 cleanup).
// _aiArtUploadTemplate → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Comprime via canvas pra reduzir tamanho do request (CF Pages Functions
// rejeita body > ~1MB). Resultado: lado maior ≤ 512px, JPEG q=0.7.
// Base64 final fica em ~80-200KB típico (muito abaixo do limite).
// _compressImageFile → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtPickFile → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtSetStyle → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtSetAspect → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// gerarArteIG → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Sobrepõe a logo do pintor (business_logo_url) no canto superior direito
// da arte gerada. Renderiza via canvas — não toca no backend. O usuário
// pode marcar/desmarcar o checkbox livremente: guardamos a versão original
// em _aiArtResultOriginal pra alternar sem perder qualidade.
// _aiArtToggleLogo → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Compõe arte + logo via canvas, devolve data URL PNG.
// Logo entra dentro de um cartão branco arredondado pra ficar legível
// sobre qualquer fundo. Tamanho ~16% da menor dimensão, margem de 4%.
// _aiArtComposeWithLogo → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtRoundRect → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtDownload → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// _aiArtReset → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Posta a arte gerada no feed do usuário usando o pipeline existente
// (upload pra storage 'posts' + insert em posts com status approved).
// _aiArtPost → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// selectAiLogo → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// usarLogoIA → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// Persiste o logo (gerado por IA ou enviado) no perfil do PRO, para reuso
// em futuras camisetas e branding. Sobe para o storage e grava em profiles.
// salvarLogoNoPerfil → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// baixarLogo → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _applyOwnLogoToShirt → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// uploadBusinessLogo → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// loadBusinessLogo → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// buyShirt → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MODE TOGGLE (PINTOR / CLIENTE) ══
// var (não let) pra hoisting → window.currentMode = undefined imediatamente,
// evitando TDZ quando head.js loadMyProfileData() roda antes desta linha
// (auth assíncrona pode disparar antes do final do parse de app.js).
var currentMode='pintor';


// ══ TYPING ANIMATION CSS ══
const styleTag=document.createElement('style');
styleTag.textContent='@keyframes typing{0%,80%,100%{transform:scale(0.6);opacity:.4;}40%{transform:scale(1);opacity:1;}}';
document.head.appendChild(styleTag);

// ══════════════════════════════
//  CHANGE 1: DYNAMIC FEED
// ══════════════════════════════
// currentPostType → state encapsulado em modules/feed-publish.js (Fase 4 etapa 2 cleanup).
// setPostType → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// openPortfolioComposer → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// previewPublicProfile → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ FORMAÇÃO (qualifications) ══
// openManageQuals → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// loadQualsList → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// addQualification → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// deleteQualification → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ CURSOS (courses) ══
// openManageCourses → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// loadCoursesList → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// addCourse → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

// deleteCourse → modules/quals-courses.js (Fase 4 etapa 2). Shim em /shims.js.

var _lastFeedLoad = 0;
// _feedRoleFilter → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).

// setFeedFilter → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// filterFeedPosts → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.
const POST_COLS = 'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at';

// Busca perfis públicos com fallback: tenta profiles_public (view) primeiro;
// se a view não existir/retornar vazio (acontece em DBs que não rodaram a
// migration), cai pra tabela profiles direto — que tem RLS "viewable by
// everyone" e expõe as mesmas colunas seguras.
// fetchPublicProfiles → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.
// _feedOffset → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).
// FEED_PAGE → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).

// ─── Cache do feed (stale-while-revalidate) ────────────────────────────────
// Guarda DADOS compactos (JSON), não HTML, e grava fora do main thread
// (requestIdleCallback) pra não travar a rolagem como o cache antigo de
// ~400KB de HTML. Chave por usuário; expira em 1h. O próximo load do feed
// pinta instantâneo daqui e revalida em background.
// _feedCacheKey → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// paintFeedFromCache → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// scheduleFeedCacheSave → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// loadFeed → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// Mostra estado de erro no lugar do skeleton quando o feed não carrega
// (timeout de 15s, rede caiu, Supabase fora do ar etc.). O botão chama
// loadFeed() de novo e re-injeta o skeleton enquanto tenta.
// renderFeedRetry → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// retryLoadFeed → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// _followingIdsCache → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).
// _followingIdsCacheTime → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).
// Invalidar via invalidateFollowingIds() depois de seguir/desfollow.
// invalidateFollowingIds → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.
window.invalidateFollowingIds = invalidateFollowingIds;
// getFollowingIds → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AUTOPLAY DE VÍDEOS NO FEED (estilo Instagram) ══
// Vídeos começam mudos (regra de autoplay dos navegadores); o botão de
// som no canto liga/desliga o áudio para a sessão inteira.
// _feedMuted → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).
// _feedVideoObserver → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).
// _obsVideos → state encapsulado em modules/feed.js (Fase 4 etapa 2 cleanup).

// _feedVolIcon → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleFeedVideoMute → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleFeedVideoPlay → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// observeFeedVideos → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// Monta o HTML de um post do feed. Extraído do loop de loadPosts pra ser
// reaproveitado tanto no render progressivo quanto no paint do cache.
// ctx = { myLikes, likeCounts, savedPosts, commentsMap, profMap }
// buildFeedPostHTML → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// loadPosts → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// loadMoreFeed → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// stripEmail → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.
// cleanHandle → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// escapeHtml → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.
// Escapa um valor para uso DENTRO de uma string JS em atributo onclick="..."
// escapeJsArg → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// sendPasswordReset → modules/auth-pw.js (Fase 4 etapa 2). Shim em /shims.js.

// doSetNewPassword → modules/auth-pw.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ UPDATE-PASSWORD SCREEN ══
// Acionado quando o usuário chega via link de recuperação do email
// (/update-password#access_token=...&type=recovery). O SDK do Supabase já
// processa o hash e cria a sessão de recovery; aqui só confirmamos que ela
// existe e abrimos o modal pro usuário digitar a nova senha.
// _initUpdatePasswordScreen → modules/auth-pw.js (Fase 4 etapa 2). Shim em /shims.js.

// togglePostLike → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleCommentInput → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// submitComment → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// deleteComment → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleSavePost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// Post options modal
// _currentOptPostId → state encapsulado em modules/feed-interactions.js (Fase 4 etapa 2 cleanup).
// _currentOptUserId → state encapsulado em modules/feed-interactions.js (Fase 4 etapa 2 cleanup).

// openPostOpts → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// shareCurrentPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// saveCurrentPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// copyCurrentPostLink → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// deleteCurrentPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// Report post
// _reportPostId → state encapsulado em modules/feed-interactions.js (Fase 4 etapa 2 cleanup).
// _reportUserId → state encapsulado em modules/feed-interactions.js (Fase 4 etapa 2 cleanup).

// reportPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// submitReport → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// Story delete
// deleteCurrentStory → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// getTimeAgo → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// Stories data grouped by user
// var (não let) pelos mesmos motivos de currentMode acima: modules/stories.js
// lê/escreve esses vars via scope compartilhado, e loadStories() pode ser
// chamado antes desta linha rodar. var hoisting evita TDZ.
var storyGroups = [];
var currentStoryGroup = 0;
var currentStoryIndex = 0;
// storyTimer → state encapsulado em modules/stories.js (Fase 4 etapa 2 cleanup).
// _lastStoriesFp → state encapsulado em modules/stories.js (Fase 4 etapa 2 cleanup).
// _storyRafId → state encapsulado em modules/stories.js (Fase 4 etapa 2 cleanup).
const STORY_DURATION = 5000; // 5 seconds per story like IG

// _stopStoryAnim → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// loadStories → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

var _seenStories = {};
// isStoryGroupSeen → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.
// markStoryGroupSeen → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// openStoryViewer → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// closeStoryViewer → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// renderCurrentStory → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// storyNext → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// storyPrev → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  CHANGE 2: POSTING SYSTEM
// ══════════════════════════════
// postSelectedFiles → state encapsulado em modules/feed-publish.js (Fase 4 etapa 2 cleanup).

// handlePostFiles → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// isVideoUrl → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// clearPostImages → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// Gera legenda + hashtags do post a partir da mídia selecionada (PRO).
// Foto: enviada direta. Vídeo: extrai um frame ~1s dentro via canvas e
// envia como JPG — backend só sabe processar imagem.
// gerarLegendaPost → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// Extrai um frame ~1s dentro do vídeo via <video> + canvas, retorna Blob JPG.
// _extractVideoFrame → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// publishPost → modules/feed-publish.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  CHANGE 3: LEAFLET MAP
// ══════════════════════════════
var leafletMap = null;
// mapMarkers → state encapsulado em modules/map.js (Fase 4 etapa 2 cleanup).

// Carrega Leaflet sob demanda (não vem mais no <head> pra economizar ~160KB
// no first paint — só usuário do mapa paga o custo).
// _leafletInflight → state encapsulado em modules/map.js (Fase 4 etapa 2 cleanup).
// ensureLeaflet → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// initLeafletMap → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// createPinIcon → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// dbPainters → state encapsulado em modules/map.js (Fase 4 etapa 2 cleanup).
// Índice pré-construído pra buscar pintor em O(1) por inclusão. Evita
// re-tokenizar 80 strings a cada tecla. Invalidado quando dbPainters muda.
// _paintersIndex → state encapsulado em modules/map.js (Fase 4 etapa 2 cleanup).
// _invalidatePaintersIndex → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
// _buildPaintersIndex → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
// AbortController pra cancelar fetch fallback anterior se o usuário
// digitar mais rápido que a rede responde.
// _paintersSearchAbort → state encapsulado em modules/map.js (Fase 4 etapa 2 cleanup).

// loadMapPainters → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// _starStr → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// _exploreType → state encapsulado em modules/map.js (Fase 4 etapa 2 cleanup).
// _matchType → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
// exploreType → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// renderPainterList → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// _filterExplorePaintersImpl + filterExplorePainters (debounced) → modules/map.js
// (Fase 4 etapa 2). Não recriar aqui — _filterExplorePaintersImpl é IIFE-private
// no módulo e o shim já expõe a versão debounced via window.filterExplorePainters.

// loadLocalPaintersOnMap → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  CHANGE 4: ARCHIVE CONVERSATIONS
// ══════════════════════════════
// archivedConvs → state encapsulado em modules/archive.js (Fase 4 etapa 2 cleanup).
// archivedExpanded → state encapsulado em modules/archive.js (Fase 4 etapa 2 cleanup).

// loadArchivedConvs → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.
// saveArchivedConvs → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.

// initArchiveButtons → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.

// archiveConversation → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.

// unarchiveConversation → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.

// applyArchivedState → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.

// toggleArchivedSection → modules/archive.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  SCREEN HOOKS
// ══════════════════════════════
// Wrap showScreen com dispatchers por tela (autoDetectRole, loadFeed, etc.).
// O wrap mora em modules/screen-hooks.js — install() captura window.showScreen
// atual e re-publica wrapped. Foi inline aqui na Fase 4 etapa 2, mas a cleanup
// deletou o `const _origShowScreen = showScreen` e deixou o consumer órfão
// (bug "_origShowScreen is not defined" em prod). Fix: delegar pro módulo.
if(window.Modules && window.Modules.screenHooks){
  window.Modules.screenHooks.install();
}

// ══════════════════════════════
//  TAG UNIQUENESS CHECK
// ══════════════════════════════
// tagAvailable → state encapsulado em modules/signup-tag.js (Fase 4 etapa 2 cleanup).
var tagCheckTimeout;

// validateAndGoStep3 → modules/signup-tag.js (Fase 4 etapa 2). Shim em /shims.js.

// checkTagAvailability → modules/signup-tag.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  INVITE CODE GENERATION
// ══════════════════════════════
// generatedInviteCode → state encapsulado em modules/invite.js (Fase 4 etapa 2 cleanup).
// generateInviteCode → modules/invite.js (Fase 4 etapa 2). Shim em /shims.js.

// shareInviteCode → modules/invite.js (Fase 4 etapa 2). Shim em /shims.js.

// Quando alguém abre o link compartilhado (?invite=QUC-XXXXX), pré-preenche
// o campo de convite no signup e tenta validar automaticamente. Sem isso, o
// link era só texto — o destinatário ainda tinha que digitar o código à mão.
// _consumeInviteFromUrl → modules/invite.js (Fase 4 etapa 2). Shim em /shims.js.
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _consumeInviteFromUrl);
else _consumeInviteFromUrl();

// Feed is loaded by initAuth after auth check completes


// ══ FEATURE 3 — Maquininha (slot "coming soon") ══
// Mede interesse em receber pagamento no cartao. Zero processamento de pagamento.
// abrirMaquininha → modules/maquininha.js (Fase 4 etapa 2). Shim em /shims.js.

// entrarListaMaquininha → modules/maquininha.js (Fase 4 etapa 2). Shim em /shims.js.

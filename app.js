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
let tt;
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
let currentPainter='carlos';
// openProfile → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ EXPLORE MAP ══
// showPainterCard → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.
// "Ver perfil" no popup do mapa — abre o perfil real do profissional guardado em data-painter-id
// openPainterPopupProfile → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.
// ══ PROFILE TABS ══
// switchTab → modules/profile-mock.js (Fase 4 etapa 2). Shim em /shims.js.
// ══ CALCULATOR ══
let demaos=2;
// setD → modules/calc.js (Fase 4 etapa 2). Shim em /shims.js.
// calcTinta → modules/calc.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ESTIMATIVA DE METRAGEM POR FOTO (PRO) ══
// estimarAreaPorFoto → modules/calc.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AI FEATURES (PRO) ══
let _isPro = false;
let _proExpires = null;

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
const SUPPORT = {
  // Canal de atendimento (Fale Conosco) e solicitações de exclusão de
  // conta (LGPD) — contato da Cali Colors.
  email: 'loja@calicolors.com.br',
  // WhatsApp de atendimento: DDI+DDD+número só dígitos.
  // Cali Colors: (11) 95976-5031.
  whatsapp: '5511959765031'
};
const _infoTitles = {
  menu:'Mais informações e suporte',
  ajuda:'Central de Ajuda',
  contato:'Fale Conosco',
  privacidade:'Política de Privacidade',
  termos:'Termos de Uso',
  conta:'Excluir minha conta',
  sobre:'Sobre o QueroUmaCor'
};
let _infoPage = 'menu';
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

const QUOTE_STATUS = {
  pending:    { label:'A orçar',     color:'#8a8a99' },
  rascunho:   { label:'Rascunho',    color:'#8a8a99' },
  enviado:    { label:'Enviado',     color:'#f4a300' },
  aprovado:   { label:'Aprovado',    color:'#2ec4b6' },
  em_execucao:{ label:'Em execução', color:'#3a86ff' },
  concluido:  { label:'Concluído',   color:'#16a34a' },
  recusado:   { label:'Recusado',    color:'#e63946' }
};
let _pipelineCache = [];

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

let _quotePriceTarget = null;

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

let _crmCache = [];
let _crmIntervalMonths = 12;

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
let _isAdmin = false;

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
let _errsState = { offset: 0, limit: 50, total: 0 };

// openErrorsAdmin → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// loadErrorsAdmin → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// errsPager → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// renderErrorsAdmin → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// openModQueue → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// modAction → modules/admin-mod.js (Fase 4 etapa 2). Shim em /shims.js.

// openAiOrcamento → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// openAiChat → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

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

// sendAiChat → modules/ai-chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MODO CONVERSAÇÃO POR VOZ COM O SEU ZÉ (PRO) ══
// Grava a fala → Whisper transcreve → manda no chat-ai → resposta do
// Seu Zé é falada de volta via OpenAI TTS.
let _aiVoiceRecorder = null;
let _aiVoiceChunks = [];
let _aiVoiceStream = null;
let _aiVoiceAutoStop = null;
let _aiVoiceAudio = null;

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
let _lastOrcData = {};
// Monta o documento jsPDF do orçamento e o retorna (null se sem dados/lib)
// _buildOrcDoc → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.
// gerarPDFOrcamento → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ MATERIAL LIST LINKED TO STORE ══
// loadMaterialSuggestions → modules/orcamento-pdf.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AGENDA DE PROJETOS (calendário) ══
let _agCur = null;   // Date: primeiro dia do mês exibido
let _agSel = null;   // 'yyyy-mm-dd' selecionado
let _agJobs = [];     // cache dos projetos do usuário

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
let _checklistItems = [];
let _checklistRowId = null;
let _checklistSaveQueue = Promise.resolve();
const _checklistTemplates = {
  pintura: ['Proteger pisos com lona','Fita crepe em rodapés e batentes','Lixar paredes (lixa 150)','Aplicar massa corrida','Lixar massa (lixa 220)','Aplicar selador','1ª demão de tinta','2ª demão de tinta','Retoques finais','Limpeza do local'],
  textura: ['Proteger pisos e móveis','Preparar massa texturizada','Aplicar base/selador','Aplicar textura com desempenadeira','Aguardar secagem (4h)','Pintar sobre textura','Retoques','Limpeza'],
  epoxi: ['Lixar piso','Limpar com desengraxante','Aplicar primer epóxi','Aguardar 12h secagem','1ª demão epóxi','2ª demão epóxi','Aguardar 7 dias cura total','Entrega']
};

// renderChecklist → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// addChecklistItem → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// loadChecklistTemplate → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// loadChecklist → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// Salva no Supabase. Os saves são enfileirados para que o primeiro
// INSERT termine (e fixe _checklistRowId) antes do próximo, evitando
// criar linhas duplicadas em cliques rápidos.
// saveChecklist → modules/checklist.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ANOTAÇÕES (notas do pintor) ══
let _editingNoteId = null;
// startEditNote → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.
// cancelEditNote → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.
// saveEditNote → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// loadNotes → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// salvarNota → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// deletarNota → modules/notes.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ GRAVAÇÃO DE ÁUDIO → TRANSCRIÇÃO (PRO) ══
// Grava até 5 min de áudio, manda pro Whisper e cola o texto na nota.
let _recMediaRecorder = null;
let _recChunks = [];
let _recStartTime = 0;
let _recTimerInterval = null;
const REC_MAX_MS = 5 * 60 * 1000;

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
let _autoReplyCfg = null;          // cache da config new_message
const _autoRepliedConvs = new Set(); // evita loop/repeticao por conversa

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
const _blockedWords = [
  'pedofilia','pedofilo',
  'estupro','estuprar','estuprador',
  'cocaina','crackeira',
  'fuzil',
  'assassinar',
  'suicidio',
  'terrorismo','terrorista',
  'pornografia',
  'xxx',
  'nazismo'
];

const _blockedRe = (() => {
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g,'');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = _blockedWords.map(w => esc(norm(w))).join('|');
  return new RegExp('\\b(' + alts + ')\\b', 'i');
})();

// Padrões fortes de scam: encurtadores e domínios típicos de golpe.
// URL normal (https://meusite.com.br, www.instagram.com/foo) NÃO bloqueia
// mais — autopromoção legítima de pintor passa, Gemini avalia contexto.
const _scamLinkRe = /(?:^|\W)(?:bit\.ly|tinyurl\.com|cutt\.ly|t\.me\/|goo\.gl\/|tiny\.cc|encurtador\.com\.br|is\.gd|shorturl\.at)/i;

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
let currentChat = null;
// chatTab → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// applyChatFilter → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// convDisplayName → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ LOCAL STORAGE CHAT PERSISTENCE ══
// Cache em memória + flush debounced (300ms). Antes, cada mensagem em
// realtime triggava read+parse+stringify+write síncronos (~5-10ms cada
// em mobile). Em rajada de 10 msgs = 50-100ms travados na main thread.
// getLocalConvKey → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// getLocalMsgsKey → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

let _convsCache = null;     // dict completo de convs do usuário atual
let _convsCacheUid = null;  // pra invalidar quando trocar de usuário
let _convsDirty = false;
let _convsFlushTimer = null;
const _msgsCache = new Map(); // convId -> array de msgs
const _msgsDirty = new Set();
let _msgsFlushTimer = null;

// _ensureConvsCache → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// _flushConvs → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// _flushMsgs → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Garante flush antes do usuário fechar / trocar de aba (pagehide é mais
// confiável que beforeunload em mobile).
window.addEventListener('pagehide', () => { _flushConvs(); _flushMsgs(); });
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden'){ _flushConvs(); _flushMsgs(); }
});

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
let calicolorsUserId = null;

let _searchNewChatToken = 0;
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

let _notifSub = null;
// setupNotifSubscription → modules/notif.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ PIPELINE AO VIVO — novo pedido aparece sem reabrir a tela ══
// SÓ pra profissional (pintor/grafiteiro/automotivo). Cliente não tem quotes
// onde é o painter_id, então o WebSocket nunca dispara — desperdício.
let _pipelineSub = null;
// setupPipelineSubscription → modules/pipeline.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ LOAD PEDIDOS FROM SUPABASE ══
// loadPedidos → modules/pedidos.js (Fase 4 etapa 2). Shim em /shims.js.

let _epAvatarFile = null; // holds selected avatar file for upload
let _epLogoFile = null;   // holds selected business logo file for upload
let _epLogoClear = false; // user clicked "Remover" → wipe business_logo_url on save

// previewAvatar → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// _epShowLogo → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// previewEpLogo → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// removeEpLogo → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// openEditProfile → modules/profile-edit.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AUTOCOMPLETE: cidade pelo estado (IBGE) ══
const _citiesCache = {};
const _ufByName = {
  'acre':'AC','alagoas':'AL','amapa':'AP','amapá':'AP','amazonas':'AM',
  'bahia':'BA','ceara':'CE','ceará':'CE','distrito federal':'DF',
  'espirito santo':'ES','espírito santo':'ES','goias':'GO','goiás':'GO',
  'maranhao':'MA','maranhão':'MA','mato grosso':'MT','mato grosso do sul':'MS',
  'minas gerais':'MG','para':'PA','pará':'PA','paraiba':'PB','paraíba':'PB',
  'parana':'PR','paraná':'PR','pernambuco':'PE','piaui':'PI','piauí':'PI',
  'rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS',
  'rondonia':'RO','rondônia':'RO','roraima':'RR','santa catarina':'SC',
  'sao paulo':'SP','são paulo':'SP','sergipe':'SE','tocantins':'TO'
};
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
let _globalMsgSub = null;
const _processedMsgIds = new Map(); // id -> true (Map preserves insertion order for LRU)
const MAX_PROCESSED_IDS = 500;
// _markProcessed → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
let _chatListDebounce = null;

// Global realtime subscription for messages - ensures new messages show up
// setupGlobalMsgSubscription → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// handleRealtimeMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Bridge function for starting chat from profile.
// Chamado por startChatWith (head.js) depois de showScreen('chat').
// Mantido como impl separada pra evitar recursão com startChatWith.
// openChatConversation → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.


// ══ AUTH ══
let selectedRole='pintor';
// selectRole → modules/signup-flow.js (Fase 4 etapa 2). Shim em /shims.js.
let validatedInviteCode = null;

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
const _proRoles = ['pintor','grafiteiro','automotivo'];
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
let starVal=0;
const starLabels=['','Ruim 😞','Regular 😐','Bom 🙂','Muito bom 😄','Excelente! 🤩'];
// setStar → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.
// toggleCriteria → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

let avaliarQuoteId = null;
let _avaliarQuotes = [];
// loadAvaliarScreen → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// renderAvaliarServiceList → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// selectAvaliarService → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// submitAvaliacao → modules/avaliacao.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ ORCAMENTO ══
// toggleOrcOutros → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.

// sendOrc → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.
let chatStoreAdded = false;

// Track which message IDs are already rendered to avoid duplicates
const renderedMsgIds = new Set();

// openChat → modules/orcamento-form.js (Fase 4 etapa 2). Shim em /shims.js.

// _msgKind → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// Cor do balao por PESSOA (cada participante uma cor estavel), nao por papel.
const _msgMeColor    = { fg:'#0f9d6b', chip:'#dff5ec', bub:'#e7f8f1', bd:'#bfe8d7' };
const _msgStoreColor = { fg:'#7a30d6', chip:'#efe7fb', bub:'#f3edfb', bd:'#d9c7f5' };
const _msgPalette = [
  { fg:'#2563eb', chip:'#e8f0fe', bub:'#eef4ff', bd:'#cdddfb' }, // azul
  { fg:'#d2541f', chip:'#fff1e8', bub:'#fff3ec', bd:'#f6d4bf' }, // laranja
  { fg:'#be1e63', chip:'#fde8f1', bub:'#fef3f8', bd:'#f5c9dd' }, // rosa
  { fg:'#15803d', chip:'#e3f9ec', bub:'#ecfdf3', bd:'#b8e8cd' }, // verde
  { fg:'#a16207', chip:'#fdf6dd', bub:'#fffbeb', bd:'#f3e3a8' }, // amarelo
  { fg:'#4338ca', chip:'#e6ecff', bub:'#f0f5ff', bd:'#c7d2fe' }, // indigo
];
let _msgColorMap = {};
let _msgColorIdx = 0;
// _resetMsgColors → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.
// _msgColors → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// renderMessages → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// sendMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// appendMsg → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// handleChatAttachment → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.

// addStoreToChat → modules/chat.js (Fase 4 etapa 2). Shim em /shims.js.


// ══ MARKETPLACE ══
let cartCount = 0;
let cartItems = [];
let shirtQty = 1;
let logoState = {pintor: true, cali: true};
let mktProducts = [];

// Dicionário determinístico: cor escrita no nome → hex. Compostos primeiro.
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
// _normTxt → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
// Cores "placeholder" que NÃO contam como cor escolhida de verdade
const _PLACEHOLDER_HEX = /^#?(c0622d|cccccc|ddd|dddddd|e8e2d9)$/i;
// resolveColorHex → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
// productBg → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
// true quando o produto tem cor (gradiente, hex real ou cor pelo nome) → mostrar swatch limpo, sem emoji
// hasProductColor → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// Mesma classificação automática do portal (marca/tipo no nome do produto).
// A ordem importa: o primeiro menu cuja palavra-chave casar vence.
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

// _mktSearchImpl → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.
const mktSearch = (window.debounce ? window.debounce(_mktSearchImpl, 200) : _mktSearchImpl);

// openProductDetail → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

let _mktLoadedAt = 0;
let _mktGrouped = {};
const _MKT_TTL = 5 * 60 * 1000; // 5 min

// Constrói abas + seções. Só renderiza as linhas da 1ª seção; as demais
// são renderizadas sob demanda em mktTab() (lazy).
// renderMktUI → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

const _MKT_HIDDEN = /\bbase\s+(vy|z|xy|w|ly|e|f)\b/i;
// _isMktHidden → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// loadMktProducts → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// changeQty → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// setSizeBtn → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// setShirtColor → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// openShirtZoom → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// closeShirtZoom → modules/mkt.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AI LOGO GENERATOR ══
const _aiLogoPalettes = [
  ['#ff6b35','#1a1a2e','#fff5f0'],
  ['#2ec4b6','#1a1a2e','#e8f8f6'],
  ['#8338ec','#fff','#f3ecff'],
  ['#e63946','#1d3557','#f1faee'],
  ['#0077b6','#fff','#caf0f8'],
  ['#06a77d','#1a1a2e','#e8f5e9']
];
const _aiLogoIcons = [
  // paint roller
  '<g><rect x="14" y="10" width="36" height="10" rx="2" fill="{c1}"/><rect x="28" y="20" width="8" height="6" fill="{c2}"/><rect x="24" y="26" width="16" height="22" rx="2" fill="{c1}"/><rect x="28" y="48" width="8" height="6" fill="{c2}"/></g>',
  // paint brush
  '<g><rect x="10" y="44" width="30" height="6" rx="2" fill="{c2}" transform="rotate(-30 25 47)"/><path d="M40 18 L52 30 L46 36 L34 24 Z" fill="{c1}"/><path d="M34 24 L40 18 L36 14 L30 20 Z" fill="{c2}"/></g>',
  // paint bucket
  '<g><path d="M18 22 L46 22 L42 52 L22 52 Z" fill="{c1}"/><ellipse cx="32" cy="22" rx="14" ry="3" fill="{c2}"/><path d="M22 18 Q32 8 42 18" stroke="{c2}" stroke-width="2" fill="none"/><rect x="28" y="30" width="8" height="14" fill="{c2}" opacity=".4"/></g>',
  // color palette
  '<g><path d="M32 12 C46 12 54 20 54 32 C54 38 50 42 44 42 L40 42 C36 42 34 44 34 48 C34 52 30 54 26 54 C18 54 12 46 12 36 C12 22 20 12 32 12 Z" fill="{c1}"/><circle cx="22" cy="24" r="3" fill="{c2}"/><circle cx="32" cy="20" r="3" fill="{c3}"/><circle cx="42" cy="24" r="3" fill="{c2}"/><circle cx="46" cy="34" r="3" fill="{c3}"/></g>',
  // wall + roller stripe
  '<g><rect x="8" y="14" width="48" height="36" rx="3" fill="{c3}"/><rect x="8" y="14" width="48" height="12" fill="{c1}"/><rect x="38" y="8" width="6" height="22" rx="1" fill="{c2}"/></g>',
  // drop / paint splash
  '<g><path d="M32 10 C40 22 46 30 46 38 C46 46 40 52 32 52 C24 52 18 46 18 38 C18 30 24 22 32 10 Z" fill="{c1}"/><circle cx="26" cy="38" r="3" fill="{c3}" opacity=".7"/></g>'
];

// _hashStr → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

// _renderAiLogoSvg → modules/ai-logo.js (Fase 4 etapa 2). Shim em /shims.js.

let _aiLogoSelected = null;
let _aiLogoLastName = '';

let _aiLogoUrls = null;

const AI_LOGO_REGEN_PRICE_BRL = 1.99;
const _aiLogoFmtBRL = v => 'R$ ' + v.toFixed(2).replace('.', ',');

let _aiLogoCount = 0;
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
let _aiArtPhotoDataUrl = null;     // base64 da foto principal (slot 1)
let _aiArtPhotoDataUrl2 = null;    // base64 da segunda foto (slot 2, antes/depois)
let _aiArtStyle = 'profissional';  // estilo default
let _aiArtAspect = 'square';       // square | vertical | horizontal
let _aiArtResultDataUrl = null;    // base64 da arte gerada FINAL (pode ter logo)
let _aiArtResultCaption = '';
let _aiArtResultOriginal = null;   // base64 da arte SEM logo (pra alternar checkbox)

// openAiArt → modules/ai-art.js (Fase 4 etapa 2). Shim em /shims.js.

// Contador de créditos diário (5/dia, espelha o limit do backend).
// Conta gerações com sucesso por usuário+dia; reseta automaticamente
// ao virar o dia. Fonte da verdade real é o backend — isso é só UX.
const _AI_ART_DAILY_LIMIT = 5;
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
let _aiArtUploadingStyle = null;
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
let currentMode='pintor';


// ══ TYPING ANIMATION CSS ══
const styleTag=document.createElement('style');
styleTag.textContent='@keyframes typing{0%,80%,100%{transform:scale(0.6);opacity:.4;}40%{transform:scale(1);opacity:1;}}';
document.head.appendChild(styleTag);

// ══════════════════════════════
//  CHANGE 1: DYNAMIC FEED
// ══════════════════════════════
let currentPostType = 'post';
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

let _lastFeedLoad = 0;
let _feedRoleFilter = '';

// setFeedFilter → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// filterFeedPosts → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.
const POST_COLS = 'id, user_id, caption, media_url, media_type, status, for_sale, price, art_type, created_at';

// Busca perfis públicos com fallback: tenta profiles_public (view) primeiro;
// se a view não existir/retornar vazio (acontece em DBs que não rodaram a
// migration), cai pra tabela profiles direto — que tem RLS "viewable by
// everyone" e expõe as mesmas colunas seguras.
// fetchPublicProfiles → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.
let _feedOffset = 0;
const FEED_PAGE = 30;

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

let _followingIdsCache = null;
let _followingIdsCacheTime = 0;
// Invalidar via invalidateFollowingIds() depois de seguir/desfollow.
// invalidateFollowingIds → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.
window.invalidateFollowingIds = invalidateFollowingIds;
// getFollowingIds → modules/feed.js (Fase 4 etapa 2). Shim em /shims.js.

// ══ AUTOPLAY DE VÍDEOS NO FEED (estilo Instagram) ══
// Vídeos começam mudos (regra de autoplay dos navegadores); o botão de
// som no canto liga/desliga o áudio para a sessão inteira.
let _feedMuted = true;
let _feedVideoObserver = null;
let _obsVideos = new WeakSet();

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
let _currentOptPostId = null;
let _currentOptUserId = null;

// openPostOpts → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// shareCurrentPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// saveCurrentPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// copyCurrentPostLink → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// deleteCurrentPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// Report post
let _reportPostId = null;
let _reportUserId = null;

// reportPost → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// submitReport → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// Story delete
// deleteCurrentStory → modules/feed-interactions.js (Fase 4 etapa 2). Shim em /shims.js.

// getTimeAgo → modules/utils.js (Fase 4 etapa 2). Shim em /shims.js.

// Stories data grouped by user
let storyGroups = [];
let currentStoryGroup = 0;
let currentStoryIndex = 0;
let storyTimer = null; // mantido pra compat; agora guarda rAF id
let _lastStoriesFp = ''; // fingerprint do último render — pula re-render quando idêntico
let _storyRafId = null;
const STORY_DURATION = 5000; // 5 seconds per story like IG

// _stopStoryAnim → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

// loadStories → modules/stories.js (Fase 4 etapa 2). Shim em /shims.js.

let _seenStories = {};
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
let postSelectedFiles = [];

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
let leafletMap = null;
let mapMarkers = [];

// Carrega Leaflet sob demanda (não vem mais no <head> pra economizar ~160KB
// no first paint — só usuário do mapa paga o custo).
let _leafletInflight = null;
// ensureLeaflet → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// initLeafletMap → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// createPinIcon → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

let dbPainters = [];
// Índice pré-construído pra buscar pintor em O(1) por inclusão. Evita
// re-tokenizar 80 strings a cada tecla. Invalidado quando dbPainters muda.
let _paintersIndex = null;
// _invalidatePaintersIndex → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
// _buildPaintersIndex → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
// AbortController pra cancelar fetch fallback anterior se o usuário
// digitar mais rápido que a rede responde.
let _paintersSearchAbort = null;

// loadMapPainters → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// _starStr → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

let _exploreType = 'all';
// _matchType → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
// exploreType → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// renderPainterList → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// _filterExplorePaintersImpl → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.
const filterExplorePainters = (window.debounce ? window.debounce(_filterExplorePaintersImpl, 250) : _filterExplorePaintersImpl);

// loadLocalPaintersOnMap → modules/map.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  CHANGE 4: ARCHIVE CONVERSATIONS
// ══════════════════════════════
let archivedConvs = [];
let archivedExpanded = false;

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
// Wrap showScreen to add hooks for dynamic loading
const _origShowScreen = showScreen;
showScreen = function(n, _fromPop){
  _origShowScreen(n, _fromPop);
  if(n === 'myprofile'){
    autoDetectRole();
  }
  if(n === 'feed'){
    loadFeed();
  }
  if(n === 'explore'){
    setTimeout(async () => {
      await initLeafletMap();
      if(leafletMap) leafletMap.invalidateSize();
    }, 200);
  }
  if(n === 'chat'){
    setTimeout(initArchiveButtons, 100);
  }
};

// ══════════════════════════════
//  TAG UNIQUENESS CHECK
// ══════════════════════════════
let tagAvailable = false;
let tagCheckTimeout;

// validateAndGoStep3 → modules/signup-tag.js (Fase 4 etapa 2). Shim em /shims.js.

// checkTagAvailability → modules/signup-tag.js (Fase 4 etapa 2). Shim em /shims.js.

// ══════════════════════════════
//  INVITE CODE GENERATION
// ══════════════════════════════
let generatedInviteCode = {};
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

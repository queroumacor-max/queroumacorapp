const { useState, useEffect } = React;
// Otimizações usadas como React.useMemo / React.useCallback / React.memo abaixo.

const supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

const C = {
  ink: '#1a1a2e', ink2: '#16213e', cream: '#f7f3ee', border: '#e8e2d9',
  muted: '#9e9687', white: '#ffffff',
  p1: '#ff6b35', p2: '#f7c59f', p3: '#2ec4b6', p4: '#e63946',
  p5: '#8338ec', p6: '#06d6a0', p7: '#ffd166',
  bg: '#f7f3ee', sidebar: '#1a1a2e'
};

// ============================================================
// StatusBadge — chip de status reutilizavel (cor + label).
// Recebe `status`, mapa de cores e mapa de labels.
// ============================================================
const StatusBadge = React.memo(function StatusBadge({ status, colorMap, labelMap, size }) {
  const s = size || 'sm';
  const bg = (colorMap && colorMap[status]) || '#e5e7eb';
  const label = (labelMap && labelMap[status]) || status;
  const fontSize = s === 'sm' ? 11 : 12;
  return (
    <span style={{
      display:'inline-block', padding: s === 'sm' ? '2px 8px' : '4px 12px',
      background: bg, color:'#fff', borderRadius:20, fontSize, fontWeight:700
    }}>{label}</span>
  );
});

// Maps de cor/label para os varios chips de status do portal.
// (LEAD_STATUS_COLORS / LEAD_SEG_COLORS ja existem mais abaixo perto do componente Leads.)
const POSTS_STATUS_COLORS = { approved: '#28a745', rejected: '#e74c3c', pending: '#f0ad4e' };
const POSTS_STATUS_LABELS = { approved: 'Aprovado', rejected: 'Rejeitado', pending: 'Pendente' };

const REPORTS_STATUS_COLORS = { pending: '#b8860b', resolved: '#06d6a0', dismissed: '#9e9687' };
const REPORTS_STATUS_LABELS = { pending: 'Pendente', resolved: 'Resolvida', dismissed: 'Descartada' };

const REFERRALS_STATUS_COLORS = { completed: '#06d6a0', pending: '#b8860b', cancelled: '#e63946' };
const REFERRALS_STATUS_LABELS = { completed: 'Completa', pending: 'Pendente', cancelled: 'Cancelada' };

// Status de fulfillment (setados pelo admin) + de pagamento (setados pelo
// webhook do MP). Grafia 'canceled' (1 L) pra casar com o constraint do banco.
const ORDERS_STATUS_COLORS = { pending: '#ffd166', processing: '#ff6b35', shipped: '#2ec4b6', completed: '#06d6a0', canceled: '#e63946', paid: '#06d6a0', amount_mismatch: '#e63946', refunded: '#8338ec' };
const ORDERS_STATUS_LABELS = { pending: 'Aguardando', processing: 'Em andamento', shipped: 'Enviado', completed: 'Concluido', canceled: 'Cancelado', paid: 'Pago', amount_mismatch: 'Divergencia valor', refunded: 'Reembolsado' };

// 'fixo' (2026-09-09, pedido do usuario): telefone fixo, sem WhatsApp — a
// abordagem por template nunca vai chegar (foi boa parte dos 90 "nao
// entregue" do incidente). Nao e "perdido": o lead pode valer por outro
// canal. Lead 'fixo' sai da selecao em lote; o botao Abordar unitario
// segue, porque o numero pode ter WhatsApp Business mesmo sendo fixo.
const LEADS_STATUS = ['novo','contactado','qualificado','convertido','perdido','fixo'];
const LEADS_STATUS_LABELS = { novo: 'Novo', contactado: 'Contactado', qualificado: 'Qualificado', convertido: 'Convertido', perdido: 'Perdido', fixo: 'Fixo (sem WhatsApp)' };

// ============================================================
// Services CRUD — wrappers de supabase com erro via throw.
// Quem chama DEVE try/catch.
// ============================================================
const productsService = {
  list: () => buscarTudo(() => supa.from('products').select('*').order('name')),
  // `.select()` no fim devolve a linha gravada — a tela emenda so ela na
  // lista em vez de recarregar o catalogo inteiro depois de cada salvamento.
  upsert: async (p) => { const r = await supa.from('products').upsert(p).select(); if (r.error) throw r.error; return r.data; },
  remove: async (id) => { const r = await supa.from('products').delete().eq('id', id); if (r.error) throw r.error; }
};

// PostgREST corta a resposta em 1000 linhas (max-rows do Supabase) e NAO
// avisa: a lista so vem curta. Foi o que aconteceu com os leads — o banco
// tinha 1072 e a tela mostrava 1000, com 72 invisiveis. Toda listagem que
// pode passar de mil linhas precisa passar por aqui.
const PAGINA_SUPA = 1000;
async function buscarTudo(montarQuery) {
  const tudo = [];
  // Sem teto: o teto de 50 mil que existia aqui parava em silencio na pagina
  // 50 — com 61 mil leads, a tela mostrava 50 mil e ninguem sabia.
  for (let de = 0; ; de += PAGINA_SUPA) {
    const r = await montarQuery().range(de, de + PAGINA_SUPA - 1);
    if (r.error) throw r.error;
    const lote = r.data || [];
    tudo.push(...lote);
    if (lote.length < PAGINA_SUPA) break;
  }
  return tudo;
}

// [teste:paginas-inicio]
// LISTA GRANDE, EM PARALELO E PROGRESSIVA (2026-09-09). Com 61 mil leads o
// `buscarTudo` (uma pagina de cada vez, esperando a anterior) levava
// minutos, e a tela ficava em "Carregando" ate a ULTIMA chegar. Aqui a
// primeira pagina pede `count:'exact'` pra saber quantas faltam, as demais
// saem PAGINAS_PARALELO de cada vez, e cada lote e guardado na SUA posicao
// (`paginas[n]`) — as respostas chegam fora de ordem e o `juntar` devolve
// a ordem da consulta. `aoChegar(parcial, total)` roda a cada lote, com a
// lista ja em ordem, pra tela pintar antes do fim. `cancelado()` = a tela
// fechou; os trabalhadores param sem estourar erro.
// `montarQuery(extra)` recebe as opcoes do select ({count:'exact'} na
// primeira pagina, {} nas outras) e devolve a consulta ORDENADA por chave
// unica — paginar por `created_at` sozinho repete/pula linha quando um
// lote de importacao inteiro tem o mesmo carimbo.
const PAGINAS_PARALELO = 4;
async function buscarEmPaginas(montarQuery, opts) {
  opts = opts || {};
  const cancelado = opts.cancelado || (() => false);
  const primeira = await montarQuery({ count: 'exact' }).range(0, PAGINA_SUPA - 1);
  if (primeira.error) throw primeira.error;
  const paginas = [primeira.data || []];
  const juntar = () => { const out = []; for (const lote of paginas) if (lote) out.push.apply(out, lote); return out; };
  // Sem `count` (PostgREST nao respondeu), o total e desconhecido: segue em
  // serie ate vir pagina curta, que e o que o `buscarTudo` sempre fez.
  if (typeof primeira.count !== 'number') {
    if (opts.aoChegar) opts.aoChegar(juntar(), null);
    for (let n = 1; paginas[n - 1].length === PAGINA_SUPA && !cancelado(); n++) {
      const r = await montarQuery({}).range(n * PAGINA_SUPA, (n + 1) * PAGINA_SUPA - 1);
      if (r.error) throw r.error;
      paginas[n] = r.data || [];
      if (opts.aoChegar) opts.aoChegar(juntar(), null);
    }
    return juntar();
  }
  const total = primeira.count;
  if (opts.aoChegar) opts.aoChegar(juntar(), total);
  const faltando = [];
  for (let n = 1; n * PAGINA_SUPA < total; n++) faltando.push(n);
  let cursor = 0;
  const trabalhador = async () => {
    while (cursor < faltando.length && !cancelado()) {
      const n = faltando[cursor++];
      const r = await montarQuery({}).range(n * PAGINA_SUPA, (n + 1) * PAGINA_SUPA - 1);
      if (r.error) throw r.error;
      paginas[n] = r.data || [];
      if (opts.aoChegar) opts.aoChegar(juntar(), total);
    }
  };
  const ts = [];
  for (let i = 0; i < Math.min(PAGINAS_PARALELO, faltando.length); i++) ts.push(trabalhador());
  await Promise.all(ts);
  return juntar();
}

// Chama `f` no maximo uma vez a cada `ms`, sempre com os ULTIMOS argumentos
// (a chamada que ficou presa sai quando o intervalo vence). Serve pra nao
// remontar a tela a cada lote que chega — 60 lotes = 60 refiltragens de
// dezenas de milhares de linhas.
function comIntervalo(f, ms) {
  let ultimo = 0, timer = null, args = null;
  const g = function () {
    args = arguments;
    const falta = ms - (Date.now() - ultimo);
    if (falta <= 0) { ultimo = Date.now(); f.apply(null, args); return; }
    if (!timer) timer = setTimeout(() => { timer = null; ultimo = Date.now(); f.apply(null, args); }, falta);
  };
  g.agora = function () { if (timer) { clearTimeout(timer); timer = null; } if (args) { ultimo = Date.now(); f.apply(null, args); } };
  g.cancelar = function () { if (timer) { clearTimeout(timer); timer = null; } args = null; };
  return g;
}
// [teste:paginas-fim]

const leadsService = {
  // `opts.aoChegar(parcial, total)` — ver buscarEmPaginas. A ordem tem a
  // chave `id` como desempate de proposito (ver comentario la em cima).
  list: (opts) => buscarEmPaginas(
    (extra) => supa.from('leads').select('*', extra).order('created_at', { ascending:false }).order('id'),
    opts
  ),
  // So os leads cuja abordagem mexeu desde `desdeIso`: e o que o poll e o
  // pos-envio precisam — recarregar 61 mil linhas pra ver 30 mudarem nao.
  // Paginado (sem teto): um lote de abordagem pode passar de mil leads em
  // seis horas, e um `limit(1000)` deixaria os mais antigos sem o status.
  recentes: (desdeIso) => buscarEmPaginas(
    (extra) => supa.from('leads').select('*', extra).gte('abordagem_at', desdeIso).order('abordagem_at', { ascending:false }).order('id')
  ),
  updateStatus: async (id, status) => { const r = await supa.from('leads').update({status}).eq('id', id); if (r.error) throw r.error; },
  remove: async (id) => { const r = await supa.from('leads').delete().eq('id', id); if (r.error) throw r.error; },
  insertBatch: async (rows) => { const r = await supa.from('leads').insert(rows); if (r.error) throw r.error; return r.data; }
};

const announcementsService = {
  list: async () => { const r = await supa.from('announcements').select('*').order('created_at', {ascending:false}); if (r.error) throw r.error; return r.data || []; },
  insert: async (a) => { const r = await supa.from('announcements').insert(a); if (r.error) throw r.error; },
  toggle: async (id, active) => { const r = await supa.from('announcements').update({active}).eq('id', id); if (r.error) throw r.error; },
  remove: async (id) => { const r = await supa.from('announcements').delete().eq('id', id); if (r.error) throw r.error; }
};

const postsService = {
  setStatus: async (id, status) => { const r = await supa.from('posts').update({status}).eq('id', id); if (r.error) throw r.error; },
  deleteWithChildren: async (id) => {
    await supa.from('likes').delete().eq('post_id', id);
    await supa.from('comments').delete().eq('post_id', id);
    const r = await supa.from('posts').delete().eq('id', id);
    if (r.error) throw r.error;
  }
};

const ordersService = {
  updateStatus: async (id, status) => { const r = await supa.from('orders').update({status}).eq('id', id); if (r.error) throw r.error; }
};

const reportsService = {
  resolve: async (id) => { const r = await supa.from('reports').update({status:'resolved'}).eq('id', id); if (r.error) throw r.error; }
};

// Cria um usuario via cliente Supabase efemero (storageKey unico), para nao
// invalidar a sessao do admin logado. Faz auth.signUp + upsert em profiles e
// sempre fecha a sessao do cliente efemero no finally.
//
// Args:
//   - name, email, password: obrigatorios (password >= 8)
//   - role: 'cliente' | 'pintor' | 'grafiteiro' | 'automotivo' | 'admin'
//   - profession: opcional (rotulo extra; ex.: 'funileiro')
//   - portalAccess: se true, marca profile.portal_access = true
//   - inviteCode: se passado, grava em profile.invite_code_used
//   - userMetadata: campos extras para options.data do auth.signUp
//   - extraProfile: campos extras para o upsert em profiles (email, tag,
//     invited_by, user_type, etc.) — permite cada chamador manter o shape
//     exato que ja gravava antes do refactor.
//
// Retorno: { ok: true, userId } em sucesso ou { ok: false, error } em falha.
const authService = {
  async signUpAppUser({ name, email, password, role, profession, portalAccess, inviteCode, userMetadata, extraProfile }) {
    if (!email || !password) {
      return { ok: false, error: 'Email e senha sao obrigatorios' };
    }
    if (password.length < 8) {
      return { ok: false, error: 'Senha deve ter no minimo 8 caracteres' };
    }
    const cleanEmail = (email || '').trim();
    const cleanName = (name || '').trim();
    const ephemeral = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: 'sb-portal-app-create-' + Date.now() }
    });
    try {
      const signUpOptions = { data: Object.assign({ name: cleanName || cleanEmail }, userMetadata || {}) };
      const { data: authData, error: authErr } = await ephemeral.auth.signUp({
        email: cleanEmail,
        password,
        options: signUpOptions
      });
      if (authErr) throw authErr;
      const userId = authData && authData.user && authData.user.id;
      if (!userId) return { ok: false, error: 'Nao foi possivel criar usuario' };

      const profile = Object.assign({
        id: userId,
        name: cleanName || cleanEmail,
        role,
        created_at: new Date().toISOString()
      }, extraProfile || {});
      if (profession) profile.profession = profession;
      if (portalAccess) profile.portal_access = true;
      if (inviteCode) profile.invite_code_used = inviteCode;

      const { error: profErr } = await ephemeral.from('profiles').upsert(profile, { onConflict: 'id' });
      if (profErr) {
        console.warn('authService: profile upsert falhou', profErr.message);
        return { ok: false, error: profErr.message || 'Erro ao salvar perfil' };
      }
      return { ok: true, userId };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    } finally {
      try { await ephemeral.auth.signOut(); } catch(_) {}
    }
  }
};

// Classificacao de perfis (consistente em todo o portal)
const PRO_ROLES = ['pintor','grafiteiro','graffiti','automotivo','funileiro','arquiteto','engenheiro'];
const roleOf = p => ((p && (p.role || p.user_type)) || '').toString().trim().toLowerCase();
// Obs: a coluna profession tem DEFAULT 'pintor', entao NAO serve para
// classificar (marcaria todo cliente como profissional). Usada so no rotulo.
const professionOf = p => ((p && p.profession) || '').toString().trim().toLowerCase();
const isProProfile = p => PRO_ROLES.includes(roleOf(p));
const isPortalStaff = p => roleOf(p) === 'admin' || (p && p.portal_access === true);
// Cliente = qualquer perfil cadastrado que nao seja profissional nem staff do portal
const isClienteProfile = p => !isProProfile(p) && roleOf(p) !== 'admin';
const ROLE_LABEL = { pintor:'Pintor', grafiteiro:'Grafiteiro/Muralista', graffiti:'Grafiteiro/Muralista', automotivo:'Pintor Automotivo', funileiro:'Funileiro', arquiteto:'Arquiteto', engenheiro:'Engenheiro', cliente:'Cliente', admin:'Admin' };
const tipoLabel = p => ROLE_LABEL[professionOf(p)] || ROLE_LABEL[roleOf(p)] || (roleOf(p) || 'Cliente');

// Opcoes de papel para criar usuario do app (mesmo modelo do cadastro no app)
const APP_ROLE_OPTIONS = [
  { v:'pintor', label:'Pintor', role:'pintor' },
  { v:'grafiteiro', label:'Grafiteiro / Muralista', role:'grafiteiro' },
  { v:'automotivo', label:'Pintor Automotivo', role:'automotivo' },
  { v:'funileiro', label:'Funileiro', role:'automotivo', profession:'funileiro' },
  { v:'arquiteto', label:'Arquiteto', role:'arquiteto', profession:'arquiteto' },
  { v:'engenheiro', label:'Engenheiro', role:'arquiteto', profession:'engenheiro' },
  { v:'cliente', label:'Cliente', role:'cliente' },
];

const CreateAppUserForm = ({ onCreated, defaultRole }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name:'', email:'', password:'', roleKey: defaultRole || 'pintor' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const submit = async () => {
    setErr(''); setMsg('');
    const name = form.name.trim(), email = form.email.trim(), password = form.password;
    if (!email || !password) { setErr('Email e senha sao obrigatorios'); return; }
    if (password.length < 8) { setErr('Senha deve ter no minimo 8 caracteres'); return; }
    const opt = APP_ROLE_OPTIONS.find(o => o.v === form.roleKey) || APP_ROLE_OPTIONS[0];
    setSaving(true);
    try {
      const tag = (email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '') + '_' + Math.random().toString(36).slice(2, 7);
      const res = await authService.signUpAppUser({
        name: name || email,
        email,
        password,
        role: opt.role,
        profession: opt.profession,
        userMetadata: { user_type: opt.role, tag },
        extraProfile: { email, tag, user_type: opt.role }
      });
      if (!res.ok) { setErr(res.error || 'Erro ao criar usuario'); return; }
      setMsg('Usuario criado. Ja pode entrar no app com essas credenciais.');
      setForm({ name:'', email:'', password:'', roleKey: defaultRole || 'pintor' });
      setOpen(false);
      if (onCreated) onCreated();
    } catch (e) {
      setErr(e.message || 'Erro ao criar usuario');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom:16 }}>
      <button onClick={() => { setOpen(!open); setErr(''); setMsg(''); }} style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:700 }}>
        {open ? 'Cancelar' : '+ Criar usuario do app'}
      </button>
      {msg && <div style={{ color:C.p6, fontSize:13, marginTop:8 }}>{msg}</div>}
      {open && (
        <div style={{ background:C.cream, borderRadius:12, padding:16, marginTop:12, border:'1px solid '+C.border }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Nome</div>
              <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} placeholder="Nome (opcional)" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Email</div>
              <input value={form.email} onChange={e=>setForm({...form, email:e.target.value})} placeholder="email@exemplo.com" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Senha</div>
              <input type="password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})} placeholder="Minimo 6 caracteres" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Tipo de perfil</div>
              <select value={form.roleKey} onChange={e=>setForm({...form, roleKey:e.target.value})} style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none', background:'#fff' }}>
                {APP_ROLE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {err && <div style={{ color:'#e63946', fontSize:13, marginBottom:10 }}>{err}</div>}
          <button disabled={saving} onClick={submit} style={{ background:C.p6, color:'#fff', border:'none', borderRadius:10, padding:'10px 20px', cursor: saving?'wait':'pointer', fontSize:13, fontWeight:700 }}>
            {saving ? 'Criando...' : 'Criar usuario'}
          </button>
        </div>
      )}
    </div>
  );
};

// O update direto em profiles de outra pessoa falha silenciosamente
// por RLS (unica policy de UPDATE e auth.uid() = id). Por isso tudo
// vai pelo endpoint /api/admin/users com service role.
// (era /api/admin-users no Cloudflare Function; virou rota Next em app/api/admin/users)
// Versao "crua": devolve { ok, error } SEM alert — a exclusao em massa usa
// isso pra agregar as falhas num relatorio unico em vez de 1 alerta por conta.
const adminUsersRaw = async (payload) => {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) return { ok: false, error: 'Sessao expirada. Entre novamente.' };
  const r = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: session.access_token, ...payload })
  });
  // Le como TEXTO primeiro: quando o 5xx vem do PROPRIO Cloudflare (a
  // function morreu), o corpo e uma pagina HTML — o res.json() falhava
  // mudo e o relatorio mostrava so "HTTP 502", impossivel saber a origem.
  // Agora o trecho cru do corpo entra no relatorio.
  let raw = '';
  try { raw = await r.text(); } catch (_) {}
  let res = {};
  try { res = JSON.parse(raw); } catch (_) {}
  if (!r.ok || !res.ok) {
    const snippet = res.error ? '' : (raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { ok: false, status: r.status, error: res.error || ('HTTP ' + r.status + (snippet ? ' — corpo: "' + snippet + '"' : ' (sem corpo)')) };
  }
  return { ok: true };
};

// Igual ao adminUsers, mas DEVOLVE o corpo da resposta — algumas actions
// respondem com DADO (sync_email traz o e-mail de login), nao so ok/erro.
// Em falha: alerta (mesma mensagem) e devolve null.
const adminUsersData = async (payload) => {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { alert('Sessao expirada. Entre novamente.'); return null; }
  const r = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: session.access_token, ...payload })
  });
  let res = {};
  try { res = await r.json(); } catch (_) {}
  if (!r.ok || !res.ok) {
    if (r.status === 503 || /SERVICE_ROLE_KEY/i.test(res.error || '')) {
      alert('Gestao de usuarios indisponivel.\n\nO servidor ainda nao esta configurado para esta acao. ' +
            'E preciso definir a variavel de ambiente SUPABASE_SERVICE_ROLE_KEY no Cloudflare Pages ' +
            '(Settings -> Environment variables -> Production) e refazer o deploy.\n\n' +
            'Fale com o responsavel tecnico para concluir essa configuracao.');
    } else {
      alert('A acao falhou: ' + (res.error || ('HTTP ' + r.status)));
    }
    return null;
  }
  return res;
};

// Boolean pra maioria das actions (o resto do portal ja usa assim).
const adminUsers = async (payload) => !!(await adminUsersData(payload));

const promoteToPortal = async (id, after) => {
  if (!confirm('Promover este perfil a usuario do portal? Ele passara a ter acesso ao portal administrativo.')) return;
  if (await adminUsers({ action:'promote', userId:id }) && after) after();
};

const revokePortal = async (id, after) => {
  if (!confirm('Remover o acesso ao portal deste usuario?')) return;
  if (await adminUsers({ action:'revoke', userId:id }) && after) after();
};

const setProfileVerified = async (id, value, after) => {
  if (await adminUsers({ action:'verify', userId:id, value }) && after) after();
};








// Busca o e-mail de LOGIN no Auth e espelha em profiles.email. O portal
// lista `profiles.email`, que e so um ESPELHO: perfil antigo (ou criado
// por fluxo que nao preenchia a coluna) aparece com "—" mesmo tendo login.
// A chave anon nao ve `auth.users`, entao quem busca e o servidor.
const pullUserEmail = async (profile, after) => {
  const res = await adminUsersData({ action:'sync_email', userId: profile.id });
  if (!res) return null;
  alert(
    'E-mail de login de ' + (profile.name || 'este perfil') + ':\n\n' + res.email +
    (res.source === 'profile' ? '\n\n(veio do perfil — sem login no Auth)' : '')
  );
  if (after) after();
  return res.email;
};

// Exclusao PERMANENTE (Auth + profiles). Confirmacao digitada porque nao
// tem volta. O backend bloqueia excluir a si mesmo e perfis admin/portal.
const deleteUsersPermanently = async (profiles, after) => {
  if (!profiles.length) return;
  const names = profiles.map(p => '• ' + (p.name || 'Sem nome') + (p.tag ? ' (@' + p.tag + ')' : '')).join('\n');
  // Dupla confirmacao com BOTOES (nao digitacao): no celular, digitar
  // "EXCLUIR" num prompt era erro garantido e travava o uso legitimo.
  // Dois passos ja evitam o clique acidental, que e o risco real aqui.
  if (!confirm(
    'EXCLUIR PERMANENTEMENTE ' + profiles.length + ' conta(s)?\n\n' + names +
    '\n\nApaga o LOGIN e o PERFIL do Supabase. SEM VOLTA.'
  )) return;
  if (!confirm(
    'Ultima confirmacao: ' + profiles.length + ' conta(s) serao apagadas para sempre.\n\n' +
    'Nao existe desfazer. Confirmar a exclusao?'
  )) return;
  // Conta com acesso ADMIN/PORTAL exige um TERCEIRO aceite (a pedido:
  // "habilitar para excluir aqui tbm") — a RPC so as apaga com
  // p_force_admin=true. A PROPRIA conta segue impossivel de excluir.
  const adminTargets = profiles.filter(p => p.portal_access || p.role === 'admin');
  if (adminTargets.length && !confirm(
    'ATENCAO: ' + adminTargets.length + ' conta(s) com acesso ADMIN/PORTAL:\n\n' +
    adminTargets.map(p => '• ' + (p.name || (p.tag ? '@'+p.tag : p.id.slice(0,8)))).join('\n') +
    '\n\nExcluir contas de administrador tambem?'
  )) return;
  // Exclusao via RPC admin_delete_user DIRETO no banco (Wave 43): a rota
  // do edge morria com 502 do proprio Cloudflare no meio da cascata do
  // Auth. A RPC roda a cascata inteira DENTRO do Postgres (sem HTTP pro
  // GoTrue, sem edge no caminho) e valida portal admin + guardas la.
  // Sequencial com pausa curta; falhas AGREGADAS num relatorio unico.
  let ok = 0; const failed = [];
  for (const p of profiles) {
    let msg = '';
    try {
      const { error } = await supa.rpc('admin_delete_user', {
        p_user_id: p.id,
        p_force_admin: !!(p.portal_access || p.role === 'admin')
      });
      if (error) msg = error.message || 'erro desconhecido';
    } catch (e) { msg = (e && e.message) || 'falha de rede'; }
    if (!msg) ok++;
    else failed.push('• ' + (p.name || (p.tag ? '@'+p.tag : p.id.slice(0,8))) + ' — ' + msg);
    await new Promise(res => setTimeout(res, 250));
  }
  alert(
    'Excluidas: ' + ok + ' de ' + profiles.length + ' conta(s)' +
    (failed.length
      ? '\n\nFALHARAM ' + failed.length + ':\n' + failed.slice(0, 8).join('\n') +
        (failed.length > 8 ? '\n…e mais ' + (failed.length - 8) : '')
      : '')
  );
  if (after) after();
};

// Celula de @tag — compartilhada pelas tabelas. Edicao no modal.
const TagCell = ({ profile, after }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
    <span style={{ color:C.p3, fontWeight:600 }}>{profile.tag ? '@'+profile.tag : '—'}</span>
  </span>
);

// Nome + o UNICO lapis da linha: abre o modal que edita tudo.
//
// Antes cada coluna tinha o seu lapis, e cada um abria um `prompt()` do
// navegador — sete dialogos do Chrome pra editar uma pessoa. Agora e um so,
// e a linha para de parecer um formulario disfarcado de tabela.
const NameCell = ({ profile, after }) => {
  const [editando, setEditando] = useState(false);
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
      <span style={{ fontWeight:600 }}>{profile.name || 'Sem nome'}</span>
      <button onClick={() => setEditando(true)} title="Editar dados da pessoa"
        style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'2px 6px', cursor:'pointer', fontSize:11 }}>✏️</button>
      {editando && <EditarPessoaModal profile={profile} onClose={() => setEditando(false)} after={after} />}
    </span>
  );
};

// E-mail. A EDICAO vive no modal (o lapis do nome); aqui fica so o 🔄, que
// busca o e-mail de LOGIN no Auth quando o espelho `profiles.email` esta
// vazio — o portal sozinho nao enxerga `auth.users`.
const EmailCell = ({ profile, after }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
    <span style={{ color:C.muted }}>{profile.email || '—'}</span>
    {!profile.email && (
      <button onClick={() => pullUserEmail(profile, after)} title="Buscar o e-mail de login no Auth"
        style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'2px 6px', cursor:'pointer', fontSize:11 }}>🔄</button>
    )}
  </span>
);

// Cidade / UF / Especialidades — so leitura na tabela; edicao no modal.
const CityCell = ({ profile, after }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
    <span>{profile.city || '—'}</span>
  </span>
);
const StateCell = ({ profile, after }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
    <span>{profile.state || '—'}</span>
  </span>
);
const SpecialtiesCell = ({ profile, after }) => (
  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
    <span style={{ color:C.muted, fontSize:12 }}>{profile.specialties || '—'}</span>
  </span>
);

// Telefone + atalho de WhatsApp (edicao no modal). `profiles.phone` guarda digitos
// ("5511959765031"), entao a exibicao passa pelo mesmo formatador das
// conversas — sem ele a tabela mostrava a string crua.
const fmtTelefonePerfil = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  return fmtWaPhone(normalizeLeadPhone(d) || d);
};

const PhoneCell = ({ profile, after }) => {
  const alvo = normalizeLeadPhone(profile.phone);
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
      <span>{fmtTelefonePerfil(profile.phone) || '—'}</span>
      {alvo && (
        <a href={'https://wa.me/' + alvo} target="_blank" rel="noopener noreferrer" title="Abrir no WhatsApp"
          style={{ textDecoration:'none', border:'1px solid '+C.border, borderRadius:6, padding:'2px 6px', fontSize:11 }}>📱</a>
      )}
    </span>
  );
};

// Catalogo de especialidades — ESPELHO de next-app/lib/services/profile.ts
// (ROLE_SPECS). O portal e um arquivo unico sem imports, entao a lista e
// duplicada aqui de proposito; o teste __tests__/portalEspecialidades.test.ts
// compara os dois e QUEBRA se divergirem.
//
// Por que checkbox e nao texto livre (pedido do usuario, 07/09/2026): digitado
// a mao, a mesma especialidade entra como "Piso Epoxi", "piso epoxi" e "Piso
// Epóxi" — tres valores diferentes pro filtro da busca do app, que compara
// string. O catalogo fechado acaba com isso.
const PERFIL_SPECS = {
  pintor: ['Residencial','Comercial','Textura','Grafiato','Piso Epóxi','Fachada','Degradê','Stencil','Industrial','Caiação'],
  grafiteiro: ['Grafite Artístico','Mural Decorativo','Painel Comercial','Arte Urbana','Lettering','Realismo','Abstrato','3D / Ilusão','Stencil Urbano','Lambe-lambe'],
  automotivo: ['Pintura Automotiva','Funilaria','Envelopamento','Polimento','Cristalização','Customização','Aerografia','Restauração','Martelinho de Ouro','PPF / Película'],
  arquiteto: ['Projeto Residencial','Projeto Comercial','Interiores','Reforma','Retrofit','Consultoria de Cores','Memorial Descritivo','Gerenciamento de Obra','Laudo Técnico','Fachada'],
};

// Papel -> catalogo. Sinonimos caem no papel canonico, igual no app.
const specsDoPapel = (papel) => {
  const r = String(papel || '').toLowerCase();
  if (r === 'funileiro') return PERFIL_SPECS.automotivo;
  if (r === 'engenheiro') return PERFIL_SPECS.arquiteto;
  if (r === 'graffiti') return PERFIL_SPECS.grafiteiro;
  return PERFIL_SPECS[r] || [];
};

const parseSpecs = (raw) => String(raw || '').split(',').map(x => x.trim()).filter(Boolean);

// MODAL DE EDICAO — um lugar so pra todas as infos da pessoa.
//
// Substitui os sete `prompt()` do navegador (aquele "www.queroumacor.com.br
// says"). Eles eram ruins por tres motivos, e o terceiro e o que doia:
//  1. sao do Chrome, nao do portal — travam a aba e nao dao pra estilizar;
//  2. um campo por vez: trocar nome, telefone e cidade era abrir tres;
//  3. campo de texto livre em ESPECIALIDADES enchia o banco de variacao
//     ("Piso Epoxi" x "Piso Epóxi"), que o filtro da busca nao casa.
const EditarPessoaModal = ({ profile, onClose, after }) => {
  const [nome, setNome] = useState(profile.name || '');
  const [tag, setTag] = useState(profile.tag || '');
  const [email, setEmail] = useState(profile.email || '');
  const [tel, setTel] = useState(fmtTelefonePerfil(profile.phone) || '');
  const [papel, setPapel] = useState(currentRoleKey(profile));
  const [cidade, setCidade] = useState(profile.city || '');
  const [uf, setUf] = useState(profile.state || '');
  const [specs, setSpecs] = useState(parseSpecs(profile.specialties));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const emailOriginal = (profile.email || '').toLowerCase();
  const catalogo = specsDoPapel(papel);
  // Valor ja gravado que nao esta no catalogo (veio do texto livre antigo).
  // Aparece marcado pra dar pra LIMPAR — some se a pessoa desmarcar.
  const fora = specs.filter(x => !catalogo.includes(x));

  const alterna = (valor) => setSpecs(prev =>
    prev.includes(valor) ? prev.filter(x => x !== valor) : prev.concat(valor));

  const salvar = async () => {
    setErro('');
    const nm = nome.trim().replace(/\s+/g, ' ');
    if (nm.length < 2 || nm.length > 60) { setErro('Nome: use de 2 a 60 caracteres.'); return; }
    const tg = tag.trim().replace(/^@+/, '').toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(tg)) { setErro('@tag invalida: 3 a 24 caracteres (a-z, 0-9, _). Nao pode ficar vazia.'); return; }
    const em = email.trim().toLowerCase();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { setErro('E-mail invalido (esperado: nome@dominio.com).'); return; }
    const so = tel.replace(/\D/g, '');
    if (tel.trim() && !(so.length >= 10 && so.length <= 15)) { setErro('Telefone invalido: use DDD + numero (ex.: 11 95976-5031).'); return; }
    const estado = uf.trim().toUpperCase();
    if (estado && !/^[A-Z]{2}$/.test(estado)) { setErro('UF invalida: 2 letras (ex.: SP) ou vazio.'); return; }
    if (cidade.trim().length > 60) { setErro('Cidade muito longa (max 60).'); return; }
    const especialidades = specs.join(', ');
    if (especialidades.length > 200) { setErro('Especialidades passam de 200 caracteres — desmarque alguma.'); return; }

    // Trocar o e-mail troca o LOGIN. Confirmacao a parte, como no fluxo antigo.
    if (em && em !== emailOriginal &&
        !confirm('Confirmar a troca do e-mail de LOGIN para:\n\n' + em + '\n\nA pessoa passara a entrar com esse e-mail.')) return;

    setSalvando(true);
    const falhas = [];
    const passo = async (rotulo, req) => { if (!(await adminUsers(req))) falhas.push(rotulo); };

    // Um pedido por campo alterado — a rota admin ja tem uma action por
    // assunto, e mandar so o que mudou evita reescrever valor identico.
    if (nm !== (profile.name || '')) await passo('nome', { action:'set_name', userId: profile.id, name: nm });
    if (tg !== (profile.tag || '')) await passo('@tag', { action:'set_tag', userId: profile.id, tag: tg });
    if (em && em !== emailOriginal) await passo('e-mail', { action:'set_email', userId: profile.id, email: em });
    if (papel !== currentRoleKey(profile)) await passo('tipo', { action:'set_role', userId: profile.id, roleKey: papel });

    const info = {};
    if (tel.trim() !== (fmtTelefonePerfil(profile.phone) || '')) info.phone = tel.trim();
    if (cidade.trim() !== (profile.city || '')) info.city = cidade.trim();
    if (estado !== (profile.state || '')) info.state = estado;
    if (especialidades !== (profile.specialties || '')) info.specialties = especialidades;
    if (Object.keys(info).length) await passo('dados', Object.assign({ action:'set_info', userId: profile.id }, info));

    setSalvando(false);
    if (falhas.length) { setErro('Nao salvou: ' + falhas.join(', ') + '. O resto foi gravado.'); return; }
    if (after) after();
    onClose();
  };

  const campo = { width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid '+C.border, fontSize:13, outline:'none', background:C.white, color:C.ink };
  const rotulo = { display:'block', fontSize:11, fontWeight:700, letterSpacing:.4, textTransform:'uppercase', color:C.muted, marginBottom:5 };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(26,26,46,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:C.white, borderRadius:16, width:'100%', maxWidth:620, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.28)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid '+C.border, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:C.white, borderRadius:'16px 16px 0 0' }}>
          <b style={{ fontSize:15 }}>Editar {profile.name || 'pessoa'}</b>
          <button onClick={onClose} title="Fechar" style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:C.muted, lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:20, display:'grid', gap:14 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div>
              <label style={rotulo}>Nome</label>
              <input value={nome} onChange={e => setNome(e.target.value)} style={campo} />
            </div>
            <div>
              <label style={rotulo}>@tag</label>
              <input value={tag} onChange={e => setTag(e.target.value)} placeholder="sem o @" style={campo} />
            </div>
          </div>

          <div>
            <label style={rotulo}>E-mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)} style={campo} />
            <p style={{ fontSize:11, color:C.muted, margin:'5px 0 0' }}>
              Trocar aqui troca tambem o <b>e-mail de login</b> da conta.
            </p>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <div>
              <label style={rotulo}>Telefone / WhatsApp</label>
              <input value={tel} onChange={e => setTel(e.target.value)} placeholder="11 95976-5031" style={campo} />
            </div>
            <div>
              <label style={rotulo}>Tipo</label>
              <select value={papel} onChange={e => setPapel(e.target.value)} style={campo}>
                {APP_ROLE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:14 }}>
            <div>
              <label style={rotulo}>Cidade</label>
              <input value={cidade} onChange={e => setCidade(e.target.value)} style={campo} />
            </div>
            <div>
              <label style={rotulo}>UF</label>
              <input value={uf} onChange={e => setUf(e.target.value.toUpperCase())} maxLength={2} placeholder="SP" style={campo} />
            </div>
          </div>

          <div>
            <label style={rotulo}>Especialidades</label>
            {catalogo.length === 0 ? (
              <p style={{ fontSize:12, color:C.muted, margin:0 }}>
                Esse tipo de perfil nao tem catalogo de especialidades no app.
              </p>
            ) : (
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {catalogo.map(op => {
                  const on = specs.includes(op);
                  return (
                    <label key={op} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, cursor:'pointer', fontSize:12, border:'1px solid '+(on ? C.p1 : C.border), background:on ? 'rgba(255,107,53,.10)' : 'transparent', color:on ? C.ink : C.muted, fontWeight:on ? 600 : 400 }}>
                      <input type="checkbox" checked={on} onChange={() => alterna(op)} style={{ margin:0 }} />
                      {op}
                    </label>
                  );
                })}
              </div>
            )}
            {fora.length > 0 && (
              <div style={{ marginTop:10 }}>
                <p style={{ fontSize:11, color:C.muted, margin:'0 0 6px' }}>
                  Fora do catalogo (digitado a mao antes) — desmarque pra limpar:
                </p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {fora.map(op => (
                    <label key={op} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 10px', borderRadius:999, cursor:'pointer', fontSize:12, border:'1px dashed '+C.border, color:C.muted }}>
                      <input type="checkbox" checked onChange={() => alterna(op)} style={{ margin:0 }} />
                      {op}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {erro && <div style={{ background:'rgba(230,57,70,.08)', border:'1px solid rgba(230,57,70,.3)', color:C.danger, borderRadius:8, padding:'9px 12px', fontSize:12 }}>{erro}</div>}
        </div>

        <div style={{ padding:'14px 20px', borderTop:'1px solid '+C.border, display:'flex', justifyContent:'flex-end', gap:10, position:'sticky', bottom:0, background:C.white, borderRadius:'0 0 16px 16px' }}>
          <button onClick={onClose} disabled={salvando} style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'9px 16px', cursor:'pointer', fontSize:13 }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'9px 18px', cursor: salvando ? 'default' : 'pointer', fontWeight:700, fontSize:13, opacity: salvando ? .7 : 1 }}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Barra de selecao em massa (checkbox master + excluir selecionados).
const BulkDeleteBar = ({ list, selIds, setSelIds, after }) => {
  if (!selIds.length) return null;
  const chosen = list.filter(p => selIds.includes(p.id));
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, margin:'0 0 12px' }}>
      <span style={{ fontSize:13, color:C.muted }}>{selIds.length} selecionado(s)</span>
      <button onClick={() => deleteUsersPermanently(chosen, () => { setSelIds([]); if (after) after(); })}
        style={{ background:C.p4, color:'#fff', border:'none', borderRadius:8, padding:'6px 14px', cursor:'pointer', fontSize:12, fontWeight:700 }}>
        🗑 Excluir selecionados permanentemente
      </button>
      <button onClick={() => setSelIds([])}
        style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'6px 10px', cursor:'pointer', fontSize:12, color:C.muted }}>
        Limpar
      </button>
    </div>
  );
};

// Modal de data do PRO. Serve pra HABILITAR e tambem pra ALTERAR o periodo
// de quem ja e PRO — por isso recebe `current` (a expiracao que vale hoje) e
// os atalhos "+1 mes / +3 / +6 / +1 ano", que somam A PARTIR do que o cliente
// ainda tem (ou de hoje, se ja venceu). Resolve com Date ou null (cancelou).
function askProDate(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    const pad = n => String(n).padStart(2, '0');
    const toISO = dt => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    const now = new Date();
    const cur = opts.current ? new Date(opts.current) : null;
    const curOk = !!(cur && !isNaN(cur.getTime()));
    const vigente = curOk && cur > now;
    // Base dos atalhos: a data futura que ja existe (renovacao soma em cima
    // do que sobrou) ou hoje, se venceu / nunca teve.
    const base = vigente ? new Date(cur) : new Date(now);
    const addMonths = m => { const d = new Date(base); d.setMonth(d.getMonth() + m); return d; };
    const initial = vigente ? new Date(cur) : addMonths(12);
    const tomorrow = new Date(Date.now() + 86400000);
    const ATALHOS = [['+1 mes', 1], ['+3 meses', 3], ['+6 meses', 6], ['+1 ano', 12]];
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:inherit;';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', '_proDateTitle');
    ov.innerHTML =
      '<div style="background:#fff;border-radius:14px;padding:22px;width:360px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3);">'
      + '<div id="_proDateTitle" style="font-size:16px;font-weight:800;color:' + C.ink + ';margin-bottom:4px;">' + (opts.title || 'Habilitar PRO') + '</div>'
      + '<div style="font-size:13px;color:' + C.muted + ';margin-bottom:' + (curOk ? '6' : '14') + 'px;">' + (opts.desc || 'Escolha a data de expiracao do plano PRO.') + '</div>'
      + (curOk
          ? '<div style="font-size:12px;color:' + C.muted + ';margin-bottom:14px;">Hoje ' + (vigente ? 'expira em' : 'expirou em') + ' <b style="color:' + C.ink + ';">' + cur.toLocaleDateString('pt-BR') + '</b></div>'
          : '')
      + (opts.paid
          ? '<div style="font-size:12px;color:' + C.p4 + ';margin-bottom:12px;">Atencao: assinatura paga no Mercado Pago. A proxima renovacao automatica pode sobrescrever esta data.</div>'
          : '')
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">'
      + ATALHOS.map(a => '<button type="button" class="_proQuick" data-m="' + a[1] + '" style="background:#f4f1ec;border:1px solid ' + C.border + ';color:' + C.ink + ';border-radius:999px;padding:5px 12px;cursor:pointer;font-size:12px;font-weight:600;">' + a[0] + '</button>').join('')
      + '</div>'
      + '<input id="_proDateInput" type="date" value="' + toISO(initial) + '" min="' + toISO(tomorrow) + '" style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid ' + C.border + ';font-size:14px;outline:none;box-sizing:border-box;">'
      + '<div id="_proDateErr" style="color:' + C.p4 + ';font-size:12px;margin-top:8px;display:none;"></div>'
      + '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">'
      + '<button id="_proDateCancel" style="background:none;border:1px solid ' + C.border + ';color:' + C.ink + ';border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;">Cancelar</button>'
      + '<button id="_proDateOk" style="background:#16a34a;border:none;color:#fff;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:13px;font-weight:700;">' + (opts.confirmLabel || 'Confirmar') + '</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    const inp = ov.querySelector('#_proDateInput');
    const errEl = ov.querySelector('#_proDateErr');
    const close = val => { document.body.removeChild(ov); resolve(val); };
    setTimeout(() => inp.focus(), 30);
    // Atalhos somam sobre a base (expiracao vigente ou hoje) e so preenchem
    // o campo — quem confirma continua sendo o botao, entao da pra ajustar
    // no dedo depois de clicar em "+3 meses".
    Array.prototype.forEach.call(ov.querySelectorAll('._proQuick'), b => {
      b.onclick = () => {
        inp.value = toISO(addMonths(Number(b.getAttribute('data-m'))));
        errEl.style.display = 'none';
      };
    });
    ov.querySelector('#_proDateCancel').onclick = () => close(null);
    ov.addEventListener('click', e => { if (e.target === ov) close(null); });
    const submit = () => {
      if (!inp.value) { errEl.textContent = 'Selecione uma data.'; errEl.style.display = 'block'; return; }
      const p = inp.value.split('-');
      const exp = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 23, 59, 59);
      if (isNaN(exp.getTime()) || exp <= new Date()) { errEl.textContent = 'Informe uma data futura valida.'; errEl.style.display = 'block'; return; }
      close(exp);
    };
    ov.querySelector('#_proDateOk').onclick = submit;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') close(null); });
  });
}

// `opts` chega inteiro no modal (title/desc/current/paid/confirmLabel) — e
// como alterar periodo tambem e um set_pro com value=true, o mesmo caminho
// serve pra habilitar e pra editar.
const setProfilePro = async (id, value, after, opts) => {
  if (!value) {
    if (!confirm('Remover o acesso PRO deste cliente?')) return;
    if (await adminUsers({ action:'set_pro', userId:id, value:false }) && after) after();
    return;
  }
  const exp = await askProDate(opts);
  if (!exp) return;
  if (await adminUsers({ action:'set_pro', userId:id, value:true, expiresAt: exp.toISOString() }) && after) after();
};

const isProActive = p => !!(p && p.is_pro && (!p.pro_expires_at || new Date(p.pro_expires_at) > new Date()));

// Hook genérico de consulta ao Supabase: encapsula useState+useEffect+fetch.
// queryFn recebe o client `supa` e devolve o resultado bruto da query (ou
// uma Promise que resolve para `{ data, error }` / qualquer payload).
function useSupabaseQuery(queryFn, deps) {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const refetch = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await queryFn(supa);
      if (res && res.error) throw res.error;
      setData(res && res.data !== undefined ? res.data : res);
    } catch (e) {
      console.warn('useSupabaseQuery:', e && e.message || e);
      setError(e);
    } finally { setLoading(false); }
  }, deps || []);
  React.useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}

// Service centralizado para consultas da tabela `profiles` — evita repetir
// `supa.from('profiles').select('*')` + filtros isPro/isCliente em cada tela.
const profilesService = {
  async list(opts) {
    opts = opts || {};
    const montar = () => {
      let q = supa.from('profiles').select(opts.fields || '*');
      if (opts.portalOnly) q = q.eq('portal_access', true);
      if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false });
      return q;
    };
    // Com limite explicito, respeita o limite. Sem ele, PAGINA — senao a
    // lista para em 1000 linhas sem avisar ninguem.
    let rows;
    if (opts.limit) {
      const { data, error } = await montar().limit(opts.limit);
      if (error) throw error;
      rows = data || [];
    } else {
      rows = await buscarTudo(montar);
    }
    if (opts.painterOnly) rows = rows.filter(isProProfile);
    if (opts.clienteOnly) rows = rows.filter(isClienteProfile);
    if (opts.proOnly) rows = rows.filter(isProActive);
    return rows;
  },
  async byId(id, fields) {
    const { data, error } = await supa.from('profiles').select(fields || '*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }
};

const setProfileRole = async (id, roleKey, after) => {
  const ok = await adminUsers({ action:'set_role', userId:id, roleKey });
  if (ok && after) after();
  return ok;
};

// Deduz a opcao atual de papel a partir do profile
const currentRoleKey = p => {
  if (professionOf(p) === 'funileiro') return 'funileiro';
  // Engenheiro e o mesmo papel do arquiteto, mudando so a profissao exibida.
  if (professionOf(p) === 'engenheiro') return 'engenheiro';
  const r = roleOf(p);
  if (['pintor','grafiteiro','automotivo','arquiteto','cliente'].includes(r)) return r;
  if (r === 'engenheiro') return 'arquiteto';
  if (r === 'graffiti') return 'grafiteiro';
  return isProProfile(p) ? 'pintor' : 'cliente';
};

// Seletor inline para editar o tipo/papel de um perfil existente
const RoleSelect = ({ profile, after }) => {
  const [val, setVal] = useState(currentRoleKey(profile));
  const [busy, setBusy] = useState(false);
  return (
    <select value={val} disabled={busy} onChange={async e => {
      const nv = e.target.value;
      if (nv === val) return;
      const lbl = (APP_ROLE_OPTIONS.find(o => o.v === nv) || {}).label || nv;
      if (!confirm('Alterar o tipo deste perfil para "' + lbl + '"?')) { e.target.value = val; return; }
      setBusy(true);
      const ok = await setProfileRole(profile.id, nv, null);
      setBusy(false);
      if (ok) { setVal(nv); if (after) after(); } else { e.target.value = val; }
    }} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid '+C.border, fontSize:11, background:'#fff', cursor: busy?'wait':'pointer', maxWidth:160 }}>
      {APP_ROLE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
};

const Logo = () => (
  <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 800, color: C.white, padding: '24px 20px 8px' }}>
    <span>Cali</span><span style={{ color: C.p1 }}>Colors</span>
    <div style={{ fontSize: 10, color: C.muted, fontWeight: 400, letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 }}>Portal QueroUmaCor</div>
  </div>
);

const AvatarCell = React.memo(function AvatarCell({ name, avatarUrl, size }) {
  const s = size || 32;
  const initial = ((name || '?')[0] || '?').toUpperCase();
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" style={{width:s,height:s,borderRadius:'50%',objectFit:'cover'}} />;
  }
  return (
    <div style={{
      width:s, height:s, borderRadius:'50%', background:'#e8e2d9',
      display:'inline-flex', alignItems:'center', justifyContent:'center',
      fontSize: s*0.4, fontWeight:700, color:'#1a1a2e'
    }}>{initial}</div>
  );
});

const ProBadgeCell = React.memo(function ProBadgeCell({ profile, onChange }) {
  const pro = isProActive(profile);
  const paid = !!profile.mp_preapproval_id;
  if (!pro) {
    return (
      <button onClick={() => setProfilePro(profile.id, true, onChange)} style={{ padding:'4px 10px', background:'#f0f0f0', border:'1px solid #ddd', borderRadius:6, cursor:'pointer', fontSize:12 }}>
        Habilitar PRO
      </button>
    );
  }
  const exp = profile.pro_expires_at ? new Date(profile.pro_expires_at).toLocaleDateString('pt-BR') : '—';
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
      <span style={{ padding:'2px 8px', background:'#7c4dff', color:'#fff', borderRadius:20, fontSize:11, fontWeight:700 }}>
        {paid ? '💳 PRO' : '✋ PRO'}
      </span>
      <span style={{ fontSize:11, color:'#666' }}>até {exp}</span>
      <button
        onClick={() => setProfilePro(profile.id, true, onChange, {
          title: 'Alterar periodo PRO',
          desc: 'Escolha a nova data de expiracao do plano PRO.',
          confirmLabel: 'Salvar',
          current: profile.pro_expires_at,
          paid,
        })}
        title="Alterar período PRO"
        style={{ padding:'2px 6px', background:'transparent', border:'1px solid #ddd', borderRadius:4, cursor:'pointer', fontSize:10 }}>
        ✏️
      </button>
      {!paid && (
        <button onClick={() => setProfilePro(profile.id, false, onChange)} style={{ padding:'2px 6px', background:'transparent', border:'1px solid #ddd', borderRadius:4, cursor:'pointer', fontSize:10 }}>
          Remover
        </button>
      )}
    </span>
  );
});

const PortalAccessCell = React.memo(function PortalAccessCell({ profile, onChange }) {
  if (profile.portal_access) {
    return (
      <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
        <span style={{ padding:'2px 8px', background:'#10b981', color:'#fff', borderRadius:20, fontSize:11, fontWeight:700 }}>✓ Portal</span>
        <button onClick={() => revokePortal(profile.id, onChange)} style={{ padding:'2px 6px', background:'transparent', border:'1px solid #ddd', borderRadius:4, cursor:'pointer', fontSize:10 }}>
          Revogar
        </button>
      </span>
    );
  }
  return (
    <button onClick={() => promoteToPortal(profile.id, onChange)} style={{ padding:'4px 10px', background:'#f0f0f0', border:'1px solid #ddd', borderRadius:6, cursor:'pointer', fontSize:12 }}>
      Promover
    </button>
  );
});

const NavItem = React.memo(function NavItem({ icon, label, badge, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
      cursor: 'pointer', borderRadius: 10, margin: '2px 8px',
      background: active ? 'rgba(255,107,53,0.2)' : 'transparent',
      color: active ? C.p1 : 'rgba(255,255,255,0.7)',
      transition: 'all 0.2s'
    }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 14, flex: 1 }}>{label}</span>
      {badge > 0 && <span style={{ background: C.p4, color: '#fff', borderRadius: 10, fontSize: 11, padding: '1px 7px', fontWeight: 700 }}>{badge}</span>}
    </div>
  );
});

const KPICard = React.memo(function KPICard({ title, value, sub, trend, color }) {
  return (
    <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Syne, sans-serif', color: C.ink }}>{value}</div>
      <div style={{ fontSize: 12, color: color || C.p6, marginTop: 4 }}>{trend} {sub}</div>
    </div>
  );
});

const Dashboard = () => {
  const [stats, setStats] = useState({ pintores: 0, clientes: 0, leads: 0, orcamentos: 0 });
  const [recentQuotes, setRecentQuotes] = useState([]);
  const [weeklyQuotes, setWeeklyQuotes] = useState([0,0,0,0,0,0,0]);
  const [regionData, setRegionData] = useState([]);
  const [recentMessages, setRecentMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supa;
      const [profilesRes, leadsRes, quotesRes, msgsRes] = await Promise.all([
        sb.from('profiles').select('*'),
        sb.from('leads').select('id'),
        sb.from('quotes').select('id, status, created_at, client:profiles!client_id(name), painter:profiles!painter_id(name)').order('created_at', { ascending: false }).limit(50),
        sb.from('messages').select('id, content, created_at, sender_id').order('created_at', { ascending: false }).limit(5),
      ]);

      if(profilesRes.error) console.warn('Dashboard profiles error:', profilesRes.error.message);
      if(quotesRes.error) console.warn('Dashboard quotes error:', quotesRes.error.message);

      const profiles = profilesRes.data || [];
      const leads = leadsRes.data || [];
      const quotes = quotesRes.data || [];
      const msgs = msgsRes.data || [];

      const clientes = profiles.filter(isClienteProfile).length;

      setStats({ pintores: profiles.length, clientes, leads: leads.length, orcamentos: quotes.length });

      // Weekly quotes from last 7 weeks
      const now = new Date();
      const weekly = [0,0,0,0,0,0,0];
      quotes.forEach(q => {
        if (!q.created_at) return;
        const diff = Math.floor((now - new Date(q.created_at)) / (7 * 86400000));
        if (diff >= 0 && diff < 7) weekly[6 - diff]++;
      });
      setWeeklyQuotes(weekly);

      // Region distribution from profiles
      const regions = {};
      profiles.forEach(p => {
        const st = (p.state || '').toUpperCase();
        if (st === 'SP') regions['São Paulo'] = (regions['São Paulo'] || 0) + 1;
        else if (st === 'RJ') regions['Rio de Janeiro'] = (regions['Rio de Janeiro'] || 0) + 1;
        else if (['MG','PR','RS'].includes(st)) regions['MG/PR/RS'] = (regions['MG/PR/RS'] || 0) + 1;
        else regions['Outros'] = (regions['Outros'] || 0) + 1;
      });
      const total = profiles.length || 1;
      const colors = { 'São Paulo': C.p1, 'Rio de Janeiro': C.p3, 'MG/PR/RS': C.p7, 'Outros': C.muted };
      setRegionData(['São Paulo','Rio de Janeiro','MG/PR/RS','Outros'].map(r => ({
        name: r, pct: Math.round((regions[r] || 0) / total * 100) + '%', color: colors[r]
      })));

      setRecentQuotes(quotes.slice(0, 5));
      setRecentMessages(msgs);
      setLoading(false);
    })();
  }, []);

  const maxW = React.useMemo(() => Math.max(...weeklyQuotes, 1), [weeklyQuotes]);

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando dashboard...</div>;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <KPICard title="Perfis Cadastrados" value={stats.pintores.toLocaleString('pt-BR')} sub="no sistema" trend="" color={C.p6} />
        <KPICard title="Clientes" value={stats.clientes.toLocaleString('pt-BR')} sub="cadastrados" trend="" color={C.p3} />
        <KPICard title="Leads" value={stats.leads.toLocaleString('pt-BR')} sub="captados" trend="" color={C.p5} />
        <KPICard title="Orçamentos" value={stats.orcamentos.toLocaleString('pt-BR')} sub="solicitados" trend="" color={C.p1} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>📊 Orçamentos por Semana</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
            {weeklyQuotes.map((h,i) => (
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
                <div style={{ background: i===6 ? C.p1 : C.p2, borderRadius: 4, width: '100%', height: Math.max(8, (h / maxW) * 70) + 'px' }}></div>
                <div style={{ fontSize:10, color:C.muted }}>S{i+1}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>🗺️ Perfis por Região</div>
          {regionData.map(r => (
            <div key={r.name} style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
              <span style={{ fontSize:13 }}>{r.name}</span>
              <span style={{ fontSize:13, fontWeight:700, color:r.color }}>{r.pct}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>📋 Orçamentos Recentes</div>
        {recentQuotes.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum orçamento encontrado.</div>}
        {recentQuotes.map((q,i) => {
          const stInfo = quoteStatusInfo(q.status);
          const stStyle = quoteStatusStyle(q.status);
          const data = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) : '—';
          return (
            <div key={q.id || i} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom: i < recentQuotes.length - 1 ? '1px solid ' + C.border : 'none' }}>
              <div style={{ width:36, height:36, borderRadius:'50%', background:C.p2, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:700 }}>
                {(q.client?.name || '?')[0]}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <span style={{ fontWeight:600, fontSize:13 }}>{q.client?.name || '—'}</span>
                  <span style={{ color:C.muted, fontSize:12 }}>→</span>
                  <span style={{ fontSize:13 }}>{q.painter?.name || '—'}</span>
                  <span style={{ ...stStyle, fontSize:10, padding:'1px 8px', borderRadius:6 }}>{stInfo.label}</span>
                </div>
              </div>
              <div style={{ fontSize:11, color:C.muted }}>{data}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const PintoresList = ({ roleFilter, title, defaultRole, emptyMsg }) => {
  // Mostra TODOS os profissionais do tipo, sendo PRO ou nao.
  const { data, loading, refetch: fetchPintores } = useSupabaseQuery(() => profilesService
    .list({ painterOnly: true, order: 'created_at', ascending: false }), []);
  const pintores = roleFilter ? (data || []).filter(roleFilter) : (data || []);
  const [selIds, setSelIds] = useState([]);
  const toggleSel = (id) => setSelIds(s => s.includes(id) ? s.filter(x => x !== id) : s.concat(id));
  const allSel = pintores.length > 0 && selIds.length === pintores.length;

  const updateVerified = (id, verified) => setProfileVerified(id, verified, fetchPintores);

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando...</div>;

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>{title || 'Pintores Cadastrados'} ({pintores.length})</div>
      <CreateAppUserForm onCreated={fetchPintores} defaultRole={defaultRole || 'pintor'} />
      <BulkDeleteBar list={pintores} selIds={selIds} setSelIds={setSelIds} after={fetchPintores} />
      {pintores.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>{emptyMsg || 'Nenhum pintor cadastrado.'}</div>}
      <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:700 }}>
        {pintores.length > 0 && (
          <thead>
            <tr style={{ borderBottom:'2px solid '+C.border }}>
              <th style={{ padding:'8px 12px', width:34 }}>
                <input type="checkbox" checked={allSel} onChange={e => setSelIds(e.target.checked ? pintores.map(x => x.id) : [])} title="Selecionar todos" />
              </th>
              {['Nome','Email','Telefone','Tipo','Tag','Cidade','Estado','Especialidades','Avaliacao','Status','PRO','Portal','Acoes'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {pintores.map((p, i) => (
            <tr key={p.id} style={{ borderBottom:'1px solid '+C.border, background: selIds.includes(p.id) ? C.cream : 'transparent' }}>
              <td style={{ padding:'10px 12px' }}>
                <input type="checkbox" checked={selIds.includes(p.id)} onChange={() => toggleSel(p.id)} />
              </td>
              <td style={{ padding:'10px 12px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <AvatarCell name={p.name} avatarUrl={p.avatar_url} size={32} />
                  <NameCell profile={p} after={fetchPintores} />
                </div>
              </td>
              <td style={{ padding:'10px 12px', fontSize:12 }}><EmailCell profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px', fontSize:12 }}><PhoneCell profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px' }}><RoleSelect profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px', fontSize:12 }}><TagCell profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px' }}><CityCell profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px' }}><StateCell profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px' }}><SpecialtiesCell profile={p} after={fetchPintores} /></td>
              <td style={{ padding:'10px 12px' }}>{p.rating_avg != null ? Number(p.rating_avg).toFixed(1) : '—'}</td>
              <td style={{ padding:'10px 12px' }}>
                {p.verified ? <span style={{ background:C.p6+'22', color:C.p6, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>Aprovado</span> : <span style={{ background:C.p7+'22', color:'#b8860b', borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>Pendente</span>}
              </td>
              <td style={{ padding:'10px 12px' }}>
                <ProBadgeCell profile={p} onChange={fetchPintores} />
              </td>
              <td style={{ padding:'10px 12px' }}>
                <PortalAccessCell profile={p} onChange={fetchPintores} />
              </td>
              <td style={{ padding:'10px 12px' }}>
                <div style={{ display:'flex', gap:6 }}>
                  {!p.verified ? (
                    <>
                      <button onClick={() => updateVerified(p.id, true)} style={{ background:C.p6, color:'#fff', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, fontWeight:600 }}>Aprovar</button>
                      <button onClick={() => updateVerified(p.id, false)} style={{ background:C.p4, color:'#fff', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, fontWeight:600 }}>Rejeitar</button>
                    </>
                  ) : (
                    <button onClick={() => updateVerified(p.id, false)} style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, color:C.muted }}>Revogar</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
};

// Dicionário determinístico: cor escrita no nome → hex. Compostos primeiro.
// Movido para escopo de módulo: nunca muda e era recriado a cada render.
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
const _PLACEHOLDER_HEX = /^#?(c0622d|cccccc|ddd|dddddd|e8e2d9)$/i;
const resolveColorHex = (p) => {
  const ch = p && p.color_hex ? String(p.color_hex).trim() : '';
  if(ch && !_PLACEHOLDER_HEX.test(ch.replace('#',''))) return ch;
  const n = ' ' + String(p && p.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'') + ' ';
  for(const [k,hex] of COLOR_DICT){ if(n.includes(k)) return hex; }
  return ch || null;
};
const productBg = (p) => p && p.color_gradient ? 'linear-gradient(135deg,'+p.color_gradient+')' : (resolveColorHex(p) || '#e8e2d9');

// Classificador automático por palavra-chave no nome (marca/tipo).
// A ordem importa: o primeiro menu cuja palavra-chave casar vence.
const MENUS = [
  { key:'arte_urbana',  label:'🎨 Arte Urbana & Spray',     kw:['arte urbana','colorgin','spray','aerossol','aerosol','grafit','graffit'] },
  { key:'tintas',       label:'🪣 Tintas',                   kw:['tinta','esmalte','latex','látex','acrilic','acrílic','verniz','primer','seladora','fundo preparador','base coat','automotiva','suvinil','coral','sherwin'] },
  { key:'texturas',     label:'🧱 Texturas & Massas',        kw:['textura','grafiato','massa corrida','massa acrilic','massa pva','reboco','chapisco'] },
  { key:'epoxi',        label:'⚗️ Epóxi & Poliuretano',      kw:['epoxi','epóxi','poliuretano',' pu '] },
  { key:'solventes',    label:'💧 Solventes & Aditivos',     kw:['thinner','solvente','diluente','aguarras','aguarrás','acelerador','secante','catalisador','endurecedor','aditivo','redutor','removedor'] },
  { key:'adesivos',     label:'🧪 Adesivos & Colas',         kw:['adesivo','cola','silicone','vedante','veda calha','rejunte','massa epox','durepoxi'] },
  { key:'ferramentas',  label:'🧰 Ferramentas',              kw:['alicate','tesoura','chave','martelo','abre trinca','espatula','espátula','desempenadeira','colher de pedreiro','trena','serra','furadeira','broca','lixadeira','estilete','formao','formão','grosa','lima','torques'] },
  { key:'pintura',      label:'🖌️ Acessórios de Pintura',    kw:['rolo','pincel','trincha','bandeja','fita crepe','fita','lixa','cabo extensor','extensor','gaiola','luva','mascara','máscara','respirador','oculos','óculos','lona','plastico','plástico','crepe'] },
  { key:'eletrica',     label:'🔌 Elétrica',                 kw:['tomada','adaptador','extens','lampada','lâmpada','disjuntor','filtro de linha','benjamim','fio ','interruptor'] },
  { key:'equipamentos', label:'🛠️ Equipamentos',             kw:['aerografo','aerógrafo','compressor','pistola','maquina','máquina','pulverizador','airless'] },
];
const classify = (p) => {
  const n = (' ' + (p.name||'') + ' ').toLowerCase();
  for(const m of MENUS){ if(m.kw.some(k => n.includes(k))) return m.key; }
  return 'outros';
};
const MENU_LABEL = Object.fromEntries(MENUS.map(m => [m.key, m.label]).concat([['outros','📦 Outros']]));

// ============================================================
// Produtos — o catalogo da loja passa de 21 mil linhas. Tudo o que vem
// abaixo existe por causa desse numero.
// ============================================================

// So as colunas que o CARD usa. `description` e a ficha tecnica (linha,
// rendimento, demaos, secagem) ficam de fora: em 21 mil linhas elas sao a
// maior parte do payload e so interessam ao formulario — que agora busca a
// linha inteira na hora de editar.
const PRODUTO_COLS = 'id,name,code,category,volume,price,stock,badge,active,image_url,color_hex,color_gradient';
const PRODUTOS_PAGE = 1000;    // teto do PostgREST (max-rows do Supabase)
const PRODUTOS_PARALELO = 4;   // paginas buscadas ao mesmo tempo
const PRODUTOS_JANELA = 60;    // cards montados por vez na tela

// Categoria e chave de busca calculadas UMA vez, quando a linha chega.
// Antes `classify` rodava sobre a lista inteira a cada reagrupamento e o
// `toLowerCase` do filtro rodava 21 mil vezes a cada tecla digitada.
const prepararProduto = (p) => Object.assign({}, p, {
  _cat: classify(p),
  _q: ((p.name || '') + ' ' + (p.code || '')).toLowerCase()
});
const ordenarProdutos = (lista) => lista.slice().sort(
  (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
);

// Cache em memoria (vive enquanto a aba estiver aberta): sair da tela e
// voltar deixou de refazer as 22 requisicoes. O botao "Atualizar" forca.
let _produtosCache = null;

// Card isolado e memoizado: com a janela crescendo de 60 em 60, sem isso
// todo card ja montado re-renderizava a cada passo do scroll.
// Altura da area da foto/cor. Foto entra INTEIRA (`contain`): a caixa era
// de 60px com `cover` e cortava o produto pelo meio — quem cadastra precisa
// reconhecer a peca no card. Sem foto, a mesma caixa vira o bloco de cor.
const PRODUTO_MIDIA_H = 96;

const ProdutoCard = React.memo(function ProdutoCard({ p, onEdit, onDelete }) {
  return (
    <div style={{ background:C.white, borderRadius:12, padding:16, boxShadow:'0 2px 8px rgba(0,0,0,0.05)', opacity:p.active===false?0.5:1, position:'relative' }}>
      {p.badge && <div style={{ position:'absolute', top:8, left:8, background:p.badge==='NOVO'?C.p1:'#e63946', color:'#fff', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, zIndex:1 }}>{p.badge}</div>}
      {p.image_url ? (
        <div style={{ width:'100%', height:PRODUTO_MIDIA_H, borderRadius:8, background:C.cream, marginBottom:12, overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <img src={p.image_url} alt="" loading="lazy" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
        </div>
      ) : (
        <div style={{ width:'100%', height:PRODUTO_MIDIA_H, borderRadius:8, background:productBg(p), marginBottom:12 }}></div>
      )}
      <div style={{ fontWeight:600, fontSize:14 }}>{p.name}</div>
      <div style={{ fontSize:11, color:C.muted }}>{p.code}{p.code && p.volume ? ' · ' : ''}{p.volume}</div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
        <div style={{ fontWeight:700, color:C.p1 }}>R$ {Number(p.price||0).toFixed(2).replace('.',',')}</div>
        <div style={{ fontSize:11, color:p.stock<=5?'#e63946':'#2e7d32' }}>{p.stock} unid</div>
      </div>
      <div style={{ display:'flex', gap:6, marginTop:10 }}>
        <button onClick={()=>onEdit(p)} style={{ flex:1, background:C.cream, border:'none', borderRadius:8, padding:'6px', fontSize:12, cursor:'pointer', fontWeight:600, color:C.ink }}>Editar</button>
        <button aria-label="Excluir produto" onClick={()=>onDelete(p.id)} style={{ background:'none', border:'1px solid #e6394644', borderRadius:8, padding:'6px 10px', fontSize:12, cursor:'pointer', color:'#e63946' }}>×</button>
      </div>
    </div>
  );
});

const ProdutosList = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [menuFilter, setMenuFilter] = useState('all');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');
  const [limite, setLimite] = useState(PRODUTOS_JANELA);
  const [totalBanco, setTotalBanco] = useState(0);
  const [carregandoResto, setCarregandoResto] = useState(false);
  const [erroCarga, setErroCarga] = useState('');
  // Qual produto a gaveta esta editando AGORA — a ficha completa chega por
  // uma consulta separada e pode voltar depois de o operador ja ter trocado.
  const editandoRef = React.useRef(null);
  const [form, setForm] = useState({ name:'', code:'', category:'tintas', volume:'18L', price:'', color_hex:'#c0622d', color_gradient:'', image_url:'', stock:0, badge:'', description:'', line:'Linha Premium', rendimento:'~10m²/L', demaos:'2', secagem:'2h', active:true });

  // Carregamento em duas fases. A PRIMEIRA pagina pinta a tela e tira o
  // "Carregando produtos..." — antes a tela ficava em branco ate a ultima
  // das 22 requisicoes voltar, porque elas eram uma DEPOIS da outra.
  // O resto vem em paralelo, no fundo, e vai sendo emendado na lista.
  const loadProducts = React.useCallback(async (opts) => {
    const force = !!(opts && opts.force);
    if(!force && _produtosCache){
      setProducts(_produtosCache);
      setTotalBanco(_produtosCache.length);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErroCarga('');
    try {
      const primeira = await supa.from('products')
        .select(PRODUTO_COLS, { count: 'exact' })
        .order('name').range(0, PRODUTOS_PAGE - 1);
      if(primeira.error) throw primeira.error;
      const paginas = [(primeira.data || []).map(prepararProduto)];
      setProducts(paginas[0]);
      setLoading(false);
      const total = typeof primeira.count === 'number' ? primeira.count : paginas[0].length;
      setTotalBanco(total);

      const faltando = [];
      for(let n = 1; n * PRODUTOS_PAGE < total; n++) faltando.push(n);
      if(!faltando.length){ _produtosCache = paginas[0]; return; }

      setCarregandoResto(true);
      let cursor = 0;
      // `paginas[n]` guarda cada lote na SUA posicao: as respostas chegam
      // fora de ordem (sao paralelas) e o flat() devolve a ordem por nome.
      const worker = async () => {
        while(cursor < faltando.length){
          const n = faltando[cursor++];
          const de = n * PRODUTOS_PAGE;
          const r = await supa.from('products').select(PRODUTO_COLS)
            .order('name').range(de, de + PRODUTOS_PAGE - 1);
          if(r.error) throw r.error;
          paginas[n] = (r.data || []).map(prepararProduto);
          const parcial = [];
          for(const lote of paginas) if(lote) parcial.push.apply(parcial, lote);
          setProducts(parcial);
        }
      };
      const trabalhadores = [];
      for(let i = 0; i < Math.min(PRODUTOS_PARALELO, faltando.length); i++) trabalhadores.push(worker());
      await Promise.all(trabalhadores);
      const completo = [];
      for(const lote of paginas) if(lote) completo.push.apply(completo, lote);
      _produtosCache = completo;
      setProducts(completo);
    } catch(e) {
      console.error('loadProducts error:', e);
      setErroCarga(e && e.message ? e.message : String(e));
    }
    setCarregandoResto(false);
    setLoading(false);
  }, []);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Busca com atraso: sem isso cada tecla refiltrava as 21 mil linhas e
  // remontava a grade inteira.
  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const saveProduct = async () => {
    try {
      const productData = { ...form, price: parseFloat(String(form.price).replace(',','.')) || 0, stock: parseInt(form.stock) || 0 };
      if(!productData.image_url) delete productData.image_url; // só envia se houver foto (coluna pode não existir ainda)
      if(!productData.name) { alert('Nome obrigatorio'); return; }
      // productsService.upsert cobre insert + update (quando id presente).
      if(editing) productData.id = editing;
      const salvos = await productsService.upsert(productData);
      const linha = salvos && salvos[0];
      // Uma linha mudou — nao ha por que buscar as outras 21 mil de novo.
      if(linha) aplicarLinha(linha); else loadProducts({ force: true });
      setShowForm(false); setEditing(null); editandoRef.current = null;
      setForm({ name:'', code:'', category:'tintas', volume:'18L', price:'', color_hex:'#c0622d', color_gradient:'', image_url:'', stock:0, badge:'', description:'', line:'Linha Premium', rendimento:'~10m²/L', demaos:'2', secagem:'2h', active:true });
    } catch(e) { alert('Erro: ' + (e.message || e)); }
  };

  // Emenda (ou insere) uma linha na lista ja carregada, mantendo a ordem
  // por nome, e atualiza o cache junto.
  const aplicarLinha = React.useCallback((row) => {
    const p = prepararProduto(row);
    setProducts(lista => {
      const existe = lista.some(x => x.id === p.id);
      const nova = existe
        ? lista.map(x => x.id === p.id ? Object.assign({}, x, p) : x)
        : ordenarProdutos(lista.concat(p));
      _produtosCache = nova;
      return nova;
    });
  }, []);

  const deleteProduct = React.useCallback(async (id) => {
    if(!confirm('Excluir este produto?')) return;
    try {
      await productsService.remove(id);
      setProducts(lista => { const nova = lista.filter(p => p.id !== id); _produtosCache = nova; return nova; });
    } catch(e) { alert('Erro: ' + (e.message || e)); }
  }, []);

  const preencherForm = (p) => setForm({ name:p.name||'', code:p.code||'', category:p.category||'tintas', volume:p.volume||'18L', price:p.price||'', color_hex:p.color_hex||'#c0622d', color_gradient:p.color_gradient||'', image_url:p.image_url||'', stock:p.stock||0, badge:p.badge||'', description:p.description||'', line:p.line||'', rendimento:p.rendimento||'', demaos:p.demaos||'', secagem:p.secagem||'', active:p.active!==false });

  // A lista carrega so as colunas do card; os campos longos (descricao,
  // ficha tecnica) vem agora, numa consulta de UMA linha.
  const editProduct = React.useCallback((p) => {
    editandoRef.current = p.id;
    preencherForm(p);
    setEditing(p.id);
    setShowForm(true);
    supa.from('products').select('*').eq('id', p.id).maybeSingle().then(({ data }) => {
      // Trocou de produto (ou fechou a gaveta) antes da resposta: descarta.
      if(data && editandoRef.current === p.id) preencherForm(data);
    });
  }, []);

  // Agrupamento por categoria — a categoria ja veio calculada em
  // `prepararProduto`, entao aqui e so distribuir nos baldes.
  const grouped = React.useMemo(() => {
    const g = {};
    products.forEach(p => { const k = p._cat || classify(p); if(!g[k]) g[k] = []; g[k].push(p); });
    return g;
  }, [products]);
  const orderedKeys = React.useMemo(
    () => MENUS.map(m=>m.key).concat(['outros']).filter(k => grouped[k] && grouped[k].length),
    [grouped]
  );
  const totalItens = products.length;
  const qLower = React.useMemo(() => buscaDeb.trim().toLowerCase(), [buscaDeb]);

  // Categorias visiveis depois do chip + da busca.
  const listaFiltrada = React.useMemo(() => {
    const out = [];
    orderedKeys.forEach(cat => {
      if(menuFilter !== 'all' && menuFilter !== cat) return;
      const items = qLower ? grouped[cat].filter(p => (p._q || '').includes(qLower)) : grouped[cat];
      if(items.length) out.push({ cat, items });
    });
    return out;
  }, [orderedKeys, grouped, menuFilter, qLower]);
  const totalFiltrado = React.useMemo(
    () => listaFiltrada.reduce((s, g) => s + g.items.length, 0),
    [listaFiltrada]
  );

  // JANELA: so os primeiros `limite` cards existem no DOM. Era aqui que a
  // tela travava — em "Todos" o React montava 21 mil cards de uma vez.
  const blocos = React.useMemo(() => {
    let resta = limite;
    const out = [];
    for(const g of listaFiltrada){
      if(resta <= 0) break;
      out.push({ cat: g.cat, total: g.items.length, items: g.items.slice(0, resta) });
      resta -= g.items.length;
    }
    return out;
  }, [listaFiltrada, limite]);
  const mostrando = React.useMemo(() => blocos.reduce((s, b) => s + b.items.length, 0), [blocos]);

  // Trocou de chip ou de busca: a janela volta pro comeco.
  useEffect(() => { setLimite(PRODUTOS_JANELA); }, [menuFilter, qLower]);

  // Sentinela no fim da lista: chegou perto, cresce a janela.
  const sentinelaRef = React.useRef(null);
  useEffect(() => {
    const el = sentinelaRef.current;
    if(!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entradas => {
      if(entradas.some(e => e.isIntersecting)) setLimite(l => l + PRODUTOS_JANELA);
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mostrando, totalFiltrado]);

  const inputStyle = { width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid '+C.border, fontSize:13, outline:'none' };
  const labelStyle = { fontSize:12, color:C.muted, marginBottom:4, display:'block' };

  const closeForm = () => { setShowForm(false); setEditing(null); editandoRef.current = null; };

  // Esc fecha a gaveta — o formulário é modal-ish (fica por cima da lista),
  // então a saída pelo teclado tem que existir.
  useEffect(() => {
    if(!showForm) return;
    const onKey = e => { if(e.key === 'Escape') closeForm(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showForm]);

  // Largura da gaveta. A lista ganha esse respiro à direita enquanto ela
  // está aberta, pra nenhum card de produto ficar escondido embaixo.
  const DRAWER_W = 460;

  return (
    // `paddingRight` empurra a lista enquanto a gaveta está aberta: sem isso
    // a última coluna de produtos fica atrás dela.
    <div style={{ paddingRight: showForm ? DRAWER_W + 24 : 0, transition:'padding-right .2s ease' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div style={{ fontWeight:700, color:C.ink, fontSize:18 }}>
          🎨 Produtos / Tintas
          {carregandoResto && totalBanco > 0 && (
            <span style={{ marginLeft:10, fontSize:12, fontWeight:600, color:C.muted }}>
              carregando {totalItens.toLocaleString('pt-BR')} de {totalBanco.toLocaleString('pt-BR')}…
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button onClick={()=>loadProducts({ force:true })} disabled={loading || carregandoResto} title="Recarregar do banco" style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'8px 14px', fontSize:13, fontWeight:600, cursor: (loading||carregandoResto) ? 'default' : 'pointer', color:C.muted }}>↻ Atualizar</button>
          <button onClick={()=>{ setEditing(null); editandoRef.current = null; setForm({ name:'', code:'', category:'tintas', volume:'18L', price:'', color_hex:'#c0622d', color_gradient:'', image_url:'', stock:0, badge:'', description:'', line:'Linha Premium', rendimento:'~10m²/L', demaos:'2', secagem:'2h', active:true }); setShowForm(true); }} style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'8px 20px', fontSize:13, fontWeight:700, cursor:'pointer' }}>+ Novo Produto</button>
        </div>
      </div>

      {showForm && (
        <div style={{ position:'fixed', top:0, right:0, bottom:0, width:DRAWER_W, maxWidth:'100%', background:C.white, boxShadow:'-10px 0 34px rgba(0,0,0,.16)', borderLeft:'3px solid '+C.p1, zIndex:900, display:'flex', flexDirection:'column', animation:'drawerIn .22s cubic-bezier(.32,.72,0,1)' }}>
          {/* Cabeçalho fixo: o título e o X não somem quando o formulário
              rola. Antes o formulário era um card no TOPO da página — ao
              descer pra procurar a cor na lista, ele sumia de vista. */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'16px 20px', borderBottom:'1px solid '+C.border, flexShrink:0 }}>
            <div style={{ fontWeight:700, fontSize:15 }}>{editing ? 'Editar Produto' : 'Novo Produto'}</div>
            <button onClick={closeForm} aria-label="Fechar" title="Fechar (Esc)" style={{ width:36, height:36, borderRadius:'50%', border:'none', background:'rgba(0,0,0,.06)', color:C.ink, fontSize:20, lineHeight:1, cursor:'pointer' }}>×</button>
          </div>
          {/* Corpo rolável — só os campos rolam. */}
          <div style={{ flex:1, overflowY:'auto', padding:20 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div><label style={labelStyle}>Nome *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={inputStyle} placeholder="Terracota Premium" /></div>
            <div><label style={labelStyle}>Código</label><input value={form.code} onChange={e=>setForm({...form,code:e.target.value})} style={inputStyle} placeholder="CC-TT-001" /></div>
            <div><label style={labelStyle}>Categoria</label><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})} style={inputStyle}><option value="tintas">Tintas</option><option value="texturas">Texturas</option><option value="epoxi">Epóxi</option><option value="acessorios">Acessórios</option></select></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div><label style={labelStyle}>Volume</label><input value={form.volume} onChange={e=>setForm({...form,volume:e.target.value})} style={inputStyle} placeholder="18L" /></div>
            <div><label style={labelStyle}>Preço (R$)</label><input value={form.price} onChange={e=>setForm({...form,price:e.target.value})} style={inputStyle} placeholder="289.00" /></div>
            <div><label style={labelStyle}>Estoque</label><input type="number" value={form.stock} onChange={e=>setForm({...form,stock:e.target.value})} style={inputStyle} /></div>
            <div><label style={labelStyle}>Badge</label><input value={form.badge} onChange={e=>setForm({...form,badge:e.target.value})} style={inputStyle} placeholder="-10%, NOVO" /></div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div><label style={labelStyle}>Cor (hex)</label><div style={{ display:'flex', gap:6 }}><input type="color" value={form.color_hex} onChange={e=>setForm({...form,color_hex:e.target.value})} style={{ width:40, height:34, border:'none', cursor:'pointer' }} /><input value={form.color_hex} onChange={e=>setForm({...form,color_hex:e.target.value})} style={{...inputStyle, flex:1}} /></div></div>
            <div><label style={labelStyle}>Gradiente (opcional)</label><input value={form.color_gradient} onChange={e=>setForm({...form,color_gradient:e.target.value})} style={inputStyle} placeholder="#c4956a,#d4a870" /></div>
            <div><label style={labelStyle}>Linha</label><input value={form.line} onChange={e=>setForm({...form,line:e.target.value})} style={inputStyle} placeholder="Linha Premium" /></div>
          </div>
          <div style={{ marginBottom:12 }}>
            <label style={labelStyle}>Foto do produto (opcional — sobrepõe a cor)</label>
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              {form.image_url && <div style={{ width:48, height:48, borderRadius:8, background:C.cream+' center/contain no-repeat url('+form.image_url+')', border:'1px solid '+C.border, flexShrink:0 }}></div>}
              <input type="file" accept="image/*" disabled={fotoBusy} onChange={async e=>{
                const f = e.target.files && e.target.files[0];
                e.target.value = '';
                if(!f) return;
                if(!f.type.startsWith('image/')){ alert('Selecione um arquivo de imagem.'); return; }
                if(f.size > 5 * 1024 * 1024){ alert('Imagem grande demais (max 5MB).'); return; }
                setFotoBusy(true);
                try {
                  const { data: { user } } = await supa.auth.getUser();
                  if(!user) throw new Error('Sessao expirada — entre de novo.');
                  // O bucket `posts` exige que o path COMECE no id de quem
                  // sobe (Wave 27, path validation). O caminho antigo era
                  // 'products/...' — a RLS recusava. Isso nunca apareceu
                  // porque o `setAiBusy` inexistente estourava antes.
                  const nome = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
                  const path = user.id + '/products/' + Date.now() + '-' + nome;
                  const { error } = await supa.storage.from('posts')
                    .upload(path, f, { upsert:true, contentType: f.type });
                  if(error) throw error;
                  const { data } = supa.storage.from('posts').getPublicUrl(path);
                  setForm(fm => ({ ...fm, image_url: (data && data.publicUrl) || '' }));
                } catch(err){ alert('Erro ao enviar foto: ' + (err.message||err)); }
                setFotoBusy(false);
              }} style={{ fontSize:12, flex:1 }} />
              {fotoBusy ? <span style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap' }}>Enviando…</span> : null}
              {form.image_url && <button type="button" onClick={()=>setForm({...form,image_url:''})} style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'6px 12px', fontSize:12, cursor:'pointer', color:C.muted }}>Remover</button>}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div><label style={labelStyle}>Rendimento</label><input value={form.rendimento} onChange={e=>setForm({...form,rendimento:e.target.value})} style={inputStyle} placeholder="~10m²/L" /></div>
            <div><label style={labelStyle}>Demãos</label><input value={form.demaos} onChange={e=>setForm({...form,demaos:e.target.value})} style={inputStyle} placeholder="2" /></div>
            <div><label style={labelStyle}>Secagem</label><input value={form.secagem} onChange={e=>setForm({...form,secagem:e.target.value})} style={inputStyle} placeholder="2h" /></div>
          </div>
          <div style={{ marginBottom:12 }}><label style={labelStyle}>Descrição</label><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} style={{...inputStyle, minHeight:60}} placeholder="Tinta premium com acabamento fosco..." /></div>
          </div>
          {/* Rodapé fixo: Salvar sempre ao alcance, sem rolar até o fim. */}
          <div style={{ display:'flex', gap:10, alignItems:'center', padding:'14px 20px', borderTop:'1px solid '+C.border, background:C.white, flexShrink:0 }}>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})} /> Ativo</label>
            <div style={{ flex:1 }}></div>
            <button onClick={closeForm} style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'8px 18px', fontSize:13, cursor:'pointer', color:C.muted }}>Cancelar</button>
            <button onClick={saveProduct} style={{ background:C.p1, color:'#fff', border:'none', borderRadius:8, padding:'8px 24px', fontSize:13, fontWeight:700, cursor:'pointer' }}>{editing ? 'Salvar' : 'Criar Produto'}</button>
          </div>
        </div>
      )}

      {!loading && products.length > 0 && (
        <div style={{ marginBottom:18 }}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔎 Buscar produto..." style={{...inputStyle, marginBottom:12}} />
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            <button onClick={()=>setMenuFilter('all')} style={{ border:'1px solid '+(menuFilter==='all'?C.p1:C.border), background:menuFilter==='all'?C.p1:'transparent', color:menuFilter==='all'?'#fff':C.ink, borderRadius:20, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>Todos <b>({totalItens})</b></button>
            {orderedKeys.map(k => (
              <button key={k} onClick={()=>setMenuFilter(k)} style={{ border:'1px solid '+(menuFilter===k?C.p1:C.border), background:menuFilter===k?C.p1:'transparent', color:menuFilter===k?'#fff':C.ink, borderRadius:20, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer' }}>{MENU_LABEL[k]} <b>({grouped[k].length})</b></button>
            ))}
          </div>
        </div>
      )}

      {erroCarga && (
        <div style={{ background:'#fdecea', border:'1px solid #f5c2c0', color:'#a4231f', borderRadius:10, padding:'10px 14px', fontSize:13, marginBottom:14 }}>
          Erro ao carregar produtos: {erroCarga}
        </div>
      )}

      {loading ? <div style={{ textAlign:'center', padding:40, color:C.muted }}>Carregando produtos...</div> :
       products.length === 0 ? <div style={{ textAlign:'center', padding:40, color:C.muted }}>Nenhum produto cadastrado. Clique em "+ Novo Produto" para começar.</div> :
       totalFiltrado === 0 ? <div style={{ textAlign:'center', padding:40, color:C.muted }}>Nenhum produto encontrado para essa busca.</div> :
       blocos.map(bloco => (
        <div key={bloco.cat} style={{ marginBottom:24 }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.muted, marginBottom:10, textTransform:'uppercase', letterSpacing:.5 }}>{MENU_LABEL[bloco.cat] || bloco.cat} <span style={{ color:C.p1 }}>({bloco.total})</span></div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
            {bloco.items.map(p => (
              <ProdutoCard key={p.id} p={p} onEdit={editProduct} onDelete={deleteProduct} />
            ))}
          </div>
        </div>
      ))}

      {!loading && mostrando < totalFiltrado && (
        <div ref={sentinelaRef} style={{ textAlign:'center', padding:24, color:C.muted, fontSize:13 }}>
          Mostrando {mostrando.toLocaleString('pt-BR')} de {totalFiltrado.toLocaleString('pt-BR')} — role para ver mais…
        </div>
      )}
    </div>
  );
};

// ══ CAMISETAS PERSONALIZADAS ══
// Duas partes: o configurador (cor/tamanho/logo) e a galeria de logos que os
// pintores geraram/enviaram DENTRO DO APP (tabela `brand_logos`, Wave 37).
// A galeria é o motivo da tela existir: sem ela a loja recebia um pedido de
// camiseta sem saber qual arte estampar nem de quem era.

const LOGO_SOURCE_LABELS = { ai: '🤖 Gerado com IA', upload: '📤 Enviado pelo pintor' };
const LOGO_SOURCE_COLORS = { ai: '#8338ec', upload: '#2ec4b6' };

// Busca em 2 passos (mesma razão de PedidosLoja): o embed PostgREST quebra a
// query inteira se a FK não estiver do jeito que ele espera, e aí a tela
// aparece vazia sem dizer por quê. RLS (brand_logos_select_admin =
// is_portal_admin) é quem libera ver o de todo mundo.
const useBrandLogos = () => useSupabaseQuery(async (sb) => {
  const { data: rows, error } = await sb
    .from('brand_logos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) return { error };
  const list = rows || [];
  const userIds = [...new Set(list.map(l => l.user_id).filter(Boolean))];
  const pmap = {};
  if (userIds.length) {
    const { data: profs } = await sb
      .from('profiles')
      .select('id, name, tag, phone, city, state, role, avatar_url, business_name, business_logo_url')
      .in('id', userIds);
    (profs || []).forEach(pr => { pmap[pr.id] = pr; });
  }
  return { data: list.map(l => ({ ...l, painter: pmap[l.user_id] || null })) };
}, []);

const LogoCard = React.memo(function LogoCard({ item, onUse }) {
  const p = item.painter || {};
  const isCurrent = !!p.business_logo_url && p.business_logo_url === item.image_url;
  const when = item.created_at ? new Date(item.created_at).toLocaleDateString('pt-BR') : '—';
  const wa = (p.phone || '').replace(/\D/g, '');
  return (
    <div style={{ background:C.white, border:'1px solid '+C.border, borderRadius:12, overflow:'hidden', display:'flex', flexDirection:'column' }}>
      <div style={{ position:'relative', background:C.cream, height:150, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <img src={item.image_url} alt={item.prompt_name || 'Logo'} loading="lazy" style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
        <span style={{ position:'absolute', top:6, left:6, padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700, color:'#fff', background: LOGO_SOURCE_COLORS[item.source] || C.muted }}>
          {LOGO_SOURCE_LABELS[item.source] || item.source}
        </span>
        {isCurrent && (
          <span style={{ position:'absolute', top:6, right:6, padding:'2px 8px', borderRadius:20, fontSize:10, fontWeight:700, color:'#fff', background:C.p1 }}>★ logo atual</span>
        )}
      </div>
      <div style={{ padding:10, display:'flex', flexDirection:'column', gap:6, flex:1 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <AvatarCell name={p.name} avatarUrl={p.avatar_url} size={28} />
          <div style={{ minWidth:0 }}>
            <div style={{ fontWeight:700, fontSize:13, color:C.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {p.name || 'Pintor sem nome'}
            </div>
            <div style={{ fontSize:11, color:C.muted }}>
              {p.tag ? '@' + p.tag : '—'}{p.role ? ' · ' + p.role : ''}
            </div>
          </div>
        </div>
        {p.business_name && <div style={{ fontSize:11, color:C.ink }}>🏷️ {p.business_name}</div>}
        <div style={{ fontSize:11, color:C.muted }}>
          {(p.city || '—')}{p.state ? '/' + p.state : ''} · {p.phone || 'sem telefone'}
        </div>
        {item.prompt_name && (
          <div style={{ fontSize:11, color:C.ink, background:C.cream, borderRadius:8, padding:'6px 8px' }}>
            <b>{item.prompt_name}</b>{item.prompt_style ? ' · ' + item.prompt_style : ''}
          </div>
        )}
        <div style={{ fontSize:10, color:C.muted }}>Gerado em {when}</div>
        <div style={{ display:'flex', gap:6, marginTop:'auto' }}>
          <button onClick={() => onUse(item)} style={{ flex:1, background:C.p1, color:'#fff', border:'none', borderRadius:8, padding:'6px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            Usar na camiseta
          </button>
          <a href={item.image_url} target="_blank" rel="noopener noreferrer" style={{ background:C.cream, color:C.ink, borderRadius:8, padding:'6px 10px', fontSize:12, fontWeight:600, textDecoration:'none' }}>
            Abrir
          </a>
          {wa && (
            <a href={'https://wa.me/' + wa} target="_blank" rel="noopener noreferrer" title="Falar com o pintor" style={{ background:'#25d366', color:'#fff', borderRadius:8, padding:'6px 10px', fontSize:12, fontWeight:600, textDecoration:'none' }}>
              💬
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

const Camisetas = () => {
  const [cor, setCor] = useState('#1a1a2e');
  const [tam, setTam] = useState('M');
  const [logo, setLogo] = useState(true);
  // Logo escolhido na galeria — entra no mockup e no texto do pedido.
  const [logoSel, setLogoSel] = useState(null);
  const [busca, setBusca] = useState('');
  const [fonte, setFonte] = useState('todos');
  const { data, loading, error, refetch } = useBrandLogos();
  const logos = data || [];

  const filtrados = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return logos.filter(l => {
      if (fonte !== 'todos' && l.source !== fonte) return false;
      if (!q) return true;
      const p = l.painter || {};
      return [p.name, p.tag, p.business_name, p.city, l.prompt_name, l.prompt_style]
        .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
    });
  }, [logos, busca, fonte]);

  const painterName = logoSel && logoSel.painter
    ? (logoSel.painter.business_name || logoSel.painter.name || '')
    : '';

  const gerarPedido = () => {
    if (!logoSel) {
      alert('Escolha primeiro o logo de um pintor na galeria abaixo.');
      return;
    }
    const p = logoSel.painter || {};
    alert(
      'Pedido de camiseta\n\n' +
      'Pintor: ' + (p.name || '—') + (p.tag ? ' (@' + p.tag + ')' : '') + '\n' +
      'Contato: ' + (p.phone || '—') + '\n' +
      'Cor: ' + cor + ' · Tamanho: ' + tam + '\n' +
      'Logo Cali Colors: ' + (logo ? 'sim' : 'nao') + '\n' +
      'Arte: ' + logoSel.image_url
    );
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight:700, marginBottom:16, color:C.ink }}>👕 Configurador de Camisetas</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:24 }}>
          <div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:8 }}>Cor da Camiseta</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {['#1a1a2e','#ff6b35','#2ec4b6','#e63946','#ffffff','#4a4a4a'].map(c => (
                <div key={c} onClick={() => setCor(c)} style={{ width:32, height:32, borderRadius:'50%', background:c, border: cor===c ? '3px solid '+C.p1 : '2px solid '+C.border, cursor:'pointer' }}></div>
              ))}
            </div>
            <div style={{ fontSize:13, color:C.muted, marginTop:16, marginBottom:8 }}>Tamanho</div>
            <div style={{ display:'flex', gap:8 }}>
              {['P','M','G','GG'].map(t => (
                <button key={t} onClick={() => setTam(t)} style={{ padding:'6px 16px', borderRadius:8, border:'2px solid '+(tam===t?C.p1:C.border), background:tam===t?C.p1:'transparent', color:tam===t?'#fff':C.ink, cursor:'pointer', fontWeight:600 }}>{t}</button>
              ))}
            </div>
            <div style={{ fontSize:13, color:C.muted, marginTop:16, marginBottom:8 }}>Logo</div>
            <div style={{ display:'flex', gap:12 }}>
              <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                <input type="checkbox" checked={logo} onChange={e => setLogo(e.target.checked)} />
                <span style={{ fontSize:13 }}>Cali Colors + Nome Pintor</span>
              </label>
            </div>
            <div style={{ fontSize:13, color:C.muted, marginTop:16, marginBottom:8 }}>Arte do pintor</div>
            {logoSel ? (
              <div style={{ display:'flex', alignItems:'center', gap:10, background:C.cream, borderRadius:10, padding:8 }}>
                <img src={logoSel.image_url} alt="" style={{ width:40, height:40, objectFit:'contain' }} />
                <div style={{ fontSize:12, color:C.ink, flex:1 }}>
                  <div style={{ fontWeight:700 }}>{painterName || 'Pintor'}</div>
                  <div style={{ color:C.muted }}>{logoSel.prompt_name || (LOGO_SOURCE_LABELS[logoSel.source] || '')}</div>
                </div>
                <button onClick={() => setLogoSel(null)} aria-label="Tirar logo" style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'4px 8px', cursor:'pointer', color:C.ink }}>×</button>
              </div>
            ) : (
              <div style={{ fontSize:12, color:C.muted }}>Escolha um logo na galeria abaixo.</div>
            )}
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
            {/* Mockup IGUAL ao do app (ShirtCustomizer): foto /img/shirt-white.webp
                + overlay multiply mascarado pela própria foto pra tingir a cor +
                logo do pintor no peito esquerdo (30%/22%/14%) e Cali Colors no
                direito. Antes era um retângulo colorido que não parecia camiseta. */}
            <div style={{ position:'relative', width:240, height:240 }}>
              <img src="/img/shirt-white.webp" alt="Camiseta" style={{ position:'absolute', left:0, top:0, width:'100%', height:'100%', objectFit:'contain', filter:'drop-shadow(0 6px 12px rgba(0,0,0,0.08))' }} />
              {cor !== '#ffffff' && (
                <div style={{ position:'absolute', left:0, top:0, width:'100%', height:'100%', background:cor, mixBlendMode:'multiply', WebkitMaskImage:'url(/img/shirt-white.webp)', WebkitMaskRepeat:'no-repeat', WebkitMaskPosition:'center', WebkitMaskSize:'contain', maskImage:'url(/img/shirt-white.webp)', maskRepeat:'no-repeat', maskPosition:'center', maskSize:'contain', opacity:0.85 }}></div>
              )}
              {logoSel ? (
                <img src={logoSel.image_url} alt="" style={{ position:'absolute', left:'30%', top:'22%', width:'14%', maxHeight:'14%', objectFit:'contain', borderRadius:3 }} />
              ) : (
                <div style={{ position:'absolute', left:'28%', top:'21%', width:'18%', height:'15%', border:'1.5px dashed rgba(0,0,0,0.3)', borderRadius:5, fontSize:7, color:'rgba(0,0,0,0.5)', fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', textAlign:'center', lineHeight:1.1, padding:2, textTransform:'uppercase', letterSpacing:'0.3px', background:'rgba(255,255,255,0.4)' }}>Aplique seu logo</div>
              )}
              {logo && <img src="/img/cali-colors-logo.webp" alt="Cali Colors" style={{ position:'absolute', right:'30%', top:'22%', width:'14%', maxHeight:'14%', objectFit:'contain' }} />}
            </div>
            <div style={{ fontSize:12, color:C.muted, marginTop:6 }}>
              TAM {tam}{painterName ? ' · ' + painterName.slice(0, 18) : ''}
            </div>
            <button onClick={gerarPedido} style={{ marginTop:12, background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'10px 24px', cursor:'pointer', fontWeight:600 }}>
              Gerar Pedido
            </button>
          </div>
        </div>
      </div>

      {/* Galeria — tudo que os pintores geraram/enviaram no app */}
      <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:12 }}>
          <div>
            <div style={{ fontWeight:700, color:C.ink }}>🎨 Logos dos pintores ({filtrados.length})</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
              Tudo que foi gerado com o Seu Zé ou enviado pelo pintor dentro do app fica salvo aqui.
            </div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por pintor, @tag, cidade, texto do logo…"
              style={{ padding:'8px 12px', border:'1px solid '+C.border, borderRadius:8, fontSize:13, minWidth:260 }}
            />
            <select value={fonte} onChange={e => setFonte(e.target.value)} style={{ padding:'8px 10px', border:'1px solid '+C.border, borderRadius:8, fontSize:13, background:C.white, color:C.ink }}>
              <option value="todos">Todos</option>
              <option value="ai">Gerados com IA</option>
              <option value="upload">Enviados</option>
            </select>
            <button onClick={refetch} style={{ padding:'8px 12px', border:'1px solid '+C.border, background:C.cream, borderRadius:8, fontSize:13, cursor:'pointer', color:C.ink, fontWeight:600 }}>
              Atualizar
            </button>
          </div>
        </div>

        {loading && <div style={{ color:C.muted, fontSize:13, padding:'24px 0' }}>Carregando logos…</div>}
        {!loading && error && (
          <div style={{ color:C.p4, fontSize:13, padding:'24px 0' }}>
            Não foi possível carregar os logos: {error.message || String(error)}
          </div>
        )}
        {!loading && !error && filtrados.length === 0 && (
          <div style={{ color:C.muted, fontSize:13, padding:'24px 0' }}>
            {logos.length === 0
              ? 'Nenhum logo ainda. Assim que um pintor gerar ou enviar um logo no app, ele aparece aqui.'
              : 'Nenhum logo bate com o filtro.'}
          </div>
        )}
        {!loading && !error && filtrados.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(230px, 1fr))', gap:12 }}>
            {filtrados.map(item => (
              <LogoCard key={item.id} item={item} onUse={setLogoSel} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Analytics = () => {
  const [data, setData] = useState({ profiles: 0, leads: 0, quotes: 0, messages: 0, quotesAccepted: 0, quotesData: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supa;
      const [pRes, lRes, qRes, mRes] = await Promise.all([
        sb.from('profiles').select('id, created_at'),
        sb.from('leads').select('id, status'),
        sb.from('quotes').select('id, status, service_type, price, created_at'),
        sb.from('messages').select('id'),
      ]);
      const profiles = pRes.data || [];
      const leads = lRes.data || [];
      const quotes = qRes.data || [];
      const messages = mRes.data || [];
      const accepted = quotes.filter(q => q.status === 'accepted' || q.status === 'completed').length;

      setData({ profiles: profiles.length, leads: leads.length, quotes: quotes.length, messages: messages.length, quotesAccepted: accepted, quotesData: quotes });
      setLoading(false);
    })();
  }, []);

  const funnel = React.useMemo(() => {
    const funnelTotal = data.profiles || 1;
    return [
      { label: 'Perfis cadastrados', n: data.profiles, pct: 100 },
      { label: 'Leads captados', n: data.leads, pct: Math.round(data.leads / funnelTotal * 100) },
      { label: 'Orçamentos solicitados', n: data.quotes, pct: Math.round(data.quotes / funnelTotal * 100) },
      { label: 'Orçamentos aceitos/concluídos', n: data.quotesAccepted, pct: Math.round(data.quotesAccepted / funnelTotal * 100) },
    ];
  }, [data]);

  const topServices = React.useMemo(() => {
    const serviceCounts = {};
    data.quotesData.forEach(q => {
      const s = q.service_type || q.title || 'Outros';
      serviceCounts[s] = (serviceCounts[s] || 0) + 1;
    });
    return Object.entries(serviceCounts).sort((a,b) => b[1] - a[1]).slice(0, 5);
  }, [data.quotesData]);

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando analytics...</div>;

  const serviceColors = [C.p1, C.p3, C.p7, C.p5, C.p6];

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:24 }}>
        <KPICard title="Perfis" value={data.profiles} sub="cadastrados" trend="" color={C.p3} />
        <KPICard title="Leads" value={data.leads} sub="captados" trend="" color={C.p5} />
        <KPICard title="Orçamentos" value={data.quotes} sub="total" trend="" color={C.p1} />
        <KPICard title="Mensagens" value={data.messages} sub="enviadas" trend="" color={C.p6} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
        <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)', gridColumn:'span 2' }}>
          <div style={{ fontWeight:700, marginBottom:16 }}>📈 Funil de Conversão</div>
          {funnel.map((s,i) => (
            <div key={i} style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:13 }}>{s.label}</span>
                <span style={{ fontSize:13, fontWeight:700 }}>{s.n.toLocaleString('pt-BR')}</span>
              </div>
              <div style={{ background:C.border, borderRadius:4, height:8 }}>
                <div style={{ background:C.p1, height:8, borderRadius:4, width: Math.max(s.pct, 2)+'%' }}></div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight:700, marginBottom:16 }}>🏆 Top Serviços</div>
          {topServices.length === 0 && <div style={{ color:C.muted, fontSize:13 }}>Nenhum orçamento ainda.</div>}
          {topServices.map(([name, count], i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
              <div style={{ width:12, height:12, borderRadius:3, background:serviceColors[i % serviceColors.length] }}></div>
              <div style={{ flex:1, fontSize:12 }}>{name}</div>
              <div style={{ fontSize:13, fontWeight:700 }}>{count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Categoria de quem fala: loja / profissional / cliente (cor + tag)
const senderKind = (p, isStore) => {
  if (isStore) return { label:'LOJA', fg:'#7a30d6', chip:'#efe7fb', bub:'#f3edfb', bd:'#d9c7f5' };
  if (p && (roleOf(p) === 'admin' || p.portal_access === true)) return { label:'LOJA', fg:'#7a30d6', chip:'#efe7fb', bub:'#f3edfb', bd:'#d9c7f5' };
  if (p && isProProfile(p)) return { label:'PROFISSIONAL', fg:'#d2541f', chip:'#fff1e8', bub:'#fff3ec', bd:'#f6d4bf' };
  return { label:'CLIENTE', fg:'#2563eb', chip:'#e8f0fe', bub:'#eef4ff', bd:'#cdddfb' };
};

const Chats = () => {
  const [conversations, setConversations] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [loading, setLoading] = useState(true);
  const [openConv, setOpenConv] = useState(null); // conversation_id
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [myUserId, setMyUserId] = useState(null);
  // Ate quando o PORTAL ja leu cada conversa. Antes o numero na lista era
  // o total de mensagens da conversa — nunca zerava, entao nao dizia nada.
  const [lidoAte, setLidoAte] = useState({});   // conversation_id -> ISO
  const msgsEndRef = React.useRef(null);
  const subRef = React.useRef(null);

  const scrollToBottom = () => { msgsEndRef.current?.scrollIntoView({ behavior:'smooth' }); };

  // Load conversations list
  const loadConversations = async () => {
    const { data: { session } } = await supa.auth.getSession();
    if(session) setMyUserId(session.user.id);

    const { data, error } = await supa
      .from('messages')
      .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if(error || !data){ setLoading(false); return; }

    const { data: reads } = await supa
      .from('portal_chat_reads').select('conversation_id, last_read_at').limit(2000);
    if(reads){
      const r = {};
      reads.forEach(x => { r[x.conversation_id] = x.last_read_at; });
      // Nao sobrescreve marca local mais nova (upsert ainda em voo).
      setLidoAte(prev => {
        const merged = { ...r };
        Object.keys(prev).forEach(k => {
          if(!merged[k] || new Date(prev[k]) > new Date(merged[k])) merged[k] = prev[k];
        });
        return merged;
      });
    }

    const ids = [...new Set(data.flatMap(m => [m.sender_id, m.receiver_id]).filter(Boolean))];
    let profMap = {};
    if(ids.length > 0){
      const { data: profs } = await supa.from('profiles').select('id, name, avatar_url, role, user_type, tag').in('id', ids);
      if(profs) profs.forEach(p => { profMap[p.id] = p; });
    }
    setProfiles(profMap);

    const convMap = {};
    data.forEach(m => {
      const key = m.conversation_id || m.sender_id || m.id;
      if(!convMap[key]) convMap[key] = { id: key, messages: [], lastMsg: m, participants: new Set(), is3way: false };
      convMap[key].messages.push(m);
      if(m.sender_id) convMap[key].participants.add(m.sender_id);
      if(m.receiver_id) convMap[key].participants.add(m.receiver_id);
      if(m.type === 'system' && m.content === '__STORE_ADDED__') convMap[key].is3way = true;
      if(!convMap[key].lastMsg || new Date(m.created_at) > new Date(convMap[key].lastMsg.created_at)) convMap[key].lastMsg = m;
    });
    const sorted = Object.values(convMap).sort((a,b) => new Date(b.lastMsg.created_at) - new Date(a.lastMsg.created_at));
    setConversations(sorted);
    setLoading(false);
  };

  useEffect(() => { loadConversations(); }, []);

  // NAO LIDAS: mensagem que chegou depois da ultima vez que o portal abriu
  // esta conversa, tirando o que o proprio operador mandou.
  const naoLidasConv = (conv) => {
    const desde = lidoAte[conv.id];
    return conv.messages.filter(m =>
      m.sender_id !== myUserId && (!desde || new Date(m.created_at) > new Date(desde))
    ).length;
  };

  const marcarConvLida = async (convId) => {
    const agora = new Date().toISOString();
    setLidoAte(s => ({ ...s, [convId]: agora }));       // otimista
    try { window.dispatchEvent(new CustomEvent('wa-lidas-mudou')); } catch(_){}
    await supa.from('portal_chat_reads')
      .upsert({ conversation_id: convId, last_read_at: agora }, { onConflict:'conversation_id' });
  };

  // Open a conversation
  const openChat = async (convId) => {
    setOpenConv(convId);
    marcarConvLida(convId);
    setChatLoading(true);
    setChatMsgs([]);

    const { data, error } = await supa
      .from('messages')
      .select('id, sender_id, receiver_id, conversation_id, content, type, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(200);

    if(!error && data) setChatMsgs(data);
    setChatLoading(false);
    setTimeout(scrollToBottom, 100);

    // Realtime subscription
    if(subRef.current) subRef.current.unsubscribe();
    subRef.current = supa
      .channel('portal-chat-' + convId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'conversation_id=eq.' + convId },
        (payload) => {
          setChatMsgs(prev => {
            if(prev.some(m => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
          marcarConvLida(convId); // esta aberta na tela: ja foi lida
          setTimeout(scrollToBottom, 100);
        })
      .subscribe();
  };

  // Cleanup subscription on unmount or conv change
  useEffect(() => { return () => { if(subRef.current) subRef.current.unsubscribe(); }; }, []);

  // Send message
  const sendMessage = async () => {
    const txt = msgText.trim();
    if(!txt || sending) return;
    setSending(true);
    setMsgText('');

    const { data: { session } } = await supa.auth.getSession();
    if(!session){ setSending(false); return; }

    // Find receiver from conversation participants
    const conv = conversations.find(c => c.id === openConv);
    const participantIds = conv ? [...conv.participants] : [];
    const receiverId = participantIds.find(id => id !== session.user.id) || null;

    const { data: inserted, error } = await supa.from('messages').insert({
      sender_id: session.user.id,
      receiver_id: receiverId,
      conversation_id: openConv,
      content: txt,
      type: 'store'
    }).select();
    if(error){
      console.error('Send error:', error);
      alert('Erro ao enviar: ' + error.message);
    } else if(inserted && inserted[0]){
      // Optimistic: add to chat immediately without waiting for realtime
      setChatMsgs(prev => {
        if(prev.some(m => m.id === inserted[0].id)) return prev;
        return [...prev, inserted[0]];
      });
    }
    setSending(false);
    setTimeout(scrollToBottom, 100);
  };

  const handleKeyDown = (e) => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } };

  const formatTime = (ts) => {
    if(!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) + ' ' + d.getHours() + ':' + (d.getMinutes()<10?'0':'') + d.getMinutes();
  };

  const getInitials = (name) => name ? name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : '??';

  if(loading) return <div style={{ padding:20, color:C.muted }}>Carregando mensagens...</div>;

  // Chat view (conversation open)
  if(openConv){
    const conv = conversations.find(c => c.id === openConv);
    const participantNames = conv ? [...conv.participants].map(id => profiles[id]?.name || 'Usuario').join(', ') : '';

    return (
      <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 120px)', background:C.white, borderRadius:16, overflow:'hidden', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
        {/* Chat header */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid '+C.border, display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
          <button aria-label="Voltar para lista de conversas" onClick={() => { setOpenConv(null); loadConversations(); }} style={{ background:'none', border:'none', cursor:'pointer', fontSize:18, color:C.ink, padding:'4px 8px', borderRadius:8 }}>←</button>
          <div style={{ display:'flex', gap:-4 }}>
            {conv && [...conv.participants].slice(0,3).map((id, i) => {
              const p = profiles[id];
              return (
                <div key={id} style={{ width:36, height:36, borderRadius:'50%', overflow:'hidden', background:C.p2, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:11, color:C.ink, marginLeft: i>0?-8:0, border:'2px solid '+C.white, position:'relative', zIndex:3-i }}>
                  {p?.avatar_url ? <img src={p.avatar_url} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : getInitials(p?.name||'')}
                </div>
              );
            })}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:14, color:C.ink }}>{participantNames}</div>
            <div style={{ fontSize:11, color:C.muted }}>
              {conv?.is3way && <span style={{ background:C.p1+'22', color:C.p1, borderRadius:4, fontSize:9, padding:'1px 6px', fontWeight:700, marginRight:6 }}>3-WAY</span>}
              {conv ? conv.participants.size + ' participantes' : ''}
            </div>
          </div>
        </div>

        {/* Messages area */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', background:'#faf8f5' }}>
          {chatLoading && <div style={{ textAlign:'center', color:C.muted, padding:20 }}>Carregando...</div>}
          {chatMsgs.filter(m => m.type !== 'system').map((m) => {
            const isMe = m.sender_id === myUserId;
            const isStore = m.type === 'store';
            const sender = profiles[m.sender_id];
            // Mostra quem respondeu de fato; "Cali Colors" só quando não há perfil do remetente
            const senderName = sender?.name || (isStore ? 'Cali Colors' : 'Usuario');
            const isImg = m.type === 'image' || (m.content && m.content.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i));
            const time = formatTime(m.created_at);
            const kind = senderKind(sender, isStore);

            return (
              <div key={m.id} style={{ display:'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap:8, marginBottom:14, alignItems:'flex-end' }}>
                {!isMe && (
                  <div style={{ width:32, height:32, borderRadius:'50%', overflow:'hidden', background: kind.chip, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:10, color: kind.fg, flexShrink:0 }}>
                    {sender?.avatar_url ? <img src={sender.avatar_url} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : (sender ? getInitials(senderName) : 'CC')}
                  </div>
                )}
                <div style={{ maxWidth:'65%' }}>
                  <div style={{ display:'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom:3 }}>
                    <span style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'.4px', color:kind.fg, background:kind.chip, padding:'2px 8px', borderRadius:8 }}>
                      {senderName} · {kind.label}
                    </span>
                  </div>
                  <div style={{
                    padding: isImg ? 4 : '10px 14px',
                    borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: kind.bub,
                    color: C.ink,
                    fontSize:13, lineHeight:'1.4',
                    border: '1px solid '+kind.bd,
                    wordBreak:'break-word'
                  }}>
                    {isImg ? <img src={m.content} style={{ maxWidth:220, borderRadius:12, display:'block' }} /> : m.content}
                  </div>
                  <div style={{ fontSize:9, color:C.muted, marginTop:2, textAlign: isMe ? 'right' : 'left', marginLeft:4, marginRight:4 }}>{time}</div>
                </div>
              </div>
            );
          })}
          <div ref={msgsEndRef} />
        </div>

        {/* Input area */}
        <div style={{ padding:'12px 20px', borderTop:'1px solid '+C.border, display:'flex', gap:10, alignItems:'center', flexShrink:0, background:C.white }}>
          <input
            value={msgText}
            onChange={e => setMsgText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            style={{ flex:1, padding:'10px 16px', borderRadius:24, border:'1px solid '+C.border, fontSize:13, outline:'none', background:'#faf8f5' }}
          />
          <button
            aria-label="Enviar mensagem"
            onClick={sendMessage}
            disabled={sending || !msgText.trim()}
            style={{ width:40, height:40, borderRadius:'50%', background: msgText.trim() ? C.p1 : C.border, color:'#fff', border:'none', cursor: msgText.trim() ? 'pointer' : 'default', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}
          >➤</button>
        </div>
      </div>
    );
  }

  // Conversations list
  return (
    <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight:700, marginBottom:16, color:C.ink }}>Conversas</div>
      {conversations.length === 0 && <div style={{ color:C.muted, fontSize:13 }}>Nenhuma conversa encontrada.</div>}
      {conversations.map((conv, i) => {
        const m = conv.lastMsg;
        const sender = profiles[m.sender_id];
        const senderName = sender ? sender.name : (m.sender_id ? m.sender_id.slice(0,8) + '...' : 'Desconhecido');
        const senderAvatar = sender?.avatar_url;
        const initials = getInitials(senderName);
        const participantNames = [...conv.participants].map(id => profiles[id]?.name || '?').join(', ');
        const isPintor = sender && (sender.role === 'pintor' || sender.user_type === 'pintor');
        const lastContent = m.type === 'system' ? '(sistema)' : (m.type === 'image' ? '📷 Foto' : (m.content || '').substring(0, 60));
        const dt = m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
        return (
          <div key={conv.id || i} onClick={() => openChat(conv.id)} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 0', borderBottom: i < conversations.length - 1 ? '1px solid '+C.border : 'none', cursor:'pointer', transition:'background 0.15s', borderRadius:8 }}
            onMouseEnter={e => e.currentTarget.style.background='#faf8f5'} onMouseLeave={e => e.currentTarget.style.background='transparent'}>
            <div style={{ width:44, height:44, borderRadius:'50%', overflow:'hidden', background:C.p2, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:14, color:C.ink, flexShrink:0 }}>
              {senderAvatar ? <img src={senderAvatar} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : initials}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:2 }}>
                <span style={{ fontWeight:600, fontSize:13 }}>{senderName}</span>
                {isPintor && <span style={{ background:C.ink, color:C.p1, borderRadius:6, fontSize:9, padding:'1px 6px', fontWeight:700 }}>PINTOR</span>}
                {conv.is3way && <span style={{ background:C.p1+'22', color:C.p1, borderRadius:6, fontSize:9, padding:'1px 6px', fontWeight:700 }}>3-WAY</span>}
                {conv.participants.size > 2 && !conv.is3way && <span style={{ background:C.p3+'22', color:C.p3, borderRadius:6, fontSize:9, padding:'1px 6px', fontWeight:700 }}>{conv.participants.size}P</span>}
              </div>
              <div style={{ fontSize:12, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{lastContent}</div>
              {conv.participants.size > 1 && <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{participantNames}</div>}
            </div>
            <div style={{ textAlign:'right', flexShrink:0 }}>
              <div style={{ fontSize:11, color:C.muted }}>{dt}</div>
              {naoLidasConv(conv) > 0 && <div title={naoLidasConv(conv) + ' mensagem(ns) que voce ainda nao abriu'} style={{ background:C.p1, color:'#fff', borderRadius:10, fontSize:10, fontWeight:700, padding:'2px 7px', marginTop:4, display:'inline-block' }}>{naoLidasConv(conv)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ══ IMPORTAR LEADS DE PLANILHA ═══════════════════════════════════════════
// Substituiu o "Busca AI" (2026-08-29), que NAO buscava nada: pedia pro
// modelo INVENTAR empresas plausiveis — nome, telefone, nota, tudo
// fabricado. Telefone inventado em formato valido e o telefone de alguem,
// e com o botao "Abordar" do lado isso vira mensagem pra estranho.
//
// Le CSV, nao .xlsx: xlsx e ZIP+XML e precisaria de biblioteca externa (o
// portal carrega script com SRI e sem bundler). No Excel: Arquivo →
// Salvar como → CSV.
//
// Dois detalhes que quebram importacao de planilha brasileira e que estao
// tratados aqui: o Excel pt-BR separa por PONTO E VIRGULA (nao virgula) e
// salva em ANSI/windows-1252 (nao UTF-8) — sem isso vem tudo numa coluna
// so, ou com acento virando caractere estranho.

const CSV_CAMPOS = [
  { k:'name',         rot:'Nome *',        req:true,  dicas:['nome','name','empresa','razao','razão','estabelecimento','titulo','título'] },
  // Telefone OU Perfil do IG: a planilha de grafiteiros (Diretório de Artistas
  // da Click Rua) vem com @ e sem telefone — o canal deles é o Instagram.
  { k:'phone',        rot:'Telefone *',    req:true,  dicas:['telefone','fone','celular','phone','whatsapp','contato','tel'] },
  { k:'instagram',    rot:'Perfil do IG *', req:true, dicas:['perfil do ig','instagram','insta','ig','perfil','@'] },
  { k:'category',     rot:'Categoria',     req:false, dicas:['categoria','category','tipo','ramo','atividade'] },
  { k:'segment',      rot:'Segmento',      req:false, dicas:['segmento','segment'] },
  { k:'city',         rot:'Cidade',        req:false, dicas:['cidade','city','municipio','município'] },
  { k:'state',        rot:'Estado (UF)',   req:false, dicas:['estado','uf','state'] },
  { k:'neighborhood', rot:'Bairro',        req:false, dicas:['bairro','neighborhood','regiao','região'] },
  { k:'address',      rot:'Endereço',      req:false, dicas:['endereco','endereço','address','rua','logradouro'] },
  { k:'rating',       rot:'Nota',          req:false, dicas:['nota','rating','avaliacao','avaliação','estrelas'] },
  { k:'review_count', rot:'Nº avaliações', req:false, dicas:['avaliacoes','avaliações','review','reviews','review_count','qtd'] },
  { k:'priority',     rot:'Prioridade',    req:false, dicas:['prioridade','priority'] },
];

const semAcento = (t) => String(t||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();

// Parser de CSV na mao: trata aspas, aspas duplicadas ("") e quebra de
// linha DENTRO do campo — endereco com virgula entre aspas e a regra, nao
// a excecao, em planilha de lead.
const parseCSV = (texto, sep) => {
  const linhas = []; let campo = ''; let linha = []; let dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i+1] === '"') { campo += '"'; i++; } else dentroAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { dentroAspas = true; continue; }
    if (c === sep) { linha.push(campo); campo = ''; continue; }
    if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    if (c === '\r') continue;
    campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter(l => l.some(v => String(v).trim() !== ''));
};

const detectarSeparador = (primeiraLinha) => {
  const cont = (ch) => (primeiraLinha.split(ch).length - 1);
  const cands = [[';', cont(';')], [',', cont(',')], ['\t', cont('\t')]];
  cands.sort((a,b) => b[1] - a[1]);
  return cands[0][1] > 0 ? cands[0][0] : ';';
};

// Excel pt-BR salva CSV em ANSI. Lemos como UTF-8 e, se aparecer o
// caractere de substituicao, relemos como windows-1252.
const decodificar = (buffer) => {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1252').decode(buffer); } catch(_) { return utf8; }
};

const soDigitos = (t) => String(t||'').replace(/\D/g,'');
const chaveTelefone = (t) => { const d = soDigitos(t); return d.length >= 8 ? d.slice(-8) : ''; };
// "@fulano", "instagram.com/fulano/" ou "fulano" → "fulano" (minusculo).
const normalizarIg = (t) => String(t||'').trim()
  .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@+/, '')
  .replace(/[\/?#\s].*$/, '').toLowerCase().slice(0, 80);
const urlDoIg = (h) => 'https://instagram.com/' + encodeURIComponent(normalizarIg(h));

// ── Excel direto (.xls/.xlsx) — 2026-09-09, pedido do usuario ─────────────
// O portal nao tem bundler, entao o SheetJS (xlsx 0.18.5, Apache-2.0) vive
// VENDORADO em /portal/xlsx.full.min.js, igual ao React, e e carregado SO
// quando a pessoa escolhe um .xls/.xlsx — sao ~880 KB que a tela de leads
// nao precisa pagar em todo boot. A tag entra com SRI (o hash abaixo e do
// arquivo commitado; __tests__/portalImportarExcel.test.ts confere) e
// crossorigin, como as demais. O CSV continua passando pelo parser nosso.
// [teste:xlsx-inicio]
const XLSX_SRC = '/portal/xlsx.full.min.js?v=0.18.5';
const XLSX_SRI = 'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw';
const EXTENSOES_EXCEL = /\.(xlsx|xlsm|xls|ods)$/i;
const ehArquivoExcel = (nome) => EXTENSOES_EXCEL.test(String(nome || ''));
// Celula → texto. Numero inteiro vira String(v) (nunca "1.19877E+10", que e
// o que o texto FORMATADO do Excel devolve pra telefone em coluna
// estreita); float fica como esta; o resto passa por String.
const celulaParaTexto = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};
// Matriz da PRIMEIRA aba, sem linha totalmente vazia — mesmo formato do
// parseCSV, entao o resto do importador nao sabe de onde veio.
const matrizDaPlanilha = (XLSX, buf) => {
  const wb = XLSX.read(new Uint8Array(buf), { type:'array', codepage: 1252, cellDates: false });
  const nome = wb.SheetNames && wb.SheetNames[0];
  if (!nome) return [];
  const ws = wb.Sheets[nome];
  const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  return linhas.map(l => (l || []).map(celulaParaTexto)).filter(l => l.some(v => String(v).trim() !== ''));
};
// [teste:xlsx-fim]
let _xlsxPromise = null;
const carregarXlsx = () => {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_SRC; s.integrity = XLSX_SRI; s.crossOrigin = 'anonymous'; s.async = true;
    s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('leitor de Excel não inicializou'));
    s.onerror = () => { _xlsxPromise = null; reject(new Error('não consegui carregar o leitor de Excel (/portal/xlsx.full.min.js)')); };
    document.head.appendChild(s);
  });
  return _xlsxPromise;
};

const ImportarPlanilhaModal = ({ open, onClose, onPronto, existingLeads }) => {
  const [linhas, setLinhas] = useState(null);   // matriz do CSV
  const [mapa, setMapa] = useState({});         // campo → indice da coluna
  const [erro, setErro] = useState('');
  const [progresso, setProgresso] = useState('');
  const [relatorio, setRelatorio] = useState(null);
  const [importando, setImportando] = useState(false);
  // Segmento/categoria pra linhas em que a planilha nao diz (a de grafiteiros
  // nao tem essa coluna). Escolha explicita da pessoa, nunca chute.
  const [segPadrao, setSegPadrao] = useState('');

  const reset = () => { setLinhas(null); setMapa({}); setErro(''); setProgresso(''); setRelatorio(null); setSegPadrao(''); };
  const fechar = () => { reset(); onClose(); };

  const lerArquivo = async (file) => {
    reset();
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      let m;
      if (ehArquivoExcel(file.name)) {
        setProgresso('Carregando leitor de Excel…');
        const XLSX = await carregarXlsx();
        setProgresso('');
        m = matrizDaPlanilha(XLSX, buf);
      } else {
        const texto = decodificar(buf).replace(/^﻿/, '');
        const sep = detectarSeparador((texto.split('\n')[0] || ''));
        m = parseCSV(texto, sep);
      }
      if (m.length < 2) { setErro('A planilha precisa ter o cabecalho e ao menos uma linha.'); return; }
      const cabec = m[0].map(h => semAcento(h));
      // Casa cada campo com a coluna cujo titulo mais parece com ele.
      const auto = {};
      CSV_CAMPOS.forEach(c => {
        const idx = cabec.findIndex(h => h && c.dicas.some(d => h === semAcento(d)));
        const idx2 = idx >= 0 ? idx : cabec.findIndex(h => h && c.dicas.some(d => h.includes(semAcento(d))));
        if (idx2 >= 0 && !Object.values(auto).includes(idx2)) auto[c.k] = idx2;
      });
      setMapa(auto); setLinhas(m);
    } catch(e) { setErro('Nao consegui ler o arquivo: ' + ((e && e.message) || '?')); }
  };

  const dados = linhas ? linhas.slice(1) : [];
  const val = (row, campo) => {
    const i = mapa[campo];
    return (i === undefined || i === null || i === '') ? '' : String(row[i] ?? '').trim();
  };

  const importar = async () => {
    if (mapa.name === undefined || (mapa.phone === undefined && mapa.instagram === undefined)) {
      setErro('Escolha a coluna de Nome e a de Telefone OU a de Perfil do IG.'); return;
    }
    setImportando(true); setErro(''); setProgresso('Preparando…');

    // Duplicata = mesmo telefone (8 ultimos digitos) OU mesmo @ do Instagram.
    const jaExiste = {};
    (existingLeads || []).forEach(l => {
      const k = chaveTelefone(l.phone); if (k) jaExiste[k] = true;
      const ig = normalizarIg(l.instagram); if (ig) jaExiste['ig:' + ig] = true;
    });

    const rows = []; const semTelefone = []; const repetidos = [];
    const vistos = {};
    dados.forEach(r => {
      const nome = val(r, 'name');
      const tel = val(r, 'phone');
      const ig = normalizarIg(val(r, 'instagram'));
      const kTel = chaveTelefone(tel);
      const kIg = ig ? 'ig:' + ig : '';
      if (!nome) return;
      if (!kTel && !kIg) { semTelefone.push(nome); return; }
      if ((kTel && (jaExiste[kTel] || vistos[kTel])) || (kIg && (jaExiste[kIg] || vistos[kIg]))) { repetidos.push(nome); return; }
      if (kTel) vistos[kTel] = true;
      if (kIg) vistos[kIg] = true;
      const nota = parseFloat(String(val(r,'rating')).replace(',', '.'));
      const qtd = parseInt(soDigitos(val(r,'review_count')), 10);
      const prio = semAcento(val(r,'priority'));
      const segmento = (val(r,'segment') || segPadrao || '').toUpperCase().slice(0, 40) || null;
      // Sem categoria na planilha e segmento GRAFFITI escolhido: a categoria
      // e a unica do funil ('Graffiti/Arte'); nos outros segmentos fica vazia.
      const categoria = val(r,'category').slice(0, 80) || (segmento === 'GRAFFITI' ? 'Graffiti/Arte' : null);
      const uf = val(r,'state').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || null;
      rows.push({
        name: nome.slice(0, 200),
        phone: kTel ? tel.slice(0, 40) : null,
        instagram: ig || null,
        state: uf,
        segment: segmento,
        category: categoria,
        city: val(r,'city').slice(0, 80) || (uf ? null : 'Guarulhos'),
        neighborhood: val(r,'neighborhood').slice(0, 80) || null,
        address: val(r,'address').slice(0, 250) || null,
        rating: isFinite(nota) ? Math.min(5, Math.max(0, nota)) : null,
        review_count: isFinite(qtd) ? qtd : null,
        priority: ['alta','media','baixa'].includes(prio) ? prio : 'media',
        source: 'planilha',
        status: 'novo',
      });
    });

    if (!rows.length) {
      setImportando(false);
      setRelatorio({ salvos:0, semTelefone:semTelefone.length, repetidos:repetidos.length, falhas:0 });
      return;
    }

    // Em lotes: 1000 linhas num INSERT so estoura tempo/limite do PostgREST.
    let salvos = 0, falhas = 0, motivo = '';
    // `instagram`/`state` sao colunas novas (migration 2026-09-08). Se o SQL
    // ainda nao rodou (42703), grava sem elas e AVISA — importar nao pode
    // quebrar por SQL pendente (licao de quotes.post_id / leads.city).
    let colunaFaltando = false;
    const semColunasNovas = (lista) => lista.map(({ instagram, state, ...resto }) => resto);
    const gravar = async (lista) => {
      try { await leadsService.insertBatch(lista); }
      catch(e) {
        const msg = String((e && (e.message || e.details)) || '');
        if (String(e && e.code) === '42703' && /instagram|state/.test(msg)) {
          colunaFaltando = true;
          await leadsService.insertBatch(semColunasNovas(lista));
        } else throw e;
      }
    };
    const LOTE = 200;
    for (let i = 0; i < rows.length; i += LOTE) {
      const fatia = rows.slice(i, i + LOTE);
      setProgresso('Salvando ' + Math.min(i + LOTE, rows.length) + ' de ' + rows.length + '…');
      try { await gravar(fatia); salvos += fatia.length; }
      catch(e) {
        // Lote falhou: tenta linha a linha pra nao perder as boas. GUARDA A
        // MENSAGEM do banco — sem ela "o banco recusou 984" nao diz nada e
        // vira adivinhacao (RLS? coluna que nao existe? CHECK?).
        for (const row of fatia) {
          try { await gravar([row]); salvos++; }
          catch(err) {
            falhas++;
            if(!motivo) motivo = (err && (err.message || err.hint || err.details)) || String(err);
          }
        }
      }
      if(motivo && salvos === 0 && i + LOTE < rows.length){
        // Tudo falhando pelo mesmo motivo: para de martelar o banco.
        falhas += rows.length - (i + fatia.length);
        break;
      }
    }
    setImportando(false); setProgresso('');
    setRelatorio({ salvos, semTelefone:semTelefone.length, repetidos:repetidos.length, falhas, motivo, colunaFaltando });
    onPronto();
  };

  if (!open) return null;
  const sel = { padding:'6px 8px', borderRadius:8, border:'1px solid '+C.border, fontSize:12, background:'#fff', width:'100%' };

  return (
    <div onClick={fechar} style={{ position:'fixed', inset:0, background:'rgba(26,26,46,.55)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:18, width:'min(760px, 96vw)', maxHeight:'90vh', overflow:'auto', boxShadow:'0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'16px 20px', background:C.ink, color:'#fff', borderRadius:'18px 18px 0 0', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:18, fontWeight:800, fontFamily:'Syne,sans-serif' }}>📥 Importar leads de planilha</div>
          <button onClick={fechar} style={{ background:'none', border:'none', color:'#fff', fontSize:22, cursor:'pointer', lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:20 }}>
          {!linhas ? (
            <div>
              <div style={{ fontSize:13, color:C.ink, lineHeight:1.6, marginBottom:14 }}>
                Aceita <strong>Excel direto (.xlsx, .xls)</strong> ou CSV. Só a primeira aba é lida, e a
                primeira linha tem que ser o cabeçalho (Nome, Telefone, Categoria…).
              </div>
              <input type="file" accept=".csv,.txt,.xlsx,.xlsm,.xls,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={e=>lerArquivo(e.target.files && e.target.files[0])}
                style={{ display:'block', width:'100%', padding:14, border:'2px dashed '+C.border, borderRadius:12, fontSize:13, cursor:'pointer' }} />
              <div style={{ fontSize:11, color:C.muted, marginTop:10 }}>
                Nada é enviado até você conferir as colunas na próxima tela.
              </div>
            </div>
          ) : relatorio ? (
            <div>
              <div style={{ fontSize:15, fontWeight:800, color:C.ink, marginBottom:10 }}>
                {relatorio.salvos > 0 ? '✅ ' + relatorio.salvos + ' leads importados' : 'Nenhum lead novo importado'}
              </div>
              <div style={{ fontSize:13, color:C.muted, lineHeight:1.8 }}>
                {relatorio.repetidos > 0 ? <div>· {relatorio.repetidos} já existiam (mesmo telefone) e foram pulados</div> : null}
                {relatorio.semTelefone > 0 ? <div>· {relatorio.semTelefone} sem telefone nem Perfil do IG — ficaram de fora</div> : null}
                {relatorio.colunaFaltando ? <div style={{ color:'#b45309' }}>· O banco ainda não tem as colunas Perfil do IG / Estado: os leads entraram SEM esses dois campos. Rode a migration <code>2026-09-08-leads-instagram.sql</code> e importe de novo.</div> : null}
                {relatorio.falhas > 0 ? <div style={{ color:'#b91c1c' }}>· {relatorio.falhas} o banco recusou</div> : null}
                {relatorio.motivo ? (
                  <div style={{ marginTop:10, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 10px', color:'#b91c1c', fontSize:12, lineHeight:1.5, wordBreak:'break-word' }}>
                    <strong>Motivo da recusa:</strong><br/>{relatorio.motivo}
                  </div>
                ) : null}
              </div>
              <button onClick={fechar} style={{ marginTop:18, background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'10px 22px', fontWeight:700, fontSize:13, cursor:'pointer' }}>Fechar</button>
            </div>
          ) : (
            <div>
              <div style={{ fontSize:13, color:C.ink, marginBottom:4 }}>
                <strong>{dados.length}</strong> linhas lidas. Confira em que coluna está cada informação:
              </div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:14 }}>Obrigatórios: Nome e Telefone <em>ou</em> Perfil do IG. O resto pode ficar em branco.</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:10 }}>
                {CSV_CAMPOS.map(c => (
                  <div key={c.k}>
                    <label style={{ fontSize:11, fontWeight:700, color: c.req ? C.p1 : C.muted, display:'block', marginBottom:3 }}>{c.rot}</label>
                    <select value={mapa[c.k] === undefined ? '' : mapa[c.k]} style={sel}
                      onChange={e => setMapa(m => ({ ...m, [c.k]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                      <option value="">— não tenho —</option>
                      {linhas[0].map((h, i) => <option key={i} value={i}>{h || ('Coluna ' + (i+1))}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {mapa.segment === undefined ? (
                <div style={{ marginTop:14, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                  <label style={{ fontSize:11, fontWeight:700, color:C.muted }}>A planilha não tem Segmento. Usar pra todas as linhas:</label>
                  <select value={segPadrao} onChange={e=>setSegPadrao(e.target.value)} style={{ ...sel, width:'auto' }}>
                    <option value="">— deixar em branco —</option>
                    {Object.keys(LEAD_SEG_COLORS).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {segPadrao === 'GRAFFITI' ? <span style={{ fontSize:11, color:C.muted }}>categoria vai como Graffiti/Arte</span> : null}
                </div>
              ) : null}
              <div style={{ marginTop:16, fontSize:11, fontWeight:700, color:C.muted }}>PRÉVIA DAS 3 PRIMEIRAS</div>
              <div style={{ overflowX:'auto', border:'1px solid '+C.border, borderRadius:10, marginTop:6 }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead><tr style={{ background:C.bg }}>
                    {CSV_CAMPOS.filter(c => mapa[c.k] !== undefined).map(c =>
                      <th key={c.k} style={{ padding:'7px 9px', textAlign:'left', fontSize:11, color:C.muted, whiteSpace:'nowrap' }}>{c.rot}</th>)}
                  </tr></thead>
                  <tbody>
                    {dados.slice(0,3).map((r,i) => (
                      <tr key={i} style={{ borderTop:'1px solid '+C.border }}>
                        {CSV_CAMPOS.filter(c => mapa[c.k] !== undefined).map(c =>
                          <td key={c.k} style={{ padding:'7px 9px', whiteSpace:'nowrap', maxWidth:180, overflow:'hidden', textOverflow:'ellipsis' }}>{val(r, c.k)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {erro ? <div style={{ color:'#b91c1c', fontSize:12, marginTop:12 }}>{erro}</div> : null}
              <div style={{ display:'flex', gap:10, marginTop:18, alignItems:'center' }}>
                <button onClick={importar} disabled={importando}
                  style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'11px 24px', fontWeight:700, fontSize:13, cursor: importando?'wait':'pointer' }}>
                  {importando ? 'Importando…' : 'Importar ' + dados.length + ' linhas'}
                </button>
                <button onClick={reset} disabled={importando}
                  style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'11px 18px', fontSize:13, cursor:'pointer', color:C.muted }}>Trocar arquivo</button>
                <span style={{ fontSize:12, color:C.muted }}>{progresso}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Constantes estáticas dos Leads — movidas para módulo (eram recriadas a cada render).
const LEAD_SEG_COLORS = { AUTOMOTIVO: '#e63946', GRAFFITI: '#8338ec', RESIDENCIAL: '#ff6b35', COMERCIAL: '#2ec4b6' };
const LEAD_SEG_ICONS = { AUTOMOTIVO: '🚗', GRAFFITI: '🎨', 'GRAFFITI/ARTE': '🎨', RESIDENCIAL: '🏠', COMERCIAL: '🏢' };
const LEAD_CAT_ICONS = { 'Funilaria/Auto': '🚗', 'Graffiti/Arte': '🎨', 'Pintor': '🖌', 'Reformas': '🔧', 'Construtoras': '🏗', 'Imobiliárias': '🏢', 'Arquitetura': '✏', 'Materiais': '🧱', 'Condomínios': '🏘', 'Academias': '💪', 'Bares': '🍺', 'Limpeza': '🧹', 'Marmoraria': '💎', 'Engenharia': '📐' };
const LEAD_STATUS_COLORS = { novo: C.p3, contactado: C.p7, qualificado: C.p6, convertido: C.p1, perdido: C.p4, fixo: C.muted };

// ══ ABORDAGEM DE LEAD POR WHATSAPP ═══════════════════════════════════════
// Mensagem personalizada por SEGMENTO, com produtos do NOSSO catalogo.
// REGRA DE NEGOCIO (decisao do dono, 2026-08-29): a mensagem NUNCA leva
// preco nem orcamento — isso e trabalho de pessoa. Por isso o card de
// produto aqui mostra nome/linha/volume e nada de R$.

// Numero do lead → formato do WhatsApp. Cobre o celular ANTIGO de 8 digitos
// (comecando 8/9, de antes de 2016) que precisa ganhar o nono digito.
const normalizeLeadPhone = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  if(!d) return null;
  if(d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if(d.length === 11 && d[2] === '9') return '55' + d;      // celular novo
  if(d.length === 10 && /^[89]/.test(d.slice(2))) return '55' + d.slice(0,2) + '9' + d.slice(2); // celular antigo
  if(d.length === 10) return '55' + d;                       // fixo
  if(d.length >= 11 && d.length <= 15) return d;             // DDI estrangeiro
  return null;
};

// Celular ou fixo, so pelo formato (deterministico no Brasil).
const tipoDeLinha = (raw) => {
  const d = String(raw || '').replace(/\D/g, '');
  const local = d.startsWith('55') ? d.slice(2) : d;
  if(local.length === 11 && local[2] === '9') return 'celular';
  if(local.length === 10 && /^[89]/.test(local.slice(2))) return 'celular';
  if(local.length === 10) return 'fixo';
  return 'desconhecido';
};

// Mapa CATEGORIA DO LEAD → o que oferecer + palavras que acham o produto no
// catalogo (busca no NOME, que e mais confiavel que a taxonomia). Ajustar
// aqui quando a loja quiser mudar o que oferece pra cada tipo de cliente.
//
// `ramo` = como a pessoa descreveria o proprio trabalho, no formato que o
// template de abordagem espera em "{{3}}" ("trabalha com {{3}}"). E frase
// pra ler numa mensagem, nao o rotulo da tabela: "trabalha com
// Funilaria/Auto" soa como planilha, "trabalha com funilaria e pintura
// automotiva" soa como gente. Minusculo de proposito — entra no meio da
// frase.
// [teste:ramo-inicio] — extraido por __tests__/portalRamoDoLead.test.ts.
// So JS puro entre os marcadores.
const LEAD_PITCH = {
  // `oferta` = o que a loja diz que TEM pra esse publico. Frase generica de
  // proposito (2026-08-29): antes a mensagem listava SKU com volume, e saia
  // coisa como "AROMINHA SPRAY CARRO NOVO 60ML (18L)" pra um grafiteiro —
  // item errado e volume errado (o catalogo tem 18L como padrao em tudo).
  // Quem vende e a pessoa; a abordagem so precisa dizer que a loja tem a
  // linha que aquele profissional usa.
  'Funilaria/Auto': { funil:'fornece', ramo:'funilaria e pintura automotiva', linha:'linha automotiva',
    fecho:'Quer ver como funciona a tinta preparada na hora aqui na loja?',
    oferta:'linha automotiva completa: tinta pronta e tinta preparada na hora, primer, verniz, massa plástica, e os materiais de acabamento e detalhamento (polimento, cera)',
    termos:['automotiv','primer','verniz','poliester','massa pl','fundo'] },
  'Auto Center':    { funil:'fornece', ramo:'pintura automotiva', linha:'linha automotiva',
    fecho:'Quer ver como funciona a tinta preparada na hora aqui na loja?',
    oferta:'linha automotiva completa: tinta pronta e preparada na hora, primer, verniz e material de polimento e cera',
    termos:['automotiv','primer','verniz','fundo','cera','polim'] },
  'Pintor':         { funil:'fornece', ramo:'pintura residencial', linha:'linha residencial e comercial',
    fecho:'Quer saber qual linha rende mais por lata? Tem uma que costuma surpreender quem testa.',
    oferta:'tintas de várias marcas, da econômica à premium, incluindo linhas de alto rendimento que fecham parede com menos demão — além de massa corrida, selador e textura',
    termos:['latex','acrilic','massa corrida','seladora','fundo'] },
  'Graffiti/Arte':  { funil:'fornece', ramo:'graffiti e arte urbana', linha:'linha de spray e arte',
    fecho:'Quer ver a cartela de cores que temos em spray?',
    oferta:'spray Colorgin e Arte Urbana, com a cartela de cores completa, além de tinta acrílica pra mural e base de parede',
    termos:['colorgin','arte urbana','spray','aerossol'] },
  'Construtora':    { funil:'fornece', ramo:'construção civil', linha:'linha de obra em grande volume',
    fecho:'Quer ver como a gente atende obra em volume?',
    oferta:'linha de obra em grande volume: acrílico, fundo preparador, textura e impermeabilizante, em lata de 18L',
    termos:['acrilic','latex','fundo prepar','textura','18l'] },
  'Reforma':        { funil:'fornece', ramo:'reformas', linha:'linha de reforma',
    fecho:'Quer ver o que costuma poupar tempo numa reforma?',
    oferta:'tinta econômica e premium, massa corrida, selador e textura — tudo o que a reforma pede',
    termos:['acrilic','latex','massa','seladora'] },
  'Materiais':      { funil:'fornece', ramo:'materiais de construção', linha:'linha completa pra revenda',
    fecho:'Quer conhecer a nossa lista pra revenda?',
    oferta:'linha completa pra revenda, de várias marcas: acrílico, esmalte, solvente e complementos',
    termos:['acrilic','latex','esmalte','solvente'] },
  'Marmoraria':     { funil:'fornece', ramo:'marmoraria', linha:'impermeabilizantes e vernizes',
    fecho:'Quer ver o que a gente indica pra proteger pedra?',
    oferta:'impermeabilizantes, vernizes e resinas pra pedra',
    termos:['verniz','impermeab','resina'] },
  'Limpeza':        { funil:'fornece', ramo:'limpeza e manutenção predial', linha:'linha de manutencao predial',
    fecho:'Quer ver a linha que a gente indica pra manutenção predial?',
    oferta:'linha de manutenção predial: acrílico, esmalte e solventes',
    termos:['acrilic','esmalte','solvente'] },
  'Engenharia':     { funil:'fornece', ramo:'engenharia civil', linha:'linha de obra e manutencao predial',
    fecho:'Quer receber a nossa cartela de cores e as fichas técnicas?',
    oferta:'linhas premium de acabamento e a linha de obra em grande volume: acrílico, fundo preparador, textura e impermeabilizante',
    termos:['acrilic','latex','fundo prepar','textura','impermeab'] },
  'Imobiliária':    { funil:'demanda', ramo:'imóveis', linha:'pintura de imoveis pra locacao e venda',
    oferta:'tinta pra imóvel de locação e venda, do custo-benefício ao acabamento premium',
    termos:['acrilic','latex','massa corrida'] },
  'Condomínio':     { funil:'demanda', ramo:'administração de condomínio', linha:'pintura de fachada e areas comuns',
    oferta:'linha de fachada e áreas comuns: acrílico, textura e impermeabilizante',
    termos:['fachada','acrilic','textura','impermeab'] },
  'Bares':          { funil:'demanda', ramo:'bares e restaurantes', linha:'pintura de salao e fachada',
    oferta:'tinta pra salão e fachada, com acabamento lavável',
    termos:['acrilic','esmalte','epoxi'] },
  'Academia':       { funil:'demanda', ramo:'academia', linha:'pintura de salao e piso',
    oferta:'tinta de piso e de parede pra área de treino',
    termos:['epoxi','piso','acrilic'] },
  'Supermercado':   { funil:'demanda', ramo:'supermercado', linha:'pintura de loja, piso e fachada',
    oferta:'tinta de piso, parede e fachada pra loja',
    termos:['epoxi','piso','acrilic','fachada'] },
  'Pousada':        { funil:'demanda', ramo:'hospedagem', linha:'pintura de quartos e fachada',
    oferta:'tinta pra quarto, área comum e fachada',
    termos:['acrilic','latex','fachada'] },
  'Arquitetura':    { funil:'demanda', ramo:'arquitetura', linha:'especificacao de cores e acabamentos',
    oferta:'linhas premium de acabamento — acetinado, fosco, efeitos e texturas — com cartela de cores completa pra especificação',
    termos:['acrilic','textura','efeito'] },
};
const pitchDoLead = (l) => LEAD_PITCH[l.category] ||
  { funil:'demanda', linha:'linha completa de tintas',
    oferta:'linha completa de tintas, das econômicas às premium',
    fecho:'Quer ver o que temos pra sua linha de trabalho?',
    termos:['acrilic','latex'] };

// Segmento por SEGMENTO do lead (COMERCIAL/AUTOMOTIVO/...), pra quando a
// categoria nao esta no mapa acima. Mais grosso que o `ramo`, mas ainda e
// frase de gente — e melhor que deixar o operador digitar do zero.
const RAMO_POR_SEGMENTO = {
  RESIDENCIAL: 'pintura residencial',
  COMERCIAL:   'pintura comercial',
  AUTOMOTIVO:  'pintura automotiva',
  GRAFFITI:    'graffiti e arte urbana',
};

// O que vai no {{3}} ("trabalha com {{3}}") pra este lead, ou null.
// Ordem: `ramo` da categoria > segmento > categoria em minusculo. Null quando
// nao ha pista nenhuma — o campo fica vazio e o botao trava ate o operador
// preencher, em vez de inventar um ramo que a pessoa nao tem.
const ramoDoLead = (l) => {
  if(!l) return null;
  const p = LEAD_PITCH[l.category];
  if(p && p.ramo) return p.ramo;
  const seg = RAMO_POR_SEGMENTO[String(l.segment || '').trim().toUpperCase()];
  if(seg) return seg;
  const cat = String(l.category || '').trim();
  return cat ? cat.toLowerCase() : null;
};
// O que vai no {{2}} ("atende em {{2}}") pra este lead, ou null.
//
// A base guarda a cidade de TRES jeitos, e so um deles e a coluna `city`:
//   1. `city` preenchida — importacao da planilha e leads novos;
//   2. `address` que e SO o nome da cidade ("Guarulhos", "Guarulhos - SP",
//      "Pimentas, Guarulhos - SP") — os leads antigos de captacao gravaram
//      a cidade ali. Na tela isso aparecia como "Guarulhos" embaixo do nome
//      com a coluna CIDADE em "—", e o modal de abordagem abria com o
//      campo 2 vazio e o botao travado (2026-09-08);
//   3. a cidade escrita no proprio NOME ("Studio Arquitetura Guarulhos"),
//      conferida contra a lista de cidades que a base conhece — nunca
//      uma palavra qualquer do nome.
// Rua com numero NAO vira cidade ("R. Manaus, 158" tem digito e prefixo de
// logradouro), e "n/a"/"nao informado" da base importada tambem nao
// (mesma regua do `valorDeVariavel`). Sem pista, null: o campo fica vazio
// e o botao trava, em vez de mandar "atende em R. Manaus" pro cliente.
const CIDADES_CONHECIDAS = [
  'Guarulhos','Arujá','Itaquaquecetuba','Mairiporã','Santa Isabel','São Paulo',
  'Osasco','Barueri','Carapicuíba','Taboão da Serra','Cotia','Santo André',
  'São Bernardo do Campo','São Caetano do Sul','Mauá','Diadema','Suzano',
  'Mogi das Cruzes','Poá','Ferraz de Vasconcelos','Guararema','Franco da Rocha',
  'Caieiras','Jundiaí','Campinas','Sorocaba','Piracicaba','São José dos Campos',
  'Ribeirão Preto','Bauru','Santos',
];
const _semAcentoLead = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const _valorDeCidade = (bruto) => {
  const limpo = String(bruto || '').trim().replace(/\s+/g, ' ');
  if(limpo.length < 2 || !/\p{L}/u.test(limpo)) return null;
  if(/^(n\/?a|nao informado|não informado|sem cidade|indefinido)$/i.test(limpo)) return null;
  return limpo.slice(0, 60);
};
// Endereco que e so lugar (sem numero, sem logradouro) -> a cidade, ou null.
const cidadeDoEndereco = (bruto) => {
  let t = String(bruto || '').trim().replace(/\s+/g, ' ');
  if(!t || /\d/.test(t)) return null;
  t = t.replace(/\s*[-\/,]\s*[A-Z]{2}$/, '').trim(); // "Guarulhos - SP" -> "Guarulhos"
  const partes = t.split(/\s*[,\-\/]\s*/).filter(Boolean);
  const ult = partes[partes.length - 1] || '';
  if(!ult || ult.split(' ').length > 4) return null;
  if(/^(r\.|rua|av\.?|avenida|estr\.?|estrada|al\.|alameda|rod\.?|rodovia|trav\.?|travessa|pç\.?|pça|praça|praca|jd\.?|jardim|vl\.?|vila|pq\.?|parque|cj\.?|conjunto|km)\b/i.test(ult)) return null;
  return _valorDeCidade(ult);
};
// Cidade conhecida citada no nome do lead, ou null.
const cidadeNoNome = (nome) => {
  const n = ' ' + _semAcentoLead(nome).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
  if(n.trim().length < 3) return null;
  for(const c of CIDADES_CONHECIDAS){
    if(n.includes(' ' + _semAcentoLead(c) + ' ')) return c;
  }
  return null;
};
const cidadeDoLead = (l) => {
  if(!l) return null;
  return _valorDeCidade(l.city) || cidadeDoEndereco(l.address) || cidadeNoNome(l.name);
};
// [teste:ramo-fim]


// ── Templates aprovados pela Meta (primeira mensagem) ───────────────────
// Numero que nunca escreveu pra loja NAO tem janela de 24h aberta: a Cloud
// API recusa texto livre (131047) e so template aprovado passa. E quem abre
// a janela e a RESPOSTA da pessoa, nao o nosso envio.
//
// Dois templates aprovados (ambos Marketing, pt_BR):
//   - calicolors_nome — {{1}} = primeiro nome de quem recebe (PADRAO)
//   - calicolors      — texto fixo, sem variavel
//
// O de nome e o padrao porque mensagem que chama a pessoa pelo nome tem
// resposta melhor. Mas ele SO pode ser usado com nome de verdade: {{1}}
// vazio faria a Meta entregar "Oi ," ou recusar o envio. Por isso o
// fallback e obrigatorio, e a regra vive em `escolherTemplate` — a MESMA
// decisao existe no servidor (lib/api/_services/whatsapp.ts), pro
// follow-up automatico; se divergirem, um dos dois manda nome vazio.
//
// `texto` e so ESPELHO pra tela: o conteudo de verdade vive na Meta. Mudou
// no painel do Dualhook, mudar aqui. Template sem espelho conhecido nao
// inventa texto — diz que o conteudo esta no painel, o que e honesto e
// melhor do que mostrar algo diferente do que a pessoa vai receber.
// [teste:template-inicio] — mesmo esquema do bloco da janela: extraido por
// __tests__/portalJanela24h.test.ts pra provar que portal e servidor
// escolhem o MESMO template. So JS puro entre os marcadores.
const TEMPLATE_IDIOMA = 'pt_BR';

const TEMPLATES_APROVADOS = [
  {
    nome: 'calicolors_nome',
    rotulo: 'Com o nome da pessoa',
    precisaNome: true,
    titulo: null,
    texto: null, // espelho ainda nao cadastrado — ver comentario acima
    rodape: null,
    botoes: [],
    fonte: 'local',
  },
  {
    nome: 'calicolors',
    rotulo: 'Sem nome (texto fixo)',
    precisaNome: false,
    titulo: 'O que a Calicolors pode fazer por você?',
    texto:
      'Oi, tudo bem? Somos a Calicolors Tintas, de Guarulhos.\n\n' +
      'Estamos conversando com profissionais que trabalham com tintas, cores e ' +
      'acabamentos para entender uma coisa: o que mais faz diferença no dia a ' +
      'dia — preço, agilidade na entrega, disponibilidade de materiais ou ' +
      'suporte para encontrar a solução certa?\n\n' +
      'Dependendo da sua resposta, talvez a gente consiga ajudar.\n\n' +
      'O que mais faria diferença para você hoje?',
    rodape: null,
    botoes: [],
    fonte: 'local',
  },
];

const TEMPLATE_SEM_NOME = 'calicolors';
const TEMPLATE_COM_NOME = 'calicolors_nome';
// {{1}} nome, {{2}} CIDADE, {{3}} segmento ("Vi que você atende em {{2}} e
// trabalha com {{3}}"). Mensagem que diz a cidade e o ramo da pessoa e a
// que menos parece disparo em massa — mas depende de dado que parte da
// base nao tem, entao o fallback pro de nome e obrigatorio, nao opcional.
// Era "bairro" ate 2026-09-07; a decisao do usuario e CIDADE — e cidade
// quase todo lead tem (696 vieram do termo de busca do Maps, que e por
// cidade), enquanto bairro faltava na maioria.
const TEMPLATE_COM_CIDADE = 'calicolors_abordagem_v2';

// Lista VIVA, carregada de /api/whatsapp/templates (que consulta a Meta via
// Dualhook). A lista embutida acima fica de fallback: se a consulta falhar
// — endpoint nao espelhado, chave sem permissao, rede — a tela continua
// funcionando com os dois templates que sabemos existir, em vez de ficar
// sem nenhum. Recurso novo nao pode derrubar o que ja funciona.
//
// Lista de template escrita a mao envelhece igual lista de pendencia:
// alguem aprova um no painel, ninguem mexe no codigo, e a tela segue
// oferecendo dois. Pior: se o nome mudar la, o envio quebra com 132001 e a
// tela continua exibindo o nome velho como se estivesse certo.
let _templatesVivos = null;

const templatesDisponiveis = () => _templatesVivos || TEMPLATES_APROVADOS;
const templatePorNome = (n) => templatesDisponiveis().find(t => t.nome === n) || null;

// Primeiro nome utilizavel pro {{1}}, ou null. Espelha `primeiroNome` do
// servidor: recusa vazio, recusa telefone no lugar do nome (a base
// importada tem lead assim — "Oi 11987654321" e pior que sem nome) e
// recusa inicial solta.
const primeiroNome = (bruto) => {
  const limpo = String(bruto || '').trim().replace(/\s+/g, ' ');
  if(!limpo) return null;
  if(!/\p{L}/u.test(limpo)) return null;
  const p = limpo.split(' ')[0];
  if(p.length < 2) return null;
  return p.slice(0, 60);
};

// Nome COMPLETO utilizavel pro {{1}} da abordagem, ou null. Decisao do
// usuario (2026-09-08): "falta aparecer o nome completo do lead e nao
// somente a primeira palavra" — o lead e quase sempre um NEGOCIO ("Neri
// Pintor Atelier", "Studio Arquitetura Guarulhos"), e "Oi Neri" / "Oi
// Studio" corta o nome no meio. Mesma regua de validade do `primeiroNome`
// (recusa vazio, telefone no lugar do nome e inicial solta); o que muda e
// que devolve o nome inteiro. O `primeiroNome` continua existindo pro
// follow-up automatico (paridade com o servidor).
const nomeCompleto = (bruto) => {
  const limpo = String(bruto || '').trim().replace(/\s+/g, ' ');
  if(!limpo) return null;
  if(!/\p{L}/u.test(limpo)) return null;
  if(limpo.split(' ')[0].length < 2 && limpo.length < 3) return null;
  return limpo.slice(0, 60);
};

// Valor utilizavel pra uma variavel de template, ou null. Mesma regua do
// primeiroNome e pelo mesmo motivo: {{2}} vazio faz a Meta entregar
// "aqui no  " ou recusar o envio. Recusa tambem os marcadores que a base
// importada usa no lugar do dado ("n/a", "nao informado"), que chegariam
// ao cliente como texto literal.
const valorDeVariavel = (bruto) => {
  const limpo = String(bruto || '').trim().replace(/\s+/g, ' ');
  if(limpo.length < 2) return null;
  if(!/\p{L}/u.test(limpo)) return null;
  if(/^(n\/?a|nao informado|não informado|sem (cidade|bairro|segmento)|indefinido)$/i.test(limpo)) return null;
  return limpo.slice(0, 60);
};

// Monta o que vai no corpo do POST. Sem nome utilizavel -> template fixo,
// nunca o de variavel com {{1}} vazio. Com nome + cidade + segmento sobe
// pro de tres variaveis; falta UM e desce pro de nome, porque meia
// personalizacao nao existe.
const escolherTemplate = (nomeBruto, preferido, dados) => {
  const nome = primeiroNome(nomeBruto);
  const alvo = templatePorNome(preferido) || templatePorNome(TEMPLATE_COM_NOME);
  if(alvo && !alvo.precisaNome) return { template: alvo.nome, nome: null };
  if(!nome) return { template: TEMPLATE_SEM_NOME, nome: null };
  const cidade = valorDeVariavel(dados && dados.cidade);
  const segmento = valorDeVariavel(dados && dados.segmento);
  // So usa o de tres variaveis se a Meta disser que ele existe (a lista
  // viva vem de /api/whatsapp/templates). Template nao aprovado volta
  // 132001, e chutar que existe quebraria a abordagem de todo lead com
  // cidade e segmento. O servidor faz a mesma coisa por env — fontes de
  // prova diferentes, mesma regra: so uso se me disserem que existe.
  const temCidade = !!templatePorNome(TEMPLATE_COM_CIDADE);
  if(!preferido && temCidade && cidade && segmento){
    return {
      template: TEMPLATE_COM_CIDADE,
      nome,
      components: [{ type:'body', parameters:[
        { type:'text', text: nome },
        { type:'text', text: cidade },
        { type:'text', text: segmento },
      ] }],
    };
  }
  return {
    template: (alvo && alvo.nome) || TEMPLATE_COM_NOME,
    nome,
    components: [{ type:'body', parameters:[{ type:'text', text: nome }] }],
  };
};

// Numero dos EUA? (DDI 1, 11 digitos: 1 + area + numero)
// A Meta NAO entrega template de categoria MARKETING pra numero dos EUA —
// o envio e ACEITO e o status volta `failed` (131049). Foi o caso de 5
// disparos em 2026-09-05 que "sumiram": o portal registrou tudo certo e o
// cliente nunca recebeu. Sem este aviso, o operador repete o disparo
// achando que foi falha de rede.
//
// "11 digitos comecando com 1" NAO basta: `11987654321` (celular de SP sem
// DDI) tem exatamente essa forma. O desempate e a regra do NANP — codigo de
// area dos EUA/Canada NUNCA comeca com 0 nem com 1. Entao o digito seguinte
// ao '1' resolve: `1`+`650`... e EUA; `1`+`198`... nao existe, e o 11 de SP.
//
// Na pratica o `wa_id` do banco ja vem normalizado com DDI (BR = 55...),
// mas a funcao tambem recebe numero digitado na tela, onde a forma sem DDI
// aparece.
const ehNumeroEUA = (waId) => {
  const d = String(waId || '').replace(/\D/g, '');
  if(d.length !== 11 || d[0] !== '1') return false;
  return d[1] >= '2' && d[1] <= '9';
};

// Marketing pra numero dos EUA = nao vai chegar. Devolve o aviso ou null.
const avisoMarketingEUA = (waId, categoria) => {
  if(!ehNumeroEUA(waId)) return null;
  if(String(categoria || '').toUpperCase() !== 'MARKETING') return null;
  return 'A Meta não entrega templates de marketing para números dos EUA; ' +
    'use um Utility ou texto livre na janela.';
};

// O `body` de uma mensagem de template guarda o REGISTRO
// (`[template calicolors_nome] {{1}}=Bianca`), nao o texto que a pessoa
// recebeu — quem tem o texto e a Meta. Sem esta funcao a bolha mostrava o
// registro cru na tela, que e exatamente o que ela existia pra evitar.
//
// Aceita 1..N parametros: `{{1}}=Ana {{2}}=1042`. Com template de duas
// variaveis, ler so a primeira esconderia metade do que foi enviado.
const parseRegistroTemplate = (body) => {
  const m = /^\[template ([a-z0-9_]+)\]\s*(.*)$/i.exec(String(body || '').trim());
  if(!m) return null;
  const params = {};
  for(const g of String(m[2] || '').matchAll(/\{\{(\d+)\}\}=([^{]*)/g)){
    params[Number(g[1])] = String(g[2]).trim();
  }
  return { template: m[1], params, param: params[1] || null };
};

// O que gravamos no historico quando o que sai e template. A Meta guarda o
// texto; nos guardamos NOME + PARAMETRO, pra conversa nao virar "[template]"
// seco e pra dar pra auditar depois o que foi enviado a quem.
const registroDeTemplate = (escolha) =>
  escolha.nome
    ? '[template ' + escolha.template + '] {{1}}=' + escolha.nome
    : '[template ' + escolha.template + ']';

// Modelo que o seletor abre marcado. Decisao do usuario (2026-09-08):
// "abordagem v2 como padrao inicial" — o de 3 variaveis (nome, cidade,
// ramo) e o que menos parece disparo em massa. Mas so quando a lista diz
// que ele existe (a viva, vinda da Meta): a embutida nao o tem de
// proposito, porque template nao aprovado volta 132001. Sem ele, o de
// nome; sem esse, o primeiro que houver.
const templateInicial = (lista) => {
  const nomes = (lista || []).map(t => t && t.nome);
  if(nomes.includes(TEMPLATE_COM_CIDADE)) return TEMPLATE_COM_CIDADE;
  if(nomes.includes(TEMPLATE_COM_NOME)) return TEMPLATE_COM_NOME;
  return nomes[0] || TEMPLATE_COM_NOME;
};

// Monta o corpo do POST a partir do template e dos valores das variaveis.
// Compartilhado pelo envio unitario e pelo LOTE (2026-09-08): a mesma
// conta, senao um dos dois gravaria registro diferente no historico.
const pacoteDeTemplate = (tpl, vars, valores) => {
  const params = (vars || []).slice().sort((a,b) => a.indice - b.indice)
    .map(v => String(valores[v.indice] == null ? '' : valores[v.indice]).trim());
  // Registro com TODOS os parametros, na ordem — com 2 variaveis, guardar
  // so a primeira esconderia metade do que foi enviado.
  const detalhe = params.map((v, i) => '{{' + (i+1) + '}}=' + v).join(' ');
  return {
    template: tpl.nome,
    idioma: tpl.idioma || TEMPLATE_IDIOMA,
    components: params.length
      ? [{ type:'body', parameters: params.map(text => ({ type:'text', text })) }]
      : undefined,
    registro: '[template ' + tpl.nome + ']' + (detalhe ? ' ' + detalhe : ''),
  };
};

// [teste:template-fim]

// Texto pra MOSTRAR na tela (previa antes de enviar, e bolha depois).
// Devolve null quando nao ha espelho: a tela entao diz onde o texto vive,
// em vez de inventar um que nao e o que a pessoa recebe.
const textoDoTemplate = (nomeTemplate, nomePessoa) => {
  const t = templatePorNome(nomeTemplate);
  if(!t || !t.texto) return null;
  return t.texto.replace(/\{\{1\}\}/g, primeiroNome(nomePessoa) || '');
};

// Quebra o corpo do template em pedacos pra previa: texto solto, variavel
// PREENCHIDA (mostra o valor) e variavel VAZIA.
//
// Por que existe: a previa antiga fazia um replace e, quando a variavel
// estava vazia, deixava o `{{2}}` CRU na tela. Chave dupla nao e conteudo —
// e notacao da Meta, e o operador nao tem por que aprender. Agora o buraco
// aparece como buraco (chip tracejado com o exemplo do painel), e o que
// esta preenchido aparece destacado, pra dar pra conferir num relance qual
// campo caiu em qual lugar da frase.
// [teste:previa-inicio] — extraido por __tests__/portalJanela24h.test.ts.
// So JS puro entre este marcador e o de fim (JSX aqui quebra o `new
// Function` e o arquivo de teste inteiro vira "skipped", que e verde na
// contagem — foi o que aconteceu em 2026-09-05).
const segmentosDoTemplate = (texto, valores, vars) => {
  if(!texto) return null;
  const exemploDe = (n) => {
    const v = (vars || []).find(x => x.indice === n);
    return (v && v.exemplo) ? String(v.exemplo) : null;
  };
  const partes = [];
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let ultimo = 0, m;
  while((m = re.exec(texto)) !== null){
    if(m.index > ultimo) partes.push({ tipo:'texto', valor: texto.slice(ultimo, m.index) });
    const n = Number(m[1]);
    const preenchido = String((valores && valores[n]) || '').trim();
    if(preenchido){
      partes.push({ tipo:'valor', indice:n, valor: preenchido });
    } else {
      const ex = exemploDe(n);
      partes.push({ tipo:'vazio', indice:n, valor: ex ? 'ex.: ' + ex : 'variável ' + n });
    }
    ultimo = m.index + m[0].length;
  }
  if(ultimo < texto.length) partes.push({ tipo:'texto', valor: texto.slice(ultimo) });
  return partes;
};

// Rotulos de coisa que a pessoa VE mas que nao e texto: cabecalho de midia
// e botao. Sem isso a previa mentia por omissao — um template com botao
// aparecia como mensagem seca, e ninguem sabia que havia botao ate o
// cliente responder por ele.
const ROTULO_MIDIA = {
  IMAGE: '🖼️ Imagem no topo',
  VIDEO: '🎬 Vídeo no topo',
  DOCUMENT: '📄 Documento no topo',
  LOCATION: '📍 Localização no topo',
};
const ICONE_BOTAO = { QUICK_REPLY:'↩', URL:'↗', PHONE_NUMBER:'📞', COPY_CODE:'⧉' };

// Nome do template como a Meta guarda (`calicolors_orcamento_pronto`) vira
// frase legivel pro seletor. O nome CRU continua a vista embaixo do botao —
// e ele que tem que bater com o painel quando o envio falhar com 132001 —,
// mas ler `calicolors_orcamento_pronto` numa lista de dez e pior.
//
// O rotulo sai SEM ACENTO porque o nome na Meta e ASCII, e restaurar acento
// exigiria um dicionario escrito a mao: a mesma doenca da lista de
// templates que a rota /api/whatsapp/templates veio matar.
const rotuloDeTemplate = (t) => {
  if(t && t.rotulo && t.rotulo !== t.nome) return t.rotulo;
  const cru = String((t && t.nome) || '').replace(/^calicolors_/, '').replace(/_/g, ' ').trim();
  if(!cru) return (t && t.nome) || '—';
  return cru.charAt(0).toUpperCase() + cru.slice(1);
};

const CATEGORIA_ROTULO = {
  MARKETING: 'Marketing', UTILITY: 'Utility', AUTHENTICATION: 'Autenticação',
};

// [teste:previa-fim]

// Carrega a lista viva de templates uma vez por sessao do portal. Falha e
// SILENCIOSA de proposito: a lista embutida cobre, e um alerta vermelho
// sobre "nao consegui listar templates" assustaria sem dar o que fazer. O
// motivo real vai pro console e pro log do Cloudflare.
let _templatesPromise = null;
// Por que o erro e guardado em vez de so logado: quando a consulta falha, a
// tela cai na lista embutida — que tem DOIS templates e um deles sem texto
// espelhado. Do lado de fora isso parece "o portal nao mostra o modelo", e
// ninguem descobre que o motivo foi a Meta nao responder. Agora a tela diz,
// e oferece tentar de novo.
let _templatesErro = null;
const carregarTemplates = async () => {
  if(_templatesPromise) return _templatesPromise;
  _templatesPromise = (async () => {
    try {
      const { data: { session } } = await supa.auth.getSession();
      if(!session) return null;
      // GET com o token no header: a rota cacheia por 5min do lado do
      // servidor, entao abrir a tela varias vezes nao bate na Meta toda vez.
      const r = await fetch('/api/whatsapp/templates', {
        headers:{ Authorization: 'Bearer ' + session.access_token }
      });
      const res = await r.json().catch(() => ({}));
      if(!r.ok || !res.ok || !Array.isArray(res.templates)) {
        _templatesErro = res.error || ('HTTP ' + r.status);
        console.warn('[templates] usando a lista embutida:', _templatesErro);
        return null;
      }
      // Normaliza pro formato que a tela usa. `texto` vem da Meta, entao
      // aqui o espelho deixa de ser copia manual — e o que a pessoa recebe.
      _templatesErro = null;
      _templatesVivos = res.templates.map(t => ({
        nome: t.nome,
        rotulo: t.nome,
        categoria: t.categoria,
        idioma: t.idioma,
        titulo: t.cabecalho || null,
        // `formatoCabecalho`/`rodape`/`botoes` chegavam da rota e eram
        // JOGADOS FORA aqui — por isso a previa mostrava so o corpo, e
        // template com rodape ou botao aparecia pela metade na tela.
        formatoCabecalho: t.formatoCabecalho || null,
        rodape: t.rodape || null,
        botoes: Array.isArray(t.botoes) ? t.botoes : [],
        texto: t.corpo || null,
        variaveis: Array.isArray(t.variaveis) ? t.variaveis : [],
        precisaNome: Array.isArray(t.variaveis) && t.variaveis.length > 0,
        // De onde saiu o texto da previa. O da Meta e o que a pessoa
        // recebe; o embutido e copia nossa e pode ter envelhecido — a tela
        // marca a diferenca em vez de apresentar os dois como iguais.
        fonte: 'meta',
      }));
      return _templatesVivos;
    } catch(e) {
      _templatesErro = (e && e.message) || 'falha de rede';
      console.warn('[templates] usando a lista embutida:', _templatesErro);
      return null;
    }
  })();
  return _templatesPromise;
};

// Descarta o cache do portal e busca de novo. A rota tem cache proprio de
// 5min, entao isto reconsulta a NOSSA copia — suficiente pro caso comum (a
// primeira carga pegou a sessao antes do token existir).
const recarregarTemplates = () => { _templatesPromise = null; return carregarTemplates(); };

// ── Previa do template: a bolha como a pessoa VE ────────────────────────
// Antes isto era um bloco bege com o texto corrido dentro. Tres problemas,
// e os tres foram relatados de uma vez:
//
//  1. Nao parecia mensagem. O operador estava conferindo o que o cliente
//     vai receber no WhatsApp, e a tela mostrava um paragrafo num quadro.
//  2. Nao mostrava o template inteiro. Rodape e botoes vinham da rota e
//     eram descartados no meio do caminho, entao template com botao
//     aparecia como mensagem seca — e ninguem descobria que havia botao
//     ate o cliente responder por ele.
//  3. Mostrava `{{2}}` cru quando a variavel estava vazia. Chave dupla e
//     notacao da Meta, nao conteudo; quem opera nao tem por que aprender.
//
// Agora e uma bolha sobre fundo de conversa, com cabecalho, corpo, rodape,
// botoes e horario — e o buraco de variavel aparece como buraco.
const PreviaDeTemplate = ({ tpl, valores }) => {
  if(!tpl) return null;

  const vars = tpl.variaveis || [];
  const partes = segmentosDoTemplate(tpl.texto, valores, vars);
  const botoes = tpl.botoes || [];
  const midia = tpl.formatoCabecalho && tpl.formatoCabecalho !== 'TEXT'
    ? (ROTULO_MIDIA[tpl.formatoCabecalho] || ('📎 ' + tpl.formatoCabecalho + ' no topo'))
    : null;

  const agora = new Date();
  const hora = String(agora.getHours()).padStart(2,'0') + ':' + String(agora.getMinutes()).padStart(2,'0');

  return (
    <div style={{ background:'#e6ddd1', borderRadius:12, padding:'14px 12px', border:'1px solid '+C.border }}>
      <div style={{ background:'#fff', borderRadius:'12px 12px 12px 4px', maxWidth:460,
        boxShadow:'0 1px 2px rgba(0,0,0,.12)', overflow:'hidden' }}>
        <div style={{ padding:'9px 11px 6px' }}>
          {midia ? (
            <div style={{ background:'#f0ebe3', borderRadius:8, padding:'14px 10px', marginBottom:7,
              fontSize:12, color:C.muted, textAlign:'center', fontWeight:600 }}>
              {midia}
            </div>
          ) : null}

          {tpl.titulo ? (
            <div style={{ fontSize:13.5, fontWeight:800, color:C.ink, marginBottom:5, lineHeight:1.35 }}>
              {tpl.titulo}
            </div>
          ) : null}

          {partes ? (
            <div style={{ fontSize:13.5, lineHeight:1.55, color:'#111b21', whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
              {partes.map((seg, i) => (
                seg.tipo === 'texto' ? <span key={i}>{seg.valor}</span>
                : seg.tipo === 'valor' ? (
                  /* Preenchido: destacado pra dar pra conferir num relance
                     qual campo caiu em qual lugar da frase. */
                  <span key={i} title={'variável ' + seg.indice}
                    style={{ background:'rgba(255,107,53,.16)', borderRadius:4, padding:'0 3px', fontWeight:600 }}>
                    {seg.valor}
                  </span>
                ) : (
                  /* Vazio: buraco com cara de buraco, nunca `{{2}}` cru. */
                  <span key={i} title={'falta preencher a variável ' + seg.indice}
                    style={{ border:'1px dashed #c9a08a', borderRadius:4, padding:'0 5px',
                      color:'#a8654a', fontStyle:'italic', fontSize:12.5, background:'#fff6f2' }}>
                    {seg.valor}
                  </span>
                )
              ))}
            </div>
          ) : (
            /* Sem espelho do texto. Nao inventamos um: mostrar algo
               diferente do que a pessoa recebe e pior do que assumir que
               nao sabemos. Quem sabe e a Meta. */
            <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.5, fontStyle:'italic' }}>
              O texto deste template está cadastrado na Meta e não veio na
              consulta — quem o guarda é o painel do Dualhook, em Templates →{' '}
              <strong style={{ color:C.ink, fontStyle:'normal' }}>{tpl.nome}</strong>.
            </div>
          )}

          {tpl.rodape ? (
            <div style={{ fontSize:11.5, color:'#8696a0', marginTop:6, lineHeight:1.4 }}>{tpl.rodape}</div>
          ) : null}

          <div style={{ fontSize:10.5, color:'#8696a0', textAlign:'right', marginTop:3 }}>{hora}</div>
        </div>

        {botoes.length ? (
          <div style={{ borderTop:'1px solid #e9edef' }}>
            {botoes.map((b, i) => (
              <div key={i} style={{ padding:'6px 8px', textAlign:'center', fontSize:12.5, fontWeight:600,
                color:'#0a7cbd', borderTop: i ? '1px solid #e9edef' : 'none' }}>
                <span style={{ marginRight:6, opacity:.8 }}>{ICONE_BOTAO[b.tipo] || '•'}</span>
                {b.texto}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ fontSize:10.5, color:'#7d7565', marginTop:8, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
        {tpl.fonte === 'meta'
          ? <span>✓ texto lido da Meta agora — é exatamente o que a pessoa recebe</span>
          : <span>⚠️ espelho local: o texto de verdade vive na Meta e pode ter mudado</span>}
      </div>
    </div>
  );
};

// ── Envio de template, com um campo por variavel ────────────────────────
// Usado na tela de WhatsApp e na abordagem de lead — a mesma decisao nos
// dois lugares, pra um nao divergir do outro.
//
// Regra que nao pode ser burlada pela tela: variavel VAZIA nao envia. Um
// {{1}} vazio faz a Meta entregar "Oi ," ou recusar; o botao fica
// desabilitado com o motivo a vista, em vez de deixar mandar e falhar.
//
// `dadosContato` = { cidade, segmento } de quem recebe, quando a tela sabe
// (lead da lista, ou conversa cujo numero casa com um lead). Preenche
// {{2}} e {{3}} — a convencao dos templates de abordagem e {{1}} nome,
// {{2}} cidade, {{3}} segmento (decisao de 2026-09-07). Os campos seguem
// editaveis: o operador corrige o que a base trouxe errado antes de enviar.
// Estado da LISTA de templates, compartilhado pelo envio unitario e pelo
// lote (2026-09-08). Um so lugar decide o modelo inicial e a troca pela
// lista viva — dois componentes com copias disso divergiriam.
const useListaDeTemplates = () => {
  const [lista, setLista] = useState(templatesDisponiveis());
  const [escolhido, setEscolhidoBruto] = useState(() => templateInicial(templatesDisponiveis()));
  // O operador mexeu no seletor? Enquanto nao, a lista viva que chega da
  // Meta pode trocar o modelo inicial (a embutida nao tem o v2; a viva tem).
  // Depois que ele escolheu, a chegada da lista nao desfaz a escolha.
  const tocado = React.useRef(false);
  // Falha ao listar na Meta. Deixou de ser silenciosa porque, de fora, ela
  // se parecia com "o portal nao mostra o modelo desse template".
  const [erroLista, setErroLista] = useState(null);
  const [recarregando, setRecarregando] = useState(false);

  const aplicar = (t) => {
    if(t){ setLista(t); setErroLista(null); if(!tocado.current) setEscolhidoBruto(templateInicial(t)); }
    else setErroLista(_templatesErro || 'não consegui falar com a Meta');
  };

  useEffect(() => {
    let vivo = true;
    carregarTemplates().then(t => { if(vivo) aplicar(t); });
    return () => { vivo = false; };
  }, []);

  const tentarDeNovo = async () => {
    setRecarregando(true);
    try { aplicar(await recarregarTemplates()); }
    finally { setRecarregando(false); }
  };

  const escolher = (nome) => { tocado.current = true; setEscolhidoBruto(nome); };
  const tpl = lista.find(t => t.nome === escolhido) || lista[0] || null;
  return { lista, tpl, escolher, erroLista, recarregando, tentarDeNovo };
};

// Seletor: rotulo legivel na frente, agrupado por categoria. Marketing e
// Utility nao sao a mesma coisa pra quem opera — Utility passa pra numero
// dos EUA e e mais barato; Marketing e o que some sem avisar.
const SeletorDeTemplate = ({ lista, tpl, onEscolher }) => {
  const grupos = [];
  for(const t of lista){
    const cat = String(t.categoria || 'OUTROS').toUpperCase();
    let g = grupos.find(x => x.cat === cat);
    if(!g){ g = { cat, itens: [] }; grupos.push(g); }
    g.itens.push(t);
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
      <label style={{ fontSize:12, fontWeight:700, color:C.ink }}>Modelo:</label>
      <select value={tpl ? tpl.nome : ''} onChange={e=>onEscolher(e.target.value)}
        style={{ flex:'1 1 240px', padding:'8px 10px', borderRadius:10, fontSize:13,
          border:'1.5px solid '+C.border, background:'#fff', color:C.ink, outline:'none', cursor:'pointer' }}>
        {grupos.map(g => (
          <optgroup key={g.cat} label={CATEGORIA_ROTULO[g.cat] || g.cat}>
            {g.itens.map(t => (
              <option key={t.nome} value={t.nome}>
                {rotuloDeTemplate(t)}
                {t.variaveis && t.variaveis.length
                  ? ' · ' + t.variaveis.length + (t.variaveis.length > 1 ? ' campos' : ' campo')
                  : ' · texto fixo'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
};

// Este aviso E a resposta pra "esse template nao mostra o modelo": quando a
// Meta nao responde, sobra a lista embutida, que tem dois itens e um deles
// sem texto. Sem esta linha, o sintoma parecia bug da tela.
const AvisoListaEmbutida = ({ erroLista, recarregando, tentarDeNovo }) => erroLista ? (
  <div style={{ marginBottom:10, padding:'8px 11px', background:'#fff7ed', border:'1px solid #f0c98a',
    borderRadius:10, fontSize:11.5, color:'#8a5300', lineHeight:1.5,
    display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
    <span style={{ flex:1, minWidth:200 }}>
      Não consegui buscar os modelos na Meta ({erroLista}); mostrando a lista embutida,
      que pode estar incompleta.
    </span>
    <button onClick={tentarDeNovo} disabled={recarregando}
      style={{ background:'#fff', border:'1px solid #f0c98a', borderRadius:8, padding:'5px 12px',
        fontSize:11.5, fontWeight:700, color:'#8a5300', cursor: recarregando ? 'wait' : 'pointer' }}>
      {recarregando ? 'Buscando…' : '↻ Tentar de novo'}
    </button>
  </div>
) : null;

const EnvioDeTemplate = ({ waId, nomeContato, dadosContato, enviando, estagio, onEnviar }) => {
  const { lista, tpl, escolher, erroLista, recarregando, tentarDeNovo } = useListaDeTemplates();
  const [valores, setValores] = useState({});
  // Confirmacao do aviso de marketing pra EUA (ver `enviar`).
  const [confirmado, setConfirmado] = useState(false);

  const escolhido = tpl ? tpl.nome : '';
  const vars = (tpl && tpl.variaveis) || (tpl && tpl.precisaNome ? [{ indice:1, exemplo:null }] : []);

  // As variaveis ja vem preenchidas com o que a tela sabe — digitar de novo
  // o que esta na linha do lead e trabalho a toa, e era o que acontecia
  // com {{2}} e {{3}}: o operador via "Pimentas"/"pintura residencial" de
  // placeholder e tinha que copiar a cidade da tabela a mao.
  //   {{1}} nome completo · {{2}} cidade · {{3}} segmento
  // Passa pelo `valorDeVariavel`: "n/a" da base importada nao entra no
  // campo como se fosse cidade. Sem dado, o campo fica vazio e o botao trava.
  const cidade = valorDeVariavel(dadosContato && dadosContato.cidade) || '';
  const segmento = valorDeVariavel(dadosContato && dadosContato.segmento) || '';
  useEffect(() => {
    if(!tpl) return;
    setValores(v => {
      const novo = { ...v };
      for(const va of vars){
        if(novo[va.indice] == null){
          novo[va.indice] = va.indice === 1 ? (nomeCompleto(nomeContato) || '')
            : va.indice === 2 ? cidade
            : va.indice === 3 ? segmento
            : '';
        }
      }
      return novo;
    });
  }, [escolhido, nomeContato, cidade, segmento]);

  const faltando = vars.filter(v => !String(valores[v.indice] || '').trim());
  const aviso = tpl ? avisoMarketingEUA(waId, tpl.categoria) : null;

  const trocar = (nome) => { escolher(nome); setValores({}); setConfirmado(false); };

  const enviar = () => {
    if(!tpl || faltando.length) return;
    // O aviso de marketing pra EUA NAO bloqueia: a Meta pode mudar a regra,
    // e o operador pode ter motivo. Mas exige confirmacao — mandar sem ver
    // o aviso e o que fez 5 disparos sumirem sem ninguem entender.
    if(aviso && !confirmado){ setConfirmado(true); return; }
    onEnviar(pacoteDeTemplate(tpl, vars, valores));
  };

  // DUAS COLUNAS (2026-09-08): em coluna unica a previa do v2 (texto + 4
  // botoes) empurrava o botao de enviar pra baixo da dobra; lado a lado,
  // tudo cabe. ESPELHADO em 2026-09-09 (pedido do usuario): previa a
  // ESQUERDA, campos + Enviar a DIREITA — o botao fica do lado do Cancelar
  // do rodape. E `row-reverse`, nao troca de ordem no DOM, de proposito:
  // os campos seguem primeiro pro Tab, e em tela estreita o wrap continua
  // empilhando campos EM CIMA da previa (senao a previa voltaria a empurrar
  // o Enviar pra baixo da dobra — o problema de 08/09 de volta).
  return (
    <div style={{ display:'flex', flexDirection:'row-reverse', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
      <div style={{ flex:'1 1 300px', minWidth:0 }}>
        <SeletorDeTemplate lista={lista} tpl={tpl} onEscolher={trocar} />
        <AvisoListaEmbutida erroLista={erroLista} recarregando={recarregando} tentarDeNovo={tentarDeNovo} />

        {aviso ? (
          <div style={{ marginBottom:10, padding:'9px 12px', background:'#fff4e5', border:'1px solid #f0c98a',
            borderRadius:10, fontSize:12, color:'#8a5300', lineHeight:1.5 }}>
            ⚠️ {aviso}
            {confirmado ? (
              <div style={{ marginTop:6, fontWeight:700 }}>
                Toque em “Enviar mesmo assim” pra mandar apesar do aviso.
              </div>
            ) : null}
          </div>
        ) : null}

        {vars.length ? (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:10 }}>
            {vars.map(v => {
              const preenchido = !!String(valores[v.indice]||'').trim();
              return (
                <div key={v.indice} style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {/* Numero num circulo, nao `{{1}}`: a chave dupla e notacao
                      da Meta e nao ajuda quem esta preenchendo. O circulo usa
                      a MESMA cor do destaque na previa, entao da pra ligar o
                      campo ao lugar da frase sem contar posicao. */}
                  <span title={'variável ' + v.indice}
                    style={{ width:22, height:22, flex:'0 0 22px', borderRadius:'50%',
                      background: preenchido ? 'rgba(255,107,53,.16)' : '#f1ece5',
                      color: preenchido ? '#b8431a' : C.muted,
                      fontSize:11.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {v.indice}
                  </span>
                  <input value={valores[v.indice] || ''}
                    onChange={e=>setValores(x => ({ ...x, [v.indice]: e.target.value }))}
                    placeholder={v.exemplo ? 'ex.: ' + v.exemplo : 'valor do campo ' + v.indice}
                    style={{ flex:1, minWidth:0, padding:'8px 10px', borderRadius:10, fontSize:13, outline:'none',
                      border:'1.5px solid '+(preenchido ? C.border : '#e0a0a0') }} />
                </div>
              );
            })}
          </div>
        ) : null}

        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <button onClick={enviar} disabled={enviando || !tpl || faltando.length > 0}
            title={faltando.length ? 'Preencha todos os campos do modelo.' : ''}
            style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'9px 18px',
              fontSize:13, fontWeight:700,
              cursor: (enviando || faltando.length) ? 'not-allowed' : 'pointer',
              opacity: (enviando || faltando.length) ? .5 : 1 }}>
            {enviando ? (estagio || 'Enviando…')
              : (aviso && confirmado ? '📤 Enviar mesmo assim' : '📤 Enviar')}
          </button>
          <span style={{ fontSize:11, color:C.muted }}>
            {/* O nome CRU fica aqui, e nao no seletor: e ele que tem que bater
                com o painel da Meta quando o envio falhar com 132001. */}
            {tpl ? <code style={{ background:'#efeae1', padding:'1px 5px', borderRadius:4 }}>{tpl.nome}</code> : null}
            {tpl && tpl.idioma ? ' · ' + tpl.idioma : ''}
            {faltando.length
              ? ' · falta preencher ' + (faltando.length > 1 ? 'os campos ' : 'o campo ') +
                faltando.map(v => v.indice).join(', ')
              : ''}
          </span>
        </div>
      </div>
      <div style={{ flex:'1 1 300px', minWidth:0 }}>
        <PreviaDeTemplate tpl={tpl} valores={valores} />
      </div>
    </div>
  );
};

// ── Abordagem: o que a Meta confirmou, gravado no LEAD (2026-09-09) ──────
// INCIDENTE: uma leva de abordagens saiu, a API aceitou todas, o portal
// marcou cada lead como `contactado` — e minutos depois a Meta devolveu
// `failed` 131026 (Message undeliverable) pra boa parte. A tela de Leads
// dizia "contactado" pra quem nunca recebeu nada.
//
// "A API aceitou" e "a mensagem chegou" sao momentos diferentes. A
// confirmacao de verdade e o aviso de status do webhook (sent/delivered/
// read/failed), que chega DEPOIS — e quem escreve `contactado` agora e o
// SERVIDOR, quando esse aviso chega (persistStatusDoLead). O portal so
// manda o `leadId` pra rota amarrar o wamid ao lead, e mostra o que o lead
// carrega: abordagem_status ('accepted' | 'sent' | 'delivered' | 'read' |
// 'failed'), abordagem_error e abordagem_at.
//
// [teste:abordagem-inicio]
const ABORDAGEM_ROTULOS = {
  accepted:  { rotulo:'⏳ aguardando confirmação', cor:'#b8860b', titulo:'A API aceitou a mensagem; a Meta ainda não confirmou o envio. Se ficar assim por muito tempo, o aviso pode ter se perdido — confira a conversa.' },
  sent:      { rotulo:'✓ enviada',   cor:'#2e7d32', titulo:'A Meta confirmou o envio (ainda não entregue no aparelho).' },
  delivered: { rotulo:'✓✓ entregue', cor:'#2e7d32', titulo:'Entregue no aparelho da pessoa.' },
  read:      { rotulo:'✓✓ lida',     cor:'#1565c0', titulo:'A pessoa abriu a mensagem.' },
  failed:    { rotulo:'⚠ não entregue', cor:'#b3261e', titulo:'A Meta não conseguiu entregar. O motivo está ao lado.' },
};
// Grupos do filtro "Entrega" da tela de Leads. Uma chave por resposta que a
// loja quer: "quem deu erro?", "quem recebeu?", "quem esta pendurado?".
const ABORDAGEM_GRUPOS = {
  Todas:        () => true,
  falhou:       (l) => l.abordagem_status === 'failed',
  entregue:     (l) => l.abordagem_status === 'delivered' || l.abordagem_status === 'read',
  enviada:      (l) => l.abordagem_status === 'sent' || l.abordagem_status === 'delivered' || l.abordagem_status === 'read',
  aguardando:   (l) => l.abordagem_status === 'accepted',
  semAbordagem: (l) => !l.abordagem_status,
};
const ABORDAGEM_GRUPO_ROTULOS = {
  Todas:'Qualquer entrega', falhou:'⚠ Não entregue', entregue:'✓✓ Entregue/lida',
  enviada:'✓ Enviada (ou melhor)', aguardando:'⏳ Aguardando confirmação', semAbordagem:'Sem abordagem',
};
// Descreve a abordagem de um lead pra tela: null quando nunca foi abordado
// (ou o SQL ainda nao rodou — a coluna nem vem). O erro da Meta entra
// resumido (codigo · titulo) na propria linha, porque e a unica informacao
// acionavel; o texto inteiro fica no title.
const descreverAbordagem = (l) => {
  const st = l && l.abordagem_status;
  const base = ABORDAGEM_ROTULOS[st];
  if(!base) return null;
  const erro = st === 'failed' ? String(l.abordagem_error || '').trim() : '';
  // "131026 · Message undeliverable · Message Undeliverable." -> so as
  // duas primeiras partes; a terceira costuma repetir a segunda.
  const partes = erro.split(' · ').map(x => x.trim()).filter(Boolean);
  const resumo = partes.length > 1 && partes[1].toLowerCase() === (partes[2]||'').replace(/\.$/,'').toLowerCase()
    ? partes.slice(0,2).join(' · ') : partes.slice(0,3).join(' · ');
  let quando = '';
  if(l.abordagem_at){ const d = new Date(l.abordagem_at); if(!isNaN(d)) quando = d.toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
  return {
    status: st, rotulo: base.rotulo, cor: base.cor,
    erro: resumo || (st === 'failed' ? 'a Meta não detalhou' : ''),
    titulo: base.titulo + (erro ? '\n' + erro : '') + (quando ? '\n' + quando : ''),
    quando,
  };
};
// Aceito ha pouco e sem confirmacao = a tela ainda pode mudar sozinha;
// e o que decide se a lista de Leads fica se atualizando.
const ABORDAGEM_JANELA_PENDENTE_MS = 15 * 60 * 1000;
const abordagemPendente = (l, agora) => {
  if(!l || l.abordagem_status !== 'accepted' || !l.abordagem_at) return false;
  const t = new Date(l.abordagem_at).getTime();
  return !isNaN(t) && (agora - t) < ABORDAGEM_JANELA_PENDENTE_MS;
};
// [teste:abordagem-fim]

const AbordagemBadge = ({ lead }) => {
  const d = descreverAbordagem(lead);
  if(!d) return null;
  return (
    <div title={d.titulo} style={{ fontSize:10.5, marginTop:4, color:d.cor, lineHeight:1.3, maxWidth:150 }}>
      <span style={{ fontWeight:700, whiteSpace:'nowrap' }}>{d.rotulo}</span>
      {d.erro ? <div style={{ color:d.cor, opacity:.9, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{d.erro}</div> : null}
    </div>
  );
};

// Envio de UM template pelo numero da loja. Compartilhado pelo modal
// unitario e pelo lote — devolve { ok:true, messageId } ou { ok:false,
// erro }, nunca lanca.
//
// NAO marca o lead como contactado (2026-09-09). Marcava — e foi o
// incidente: "a API aceitou" virava "contactado" na tela, e o `failed`
// que a Meta manda depois nao desfazia nada. Agora a rota recebe o
// `leadId`, amarra o wamid ao lead, e o webhook decide o funil quando a
// confirmacao chega. O que o portal grava sozinho e so a RECUSA da API
// (401/422/400…): ai nao existe wamid nem webhook, e o lead precisa mostrar
// que a tentativa falhou.
const enviarTemplateDaLoja = async ({ alvo, pacote, leadId }) => {
  let session = null;
  try { ({ data: { session } } = await supa.auth.getSession()); } catch(_){}
  if(!session) return { ok:false, erro:'Sessao expirada — entre de novo.' };
  let r;
  try {
    // No template o `body` NAO e o que a Meta envia (o texto dela vive
    // la): e o registro pro historico do portal, pra conversa nao virar um
    // "[template]" seco. Ver persistWhatsAppMessage na rota.
    r = await fetch('/api/whatsapp/send', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        accessToken: session.access_token,
        to: alvo, type:'template', template: pacote.template,
        languageCode: pacote.idioma, components: pacote.components,
        body: pacote.registro, leadId: leadId || undefined,
      })
    });
  } catch(_){ return { ok:false, erro:'Falha de rede ao enviar.' }; }
  let raw = ''; try { raw = await r.text(); } catch(_){}
  let res = {}; try { res = JSON.parse(raw); } catch(_){}
  if(!r.ok || !res.ok){
    const snippet = res.error ? '' : (raw||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
    const erro = res.error || ('Falha no envio (HTTP ' + r.status + (snippet ? ' — ' + snippet : '') + ')');
    if(leadId){
      // Recusa da API: fica registrada no lead, com o motivo. Best-effort
      // e tolerante a coluna ausente — o erro que importa e o do envio.
      try {
        await supa.from('leads').update({ abordagem_status:'failed', abordagem_error: String(erro).slice(0,300), abordagem_at: new Date().toISOString(), abordagem_message_id: null }).eq('id', leadId);
      } catch(_){}
    }
    return { ok:false, erro };
  }
  return { ok:true, messageId: res.messageId || null };
};


// ── Nova conversa: modal do portal, no lugar do prompt() do navegador ───
// O `prompt()` e uma caixa do CHROME: aparece fora do desenho do portal,
// nao mostra contato nenhum, nao valida enquanto a pessoa digita e nao tem
// onde guardar o nome — e o nome importa, porque e ele que vai no {{1}} do
// template.
//
// Este modal resolve as tres coisas: busca entre quem a loja JA conhece
// (leads + perfis do app), aceita numero novo com validacao a vista, e
// salva o contato pra proxima.
//
// Onde o contato novo e salvo: na tabela `leads`, com source='portal'. Nao
// criamos tabela nova de proposito — `leads` ja e a lista de gente com
// nome+telefone que o portal consulta em todo lugar (a propria tela de
// WhatsApp resolve nome por ali). Tabela separada significaria SQL novo e
// duas listas de contato pra manter em sincronia.
const NovaConversaModal = ({ onClose, onAbrir }) => {
  const [busca, setBusca] = useState('');
  const [numero, setNumero] = useState('');
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [contatos, setContatos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  // A BUSCA VAI AO BANCO, nao filtra uma lista pre-carregada.
  //
  // A 1a versao trazia 500 leads + 500 perfis e filtrava em memoria. Com
  // 1072 leads isso nao era so "mostrar menos": quem estava fora dos
  // primeiros 500 ficava INVISIVEL pra busca — digitar o nome dele nao
  // achava nada, e a tela nao dava pista de que faltava gente. Lista
  // truncada que se parece com lista completa e pior do que lista vazia.
  //
  // Agora: sem termo, traz as primeiras por nome (so pra ter o que
  // navegar); com termo, consulta o banco com ilike em nome E telefone.
  const [total, setTotal] = useState(null);
  // Letra do indice A-Z. '' = todas. '#' = nome que nao comeca por letra
  // (empresa que comeca com numero, nome vazio).
  const [letra, setLetra] = useState('');

  const buscarContatos = async (termo, ini) => {
    setCarregando(true);
    const q = (termo || '').trim();
    const digitos = q.replace(/\D/g, '');
    // Telefone e guardado so com digitos; buscar "(11) 9" precisa virar
    // "119" pra casar. Termo sem letra nenhuma = busca por numero.
    const alvoLike = digitos.length >= 3 ? '*' + digitos + '*' : null;
    const nomeLike = q.length >= 2 ? '*' + q + '*' : null;

    const filtro = (sel) => {
      let r = sel.not('phone', 'is', null);
      if(nomeLike && alvoLike) r = r.or('name.ilike.' + nomeLike + ',phone.ilike.' + alvoLike);
      else if(nomeLike) r = r.ilike('name', nomeLike);
      else if(alvoLike) r = r.ilike('phone', alvoLike);
      // A letra so entra quando NAO ha busca: quem digitou quer procurar em
      // todos, e manter a letra ativa esconderia o resultado sem explicar.
      else if(ini === '#') r = r.not('name', 'ilike', '[A-Za-zÀ-ÿ]*');
      else if(ini) r = r.ilike('name', ini + '*');
      // Teto alto: com a letra escolhida, cada fatia e pequena. Sem letra e
      // sem busca, mostra o comeco do alfabeto — a tela avisa que e um
      // pedaco.
      return r.order('name').limit(ini ? 300 : 80);
    };

    const [ld, pf] = await Promise.all([
      filtro(supa.from('leads').select('id, name, phone, city, category')),
      filtro(supa.from('profiles').select('id, name, phone, city')),
    ]);

    const vistos = new Set();
    const lista = [];
    const push = (nome, phone, extra, origem) => {
      const alvo = normalizeLeadPhone(phone);
      if(!alvo) return;
      const chave = alvo.slice(-8);          // dedupe por final, igual ao resto do portal
      if(vistos.has(chave)) return;
      vistos.add(chave);
      lista.push({ nome: nome || '', alvo, extra: extra || '', origem });
    };
    for(const p of (pf.data || [])) push(p.name, p.phone, p.city, 'app');
    for(const l of (ld.data || [])) push(l.name, l.phone, l.city || l.category, 'lead');
    lista.sort((a,b) => (a.nome || 'zzz').localeCompare(b.nome || 'zzz', 'pt-BR'));
    setContatos(lista);
    setCarregando(false);
  };

  // Quantos contatos existem no total — a tela precisa DIZER que esta
  // mostrando um pedaco, senao a pessoa conclui que o resto nao existe.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [ld, pf] = await Promise.all([
        supa.from('leads').select('id', { count:'exact', head:true }).not('phone','is',null),
        supa.from('profiles').select('id', { count:'exact', head:true }).not('phone','is',null),
      ]);
      if(vivo) setTotal((ld.count || 0) + (pf.count || 0));
    })().catch(() => {});
    return () => { vivo = false; };
  }, []);

  // Atraso pra nao consultar a cada tecla (mesmo padrao da tela de
  // produtos, que tem 21 mil linhas).
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => { if(vivo) buscarContatos(busca, letra).catch(() => setCarregando(false)); }, 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, letra]);

  // Mesma regra do servidor (normalizeWhatsAppTarget): BR local ganha o 55;
  // numero que ja vem com DDI de outro pais passa direto.
  const alvoDigitado = (() => {
    const d = numero.replace(/\D/g, '');
    if(!d) return null;
    if(d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
    if(d.length === 10) return '55' + d;
    if(d.length === 11 && d[2] === '9') return '55' + d;
    if(d.length >= 11 && d.length <= 15) return d;
    return null;
  })();

  const abrirNumeroNovo = async () => {
    if(!alvoDigitado){ setErro('Número inválido. Brasil: DDD + número. Outro país: DDI + número.'); return; }
    const limpo = nome.trim();
    if(limpo){
      // Salvar e best-effort: a conversa abre de qualquer jeito. Falhar em
      // gravar o contato nao pode impedir de falar com a pessoa.
      setSalvando(true);
      try {
        await supa.from('leads').insert({
          name: limpo, phone: alvoDigitado, source: 'portal', status: 'novo',
        });
      } catch(_){}
      setSalvando(false);
    }
    onAbrir(alvoDigitado);
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(26,26,46,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:'min(560px, 96vw)', maxHeight:'88vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,.24)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontWeight:800, fontSize:16, color:C.ink }}>Nova conversa</div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:C.muted, lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:6 }}>Número novo</div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <input value={numero} onChange={e=>{ setNumero(e.target.value); setErro(''); }}
              placeholder="11 99999-9999 (ou DDI + número)"
              onKeyDown={e => { if(e.key === 'Enter'){ e.preventDefault(); abrirNumeroNovo(); } }}
              style={{ flex:'1 1 200px', padding:'9px 12px', borderRadius:10, fontSize:13, outline:'none',
                border:'1.5px solid '+(numero && !alvoDigitado ? '#e0a0a0' : C.border) }} />
            <input value={nome} onChange={e=>setNome(e.target.value)}
              placeholder="Nome (opcional)"
              style={{ flex:'1 1 140px', padding:'9px 12px', borderRadius:10, border:'1.5px solid '+C.border, fontSize:13, outline:'none' }} />
          </div>
          <div style={{ fontSize:11, color:C.muted, marginTop:6, lineHeight:1.5 }}>
            {numero && !alvoDigitado
              ? <span style={{ color:'#b3261e' }}>Número incompleto ou fora de formato.</span>
              : alvoDigitado
                ? <>Vai abrir <strong style={{ color:C.ink }}>{fmtWaPhone(alvoDigitado)}</strong>. </>
                : null}
            O nome fica salvo nos contatos e é ele que entra na mensagem de template
            (<code>{'{{1}}'}</code>). Sem nome, o primeiro contato sai pelo template fixo.
          </div>
          {erro ? <div style={{ marginTop:10, padding:'8px 12px', background:'#fdecea', color:'#b3261e', borderRadius:8, fontSize:12 }}>{erro}</div> : null}
          <button onClick={abrirNumeroNovo} disabled={!alvoDigitado || salvando}
            style={{ marginTop:10, background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'9px 18px',
              fontSize:13, fontWeight:700, cursor: (!alvoDigitado||salvando)?'not-allowed':'pointer', opacity:(!alvoDigitado||salvando)?.5:1 }}>
            {salvando ? 'Salvando…' : (nome.trim() ? 'Salvar contato e abrir' : 'Abrir conversa')}
          </button>

          <div style={{ borderTop:'1px solid '+C.border, margin:'18px 0 14px' }} />

          <div style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8 }}>
            <span>Contatos que a loja já conhece</span>
            {total != null ? (
              <span style={{ fontWeight:400, fontSize:11, color:C.muted }}>
                {total.toLocaleString('pt-BR')} no total
              </span>
            ) : null}
          </div>
          <input value={busca} onChange={e=>{ setBusca(e.target.value); if(e.target.value.trim()) setLetra(''); }}
            placeholder="Buscar por nome ou número…"
            style={{ width:'100%', padding:'9px 12px', borderRadius:10, border:'1.5px solid '+C.border, fontSize:13, outline:'none', marginBottom:6 }} />
          {/* Indice A-Z: com mais de mil contatos, rolar uma lista unica nao
              serve. Clicar numa letra CONSULTA O BANCO por aquela inicial —
              nao filtra o que ja esta na tela, senao a letra sofreria do
              mesmo problema que a busca sofria (so achava quem ja tinha sido
              carregado). '#' pega quem nao comeca por letra. */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginBottom:8 }}>
            {['', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#'].map(l => {
              const sel = letra === l;
              return (
                <button key={l || 'todos'} onClick={()=>{ setLetra(l); setBusca(''); }}
                  title={l === '' ? 'Todos' : l === '#' ? 'Nome que não começa por letra' : 'Nomes com ' + l}
                  style={{ minWidth: l === '' ? 44 : 24, padding:'3px 5px', borderRadius:6, fontSize:11,
                    fontWeight: sel ? 800 : 600, cursor:'pointer', lineHeight:1.5,
                    border:'1px solid '+(sel ? C.p1 : C.border),
                    background: sel ? C.p1+'18' : '#fff', color: sel ? C.p1 : C.muted }}>
                  {l === '' ? 'Todos' : l}
                </button>
              );
            })}
          </div>
          {/* A lista mostra um pedaco; sem dizer isso, quem nao acha o
              contato conclui que ele nao existe. A busca vai ao banco, entao
              digitar ALCANCA quem nao esta na tela. */}
          <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
            {busca.trim()
              ? (contatos.length >= 80 ? 'Mostrando os 80 primeiros — refine a busca.' : contatos.length + ' encontrado(s).')
              : letra
                ? contatos.length + ' com ' + (letra === '#' ? 'nome fora do alfabeto' : letra) + '.'
                : 'Mostrando o começo da lista. Use as letras acima ou digite para buscar em todos.'}
          </div>
          {carregando ? (
            <div style={{ fontSize:13, color:C.muted, padding:'8px 0' }}>Carregando contatos…</div>
          ) : contatos.length === 0 ? (
            <div style={{ fontSize:13, color:C.muted, padding:'8px 0' }}>
              {busca ? 'Nenhum contato com esse nome ou número.' : 'Nenhum contato com telefone cadastrado.'}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {contatos.map(c => (
                <button key={c.alvo} onClick={()=>{ onAbrir(c.alvo); onClose(); }}
                  style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, width:'100%',
                    background:'none', border:'none', borderRadius:8, padding:'8px 10px', cursor:'pointer', textAlign:'left' }}
                  onMouseEnter={e=>e.currentTarget.style.background=C.cream}
                  onMouseLeave={e=>e.currentTarget.style.background='none'}>
                  <span style={{ minWidth:0 }}>
                    <span style={{ display:'block', fontSize:13, fontWeight:600, color:C.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {c.nome || fmtWaPhone(c.alvo)}
                    </span>
                    <span style={{ display:'block', fontSize:11, color:C.muted }}>
                      {fmtWaPhone(c.alvo)}{c.extra ? ' · ' + c.extra : ''}
                    </span>
                  </span>
                  <span style={{ fontSize:10, color:C.muted, border:'1px solid '+C.border, borderRadius:6, padding:'1px 6px', flexShrink:0 }}>
                    {c.origem === 'app' ? 'app' : 'lead'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Janela de abordagem: mostra o que sabemos do lead, sugere produtos do
// catalogo pelo segmento (marcaveis), deixa editar o texto e envia pelo
// canal da loja.
// SO TEMPLATE (2026-09-05, decisao do usuario). O modal tinha uma aba de
// "texto livre" com seletor de produtos e campo de mensagem — o pitch
// personalizado do `montarAbordagem`. Saiu inteiro por dois motivos:
//
//   1. Abordagem e, por definicao, a PRIMEIRA mensagem pra quem nunca
//      escreveu pra loja. Ali a janela de 24h esta fechada e a Cloud API so
//      aceita template. O texto livre nunca ia sair daqui — oferecer o campo
//      era convidar pro 131047.
//   2. Depois que a pessoa responde, a conversa vive na aba WhatsApp, que
//      ja tem campo de texto, sugestao da IA e historico. Ter um segundo
//      lugar pra escrever a mesma conversa so espalha o atendimento.
//
// O `montarAbordagem` saiu junto: ele existia SO pra alimentar aquele
// campo. O follow-up automatico tem textos proprios no servidor
// (`textoCobranca`/`textoReengajamento` em whatsapp-followup.ts) — nao
// dependia desta funcao. Deixar codigo morto com um comentario dizendo que
// alguem usa e pior do que apagar.
const AbordagemModal = ({ lead, onClose, onSent }) => {
  const [enviando, setEnviando] = useState(false);
  const [estagio, setEstagio] = useState('');
  const [erro, setErro] = useState('');
  const pitch = pitchDoLead(lead);
  const alvo = normalizeLeadPhone(lead.phone);
  const linha = tipoDeLinha(lead.phone);

  const enviarPara = async (pacote) => {
    if(!alvo){ setErro('Numero invalido neste lead.'); return; }
    if(!pacote) return;
    setEnviando(true); setErro(''); setEstagio('Enviando…');
    const res = await enviarTemplateDaLoja({ alvo, pacote, leadId: lead.id });
    setEnviando(false); setEstagio('');
    if(!res.ok){ setErro(res.erro); return; }
    if(onSent) onSent(alvo);
    onClose();
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(26,26,46,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:'min(1000px, 96vw)', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,.24)' }}>
        {/* Cabecalho */}
        <div style={{ padding:'16px 20px', borderBottom:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:16, color:C.ink }}>{lead.name || 'Lead sem nome'}</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2, display:'flex', gap:8, flexWrap:'wrap' }}>
              <span>{lead.category || '—'}</span>
              <span>·</span>
              <span>{pitch.funil === 'fornece' ? '🎨 fornece obra (compra tinta)' : '🏢 precisa de obra'}</span>
              <span>·</span>
              <span>{lead.phone || 'sem telefone'}</span>
              <span style={{ background: linha==='celular' ? C.p6+'22' : C.p7+'33', color: linha==='celular' ? C.p6 : '#b8860b', borderRadius:6, padding:'1px 7px', fontWeight:600 }}>
                {linha === 'celular' ? 'celular' : linha === 'fixo' ? 'fixo (pode não ter WhatsApp)' : 'formato estranho'}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:C.muted, lineHeight:1 }}>×</button>
        </div>

        {/* Corpo rolavel */}
        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {/* Uma linha, nao um paragrafo (2026-09-08): o modal tem que caber
              na tela com o botao de enviar a vista, sem rolar. */}
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.5, marginBottom:12 }}>
            Primeira mensagem é sempre um <strong style={{ color:C.ink }}>template aprovado</strong> (a Meta guarda o texto).
            Quando a pessoa <strong style={{ color:C.ink }}>responder</strong>, a conversa segue na aba
            <strong style={{ color:C.ink }}> WhatsApp</strong>, com texto livre por 24h.
          </div>

          <EnvioDeTemplate
            waId={alvo}
            nomeContato={lead.name}
            dadosContato={{ cidade: cidadeDoLead(lead), segmento: ramoDoLead(lead) }}
            enviando={enviando}
            estagio={estagio}
            onEnviar={enviarPara}
          />

          {erro ? <div style={{ marginTop:10, padding:'8px 12px', background:'#fdecea', color:'#b3261e', borderRadius:8, fontSize:12 }}>{erro}</div> : null}
        </div>

        {/* Rodape */}
        <div style={{ padding:'14px 20px', borderTop:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <span style={{ fontSize:11, color:C.muted }}>
            Envia pelo número oficial da loja · Cloud API (Dualhook)
          </span>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={onClose} style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'9px 16px', fontSize:13, cursor:'pointer', color:C.muted }}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
};
// ── Abordagem em LOTE (2026-09-08, pedido do usuario: "marcar multiplos
// e mandar o modal para varios ao mesmo tempo") ─────────────────────────
// O operador marca os leads na tabela e manda o MESMO template pra todos.
// As variaveis nao sao digitadas: saem do cadastro de cada lead, pela
// mesma regra do modal unitario ({{1}} nomeCompleto, {{2}} cidadeDoLead,
// {{3}} ramoDoLead). Lead com campo vazio, sem numero valido, que pediu
// pra nao receber, ou dos EUA em template de Marketing fica DE FORA com o
// motivo escrito na linha — nunca vai "Oi ," pra ninguem. O envio e um por
// vez, com o resultado de cada um na propria linha; "Parar" interrompe
// entre um envio e o outro.
const linhaDoLote = (l) => {
  const alvo = normalizeLeadPhone(l.phone);
  const valores = { 1: nomeCompleto(l.name) || '', 2: cidadeDoLead(l) || '', 3: ramoDoLead(l) || '' };
  const motivo = l.opted_out_at ? 'pediu pra não receber'
    : l.status === 'fixo' ? 'marcado como fixo (sem WhatsApp)'
    : !alvo ? 'sem número válido' : null;
  return { lead: l, alvo, valores, motivo };
};

const AbordagemLoteModal = ({ leads, onClose, onSent }) => {
  const { lista, tpl, escolher, erroLista, recarregando, tentarDeNovo } = useListaDeTemplates();
  const [estado, setEstado] = useState({});   // lead.id -> { fase:'enviando'|'ok'|'erro', erro }
  const [rodando, setRodando] = useState(false);
  const [terminou, setTerminou] = useState(false);
  const pararRef = React.useRef(false);

  const vars = (tpl && tpl.variaveis) || (tpl && tpl.precisaNome ? [{ indice:1, exemplo:null }] : []);
  const marketing = !!tpl && String(tpl.categoria || '').toUpperCase() === 'MARKETING';
  const linhas = leads.map(l => {
    const b = linhaDoLote(l);
    let motivo = b.motivo;
    if(!motivo && marketing && ehNumeroEUA(b.alvo)) motivo = 'número dos EUA: marketing não entrega';
    if(!motivo){
      const faltando = vars.filter(v => !String(b.valores[v.indice] || '').trim()).map(v => v.indice);
      if(faltando.length) motivo = 'falta ' + (faltando.length > 1 ? 'os campos ' : 'o campo ') + faltando.join(', ');
    }
    return { ...b, motivo, pronto: !motivo };
  });
  const prontos = linhas.filter(x => x.pronto);
  // Pendentes = prontos ainda nao enviados + os que falharam (pode tentar de
  // novo: o erro veio da API, a mensagem nao saiu).
  const pendentes = prontos.filter(x => !estado[x.lead.id] || estado[x.lead.id].fase === 'erro');
  const enviados = Object.values(estado).filter(e => e.fase === 'ok').length;
  const falhas = Object.values(estado).filter(e => e.fase === 'erro').length;
  const exemplo = prontos[0] || linhas[0] || null;

  const enviar = async () => {
    if(!tpl || !pendentes.length || rodando) return;
    setRodando(true); pararRef.current = false;
    for(const x of pendentes){
      if(pararRef.current) break;
      setEstado(e => ({ ...e, [x.lead.id]: { fase:'enviando' } }));
      const res = await enviarTemplateDaLoja({ alvo: x.alvo, pacote: pacoteDeTemplate(tpl, vars, x.valores), leadId: x.lead.id });
      setEstado(e => ({ ...e, [x.lead.id]: res.ok ? { fase:'ok' } : { fase:'erro', erro: res.erro } }));
      // Um por vez, com folga: e uma pessoa mandando varias mensagens, nao
      // uma rajada — e da tempo de a linha mostrar o resultado.
      await new Promise(r => setTimeout(r, 400));
    }
    setRodando(false); setTerminou(true);
  };
  const fechar = () => {
    if(rodando) return; // no meio do envio o X nao fecha — "Parar" primeiro
    if(terminou && onSent) onSent();
    onClose();
  };

  const icone = (x) => {
    const e = estado[x.lead.id];
    if(e && e.fase === 'enviando') return <span title="enviando">⏳</span>;
    if(e && e.fase === 'ok') return <span style={{ color:C.p6, fontWeight:800 }} title="aceito pela API — a confirmacao da Meta chega na tabela de Leads">✓</span>;
    if(e && e.fase === 'erro') return <span style={{ color:'#b3261e', fontWeight:800 }} title="falhou">✗</span>;
    if(!x.pronto) return <span style={{ color:'#b8860b' }} title="fica de fora">—</span>;
    return <span style={{ color:C.muted }} title="pronto pra enviar">•</span>;
  };

  return (
    <div onClick={fechar} style={{ position:'fixed', inset:0, background:'rgba(26,26,46,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:'min(1000px, 96vw)', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,.24)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:16, color:C.ink }}>💬 Abordagem em lote</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
              {leads.length} {leads.length === 1 ? 'lead selecionado' : 'leads selecionados'} ·{' '}
              <strong style={{ color:C.ink }}>{prontos.length}</strong> {prontos.length === 1 ? 'pronto' : 'prontos'} pra enviar
              {linhas.length - prontos.length > 0 ? ' · ' + (linhas.length - prontos.length) + ' de fora (motivo na linha)' : ''}
            </div>
          </div>
          <button onClick={fechar} disabled={rodando} style={{ background:'none', border:'none', fontSize:22, cursor: rodando ? 'not-allowed' : 'pointer', color:C.muted, lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1 }}>
          {/* Espelhado como o unitario (2026-09-09): previa a esquerda, lista a direita. */}
          <div style={{ display:'flex', flexDirection:'row-reverse', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
            <div style={{ flex:'1 1 360px', minWidth:0 }}>
              <SeletorDeTemplate lista={lista} tpl={tpl} onEscolher={(n)=>{ if(!rodando) escolher(n); }} />
              <AvisoListaEmbutida erroLista={erroLista} recarregando={recarregando} tentarDeNovo={tentarDeNovo} />
              <div style={{ fontSize:11.5, color:C.muted, lineHeight:1.5, marginBottom:8 }}>
                Os campos saem do cadastro de cada lead: <strong style={{ color:C.ink }}>1</strong> nome ·{' '}
                <strong style={{ color:C.ink }}>2</strong> cidade · <strong style={{ color:C.ink }}>3</strong> ramo.
                Quem estiver com campo vazio fica de fora — abra o lead sozinho pra completar.
              </div>
              <div style={{ border:'1px solid '+C.border, borderRadius:10, maxHeight:380, overflowY:'auto' }}>
                {linhas.map(x => {
                  const e = estado[x.lead.id];
                  return (
                    <div key={x.lead.id} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'8px 10px',
                      borderBottom:'1px solid '+C.cream, opacity: x.pronto ? 1 : .7 }}>
                      <span style={{ width:18, textAlign:'center', fontSize:13, flex:'0 0 18px' }}>{icone(x)}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:600, color:C.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{x.lead.name || '—'}</div>
                        <div style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {x.lead.phone || 'sem telefone'}
                          {vars.length ? ' · ' + vars.map(v => x.valores[v.indice] || '?').join(' · ') : ''}
                        </div>
                        {x.motivo ? <div style={{ fontSize:11, color:'#b8860b' }}>{x.motivo}</div> : null}
                        {e && e.fase === 'erro' ? <div style={{ fontSize:11, color:'#b3261e' }}>{e.erro}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ flex:'1 1 300px', minWidth:0 }}>
              {exemplo ? (
                <div style={{ fontSize:11.5, color:C.muted, marginBottom:6 }}>
                  Prévia com <strong style={{ color:C.ink }}>{exemplo.lead.name || 'o primeiro da lista'}</strong> — cada lead recebe com os próprios dados.
                </div>
              ) : null}
              <PreviaDeTemplate tpl={tpl} valores={exemplo ? exemplo.valores : {}} />
            </div>
          </div>
        </div>

        <div style={{ padding:'14px 20px', borderTop:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:C.muted }}>
            {rodando ? 'Enviando… ' : ''}
            {enviados + falhas > 0
              ? enviados + ' aceito' + (enviados === 1 ? '' : 's') + ' pela API' + (falhas ? ' · ' + falhas + ' com falha' : '') + ' · a confirmação de entrega aparece na coluna Status'
              : 'Envia pelo número oficial da loja · um por vez · "contactado" só depois que a Meta confirmar'}
          </span>
          <div style={{ display:'flex', gap:8 }}>
            {rodando ? (
              <button onClick={()=>{ pararRef.current = true; }}
                style={{ background:'none', border:'1px solid #b3261e', borderRadius:10, padding:'9px 16px', fontSize:13, cursor:'pointer', color:'#b3261e', fontWeight:700 }}>
                ■ Parar
              </button>
            ) : (
              <button onClick={enviar} disabled={!tpl || !pendentes.length}
                style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'9px 18px', fontSize:13, fontWeight:700,
                  cursor: (!tpl || !pendentes.length) ? 'not-allowed' : 'pointer', opacity: (!tpl || !pendentes.length) ? .5 : 1 }}>
                {terminou && falhas ? '📤 Reenviar ' + pendentes.length + ' com falha' : '📤 Enviar para ' + pendentes.length}
              </button>
            )}
            <button onClick={fechar} disabled={rodando}
              style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'9px 16px', fontSize:13, cursor: rodando ? 'not-allowed' : 'pointer', color:C.muted }}>
              {terminou ? 'Fechar' : 'Cancelar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Cabecalho da tabela de leads: ordena e filtra ────────────────────────
// Antes o header era uma lista de textos com "↕" decorativo. Cada coluna
// agora ordena (clique no titulo, clique de novo inverte) e tem filtro
// proprio no "▾". O estado vive no componente Leads e chega via `ctx`.
const filtroInput = { width:'100%', padding:'7px 9px', borderRadius:8, border:'1px solid #e5e0d8', fontSize:12, outline:'none' };

const OpcoesFiltro = ({ opcoes, valor, onPick, fechar }) => (
  <div style={{ maxHeight:260, overflowY:'auto', margin:-4 }}>
    {opcoes.map(([v, rot, qtd]) => (
      <button key={String(v)} onClick={()=>{ onPick(v); fechar(); }}
        style={{ display:'flex', width:'100%', alignItems:'center', justifyContent:'space-between', gap:10,
          background: valor === v ? C.p1+'18' : 'none', border:'none', borderRadius:7, padding:'7px 9px',
          fontSize:12, cursor:'pointer', color: valor === v ? C.p1 : C.ink, fontWeight: valor === v ? 700 : 400,
          textAlign:'left' }}>
        <span>{rot}</span>
        {qtd != null ? <span style={{ color:C.muted, fontSize:11 }}>{qtd}</span> : null}
      </button>
    ))}
  </div>
);

const ThLead = ({ rot, campo, ativo, ctx, children }) => {
  const ordenando = campo && ctx.sortCol === campo;
  const aberto = ctx.menuCol === rot;
  return (
    <th style={{ position:'relative', textAlign:'left', padding:'12px 10px', color:C.muted,
      fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' }}>
      <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
        {campo ? (
          <button onClick={()=>ctx.ordenarPor(campo)} title="Ordenar por esta coluna"
            style={{ background:'none', border:'none', padding:0, cursor:'pointer', font:'inherit',
              textTransform:'inherit', letterSpacing:'inherit', color: ordenando ? C.p1 : C.muted,
              display:'inline-flex', alignItems:'center', gap:4 }}>
            {rot}<span style={{ fontSize:9 }}>{ordenando ? (ctx.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
          </button>
        ) : <span>{rot}</span>}
        {children ? (
          <button onClick={()=>ctx.setMenuCol(aberto ? null : rot)} title="Filtrar esta coluna"
            style={{ background: ativo ? C.p1 : 'none', color: ativo ? '#fff' : C.border, border:'none',
              borderRadius:5, width:16, height:16, lineHeight:'14px', fontSize:9, cursor:'pointer', padding:0 }}>▼</button>
        ) : null}
      </span>
      {children && aberto ? (
        <span>
          <span onClick={()=>ctx.setMenuCol(null)} style={{ position:'fixed', inset:0, zIndex:40, display:'block' }} />
          <div style={{ position:'absolute', top:'100%', left:6, zIndex:41, background:'#fff',
            border:'1px solid '+C.border, borderRadius:10, boxShadow:'0 10px 30px rgba(26,26,46,.16)',
            padding:8, minWidth:200, textTransform:'none', letterSpacing:0, fontWeight:400 }}>
            {children}
          </div>
        </span>
      ) : null}
    </th>
  );
};

const LEAD_PRIO_COLORS = { alta: C.p6, media: C.p7, baixa: C.muted };

// [teste:leads-janela-inicio]
const LEADS_JANELA = 100;   // linhas que a sentinela acrescenta por vez
const LEADS_BLOCO = 500;    // TETO de linhas montadas de uma vez
// Fatia da lista filtrada que vira <tr>: o bloco `bloco` (de LEADS_BLOCO) e,
// dentro dele, `limite` linhas — a sentinela cresce `limite` ate o teto do
// bloco; dai em diante so "proximo bloco", que DESMONTA o anterior. Sem
// isso a janela era um prefixo que so crescia: rolar a lista inteira
// montava as 61 mil linhas de novo (achado do Codex no #291).
function janelaDeLeads(total, bloco, limite) {
  const nBlocos = Math.max(1, Math.ceil(total / LEADS_BLOCO));
  const b = Math.min(Math.max(0, bloco), nBlocos - 1);
  const de = b * LEADS_BLOCO;
  const fimBloco = Math.min(total, de + LEADS_BLOCO);
  const ate = Math.min(fimBloco, de + Math.max(1, limite));
  return { de, ate, bloco: b, nBlocos, fimDoBloco: ate >= fimBloco };
}
// Lead que pode receber template: telefone valido, sem opt-out, nao fixo.
const leadAbordavel = (l) => !!l.phone && !l.opted_out_at && l.status !== 'fixo' && !!normalizeLeadPhone(l.phone);
// Emenda `mudados` na `lista` por id: linha conhecida recebe os campos
// novos (por cima, sem perder os outros), linha desconhecida entra no
// comeco. Devolve a MESMA lista se nada mudou, pra nao remontar a tela.
function emendarLeads(lista, mudados) {
  if (!mudados || !mudados.length) return lista;
  const porId = new Map();
  mudados.forEach(m => { if (m && m.id) porId.set(m.id, m); });
  if (!porId.size) return lista;
  let mudou = false;
  const out = lista.map(l => {
    const m = porId.get(l.id);
    if (!m) return l;
    porId.delete(l.id);
    const juntos = Object.assign({}, l, m);
    if (Object.keys(juntos).every(k => juntos[k] === l[k])) return l;
    mudou = true;
    return juntos;
  });
  if (porId.size) { mudou = true; out.unshift(...porId.values()); }
  return mudou ? out : lista;
}
// BUSCA DO TOPO (2026-09-09, pedido do usuario: "da para buscar pelo numero
// de telefone tbm?"). Texto casa em nome/segmento/categoria/bairro/@ig;
// consulta que e SO numero (com ou sem mascara: "98545-5530", "(11) 9…")
// casa pelos DIGITOS do telefone — "402" dentro de "Rua X, 402" NAO vira
// busca de telefone, senao endereco com numero traria lead errado. A base
// guarda o telefone como veio da planilha (com ou sem +55), entao consulta
// com DDI 55 tambem e tentada SEM ele (Codex no #294).
const buscaDeLead = (q) => {
  const texto = String(q || '').trim().toLowerCase();
  if (!texto) return () => true;
  const soNumero = /^[\d\s()+\-.]+$/.test(texto);
  const digitos = texto.replace(/\D/g, '');
  const variantes = [digitos];
  if (/^55\d{10,11}$/.test(digitos)) variantes.push(digitos.slice(2));
  return (l) => {
    if (soNumero && digitos.length >= 3) { const d = (l.phone || '').replace(/\D/g, ''); return variantes.some(v => d.includes(v)); }
    return (l.name||'').toLowerCase().includes(texto) || (l.segment||'').toLowerCase().includes(texto)
      || (l.category||'').toLowerCase().includes(texto) || (l.neighborhood||'').toLowerCase().includes(texto)
      || (l.instagram||'').toLowerCase().includes(texto);
  };
};
// [teste:leads-janela-fim]
let _leadsCache = null;

const Leads = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('Todos');
  const [filtroSegmento, setFiltroSegmento] = useState('TODOS');
  const [filtroCategoria, setFiltroCategoria] = useState('Todas');
  // ORDENACAO E FILTRO POR COLUNA (2026-08-29). Antes o cabecalho tinha
  // setinhas "↕" que eram so enfeite — nao ordenavam nada. Agora cada
  // coluna ordena de verdade e tem o proprio filtro no "▾".
  const [sortCol, setSortCol] = useState('rating');
  const [sortDir, setSortDir] = useState('desc');
  const [menuCol, setMenuCol] = useState(null);   // qual filtro esta aberto
  const [fNome, setFNome] = useState('');
  const [fTel, setFTel] = useState('');
  const [fPrio, setFPrio] = useState('Todas');
  const [fRating, setFRating] = useState(0);
  const [fCidade, setFCidade] = useState('Todas');
  // Filtro "Entrega" (2026-09-09): responde "quem deu erro / quem recebeu"
  // pelo status que a Meta confirmou (abordagem_status), nao pelo funil.
  const [fEntrega, setFEntrega] = useState('Todas');
  const [importOpen, setImportOpen] = useState(false);
  const [abordar, setAbordar] = useState(null); // lead da janela de abordagem
  // SELECAO MULTIPLA (2026-09-08): ids marcados na tabela pra abordar em
  // lote. So lead abordavel (telefone valido e sem opt-out) entra.
  const [sel, setSel] = useState(() => new Set());
  const [abordarLote, setAbordarLote] = useState(null); // leads da janela em lote
  // CARGA PROGRESSIVA + JANELA (2026-09-09, relato do usuario: "tem 60k+
  // leads, a pagina nao carrega"). `totalBanco` e o count da 1a pagina;
  // `carregandoResto` fica true enquanto as outras chegam; `limite` e
  // quantas linhas da lista filtrada estao MONTADAS na tabela (cresce
  // rolando); `buscaDeb` e a busca com atraso, pra nao refiltrar 61 mil
  // linhas a cada tecla.
  const [totalBanco, setTotalBanco] = useState(null);
  const [carregandoResto, setCarregandoResto] = useState(false);
  const [erroCarga, setErroCarga] = useState('');
  const [limite, setLimite] = useState(LEADS_JANELA);
  const [bloco, setBloco] = useState(0);
  const [buscaDeb, setBuscaDeb] = useState('');
  const vivoRef = React.useRef(true);
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);
  useEffect(() => { const t = setTimeout(() => setBuscaDeb(busca), 250); return () => clearTimeout(t); }, [busca]);

  const removeDuplicates = async (allLeads) => {
    const seen = {};
    const dupeIds = [];
    for (const l of allLeads) {
      const key = (l.name || '').trim().toLowerCase();
      if (!key) continue;
      if (seen[key]) {
        dupeIds.push(l.id);
      } else {
        seen[key] = true;
      }
    }
    if (dupeIds.length > 0) {
      for (const id of dupeIds) {
        try { await leadsService.remove(id); } catch(e) { console.warn('leads.remove dup error:', e); }
      }
    }
    return dupeIds.length;
  };

  // Carga completa: a primeira pagina pinta a tela (e tira o "Carregando"),
  // o resto chega em paralelo e entra na lista a cada ~600ms. `force`
  // ignora o cache em memoria (botao ↻ e pos-importacao).
  const fetchLeads = async (force) => {
    if (!force && _leadsCache) {
      setLeads(_leadsCache); setTotalBanco(_leadsCache.length); setLoading(false);
      mesclarRecentes();
      return;
    }
    setErroCarga('');
    const publicar = comIntervalo((parcial, total) => {
      if (!vivoRef.current) return;
      setLeads(parcial);
      setTotalBanco(typeof total === 'number' ? total : parcial.length);
      setLoading(false);
      setCarregandoResto(true);
    }, 600);
    try {
      const rows = await leadsService.list({ aoChegar: publicar, cancelado: () => !vivoRef.current });
      publicar.cancelar();
      if (vivoRef.current) {
        _leadsCache = rows;
        setLeads(rows); setTotalBanco(rows.length);
      }
    } catch (e) {
      publicar.cancelar();
      console.error('fetchLeads error:', e);
      if (vivoRef.current) setErroCarga(e && e.message ? e.message : String(e));
    }
    if (vivoRef.current) { setLoading(false); setCarregandoResto(false); }
  };

  // Traz so os leads cuja abordagem mudou nas ultimas horas e EMENDA na
  // lista (por id). E o que o poll de 20s e o pos-envio usam: o webhook
  // muda `abordagem_status`/`status` de poucos leads por vez, e recarregar
  // 61 mil linhas pra ver isso deixava a tela em "Carregando" de novo.
  // Coluna ausente (SQL de 2026-09-09 nao rodou) → 42703 → nada a emendar.
  const mesclarRecentes = async () => {
    try {
      const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
      const recentes = await leadsService.recentes(desde);
      if (!vivoRef.current || !recentes.length) return;
      setLeads(prev => { const n = emendarLeads(prev, recentes); _leadsCache = n; return n; });
    } catch (e) {
      console.warn('leads.recentes:', e && e.message ? e.message : e);
    }
  };

  useEffect(() => { fetchLeads(); }, []);

  // Enquanto houver abordagem aceita e ainda sem confirmacao da Meta, a
  // lista se atualiza sozinha: o `sent`/`failed` chega pelo webhook segundos
  // (ou minutos) depois do envio, e e o SERVIDOR que muda o status. Sem isto
  // o operador fecharia o modal vendo "aguardando" e so descobriria o
  // resultado recarregando a pagina.
  const temPendente = React.useMemo(() => { const agora = Date.now(); return leads.some(l => abordagemPendente(l, agora)); }, [leads]);
  useEffect(() => {
    if(!temPendente) return;
    const t = setInterval(mesclarRecentes, 20000);
    return () => clearInterval(t);
  }, [temPendente]);
  // A coluna nao veio no select('*') = o SQL de 2026-09-09 ainda nao rodou.
  // Sem ela o servidor nao consegue amarrar o envio ao lead, e NENHUM lead
  // vira contactado sozinho — a tela avisa em vez de parecer que a Meta
  // nunca confirma nada.
  const semColunaAbordagem = leads.length > 0 && !('abordagem_status' in leads[0]);
  const contagemEntrega = React.useMemo(() => {
    const c = {};
    Object.keys(ABORDAGEM_GRUPOS).forEach(k => { c[k] = leads.filter(ABORDAGEM_GRUPOS[k]).length; });
    return c;
  }, [leads]);

  const updateStatus = async (id, newStatus) => {
    try {
      await leadsService.updateStatus(id, newStatus);
      // Emenda a linha em vez de recarregar a lista inteira.
      setLeads(prev => { const n = emendarLeads(prev, [{ id, status: newStatus }]); _leadsCache = n; return n; });
    } catch (e) {
      // 23514 = CHECK em leads.status que nao conhece o valor novo. A tabela
      // nasceu fora do repo, entao nao da pra saber daqui se ha CHECK; o
      // erro diz o que rodar em vez de so "erro".
      const msg = String((e && e.message) || e);
      alert(/23514|check constraint/i.test(msg)
        ? 'O banco recusou o status "' + newStatus + '": leads.status tem um CHECK sem esse valor. Rode /migrations/2026-09-09-leads-status-fixo.sql no Supabase e tente de novo.\n\n' + msg
        : 'Erro ao atualizar status: ' + msg);
    }
  };

  const statusColor = (s) => LEAD_STATUS_COLORS[s] || C.muted;
  const prioColor = (p) => LEAD_PRIO_COLORS[p] || C.muted;
  const segColors = LEAD_SEG_COLORS;

  // Filters + sort — pesado quando há muitos leads. Memoizado por estado de filtro/busca/lista.
  const filtered = React.useMemo(() => {
    let out = leads;
    if (buscaDeb) {
      out = out.filter(buscaDeLead(buscaDeb));
    }
    if (filtroStatus !== 'Todos') out = out.filter(l => l.status === filtroStatus.toLowerCase());
    if (filtroSegmento !== 'TODOS') out = out.filter(l => (l.segment||'').toUpperCase() === filtroSegmento);
    if (filtroCategoria !== 'Todas') out = out.filter(l => l.category === filtroCategoria);
    // Filtros de coluna (cabecalho)
    if (fNome.trim()) { const q = fNome.trim().toLowerCase(); out = out.filter(l => (l.name||'').toLowerCase().includes(q)); }
    if (fTel.trim()) { const d = fTel.replace(/\D/g,''); if(d) out = out.filter(l => (l.phone||'').replace(/\D/g,'').includes(d)); }
    if (fPrio !== 'Todas') out = out.filter(l => (l.priority||'media') === fPrio);
    if (fRating > 0) out = out.filter(l => Number(l.rating||0) >= fRating);
    if (fCidade !== 'Todas') out = out.filter(l => (l.city||'—') === fCidade);
    if (fEntrega !== 'Todas' && ABORDAGEM_GRUPOS[fEntrega]) out = out.filter(ABORDAGEM_GRUPOS[fEntrega]);

    // Ordenacao: numero compara como numero, o resto como texto (pt-BR).
    const dir = sortDir === 'asc' ? 1 : -1;
    const numerica = sortCol === 'rating' || sortCol === 'review_count';
    // Intl.Collator, nao localeCompare: com 61 mil linhas o localeCompare
    // (que monta um collator por comparacao) levava segundos por ordenacao.
    const cmp = numerica ? null : new Intl.Collator('pt-BR').compare;
    out = [...out].sort((a,b) => {
      if (numerica) return ((Number(a[sortCol])||0) - (Number(b[sortCol])||0)) * dir;
      return cmp(String(a[sortCol]||''), String(b[sortCol]||'')) * dir;
    });
    return out;
  }, [leads, buscaDeb, filtroStatus, filtroSegmento, filtroCategoria, sortCol, sortDir,
      fNome, fTel, fPrio, fRating, fCidade, fEntrega]);

  const cidades = React.useMemo(() => {
    const c = {};
    leads.forEach(l => { const k = l.city || '—'; c[k] = (c[k]||0)+1; });
    return c;
  }, [leads]);

  const filtrosAtivos = (busca?1:0) + (filtroStatus!=='Todos'?1:0) + (filtroSegmento!=='TODOS'?1:0)
    + (filtroCategoria!=='Todas'?1:0) + (fNome?1:0) + (fTel?1:0) + (fPrio!=='Todas'?1:0)
    + (fRating>0?1:0) + (fCidade!=='Todas'?1:0) + (fEntrega!=='Todas'?1:0);
  // Clique no titulo ordena; clique de novo inverte. Coluna nova comeca
  // decrescente quando e numero (nota/avaliacoes) e crescente em texto.
  const ordenarPor = (campo) => {
    if (sortCol === campo) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(campo); setSortDir(campo === 'rating' || campo === 'review_count' ? 'desc' : 'asc'); }
  };
  const thCtx = { sortCol, sortDir, ordenarPor, menuCol, setMenuCol };

  const limparFiltros = () => {
    setBusca(''); setFiltroStatus('Todos'); setFiltroSegmento('TODOS'); setFiltroCategoria('Todas');
    setFNome(''); setFTel(''); setFPrio('Todas'); setFRating(0); setFCidade('Todas'); setFEntrega('Todas'); setMenuCol(null);
  };

  // Segment / Category / Status counts — só dependem de leads.
  const segments = React.useMemo(() => {
    const s = {};
    leads.forEach(l => { const k = (l.segment||'Outros').toUpperCase(); s[k] = (s[k]||0)+1; });
    return s;
  }, [leads]);

  const categories = React.useMemo(() => {
    const c = {};
    leads.forEach(l => { const k = l.category||'Outros'; c[k] = (c[k]||0)+1; });
    return c;
  }, [leads]);

  const statusCounts = React.useMemo(() => {
    const sc = { total: leads.length };
    LEADS_STATUS.forEach(s => { sc[s] = 0; });
    leads.forEach(l => { if (l.status in sc) sc[l.status]++; });
    return sc;
  }, [leads]);

  const sortedSegments = React.useMemo(() => Object.entries(segments).sort((a,b) => b[1]-a[1]), [segments]);
  const sortedCategories = React.useMemo(() => Object.entries(categories).sort((a,b) => b[1]-a[1]), [categories]);

  const exportCSV = () => {
    const header = ['#','Nome','Cidade','Bairro','Endereco','Segmento','Categoria','Rating','Reviews','Telefone','Prioridade','Status','Entrega','Erro da entrega','Entrega em'];
    const rows = filtered.map((l,i) => { const d = descreverAbordagem(l); return [i+1, l.name||'', l.city||'', l.neighborhood||'', l.address||'', l.segment||'', l.category||'', l.rating||'', l.review_count||'', l.phone||'', l.priority||'', l.status||'', d ? d.rotulo : '', d ? d.erro : '', d ? d.quando : '']; });
    const csv = [header, ...rows].map(r => r.map(c => '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n');
    const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'leads_calicolors.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Abre o WhatsApp no APARELHO do operador (canal secundario — quando ele
  // prefere falar do proprio celular em vez do numero da loja).
  const openWhatsApp = (phone, name) => {
    if (!phone) return;
    const alvo = normalizeLeadPhone(phone);
    if (!alvo) { alert('Numero invalido neste lead.'); return; }
    const msg = encodeURIComponent('Olá ' + (name||'') + '! Somos da Cali Colors — QueroUmaCor. Gostaríamos de apresentar nossa plataforma para você. Podemos conversar?');
    window.open('https://wa.me/' + alvo + '?text=' + msg, '_blank', 'noopener,noreferrer');
  };

  const abordavel = leadAbordavel;
  const abordaveisNaTela = React.useMemo(() => filtered.filter(abordavel), [filtered]);
  const todosMarcados = abordaveisNaTela.length > 0 && abordaveisNaTela.every(l => sel.has(l.id));
  const selecionados = React.useMemo(() => leads.filter(l => sel.has(l.id) && abordavel(l)), [leads, sel]);
  // JANELA: so `limite` linhas da lista filtrada viram <tr>. Com 61 mil a
  // tabela inteira travava o navegador (e era a 2a causa da tela nao
  // carregar, depois do fetch em serie). Trocou filtro/ordem → volta pro
  // comeco; lote novo chegando NAO volta (a pessoa pode estar rolando).
  useEffect(() => { setLimite(LEADS_JANELA); setBloco(0); }, [buscaDeb, filtroStatus, filtroSegmento, filtroCategoria, sortCol, sortDir, fNome, fTel, fPrio, fRating, fCidade, fEntrega]);
  const janela = React.useMemo(() => janelaDeLeads(filtered.length, bloco, limite), [filtered.length, bloco, limite]);
  const visiveis = React.useMemo(() => filtered.slice(janela.de, janela.ate), [filtered, janela.de, janela.ate]);
  const tabelaRef = React.useRef(null);
  const irParaBloco = (n) => {
    setBloco(n); setLimite(LEADS_JANELA);
    if (tabelaRef.current && tabelaRef.current.scrollIntoView) tabelaRef.current.scrollIntoView({ block:'start' });
  };
  const sentinelaRef = React.useRef(null);
  useEffect(() => {
    const el = sentinelaRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entradas => {
      if (entradas.some(e => e.isIntersecting)) setLimite(l => Math.min(LEADS_BLOCO, l + LEADS_JANELA));
    }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visiveis.length, filtered.length, janela.fimDoBloco]);
  const NavBlocos = () => janela.nBlocos > 1 ? (
    <div style={{ display:'flex', gap:8, alignItems:'center', justifyContent:'center', flexWrap:'wrap', fontSize:12, color:C.muted }}>
      <button disabled={janela.bloco === 0} onClick={()=>irParaBloco(janela.bloco - 1)} style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'2px 8px', cursor: janela.bloco === 0 ? 'default' : 'pointer', fontSize:12, color: janela.bloco === 0 ? C.border : C.ink }}>‹ {LEADS_BLOCO} anteriores</button>
      <span>bloco {janela.bloco + 1} de {janela.nBlocos}</span>
      <button disabled={janela.bloco >= janela.nBlocos - 1} onClick={()=>irParaBloco(janela.bloco + 1)} style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'2px 8px', cursor: janela.bloco >= janela.nBlocos - 1 ? 'default' : 'pointer', fontSize:12, color: janela.bloco >= janela.nBlocos - 1 ? C.border : C.ink }}>próximos {LEADS_BLOCO} ›</button>
    </div>
  ) : null;

  if (loading && leads.length === 0) return (
    <div style={{ padding: 20, color: C.muted }}>
      {erroCarga ? <span style={{ color:'#b00020' }}>Erro ao carregar leads: {erroCarga} <button onClick={()=>{ setLoading(true); fetchLeads(true); }} style={{ marginLeft:8, cursor:'pointer' }}>Tentar de novo</button></span> : 'Carregando leads...'}
    </div>
  );
  const alternarTodos = () => setSel(prev => {
    const n = new Set(prev);
    if(todosMarcados) filtered.forEach(l => n.delete(l.id));
    else abordaveisNaTela.forEach(l => n.add(l.id));
    return n;
  });
  const alternar = (id) => setSel(prev => { const n = new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; });

  const segIcons = LEAD_SEG_ICONS;
  const catIcons = LEAD_CAT_ICONS;

  return (
    <div>
      {/* KPI BAR */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ background:C.white, borderRadius:20, padding:'8px 16px', display:'flex', alignItems:'center', gap:6, border:'1px solid '+C.border }}>
          <span style={{ color:C.p1, fontWeight:700, fontSize:16 }}>{leads.length}</span><span style={{ color:C.muted, fontSize:12 }}>leads</span>
          {carregandoResto && totalBanco && totalBanco > leads.length ? (
            <span title="A lista pinta com a primeira pagina e o resto chega em seguida" style={{ color:C.muted, fontSize:11, marginLeft:4 }}>⏳ carregando {leads.length.toLocaleString('pt-BR')} de {totalBanco.toLocaleString('pt-BR')}…</span>
          ) : null}
          <button onClick={()=>fetchLeads(true)} disabled={carregandoResto} title="Recarregar a lista do banco"
            style={{ marginLeft:6, background:'none', border:'none', cursor: carregandoResto ? 'default' : 'pointer', color:C.muted, fontSize:13, padding:0 }}>↻</button>
        </div>
        {erroCarga ? <span style={{ color:'#b00020', fontSize:12 }}>Parte da lista nao carregou: {erroCarga}</span> : null}
        <div style={{ background:C.white, borderRadius:20, padding:'8px 16px', display:'flex', alignItems:'center', gap:6, border:'1px solid '+C.border }}>
          <span style={{ color:C.p6, fontWeight:700, fontSize:16 }}>{statusCounts.convertido||0}</span><span style={{ color:C.muted, fontSize:12 }}>clientes</span>
        </div>
        {sortedSegments.slice(0,5).map(([seg, count]) => (
          <div key={seg} style={{ background:C.white, borderRadius:20, padding:'8px 16px', display:'flex', alignItems:'center', gap:6, border:'1px solid '+C.border }}>
            <span style={{ fontSize:14 }}>{segIcons[seg]||'📌'}</span>
            <span style={{ color:C.ink, fontWeight:700, fontSize:16 }}>{count}</span>
          </div>
        ))}
      </div>

      {/* SEARCH + FILTERS BAR */}
      <div style={{ background:C.white, borderRadius:14, padding:16, marginBottom:16, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ display:'flex', gap:12, marginBottom:14, alignItems:'center' }}>
          <div style={{ flex:1, position:'relative' }}>
            <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por nome, telefone, segmento, bairro ou @..." style={{ width:'100%', padding:'10px 14px 10px 36px', borderRadius:10, border:'1px solid '+C.border, background:C.bg, color:C.ink, fontSize:13, outline:'none', fontFamily:'DM Sans,sans-serif' }} />
            <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:14, color:C.muted }}>🔍</span>
          </div>
          <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value)} style={{ padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, background:C.bg, color:C.ink, fontSize:12, outline:'none', cursor:'pointer' }}>
            <option value="Todos">Todos status</option>
            {LEADS_STATUS.map(k => <option key={k} value={k.charAt(0).toUpperCase()+k.slice(1)}>{LEADS_STATUS_LABELS[k]}</option>)}
          </select>
          {/* A ordenacao saiu daqui e foi pro cabecalho da tabela, onde a
              coluna esta. No lugar, o que faltava: sair de um filtro. */}
          {filtrosAtivos > 0 ? (
            <button onClick={limparFiltros} title="Voltar a ver todos os leads"
              style={{ padding:'10px 16px', borderRadius:10, border:'1px solid '+C.p1, background:C.p1+'14', color:C.p1, fontSize:12, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap' }}>
              ✕ Limpar {filtrosAtivos} filtro{filtrosAtivos > 1 ? 's' : ''}
            </button>
          ) : null}
          <button onClick={exportCSV} style={{ padding:'10px 16px', borderRadius:10, border:'1px solid '+C.border, background:C.bg, color:C.ink, fontSize:12, cursor:'pointer', fontWeight:600, whiteSpace:'nowrap' }}>⬇ CSV</button>
          <button onClick={()=>setImportOpen(true)} title="Importar leads de uma planilha (Excel salvo como CSV)" style={{ padding:'10px 16px', borderRadius:10, border:'none', background:C.p1, color:'#fff', fontSize:12, cursor:'pointer', fontWeight:700, whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:6 }}>📥 Importar planilha</button>
        </div>

        {/* SEGMENTO + CATEGORIA: dois selects, nao duas fileiras de chips
            (2026-09-08, pedido do usuario: "nao precisa mostrar todos esses
            icones, apenas um campo com dropdown"). Com a base em 1464 leads
            e segmentos vindos de planilha, os chips viraram sete linhas de
            botao que empurravam a tabela pra baixo da dobra. Os mesmos
            states dos filtros do cabecalho da tabela — uma fonte so. */}
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:C.ink }}>
            Segmento
            <select value={filtroSegmento} onChange={e=>setFiltroSegmento(e.target.value)}
              style={{ padding:'8px 10px', borderRadius:10, border:'1.5px solid '+(filtroSegmento!=='TODOS'?C.p1:C.border),
                background:'#fff', color:C.ink, fontSize:13, fontWeight:500, outline:'none', cursor:'pointer', minWidth:220 }}>
              <option value="TODOS">Todos os segmentos ({leads.length})</option>
              {sortedSegments.map(([seg, count]) => (
                <option key={seg} value={seg}>{(segIcons[seg] ? segIcons[seg] + ' ' : '') + seg + ' (' + count + ')'}</option>
              ))}
            </select>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:C.ink }}>
            Categoria
            <select value={filtroCategoria} onChange={e=>setFiltroCategoria(e.target.value)}
              style={{ padding:'8px 10px', borderRadius:10, border:'1.5px solid '+(filtroCategoria!=='Todas'?C.p1:C.border),
                background:'#fff', color:C.ink, fontSize:13, fontWeight:500, outline:'none', cursor:'pointer', minWidth:220 }}>
              <option value="Todas">Todas as categorias ({leads.length})</option>
              {sortedCategories.map(([cat, count]) => (
                <option key={cat} value={cat}>{(catIcons[cat] ? catIcons[cat] + ' ' : '') + cat + ' (' + count + ')'}</option>
              ))}
            </select>
          </label>
          <label title="O que a Meta confirmou sobre a ultima abordagem de cada lead" style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:C.ink }}>
            Entrega
            <select value={fEntrega} onChange={e=>setFEntrega(e.target.value)}
              style={{ padding:'8px 10px', borderRadius:10, border:'1.5px solid '+(fEntrega!=='Todas'?C.p1:C.border),
                background:'#fff', color:C.ink, fontSize:13, fontWeight:500, outline:'none', cursor:'pointer', minWidth:200 }}>
              {Object.keys(ABORDAGEM_GRUPOS).map(k => (
                <option key={k} value={k}>{ABORDAGEM_GRUPO_ROTULOS[k] + ' (' + (contagemEntrega[k]||0) + ')'}</option>
              ))}
            </select>
          </label>
        </div>
        {semColunaAbordagem ? (
          <div style={{ marginTop:12, padding:'10px 12px', background:'#fff4e0', border:'1px solid #f0b35a', borderRadius:10, fontSize:12, color:'#7a4b00', lineHeight:1.5 }}>
            <strong>Falta rodar o SQL do status de entrega</strong> (<code>/migrations/2026-09-09-leads-abordagem-entrega.sql</code>).
            Sem ele o servidor nao consegue amarrar cada envio ao lead, e <strong>nenhum lead vira "contactado" sozinho</strong> — a confirmacao da Meta nao tem onde pousar.
          </div>
        ) : null}
        {selecionados.length > 0 ? (
          <div style={{ marginTop:12, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap',
            padding:'10px 12px', background:C.p1+'14', border:'1px solid '+C.p1, borderRadius:10 }}>
            <span style={{ fontSize:12, fontWeight:700, color:C.ink }}>
              {selecionados.length} {selecionados.length === 1 ? 'lead selecionado' : 'leads selecionados'}
            </span>
            <button onClick={()=>setAbordarLote(selecionados)}
              style={{ background:'#25D366', color:'#fff', border:'none', borderRadius:8, padding:'7px 14px', cursor:'pointer', fontSize:12, fontWeight:700, whiteSpace:'nowrap' }}>
              💬 Abordar {selecionados.length} {selecionados.length === 1 ? 'selecionado' : 'selecionados'}
            </button>
            <button onClick={()=>setSel(new Set())}
              style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:12, color:C.muted }}>
              ✕ Limpar seleção
            </button>
          </div>
        ) : null}
      </div>

      {/* TABLE */}
      <div style={{ background:C.white, borderRadius:14, padding:4, overflowX:'auto', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
        {janela.bloco > 0 ? <div style={{ padding:'8px 0' }}><NavBlocos /></div> : null}
        <table ref={tabelaRef} style={{ width:'100%', borderCollapse:'collapse', fontSize:13, color:C.ink }}>
          <thead>
            <tr style={{ borderBottom:'2px solid '+C.border }}>
              <th style={{ padding:'12px 4px 12px 10px', width:26 }}>
                <input type="checkbox" checked={todosMarcados} onChange={alternarTodos}
                  disabled={abordaveisNaTela.length === 0}
                  title={todosMarcados ? 'Desmarcar os leads desta lista' : 'Marcar todos os leads abordáveis desta lista (' + abordaveisNaTela.length + ')'}
                  style={{ cursor:'pointer', width:15, height:15 }} />
              </th>
              <ThLead rot="NOME" campo="name" ativo={!!fNome} ctx={thCtx}>
                <input autoFocus value={fNome} onChange={e=>setFNome(e.target.value)} placeholder="Buscar no nome…"
                  style={filtroInput} />
              </ThLead>
              <ThLead rot="CIDADE" campo="city" ativo={fCidade!=='Todas'} ctx={thCtx}>
                <OpcoesFiltro valor={fCidade} onPick={setFCidade} fechar={()=>setMenuCol(null)}
                  opcoes={[['Todas','Todas as cidades', leads.length]].concat(
                    Object.entries(cidades).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,k,v]))} />
              </ThLead>
              <ThLead rot="SEGMENTO" campo="segment" ativo={filtroSegmento!=='TODOS'} ctx={thCtx}>
                <OpcoesFiltro valor={filtroSegmento} onPick={setFiltroSegmento} fechar={()=>setMenuCol(null)}
                  opcoes={[['TODOS','Todos os segmentos', leads.length]].concat(
                    Object.entries(segments).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,k,v]))} />
              </ThLead>
              <ThLead rot="CATEGORIA" campo="category" ativo={filtroCategoria!=='Todas'} ctx={thCtx}>
                <OpcoesFiltro valor={filtroCategoria} onPick={setFiltroCategoria} fechar={()=>setMenuCol(null)}
                  opcoes={[['Todas','Todas as categorias', leads.length]].concat(
                    Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,k,v]))} />
              </ThLead>
              <ThLead rot="RATING" campo="rating" ativo={fRating>0} ctx={thCtx}>
                <OpcoesFiltro valor={fRating} onPick={setFRating} fechar={()=>setMenuCol(null)}
                  opcoes={[[0,'Qualquer nota',null],[4.5,'4,5 ou mais',null],[4,'4,0 ou mais',null],[3,'3,0 ou mais',null]]} />
              </ThLead>
              <ThLead rot="TELEFONE" campo="phone" ativo={!!fTel} ctx={thCtx}>
                <input autoFocus value={fTel} onChange={e=>setFTel(e.target.value)} placeholder="Digitos do telefone…"
                  style={filtroInput} />
              </ThLead>
              <ThLead rot="PERFIL DO IG" campo="instagram" ctx={thCtx} />
              <ThLead rot="PRIO." campo="priority" ativo={fPrio!=='Todas'} ctx={thCtx}>
                <OpcoesFiltro valor={fPrio} onPick={setFPrio} fechar={()=>setMenuCol(null)}
                  opcoes={[['Todas','Todas',null],['alta','Alta',null],['media','Média',null],['baixa','Baixa',null]]} />
              </ThLead>
              <ThLead rot="STATUS" campo="status" ativo={filtroStatus!=='Todos'} ctx={thCtx}>
                <OpcoesFiltro valor={filtroStatus} onPick={setFiltroStatus} fechar={()=>setMenuCol(null)}
                  opcoes={[['Todos','Todos', statusCounts.total]].concat(
                    LEADS_STATUS.map(k =>
                      [k.charAt(0).toUpperCase()+k.slice(1), LEADS_STATUS_LABELS[k], statusCounts[k]]))} />
              </ThLead>
              <ThLead rot="AÇÃO" ctx={thCtx} />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={11} style={{ padding:'30px 10px', color:C.muted, textAlign:'center' }}>Nenhum lead encontrado.</td></tr>
            )}
            {visiveis.map((l, i) => {
              const sc = statusColor(l.status);
              const pc = prioColor(l.priority);
              const segColor = segColors[(l.segment||'').toUpperCase()] || C.muted;
              const stars = l.rating ? '★'.repeat(Math.min(5,Math.round(Number(l.rating)))) : '';
              return (
                <tr key={l.id || i} style={{ borderBottom:'1px solid '+C.border, transition:'background 0.15s', background: sel.has(l.id) ? C.p1+'0d' : 'transparent' }} onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,0.02)'} onMouseLeave={e=>e.currentTarget.style.background = sel.has(l.id) ? C.p1+'0d' : 'transparent'}>
                  <td style={{ padding:'12px 4px 12px 10px' }}>
                    <input type="checkbox" checked={sel.has(l.id)} onChange={()=>alternar(l.id)}
                      disabled={!abordavel(l)}
                      title={abordavel(l) ? 'Marcar pra abordar em lote' : (l.opted_out_at ? 'Pediu pra não receber' : l.status === 'fixo' ? 'Marcado como fixo (sem WhatsApp)' : 'Sem telefone válido')}
                      style={{ cursor: abordavel(l) ? 'pointer' : 'not-allowed', width:15, height:15 }} />
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <div style={{ fontWeight:600, color:C.ink }}>{l.name || '—'}</div>
                    <div style={{ fontSize:11, color:C.muted }}>{l.address || '—'}</div>
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <div style={{ color:C.ink, fontSize:12 }}>{cidadeDoLead(l) || '—'}</div>
                    {l.neighborhood ? <div style={{ fontSize:11, color:C.muted }}>{l.neighborhood}</div> : null}
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <StatusBadge status={(l.segment||'—').toUpperCase()} colorMap={LEAD_SEG_COLORS} labelMap={{}} />
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <span style={{ background:'rgba(0,0,0,0.06)', color:C.ink, borderRadius:6, padding:'3px 10px', fontSize:11 }}>{l.category || '—'}</span>
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <span style={{ color:'#f5a623' }}>{stars}</span>
                    <span style={{ color:C.ink, marginLeft:4 }}>{l.rating ? Number(l.rating).toFixed(1) : '—'}</span>
                    {l.review_count != null && <div style={{ fontSize:10, color:C.muted }}>({l.review_count})</div>}
                  </td>
                  <td style={{ padding:'12px 10px', color:l.phone ? C.p3 : C.muted }}>{l.phone || '—'}</td>
                  <td style={{ padding:'12px 10px' }}>
                    {l.instagram
                      ? <a href={urlDoIg(l.instagram)} target="_blank" rel="noopener noreferrer" style={{ color:'#8338ec', fontWeight:600, textDecoration:'none' }}>@{normalizarIg(l.instagram)}</a>
                      : <span style={{ color:C.muted }}>—</span>}
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <span style={{ color:pc }}>● </span>
                    <span style={{ color:C.ink, textTransform:'capitalize' }}>{l.priority || '—'}</span>
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    <select value={l.status||'novo'} onChange={e=>updateStatus(l.id, e.target.value)} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid '+C.border, background:C.bg, color:C.ink, fontSize:11, outline:'none', cursor:'pointer' }}>
                      {LEADS_STATUS.map(k => <option key={k} value={k}>{LEADS_STATUS_LABELS[k]}</option>)}
                    </select>
                    <AbordagemBadge lead={l} />
                  </td>
                  <td style={{ padding:'12px 10px' }}>
                    {l.phone ? (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        {/* Quem tocou em "Nao tenho interesse" sai da abordagem.
                            O botao fica VISIVEL e desabilitado, nao some: sumir
                            faria parecer que o lead esta sem telefone. */}
                        <button onClick={()=>{ if(!l.opted_out_at) setAbordar(l); }}
                          disabled={!!l.opted_out_at}
                          title={l.opted_out_at ? 'Este contato pediu para nao receber mais abordagem' : 'Abordagem personalizada pelo numero da loja'}
                          style={{ background: l.opted_out_at ? C.border : '#25D366', color: l.opted_out_at ? C.muted : '#fff', border:'none', borderRadius:8, padding:'6px 12px', cursor: l.opted_out_at ? 'not-allowed' : 'pointer', fontSize:11, fontWeight:600, display:'flex', alignItems:'center', gap:4, whiteSpace:'nowrap' }}>
                          <span>{l.opted_out_at ? '🚫' : '💬'}</span> {l.opted_out_at ? 'Nao abordar' : 'Abordar'}
                        </button>
                        {/* Canal alternativo: abre no aparelho do operador. */}
                        <button onClick={()=>openWhatsApp(l.phone, l.name)} title="Abrir no MEU WhatsApp (nao usa o numero da loja)"
                          style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'5px 8px', cursor:'pointer', fontSize:12 }}>📱</button>
                      </div>
                    ) : l.instagram ? (
                      /* Lead so com Instagram (grafiteiros da Click Rua): a
                         abordagem e pelo perfil, nao pelo WhatsApp da loja. */
                      <a href={urlDoIg(l.instagram)} target="_blank" rel="noopener noreferrer"
                        style={{ background:'#8338ec', color:'#fff', borderRadius:8, padding:'6px 12px', fontSize:11, fontWeight:600, textDecoration:'none', whiteSpace:'nowrap', display:'inline-flex', alignItems:'center', gap:4 }}>
                        <span>📸</span> Abrir IG
                      </a>
                    ) : <span style={{ color:C.muted }}>—</span>}
                  </td>
                </tr>
              );
            })}
            {filtered.length > visiveis.length ? (
              <tr ref={janela.fimDoBloco ? null : sentinelaRef}>
                <td colSpan={11} style={{ padding:'14px 10px', color:C.muted, textAlign:'center', fontSize:12 }}>
                  <div style={{ marginBottom: janela.nBlocos > 1 ? 8 : 0 }}>
                    Mostrando {(janela.de + 1).toLocaleString('pt-BR')}–{janela.ate.toLocaleString('pt-BR')} de {filtered.length.toLocaleString('pt-BR')}
                    {janela.fimDoBloco ? '' : ' — role pra ver mais'}
                    {janela.fimDoBloco ? null : <span> ou <button onClick={()=>setLimite(LEADS_BLOCO)} style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'2px 8px', cursor:'pointer', fontSize:12, color:C.ink }}>mostrar o bloco inteiro ({LEADS_BLOCO})</button></span>}
                  </div>
                  <NavBlocos />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <ImportarPlanilhaModal open={importOpen} onClose={()=>setImportOpen(false)} onPronto={()=>fetchLeads(true)} existingLeads={leads} />
      {abordar ? (
        <AbordagemModal
          lead={abordar}
          onClose={()=>setAbordar(null)}
          onSent={()=>mesclarRecentes()}
        />
      ) : null}
      {abordarLote ? (
        <AbordagemLoteModal
          leads={abordarLote}
          onClose={()=>setAbordarLote(null)}
          onSent={()=>{ mesclarRecentes(); setSel(new Set()); }}
        />
      ) : null}
    </div>
  );
};

// Status de orcamento — novo ciclo:
// pending -> rascunho -> enviado -> aprovado -> em_execucao -> concluido (+ recusado)
// Legacy: accepted/completed/rejected mantidos como sinonimos.
const QUOTE_STATUS = {
  pending:      { label: 'Aguardando',  cat: 'pending' },
  rascunho:     { label: 'Rascunho',    cat: 'pending' },
  enviado:      { label: 'Enviado',     cat: 'progress' },
  aprovado:     { label: 'Aprovado',    cat: 'progress' },
  em_execucao:  { label: 'Em execução', cat: 'progress' },
  concluido:    { label: 'Concluído',   cat: 'done' },
  recusado:     { label: 'Recusado',    cat: 'rejected' },
  // Legacy / backward compat
  accepted:     { label: 'Aceito',      cat: 'progress' },
  completed:    { label: 'Concluído',   cat: 'done' },
  rejected:     { label: 'Rejeitado',   cat: 'rejected' },
};
const quoteStatusInfo = (s) => QUOTE_STATUS[s] || { label: s || '—', cat: 'pending' };
// Cores por categoria: verde p/ concluido, azul p/ em andamento, cinza p/ pendente, vermelho p/ recusado
const QUOTE_STATUS_COLORS = {
  done:     { bg: C.p6 + '22', fg: C.p6 },        // verde
  progress: { bg: C.p3 + '22', fg: C.p3 },        // azul/turquesa
  pending:  { bg: C.p7 + '44', fg: '#b8860b' },   // amarelo/cinza
  rejected: { bg: C.p4 + '22', fg: C.p4 },        // vermelho
};
const quoteStatusStyle = (s) => {
  const info = quoteStatusInfo(s);
  const col = QUOTE_STATUS_COLORS[info.cat] || QUOTE_STATUS_COLORS.pending;
  return { background: col.bg, color: col.fg, borderRadius: 8, padding: '3px 10px', fontSize: 11 };
};
// Mantido por compat: STATUS_MAP[status] devolve so o label.
const STATUS_MAP = Object.fromEntries(Object.entries(QUOTE_STATUS).map(([k,v]) => [k, v.label]));

const Orcamentos = () => {
  const { data, loading } = useSupabaseQuery((sb) => sb
    .from('quotes')
    .select('*, client:profiles!client_id(name), painter:profiles!painter_id(name)')
    .order('created_at', { ascending: false }), []);
  const orcamentos = data || [];

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando orçamentos...</div>;

  return (
    <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight:700, marginBottom:16, color:C.ink }}>📋 Orçamentos</div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
        <thead>
          <tr style={{ borderBottom:'2px solid '+C.border }}>
            {['Cliente','Pintor','Serviço','Valor','Status','Data'].map(h => (
              <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orcamentos.length === 0 && (
            <tr><td colSpan={6} style={{ padding: '20px 12px', color: C.muted, textAlign: 'center' }}>Nenhum orçamento encontrado.</td></tr>
          )}
          {orcamentos.map((o, i) => {
            const stInfo = quoteStatusInfo(o.status);
            const data = o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—';
            return (
              <tr key={o.id || i} style={{ borderBottom:'1px solid '+C.border }}>
                <td style={{ padding:'10px 12px' }}>{o.client?.name || '—'}</td>
                <td style={{ padding:'10px 12px' }}>{o.painter?.name || '—'}</td>
                <td style={{ padding:'10px 12px', color:C.muted }}>{o.service_type || o.title || '—'}</td>
                <td style={{ padding:'10px 12px', fontWeight:700 }}>{o.price != null ? 'R$ ' + Number(o.price).toLocaleString('pt-BR') : '—'}</td>
                <td style={{ padding:'10px 12px' }}>
                  <span style={quoteStatusStyle(o.status)}>{stInfo.label}</span>
                </td>
                <td style={{ padding:'10px 12px', color:C.muted }}>{data}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const ClientesList = () => {
  const { data, loading, refetch: fetchClientes } = useSupabaseQuery(async (sb) => {
    const profiles = await profilesService.list({ clienteOnly: true, order: 'created_at', ascending: false });
    // Load invite codes generated by each user
    const { data: invites } = await sb.from('invites').select('code, created_by').order('created_at', { ascending: false });
    const inviteMap = {};
    (invites || []).forEach(inv => {
      if (!inviteMap[inv.created_by]) inviteMap[inv.created_by] = [];
      inviteMap[inv.created_by].push(inv.code);
    });
    return profiles.map(p => ({ ...p, _generated_codes: inviteMap[p.id] || [] }));
  }, []);
  const clientes = data || [];
  const [selIds, setSelIds] = useState([]);
  const toggleSel = (id) => setSelIds(s => s.includes(id) ? s.filter(x => x !== id) : s.concat(id));
  const allSel = clientes.length > 0 && selIds.length === clientes.length;

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando clientes...</div>;

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>👥 Clientes Cadastrados ({clientes.length})</div>
      <CreateAppUserForm onCreated={fetchClientes} defaultRole="cliente" />
      <BulkDeleteBar list={clientes} selIds={selIds} setSelIds={setSelIds} after={fetchClientes} />
      {clientes.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum cliente cadastrado.</div>}
      <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:800 }}>
        {clientes.length > 0 && (
          <thead>
            <tr style={{ borderBottom:'2px solid '+C.border }}>
              <th style={{ padding:'8px 12px', width:34 }}>
                <input type="checkbox" checked={allSel} onChange={e => setSelIds(e.target.checked ? clientes.map(x => x.id) : [])} title="Selecionar todos" />
              </th>
              {['Nome','Tipo','@Tag','Email','Telefone','Cidade','Estado','Cadastro','Codigo Gerado','Codigo Utilizado','PRO','Portal'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {clientes.map((c, i) => {
            const data = c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—';
            return (
              <tr key={c.id || i} style={{ borderBottom:'1px solid '+C.border, background: selIds.includes(c.id) ? C.cream : 'transparent' }}>
                <td style={{ padding:'10px 12px' }}>
                  <input type="checkbox" checked={selIds.includes(c.id)} onChange={() => toggleSel(c.id)} />
                </td>
                <td style={{ padding:'10px 12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <AvatarCell name={c.name} avatarUrl={c.avatar_url} size={32} />
                    <NameCell profile={c} after={fetchClientes} />
                  </div>
                </td>
                <td style={{ padding:'10px 12px' }}><RoleSelect profile={c} after={fetchClientes} /></td>
                <td style={{ padding:'10px 12px' }}><TagCell profile={c} after={fetchClientes} /></td>
                <td style={{ padding:'10px 12px', fontSize:12 }}><EmailCell profile={c} after={fetchClientes} /></td>
                <td style={{ padding:'10px 12px', fontSize:12 }}><PhoneCell profile={c} after={fetchClientes} /></td>
                <td style={{ padding:'10px 12px' }}><CityCell profile={c} after={fetchClientes} /></td>
                <td style={{ padding:'10px 12px' }}><StateCell profile={c} after={fetchClientes} /></td>
                <td style={{ padding:'10px 12px', color:C.muted }}>{data}</td>
                <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:11, fontWeight:700, letterSpacing:1 }}>{c._generated_codes && c._generated_codes.length > 0 ? c._generated_codes.join(', ') : '—'}</td>
                <td style={{ padding:'10px 12px', fontFamily:'monospace', fontSize:11, fontWeight:700, letterSpacing:1 }}>{c.invite_code_used || '—'}</td>
                <td style={{ padding:'10px 12px' }}>
                  <ProBadgeCell profile={c} onChange={fetchClientes} />
                </td>
                <td style={{ padding:'10px 12px' }}>
                  <PortalAccessCell profile={c} onChange={fetchClientes} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
};

const PostsModeracao = () => {
  const [filter, setFilter] = useState('pending');
  const { data, loading, refetch: fetchPosts } = useSupabaseQuery((sb) => {
    let query = sb.from('posts').select('*, profiles!user_id(name, tag, avatar_url, role)').order('created_at', { ascending: false }).limit(50);
    if(filter === 'pending') query = query.eq('status','pending');
    else if(filter === 'rejected') query = query.eq('status','rejected');
    return query;
  }, [filter]);
  const posts = data || [];

  const updateStatus = async (id, status) => {
    try {
      await postsService.setStatus(id, status);
      fetchPosts();
    } catch (e) { alert('Erro ao atualizar post: ' + (e.message || e)); }
  };

  const deletePost = async (id) => {
    if(!confirm('Deletar permanentemente?')) return;
    try {
      await postsService.deleteWithChildren(id);
      fetchPosts();
    } catch (e) { alert('Erro ao deletar post: ' + (e.message || e)); }
  };

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {['pending','rejected','all'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ padding:'8px 16px', borderRadius:8, border: filter===f?'2px solid '+C.p1:'1.5px solid '+C.border, background: filter===f?'rgba(255,107,53,0.08)':'#fff', color: filter===f?C.p1:C.ink, fontWeight:700, fontSize:12, cursor:'pointer' }}>
            {f==='pending'?'⏳ Pendentes':f==='rejected'?'❌ Rejeitados':'📋 Todos'}
          </button>
        ))}
      </div>
      {loading && <div style={{ color:C.muted, padding:20 }}>Carregando...</div>}
      {!loading && posts.length===0 && <div style={{ color:C.muted, padding:20, textAlign:'center' }}>Nenhum post {filter==='pending'?'pendente':'encontrado'} 🎉</div>}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12 }}>
        {posts.map(p => {
          const prof = p.profiles || {};
          const isVideo = p.media_url && (p.media_url.includes('.mp4') || p.media_type === 'video');
          return (
            <div key={p.id} style={{ background:C.white, borderRadius:14, overflow:'hidden', boxShadow:'0 2px 10px rgba(0,0,0,0.06)', border: p.status==='pending'?'2px solid #f0ad4e':p.status==='rejected'?'2px solid #e74c3c':'1px solid '+C.border }}>
              {p.media_url && (isVideo ?
                <video src={p.media_url} controls style={{ width:'100%', maxHeight:200, objectFit:'cover' }} /> :
                <img src={p.media_url} style={{ width:'100%', maxHeight:200, objectFit:'cover' }} />
              )}
              <div style={{ padding:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <img src={prof.avatar_url || 'https://ui-avatars.com/api/?name=U&size=32'} style={{ width:28, height:28, borderRadius:'50%', objectFit:'cover' }} />
                  <div>
                    <div style={{ fontSize:12, fontWeight:700 }}>{prof.name || 'User'}</div>
                    <div style={{ fontSize:10, color:C.muted }}>{prof.tag ? '@'+prof.tag : ''} · {prof.role || 'cliente'}</div>
                  </div>
                  <span style={{ marginLeft:'auto' }}>
                    <StatusBadge status={p.status || 'pending'} colorMap={POSTS_STATUS_COLORS} labelMap={POSTS_STATUS_LABELS} />
                  </span>
                </div>
                {p.caption && <div style={{ fontSize:12, color:C.ink, marginBottom:8 }}>{p.caption}</div>}
                <div style={{ fontSize:10, color:C.muted, marginBottom:10 }}>{new Date(p.created_at).toLocaleString('pt-BR')}</div>
                <div style={{ display:'flex', gap:6 }}>
                  {p.status !== 'approved' && <button onClick={() => updateStatus(p.id, 'approved')} style={{ flex:1, padding:'6px 10px', background:'#28a745', color:'#fff', border:'none', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>✓ Aprovar</button>}
                  {p.status !== 'rejected' && <button onClick={() => updateStatus(p.id, 'rejected')} style={{ flex:1, padding:'6px 10px', background:'#ffc107', color:'#333', border:'none', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>✗ Rejeitar</button>}
                  <button aria-label="Excluir post" onClick={() => deletePost(p.id)} style={{ padding:'6px 10px', background:'#dc3545', color:'#fff', border:'none', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>🗑</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const AvaliacoesList = () => {
  const { data, loading } = useSupabaseQuery((sb) => sb
    .from('quotes')
    .select('*, client:profiles!client_id(name, rating_avg), painter:profiles!painter_id(name, rating_avg)')
    .order('created_at', { ascending: false }), []);
  const quotes = data || [];

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando avaliações...</div>;

  const rated = quotes.filter(q => q.painter?.rating_avg != null || q.client?.rating_avg != null);

  return (
    <div>
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>⭐ Avaliações — Pintores</div>
        {quotes.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum orçamento encontrado para avaliar.</div>}
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          {quotes.length > 0 && (
            <thead>
              <tr style={{ borderBottom:'2px solid '+C.border }}>
                {['Pintor','Nota Média','Cliente','Serviço','Status','Data'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {quotes.map((q, i) => {
              const st = STATUS_MAP[q.status] || q.status;
              const data = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) : '—';
              const rating = q.painter?.rating_avg;
              return (
                <tr key={q.id || i} style={{ borderBottom:'1px solid '+C.border }}>
                  <td style={{ padding:'10px 12px', fontWeight:600 }}>{q.painter?.name || '—'}</td>
                  <td style={{ padding:'10px 12px' }}>
                    {rating != null ? (
                      <span style={{ color:C.p1 }}>{'★'.repeat(Math.round(Number(rating)))}{'☆'.repeat(5-Math.round(Number(rating)))} {Number(rating).toFixed(1)}</span>
                    ) : <span style={{ color:C.muted }}>—</span>}
                  </td>
                  <td style={{ padding:'10px 12px' }}>{q.client?.name || '—'}</td>
                  <td style={{ padding:'10px 12px', color:C.muted }}>{q.service_type || '—'}</td>
                  <td style={{ padding:'10px 12px' }}>
                    <span style={{ background:st==='aceito'?C.p6+'22':st==='pendente'?C.p7+'44':st==='concluido'?C.p3+'22':C.p4+'22', color:st==='aceito'?C.p6:st==='pendente'?'#b8860b':st==='concluido'?C.p3:C.p4, borderRadius:8, padding:'3px 10px', fontSize:11 }}>{st}</span>
                  </td>
                  <td style={{ padding:'10px 12px', color:C.muted }}>{data}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CursosList = () => {
  const { data, loading } = useSupabaseQuery((sb) => sb
    .from('profiles')
    .select('id, name, city, state, verified, rating_avg')
    .order('rating_avg', { ascending: false }), []);
  const profiles = (data || []).filter(p => p.verified);

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando cursos...</div>;

  return (
    <div>
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: C.ink }}>📚 Cursos — Pintores Verificados</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Pintores verificados podem criar e vender cursos na plataforma.</div>
        {profiles.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum pintor verificado ainda. Aprove pintores na seção Pintores para habilitar cursos.</div>}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
          {profiles.map((p, i) => (
            <div key={p.id || i} style={{ background:C.bg, borderRadius:12, padding:16, border:'1px solid '+C.border }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                <div style={{ width:36, height:36, borderRadius:'50%', background:C.p1+'22', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:C.p1, fontSize:14 }}>{(p.name || '?')[0]}</div>
                <div>
                  <div style={{ fontWeight:600, fontSize:13 }}>{p.name || 'Sem nome'}</div>
                  <div style={{ fontSize:11, color:C.muted }}>{[p.city, p.state].filter(Boolean).join(', ')}</div>
                </div>
              </div>
              <div style={{ fontSize:12, color:C.p1 }}>⭐ {p.rating_avg != null ? Number(p.rating_avg).toFixed(1) : '—'}</div>
              <div style={{ background:C.p6+'22', color:C.p6, borderRadius:8, padding:'3px 10px', fontSize:11, fontWeight:600, display:'inline-block', marginTop:8 }}>✓ Verificado</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const MarketingPage = () => {
  const { data, loading } = useSupabaseQuery(async (sb) => {
    const [pRes, lRes, qRes] = await Promise.all([
      sb.from('profiles').select('id', { count: 'exact', head: true }),
      sb.from('leads').select('id', { count: 'exact', head: true }),
      sb.from('quotes').select('id', { count: 'exact', head: true }),
    ]);
    return { data: { profiles: pRes.count || 0, leads: lRes.count || 0, quotes: qRes.count || 0 } };
  }, []);
  const stats = data || { profiles: 0, leads: 0, quotes: 0 };

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando marketing...</div>;

  const convRate = stats.profiles > 0 ? ((stats.quotes / stats.profiles) * 100).toFixed(1) : '0';

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:24 }}>
        <KPICard title="Alcance (Perfis)" value={stats.profiles} sub="base total" trend="" color={C.p3} />
        <KPICard title="Leads Captados" value={stats.leads} sub="funil de entrada" trend="" color={C.p5} />
        <KPICard title="Taxa de Conversão" value={convRate + '%'} sub="perfis → orçamentos" trend="" color={C.p1} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight:700, marginBottom:12, color:C.ink }}>📣 Funil de Marketing</div>
          {[
            { label:'Perfis cadastrados', value:stats.profiles, pct:100 },
            { label:'Leads captados', value:stats.leads, pct: stats.profiles ? Math.round(stats.leads/stats.profiles*100) : 0 },
            { label:'Orçamentos gerados', value:stats.quotes, pct: stats.profiles ? Math.round(stats.quotes/stats.profiles*100) : 0 },
          ].map((s,i) => (
            <div key={i} style={{ marginBottom:12 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:13 }}>{s.label}</span>
                <span style={{ fontSize:13, fontWeight:700 }}>{s.value}</span>
              </div>
              <div style={{ background:C.border, borderRadius:4, height:8 }}>
                <div style={{ background:C.p1, height:8, borderRadius:4, width:Math.min(Math.max(s.pct,2),100)+'%' }}></div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background:C.white, borderRadius:16, padding:20, boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
          <div style={{ fontWeight:700, marginBottom:12, color:C.ink }}>💡 Insights</div>
          <div style={{ fontSize:13, color:C.ink, lineHeight:1.8 }}>
            <div style={{ padding:'8px 0', borderBottom:'1px solid '+C.border }}>📊 <b>{stats.profiles}</b> perfis na base</div>
            <div style={{ padding:'8px 0', borderBottom:'1px solid '+C.border }}>🧲 <b>{stats.leads}</b> leads captados</div>
            <div style={{ padding:'8px 0', borderBottom:'1px solid '+C.border }}>📋 <b>{stats.quotes}</b> orçamentos solicitados</div>
            <div style={{ padding:'8px 0' }}>📈 Taxa de conversão: <b>{convRate}%</b></div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ══ AVISOS (Announcements) ══
const Avisos = () => {
  const { data, loading, refetch: loadAvisos } = useSupabaseQuery((sb) => sb
    .from('announcements').select('*').order('created_at', { ascending: false }), []);
  const avisos = data || [];
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const saveAviso = async () => {
    if(!title.trim()){ alert('Preencha o titulo'); return; }
    if(!message.trim()){ alert('Preencha a mensagem'); return; }
    setSaving(true);
    try {
      const { data: { session } } = await supa.auth.getSession();
      await announcementsService.insert({
        title: title.trim(),
        message: message.trim(),
        active: true,
        created_by: session?.user?.id || null,
        created_at: new Date().toISOString()
      });
      setTitle(''); setMessage('');
      loadAvisos();
    } catch(e){ alert('Erro: ' + (e.message || 'tente novamente')); }
    setSaving(false);
  };

  const toggleAviso = async (id, active) => {
    try {
      // active recebido eh o estado atual; toggle = !active
      await announcementsService.toggle(id, !active);
      loadAvisos();
    } catch(e){ console.warn('toggleAviso error:', e); }
  };

  const deleteAviso = async (id) => {
    if(!confirm('Tem certeza que deseja excluir este aviso?')) return;
    try {
      await announcementsService.remove(id);
      loadAvisos();
    } catch(e){ console.warn('deleteAviso error:', e); }
  };

  return (
    <div>
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>📢 Criar Novo Aviso</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Titulo</div>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex: Promocao de tintas" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Mensagem</div>
          <textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Escreva o conteudo do aviso..." rows={3} style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none', resize:'vertical', fontFamily:'DM Sans, sans-serif' }} />
        </div>
        <button disabled={saving} onClick={saveAviso} style={{ padding:'10px 24px', background:C.p1, color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:700, cursor:'pointer' }}>
          {saving ? 'Salvando...' : 'Publicar Aviso'}
        </button>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>Este aviso aparecera na aba de notificacoes do app para todos os usuarios.</div>
      </div>

      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>Avisos Publicados</div>
        {loading && <div style={{ color: C.muted, fontSize: 13 }}>Carregando...</div>}
        {!loading && avisos.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum aviso publicado ainda.</div>}
        {avisos.map(a => (
          <div key={a.id} style={{ borderBottom:'1px solid '+C.border, padding:'14px 0', display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ fontSize: 24 }}>{a.active ? '📢' : '🔇'}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: a.active ? C.ink : C.muted }}>{a.title}</div>
              <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{a.message}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}</div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button onClick={()=>toggleAviso(a.id, a.active)} style={{ background: a.active ? C.p7+'33' : C.p6+'33', border:'none', borderRadius:8, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer', color: a.active ? '#b8860b' : C.p6 }}>
                {a.active ? 'Desativar' : 'Ativar'}
              </button>
              <button onClick={()=>deleteAviso(a.id)} style={{ background:C.p4+'22', border:'none', borderRadius:8, padding:'4px 10px', fontSize:11, fontWeight:600, cursor:'pointer', color:C.p4 }}>Excluir</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ══ PEDIDOS DA LOJA (Orders) ══
const PedidosLoja = () => {
  // Busca em 2 passos (sem embed PostgREST `profiles!user_id`): a FK de
  // orders.user_id aponta pra auth.users, não pra profiles, então o embed
  // quebrava a query inteira e a tela ficava "Nenhum pedido recebido".
  // RLS (orders_admin_view = is_portal_admin) continua filtrando.
  const { data, loading, refetch } = useSupabaseQuery(async (sb) => {
    const { data: rows, error } = await sb
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return { error };
    const list = rows || [];
    const userIds = [...new Set(list.map((o) => o.user_id).filter(Boolean))];
    const pmap = {};
    if (userIds.length) {
      const { data: profs } = await sb
        .from('profiles')
        .select('id, name, phone, city, state, tag')
        .in('id', userIds);
      (profs || []).forEach((p) => { pmap[p.id] = p; });
    }
    return { data: list.map((o) => ({ ...o, user: pmap[o.user_id] || null })) };
  }, []);
  const orders = data || [];
  const [detailOrder, setDetailOrder] = React.useState(null);
  const brl = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');

  const updateOrderStatus = async (id, status) => {
    try {
      await ordersService.updateStatus(id, status);
      refetch();
    } catch(e){ alert('Não foi possível atualizar o pedido: ' + (e.message || e)); console.warn('updateOrderStatus error:', e); }
  };

  return (
    <div>
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>🛒 Pedidos da Loja</div>
        {loading && <div style={{ color: C.muted, fontSize: 13 }}>Carregando pedidos...</div>}
        {!loading && orders.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum pedido recebido ainda.</div>}
        <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          {orders.length > 0 && (
            <thead>
              <tr style={{ borderBottom:'2px solid '+C.border }}>
                {['Cliente','Telefone','Itens','Total','Status','Data','Acoes'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {orders.map((o, i) => {
              const user = o.user || {};
              const items = o.items || [];
              const st = o.status || 'pending';
              const data = o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
              return (
                <tr key={o.id || i} onClick={() => setDetailOrder(o)} style={{ borderBottom:'1px solid '+C.border, cursor:'pointer' }}>
                  <td style={{ padding:'10px 12px', fontWeight:600 }}>{user.name || '—'}{user.tag ? ' @'+user.tag : ''}</td>
                  <td style={{ padding:'10px 12px', color:C.muted }}>{user.phone || '—'}</td>
                  <td style={{ padding:'10px 12px', maxWidth:280 }}>
                    {items.length ? items.map((it, idx) => (
                      <div key={idx} style={{ lineHeight:1.35 }}>
                        <span style={{ fontWeight:600 }}>{(Number(it.qty)||1)}×</span> {it.name || 'Item'}
                        {it.volume ? <span style={{ color:C.muted }}> · {it.volume}</span> : null}
                      </div>
                    )) : '—'}
                  </td>
                  <td style={{ padding:'10px 12px', fontWeight:700, color:C.p1 }}>R${Number(o.total||0).toFixed(2).replace('.',',')}</td>
                  <td style={{ padding:'10px 12px' }}>
                    <StatusBadge status={st} colorMap={ORDERS_STATUS_COLORS} labelMap={ORDERS_STATUS_LABELS} />
                  </td>
                  <td style={{ padding:'10px 12px', color:C.muted }}>{data}</td>
                  <td style={{ padding:'10px 12px' }} onClick={e=>e.stopPropagation()}>
                    <select value={st} onChange={e=>updateOrderStatus(o.id, e.target.value)} style={{ padding:'4px 8px', borderRadius:8, border:'1px solid '+C.border, fontSize:12, cursor:'pointer' }}>
                      <option value="pending">Aguardando</option>
                      <option value="processing">Em andamento</option>
                      <option value="shipped">Enviado</option>
                      <option value="completed">Concluido</option>
                      <option value="canceled">Cancelado</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {detailOrder && (() => {
        const o = detailOrder;
        const u = o.user || {};
        const its = o.items || [];
        const st = o.status || 'pending';
        const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '—';
        const hasPay = o.gateway || o.tx_id || o.paid_at || o.paid_amount != null;
        const sec = { fontWeight:700, fontSize:12, textTransform:'uppercase', color:C.muted, margin:'16px 0 6px', letterSpacing:0.4 };
        const row = (label, val) => (
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'4px 0', fontSize:13 }}>
            <span style={{ color:C.muted }}>{label}</span>
            <span style={{ fontWeight:600, textAlign:'right' }}>{val}</span>
          </div>
        );
        return (
          <div role="dialog" aria-modal="true" onClick={()=>setDetailOrder(null)}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div onClick={e=>e.stopPropagation()}
              style={{ background:C.white, borderRadius:16, padding:24, width:'100%', maxWidth:520, maxHeight:'85vh', overflowY:'auto', boxShadow:'0 10px 40px rgba(0,0,0,0.25)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ fontWeight:700, fontSize:16, color:C.ink }}>🛒 Pedido #{String(o.id||'').slice(0,8)}</div>
                <button onClick={()=>setDetailOrder(null)} aria-label="Fechar" style={{ border:'none', background:'transparent', fontSize:24, cursor:'pointer', color:C.muted, lineHeight:1 }}>×</button>
              </div>

              <div style={sec}>Cliente</div>
              {row('Nome', (u.name||'—') + (u.tag ? ' @'+u.tag : ''))}
              {row('Telefone', u.phone||'—')}
              {row('Cidade/UF', [u.city, u.state].filter(Boolean).join('/') || '—')}

              <div style={sec}>Itens</div>
              {its.length ? its.map((it, idx) => {
                const q = Number(it.qty)||1; const unit = Number(it.price)||0;
                return (
                  <div key={idx} style={{ display:'flex', justifyContent:'space-between', gap:12, padding:'6px 0', borderBottom:'1px solid '+C.border, fontSize:13 }}>
                    <span><span style={{ fontWeight:600 }}>{q}×</span> {it.name||'Item'}{it.volume ? <span style={{ color:C.muted }}> · {it.volume}</span> : null}</span>
                    <span style={{ whiteSpace:'nowrap', textAlign:'right' }}>{brl(unit)} <span style={{ color:C.muted, fontSize:11 }}>= {brl(unit*q)}</span></span>
                  </div>
                );
              }) : <div style={{ color:C.muted, fontSize:13 }}>—</div>}
              <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', fontWeight:700, fontSize:15 }}>
                <span>Total</span><span style={{ color:C.p1 }}>{brl(o.total)}</span>
              </div>

              <div style={sec}>Pedido</div>
              {row('Data', dt)}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:'4px 0' }}>
                <span style={{ color:C.muted, fontSize:13 }}>Status</span>
                <select value={st} onChange={e=>{ updateOrderStatus(o.id, e.target.value); setDetailOrder(null); }} style={{ padding:'4px 8px', borderRadius:8, border:'1px solid '+C.border, fontSize:12, cursor:'pointer' }}>
                  <option value="pending">Aguardando</option>
                  <option value="processing">Em andamento</option>
                  <option value="shipped">Enviado</option>
                  <option value="completed">Concluido</option>
                  <option value="canceled">Cancelado</option>
                </select>
              </div>

              <div style={sec}>Pagamento</div>
              {hasPay ? (
                <>
                  {row('Gateway', o.gateway||'—')}
                  {row('Transação', o.tx_id||'—')}
                  {row('Valor pago', o.paid_amount!=null ? brl(o.paid_amount) : '—')}
                  {row('Método', o.payment_method||'—')}
                  {row('Pago em', o.paid_at ? new Date(o.paid_at).toLocaleString('pt-BR') : '—')}
                  {o.receipt_url ? <a href={o.receipt_url} target="_blank" rel="noreferrer" style={{ color:C.p1, fontSize:13 }}>Ver comprovante</a> : null}
                </>
              ) : (
                <div style={{ color:C.muted, fontSize:13, fontStyle:'italic' }}>Aguardando pagamento / contato (pagamento online ainda não ativado).</div>
              )}

              <div style={sec}>Entrega</div>
              <div style={{ color:C.muted, fontSize:13, fontStyle:'italic' }}>
                {o.shipping_address || 'Endereço não informado (captura no checkout ainda não implementada).'}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const PortalUsersList = () => {
  const { data, loading, refetch: fetchUsers } = useSupabaseQuery(() => profilesService
    .list({ portalOnly: true, order: 'created_at', ascending: false }), []);
  const users = data || [];
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name:'', email:'', password:'' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');

  const createUser = async () => {
    setFormError(''); setFormMsg('');
    const name = form.name.trim(), email = form.email.trim(), password = form.password;
    if (!email || !password) { setFormError('Email e senha sao obrigatorios'); return; }
    if (password.length < 8) { setFormError('Senha deve ter no minimo 8 caracteres'); return; }
    setSaving(true);
    try {
      const tag = (email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '') + '_' + Math.random().toString(36).slice(2, 7);
      const res = await authService.signUpAppUser({
        name: name || email,
        email,
        password,
        role: 'admin',
        portalAccess: true,
        userMetadata: { role: 'admin', tag },
        extraProfile: { email, tag }
      });
      if (!res.ok) { setFormError(res.error || 'Erro ao criar usuario'); return; }
      setFormMsg('Usuario criado com sucesso. Ele ja pode entrar no portal com essas credenciais.');
      setForm({ name:'', email:'', password:'' });
      setShowForm(false);
      fetchUsers();
    } catch (e) {
      setFormError(e.message || 'Erro ao criar usuario');
    } finally {
      setSaving(false);
    }
  };

  const revokeAccess = async (id) => {
    if (!confirm('Remover o acesso ao portal deste usuario?')) return;
    if (await adminUsers({ action:'revoke', userId:id })) fetchUsers();
  };

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando usuarios do portal...</div>;

  return (
    <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, color: C.ink }}>🔐 Usuarios com acesso ao Portal ({users.length})</div>
        <button onClick={() => { setShowForm(!showForm); setFormError(''); setFormMsg(''); }} style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'8px 16px', cursor:'pointer', fontSize:13, fontWeight:700 }}>
          {showForm ? 'Cancelar' : '+ Criar usuario'}
        </button>
      </div>

      {showForm && (
        <div style={{ background:C.cream, borderRadius:12, padding:16, marginBottom:20, border:'1px solid '+C.border }}>
          <div style={{ fontWeight:700, color:C.ink, marginBottom:12, fontSize:14 }}>Criar novo usuario do portal</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Nome</div>
              <input value={form.name} onChange={e=>setForm({...form, name:e.target.value})} placeholder="Nome (opcional)" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
            </div>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Email</div>
              <input value={form.email} onChange={e=>setForm({...form, email:e.target.value})} placeholder="email@exemplo.com" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
            </div>
          </div>
          <div style={{ marginBottom:12, maxWidth:'50%' }}>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Senha</div>
            <input type="password" value={form.password} onChange={e=>setForm({...form, password:e.target.value})} placeholder="Minimo 6 caracteres" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
          </div>
          {formError && <div style={{ color:'#e63946', fontSize:13, marginBottom:10 }}>{formError}</div>}
          <button disabled={saving} onClick={createUser} style={{ background:C.p6, color:'#fff', border:'none', borderRadius:10, padding:'10px 20px', cursor: saving?'wait':'pointer', fontSize:13, fontWeight:700 }}>
            {saving ? 'Criando...' : 'Criar usuario'}
          </button>
        </div>
      )}
      {formMsg && <div style={{ color:'#2e7d32', fontSize:13, marginBottom:16, background:C.p6+'15', padding:'10px 14px', borderRadius:10 }}>{formMsg}</div>}

      {users.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum usuario com acesso ao portal.</div>}
      {users.length > 0 && (
        <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:600 }}>
          <thead>
            <tr style={{ borderBottom:'2px solid '+C.border }}>
              {['Nome','Email','Telefone','Papel','PRO','Criado em','Acoes'].map(h => (
                <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom:'1px solid '+C.border }}>
                <td style={{ padding:'10px 12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <AvatarCell name={u.name} avatarUrl={u.avatar_url} size={32} />
                    <NameCell profile={u} after={fetchUsers} />
                  </div>
                </td>
                <td style={{ padding:'10px 12px', fontSize:12 }}><EmailCell profile={u} after={fetchUsers} /></td>
                <td style={{ padding:'10px 12px', fontSize:12 }}><PhoneCell profile={u} after={fetchUsers} /></td>
                <td style={{ padding:'10px 12px' }}><span style={{ background:C.p5+'22', color:C.p5, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>{u.role || u.user_type || 'admin'}</span></td>
                <td style={{ padding:'10px 12px' }}>
                  <ProBadgeCell profile={u} onChange={fetchUsers} />
                </td>
                <td style={{ padding:'10px 12px', color:C.muted, fontSize:12 }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                <td style={{ padding:'10px 12px' }}>
                  <button onClick={() => revokeAccess(u.id)} style={{ background:'none', border:'1px solid '+C.border, borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, color:C.p4 }}>Revogar acesso</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
};

// ============================================================
// MODERAÇÃO — denúncias feitas por usuários (tabela `reports`)
// ============================================================
const Moderacao = () => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('pending');

  const fetchReports = async () => {
    setLoading(true);
    setError(null);
    try {
      let q = supa.from('reports')
        .select('id, reporter_id, post_id, target_user_id, reason, status, created_at, reporter:profiles!reporter_id(name, avatar_url)')
        .order('created_at', { ascending: false })
        .limit(200);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error: err } = await q;
      if (err) throw err;
      setReports(data || []);
    } catch (e) {
      console.warn('Moderacao fetchReports:', e);
      setError(e.message || 'Erro ao carregar denúncias');
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, [filter]);

  const resolveReport = async (id) => {
    try {
      await reportsService.resolve(id);
      fetchReports();
    } catch (e) {
      console.warn('resolveReport error:', e);
      alert('Não foi possível resolver: ' + (e.message || e));
    }
  };

  // Se a tabela `reports` não existir (erro 404/42P01), mostra placeholder.
  const tableMissing = error && /relation .*reports.* does not exist|404|42P01/i.test(error);

  return (
    <div>
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: C.ink }}>🛡️ Moderação — Denúncias</div>
          <div style={{ display:'flex', gap:8 }}>
            {['pending','resolved','dismissed','all'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding:'6px 14px', borderRadius:20, border:'1px solid '+(filter===f?C.p1:C.border), background:filter===f?C.p1:'transparent', color:filter===f?'#fff':C.ink, cursor:'pointer', fontSize:12, fontWeight:600 }}>
                {f==='pending'?'Pendentes':f==='resolved'?'Resolvidas':f==='dismissed'?'Descartadas':'Todas'}
              </button>
            ))}
          </div>
        </div>
        {loading && <div style={{ color: C.muted, padding: 20 }}>Carregando denúncias...</div>}
        {!loading && tableMissing && (
          <div style={{ color: C.muted, padding: 20, textAlign:'center' }}>Sem denúncias</div>
        )}
        {!loading && !tableMissing && reports.length === 0 && (
          <div style={{ color: C.muted, padding: 20, textAlign:'center' }}>Sem denúncias</div>
        )}
        {!loading && !tableMissing && reports.length > 0 && (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid '+C.border }}>
                {['ID','Denunciante','Alvo','Motivo','Status','Data','Ações'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map(r => {
                const data = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) + ' ' + new Date(r.created_at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : '—';
                const targetType = r.post_id ? 'post' : (r.target_user_id ? 'usuário' : '—');
                const targetId = r.post_id || r.target_user_id || '—';
                const targetIdShort = typeof targetId === 'string' && targetId.length > 8 ? targetId.slice(0,8) + '…' : targetId;
                const idShort = r.id ? String(r.id).slice(0,8) + '…' : '—';
                const st = r.status || 'pending';
                return (
                  <tr key={r.id} style={{ borderBottom:'1px solid '+C.border }}>
                    <td style={{ padding:'10px 12px', color:C.muted, fontSize:11, fontFamily:'monospace' }}>{idShort}</td>
                    <td style={{ padding:'10px 12px' }}>{r.reporter?.name || (r.reporter_id ? String(r.reporter_id).slice(0,8) + '…' : '—')}</td>
                    <td style={{ padding:'10px 12px', fontSize:12 }}>
                      <div style={{ fontWeight:600 }}>{targetType}</div>
                      <div style={{ color:C.muted, fontSize:11, fontFamily:'monospace' }}>{targetIdShort}</div>
                    </td>
                    <td style={{ padding:'10px 12px', fontSize:12, maxWidth:240 }}>{r.reason || '—'}</td>
                    <td style={{ padding:'10px 12px' }}><StatusBadge status={st} colorMap={REPORTS_STATUS_COLORS} labelMap={REPORTS_STATUS_LABELS} /></td>
                    <td style={{ padding:'10px 12px', color:C.muted, fontSize:12 }}>{data}</td>
                    <td style={{ padding:'10px 12px' }}>
                      {st === 'pending' ? (
                        <button onClick={() => resolveReport(r.id)} style={{ background:C.p6, border:'none', color:'#fff', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontSize:11, fontWeight:700 }}>Resolver</button>
                      ) : (
                        <span style={{ color:C.muted, fontSize:11 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============================================================
// INDICAÇÕES — referrals + points
// ============================================================
const Indicacoes = () => {
  const [referrals, setReferrals] = useState([]);
  const [pointsTotal, setPointsTotal] = useState(0);
  const [topReferrers, setTopReferrers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const sb = supa;
        const [refsRes, ptsRes] = await Promise.all([
          sb.from('referrals')
            .select('id, referrer_id, referred_id, status, bonus_points, created_at, referrer:profiles!referrer_id(name, avatar_url), referred:profiles!referred_id(name, avatar_url)')
            .order('created_at', { ascending: false })
            .limit(500),
          sb.from('points').select('amount, user_id, type'),
        ]);
        const refs = refsRes.data || [];
        const pts = ptsRes.data || [];
        setReferrals(refs);
        // Total de pontos creditados (type === 'earned' ou amount positivo)
        const total = pts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
        setPointsTotal(total);
        // Top 5 indicadores
        const counts = {};
        refs.forEach(r => {
          if (!r.referrer_id) return;
          if (!counts[r.referrer_id]) counts[r.referrer_id] = { id: r.referrer_id, name: r.referrer?.name || '—', count: 0, bonus: 0 };
          counts[r.referrer_id].count += 1;
          counts[r.referrer_id].bonus += Number(r.bonus_points) || 0;
        });
        const top = Object.values(counts).sort((a,b) => b.count - a.count).slice(0, 5);
        setTopReferrers(top);
      } catch (e) {
        console.warn('Indicacoes load error:', e);
        setReferrals([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando indicações...</div>;

  return (
    <div>
      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, marginBottom:24 }}>
        <KPICard title="Total de Indicações" value={referrals.length} sub="histórico completo" trend="🔗" color={C.p1} />
        <KPICard title="Pontos Creditados" value={pointsTotal.toLocaleString('pt-BR')} sub="soma de todos os pontos" trend="⭐" color={C.p7} />
        <KPICard title="Indicadores Únicos" value={topReferrers.length} sub="pessoas que indicaram" trend="👥" color={C.p5} />
      </div>

      {/* Top 5 */}
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 12, color: C.ink }}>🏆 Top 5 Indicadores</div>
        {topReferrers.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhum indicador ainda.</div>}
        {topReferrers.map((t, i) => (
          <div key={t.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom: i < topReferrers.length - 1 ? '1px solid '+C.border : 'none' }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background:C.p1+'22', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:13, color:C.p1 }}>{i+1}</div>
            <div style={{ flex:1, fontWeight:600, fontSize:13 }}>{t.name}</div>
            <div style={{ fontSize:12, color:C.muted }}>{t.count} indicaç{t.count===1?'ão':'ões'}</div>
            <div style={{ fontSize:12, color:C.p7, fontWeight:700, minWidth:80, textAlign:'right' }}>+{t.bonus} pts</div>
          </div>
        ))}
      </div>

      {/* Tabela */}
      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>🔗 Indicações</div>
        {referrals.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhuma indicação registrada.</div>}
        {referrals.length > 0 && (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid '+C.border }}>
                {['Indicador','Indicado','Status','Pontos','Data'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {referrals.map(r => {
                const data = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—';
                const st = r.status || 'pending';
                return (
                  <tr key={r.id} style={{ borderBottom:'1px solid '+C.border }}>
                    <td style={{ padding:'10px 12px', fontWeight:600 }}>{r.referrer?.name || '—'}</td>
                    <td style={{ padding:'10px 12px' }}>{r.referred?.name || '—'}</td>
                    <td style={{ padding:'10px 12px' }}><StatusBadge status={st} colorMap={REFERRALS_STATUS_COLORS} labelMap={REFERRALS_STATUS_LABELS} /></td>
                    <td style={{ padding:'10px 12px', fontWeight:700, color:C.p7 }}>{r.bonus_points != null ? '+' + r.bonus_points : '—'}</td>
                    <td style={{ padding:'10px 12px', color:C.muted, fontSize:12 }}>{data}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ============================================================
// AVALIAÇÕES — reviews (join com quotes/profiles)
// ============================================================
const AvaliacoesTab = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const sb = supa;
        // Busca reviews + reviewer (cliente). Para descobrir o pintor avaliado,
        // faz join com quotes pelo quote_id.
        const { data, error } = await sb.from('reviews')
          .select('id, reviewer_id, quote_id, rating, criteria, comment, created_at, reviewer:profiles!reviewer_id(name, avatar_url), quote:quotes!quote_id(id, painter:profiles!painter_id(name, avatar_url, rating_avg))')
          .order('created_at', { ascending: false })
          .limit(500);
        if (error) throw error;
        setReviews(data || []);
      } catch (e) {
        console.warn('AvaliacoesTab load error:', e);
        setReviews([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const total = reviews.length;
  const avg = React.useMemo(
    () => total ? (reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / total) : 0,
    [reviews, total]
  );

  if (loading) return <div style={{ padding: 20, color: C.muted }}>Carregando avaliações...</div>;

  const stars = (v) => {
    const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  };

  return (
    <div>
      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:16, marginBottom:24 }}>
        <KPICard title="Total de Avaliações" value={total} sub="enviadas pelos clientes" trend="⭐" color={C.p1} />
        <KPICard title="Média Geral" value={total ? avg.toFixed(2) : '—'} sub={total ? stars(avg) : 'sem avaliações ainda'} trend="" color={C.p7} />
      </div>

      <div style={{ background: C.white, borderRadius: 16, padding: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ fontWeight: 700, marginBottom: 16, color: C.ink }}>⭐ Avaliações dos Pintores</div>
        {reviews.length === 0 && <div style={{ color: C.muted, fontSize: 13 }}>Nenhuma avaliação registrada.</div>}
        {reviews.length > 0 && (
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid '+C.border }}>
                {['Pintor','Cliente','Nota','Critérios','Comentário','Data'].map(h => (
                  <th key={h} style={{ textAlign:'left', padding:'8px 12px', color:C.muted, fontWeight:600, fontSize:11, textTransform:'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => {
                const data = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '—';
                const painterName = r.quote?.painter?.name || '—';
                const reviewerName = r.reviewer?.name || '—';
                const crits = Array.isArray(r.criteria) ? r.criteria : (r.criteria ? [r.criteria] : []);
                return (
                  <tr key={r.id} style={{ borderBottom:'1px solid '+C.border, verticalAlign:'top' }}>
                    <td style={{ padding:'10px 12px', fontWeight:600 }}>{painterName}</td>
                    <td style={{ padding:'10px 12px' }}>{reviewerName}</td>
                    <td style={{ padding:'10px 12px', color:C.p1, whiteSpace:'nowrap' }}>{stars(r.rating)} <span style={{ color:C.muted, fontSize:11 }}>{Number(r.rating || 0).toFixed(1)}</span></td>
                    <td style={{ padding:'10px 12px' }}>
                      {crits.length === 0 ? <span style={{ color:C.muted, fontSize:11 }}>—</span> : (
                        <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                          {crits.map((c, i) => (
                            <span key={i} style={{ background:C.p3 + '22', color:C.p3, borderRadius:8, padding:'2px 8px', fontSize:11, fontWeight:600 }}>{c}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ padding:'10px 12px', fontSize:12, maxWidth:280, color:C.ink }}>{r.comment || <span style={{ color:C.muted }}>—</span>}</td>
                    <td style={{ padding:'10px 12px', color:C.muted, fontSize:12, whiteSpace:'nowrap' }}>{data}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ── WhatsApp (Cloud API da Meta via Dualhook, numero oficial da loja) ──
// Estilo WhatsApp Web: coluna esquerda = uma conversa por numero (nome do
// perfil do app quando o telefone casa, senao o nome do WhatsApp/numero);
// direita = balões + campo de resposta. Le direto de whatsapp_messages
// (RLS libera SELECT pra portal admin); envia pela rota /api/whatsapp/send.
// Poll de 15s, igual as demais telas.
//
// NAO existe mais aquecimento de servidor aqui. A Evolution API rodava no
// Render e dormia, entao a aba cutucava ela antes de enviar; o Dualhook e
// servico gerenciado, sempre de pe. O aquecimento virou uma chamada a um
// host morto que so atrasava o envio e mostrava "Acordando o servidor…"
// sem motivo.
// Formata SO numero brasileiro no padrao (DD) 9xxxx-xxxx. Numero de outro
// pais (ex.: EUA 16503154274) fica como +DDI... — antes o codigo tirava o
// '55' de qualquer numero e exibia um DDD brasileiro que nao existe.
const fmtWaPhone = (d) => {
  if(!d) return '';
  if(d.startsWith('55') && (d.length === 12 || d.length === 13)){
    const n = d.slice(2);
    if(n.length === 11) return '(' + n.slice(0,2) + ') ' + n.slice(2,7) + '-' + n.slice(7);
    if(n.length === 10) return '(' + n.slice(0,2) + ') ' + n.slice(2,6) + '-' + n.slice(6);
  }
  if(d.startsWith('1') && d.length === 11){ // EUA/Canada
    return '+1 (' + d.slice(1,4) + ') ' + d.slice(4,7) + '-' + d.slice(7);
  }
  return '+' + d;
};
const waHora = (m) => {
  const iso = m.wa_timestamp || m.created_at;
  if(!iso) return '';
  const dt = new Date(iso);
  const hoje = new Date();
  const mesmoDia = dt.toDateString() === hoje.toDateString();
  return mesmoDia
    ? dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
    : dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
};

// A Evolution API foi aposentada em 2026-09-05 e o bloco de aquecimento que
// vivia aqui saiu junto. Ele existia porque ela rodava no plano free do
// Render, dormia depois de 15min e o cold start estourava dentro do edge do
// Cloudflare (o 502 de 2026-08-31) — entao quem esperava o servidor subir
// era o NAVEGADOR, que pode esperar a vontade. Com o Dualhook, servico
// gerenciado, nao ha o que acordar: o que sobrava era uma chamada a um host
// morto antes de cada envio, mostrando "Acordando o servidor…" a toa.

// Balaozinho de ajuda: um "?" discreto que abre a explicacao ao passar o
// mouse (e no clique, pra quem esta no celular/tablet). Existe porque o
// nome do botao nunca cabe a explicacao inteira — e o custo de errar em
// "Rodar follow-up" e mandar mensagem pra cliente de verdade.
const Ajuda = ({ titulo, itens, largura }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <span style={{ position:'relative', display:'inline-flex', alignItems:'center' }}
      onMouseEnter={()=>setAberto(true)} onMouseLeave={()=>setAberto(false)}>
      <button type="button" onClick={()=>setAberto(a=>!a)} aria-label="Ajuda"
        style={{ width:19, height:19, borderRadius:'50%', border:'1px solid '+C.border, background:'#fff',
          color:C.muted, fontSize:11, fontWeight:800, lineHeight:'17px', textAlign:'center',
          cursor:'help', padding:0, flexShrink:0 }}>?</button>
      {aberto ? (
        <div style={{ position:'absolute', top:26, right:0, zIndex:60, width: largura || 360,
          background:'#fff', border:'1px solid '+C.border, borderRadius:12,
          boxShadow:'0 10px 34px rgba(26,26,46,.18)', padding:14, textAlign:'left',
          fontSize:12, lineHeight:1.5, color:C.ink, fontWeight:400, cursor:'default', whiteSpace:'normal' }}>
          <div style={{ fontWeight:800, fontSize:13, marginBottom:9 }}>{titulo}</div>
          {itens.map((it, i) => (
            <div key={i} style={{ marginBottom: i === itens.length - 1 ? 0 : 9 }}>
              <div style={{ fontWeight:700 }}>{it.t}</div>
              <div style={{ color:C.muted }}>{it.d}</div>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
};

const AJUDA_WHATSAPP = [
  { t:'🕐 Só horário comercial ⟷ Responde 24h',
    d:'Se a IA atende a qualquer hora ou só das 8h às 19h de Brasília, sem domingo.' },
  { t:'💬 Auto-resposta',
    d:'Quando a IA NÃO vai responder (fora do horário ou com a chave desligada), o cliente recebe uma mensagem se apresentando, agradecendo e prometendo retorno — em vez de ficar sem resposta nenhuma. No máximo uma a cada 12h por conversa.' },
  { t:'🔁 Follow-up',
    d:'De hora em hora o sistema: cobra pendência parada há mais de 3h sem resposta sua, avisa o cliente UMA vez que o pedido está na fila, e dá um toque em quem sumiu há 48h (no máximo 1 por semana). Nunca fala com quem pediu PARE.' },
  { t:'👀 Simular follow-up',
    d:'Faz a varredura inteira e mostra o que ela FARIA — sem enviar nada a ninguém. É o ensaio, use à vontade.' },
  { t:'▶ Rodar follow-up agora',
    d:'Faz a varredura DE VERDADE, enviando as mensagens. No dia a dia não precisa: o sistema já roda sozinho de hora em hora. Serve só pra antecipar.' },
  { t:'Última varredura (linha de baixo)',
    d:'Quando rodou pela última vez, quantas conversas foram analisadas e o que saiu de cada tipo.' },
  { t:'● Não lidas (em cima da lista de conversas)',
    d:'Filtra a lista pra mostrar só as conversas em que o cliente mandou mensagem depois da última vez que alguém abriu a conversa. O número é de CONVERSAS, não de mensagens. Resposta da IA não conta como lida — só abrir a conversa. Clique de novo pra ver todas.' },
  { t:'🧠 Prompt da IA',
    d:'O texto de instruções que a IA lê antes de cada resposta: quem ela é e como conversa. Dá pra editar e salvar; "Restaurar padrão" volta ao texto do sistema. A trava de preço, o horário, o teto diário e o PARE são de código e continuam valendo seja qual for o texto.' },
];

// ── Prompt da IA: editável no portal (2026-09-08, pedido do usuário) ────
// O texto vive em whatsapp_ai_config.prompt (NULL = padrão do código). O
// PADRÃO vem da rota /api/whatsapp/ai-prompt, não de cópia aqui: copiar
// seria uma segunda versão pra envelhecer. Salvar igual ao padrão grava
// NULL de propósito — assim melhoria futura do padrão chega sozinha.
const SQL_PROMPT_IA = 'ALTER TABLE public.whatsapp_ai_config ADD COLUMN IF NOT EXISTS prompt text;';

const PromptDaIaModal = ({ atual, onClose, onSalvo }) => {
  const [padrao, setPadrao] = useState(null);
  const [texto, setTexto] = useState(typeof atual === 'string' ? atual : '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data: { session } } = await supa.auth.getSession();
        const r = await fetch('/api/whatsapp/ai-prompt', {
          headers:{ Authorization: 'Bearer ' + (session ? session.access_token : '') }
        });
        const res = await r.json().catch(() => ({}));
        if(!vivo) return;
        if(r.ok && res.ok && typeof res.padrao === 'string'){
          setPadrao(res.padrao);
          if(typeof atual !== 'string') setTexto(res.padrao);
        } else {
          setErro('Não consegui carregar o texto padrão (' + (res.error || ('HTTP ' + r.status)) + ').');
        }
      } catch(e){
        if(vivo) setErro('Não consegui carregar o texto padrão: ' + ((e && e.message) || 'falha de rede'));
      }
    })();
    return () => { vivo = false; };
  }, []);

  const igualAoPadrao = padrao != null && texto.trim() === padrao.trim();

  const salvar = async () => {
    setSalvando(true); setErro('');
    const valor = igualAoPadrao || !texto.trim() ? null : texto;
    const { error } = await supa.from('whatsapp_ai_config')
      .upsert({ id:1, prompt: valor, updated_at: new Date().toISOString() }, { onConflict:'id' });
    setSalvando(false);
    if(error){
      const msg = (error.message || '') + ' ' + (error.code || '');
      setErro(/42703|column .*prompt|prompt.* column/i.test(msg)
        ? 'A coluna ainda não existe no banco. Rode no SQL Editor do Supabase: ' + SQL_PROMPT_IA
        : 'Não consegui salvar: ' + (error.message || 'erro desconhecido'));
      return;
    }
    onSalvo(valor); onClose();
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(26,26,46,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:'#fff', borderRadius:16, width:'min(860px, 96vw)', maxHeight:'92vh', display:'flex', flexDirection:'column', boxShadow:'0 16px 48px rgba(0,0,0,.24)' }}>
        <div style={{ padding:'16px 20px', borderBottom:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <div style={{ fontWeight:800, fontSize:16, color:C.ink }}>🧠 Prompt da IA</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
              O que a IA lê antes de cada resposta no WhatsApp.
              {typeof atual === 'string' ? ' Texto atual: personalizado.' : ' Texto atual: padrão do sistema.'}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:C.muted, lineHeight:1 }}>×</button>
        </div>

        <div style={{ padding:20, overflowY:'auto', flex:1, display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ padding:'9px 12px', background:'#fff7ed', border:'1px solid #f0c98a', borderRadius:10, fontSize:11.5, color:'#8a5300', lineHeight:1.5 }}>
            Aqui você edita <strong>quem a IA é e como conversa</strong>. Continuam fixos por código, seja qual
            for o texto: a trava de preço (pedido de preço ou orçamento nem chega na IA, e resposta com valor
            é barrada), o horário, o teto diário, o PARE, os dados do lead e o formato interno da resposta.
          </div>
          <textarea value={texto} onChange={e=>setTexto(e.target.value)} spellCheck={false}
            placeholder={padrao == null ? 'Carregando o texto padrão…' : ''}
            style={{ width:'100%', minHeight:340, resize:'vertical', padding:'12px 14px', borderRadius:10,
              border:'1.5px solid '+C.border, fontSize:12.5, lineHeight:1.5, fontFamily:'ui-monospace, Menlo, Consolas, monospace',
              color:C.ink, outline:'none', boxSizing:'border-box' }} />
          {erro ? <div style={{ padding:'8px 12px', background:'#fdecea', color:'#b3261e', borderRadius:8, fontSize:12, wordBreak:'break-word' }}>{erro}</div> : null}
        </div>

        <div style={{ padding:'14px 20px', borderTop:'1px solid '+C.border, display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <span style={{ fontSize:11, color:C.muted }}>
            {padrao == null ? 'Buscando o padrão…' : igualAoPadrao ? 'Igual ao padrão do sistema.' : 'Diferente do padrão — será salvo como personalizado.'}
          </span>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={()=>{ if(padrao != null) setTexto(padrao); }} disabled={padrao == null || igualAoPadrao}
              style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'9px 14px', fontSize:13, cursor: (padrao == null || igualAoPadrao) ? 'not-allowed' : 'pointer', color:C.muted, opacity: (padrao == null || igualAoPadrao) ? .5 : 1 }}>
              ↺ Restaurar padrão
            </button>
            <button onClick={onClose} style={{ background:'none', border:'1px solid '+C.border, borderRadius:10, padding:'9px 16px', fontSize:13, cursor:'pointer', color:C.muted }}>Cancelar</button>
            <button onClick={salvar} disabled={salvando || padrao == null}
              style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'9px 18px', fontSize:13, fontWeight:700, cursor: (salvando || padrao == null) ? 'wait' : 'pointer', opacity: (salvando || padrao == null) ? .6 : 1 }}>
              {salvando ? 'Salvando…' : '💾 Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Conteudo de uma bolha: foto, audio com player, video, documento ou
// texto. `url` chega assinada (bucket privado) — enquanto nao chega, ou
// se o arquivo nao foi salvo, mostra o marcador de sempre, entao nada
// quebra em mensagem antiga.
// Mensagem de TEMPLATE nao viaja com corpo: quem guarda o texto e a Meta, e
// o banco so tem o NOME do template. Sem isto a conversa mostrava um
// "[template]" seco — o operador nao conseguia saber o que a loja mandou pro
// cliente, logo na mensagem que abre o relacionamento. Pros templates que
// conhecemos, mostramos o texto espelhado; pros outros, ao menos o nome.
// Texto pra bolha: o espelho quando existe, com o parametro no lugar do
// {{1}}. Sem espelho, um rotulo legivel — nunca o registro cru.
const textoDeTemplate = (m) => {
  const reg = parseRegistroTemplate(m.body);
  const nomeTemplate = m.template || (reg && reg.template) || null;
  if(!nomeTemplate) return null;
  const params = (reg && reg.params) || {};
  if(m.template_nome && !params[1]) params[1] = m.template_nome;

  // Substitui TODAS as variaveis, nao so a primeira: com o template de
  // orcamento ({{1}}=nome, {{2}}=numero) mostrar so a primeira deixaria um
  // "{{2}}" cru na conversa.
  const t = templatePorNome(nomeTemplate);
  if(t && t.texto){
    // Parametro que nao ficou no registro vira reticencia, NUNCA o `{{n}}`
    // cru: chave dupla e notacao da Meta, e na conversa ela so faz parecer
    // que a loja mandou uma mensagem quebrada pro cliente. Acontece com
    // registro antigo, de quando guardavamos so a primeira variavel.
    return t.texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_bruto, n) => {
      const v = params[Number(n)];
      return v != null && v !== '' ? v : '…';
    });
  }
  const lista = Object.keys(params).sort((a,b)=>a-b).map(k => params[k]).filter(Boolean);
  return lista.length
    ? 'Template “' + nomeTemplate + '” · ' + lista.join(' · ')
    : 'Template “' + nomeTemplate + '”';
};

// ── Janela de 24h da Cloud API ──────────────────────────────────────────
// A Meta so aceita TEXTO LIVRE pra quem mandou mensagem pro numero nas
// ultimas 24h. Quem abre a janela e a mensagem do CLIENTE (direction 'in'),
// nunca a nossa — e cada mensagem dele reinicia o relogio. Fora da janela,
// so template aprovado (a API recusa texto com 131047).
//
// Isto e uma PREVISAO local, pra tela nao oferecer o que vai falhar. Quem
// decide de verdade e a Meta: pode haver mensagem que o webhook nao gravou,
// e o relogio dela e o dela. Por isso o erro 131047 continua tratado no
// envio — a previsao melhora a UX, nao substitui a checagem.
// [teste:janela-inicio] — o bloco entre este marcador e o de fim e
// EXTRAIDO e avaliado por __tests__/portalJanela24h.test.ts. O portal nao
// tem modulos, entao o teste le o fonte. Duas regras: so JS puro aqui
// dentro (JSX nao passa pelo `new Function` do teste) e nao mexer nos
// marcadores. Ja quebrou uma vez, em 2026-09-05, quando um componente novo
// foi inserido no meio — a suite reportou o arquivo como "skipped" e a
// contagem de testes seguiu verde, entao passou perto de ir pra main.
const JANELA_MS = 24 * 60 * 60 * 1000;

const instanteDaMsg = (m) => {
  const iso = m.wa_timestamp || m.created_at;
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

// Devolve quando a janela FECHA (ms epoch), ou null se nunca houve mensagem
// recebida — numero novo, o caso da abordagem.
const fimDaJanela = (msgs) => {
  let ultima = 0;
  for(const m of (msgs || [])){
    if(m.direction !== 'in') continue;
    const t = instanteDaMsg(m);
    if(t > ultima) ultima = t;
  }
  return ultima ? ultima + JANELA_MS : null;
};

const janelaAberta = (msgs) => {
  const fim = fimDaJanela(msgs);
  return fim != null && fim > Date.now();
};

// "faltam 3h" / "faltam 12min" — o operador precisa saber que o relogio corre.
const restanteDaJanela = (msgs) => {
  const fim = fimDaJanela(msgs);
  if(fim == null) return null;
  const ms = fim - Date.now();
  if(ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  if(h >= 1) return h + 'h';
  return Math.max(1, Math.floor(ms / 60000)) + 'min';
};

// [teste:janela-fim]

// ── Coluna de conversas: nao lidas + filtro "Nao lidas" (2026-09-09) ────
// [teste:wa-lista-inicio] — mesmo contrato do bloco da janela: SO JS PURO
// entre os marcadores (o teste avalia com `new Function`), e nao mexer nos
// marcadores. Avaliado por __tests__/portalWhatsAppNaoLidas.test.ts.
//
// "Nao lida" = mensagem RECEBIDA depois da ultima vez que o operador abriu
// a conversa (whatsapp_ai_state.last_read_at). A resposta da IA nao zera
// nada — ela nao substitui alguem ler. Conversa nunca aberta conta tudo
// que chegou.
const contarNaoLidas = (msgs, desde) => {
  const marca = desde ? new Date(desde).getTime() : 0;
  let n = 0;
  for(const m of (msgs || [])){
    if(m.direction !== 'in') continue;
    if(!marca || new Date(m.created_at).getTime() > marca) n++;
  }
  return n;
};

// Filtro da coluna. `busca` casa numero (so digitos) ou nome; `soNaoLidas`
// deixa so quem tem mensagem de cliente que ninguem abriu. Os dois se
// combinam (a busca procura DENTRO das nao lidas). `manter` e a conversa
// ABERTA: abrir marca como lida, e sem isso ela sumiria da lista no mesmo
// clique que a abriu — continua na tela enquanto estiver aberta.
const filtrarConversas = (convs, { busca, soNaoLidas, manter, nomeDe, naoLidas }) => {
  const q = String(busca || '').trim().toLowerCase();
  const digitos = q.replace(/\D/g, '');
  return (convs || []).filter(c => {
    if(soNaoLidas && c.waId !== manter && !(naoLidas(c) > 0)) return false;
    if(!q) return true;
    return (digitos !== '' && c.waId.includes(digitos)) || nomeDe(c).toLowerCase().includes(q);
  });
};

// A LISTA NAO E MAIS "AS ULTIMAS 500 MENSAGENS" (2026-09-09, pergunta do
// usuario: "realmente aparecem todas as conversas ou algumas se perdem
// pelo limite?"). Perdiam: um lote de abordagem sozinho ocupava as 500
// linhas e toda conversa mais antiga sumia da aba — com historico e nao
// lidas juntos. Agora a aba baixa TODAS as mensagens dos ultimos
// WA_DIAS_LISTA dias, paginadas (buscarEmPaginas), e o historico inteiro
// de uma conversa e buscado quando ela abre. Tudo entra por
// `mesclarMensagens`, que emenda por id em vez de trocar o array.
const WA_DIAS_LISTA = 90;
// Quantas conversas a coluna renderiza de uma vez — acima disso a tela
// pede a busca (um lote de abordagem pode criar milhares de conversas).
const WA_LISTA_MAX = 300;
// Campos que mudam DEPOIS de a linha existir (status de entrega chega por
// webhook minutos depois; transcricao e midia, segundos depois). Linha
// com o mesmo id e algum destes diferente e atualizacao, nao repeticao.
const CAMPOS_MSG = ['body', 'delivery_status', 'delivery_status_at', 'delivery_error', 'transcript', 'media_url', 'profile_name', 'origin', 'sent_by'];
const mesmaMensagem = (a, b) => CAMPOS_MSG.every(k => (a[k] == null ? null : a[k]) === (b[k] == null ? null : b[k]));
const ehEcoLocal = (m) => String(m.id).startsWith('local-');
// Emenda `chegadas` em `atual` por id. Devolve o MESMO array quando nada
// mudou (o poll de 60s nao repinta a tela a toa). O eco local do envio
// (id 'local-…') some quando a linha real do banco chega: mesma conversa,
// mesma direcao, mesmo corpo — antes o array inteiro era trocado e o eco
// ia junto; com emenda, sem esta regra ele ficaria duplicado.
const mesclarMensagens = (atual, chegadas) => {
  if(!chegadas || !chegadas.length) return atual;
  const porId = new Map();
  (atual || []).forEach(m => porId.set(m.id, m));
  let mudou = false;
  chegadas.forEach(m => {
    const antes = porId.get(m.id);
    if(!antes || !mesmaMensagem(antes, m)){ porId.set(m.id, m); mudou = true; }
  });
  porId.forEach((m, id) => {
    if(!ehEcoLocal(m)) return;
    const real = chegadas.some(r => !ehEcoLocal(r) && r.direction === 'out' && r.wa_id === m.wa_id && (r.body || '') === (m.body || ''));
    if(real){ porId.delete(id); mudou = true; }
  });
  if(!mudou) return atual;
  return Array.from(porId.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};
// Ultimos 8 digitos do telefone — a chave que casa wa_id com lead/perfil
// (robusta a DDI, nono digito e mascara). null se nao tem 8 digitos.
const sufixoDoTelefone = (tel) => {
  const dig = String(tel || '').replace(/\D/g, '');
  return dig.length >= 8 ? dig.slice(-8) : null;
};
const pedacos = (lista, n) => {
  const out = [];
  for(let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};
// [teste:wa-lista-fim]

// ── Status de entrega (Wave 58) ─────────────────────────────────────────
// A Meta avisa por webhook o que aconteceu com cada mensagem que a loja
// mandou. Sem isso, "nao chegou" era adivinhacao: nao dava pra separar
// numero sem WhatsApp de recusa de marketing de limite da Meta.
//
// `failed` NAO e um ✗ discreto: e a unica informacao acionavel da tela, e
// vem com o motivo por extenso. Os outros tres seguem a convencao do
// proprio WhatsApp (✓ enviado, ✓✓ entregue, ✓✓ azul lido), que o operador
// ja conhece — inventar simbolo novo aqui seria custo sem ganho.
const StatusEntrega = ({ m }) => {
  if(m.direction !== 'out') return null;
  const st = m.delivery_status;
  if(!st){
    // Sem status pode ser mensagem antiga (anterior a Wave 58) ou aviso
    // que ainda nao chegou. Nao mostramos nada: um "?" faria parecer
    // problema onde nao ha.
    return null;
  }
  if(st === 'failed'){
    return (
      <span title={m.delivery_error || 'A Meta nao detalhou o motivo.'}
        style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
        <span style={{ fontWeight:700 }}>⚠ não entregue</span>
      </span>
    );
  }
  const rot = st === 'read' ? '✓✓' : st === 'delivered' ? '✓✓' : '✓';
  const titulo = st === 'read' ? 'Lida' : st === 'delivered' ? 'Entregue no aparelho' : 'Enviada (ainda não entregue)';
  return (
    <span title={titulo} style={{ opacity: st === 'sent' ? .8 : 1, color: st === 'read' ? '#8fd0ff' : 'inherit' }}>
      {rot}
    </span>
  );
};

// Tipos que a Cloud API entrega SEM texto (2026-09-09): reacao, edicao e
// "unsupported" (enquete, contato, mensagem temporaria — a API nao repassa
// o conteudo, so avisa). Antes a bolha mostrava "[reaction]" seco.
// [teste:rotulo-tipo-inicio]
const rotuloDeTipo = (m) => {
  const tipo = m && m.type;
  const corpo = String((m && m.body) || '').trim();
  if(tipo === 'reaction') return corpo ? corpo + ' reagiu a uma mensagem' : 'removeu a reação';
  if(tipo === 'edit') return corpo ? '✏️ editou: ' + corpo : '✏️ editou uma mensagem';
  if(tipo === 'unsupported') return '📵 Mensagem de um tipo que o WhatsApp não repassa pra API (enquete, contato, temporária…) — veja no celular da loja';
  return null;
};
// [teste:rotulo-tipo-fim]

// Previa na lista de conversas: audio mostra a transcricao em vez de
// "[audio]" — da pra saber do que a conversa trata sem abrir.
const previewMsg = (m) => {
  if(!m) return '';
  const especial = rotuloDeTipo(m);
  if(especial) return especial;
  if(m.transcript) return '🎤 ' + m.transcript;
  if(m.type === 'image') return '📷 ' + (m.body && m.body !== '[imagem]' ? m.body : 'Foto');
  if(m.type === 'audio') return '🎤 Áudio';
  if(m.type === 'video') return '🎬 Vídeo';
  if(m.type === 'document') return '📎 ' + (m.body || 'Documento');
  if(m.type === 'template' || parseRegistroTemplate(m.body)){
    const t = textoDeTemplate(m);
    if(t) return '📋 ' + t.split('\n')[0];
  }
  return m.body || '[' + (m.type || 'msg') + ']';
};

const BolhaConteudo = ({ m, url }) => {
  const tipo = m.type || 'text';
  const legenda = (m.body || '').trim();
  const marcador = /^\[(áudio|imagem|vídeo|figurinha|documento|msg|mensagem)\]$/i.test(legenda);
  const [aberta, setAberta] = useState(false);

  // Antes era `!legenda`: quando o registro passou a ser gravado no `body`
  // (pra o historico saber o que foi enviado), ele virou "legenda" e ganhou
  // do espelho — a bolha voltou a mostrar "[template calicolors]".
  if(tipo === 'template'){
    const t = textoDeTemplate(m);
    // A bolha mostra o template INTEIRO (2026-09-08): cabecalho, corpo,
    // rodape e botoes. So o corpo dava a impressao de que "cortou as
    // opcoes no envio" — nao cortou: os botoes de resposta rapida sao do
    // template aprovado e a Meta os anexa sozinha em todo envio (prova:
    // quem toca neles chega aqui como type='button'). O que faltava era a
    // tela desenhar o que a pessoa recebeu.
    const reg = parseRegistroTemplate(m.body);
    const tpl = templatePorNome(m.template || (reg && reg.template) || '') || null;
    const botoes = (tpl && tpl.botoes) || [];
    if(t) return (
      <span>
        <span style={{ display:'block', fontSize:10, opacity:.7, marginBottom:3, textTransform:'uppercase', letterSpacing:.4 }}>
          Template aprovado
        </span>
        {tpl && tpl.titulo ? <span style={{ display:'block', fontWeight:800, marginBottom:4 }}>{tpl.titulo}</span> : null}
        <span style={{ whiteSpace:'pre-wrap' }}>{t}</span>
        {tpl && tpl.rodape ? <span style={{ display:'block', fontSize:11, opacity:.75, marginTop:6 }}>{tpl.rodape}</span> : null}
        {botoes.length ? (
          <span style={{ display:'block', marginTop:8, borderTop:'1px solid rgba(255,255,255,.35)' }}>
            {botoes.map((b, i) => (
              <span key={i} style={{ display:'block', textAlign:'center', padding:'6px 4px', fontWeight:700, fontSize:12.5,
                borderTop: i ? '1px solid rgba(255,255,255,.35)' : 'none' }}>
                <span style={{ marginRight:6, opacity:.85 }}>{ICONE_BOTAO[b.tipo] || '•'}</span>{b.texto}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    );
  }
  const especial = rotuloDeTipo(m);
  if(especial) return <span style={{ opacity:.8, fontStyle:'italic' }}>{especial}</span>;
  if(tipo === 'text' || !m.media_url) {
    return <span>{legenda || '[' + tipo + ']'}</span>;
  }
  if(!url) {
    return <span style={{ opacity:.75 }}>{legenda || '[' + tipo + ']'} <span style={{ fontSize:11 }}>· carregando…</span></span>;
  }

  if(tipo === 'image' || tipo === 'sticker') {
    return (
      <span>
        <img src={url} alt={legenda || 'imagem'} onClick={()=>setAberta(true)}
          style={{ display:'block', maxWidth:260, maxHeight:320, borderRadius:8, cursor:'zoom-in', objectFit:'cover' }} />
        {legenda && !marcador ? <div style={{ marginTop:6 }}>{legenda}</div> : null}
        {aberta ? (
          <span onClick={(e)=>{ e.stopPropagation(); setAberta(false); }}
            style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.85)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', cursor:'zoom-out' }}>
            <img src={url} alt={legenda || 'imagem'} style={{ maxWidth:'92vw', maxHeight:'92vh', borderRadius:8 }} />
          </span>
        ) : null}
      </span>
    );
  }
  if(tipo === 'audio') {
    return (
      <span>
        <audio controls preload="none" src={url} style={{ display:'block', width:260, maxWidth:'100%' }} />
        {m.transcript ? (
          <div style={{ marginTop:6, fontSize:12, fontStyle:'italic', opacity:.85 }}>“{m.transcript}”</div>
        ) : (
          <div style={{ marginTop:4, fontSize:11, opacity:.7 }}>sem transcrição</div>
        )}
      </span>
    );
  }
  if(tipo === 'video') {
    return (
      <span>
        <video controls preload="metadata" src={url} style={{ display:'block', maxWidth:280, borderRadius:8 }} />
        {legenda && !marcador ? <div style={{ marginTop:6 }}>{legenda}</div> : null}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer"
      style={{ color:'inherit', textDecoration:'underline' }}>
      📎 {legenda && !marcador ? legenda : 'Abrir documento'}
    </a>
  );
};

const WhatsAppTab = () => {
  const [msgs, setMsgs] = useState([]);
  const [profByPhone, setProfByPhone] = useState({});
  const [loading, setLoading] = useState(true);
  const [openWa, setOpenWa] = useState(null); // wa_id da conversa aberta
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [busca, setBusca] = useState('');
  const [soNaoLidas, setSoNaoLidas] = useState(false); // filtro "Nao lidas" da coluna
  const endRef = React.useRef(null);

  // Carrega a lista viva de templates JA na abertura da aba, nao so quando
  // o bloco de envio aparece. A bolha de uma mensagem de template ja
  // enviada tambem le dessa lista pra mostrar o texto — sem isso ela
  // pintava com a lista embutida (dois itens) e ficava no
  // "Template “calicolors”" seco, sem nunca redesenhar quando a lista de
  // verdade chegava. E o `setTemplatesEm` que provoca esse redesenho.
  const [, setTemplatesEm] = useState(0);
  useEffect(() => {
    let vivo = true;
    carregarTemplates().then(t => { if(vivo && t) setTemplatesEm(Date.now()); });
    return () => { vivo = false; };
  }, []);

  // `delivery_*` sao da Wave 58. Se a migration ainda nao rodou, o
  // PostgREST devolve 42703 e a lista NAO CARREGA — por isso o load tenta
  // com elas e refaz sem elas no erro (ver `carregarMsgs`). Recurso novo
  // nao pode derrubar a tela por causa de SQL pendente.
  const WA_COLS_BASE = 'id, direction, wa_id, profile_name, type, body, template, media_url, media_mime, transcript, wa_timestamp, created_at, sent_by, origin';
  const WA_COLS = WA_COLS_BASE + ', delivery_status, delivery_status_at, delivery_error';

  // MIDIA (Wave 49). O bucket e PRIVADO — conversa de cliente nao vira
  // link publico. Pedimos URL assinada em lote pras mensagens visiveis e
  // guardamos em memoria; a assinatura vale 1h, e recarregada no proximo
  // load. Sem isso seria uma chamada de rede por bolha.
  const [midiaUrls, setMidiaUrls] = useState({});   // path -> url assinada
  const assinandoRef = React.useRef({});
  const assinarMidias = async (paths) => {
    const novos = paths.filter(p => p && !midiaUrls[p] && !assinandoRef.current[p]);
    if(!novos.length) return;
    novos.forEach(p => { assinandoRef.current[p] = true; });
    try {
      const { data } = await supa.storage.from('whatsapp-media').createSignedUrls(novos, 3600);
      const map = {};
      (data || []).forEach(d => { if(d && d.path && d.signedUrl) map[d.path] = d.signedUrl; });
      if(Object.keys(map).length) setMidiaUrls(u => ({ ...u, ...map }));
    } catch(_){ /* sem assinatura a bolha cai no marcador de texto */ }
  };

  // A aba fechou? Os trabalhadores de paginacao param e nada mais escreve
  // no state de um componente desmontado.
  const vivoRef = React.useRef(true);
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);

  // Tenta com as colunas de status; se a migration da Wave 58 ainda nao
  // rodou, o PostgREST responde 42703 e refazemos SEM elas (e lembramos,
  // pra nao pagar o erro em toda consulta). A tela toda parar de carregar
  // porque falta um SQL seria trocar um recurso novo (o ✓✓) pela funcao
  // inteira — mesma licao de `quotes.post_id`.
  const semStatusRef = React.useRef(false);
  const buscarMensagens = async (montar, opts) => {
    const cols = semStatusRef.current ? WA_COLS_BASE : WA_COLS;
    try { return await buscarEmPaginas((extra) => montar(cols, extra), opts); }
    catch(e){
      if(semStatusRef.current || !/delivery_status|42703/i.test((e && e.message) || '')) throw e;
      semStatusRef.current = true;
      return buscarEmPaginas((extra) => montar(WA_COLS_BASE, extra), opts);
    }
  };
  const ordenar = (q) => q.order('created_at', { ascending:false }).order('id', { ascending:false });

  // Carga da lista: TODAS as mensagens dos ultimos WA_DIAS_LISTA dias,
  // paginadas e emendadas conforme chegam (a 1a pagina ja tira o
  // "Carregando"). `dias` menor no poll: de minuto em minuto so interessa
  // o que mudou ha pouco — mensagem nova ou status de entrega que a Meta
  // confirmou (delivery_status_at) — nao os 90 dias de novo.
  const load = async (dias) => {
    const desde = new Date(Date.now() - (dias || WA_DIAS_LISTA) * 86400000).toISOString();
    const entregar = comIntervalo((parcial) => {
      if(!vivoRef.current) return;
      setMsgs(prev => mesclarMensagens(prev, parcial));
      setLoading(false);
    }, 500);
    try {
      await buscarMensagens((cols, extra) => {
        const q = supa.from('whatsapp_messages').select(cols, extra);
        const recorte = (dias && !semStatusRef.current)
          ? q.or('created_at.gte.' + desde + ',delivery_status_at.gte.' + desde)
          : q.gte('created_at', desde);
        return ordenar(recorte);
      }, { aoChegar: entregar, cancelado: () => !vivoRef.current });
      entregar.agora();
    } catch(e){
      console.warn('whatsapp: falha ao carregar mensagens', e);
      entregar.cancelar();
    }
    if(vivoRef.current) setLoading(false);
  };

  // Historico COMPLETO da conversa aberta, sem recorte de data — a lista
  // so tem os ultimos dias, e uma conversa antiga abriria pela metade.
  // Uma vez por conversa por abertura da aba; o realtime/poll trazem o
  // resto.
  const conversasCarregadas = React.useRef(new Set());
  useEffect(() => {
    if(!openWa || conversasCarregadas.current.has(openWa)) return;
    conversasCarregadas.current.add(openWa);
    const alvo = openWa;
    buscarMensagens((cols, extra) => ordenar(supa.from('whatsapp_messages').select(cols, extra).eq('wa_id', alvo)),
      { cancelado: () => !vivoRef.current })
      .then(linhas => { if(vivoRef.current) setMsgs(prev => mesclarMensagens(prev, linhas)); })
      .catch(e => { conversasCarregadas.current.delete(alvo); console.warn('whatsapp: falha ao carregar a conversa', e); });
  }, [openWa]);

  // Quem e o dono do numero? Duas fontes, casadas pelos ULTIMOS 8 DIGITOS
  // (robusto a DDI, nono digito e formatacao):
  //   1. profiles — usuario cadastrado no app (tem @tag)
  //   2. leads    — contato da prospeccao (ainda nao e usuario)
  // Sem isso, conversa que a LOJA inicia fica so com o numero na tela: o
  // nome do WhatsApp (pushName) so chega quando a pessoa RESPONDE.
  const [leadByPhone, setLeadByPhone] = useState({});
  // Chave da IA por conversa (Wave 46) + alertas abertos do portal.
  const [iaState, setIaState] = useState({});   // wa_id → true/false
  const [iaWhy, setIaWhy] = useState({});       // wa_id → ultima decisao da IA
  // Ate quando o OPERADOR ja viu esta conversa. A IA responder NAO conta
  // como lida: quem precisa saber que chegou mensagem e a pessoa.
  const [readAt, setReadAt] = useState({});     // wa_id → ISO
  const [iaPadrao, setIaPadrao] = useState(false);
  const [alertas, setAlertas] = useState([]);

  // Prompt da IA: string = personalizado, null = padrão, undefined = não
  // carregado ou coluna ausente (o select é separado do da config de
  // propósito: se a coluna nova não existir, o 42703 derrubaria horário,
  // padrão e ausência junto).
  const [promptIa, setPromptIa] = useState(undefined);
  const [promptOpen, setPromptOpen] = useState(false);

  const loadIa = async () => {
    // Config em tabela PROPRIA (Wave 47) — app_settings guarda segredo de
    // sistema e recusa escrita do portal, corretamente.
    supa.from('whatsapp_ai_config').select('prompt').eq('id',1).maybeSingle()
      .then(pr => setPromptIa(pr.error ? undefined : ((pr.data && pr.data.prompt) || null)))
      .catch(() => setPromptIa(undefined));
    const [st, cfg, al] = await Promise.all([
      // Paginado: com milhares de conversas o `limit(2000)` deixava marca de
      // leitura de fora e o contador de nao lidas subia sem motivo.
      buscarEmPaginas((extra) => supa.from('whatsapp_ai_state').select('wa_id, enabled, last_why, last_at, last_read_at', extra).order('wa_id'),
        { cancelado: () => !vivoRef.current }).then(data => ({ data })).catch(() => ({ data: [] })),
      supa.from('whatsapp_ai_config')
        .select('hours, default_on, followup_on, away_on, last_sweep_at, last_sweep_note')
        .eq('id',1).maybeSingle(),
      supa.from('portal_alerts').select('id, kind, wa_id, title, body, created_at')
        .eq('resolved', false).order('created_at', { ascending:false }).limit(50),
    ]);
    const m = {}; const w = {}; const rd = {};
    (st.data || []).forEach(r => {
      if(r.last_read_at) rd[r.wa_id] = r.last_read_at;
      // enabled NULL (Wave 48) = "nunca foi decidido nesta conversa" →
      // segue o padrao global. Guardamos o valor CRU de proposito.
      m[r.wa_id] = r.enabled;
      if(r.last_why) w[r.wa_id] = { why: r.last_why, at: r.last_at };
    });
    setIaState(m); setIaWhy(w);
    // Nao sobrescreve marca local mais nova (upsert ainda em voo).
    setReadAt(prev => {
      const merged = { ...rd };
      Object.keys(prev).forEach(k => {
        if(!merged[k] || new Date(prev[k]) > new Date(merged[k])) merged[k] = prev[k];
      });
      return merged;
    });
    setIaPadrao(Boolean(cfg.data && cfg.data.default_on));
    setAlertas(al.data || []);
    setHoras((cfg.data && cfg.data.hours) || '8-19');
    setFollowupOn(!cfg.data || cfg.data.followup_on !== false);
    setAwayOn(!cfg.data || cfg.data.away_on !== false);
    setSweep(cfg.data ? { at: cfg.data.last_sweep_at, note: cfg.data.last_sweep_note } : null);
  };

  // Sem decisao propria (linha ausente ou enabled NULL), vale o padrao
  // global — mesma regra do servidor.
  const iaLigada = (waId) => (typeof iaState[waId] === 'boolean') ? iaState[waId] : iaPadrao;

  // Janela de atendimento da IA (app_settings 'whatsapp_ai_hours').
  // '0-24' = responde a qualquer hora; '8-19' = so comercial (padrao).
  const [horas, setHoras] = useState('8-19');
  const foraDeHorarioLiberado = horas.trim() === '0-24';
  const toggleForaDeHorario = async () => {
    const novo = foraDeHorarioLiberado ? '8-19' : '0-24';
    setHoras(novo); // otimista
    const { error } = await supa.from('whatsapp_ai_config')
      .upsert({ id:1, hours: novo, updated_at: new Date().toISOString() }, { onConflict:'id' });
    if(error){
      setHoras(foraDeHorarioLiberado ? '0-24' : '8-19');
      alert('Nao consegui salvar o horario da IA: ' + error.message);
    }
  };

  // FOLLOW-UP AUTOMATICO (Wave 48). Chave mestra + botao pra rodar na
  // hora. A varredura de verdade roda de hora em hora no banco (pg_cron);
  // aqui e so pra ver o resultado sem esperar.
  const [followupOn, setFollowupOn] = useState(true);
  // Mensagem de ausencia: quando a IA nao vai responder (fora do horario
  // ou chave desligada), o cliente recebe UMA cortesia da loja em vez de
  // silencio — no maximo 1 a cada 12h, nunca pra quem pediu PARE.
  const [awayOn, setAwayOn] = useState(true);
  const toggleAway = async () => {
    const novo = !awayOn;
    setAwayOn(novo); // otimista
    const { error } = await supa.from('whatsapp_ai_config')
      .upsert({ id:1, away_on: novo, updated_at: new Date().toISOString() }, { onConflict:'id' });
    if(error){
      setAwayOn(!novo);
      alert('Nao consegui salvar a auto-resposta: ' + error.message);
    }
  };
  const [sweep, setSweep] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const toggleFollowup = async () => {
    const novo = !followupOn;
    setFollowupOn(novo); // otimista
    const { error } = await supa.from('whatsapp_ai_config')
      .upsert({ id:1, followup_on: novo, updated_at: new Date().toISOString() }, { onConflict:'id' });
    if(error){
      setFollowupOn(!novo);
      alert('Nao consegui salvar o follow-up: ' + error.message);
    }
  };
  const rodarFollowup = async (dryRun) => {
    if(sweeping) return;
    setSweeping(true); setDiag(null);
    try {
      const { data: { session } } = await supa.auth.getSession();
      if(!session){ setDiag('Sessao expirada — entre de novo.'); setSweeping(false); return; }
      const r = await fetch('/api/whatsapp-evo/followup', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, dryRun: !!dryRun })
      });
      let raw=''; try { raw = await r.text(); } catch(_){}
      let j=null; try { j = JSON.parse(raw); } catch(_){}
      setDiag(j || ('HTTP ' + r.status + ' — ' + (raw||'').slice(0,200)));
      loadIa(); load();
    } catch(e){ setDiag('Falha de rede: ' + ((e && e.message) || '?')); }
    setSweeping(false);
  };

  const toggleIa = async (waId) => {
    const novo = !iaLigada(waId);
    setIaState(s => ({ ...s, [waId]: novo })); // otimista
    const { error } = await supa.from('whatsapp_ai_state')
      .upsert({ wa_id: waId, enabled: novo, updated_at: new Date().toISOString() }, { onConflict:'wa_id' });
    if(error){
      setIaState(s => ({ ...s, [waId]: !novo }));
      alert('Nao consegui salvar a chave da IA: ' + error.message);
    }
  };

  // Copiloto: pede a sugestao da IA e joga no campo de texto (NAO envia).
  // Funciona a qualquer hora — quem pediu foi uma pessoa.
  const [sugerindo, setSugerindo] = useState(false);
  const sugerirResposta = async () => {
    if(!openWa || sugerindo) return;
    setSugerindo(true); setErr('');
    try {
      const { data: { session } } = await supa.auth.getSession();
      if(!session){ setErr('Sessao expirada — entre de novo.'); setSugerindo(false); return; }
      const r = await fetch('/api/whatsapp-evo/suggest', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, waId: openWa })
      });
      let raw=''; try { raw = await r.text(); } catch(_){}
      let res={}; try { res = JSON.parse(raw); } catch(_){}
      if(!r.ok || !res.ok){
        setErr(res.error || ('IA nao respondeu (HTTP ' + r.status + ')'));
      } else {
        setText(res.reply || '');
        if(res.escalate){
          setErr('⚠️ Esta conversa pede ' + (res.reason === 'preco' ? 'PREÇO' : res.reason === 'orcamento' ? 'ORÇAMENTO' : 'atendimento humano') + ' — a sugestão acima só ganha tempo. Responda você.');
        }
      }
    } catch(_){ setErr('Falha de rede ao pedir a sugestao.'); }
    setSugerindo(false);
  };

  const resolverAlerta = async (id) => {
    setAlertas(a => a.filter(x => x.id !== id)); // otimista
    await supa.from('portal_alerts').update({ resolved:true, resolved_at:new Date().toISOString() }).eq('id', id);
  };
  // Perfis do app sao poucos (centenas): vem em massa, paginado.
  const loadProfiles = async () => {
    try {
      const perfis = await buscarEmPaginas((extra) =>
        supa.from('profiles').select('id, name, tag, phone', extra).not('phone','is',null).order('id'),
        { cancelado: () => !vivoRef.current });
      const mapP = {};
      perfis.forEach(p => { const s = sufixoDoTelefone(p.phone); if(s) mapP[s] = p; });
      if(vivoRef.current) setProfByPhone(mapP);
    } catch(e){ console.warn('whatsapp: falha ao carregar perfis', e); }
  };

  // LEADS SAO 61 MIL: o `limit(3000)` antigo deixava quase todo lead
  // abordado sem nome na lista (so o numero; o nome aparecia dentro do
  // texto do template). Agora a consulta parte das CONVERSAS: pros
  // numeros que estao na tela, pede em `leads` quem termina nos mesmos 4
  // digitos (o `phone` e guardado como veio da planilha, com mascara ou
  // DDI — os 4 ultimos digitos sao contiguos em qualquer formato) e casa
  // pelos 8 ultimos aqui. Cada sufixo e pedido UMA vez por abertura da aba.
  const LEADS_POR_CONSULTA = 60;
  const sufixosPedidos = React.useRef(new Set());
  const resolverLeads = async (sufixos) => {
    const mapa = {};
    for(const lote of pedacos(sufixos, LEADS_POR_CONSULTA)){
      if(!vivoRef.current) return;
      const finais = Array.from(new Set(lote.map(s => s.slice(-4))));
      const ou = finais.map(f => 'phone.ilike.*' + f).join(',');
      try {
        const linhas = await buscarEmPaginas((extra) =>
          supa.from('leads').select('id, name, phone, category, segment, city, status', extra).or(ou).order('id'),
          { cancelado: () => !vivoRef.current });
        const quer = new Set(lote);
        linhas.forEach(l => { const s = sufixoDoTelefone(l.phone); if(s && quer.has(s) && !mapa[s]) mapa[s] = l; });
      } catch(e){
        lote.forEach(s => sufixosPedidos.current.delete(s)); // tenta de novo na proxima
        console.warn('whatsapp: falha ao resolver leads', e);
      }
    }
    if(Object.keys(mapa).length && vivoRef.current) setLeadByPhone(prev => ({ ...prev, ...mapa }));
  };

  // REALTIME (Wave 45): o banco AVISA quando entra mensagem — a msg
  // aparece em ~1s, sem poll curto e sem repintar a tela inteira (so a
  // linha nova entra no array). O poll continua, mas em 60s, apenas como
  // rede de seguranca (aba que dormiu, websocket caido, tabela ainda fora
  // da publication do Supabase).
  const subRef = React.useRef(null);
  useEffect(() => {
    load(); loadProfiles(); loadIa();
    subRef.current = supa
      .channel('portal-whatsapp')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'whatsapp_messages' },
        (payload) => {
          setMsgs(prev => mesclarMensagens(prev, [payload.new]));
        })
      .subscribe();
    const t = setInterval(() => load(1), 60000);
    const tIa = setInterval(loadIa, 30000); // alertas novos da IA
    return () => {
      clearInterval(t); clearInterval(tIa);
      if(subRef.current) supa.removeChannel(subRef.current);
    };
  }, []);

  // Assina a midia da conversa aberta (so o que esta na tela).
  useEffect(() => {
    if(!openWa) return;
    const paths = msgs.filter(m => m.wa_id === openWa && m.media_url).map(m => m.media_url);
    if(paths.length) assinarMidias(paths);
  }, [openWa, msgs.length]);

  // Chegou mensagem na conversa que esta ABERTA na tela? Ja esta sendo
  // lida — nao deixa o contador subir na cara do operador.
  useEffect(() => {
    if(!openWa) return;
    const c = convs.find(x => x.waId === openWa);
    if(c && naoLidas(c) > 0) marcarLida(openWa);
  }, [openWa, msgs.length]);

  // Rola pro fim so quando FAZ SENTIDO: ao abrir a conversa, ou quando
  // chega mensagem nova E o operador ja estava olhando o fim. Se ele
  // subiu pra ler historico, a tela nao arranca dele.
  const threadRef = React.useRef(null);
  const [nMsgs, setNMsgs] = useState(0);
  useEffect(() => {
    const el = threadRef.current;
    const abriuConversa = msgs.length === nMsgs;
    setNMsgs(msgs.length);
    if(!el) return;
    const pertoDoFim = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if(abriuConversa || pertoDoFim) endRef.current?.scrollIntoView({ behavior: abriuConversa ? 'auto' : 'smooth' });
  }, [openWa, msgs.length]);

  // Agrupa por numero (mensagem mais recente primeiro).
  const convs = React.useMemo(() => {
    const map = {};
    msgs.forEach(m => {
      if(!m.wa_id) return;
      if(!map[m.wa_id]) map[m.wa_id] = { waId: m.wa_id, msgs: [], last: m, name: '' };
      map[m.wa_id].msgs.push(m);
      if(m.direction === 'in' && m.profile_name && !map[m.wa_id].name) map[m.wa_id].name = m.profile_name;
      if(new Date(m.created_at) > new Date(map[m.wa_id].last.created_at)) map[m.wa_id].last = m;
    });
    return Object.values(map).sort((a,b) => new Date(b.last.created_at) - new Date(a.last.created_at));
  }, [msgs]);

  // Conversa nova na lista → pede o lead dela (ver resolverLeads).
  const chaveDasConversas = convs.map(c => c.waId.slice(-8)).join(',');
  useEffect(() => {
    const novos = convs.map(c => c.waId.slice(-8)).filter(s => s.length === 8 && !sufixosPedidos.current.has(s));
    if(!novos.length) return;
    novos.forEach(s => sufixosPedidos.current.add(s));
    resolverLeads(novos);
  }, [chaveDasConversas]);

  // NAO LIDAS: mensagens RECEBIDAS depois da ultima vez que o operador
  // abriu a conversa. A resposta da IA nao zera nada — ela nao substitui
  // alguem ler. Conversa nunca aberta conta tudo que chegou.
  const naoLidas = (c) => contarNaoLidas(c.msgs, readAt[c.waId]);

  // Marca lida ate agora. Otimista na tela; o banco guarda pra valer
  // (assim a marca vale em qualquer computador, nao so neste navegador).
  const marcarLida = async (waId) => {
    const agora = new Date().toISOString();
    setReadAt(s => ({ ...s, [waId]: agora }));
    try { window.dispatchEvent(new CustomEvent('wa-lidas-mudou')); } catch(_){}
    await supa.from('whatsapp_ai_state')
      .upsert({ wa_id: waId, last_read_at: agora }, { onConflict:'wa_id' });
  };

  const abrirConversa = (waId) => { setOpenWa(waId); setErr(''); marcarLida(waId); };

  // Prioridade: usuario do app > lead da prospeccao > nome do WhatsApp >
  // numero formatado.
  const nomeDe = (c) => {
    const chave = c.waId.slice(-8);
    const prof = profByPhone[chave];
    if(prof) return (prof.name || '@' + prof.tag) + (prof.tag ? ' (@' + prof.tag + ')' : '');
    const lead = leadByPhone[chave];
    if(lead && lead.name) return lead.name;
    return c.name || fmtWaPhone(c.waId);
  };
  // Etiqueta de origem, pra saber com quem se esta falando.
  // QUEM esta tocando a conversa: a ultima mensagem enviada com origem
  // conhecida decide. 'origin' e gravado desde 2026-08-30 (portal/ia/
  // celular); pra mensagem antiga, sent_by preenchido ja denuncia portal.
  // Sem nenhuma pista (historico velho), sem chip — nada de adivinhar.
  const canalDe = (c) => {
    let melhor = null;
    c.msgs.forEach(m => {
      if(m.direction !== 'out') return;
      const o = m.origin || (m.sent_by ? 'portal' : null);
      if(!o) return;
      if(!melhor || new Date(m.created_at) > new Date(melhor.t)) melhor = { o, t: m.created_at };
    });
    return melhor ? melhor.o : null;
  };
  const CANAL_CHIP = {
    celular: { rotulo: '📱 celular', cor: C.p6, dica: 'Última resposta enviada pelo WhatsApp do CELULAR da loja' },
    portal:  { rotulo: '🖥️ portal',  cor: C.p3, dica: 'Última resposta enviada por uma pessoa AQUI no portal' },
    ia:      { rotulo: '🤖 IA',      cor: C.p1, dica: 'Última resposta enviada pela IA automática' },
  };
  const ChipCanal = ({ c, mini }) => {
    const canal = canalDe(c);
    if(!canal) return null;
    const cfg = CANAL_CHIP[canal];
    return (
      <span title={cfg.dica} style={{ fontSize: mini ? 9 : 11, fontWeight:700, color: cfg.cor,
        border:'1px solid ' + cfg.cor + '55', background: cfg.cor + '14',
        borderRadius:8, padding: mini ? '0px 5px' : '2px 8px', whiteSpace:'nowrap' }}>{cfg.rotulo}</span>
    );
  };

  const origemDe = (c) => {
    const chave = c.waId.slice(-8);
    if(profByPhone[chave]) return null; // usuario do app ja aparece com @tag
    const lead = leadByPhone[chave];
    return lead ? (lead.category || 'Lead') : null;
  };

  // Quantas CONVERSAS tem mensagem nova (nao quantas mensagens) — e o que
  // o botao "Nao lidas" mostra e o que o operador precisa atender.
  const conversasNaoLidas = convs.reduce((n, c) => n + (naoLidas(c) > 0 ? 1 : 0), 0);
  const convsFiltradas = filtrarConversas(convs, { busca, soNaoLidas, manter: openWa, nomeDe, naoLidas });

  const aberta = convs.find(c => c.waId === openWa);
  const thread = aberta ? [...aberta.msgs].sort((a,b) => new Date(a.created_at) - new Date(b.created_at)) : [];

  const [sendStage, setSendStage] = useState('');

  // Nome de quem esta do outro lado, pro {{1}}. Ordem: perfil do app > lead
  // > pushName do WhatsApp — a mesma que a lista de conversas ja usa.
  const leadDoContatoAberto = openWa ? (leadByPhone[openWa.slice(-8)] || null) : null;
  const nomeDoContatoAberto = openWa
    ? (leadDoContatoAberto?.name || (aberta ? nomeDe(aberta) : null))
    : null;
  // {{2}}/{{3}} so quando o numero casa com um lead — perfil do app e
  // pushName nao trazem cidade nem ramo, e chutar seria mandar dado errado.
  const dadosDoContatoAberto = leadDoContatoAberto
    ? { cidade: cidadeDoLead(leadDoContatoAberto), segmento: ramoDoLead(leadDoContatoAberto) }
    : null;


  const enviar = async () => {
    const body = text.trim();
    if(!body || !openWa || sending) return;
    setSending(true); setErr('');
    try {
      const { data: { session } } = await supa.auth.getSession();
      if(!session){ setErr('Sessao expirada — entre de novo.'); setSending(false); return; }
      setSendStage('Enviando…');
      const r = await fetch('/api/whatsapp/send', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, to: openWa, body })
      });
      // Texto primeiro: 5xx do PROPRIO Cloudflare vem como HTML — o trecho
      // cru no erro aponta a camada (mesma tatica do relatorio de exclusao).
      let raw = ''; try { raw = await r.text(); } catch(_){}
      let res = {}; try { res = JSON.parse(raw); } catch(_){}
      if(!r.ok || !res.ok){
        const snippet = res.error ? '' : (raw || '').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
        setErr(res.error || ('Falha no envio (HTTP ' + r.status + (snippet ? ' — ' + snippet : '') + ')'));
      }
      else {
        setText('');
        // Mostra a mensagem enviada NA HORA (o realtime/poll depois traz a
        // linha real do banco; o dedupe por id evita duplicar).
        setMsgs(prev => [{
          id: 'local-' + Date.now(), direction:'out', wa_id: openWa,
          type:'text', body, created_at: new Date().toISOString(), wa_timestamp: null
        }, ...prev]);
        load();
      }
    } catch(_) { setErr('Falha de rede ao enviar.'); }
    setSending(false); setSendStage('');
  };

  // Envio de TEMPLATE — o unico caminho quando a janela de 24h esta fechada
  // (numero novo, ou cliente que sumiu ha mais de um dia).
  // Recebe o pacote ja montado pelo <EnvioDeTemplate>: nome, idioma,
  // components (uma entrada por variavel) e o registro pro historico.
  const enviarTemplate = async (pacote) => {
    if(!openWa || sending || !pacote) return;
    setSending(true); setErr('');
    try {
      const { data: { session } } = await supa.auth.getSession();
      if(!session){ setErr('Sessao expirada — entre de novo.'); setSending(false); return; }
      setSendStage('Enviando…');
      const r = await fetch('/api/whatsapp/send', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, to: openWa,
          type:'template', template: pacote.template, languageCode: pacote.idioma,
          components: pacote.components, body: pacote.registro,
          // Numero que casa com um lead: a confirmacao da Meta vai pro lead
          // tambem (mesmo caminho da aba Leads).
          leadId: leadDoContatoAberto ? leadDoContatoAberto.id : undefined })
      });
      let raw = ''; try { raw = await r.text(); } catch(_){}
      let res = {}; try { res = JSON.parse(raw); } catch(_){}
      if(!r.ok || !res.ok){
        const snippet = res.error ? '' : (raw||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,140);
        setErr(res.error || ('Falha no envio (HTTP ' + r.status + (snippet ? ' — ' + snippet : '') + ')'));
      } else {
        // Eco local: sem corpo, igual ao que o banco vai guardar — quem
        // renderiza o texto e o `textoDeTemplate` pelo NOME do template.
        setMsgs(prev => [{
          id: 'local-' + Date.now(), direction:'out', wa_id: openWa,
          type:'template', body: pacote.registro, template: pacote.template,
          created_at: new Date().toISOString(), wa_timestamp: null
        }, ...prev]);
        load();
      }
    } catch(_) { setErr('Falha de rede ao enviar.'); }
    setSending(false); setSendStage('');
  };

  // Mesma regra do servidor (normalizeWhatsAppTarget): numero brasileiro
  // local ganha o 55; numero que ja vem com DDI de outro pais passa direto.
  // "+ Nova conversa" abre um MODAL do portal, nao o `prompt()` do
  // navegador. O prompt nativo e uma caixa do Chrome: nao mostra contato
  // conhecido, nao valida enquanto se digita, nao guarda nome, e some do
  // fluxo visual do portal — a pessoa via uma janela do Chrome no meio da
  // aplicacao.
  const [novaAberta, setNovaAberta] = useState(false);
  const novaConversa = () => setNovaAberta(true);

  // Area de resultado (varredura de follow-up). O botao "Testar conexao"
  // saiu da tela em 2026-08-29: era ferramenta de depuracao do 502 do
  // envio, ja resolvido. A rota /api/whatsapp-evo/ping CONTINUA no ar —
  // se precisar diagnosticar de novo, e so chamar ela direto com o token
  // de admin.
  const [diag, setDiag] = useState(null);

  return (
    <div>
      {novaAberta ? (
        <NovaConversaModal onClose={()=>setNovaAberta(false)} onAbrir={abrirConversa} />
      ) : null}
      <div style={{ marginBottom:10, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <span style={{ fontSize:11, color:C.muted }}>Canal: Dualhook (Cloud API)</span>
        {/* Padrao global da IA: vale pra conversa que ainda nao tem chave
            propria. Serve de "desliga tudo" em caso de emergencia. */}
        <span style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:12 }}>
          {/* Chave do horario: responder fora do comercial (8h-19h BRT). */}
          <button onClick={toggleForaDeHorario}
            title={foraDeHorarioLiberado
              ? 'A IA responde a QUALQUER hora. Clique pra limitar ao horario comercial (8h-19h de Brasilia, sem domingo).'
              : 'A IA so responde das 8h as 19h de Brasilia (sem domingo). Clique pra liberar 24h.'}
            style={{ display:'flex', alignItems:'center', gap:7, background: foraDeHorarioLiberado ? C.p6+'1f' : '#fff',
              border:'1px solid '+(foraDeHorarioLiberado ? C.p6 : C.border), color: foraDeHorarioLiberado ? C.p6 : C.muted,
              borderRadius:20, padding:'5px 12px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background: foraDeHorarioLiberado ? C.p6 : C.border, display:'inline-block' }} />
            {foraDeHorarioLiberado ? '🕐 Responde 24h' : '🕐 Só horário comercial'}
          </button>
          {/* Auto-resposta de ausencia (fora do horario / IA desligada). */}
          <button onClick={toggleAway}
            title={awayOn
              ? 'Auto-resposta LIGADA: fora do horario, ou com a IA desligada, o cliente recebe uma mensagem se apresentando ("aqui e da Cali Colors, obrigado pelo contato, retornamos em breve"). Uma a cada 12h por conversa, nunca pra quem pediu PARE. Clique pra desligar.'
              : 'Auto-resposta DESLIGADA: quem escrever fora do horario nao recebe nada. Clique pra ligar.'}
            style={{ display:'flex', alignItems:'center', gap:7, background: awayOn ? C.p6+'1f' : '#fff',
              border:'1px solid '+(awayOn ? C.p6 : C.border), color: awayOn ? C.p6 : C.muted,
              borderRadius:20, padding:'5px 12px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background: awayOn ? C.p6 : C.border, display:'inline-block' }} />
            {awayOn ? '💬 Auto-resposta ligada' : '💬 Auto-resposta desligada'}
          </button>
          {/* Follow-up: cobra pendencia esquecida e reengaja quem sumiu. */}
          <button onClick={toggleFollowup}
            title={followupOn
              ? 'Follow-up LIGADO: de hora em hora o sistema cobra pendencia sem resposta e da um toque em quem sumiu (1 por semana, so em horario de atendimento, nunca em quem pediu PARE). Clique pra desligar.'
              : 'Follow-up DESLIGADO: ninguem e cobrado e ninguem recebe toque automatico. Clique pra ligar.'}
            style={{ display:'flex', alignItems:'center', gap:7, background: followupOn ? C.p6+'1f' : '#fff',
              border:'1px solid '+(followupOn ? C.p6 : C.border), color: followupOn ? C.p6 : C.muted,
              borderRadius:20, padding:'5px 12px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background: followupOn ? C.p6 : C.border, display:'inline-block' }} />
            {followupOn ? '🔁 Follow-up ligado' : '🔁 Follow-up desligado'}
          </button>
          <Ajuda titulo="O que cada botão faz" itens={AJUDA_WHATSAPP} />
          <button onClick={()=>rodarFollowup(true)} disabled={sweeping}
            title="Simula a varredura agora e mostra o que ela FARIA, sem enviar nada."
            style={{ background:'#fff', border:'1px solid '+C.border, borderRadius:20, padding:'5px 12px', fontSize:11, fontWeight:600, cursor: sweeping?'wait':'pointer', color:C.muted }}>
            {sweeping ? '…' : '👀 Simular follow-up'}
          </button>
          <button onClick={()=>{ if(confirm('Rodar o follow-up AGORA? Mensagens podem ser enviadas aos clientes.')) rodarFollowup(false); }} disabled={sweeping}
            title="Roda a varredura de verdade agora, sem esperar a proxima hora."
            style={{ background:'#fff', border:'1px solid '+C.border, borderRadius:20, padding:'5px 12px', fontSize:11, fontWeight:600, cursor: sweeping?'wait':'pointer', color:C.muted }}>
            {sweeping ? '…' : '▶ Rodar follow-up agora'}
          </button>
          <button onClick={()=>setPromptOpen(true)}
            title="Ver e editar o texto de instruções que a IA lê antes de responder."
            style={{ background:'#fff', border:'1px solid '+(typeof promptIa === 'string' ? C.p1 : C.border), borderRadius:20, padding:'5px 12px', fontSize:11, fontWeight:600, cursor:'pointer', color: typeof promptIa === 'string' ? C.p1 : C.muted }}>
            🧠 Prompt da IA{typeof promptIa === 'string' ? ' · personalizado' : ''}
          </button>
          <span style={{ fontSize:11, color:C.muted }}>
            IA por padrão em conversas novas: <strong style={{ color: iaPadrao ? C.p6 : C.muted }}>{iaPadrao ? 'ligada' : 'desligada'}</strong>
          </span>
        </span>
      </div>
      {sweep && sweep.at ? (
        <div style={{ fontSize:11, color:C.muted, marginTop:-4, marginBottom:10 }}>
          Última varredura de follow-up: {new Date(sweep.at).toLocaleString('pt-BR')}
          {sweep.note ? ' — ' + sweep.note : ''}
        </div>
      ) : null}

      {/* ALERTAS — pedido de preco/orcamento e escalonamentos da IA. */}
      {alertas.length > 0 ? (
        <div style={{ background:'#fff7ed', border:'1px solid #fdba74', borderRadius:12, padding:12, marginBottom:12 }}>
          <div style={{ fontWeight:800, fontSize:13, color:'#9a3412', marginBottom:8 }}>
            🔔 {alertas.length} {alertas.length === 1 ? 'pedido aguardando você' : 'pedidos aguardando você'}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {alertas.slice(0, 6).map(a => (
              <div key={a.id} style={{ display:'flex', alignItems:'center', gap:10, background:'#fff', border:'1px solid '+C.border, borderRadius:10, padding:'8px 12px' }}>
                <span style={{ background: a.kind==='preco' ? '#fee2e2' : a.kind==='orcamento' ? '#dbeafe' : '#f3f4f6',
                  color: a.kind==='preco' ? '#b91c1c' : a.kind==='orcamento' ? '#1d4ed8' : '#374151',
                  borderRadius:6, padding:'2px 8px', fontSize:10, fontWeight:700, textTransform:'uppercase' }}>{a.kind}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:C.ink }}>{a.title}</div>
                  {a.body ? <div style={{ fontSize:11, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>“{a.body}”</div> : null}
                </div>
                <button onClick={()=>abrirConversa(a.wa_id)}
                  style={{ background:C.p1, color:'#fff', border:'none', borderRadius:8, padding:'5px 12px', fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                  Abrir conversa
                </button>
                <button onClick={()=>resolverAlerta(a.id)} title="Marcar como resolvido"
                  style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'5px 10px', fontSize:11, cursor:'pointer', color:C.muted }}>✓</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {diag ? (
        <pre style={{ background:'#1a1a2e', color:'#e6e6f0', padding:12, borderRadius:10, fontSize:11, lineHeight:1.5, overflowX:'auto', marginBottom:12, maxHeight:260 }}>
          {typeof diag === 'string' ? diag : JSON.stringify(diag, null, 2)}
        </pre>
      ) : null}
      <div style={{ background:'#fff', borderRadius:16, boxShadow:'0 2px 12px rgba(26,26,46,.06)', overflow:'hidden', display:'flex', height:'calc(100vh - 230px)', minHeight:420 }}>
        {/* Coluna de conversas */}
        <div style={{ width:320, minWidth:260, borderRight:'1px solid '+C.border, display:'flex', flexDirection:'column' }}>
          <div style={{ padding:12, borderBottom:'1px solid '+C.border, display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ display:'flex', gap:8 }}>
              <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar numero ou nome…"
                style={{ flex:1, minWidth:0, padding:'8px 12px', borderRadius:10, border:'1.5px solid '+C.border, fontSize:13, outline:'none' }} />
              <button onClick={novaConversa} title="Nova conversa"
                style={{ background:C.p1, color:'#fff', border:'none', borderRadius:10, padding:'0 14px', fontWeight:700, fontSize:18, cursor:'pointer', flexShrink:0 }}>+</button>
            </div>
            {/* Filtro "Nao lidas" (2026-09-09, pedido do usuario): so conversas
                com mensagem de cliente que ninguem abriu. Clicar de novo volta
                pra todas. A conversa aberta continua na lista (ver
                filtrarConversas). */}
            <button onClick={()=>setSoNaoLidas(v => !v)} aria-pressed={soNaoLidas}
              title={soNaoLidas ? 'Mostrando so conversas com mensagem nova de cliente. Clique pra ver todas.' : 'Mostrar so conversas com mensagem nova de cliente'}
              style={{ alignSelf:'flex-start', display:'inline-flex', alignItems:'center', gap:6,
                background: soNaoLidas ? C.p1 : '#fff', color: soNaoLidas ? '#fff' : C.ink,
                border:'1.5px solid '+(soNaoLidas ? C.p1 : C.border), borderRadius:999, padding:'4px 12px',
                fontSize:12, fontWeight:700, cursor:'pointer' }}>
              <span aria-hidden="true">{soNaoLidas ? '✓' : '●'}</span>
              Não lidas
              <span style={{ background: soNaoLidas ? 'rgba(255,255,255,.25)' : C.cream, color: soNaoLidas ? '#fff' : C.p1,
                borderRadius:10, padding:'0 7px', fontSize:11, fontWeight:800, lineHeight:'16px' }}>{conversasNaoLidas}</span>
            </button>
          </div>
          <div style={{ flex:1, overflowY:'auto' }}>
            {loading ? (
              <div style={{ padding:20, color:C.muted, fontSize:13 }}>Carregando…</div>
            ) : convsFiltradas.length === 0 ? (
              <div style={{ padding:20, color:C.muted, fontSize:13 }}>
                {convs.length === 0
                  ? 'Nenhuma conversa ainda. Mensagens recebidas no +55 11 92072-5935 aparecem aqui.'
                  : soNaoLidas && !busca.trim()
                    ? 'Nenhuma conversa com mensagem nova de cliente. Tudo lido. 👏'
                    : soNaoLidas
                      ? 'Nada encontrado entre as não lidas.'
                      : 'Nada encontrado na busca.'}
              </div>
            ) : convsFiltradas.slice(0, WA_LISTA_MAX).map(c => (
              <div key={c.waId} onClick={() => abrirConversa(c.waId)}
                style={{ padding:'12px 14px', cursor:'pointer', borderBottom:'1px solid '+C.cream,
                  background: openWa === c.waId ? C.cream : 'transparent' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:8, alignItems:'center' }}>
                  <strong style={{ fontSize:13, color:C.ink, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    fontWeight: naoLidas(c) > 0 ? 800 : 600 }}>{nomeDe(c)}</strong>
                  <span style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                    {naoLidas(c) > 0 ? (
                      <span title={naoLidas(c) + ' mensagem(ns) que voce ainda nao abriu'}
                        style={{ background:C.p1, color:'#fff', borderRadius:10, fontSize:10, fontWeight:800,
                          padding:'1px 7px', lineHeight:'16px' }}>{naoLidas(c) > 99 ? '99+' : naoLidas(c)}</span>
                    ) : null}
                    <ChipCanal c={c} mini />
                    <span style={{ fontSize:11, color:C.muted, whiteSpace:'nowrap' }}>{waHora(c.last)}</span>
                  </span>
                </div>
                {origemDe(c) ? (
                  <div style={{ fontSize:10, color:C.p3, fontWeight:600, marginTop:1 }}>{origemDe(c)}</div>
                ) : null}
                <div style={{ fontSize:12, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>
                  {(c.last.direction === 'out' ? 'Voce: ' : '') + previewMsg(c.last)}
                </div>
              </div>
            ))}
            {convsFiltradas.length > WA_LISTA_MAX ? (
              <div style={{ padding:'10px 14px', fontSize:11, color:C.muted, textAlign:'center' }}>
                Mostrando {WA_LISTA_MAX} de {convsFiltradas.length} conversas — use a busca ou o filtro pra achar as outras.
              </div>
            ) : null}
          </div>
        </div>
        {/* Thread */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', background:C.cream }}>
          {!openWa ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:C.muted, fontSize:14, padding:20, textAlign:'center' }}>
              Selecione uma conversa ao lado — ou toque em + pra comecar uma nova.<br/>Canal: Dualhook (Cloud API).
            </div>
          ) : (
            <>
              <div style={{ padding:'12px 16px', background:'#fff', borderBottom:'1px solid '+C.border, fontWeight:700, fontSize:14, color:C.ink }}>
                {aberta ? nomeDe(aberta) : (leadByPhone[openWa.slice(-8)]?.name || fmtWaPhone(openWa))}
                <span style={{ fontWeight:400, color:C.muted, fontSize:12, marginLeft:8 }}>{fmtWaPhone(openWa)}</span>
                {(() => {
                  const org = aberta ? origemDe(aberta) : (leadByPhone[openWa.slice(-8)]?.category || null);
                  return org ? <span style={{ marginLeft:8, background:C.p3+'1f', color:C.p3, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>{org}</span> : null;
                })()}
                {aberta ? <span style={{ marginLeft:8 }}><ChipCanal c={aberta} /></span> : null}
                {/* CHAVE DA IA — liga/desliga a resposta automatica NESTA
                    conversa. Desliga sozinha quando escala pra humano. */}
                <button onClick={()=>toggleIa(openWa)} title={iaLigada(openWa) ? 'IA respondendo — clique pra assumir a conversa' : 'IA desligada — clique pra ela responder'}
                  style={{ float:'right', display:'flex', alignItems:'center', gap:6, background: iaLigada(openWa) ? C.p6+'1f' : 'transparent',
                    border:'1px solid '+(iaLigada(openWa) ? C.p6 : C.border), color: iaLigada(openWa) ? C.p6 : C.muted,
                    borderRadius:20, padding:'4px 12px', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background: iaLigada(openWa) ? C.p6 : C.border, display:'inline-block' }} />
                  {iaLigada(openWa) ? 'IA ligada' : 'IA desligada'}
                </button>
                {/* Ultima decisao da IA nesta conversa — explica o silencio
                    (horario, teto diario, chave, erro) em vez de deixar o
                    operador adivinhando. */}
                {iaWhy[openWa] ? (
                  <div style={{ clear:'both', textAlign:'right', fontSize:10, color:C.muted, fontWeight:400, marginTop:2 }}>
                    IA: {iaWhy[openWa].why}
                    {iaWhy[openWa].at ? ' · ' + new Date(iaWhy[openWa].at).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : ''}
                  </div>
                ) : null}
              </div>
              <div ref={threadRef} style={{ flex:1, overflowY:'auto', padding:16, display:'flex', flexDirection:'column', gap:6 }}>
                {thread.length === 0 ? (
                  <div style={{ color:C.muted, fontSize:13, textAlign:'center', marginTop:20 }}>Sem historico com este numero — escreva a primeira mensagem abaixo.</div>
                ) : thread.map(m => (
                  <div key={m.id} style={{
                    alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start',
                    maxWidth:'72%', padding:'8px 12px', borderRadius:12, fontSize:13, lineHeight:1.45,
                    background: m.direction === 'out' ? C.p1 : '#fff',
                    color: m.direction === 'out' ? '#fff' : C.ink,
                    boxShadow:'0 1px 3px rgba(0,0,0,.06)', whiteSpace:'pre-wrap', wordBreak:'break-word'
                  }}>
                    <BolhaConteudo m={m} url={m.media_url ? midiaUrls[m.media_url] : null} />
                    <div style={{ fontSize:10, opacity:.7, marginTop:3, textAlign:'right', display:'flex', gap:5, justifyContent:'flex-end', alignItems:'center' }}>
                      <span>{waHora(m)}</span>
                      <StatusEntrega m={m} />
                    </div>
                    {m.direction === 'out' && m.delivery_status === 'failed' && m.delivery_error ? (
                      /* O motivo fica NA BOLHA, nao so no title: quem esta
                         investigando por que o cliente nao respondeu precisa
                         ler isso sem descobrir que ha um tooltip. */
                      <div style={{ fontSize:10, marginTop:4, padding:'4px 6px', borderRadius:6,
                        background:'rgba(255,255,255,.22)', lineHeight:1.4 }}>
                        {m.delivery_error}
                      </div>
                    ) : null}
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {err ? <div style={{ padding:'8px 16px', background:'#fdecea', color:'#b3261e', fontSize:12 }}>{err}</div> : null}
              {!janelaAberta(thread) ? (
                /* Janela fechada: esconder o campo de texto e oferecer o
                   template. Mostrar um campo que so devolve erro 131047
                   ensina o operador a desconfiar da tela. */
                /* TETO + ROLAGEM PROPRIA (2026-09-08): este bloco e filho
                   de uma coluna flex de altura fixa. Sem `overflow`, item de
                   flex nao encolhe abaixo do conteudo — e o v2 (texto longo
                   + 4 botoes na previa) ficou mais alto que a coluna, entao
                   empurrava o cabecalho e as mensagens pra fora da tela em
                   vez de rolar. Agora ocupa no maximo 62% da coluna e rola
                   por dentro; o historico continua a vista em cima. */
                <div style={{ padding:14, background:'#fff', borderTop:'1px solid '+C.border,
                  flex:'0 1 auto', minHeight:0, maxHeight:'62%', overflowY:'auto' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:C.ink, marginBottom:4 }}>
                    ⏳ Fora da janela de 24h — comece por um template
                  </div>
                  <div style={{ fontSize:12, color:C.muted, lineHeight:1.5, marginBottom:10 }}>
                    {thread.some(m => m.direction === 'in')
                      ? 'Faz mais de 24h desde a última mensagem desta pessoa, então o WhatsApp não aceita texto livre.'
                      : 'Esta pessoa nunca escreveu pra loja, então o WhatsApp não aceita texto livre.'}
                    {' '}Assim que ela <strong style={{ color:C.ink }}>responder</strong>, o campo de escrever volta sozinho por 24h.
                  </div>
                  <EnvioDeTemplate
                    waId={openWa}
                    nomeContato={nomeDoContatoAberto}
                    dadosContato={dadosDoContatoAberto}
                    enviando={sending}
                    estagio={sendStage}
                    onEnviar={enviarTemplate}
                  />
                </div>
              ) : (
              <>
              <div style={{ display:'flex', gap:8, padding:12, background:'#fff', borderTop:'1px solid '+C.border }}>
                <input value={text} onChange={e=>setText(e.target.value)}
                  onKeyDown={e => { if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); enviar(); } }}
                  placeholder="Escreva uma mensagem…"
                  style={{ flex:1, padding:'10px 14px', borderRadius:12, border:'1.5px solid '+C.border, fontSize:14, outline:'none' }} />
                {/* COPILOTO: traz a sugestao da IA pro campo, sem enviar.
                    Funciona a qualquer hora (quem pediu foi uma pessoa). */}
                <button onClick={sugerirResposta} disabled={sugerindo} title="A IA lê a conversa e escreve a resposta aqui (você revisa antes de enviar)"
                  style={{ background:'#fff', color:C.p3, border:'1.5px solid '+C.border, borderRadius:12, padding:'0 14px', fontWeight:700, fontSize:13,
                    cursor: sugerindo ? 'wait' : 'pointer', whiteSpace:'nowrap' }}>
                  {sugerindo ? '✨ Pensando…' : '✨ Sugerir'}
                </button>
                <button onClick={enviar} disabled={sending || !text.trim()}
                  style={{ background:C.p1, color:'#fff', border:'none', borderRadius:12, padding:'0 20px', fontWeight:700, fontSize:14,
                    cursor: sending ? 'wait' : 'pointer', opacity: sending || !text.trim() ? .6 : 1 }}>
                  {sending ? (sendStage || 'Enviando…') : 'Enviar'}
                </button>
              </div>
              {restanteDaJanela(thread) ? (
                <div style={{ padding:'0 16px 10px', background:'#fff', color:C.muted, fontSize:11 }}>
                  Janela de texto livre aberta — fecha em {restanteDaJanela(thread)} se a pessoa não escrever de novo.
                </div>
              ) : null}
              </>
              )}
            </>
          )}
        </div>
      </div>
      {promptOpen ? (
        <PromptDaIaModal atual={promptIa} onClose={()=>setPromptOpen(false)} onSalvo={(v)=>setPromptIa(v)} />
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Revista Click Rua — lista as edições e publica edição nova.
//
// A CONVERSÃO PRA WEBP ACONTECE NO NAVEGADOR, antes de subir: canvas +
// toBlob('image/webp'). Não há servidor de imagem no caminho, e é o que
// deixa a loja mandar PNG/JPG direto do computador sem inchar o bucket —
// na edição #01, 16 MB de PNG viraram 1,1 MB de WebP na mesma qualidade.
//
// O QUE NÃO DÁ PRA CONVERTER SOBE COMO VEIO. HEIC de iPhone, por exemplo, o
// canvas não decodifica; nesse caso o arquivo original é recusado pelo
// bucket (que só aceita webp/jpeg/png) e a tela diz qual arquivo foi, em
// vez de falhar em silêncio no meio de oito.

const CLICK_RUA_BUCKET = 'click-rua';
const CLICK_RUA_QUALIDADE = 0.82;
const CLICK_RUA_CAPA_PX = 560;
const CLICK_RUA_TIPOS_OK = ['image/webp', 'image/jpeg', 'image/png'];

/**
 * Pasta da edição no bucket, com um carimbo de tempo.
 *
 * O carimbo NÃO é enfeite: sem ele, republicar uma edição sobrescreveria
 * `1.webp` na MESMA URL, e o navegador (e o CDN) continuariam entregando a
 * página antiga — a loja trocaria o conteúdo e não veria diferença nenhuma.
 * Pasta nova a cada publicação = URL nova = sem cache velho. O custo é
 * deixar os arquivos da publicação anterior no bucket.
 */
function crPastaDaEdicao(numero){
  return 'ed' + String(numero).padStart(2, '0') + '/' + Date.now();
}

/** Ordena "2.png" antes de "10.png" — ordem de página, não alfabética. */
function crOrdemNatural(a, b){
  return String(a.name).localeCompare(String(b.name), 'pt-BR', { numeric:true, sensitivity:'base' });
}

/**
 * Desenha o arquivo num canvas e devolve WebP. `maxLado` opcional reduz a
 * imagem (usado só na capa).
 *
 * Devolve o ORIGINAL quando não consegue converter ou quando o WebP sairia
 * maior — acontece com JPEG já otimizado, e trocar por um arquivo maior
 * seria piorar em nome do formato.
 */
async function crParaWebp(file, maxLado){
  let bitmap = null;
  try { bitmap = await createImageBitmap(file); } catch(_){ bitmap = null; }
  if(!bitmap) return { blob:file, tipo:file.type || '', convertido:false };
  let w = bitmap.width, h = bitmap.height;
  if(maxLado && Math.max(w, h) > maxLado){
    const escala = maxLado / Math.max(w, h);
    w = Math.round(w * escala); h = Math.round(h * escala);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if(bitmap.close) bitmap.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', CLICK_RUA_QUALIDADE));
  if(!blob) return { blob:file, tipo:file.type || '', convertido:false };
  if(!maxLado && blob.size >= file.size) return { blob:file, tipo:file.type || '', convertido:false };
  return { blob, tipo:'image/webp', convertido:true };
}

function crFmtKB(bytes){
  if(!bytes && bytes !== 0) return '';
  return bytes < 1024*1024
    ? Math.round(bytes/1024) + ' KB'
    : (bytes/1024/1024).toFixed(1) + ' MB';
}

/**
 * Confere que a sessão ainda vale ANTES de converter e subir 27 imagens.
 *
 * A RLS do bucket exige `is_portal_admin()`. Quando o token expira no meio
 * de uma sessão longa de upload, `auth.uid()` vira NULL e o storage recusa
 * com "new row violates row-level security policy" — mensagem que parece
 * "faltou rodar o SQL" e não é. Pior: a LISTA continua carregando normal,
 * porque a leitura é liberada pra todo mundo, então nada na tela sugere
 * sessão. É o mesmo estado stale que já derrubou o PDF do orçamento.
 *
 * Fail-open no que não dá pra provar: se a RPC não estiver exposta no
 * PostgREST, seguimos e deixamos o storage dar a palavra final. Só barramos
 * com um NÃO explícito — checagem que chuta "não" trava quem estava
 * conseguindo trabalhar.
 */
async function crGaranteSessao(){
  const expirou = 'Sua sessão expirou. Saia e entre de novo no portal antes de publicar.';
  let ses = (await supa.auth.getSession()).data.session;
  if(!ses) ses = ((await supa.auth.refreshSession()).data || {}).session;
  if(!ses) throw new Error(expirou);
  const r1 = await supa.rpc('is_portal_admin');
  if(r1.error || r1.data !== false) return;
  // Um "não" pode ser só token velho: renova e pergunta de novo.
  if(!((await supa.auth.refreshSession()).data || {}).session) throw new Error(expirou);
  const r2 = await supa.rpc('is_portal_admin');
  if(r2.error || r2.data !== false) return;
  throw new Error('Esta conta não passa em is_portal_admin(), e o bucket da revista ' +
    'recusa a escrita sem isso. Entre com a conta da loja.');
}

const ClickRua = () => {
  const [edicoes, setEdicoes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [erro, setErro] = React.useState('');
  const [editando, setEditando] = React.useState(null); // numero da edicao
  const [progresso, setProgresso] = React.useState('');

  const carregar = React.useCallback(async () => {
    setErro('');
    const { data, error } = await supa.from('click_rua_editions')
      .select('numero, quando, destaque, status, capa_url, paginas')
      .order('numero', { ascending:true });
    if(error){
      setErro(error.code === '42P01'
        ? 'A tabela click_rua_editions ainda não existe — rode a migration 2026-09-06-click-rua-bucket.sql.'
        : (error.message || 'Erro ao carregar edições'));
      setEdicoes([]);
    } else {
      setEdicoes(data || []);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => { carregar(); }, [carregar]);

  if(loading) return <div style={{ padding:24, color:C.muted }}>Carregando edições…</div>;

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6, flexWrap:'wrap' }}>
        <h2 style={{ margin:0, fontSize:20, color:C.ink }}>📖 Revista Click Rua</h2>
        <button onClick={carregar} style={{ background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'6px 12px', fontSize:12, cursor:'pointer', color:C.muted }}>↻ Atualizar</button>
      </div>
      <p style={{ fontSize:13, color:C.muted, marginTop:0, marginBottom:16 }}>
        As páginas ficam no bucket <b>{CLICK_RUA_BUCKET}</b>. Ao publicar, cada arquivo é
        convertido para WebP aqui no navegador — pode mandar PNG ou JPG direto.
      </p>

      {erro ? (
        <div style={{ border:'1px solid '+C.p4, color:C.p4, borderRadius:10, padding:12, fontSize:13, marginBottom:16 }}>{erro}</div>
      ) : null}

      {progresso ? (
        <div style={{ border:'1px solid '+C.p1, color:C.p1, borderRadius:10, padding:12, fontSize:13, marginBottom:16, fontWeight:600 }}>{progresso}</div>
      ) : null}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:14 }}>
        {edicoes.map(ed => (
          <CardEdicaoPortal
            key={ed.numero}
            ed={ed}
            aberta={editando === ed.numero}
            onAbrir={() => setEditando(editando === ed.numero ? null : ed.numero)}
            onProgresso={setProgresso}
            onMudou={carregar}
          />
        ))}
      </div>

      {edicoes.length === 0 && !erro ? (
        <div style={{ color:C.muted, fontSize:13 }}>Nenhuma edição cadastrada ainda.</div>
      ) : null}
    </div>
  );
};

const CardEdicaoPortal = ({ ed, aberta, onAbrir, onProgresso, onMudou }) => {
  const paginas = ed.paginas || [];
  const pronta = ed.status === 'pronta' && paginas.length > 0;
  // Edição que ainda aponta pros arquivos publicados junto com o app
  // (caminho começa em "/") pode ser levada pro bucket num clique.
  const estatica = paginas.length > 0 && paginas.every(p => String(p).startsWith('/'));

  const [quando, setQuando] = React.useState(ed.quando || '');
  const [destaque, setDestaque] = React.useState(ed.destaque || '');
  const [arquivos, setArquivos] = React.useState([]);
  const [busy, setBusy] = React.useState(false);

  async function salvarTexto(){
    setBusy(true);
    const { data: salvas, error } = await supa.from('click_rua_editions')
      .update({ quando: quando.trim() || null, destaque: destaque.trim() || null })
      .eq('numero', ed.numero).select('numero');
    setBusy(false);
    if(error) alert('Erro ao salvar: ' + (error.message||error));
    else if(!salvas || salvas.length === 0){
      alert('Nada foi gravado: a sessão perdeu o acesso de admin do portal. ' +
        'Saia e entre de novo.');
    }
    else onMudou();
  }

  /** Sobe um blob e devolve a URL pública. */
  async function subir(path, blob, tipo){
    const { error } = await supa.storage.from(CLICK_RUA_BUCKET)
      .upload(path, blob, { upsert:true, contentType: tipo });
    if(error){
      const msg = String(error.message || error);
      // "row-level security" aqui é SEMPRE do bucket, nunca da tabela: o
      // Postgres escreve `for table "..."` quando é tabela, e o storage
      // não escreve. Sem essa distinção o operador vai conferir a
      // migration, que está certa, em vez da sessão, que não está.
      if(/row-level security/i.test(msg)){
        throw new Error('O bucket "' + CLICK_RUA_BUCKET + '" recusou ' + path +
          ': a sessão não passa em is_portal_admin(). Saia e entre de novo no ' +
          'portal. Se continuar, confira as policies "click-rua admin insert" e ' +
          '"click-rua admin update" em storage.objects.');
      }
      throw new Error('Falha ao enviar ' + path + ' (' + crFmtKB(blob.size) + ', ' +
        (tipo || 'sem tipo') + '): ' + msg);
    }
    const { data } = supa.storage.from(CLICK_RUA_BUCKET).getPublicUrl(path);
    return (data && data.publicUrl) || '';
  }

  async function publicar(){
    if(arquivos.length === 0){ alert('Escolha os arquivos das páginas.'); return; }
    setBusy(true);
    const pasta = crPastaDaEdicao(ed.numero);
    try {
      // Antes de gastar minutos convertendo: a sessão ainda escreve?
      onProgresso('Conferindo a sessão…');
      await crGaranteSessao();
      const urls = [];
      for(let i = 0; i < arquivos.length; i++){
        const f = arquivos[i];
        onProgresso('Convertendo e enviando página ' + (i+1) + ' de ' + arquivos.length + '…');
        const { blob, tipo, convertido } = await crParaWebp(f, 0);
        if(!convertido && CLICK_RUA_TIPOS_OK.indexOf(tipo) === -1){
          throw new Error('Não consegui converter "' + f.name + '" (' + (tipo || 'formato desconhecido') +
            '). Converta para JPG ou PNG antes de subir — HEIC do iPhone não é lido pelo navegador.');
        }
        const ext = convertido ? 'webp' : (tipo === 'image/png' ? 'png' : 'jpg');
        urls.push(await subir(pasta + '/' + (i+1) + '.' + ext, blob, tipo || 'image/webp'));
      }
      onProgresso('Gerando a capa…');
      const capa = await crParaWebp(arquivos[0], CLICK_RUA_CAPA_PX);
      const capaUrl = await subir(pasta + '/capa.webp', capa.blob, capa.tipo || 'image/webp');

      onProgresso('Salvando a edição…');
      // `.select()` NÃO é enfeite: UPDATE barrado por RLS não devolve erro,
      // devolve ZERO linha. Sem conferir isso, as 27 páginas ficariam no
      // bucket e a edição simplesmente não apareceria — falha cara e muda.
      const { data: salvas, error } = await supa.from('click_rua_editions').update({
        paginas: urls, capa_url: capaUrl, status: 'pronta',
        quando: quando.trim() || null, destaque: destaque.trim() || null,
      }).eq('numero', ed.numero).select('numero');
      if(error) throw error;
      if(!salvas || salvas.length === 0){
        throw new Error('As ' + urls.length + ' páginas subiram, mas a linha da edição #' +
          ed.numero + ' não foi gravada (nenhuma linha atingida). Ou a sessão perdeu o ' +
          'acesso de admin, ou a edição #' + ed.numero + ' não existe na tabela.');
      }
      setArquivos([]);
      onProgresso('');
      onMudou();
      alert('Edição #' + ed.numero + ' publicada com ' + urls.length + ' páginas.');
    } catch(err){
      onProgresso('');
      alert('Erro ao publicar: ' + (err.message || err));
    }
    setBusy(false);
  }

  /** Leva as páginas estáticas (servidas pelo site) pro bucket. */
  async function migrarParaBucket(){
    if(!confirm('Copiar as ' + paginas.length + ' páginas da edição #' + ed.numero + ' para o bucket?')) return;
    setBusy(true);
    const pasta = crPastaDaEdicao(ed.numero);
    try {
      onProgresso('Conferindo a sessão…');
      await crGaranteSessao();
      const urls = [];
      for(let i = 0; i < paginas.length; i++){
        onProgresso('Copiando página ' + (i+1) + ' de ' + paginas.length + ' para o bucket…');
        const resp = await fetch(paginas[i]);
        if(!resp.ok) throw new Error('Não consegui baixar ' + paginas[i] + ' (HTTP ' + resp.status + ')');
        const blob = await resp.blob();
        urls.push(await subir(pasta + '/' + (i+1) + '.webp', blob, 'image/webp'));
      }
      let capaUrl = ed.capa_url;
      if(capaUrl && String(capaUrl).startsWith('/')){
        onProgresso('Copiando a capa…');
        const resp = await fetch(capaUrl);
        if(resp.ok) capaUrl = await subir(pasta + '/capa.webp', await resp.blob(), 'image/webp');
      }
      onProgresso('Salvando…');
      const { data: salvas, error } = await supa.from('click_rua_editions')
        .update({ paginas: urls, capa_url: capaUrl }).eq('numero', ed.numero).select('numero');
      if(error) throw error;
      if(!salvas || salvas.length === 0){
        throw new Error('As páginas foram copiadas, mas a linha da edição #' + ed.numero +
          ' não foi gravada (nenhuma linha atingida).');
      }
      onProgresso('');
      onMudou();
      alert('Edição #' + ed.numero + ' agora está no bucket.');
    } catch(err){
      onProgresso('');
      alert('Erro ao migrar: ' + (err.message || err));
    }
    setBusy(false);
  }

  async function despublicar(){
    if(!confirm('Tirar a edição #' + ed.numero + ' do ar? As páginas continuam no bucket.')) return;
    setBusy(true);
    const { error } = await supa.from('click_rua_editions')
      .update({ status:'em_breve' }).eq('numero', ed.numero);
    setBusy(false);
    if(error) alert('Erro: ' + (error.message||error)); else onMudou();
  }

  function escolher(lista){
    setArquivos(Array.from(lista).sort(crOrdemNatural));
  }

  function mover(i, delta){
    const j = i + delta;
    if(j < 0 || j >= arquivos.length) return;
    const copia = arquivos.slice();
    const t = copia[i]; copia[i] = copia[j]; copia[j] = t;
    setArquivos(copia);
  }

  return (
    <div style={{ background:'#fff', border:'1px solid '+C.border, borderRadius:12, overflow:'hidden' }}>
      <div style={{ aspectRatio:'1 / 1', background:'#1a1a2e', position:'relative' }}>
        {pronta && ed.capa_url ? (
          <img src={ed.capa_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
        ) : (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'rgba(255,255,255,.85)', fontSize:34, fontWeight:800, background:'linear-gradient(135deg,#ff6b35,#1a1a2e)' }}>
            #{String(ed.numero).padStart(2,'0')}
          </div>
        )}
      </div>

      <div style={{ padding:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8 }}>
          <b style={{ fontSize:14, color:C.ink }}>Edição #{String(ed.numero).padStart(2,'0')}</b>
          <span style={{ fontSize:11, color: pronta ? C.p6 : C.muted, fontWeight:600 }}>
            {pronta ? paginas.length + ' páginas no ar' : 'Em breve'}
          </span>
        </div>
        <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{ed.quando || 'sem data'}</div>
        {ed.destaque ? <div style={{ fontSize:12, color:C.p1, marginTop:2, fontWeight:600 }}>{ed.destaque}</div> : null}
        {estatica ? (
          <div style={{ fontSize:11, color:C.muted, marginTop:6, lineHeight:1.4 }}>
            ⚠️ Ainda servida do site, não do bucket.
          </div>
        ) : null}

        <button onClick={onAbrir} style={{ marginTop:10, width:'100%', background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'7px 12px', fontSize:12, cursor:'pointer', color:C.ink }}>
          {aberta ? 'Fechar' : 'Editar / publicar'}
        </button>

        {aberta ? (
          <div style={{ marginTop:12, borderTop:'1px solid '+C.border, paddingTop:12 }}>
            <label style={{ fontSize:11, color:C.muted }}>Mês/ano da capa</label>
            <input value={quando} onChange={e=>setQuando(e.target.value)} placeholder="setembro de 2020"
              style={{ width:'100%', padding:'7px 10px', border:'1px solid '+C.border, borderRadius:8, fontSize:13, marginBottom:8 }} />

            <label style={{ fontSize:11, color:C.muted }}>Chamada de capa</label>
            <input value={destaque} onChange={e=>setDestaque(e.target.value)} placeholder="B.Girl LU BSB e sua trajetória"
              style={{ width:'100%', padding:'7px 10px', border:'1px solid '+C.border, borderRadius:8, fontSize:13, marginBottom:10 }} />

            <button onClick={salvarTexto} disabled={busy} style={{ width:'100%', background:'none', border:'1px solid '+C.border, borderRadius:8, padding:'7px 12px', fontSize:12, cursor:'pointer', color:C.ink, marginBottom:12 }}>
              Salvar texto
            </button>

            <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:4 }}>
              Páginas (na ordem de leitura)
            </label>
            <input type="file" accept="image/*" multiple disabled={busy}
              onChange={e => escolher(e.target.files)} style={{ fontSize:12, width:'100%' }} />

            {arquivos.length > 0 ? (
              <div style={{ marginTop:8, maxHeight:220, overflowY:'auto', border:'1px solid '+C.border, borderRadius:8 }}>
                {arquivos.map((f, i) => (
                  <div key={f.name + i} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderTop: i ? '1px solid '+C.border : 'none' }}>
                    <b style={{ fontSize:11, color:C.muted, width:18 }}>{i+1}</b>
                    <span style={{ fontSize:11, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                    <span style={{ fontSize:10, color:C.muted }}>{crFmtKB(f.size)}</span>
                    <button onClick={()=>mover(i,-1)} disabled={i===0} style={{ border:'none', background:'none', cursor:'pointer', fontSize:12 }}>↑</button>
                    <button onClick={()=>mover(i,1)} disabled={i===arquivos.length-1} style={{ border:'none', background:'none', cursor:'pointer', fontSize:12 }}>↓</button>
                  </div>
                ))}
              </div>
            ) : null}

            <button onClick={publicar} disabled={busy || arquivos.length===0}
              style={{ width:'100%', marginTop:10, background: (busy||arquivos.length===0) ? C.border : C.p1, color:'#fff', border:'none', borderRadius:8, padding:'9px 12px', fontSize:13, fontWeight:700, cursor:(busy||arquivos.length===0)?'default':'pointer' }}>
              {busy ? 'Trabalhando…' : 'Publicar ' + (arquivos.length || '') + ' páginas'}
            </button>

            {estatica ? (
              <button onClick={migrarParaBucket} disabled={busy}
                style={{ width:'100%', marginTop:8, background:'none', border:'1px solid '+C.p1, color:C.p1, borderRadius:8, padding:'7px 12px', fontSize:12, fontWeight:600, cursor:busy?'default':'pointer' }}>
                Copiar páginas do site para o bucket
              </button>
            ) : null}

            {pronta ? (
              <button onClick={despublicar} disabled={busy}
                style={{ width:'100%', marginTop:8, background:'none', border:'1px solid '+C.border, color:C.muted, borderRadius:8, padding:'7px 12px', fontSize:12, cursor:busy?'default':'pointer' }}>
                Tirar do ar
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ============================================================
// USO DO APP (2026-09-09, pedido do usuario: "tela de estatistica/relatorio
// mostrando dashboard em relacao ao uso do app: quem postou mais fotos,
// videos, colocou a venda, teve mais curtidas, convidou mais gente, pediu
// material na loja, camisa, uso das IAs, fez orcamentos").
// Quem AGREGA e o servidor (`POST /api/admin/stats`, service role):
// `ai_usage`, `referrals` e `points` tem RLS "cada um ve o seu", entao a
// consulta direta daqui mostraria so as linhas do proprio admin. A tela so
// desenha o que a rota devolve.
// ============================================================
// [teste:uso-inicio]
// Nome que o operador entende pra cada `feature` de ai_usage. Feature nova
// gravada por rota nova = linha nova aqui (o teste varre app/api).
const IA_FEATURE_ROTULOS = {
  alice: '🎨 Alice', fe: '🧑‍🎨 Fê', senna: '🏎️ Senna', chat_ai: '👷 Seu Zé (chat)',
  alice_tts: '🔊 Alice (voz)', tts: '🔊 Voz (TTS)', transcribe: '🎙️ Transcrição de áudio',
  caption: '✍️ Legenda de post', generate_logo: '🖼️ Gerar logo', ig_art: '📸 Arte pra IG',
  area_from_photo: '📐 Área pela foto', pricing_suggest: '💰 Sugestão de preço',
  fin_analysis: '📊 Análise financeira', crm_draft: '📇 Texto do CRM', agenda_order: '📅 Agenda',
  resolve_color: '🎯 Achar cor', receipt_ocr: '🧾 Ler nota fiscal', moderate: '🛡️ Moderação (foto)',
  moderate_video: '🛡️ Moderação (vídeo)'
};
const rotuloDeFeature = (f) => IA_FEATURE_ROTULOS[f] || f;
// As personas gravam 'alice'/'fe'/'senna' — nomes FORA do CHECK original da
// ai_usage. Sem o SQL de 2026-09-09 o INSERT delas falha em silencio.
const IA_PERSONAS = ['alice', 'fe', 'senna'];
// Categorias do podio: campo do relatorio + rotulo + como ler o numero.
const CATEGORIAS_DE_USO = [
  { campo:'atividade',         icone:'🔥', rotulo:'Mais ativos',                unidade:'pts',        dica:'Pontuação que soma tudo abaixo (publicar, orçar e pedir valem mais que curtir).' },
  { campo:'fotos',             icone:'📷', rotulo:'Mais fotos publicadas',      unidade:'fotos' },
  { campo:'videos',            icone:'🎬', rotulo:'Mais vídeos publicados',     unidade:'vídeos' },
  { campo:'venda',             icone:'🏷️', rotulo:'Mais itens à venda',         unidade:'itens' },
  { campo:'curtidas',          icone:'❤️', rotulo:'Mais curtidas recebidas',    unidade:'curtidas' },
  { campo:'comentarios',       icone:'💬', rotulo:'Mais comentários recebidos', unidade:'coment.' },
  { campo:'seguidores',        icone:'👥', rotulo:'Mais seguidores',            unidade:'seg.' },
  { campo:'indicacoes',        icone:'🔗', rotulo:'Mais indicações',            unidade:'convites', dica:'Cadastros que entraram pelo link de indicação da pessoa.' },
  { campo:'pedidos',           icone:'🛒', rotulo:'Mais pedidos na loja',       unidade:'pedidos' },
  { campo:'camisetas',         icone:'👕', rotulo:'Mais camisetas pedidas',     unidade:'pedidos',  dica:'Pedidos da loja com a camiseta personalizada no carrinho.' },
  { campo:'logos',             icone:'🖼️', rotulo:'Mais logos (Seu Zé/upload)', unidade:'logos' },
  { campo:'ia',                icone:'🤖', rotulo:'Mais uso de IA',             unidade:'chamadas', dica:'A tabela registra CHAMADAS, não minutos — é a medida de uso que existe.' },
  { campo:'orcamentosFeitos',  icone:'🧾', rotulo:'Mais orçamentos feitos',     unidade:'orç.',     dica:'Como profissional (o pintor que montou o orçamento).' },
  { campo:'orcamentosPedidos', icone:'📩', rotulo:'Mais orçamentos pedidos',    unidade:'orç.',     dica:'Como cliente (quem pediu).' },
  { campo:'avaliacoes',        icone:'⭐', rotulo:'Mais avaliações recebidas',  unidade:'aval.' }
];
// Inicio do periodo escolhido, em ISO. 'tudo' = sem corte.
const desdeDoPeriodo = (periodo, agora) => {
  const dias = { '7d':7, '30d':30, '90d':90, '365d':365 }[periodo];
  if (!dias) return null;
  return new Date((agora || Date.now()) - dias * 86400000).toISOString();
};
const csvDoUso = (pessoas) => {
  const cols = [['Nome','nome'],['@tag','tag'],['Papel','papel'],['Cidade','cidade'],['Fotos','fotos'],['Vídeos','videos'],
    ['À venda','venda'],['Curtidas recebidas','curtidas'],['Comentários recebidos','comentarios'],['Comentou','comentou'],['Curtiu','curtiu'],
    ['Seguidores','seguidores'],['Indicações','indicacoes'],['Pedidos loja','pedidos'],['Itens pedidos','itensPedidos'],
    ['Camisetas','camisetas'],['Logos','logos'],['Chamadas IA','ia'],['Orçamentos feitos','orcamentosFeitos'],
    ['Orçamentos pedidos','orcamentosPedidos'],['Avaliações','avaliacoes'],['Nota média','notaMedia'],
    ['Última atividade','ultimaAtividade'],['Atividade (pts)','atividade']];
  const linhas = [cols.map(c => c[0])].concat(pessoas.map(p => cols.map(c => p[c[1]] == null ? '' : p[c[1]])));
  return '\uFEFF' + linhas.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n');
};
// [teste:uso-fim]

const PAPEL_ROTULOS = { pintor:'Pintor', grafiteiro:'Grafiteiro', funileiro:'Funileiro', automotivo:'Automotivo',
  arquiteto:'Arquiteto', engenheiro:'Engenheiro', cliente:'Cliente', admin:'Admin' };

const UsoDoApp = () => {
  const [periodo, setPeriodo] = useState('30d');
  const [rel, setRel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [soAtivos, setSoAtivos] = useState(true);
  const [ordem, setOrdem] = useState('atividade');
  const [limite, setLimite] = useState(100);
  // Trocar o período com um pedido em voo: só a resposta do ÚLTIMO pedido
  // entra na tela (o mais largo demora mais e chegaria depois, por cima).
  const pedidoRef = React.useRef(0);

  const carregar = async (per) => {
    const meu = ++pedidoRef.current;
    const atual = () => meu === pedidoRef.current;
    setLoading(true); setErro('');
    try {
      const { data: { session } } = await supa.auth.getSession();
      if (!session) throw new Error('Sessão expirada. Entre novamente.');
      const r = await fetch('/api/admin/stats', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, desde: desdeDoPeriodo(per || periodo) })
      });
      let j = {};
      try { j = await r.json(); } catch (_) {}
      if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
      if (!atual()) return;
      setRel(j);
    } catch (e) {
      if (!atual()) return;
      setErro(e && e.message ? e.message : String(e));
    }
    if (atual()) setLoading(false);
  };
  useEffect(() => { carregar(periodo); }, [periodo]);

  const pessoas = React.useMemo(() => {
    if (!rel) return [];
    let out = rel.pessoas;
    if (soAtivos) out = out.filter(p => p.atividade > 0);
    if (busca.trim()) { const q = busca.trim().toLowerCase(); out = out.filter(p => (p.nome||'').toLowerCase().includes(q) || (p.tag||'').toLowerCase().includes(q) || (p.cidade||'').toLowerCase().includes(q)); }
    const cmp = new Intl.Collator('pt-BR').compare;
    return [...out].sort((a, b) => ordem === 'nome' ? cmp(a.nome, b.nome) : ((Number(b[ordem])||0) - (Number(a[ordem])||0)) || cmp(a.nome, b.nome));
  }, [rel, soAtivos, busca, ordem]);
  useEffect(() => { setLimite(100); }, [soAtivos, busca, ordem, rel]);

  const semPersonas = rel && !rel.iaPorFeature.some(f => IA_PERSONAS.includes(f.feature));
  const maxIa = rel && rel.iaPorFeature.length ? rel.iaPorFeature[0].chamadas : 1;

  const exportar = () => {
    const blob = new Blob([csvDoUso(pessoas)], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'uso_do_app_' + periodo + '.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const Pessoa = ({ p, n, unidade, pos }) => (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0', borderBottom:'1px solid '+C.border }}>
      <span style={{ width:20, textAlign:'center', fontSize: pos < 3 ? 15 : 11, color:C.muted }}>{['🥇','🥈','🥉'][pos] || (pos + 1) + 'º'}</span>
      {p.avatar ? <img src={p.avatar} alt="" style={{ width:26, height:26, borderRadius:'50%', objectFit:'cover' }} />
        : <div style={{ width:26, height:26, borderRadius:'50%', background:C.p1+'22', color:C.p1, fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>{(p.nome||'?').charAt(0).toUpperCase()}</div>}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.nome}</div>
        <div style={{ fontSize:10, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.tag ? '@' + p.tag : ''}{p.papel ? (p.tag ? ' · ' : '') + (PAPEL_ROTULOS[p.papel] || p.papel) : ''}</div>
      </div>
      <div style={{ fontSize:13, fontWeight:700, color:C.ink, whiteSpace:'nowrap' }}>{Number(n).toLocaleString('pt-BR')} <span style={{ fontSize:10, color:C.muted, fontWeight:500 }}>{unidade}</span></div>
    </div>
  );

  const Th = ({ campo, rot, title }) => (
    <th onClick={()=>setOrdem(campo)} title={title || 'Ordenar por ' + rot}
      style={{ padding:'8px 8px', fontSize:10, color: ordem === campo ? C.p1 : C.muted, textTransform:'uppercase', letterSpacing:0.5, cursor:'pointer', whiteSpace:'nowrap', textAlign: campo === 'nome' ? 'left' : 'right', userSelect:'none' }}>
      {rot}{ordem === campo ? ' ▼' : ''}
    </th>
  );
  const colunas = [['fotos','Fotos'],['videos','Vídeos'],['venda','À venda'],['curtidas','Curtidas'],['comentarios','Coment.'],['curtiu','Curtiu'],['seguidores','Seg.'],
    ['indicacoes','Indic.'],['pedidos','Pedidos'],['camisetas','Camisetas'],['logos','Logos'],['ia','IA'],['orcamentosFeitos','Orç. feitos'],
    ['orcamentosPedidos','Orç. pedidos'],['avaliacoes','Aval.'],['atividade','Pts']];

  return (
    <div>
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginBottom:16 }}>
        <div style={{ fontWeight:700, fontSize:16, color:C.ink }}>📊 Uso do app</div>
        <select value={periodo} onChange={e=>setPeriodo(e.target.value)} style={{ padding:'8px 10px', borderRadius:10, border:'1px solid '+C.border, background:C.white, color:C.ink, fontSize:12, cursor:'pointer' }}>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="90d">Últimos 90 dias</option>
          <option value="365d">Últimos 12 meses</option>
          <option value="tudo">Desde o início</option>
        </select>
        <button onClick={()=>carregar()} disabled={loading} style={{ padding:'8px 12px', borderRadius:10, border:'1px solid '+C.border, background:C.white, color:C.ink, fontSize:12, cursor:'pointer' }}>↻ Atualizar</button>
        <button onClick={exportar} disabled={!rel} style={{ padding:'8px 12px', borderRadius:10, border:'1px solid '+C.border, background:C.white, color:C.ink, fontSize:12, cursor:'pointer' }}>⬇ CSV</button>
        {rel ? <span style={{ fontSize:11, color:C.muted }}>gerado {new Date(rel.geradoEm).toLocaleString()} · perfis, seguidores e a base de contagem não dependem do período; o resto conta só o que aconteceu no período.</span> : null}
      </div>
      {erro ? <div style={{ padding:12, background:'#fdecea', border:'1px solid #f5c2c0', borderRadius:10, color:'#b00020', fontSize:12, marginBottom:12 }}>Não consegui montar o relatório: {erro}</div> : null}
      {loading && !rel ? <div style={{ padding:20, color:C.muted }}>Contando o uso do app…</div> : null}
      {rel ? (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {rel.truncado && rel.truncado.length ? (
            <div style={{ padding:'8px 12px', background:'#fff4e0', border:'1px solid #f0b35a', borderRadius:10, fontSize:12, color:'#7a4b00', marginBottom:12 }}>
              ⚠ Parte dos dados ficou de fora: {rel.truncado.join(', ')}. Os números dessas tabelas estão incompletos.
            </div>
          ) : null}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(150px, 1fr))', gap:12, marginBottom:20 }}>
            <KPICard title="Pessoas ativas" value={rel.totais.ativas.toLocaleString('pt-BR')} sub={'de ' + rel.totais.pessoas.toLocaleString('pt-BR') + ' perfis'} trend="" color={C.p3} />
            <KPICard title="Fotos" value={rel.totais.fotos.toLocaleString('pt-BR')} sub="publicadas" trend="" color={C.p1} />
            <KPICard title="Vídeos" value={rel.totais.videos.toLocaleString('pt-BR')} sub="publicados" trend="" color={C.p1} />
            <KPICard title="À venda" value={rel.totais.venda.toLocaleString('pt-BR')} sub="itens marcados" trend="" color={C.p7} />
            <KPICard title="Curtidas" value={rel.totais.curtidas.toLocaleString('pt-BR')} sub={rel.totais.comentarios.toLocaleString('pt-BR') + ' comentários'} trend="" color={C.p5} />
            <KPICard title="Indicações" value={rel.totais.indicacoes.toLocaleString('pt-BR')} sub="cadastros indicados" trend="" color={C.p6} />
            <KPICard title="Pedidos loja" value={rel.totais.pedidos.toLocaleString('pt-BR')} sub={rel.totais.camisetas.toLocaleString('pt-BR') + ' com camiseta'} trend="" color={C.p6} />
            <KPICard title="Chamadas de IA" value={rel.totais.ia.toLocaleString('pt-BR')} sub={rel.totais.logos.toLocaleString('pt-BR') + ' logos gerados'} trend="" color={C.p3} />
            <KPICard title="Orçamentos" value={rel.totais.orcamentos.toLocaleString('pt-BR')} sub={rel.totais.avaliacoes.toLocaleString('pt-BR') + ' avaliações'} trend="" color={C.p1} />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:14, marginBottom:20 }}>
            {CATEGORIAS_DE_USO.map(cat => {
              const lista = rel.rankings[cat.campo] || [];
              return (
                <div key={cat.campo} style={{ background:C.white, borderRadius:14, padding:'12px 14px', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:C.ink, marginBottom:6, display:'flex', alignItems:'center', gap:6 }} title={cat.dica || ''}>
                    <span>{cat.icone}</span> {cat.rotulo}{cat.dica ? <span style={{ fontSize:10, color:C.muted, fontWeight:400 }}>ⓘ</span> : null}
                  </div>
                  {lista.length === 0 ? <div style={{ fontSize:12, color:C.muted, padding:'6px 0' }}>Ninguém no período.</div>
                    : lista.slice(0, 5).map((p, i) => <Pessoa key={p.id} p={p} n={p.n} unidade={cat.unidade} pos={i} />)}
                </div>
              );
            })}
          </div>

          <div style={{ background:C.white, borderRadius:14, padding:'12px 14px', boxShadow:'0 2px 12px rgba(0,0,0,0.06)', marginBottom:20 }}>
            <div style={{ fontWeight:700, fontSize:13, color:C.ink, marginBottom:4 }}>🤖 Uso das IAs por ferramenta</div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:10 }}>
              A tabela <code>ai_usage</code> registra <b>chamadas</b> (cada mensagem, legenda, transcrição…), não minutos — é a medida de uso que existe. "Pessoas" = quantas usaram pelo menos uma vez no período.
            </div>
            {semPersonas ? (
              <div style={{ padding:'8px 12px', background:'#fff4e0', border:'1px solid #f0b35a', borderRadius:10, fontSize:12, color:'#7a4b00', marginBottom:10 }}>
                Alice, Fê e Senna não aparecem. Se alguém usou elas no período, é o CHECK antigo da <code>ai_usage</code> recusando o registro em silêncio — rode <code>/migrations/2026-09-09-ai-usage-feature-check.sql</code> no Supabase; a partir daí o uso das personas passa a contar (o que já aconteceu antes não tem como recuperar).
              </div>
            ) : null}
            {rel.iaPorFeature.length === 0 ? <div style={{ fontSize:12, color:C.muted }}>Nenhuma chamada de IA no período.</div> : null}
            {rel.iaPorFeature.map(f => (
              <div key={f.feature} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                <div style={{ width:190, fontSize:12, color:C.ink, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }} title={f.feature}>{rotuloDeFeature(f.feature)}</div>
                <div style={{ flex:1, background:C.border, borderRadius:4, height:10 }}>
                  <div style={{ width: Math.max(2, Math.round(f.chamadas / maxIa * 100)) + '%', background:C.p1, height:10, borderRadius:4 }}></div>
                </div>
                <div style={{ width:150, fontSize:12, color:C.ink, textAlign:'right' }}><b>{f.chamadas.toLocaleString('pt-BR')}</b> chamadas · {f.pessoas} {f.pessoas === 1 ? 'pessoa' : 'pessoas'}</div>
              </div>
            ))}
          </div>

          <div style={{ background:C.white, borderRadius:14, padding:'12px 14px', boxShadow:'0 2px 12px rgba(0,0,0,0.06)' }}>
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
              <div style={{ fontWeight:700, fontSize:13, color:C.ink }}>👤 Por pessoa ({pessoas.length.toLocaleString('pt-BR')})</div>
              <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar nome, @tag ou cidade…" style={{ padding:'7px 10px', borderRadius:8, border:'1px solid '+C.border, fontSize:12, minWidth:220 }} />
              <label style={{ fontSize:12, color:C.muted, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
                <input type="checkbox" checked={soAtivos} onChange={e=>setSoAtivos(e.target.checked)} /> só quem fez algo no período
              </label>
              <span style={{ fontSize:11, color:C.muted }}>clique no título da coluna pra ordenar</span>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead><tr style={{ borderBottom:'2px solid '+C.border }}>
                  <Th campo="nome" rot="Nome" />
                  {colunas.map(([campo, rot]) => <Th key={campo} campo={campo} rot={rot} />)}
                  <th style={{ padding:'8px', fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap', textAlign:'right' }}>Última atividade</th>
                </tr></thead>
                <tbody>
                  {pessoas.length === 0 ? <tr><td colSpan={colunas.length + 2} style={{ padding:'20px 8px', color:C.muted, textAlign:'center' }}>Ninguém bate com o filtro.</td></tr> : null}
                  {pessoas.slice(0, limite).map(p => (
                    <tr key={p.id} style={{ borderBottom:'1px solid '+C.border }}>
                      <td style={{ padding:'7px 8px', whiteSpace:'nowrap' }}>
                        <div style={{ fontWeight:600, color:C.ink }}>{p.nome}</div>
                        <div style={{ fontSize:10, color:C.muted }}>{p.tag ? '@' + p.tag : ''}{p.papel ? (p.tag ? ' · ' : '') + (PAPEL_ROTULOS[p.papel] || p.papel) : ''}{p.cidade ? ' · ' + p.cidade : ''}</div>
                      </td>
                      {colunas.map(([campo]) => (
                        <td key={campo} style={{ padding:'7px 8px', textAlign:'right', color: p[campo] ? C.ink : C.border, fontWeight: campo === 'atividade' ? 700 : 400 }}
                          title={campo === 'ia' && p.iaPorFeature ? Object.entries(p.iaPorFeature).map(([f, n]) => rotuloDeFeature(f) + ': ' + n).join('\n') : (campo === 'avaliacoes' && p.notaMedia != null ? 'nota média ' + p.notaMedia : '')}>
                          {p[campo] ? Number(p[campo]).toLocaleString('pt-BR') : '–'}
                        </td>
                      ))}
                      <td style={{ padding:'7px 8px', textAlign:'right', color:C.muted, whiteSpace:'nowrap' }}>{p.ultimaAtividade ? new Date(p.ultimaAtividade).toLocaleDateString() : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pessoas.length > limite ? (
              <div style={{ textAlign:'center', padding:10 }}>
                <button onClick={()=>setLimite(l => l + 200)} style={{ padding:'6px 14px', borderRadius:8, border:'1px solid '+C.border, background:C.white, fontSize:12, cursor:'pointer', color:C.ink }}>Mostrar mais ({(pessoas.length - limite).toLocaleString('pt-BR')} restantes)</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const PAGES_DEF = [
  { id:'dashboard', icon:'📊', label:'Dashboard', section:'PRINCIPAL', component:<Dashboard /> },
  { id:'avisos', icon:'📢', label:'Avisos / Notificacoes', section:'PRINCIPAL', component:<Avisos /> },
  { id:'chats', icon:'💬', label:'Chats 3-Way', section:'PRINCIPAL', badgeKey:'chats', component:<Chats /> },
  { id:'whatsapp', icon:'📱', label:'WhatsApp', section:'PRINCIPAL', badgeKey:'whatsapp', component:<WhatsAppTab /> },
  { id:'orcamentos', icon:'📋', label:'Orçamentos', section:'PRINCIPAL', badgeKey:'orcamentos', component:<Orcamentos /> },
  { id:'pintores', icon:'🖌️', label:'Pintores', section:'PESSOAS', badgeKey:'pintores', component:<PintoresList key="pintores" roleFilter={p=>currentRoleKey(p)==='pintor'} title="Pintores Cadastrados" defaultRole="pintor" emptyMsg="Nenhum pintor cadastrado." /> },
  { id:'grafiteiros', icon:'🎨', label:'Grafiteiros', section:'PESSOAS', badgeKey:'grafiteiros', component:<PintoresList key="grafiteiros" roleFilter={p=>currentRoleKey(p)==='grafiteiro'} title="Grafiteiros / Muralistas" defaultRole="grafiteiro" emptyMsg="Nenhum grafiteiro cadastrado." /> },
  { id:'funileiros', icon:'🚗', label:'Funileiros / Automotivo', section:'PESSOAS', badgeKey:'funileiros', component:<PintoresList key="funileiros" roleFilter={p=>currentRoleKey(p)==='funileiro'||currentRoleKey(p)==='automotivo'} title="Funileiros / Pintura Automotiva" defaultRole="funileiro" emptyMsg="Nenhum funileiro cadastrado." /> },
  { id:'arquitetos', icon:'📐', label:'Arquitetos / Engenheiros', section:'PESSOAS', badgeKey:'arquitetos', component:<PintoresList key="arquitetos" roleFilter={p=>currentRoleKey(p)==='arquiteto'||currentRoleKey(p)==='engenheiro'} title="Arquitetos / Engenheiros" defaultRole="arquiteto" emptyMsg="Nenhum arquiteto ou engenheiro cadastrado." /> },
  { id:'clientes', icon:'👥', label:'Clientes', section:'PESSOAS', badgeKey:'clientes', component:<ClientesList /> },
  { id:'portal-users', icon:'🔐', label:'Portal', section:'PESSOAS', badgeKey:'portalUsers', component:<PortalUsersList /> },
  { id:'leads', icon:'🧲', label:'Leads', section:'LOJA', badgeKey:'leads', component:<Leads /> },
  { id:'pedidos-loja', icon:'🛒', label:'Pedidos da Loja', section:'LOJA', component:<PedidosLoja /> },
  { id:'produtos', icon:'🎨', label:'Produtos / Tintas', section:'LOJA', component:<ProdutosList /> },
  { id:'camisetas', icon:'👕', label:'Camisetas Personalizadas', section:'LOJA', component:<Camisetas /> },
  { id:'cursos', icon:'📚', label:'Cursos', section:'LOJA', component:<CursosList /> },
  { id:'click-rua', icon:'📖', label:'Revista Click Rua', section:'LOJA', component:<ClickRua /> },
  { id:'marketing', icon:'📣', label:'Marketing / Ads', section:'LOJA', component:<MarketingPage /> },
  { id:'moderacao', icon:'🛡️', label:'Moderação', section:'PRINCIPAL', component:<Moderacao /> },
  { id:'uso', icon:'📊', label:'Uso do app', section:'DADOS', component:<UsoDoApp /> },
  { id:'analytics', icon:'📈', label:'Analytics', section:'DADOS', component:<Analytics /> },
  { id:'indicacoes', icon:'🔗', label:'Indicações', section:'DADOS', component:<Indicacoes /> },
  { id:'avaliacoes', icon:'⭐', label:'Avaliações', section:'DADOS', component:<AvaliacoesTab /> },
];

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Portal crash:', error && error.message); }
  render() {
    if (this.state.error) {
      return React.createElement('div', { style:{padding:24,color:'#c00',fontFamily:'monospace',whiteSpace:'pre-wrap'} },
        'Erro no portal: ' + (this.state.error.message || 'desconhecido') + '\nRecarregue a página.');
    }
    return this.props.children;
  }
}

// ============================================================
// Telas de autenticacao (login / signup com convite / reset de senha).
// Extraidas do App para deixar o componente raiz menor. Cada tela recebe
// estado/handlers via props — fonte de verdade segue no App.
// ============================================================
const AuthCard = ({ children }) => (
  <div style={{ minHeight:'100vh', background:C.ink, display:'flex', alignItems:'center', justifyContent:'center' }}>
    <div style={{ background:C.white, borderRadius:24, padding:40, width:360, boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
      <div style={{ fontFamily:'Syne,sans-serif', fontSize:24, fontWeight:800, marginBottom:4 }}>
        <span style={{ color:C.ink }}>Cali</span><span style={{ color:C.p1 }}>Colors</span>
      </div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:28 }}>Portal de Gestão QueroUmaCor</div>
      {children}
    </div>
  </div>
);

function LoginScreen({ email, setEmail, pw, setPw, loginError, loginLoading, onLogin, onSwitchSignup, onSwitchReset }) {
  return (
    <AuthCard>
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Email</div>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="loja@calicolors.com.br" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
      </div>
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Senha</div>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••••••" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
      </div>
      <div style={{ textAlign:'right', marginBottom:16 }}>
        <span onClick={onSwitchReset} style={{ fontSize:12, color:C.p1, cursor:'pointer', fontWeight:600 }}>Esqueci minha senha</span>
      </div>
      {loginError && <div style={{color:'#e63946',fontSize:13,marginBottom:12,textAlign:'center'}}>{loginError}</div>}
      <button disabled={loginLoading} onClick={onLogin} style={{ width:'100%', padding:'12px', background:C.p1, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>
        Entrar no Portal
      </button>
      <div style={{ textAlign:'center', marginTop:14 }}>
        <span onClick={onSwitchSignup} style={{ fontSize:13, color:C.p1, cursor:'pointer', fontWeight:600 }}>Criar conta no portal</span>
      </div>
      <div style={{ textAlign:'center', marginTop:6, fontSize:12, color:C.muted }}>Acesso exclusivo Cali Colors</div>
    </AuthCard>
  );
}

function SignupScreen({ step, signupCode, setSignupCode, signupName, setSignupName, email, setEmail, pw, setPw, validatedInvite, loginError, loginLoading, onValidateInvite, onCreateAccount, onBack }) {
  return (
    <AuthCard>
      {step === 0 ? (<>
        <div style={{ fontSize:14, fontWeight:700, color:C.ink, marginBottom:6 }}>Codigo de Convite</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>Para criar uma conta no portal, voce precisa de um codigo de convite de alguem que ja tem acesso.</div>
        <div style={{ marginBottom:14 }}>
          <input value={signupCode} onChange={e=>setSignupCode(e.target.value.toUpperCase())} placeholder="QUC-XXXXX" style={{ width:'100%', padding:'12px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:18, fontWeight:700, letterSpacing:2, textAlign:'center', outline:'none', fontFamily:'monospace' }} />
        </div>
        {loginError && <div style={{color:'#e63946',fontSize:13,marginBottom:12,textAlign:'center'}}>{loginError}</div>}
        <button disabled={loginLoading} onClick={onValidateInvite} style={{ width:'100%', padding:'12px', background:C.p1, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>
          {loginLoading ? 'Validando...' : 'Validar Codigo'}
        </button>
      </>) : (<>
        <div style={{ fontSize:14, fontWeight:700, color:C.ink, marginBottom:4 }}>Criar conta</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>Codigo <b>{validatedInvite?.code}</b> validado</div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Nome</div>
          <input value={signupName} onChange={e=>setSignupName(e.target.value)} placeholder="Seu nome" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
        </div>
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Email</div>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@exemplo.com" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Senha</div>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Minimo 6 caracteres" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
        </div>
        {loginError && <div style={{color:'#e63946',fontSize:13,marginBottom:12,textAlign:'center'}}>{loginError}</div>}
        <button disabled={loginLoading} onClick={onCreateAccount} style={{ width:'100%', padding:'12px', background:C.p1, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>
          {loginLoading ? 'Criando conta...' : 'Criar Conta'}
        </button>
      </>)}
      <div style={{ textAlign:'center', marginTop:14 }}>
        <span onClick={onBack} style={{ fontSize:13, color:C.p1, cursor:'pointer', fontWeight:600 }}>← Voltar ao login</span>
      </div>
    </AuthCard>
  );
}

function ResetPasswordScreen({ email, setEmail, loginError, loginLoading, resetMsg, onReset, onBack }) {
  return (
    <AuthCard>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Email</div>
        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="loja@calicolors.com.br" style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid '+C.border, fontSize:14, outline:'none' }} />
      </div>
      {resetMsg && <div style={{color:'#2e7d32',fontSize:13,marginBottom:12,textAlign:'center'}}>{resetMsg}</div>}
      {loginError && <div style={{color:'#e63946',fontSize:13,marginBottom:12,textAlign:'center'}}>{loginError}</div>}
      <button disabled={loginLoading} onClick={onReset} style={{ width:'100%', padding:'12px', background:C.p1, color:'#fff', border:'none', borderRadius:12, fontSize:15, fontWeight:700, cursor:'pointer' }}>
        {loginLoading ? 'Enviando...' : 'Enviar link de redefinição'}
      </button>
      <div style={{ textAlign:'center', marginTop:14 }}>
        <span onClick={onBack} style={{ fontSize:13, color:C.p1, cursor:'pointer', fontWeight:600 }}>← Voltar ao login</span>
      </div>
    </AuthCard>
  );
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [loggedIn, setLoggedIn] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  // mode: 'login' | 'signup' | 'reset' — substitui resetMode+signupMode.
  const [mode, setMode] = useState('login');
  const [resetMsg, setResetMsg] = useState('');
  const [signupName, setSignupName] = useState('');
  const [signupCode, setSignupCode] = useState('');
  const [signupStep, setSignupStep] = useState(0);
  const [validatedInvite, setValidatedInvite] = useState(null);
  const [badges, setBadges] = useState({});

  const loadBadges = async () => {
    try {
      const sb = supa;
      if(!sb) return;
      const [quotesRes, profiles, leadsRes] = await Promise.all([
        sb.from('quotes').select('id', { count: 'exact', head: true }),
        profilesService.list({ fields: 'role, user_type, profession, portal_access' }),
        sb.from('leads').select('id', { count: 'exact', head: true }),
      ]);
      // Mescla em vez de substituir: o badge do WhatsApp e carregado
      // por outro caminho (loadWaBadge) e nao pode ser apagado aqui.
      setBadges(b => ({
        ...b,
        // `chats` NAO entra aqui: virou nao-lidas, calculado em
        // loadNaoLidos junto com o do WhatsApp.
        orcamentos: quotesRes.count || 0,
        pintores: profiles.filter(p => isProProfile(p) && currentRoleKey(p)==='pintor').length,
        grafiteiros: profiles.filter(p => isProProfile(p) && currentRoleKey(p)==='grafiteiro').length,
        funileiros: profiles.filter(p => isProProfile(p) && (currentRoleKey(p)==='funileiro'||currentRoleKey(p)==='automotivo')).length,
        arquitetos: profiles.filter(p => isProProfile(p) && (currentRoleKey(p)==='arquiteto'||currentRoleKey(p)==='engenheiro')).length,
        leads: leadsRes.count || 0,
        clientes: profiles.filter(isClienteProfile).length,
        portalUsers: profiles.filter(p => p.portal_access === true).length,
      }));
    } catch(e) { console.error('loadBadges error:', e); }
  };

  // WhatsApp nao lido: mensagens RECEBIDAS depois da ultima vez que o
  // operador abriu aquela conversa (whatsapp_ai_state.last_read_at). Fica
  // separado do loadBadges porque precisa ser leve e frequente — o resto
  // dos badges e caro e quase estatico.
  const loadWaBadge = async () => {
    try {
      const desde = new Date(Date.now() - 30*24*3600*1000).toISOString();
      const { data: { session } } = await supa.auth.getSession();
      const meuId = session && session.user ? session.user.id : null;
      const [msgsRes, stRes, chatRes, chatReadRes] = await Promise.all([
        // Paginado (sem teto): o `limit(3000)` antigo contava errado quando
        // um lote de respostas passava disso — e a aba, que agora baixa
        // tudo, discordaria do badge.
        buscarEmPaginas((extra) => supa.from('whatsapp_messages').select('wa_id, created_at', extra)
          .eq('direction','in').gte('created_at', desde).order('created_at', { ascending:false }).order('id', { ascending:false }))
          .then(data => ({ data })).catch(() => ({ data: [] })),
        buscarEmPaginas((extra) => supa.from('whatsapp_ai_state').select('wa_id, last_read_at', extra).order('wa_id'))
          .then(data => ({ data })).catch(() => ({ data: [] })),
        supa.from('messages').select('conversation_id, sender_id, created_at')
          .gte('created_at', desde).limit(3000),
        supa.from('portal_chat_reads').select('conversation_id, last_read_at').limit(2000),
      ]);
      const lido = {};
      (stRes.data || []).forEach(r => { if(r.last_read_at) lido[r.wa_id] = r.last_read_at; });
      const n = (msgsRes.data || []).filter(m =>
        !lido[m.wa_id] || new Date(m.created_at) > new Date(lido[m.wa_id])).length;

      // Chats 3-Way: mesma conta. Antes o badge era o TOTAL de mensagens
      // da tabela — nao dizia nada e nunca baixava.
      const lidoChat = {};
      (chatReadRes.data || []).forEach(r => { lidoChat[r.conversation_id] = r.last_read_at; });
      const nChat = (chatRes.data || []).filter(m => {
        if(meuId && m.sender_id === meuId) return false;
        const marca = lidoChat[m.conversation_id];
        return !marca || new Date(m.created_at) > new Date(marca);
      }).length;

      setBadges(b => (b.whatsapp === n && b.chats === nChat ? b : { ...b, whatsapp: n, chats: nChat }));
    } catch(e) { /* badge e enfeite: nunca derruba o portal */ }
  };

  useEffect(() => {
    if(!loggedIn) return;
    loadBadges(); loadWaBadge();
    // Realtime avisa na hora que chegou mensagem; o intervalo e rede de
    // seguranca; o evento vem da propria aba quando alguem le a conversa.
    const canal = supa.channel('portal-wa-badge')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'whatsapp_messages' }, loadWaBadge)
      .subscribe();
    const t = setInterval(loadWaBadge, 45000);
    window.addEventListener('wa-lidas-mudou', loadWaBadge);
    return () => {
      clearInterval(t);
      window.removeEventListener('wa-lidas-mudou', loadWaBadge);
      supa.removeChannel(canal);
    };
  }, [loggedIn]);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supa.auth.getSession();
        if (session && session.user) {
          const { data: prof } = await supa.from('profiles').select('portal_access').eq('id', session.user.id).single();
          if (prof && prof.portal_access) setLoggedIn(true);
        }
      } catch(e) { /* sessão inválida: mostra login */ }
      finally { setAuthChecking(false); }
    })();
  }, []);

  const PAGES = React.useMemo(
    () => PAGES_DEF.map(p => ({ ...p, badge: p.badgeKey ? (badges[p.badgeKey] || null) : undefined })),
    [badges]
  );
  // Estes hooks PRECISAM rodar antes dos early returns abaixo, senao a
  // ordem dos hooks muda entre renders (Rules of Hooks).
  const currentPage = React.useMemo(() => PAGES.find(p => p.id === page), [PAGES, page]);
  const sections = React.useMemo(() => [...new Set(PAGES.map(p => p.section))], [PAGES]);
  const handleNav = React.useCallback((id) => setPage(id), []);

  if (authChecking) return (
    <div style={{ minHeight:'100vh', background:C.ink, display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontFamily:'Syne,sans-serif', fontSize:18, fontWeight:700 }}>
      Carregando portal...
    </div>
  );

  if (!loggedIn) {
    const handleLogin = async () => {
      setLoginError(''); setLoginLoading(true);
      try {
        const { data, error } = await supa.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
        const { data: prof } = await supa.from('profiles').select('portal_access').eq('id', data.user.id).single();
        if (!prof || !prof.portal_access) {
          await supa.auth.signOut();
          throw new Error('Sem permissao. Esta conta nao tem acesso ao portal.');
        }
        setLoggedIn(true);
      } catch (e) {
        setLoginError(e.message || 'Email ou senha incorretos');
      } finally { setLoginLoading(false); }
    };
    const handleSwitchSignup = () => {
      setMode('signup'); setSignupStep(0); setLoginError('');
      setSignupCode(''); setSignupName(''); setEmail(''); setPw(''); setValidatedInvite(null);
    };
    const handleSwitchReset = () => { setMode('reset'); setLoginError(''); setResetMsg(''); };
    const handleBackToLogin = () => { setMode('login'); setLoginError(''); setResetMsg(''); };
    const handleValidateInvite = async () => {
      setLoginError(''); setLoginLoading(true);
      try {
        if (!signupCode.trim()) throw new Error('Insira o codigo de convite');
        const { data: inv, error } = await supa.from('invites').select('id, code, used, max_uses, uses, created_by').eq('code', signupCode.trim()).single();
        if (error || !inv) throw new Error('Codigo invalido');
        if (inv.used || (inv.max_uses > 0 && inv.uses >= inv.max_uses)) throw new Error('Este codigo ja foi utilizado');
        const { data: inviter } = await supa.from('profiles').select('portal_access').eq('id', inv.created_by).single();
        if (!inviter || !inviter.portal_access) throw new Error('Este codigo nao da acesso ao portal. O codigo precisa ser de alguem que ja tem acesso ao portal.');
        setValidatedInvite(inv); setSignupStep(1);
      } catch (e) { setLoginError(e.message); }
      finally { setLoginLoading(false); }
    };
    const handleCreateAccount = async () => {
      setLoginError(''); setLoginLoading(true);
      try {
        if (!signupName.trim() || !email.trim() || !pw) throw new Error('Preencha todos os campos');
        if (pw.length < 8) throw new Error('Senha deve ter no minimo 8 caracteres');
        const res = await authService.signUpAppUser({
          name: signupName.trim(),
          email: email.trim(),
          password: pw,
          role: 'admin',
          portalAccess: true,
          inviteCode: validatedInvite.code,
          userMetadata: { role: 'admin' },
          extraProfile: { invited_by: validatedInvite.created_by }
        });
        if (!res.ok) throw new Error(res.error || 'Erro ao criar conta');
        await supa.from('invites').update({ uses: (validatedInvite.uses || 0) + 1 }).eq('id', validatedInvite.id);
        const { error: signInErr } = await supa.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (signInErr) throw signInErr;
        setLoggedIn(true);
      } catch (e) {
        setLoginError(e.message || 'Erro ao criar conta');
      } finally { setLoginLoading(false); }
    };
    const handleReset = async () => {
      setLoginError(''); setResetMsg(''); setLoginLoading(true);
      try {
        if (!email) throw new Error('Informe seu email');
        const { error } = await supa.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
        if (error) throw error;
        setResetMsg('Link de redefinição enviado para ' + email);
      } catch (e) { setLoginError(e.message || 'Erro ao enviar email'); }
      finally { setLoginLoading(false); }
    };

    if (mode === 'reset') return (
      <ResetPasswordScreen
        email={email} setEmail={setEmail}
        loginError={loginError} loginLoading={loginLoading} resetMsg={resetMsg}
        onReset={handleReset} onBack={handleBackToLogin}
      />
    );
    if (mode === 'signup') return (
      <SignupScreen
        step={signupStep}
        signupCode={signupCode} setSignupCode={setSignupCode}
        signupName={signupName} setSignupName={setSignupName}
        email={email} setEmail={setEmail}
        pw={pw} setPw={setPw}
        validatedInvite={validatedInvite}
        loginError={loginError} loginLoading={loginLoading}
        onValidateInvite={handleValidateInvite}
        onCreateAccount={handleCreateAccount}
        onBack={handleBackToLogin}
      />
    );
    return (
      <LoginScreen
        email={email} setEmail={setEmail} pw={pw} setPw={setPw}
        loginError={loginError} loginLoading={loginLoading}
        onLogin={handleLogin}
        onSwitchSignup={handleSwitchSignup}
        onSwitchReset={handleSwitchReset}
      />
    );
  }

  return (
    <div style={{ display:'flex', minHeight:'100vh', fontFamily:'DM Sans, sans-serif' }}>
      {/* SIDEBAR */}
      <nav aria-label="Menu administrativo" style={{ width:240, background:C.ink, position:'fixed', top:0, left:0, height:'100vh', overflow:'hidden', zIndex:100, display:'flex', flexDirection:'column' }}>
        <Logo />
        <div style={{ padding:'8px 0', marginTop:8, flex:1, overflowY:'auto' }}>
          {sections.map(section => (
            <div key={section}>
              <div style={{ fontSize:10, color:C.muted, letterSpacing:2, textTransform:'uppercase', padding:'12px 20px 4px' }}>{section}</div>
              {PAGES.filter(p => p.section === section).map(p => (
                <NavItem key={p.id} icon={p.icon} label={p.label} badge={p.badge} active={page===p.id} onClick={()=>handleNav(p.id)} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ flexShrink:0, padding:16, borderTop:'1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, color:'rgba(255,255,255,0.7)', fontSize:13 }}>
            <div style={{ width:32, height:32, borderRadius:'50%', background:C.p1, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:'#fff' }}>C</div>
            <div>
              <div style={{ fontWeight:600, color:C.white }}>Cali Colors</div>
              <div style={{ fontSize:11 }}>Plano Business · Ativo</div>
            </div>
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <div style={{ marginLeft:240, flex:1, display:'flex', flexDirection:'column' }}>
        {/* TOPBAR */}
        <header role="banner" style={{ background:C.white, borderBottom:'1px solid '+C.border, padding:'0 28px', height:60, display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, zIndex:50 }}>
          <div>
            <div style={{ fontFamily:'Syne, sans-serif', fontSize:18, fontWeight:800, color:C.ink }}>{currentPage?.label}</div>
            <div style={{ fontSize:12, color:C.muted }}>{new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <button onClick={()=>{ if(window.confirm('Tem certeza que deseja sair do portal?')) { supa.auth.signOut(); setLoggedIn(false); } }} style={{ background:'transparent', border:'1px solid '+C.border, borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:12, color:C.muted }}>Sair</button>
          </div>
        </header>

        {/* CONTENT */}
        <main style={{ padding:28, flex:1 }}>
          {currentPage?.component}
        </main>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
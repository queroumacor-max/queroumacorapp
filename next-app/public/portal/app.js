const {
  useState,
  useEffect
} = React;
// Otimizações usadas como React.useMemo / React.useCallback / React.memo abaixo.

const supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);
const C = {
  ink: '#1a1a2e',
  ink2: '#16213e',
  cream: '#f7f3ee',
  border: '#e8e2d9',
  muted: '#9e9687',
  white: '#ffffff',
  p1: '#ff6b35',
  p2: '#f7c59f',
  p3: '#2ec4b6',
  p4: '#e63946',
  p5: '#8338ec',
  p6: '#06d6a0',
  p7: '#ffd166',
  bg: '#f7f3ee',
  sidebar: '#1a1a2e'
};

// ============================================================
// StatusBadge — chip de status reutilizavel (cor + label).
// Recebe `status`, mapa de cores e mapa de labels.
// ============================================================
const StatusBadge = React.memo(function StatusBadge({
  status,
  colorMap,
  labelMap,
  size
}) {
  const s = size || 'sm';
  const bg = colorMap && colorMap[status] || '#e5e7eb';
  const label = labelMap && labelMap[status] || status;
  const fontSize = s === 'sm' ? 11 : 12;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-block',
      padding: s === 'sm' ? '2px 8px' : '4px 12px',
      background: bg,
      color: '#fff',
      borderRadius: 20,
      fontSize,
      fontWeight: 700
    }
  }, label);
});

// Maps de cor/label para os varios chips de status do portal.
// (LEAD_STATUS_COLORS / LEAD_SEG_COLORS ja existem mais abaixo perto do componente Leads.)
const POSTS_STATUS_COLORS = {
  approved: '#28a745',
  rejected: '#e74c3c',
  pending: '#f0ad4e'
};
const POSTS_STATUS_LABELS = {
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  pending: 'Pendente'
};
const REPORTS_STATUS_COLORS = {
  pending: '#b8860b',
  resolved: '#06d6a0',
  dismissed: '#9e9687'
};
const REPORTS_STATUS_LABELS = {
  pending: 'Pendente',
  resolved: 'Resolvida',
  dismissed: 'Descartada'
};
const REFERRALS_STATUS_COLORS = {
  completed: '#06d6a0',
  pending: '#b8860b',
  cancelled: '#e63946'
};
const REFERRALS_STATUS_LABELS = {
  completed: 'Completa',
  pending: 'Pendente',
  cancelled: 'Cancelada'
};

// Status de fulfillment (setados pelo admin) + de pagamento (setados pelo
// webhook do MP). Grafia 'canceled' (1 L) pra casar com o constraint do banco.
const ORDERS_STATUS_COLORS = {
  pending: '#ffd166',
  processing: '#ff6b35',
  shipped: '#2ec4b6',
  completed: '#06d6a0',
  canceled: '#e63946',
  paid: '#06d6a0',
  amount_mismatch: '#e63946',
  refunded: '#8338ec'
};
const ORDERS_STATUS_LABELS = {
  pending: 'Aguardando',
  processing: 'Em andamento',
  shipped: 'Enviado',
  completed: 'Concluido',
  canceled: 'Cancelado',
  paid: 'Pago',
  amount_mismatch: 'Divergencia valor',
  refunded: 'Reembolsado'
};
const LEADS_STATUS_LABELS = {
  novo: 'Novo',
  contactado: 'Contactado',
  qualificado: 'Qualificado',
  convertido: 'Convertido',
  perdido: 'Perdido'
};

// ============================================================
// Services CRUD — wrappers de supabase com erro via throw.
// Quem chama DEVE try/catch.
// ============================================================
const productsService = {
  list: async () => {
    const r = await supa.from('products').select('*').order('name');
    if (r.error) throw r.error;
    return r.data || [];
  },
  upsert: async p => {
    const r = await supa.from('products').upsert(p);
    if (r.error) throw r.error;
    return r.data;
  },
  remove: async id => {
    const r = await supa.from('products').delete().eq('id', id);
    if (r.error) throw r.error;
  }
};
const leadsService = {
  list: async () => {
    const r = await supa.from('leads').select('*').order('created_at', {
      ascending: false
    });
    if (r.error) throw r.error;
    return r.data || [];
  },
  updateStatus: async (id, status) => {
    const r = await supa.from('leads').update({
      status
    }).eq('id', id);
    if (r.error) throw r.error;
  },
  remove: async id => {
    const r = await supa.from('leads').delete().eq('id', id);
    if (r.error) throw r.error;
  },
  insertBatch: async rows => {
    const r = await supa.from('leads').insert(rows);
    if (r.error) throw r.error;
    return r.data;
  }
};
const announcementsService = {
  list: async () => {
    const r = await supa.from('announcements').select('*').order('created_at', {
      ascending: false
    });
    if (r.error) throw r.error;
    return r.data || [];
  },
  insert: async a => {
    const r = await supa.from('announcements').insert(a);
    if (r.error) throw r.error;
  },
  toggle: async (id, active) => {
    const r = await supa.from('announcements').update({
      active
    }).eq('id', id);
    if (r.error) throw r.error;
  },
  remove: async id => {
    const r = await supa.from('announcements').delete().eq('id', id);
    if (r.error) throw r.error;
  }
};
const postsService = {
  setStatus: async (id, status) => {
    const r = await supa.from('posts').update({
      status
    }).eq('id', id);
    if (r.error) throw r.error;
  },
  deleteWithChildren: async id => {
    await supa.from('likes').delete().eq('post_id', id);
    await supa.from('comments').delete().eq('post_id', id);
    const r = await supa.from('posts').delete().eq('id', id);
    if (r.error) throw r.error;
  }
};
const ordersService = {
  updateStatus: async (id, status) => {
    const r = await supa.from('orders').update({
      status
    }).eq('id', id);
    if (r.error) throw r.error;
  }
};
const reportsService = {
  resolve: async id => {
    const r = await supa.from('reports').update({
      status: 'resolved'
    }).eq('id', id);
    if (r.error) throw r.error;
  }
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
  async signUpAppUser({
    name,
    email,
    password,
    role,
    profession,
    portalAccess,
    inviteCode,
    userMetadata,
    extraProfile
  }) {
    if (!email || !password) {
      return {
        ok: false,
        error: 'Email e senha sao obrigatorios'
      };
    }
    if (password.length < 8) {
      return {
        ok: false,
        error: 'Senha deve ter no minimo 8 caracteres'
      };
    }
    const cleanEmail = (email || '').trim();
    const cleanName = (name || '').trim();
    const ephemeral = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        storageKey: 'sb-portal-app-create-' + Date.now()
      }
    });
    try {
      const signUpOptions = {
        data: Object.assign({
          name: cleanName || cleanEmail
        }, userMetadata || {})
      };
      const {
        data: authData,
        error: authErr
      } = await ephemeral.auth.signUp({
        email: cleanEmail,
        password,
        options: signUpOptions
      });
      if (authErr) throw authErr;
      const userId = authData && authData.user && authData.user.id;
      if (!userId) return {
        ok: false,
        error: 'Nao foi possivel criar usuario'
      };
      const profile = Object.assign({
        id: userId,
        name: cleanName || cleanEmail,
        role,
        created_at: new Date().toISOString()
      }, extraProfile || {});
      if (profession) profile.profession = profession;
      if (portalAccess) profile.portal_access = true;
      if (inviteCode) profile.invite_code_used = inviteCode;
      const {
        error: profErr
      } = await ephemeral.from('profiles').upsert(profile, {
        onConflict: 'id'
      });
      if (profErr) {
        console.warn('authService: profile upsert falhou', profErr.message);
        return {
          ok: false,
          error: profErr.message || 'Erro ao salvar perfil'
        };
      }
      return {
        ok: true,
        userId
      };
    } catch (e) {
      return {
        ok: false,
        error: e && e.message || String(e)
      };
    } finally {
      try {
        await ephemeral.auth.signOut();
      } catch (_) {}
    }
  }
};

// Classificacao de perfis (consistente em todo o portal)
const PRO_ROLES = ['pintor', 'grafiteiro', 'graffiti', 'automotivo', 'funileiro'];
const roleOf = p => (p && (p.role || p.user_type) || '').toString().trim().toLowerCase();
// Obs: a coluna profession tem DEFAULT 'pintor', entao NAO serve para
// classificar (marcaria todo cliente como profissional). Usada so no rotulo.
const professionOf = p => (p && p.profession || '').toString().trim().toLowerCase();
const isProProfile = p => PRO_ROLES.includes(roleOf(p));
const isPortalStaff = p => roleOf(p) === 'admin' || p && p.portal_access === true;
// Cliente = qualquer perfil cadastrado que nao seja profissional nem staff do portal
const isClienteProfile = p => !isProProfile(p) && roleOf(p) !== 'admin';
const ROLE_LABEL = {
  pintor: 'Pintor',
  grafiteiro: 'Grafiteiro/Muralista',
  graffiti: 'Grafiteiro/Muralista',
  automotivo: 'Pintor Automotivo',
  funileiro: 'Funileiro',
  cliente: 'Cliente',
  admin: 'Admin'
};
const tipoLabel = p => ROLE_LABEL[professionOf(p)] || ROLE_LABEL[roleOf(p)] || roleOf(p) || 'Cliente';

// Opcoes de papel para criar usuario do app (mesmo modelo do cadastro no app)
const APP_ROLE_OPTIONS = [{
  v: 'pintor',
  label: 'Pintor',
  role: 'pintor'
}, {
  v: 'grafiteiro',
  label: 'Grafiteiro / Muralista',
  role: 'grafiteiro'
}, {
  v: 'automotivo',
  label: 'Pintor Automotivo',
  role: 'automotivo'
}, {
  v: 'funileiro',
  label: 'Funileiro',
  role: 'automotivo',
  profession: 'funileiro'
}, {
  v: 'cliente',
  label: 'Cliente',
  role: 'cliente'
}];
const CreateAppUserForm = ({
  onCreated,
  defaultRole
}) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    roleKey: defaultRole || 'pintor'
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async () => {
    setErr('');
    setMsg('');
    const name = form.name.trim(),
      email = form.email.trim(),
      password = form.password;
    if (!email || !password) {
      setErr('Email e senha sao obrigatorios');
      return;
    }
    if (password.length < 8) {
      setErr('Senha deve ter no minimo 8 caracteres');
      return;
    }
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
        userMetadata: {
          user_type: opt.role,
          tag
        },
        extraProfile: {
          email,
          tag,
          user_type: opt.role
        }
      });
      if (!res.ok) {
        setErr(res.error || 'Erro ao criar usuario');
        return;
      }
      setMsg('Usuario criado. Ja pode entrar no app com essas credenciais.');
      setForm({
        name: '',
        email: '',
        password: '',
        roleKey: defaultRole || 'pintor'
      });
      setOpen(false);
      if (onCreated) onCreated();
    } catch (e) {
      setErr(e.message || 'Erro ao criar usuario');
    } finally {
      setSaving(false);
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setOpen(!open);
      setErr('');
      setMsg('');
    },
    style: {
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '8px 16px',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 700
    }
  }, open ? 'Cancelar' : '+ Criar usuario do app'), msg && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.p6,
      fontSize: 13,
      marginTop: 8
    }
  }, msg), open && /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.cream,
      borderRadius: 12,
      padding: 16,
      marginTop: 12,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Nome"), /*#__PURE__*/React.createElement("input", {
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    }),
    placeholder: "Nome (opcional)",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    value: form.email,
    onChange: e => setForm({
      ...form,
      email: e.target.value
    }),
    placeholder: "email@exemplo.com",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Senha"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: form.password,
    onChange: e => setForm({
      ...form,
      password: e.target.value
    }),
    placeholder: "Minimo 6 caracteres",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Tipo de perfil"), /*#__PURE__*/React.createElement("select", {
    value: form.roleKey,
    onChange: e => setForm({
      ...form,
      roleKey: e.target.value
    }),
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none',
      background: '#fff'
    }
  }, APP_ROLE_OPTIONS.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.v,
    value: o.v
  }, o.label))))), err && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#e63946',
      fontSize: 13,
      marginBottom: 10
    }
  }, err), /*#__PURE__*/React.createElement("button", {
    disabled: saving,
    onClick: submit,
    style: {
      background: C.p6,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '10px 20px',
      cursor: saving ? 'wait' : 'pointer',
      fontSize: 13,
      fontWeight: 700
    }
  }, saving ? 'Criando...' : 'Criar usuario')));
};

// O update direto em profiles de outra pessoa falha silenciosamente
// por RLS (unica policy de UPDATE e auth.uid() = id). Por isso tudo
// vai pelo endpoint /api/admin-users com service role.
const adminUsers = async payload => {
  const {
    data: {
      session
    }
  } = await supa.auth.getSession();
  if (!session) {
    alert('Sessao expirada. Entre novamente.');
    return false;
  }
  const r = await fetch('/api/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      accessToken: session.access_token,
      ...payload
    })
  });
  let res = {};
  try {
    res = await r.json();
  } catch (_) {}
  if (!r.ok || !res.ok) {
    if (r.status === 503 || /SERVICE_ROLE_KEY/i.test(res.error || '')) {
      alert('Gestao de usuarios indisponivel.\n\nO servidor ainda nao esta configurado para esta acao. ' + 'E preciso definir a variavel de ambiente SUPABASE_SERVICE_ROLE_KEY no Cloudflare Pages ' + '(Settings -> Environment variables -> Production) e refazer o deploy.\n\n' + 'Fale com o responsavel tecnico para concluir essa configuracao.');
    } else {
      alert('A acao falhou: ' + (res.error || 'HTTP ' + r.status));
    }
    return false;
  }
  return true;
};
const promoteToPortal = async (id, after) => {
  if (!confirm('Promover este perfil a usuario do portal? Ele passara a ter acesso ao portal administrativo.')) return;
  if ((await adminUsers({
    action: 'promote',
    userId: id
  })) && after) after();
};
const revokePortal = async (id, after) => {
  if (!confirm('Remover o acesso ao portal deste usuario?')) return;
  if ((await adminUsers({
    action: 'revoke',
    userId: id
  })) && after) after();
};
const setProfileVerified = async (id, value, after) => {
  if ((await adminUsers({
    action: 'verify',
    userId: id,
    value
  })) && after) after();
};
function askProDate() {
  return new Promise(resolve => {
    const pad = n => String(n).padStart(2, '0');
    const toISO = dt => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    const tomorrow = new Date(Date.now() + 86400000);
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:inherit;';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-labelledby', '_proDateTitle');
    ov.innerHTML = '<div style="background:#fff;border-radius:14px;padding:22px;width:340px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.3);">' + '<div id="_proDateTitle" style="font-size:16px;font-weight:800;color:' + C.ink + ';margin-bottom:4px;">Habilitar PRO</div>' + '<div style="font-size:13px;color:' + C.muted + ';margin-bottom:14px;">Escolha a data de expiração do plano PRO.</div>' + '<input id="_proDateInput" type="date" value="' + toISO(d) + '" min="' + toISO(tomorrow) + '" style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid ' + C.border + ';font-size:14px;outline:none;box-sizing:border-box;">' + '<div id="_proDateErr" style="color:' + C.p4 + ';font-size:12px;margin-top:8px;display:none;"></div>' + '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">' + '<button id="_proDateCancel" style="background:none;border:1px solid ' + C.border + ';color:' + C.ink + ';border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;">Cancelar</button>' + '<button id="_proDateOk" style="background:#16a34a;border:none;color:#fff;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:13px;font-weight:700;">Confirmar</button>' + '</div></div>';
    document.body.appendChild(ov);
    const inp = ov.querySelector('#_proDateInput');
    const errEl = ov.querySelector('#_proDateErr');
    const close = val => {
      document.body.removeChild(ov);
      resolve(val);
    };
    setTimeout(() => inp.focus(), 30);
    ov.querySelector('#_proDateCancel').onclick = () => close(null);
    ov.addEventListener('click', e => {
      if (e.target === ov) close(null);
    });
    const submit = () => {
      if (!inp.value) {
        errEl.textContent = 'Selecione uma data.';
        errEl.style.display = 'block';
        return;
      }
      const p = inp.value.split('-');
      const exp = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 23, 59, 59);
      if (isNaN(exp.getTime()) || exp <= new Date()) {
        errEl.textContent = 'Informe uma data futura válida.';
        errEl.style.display = 'block';
        return;
      }
      close(exp);
    };
    ov.querySelector('#_proDateOk').onclick = submit;
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close(null);
    });
  });
}
const setProfilePro = async (id, value, after) => {
  if (!value) {
    if (!confirm('Remover o acesso PRO deste cliente?')) return;
    if ((await adminUsers({
      action: 'set_pro',
      userId: id,
      value: false
    })) && after) after();
    return;
  }
  const exp = await askProDate();
  if (!exp) return;
  if ((await adminUsers({
    action: 'set_pro',
    userId: id,
    value: true,
    expiresAt: exp.toISOString()
  })) && after) after();
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
    setLoading(true);
    setError(null);
    try {
      const res = await queryFn(supa);
      if (res && res.error) throw res.error;
      setData(res && res.data !== undefined ? res.data : res);
    } catch (e) {
      console.warn('useSupabaseQuery:', e && e.message || e);
      setError(e);
    } finally {
      setLoading(false);
    }
  }, deps || []);
  React.useEffect(() => {
    refetch();
  }, [refetch]);
  return {
    data,
    loading,
    error,
    refetch
  };
}

// Service centralizado para consultas da tabela `profiles` — evita repetir
// `supa.from('profiles').select('*')` + filtros isPro/isCliente em cada tela.
const profilesService = {
  async list(opts) {
    opts = opts || {};
    let q = supa.from('profiles').select(opts.fields || '*');
    if (opts.portalOnly) q = q.eq('portal_access', true);
    if (opts.order) q = q.order(opts.order, {
      ascending: opts.ascending !== false
    });
    if (opts.limit) q = q.limit(opts.limit);
    const {
      data,
      error
    } = await q;
    if (error) throw error;
    let rows = data || [];
    if (opts.painterOnly) rows = rows.filter(isProProfile);
    if (opts.clienteOnly) rows = rows.filter(isClienteProfile);
    if (opts.proOnly) rows = rows.filter(isProActive);
    return rows;
  },
  async byId(id, fields) {
    const {
      data,
      error
    } = await supa.from('profiles').select(fields || '*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }
};
const setProfileRole = async (id, roleKey, after) => {
  const ok = await adminUsers({
    action: 'set_role',
    userId: id,
    roleKey
  });
  if (ok && after) after();
  return ok;
};

// Deduz a opcao atual de papel a partir do profile
const currentRoleKey = p => {
  if (professionOf(p) === 'funileiro') return 'funileiro';
  const r = roleOf(p);
  if (['pintor', 'grafiteiro', 'automotivo', 'cliente'].includes(r)) return r;
  if (r === 'graffiti') return 'grafiteiro';
  return isProProfile(p) ? 'pintor' : 'cliente';
};

// Seletor inline para editar o tipo/papel de um perfil existente
const RoleSelect = ({
  profile,
  after
}) => {
  const [val, setVal] = useState(currentRoleKey(profile));
  const [busy, setBusy] = useState(false);
  return /*#__PURE__*/React.createElement("select", {
    value: val,
    disabled: busy,
    onChange: async e => {
      const nv = e.target.value;
      if (nv === val) return;
      const lbl = (APP_ROLE_OPTIONS.find(o => o.v === nv) || {}).label || nv;
      if (!confirm('Alterar o tipo deste perfil para "' + lbl + '"?')) {
        e.target.value = val;
        return;
      }
      setBusy(true);
      const ok = await setProfileRole(profile.id, nv, null);
      setBusy(false);
      if (ok) {
        setVal(nv);
        if (after) after();
      } else {
        e.target.value = val;
      }
    },
    style: {
      padding: '4px 8px',
      borderRadius: 6,
      border: '1px solid ' + C.border,
      fontSize: 11,
      background: '#fff',
      cursor: busy ? 'wait' : 'pointer',
      maxWidth: 160
    }
  }, APP_ROLE_OPTIONS.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.v,
    value: o.v
  }, o.label)));
};
const Logo = () => /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'Syne, sans-serif',
    fontSize: 20,
    fontWeight: 800,
    color: C.white,
    padding: '24px 20px 8px'
  }
}, /*#__PURE__*/React.createElement("span", null, "Cali"), /*#__PURE__*/React.createElement("span", {
  style: {
    color: C.p1
  }
}, "Colors"), /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 10,
    color: C.muted,
    fontWeight: 400,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 2
  }
}, "Portal QueroUmaCor"));
const AvatarCell = React.memo(function AvatarCell({
  name,
  avatarUrl,
  size
}) {
  const s = size || 32;
  const initial = ((name || '?')[0] || '?').toUpperCase();
  if (avatarUrl) {
    return /*#__PURE__*/React.createElement("img", {
      src: avatarUrl,
      alt: "",
      style: {
        width: s,
        height: s,
        borderRadius: '50%',
        objectFit: 'cover'
      }
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: s,
      height: s,
      borderRadius: '50%',
      background: '#e8e2d9',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: s * 0.4,
      fontWeight: 700,
      color: '#1a1a2e'
    }
  }, initial);
});
const ProBadgeCell = React.memo(function ProBadgeCell({
  profile,
  onChange
}) {
  const pro = isProActive(profile);
  const paid = !!profile.mp_preapproval_id;
  if (!pro) {
    return /*#__PURE__*/React.createElement("button", {
      onClick: () => setProfilePro(profile.id, true, onChange),
      style: {
        padding: '4px 10px',
        background: '#f0f0f0',
        border: '1px solid #ddd',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 12
      }
    }, "Habilitar PRO");
  }
  const exp = profile.pro_expires_at ? new Date(profile.pro_expires_at).toLocaleDateString('pt-BR') : '—';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      padding: '2px 8px',
      background: '#7c4dff',
      color: '#fff',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700
    }
  }, paid ? '💳 PRO' : '✋ PRO'), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: '#666'
    }
  }, "at\xE9 ", exp), !paid && /*#__PURE__*/React.createElement("button", {
    onClick: () => setProfilePro(profile.id, false, onChange),
    style: {
      padding: '2px 6px',
      background: 'transparent',
      border: '1px solid #ddd',
      borderRadius: 4,
      cursor: 'pointer',
      fontSize: 10
    }
  }, "Remover"));
});
const PortalAccessCell = React.memo(function PortalAccessCell({
  profile,
  onChange
}) {
  if (profile.portal_access) {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        padding: '2px 8px',
        background: '#10b981',
        color: '#fff',
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700
      }
    }, "\u2713 Portal"), /*#__PURE__*/React.createElement("button", {
      onClick: () => revokePortal(profile.id, onChange),
      style: {
        padding: '2px 6px',
        background: 'transparent',
        border: '1px solid #ddd',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 10
      }
    }, "Revogar"));
  }
  return /*#__PURE__*/React.createElement("button", {
    onClick: () => promoteToPortal(profile.id, onChange),
    style: {
      padding: '4px 10px',
      background: '#f0f0f0',
      border: '1px solid #ddd',
      borderRadius: 6,
      cursor: 'pointer',
      fontSize: 12
    }
  }, "Promover");
});
const NavItem = React.memo(function NavItem({
  icon,
  label,
  badge,
  active,
  onClick
}) {
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 20px',
      cursor: 'pointer',
      borderRadius: 10,
      margin: '2px 8px',
      background: active ? 'rgba(255,107,53,0.2)' : 'transparent',
      color: active ? C.p1 : 'rgba(255,255,255,0.7)',
      transition: 'all 0.2s'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      flex: 1
    }
  }, label), badge > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      background: C.p4,
      color: '#fff',
      borderRadius: 10,
      fontSize: 11,
      padding: '1px 7px',
      fontWeight: 700
    }
  }, badge));
});
const KPICard = React.memo(function KPICard({
  title,
  value,
  sub,
  trend,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.muted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 8
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 28,
      fontWeight: 700,
      fontFamily: 'Syne, sans-serif',
      color: C.ink
    }
  }, value), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: color || C.p6,
      marginTop: 4
    }
  }, trend, " ", sub));
});
const Dashboard = () => {
  const [stats, setStats] = useState({
    pintores: 0,
    clientes: 0,
    leads: 0,
    orcamentos: 0
  });
  const [recentQuotes, setRecentQuotes] = useState([]);
  const [weeklyQuotes, setWeeklyQuotes] = useState([0, 0, 0, 0, 0, 0, 0]);
  const [regionData, setRegionData] = useState([]);
  const [recentMessages, setRecentMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const sb = supa;
      const [profilesRes, leadsRes, quotesRes, msgsRes] = await Promise.all([sb.from('profiles').select('*'), sb.from('leads').select('id'), sb.from('quotes').select('id, status, created_at, client:profiles!client_id(name), painter:profiles!painter_id(name)').order('created_at', {
        ascending: false
      }).limit(50), sb.from('messages').select('id, content, created_at, sender_id').order('created_at', {
        ascending: false
      }).limit(5)]);
      if (profilesRes.error) console.warn('Dashboard profiles error:', profilesRes.error.message);
      if (quotesRes.error) console.warn('Dashboard quotes error:', quotesRes.error.message);
      const profiles = profilesRes.data || [];
      const leads = leadsRes.data || [];
      const quotes = quotesRes.data || [];
      const msgs = msgsRes.data || [];
      const clientes = profiles.filter(isClienteProfile).length;
      setStats({
        pintores: profiles.length,
        clientes,
        leads: leads.length,
        orcamentos: quotes.length
      });

      // Weekly quotes from last 7 weeks
      const now = new Date();
      const weekly = [0, 0, 0, 0, 0, 0, 0];
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
        if (st === 'SP') regions['São Paulo'] = (regions['São Paulo'] || 0) + 1;else if (st === 'RJ') regions['Rio de Janeiro'] = (regions['Rio de Janeiro'] || 0) + 1;else if (['MG', 'PR', 'RS'].includes(st)) regions['MG/PR/RS'] = (regions['MG/PR/RS'] || 0) + 1;else regions['Outros'] = (regions['Outros'] || 0) + 1;
      });
      const total = profiles.length || 1;
      const colors = {
        'São Paulo': C.p1,
        'Rio de Janeiro': C.p3,
        'MG/PR/RS': C.p7,
        'Outros': C.muted
      };
      setRegionData(['São Paulo', 'Rio de Janeiro', 'MG/PR/RS', 'Outros'].map(r => ({
        name: r,
        pct: Math.round((regions[r] || 0) / total * 100) + '%',
        color: colors[r]
      })));
      setRecentQuotes(quotes.slice(0, 5));
      setRecentMessages(msgs);
      setLoading(false);
    })();
  }, []);
  const maxW = React.useMemo(() => Math.max(...weeklyQuotes, 1), [weeklyQuotes]);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando dashboard...");
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(KPICard, {
    title: "Perfis Cadastrados",
    value: stats.pintores.toLocaleString('pt-BR'),
    sub: "no sistema",
    trend: "",
    color: C.p6
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Clientes",
    value: stats.clientes.toLocaleString('pt-BR'),
    sub: "cadastrados",
    trend: "",
    color: C.p3
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Leads",
    value: stats.leads.toLocaleString('pt-BR'),
    sub: "captados",
    trend: "",
    color: C.p5
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Or\xE7amentos",
    value: stats.orcamentos.toLocaleString('pt-BR'),
    sub: "solicitados",
    trend: "",
    color: C.p1
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDCCA Or\xE7amentos por Semana"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 8,
      height: 80
    }
  }, weeklyQuotes.map((h, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: i === 6 ? C.p1 : C.p2,
      borderRadius: 4,
      width: '100%',
      height: Math.max(8, h / maxW * 70) + 'px'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.muted
    }
  }, "S", i + 1))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDDFA\uFE0F Perfis por Regi\xE3o"), regionData.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.name,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, r.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: r.color
    }
  }, r.pct))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDCCB Or\xE7amentos Recentes"), recentQuotes.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum or\xE7amento encontrado."), recentQuotes.map((q, i) => {
    const stInfo = quoteStatusInfo(q.status);
    const stStyle = quoteStatusStyle(q.status);
    const data = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    }) : '—';
    return /*#__PURE__*/React.createElement("div", {
      key: q.id || i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: i < recentQuotes.length - 1 ? '1px solid ' + C.border : 'none'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: C.p2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        fontWeight: 700
      }
    }, (q.client?.name || '?')[0]), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        fontSize: 13
      }
    }, q.client?.name || '—'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted,
        fontSize: 12
      }
    }, "\u2192"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13
      }
    }, q.painter?.name || '—'), /*#__PURE__*/React.createElement("span", {
      style: {
        ...stStyle,
        fontSize: 10,
        padding: '1px 8px',
        borderRadius: 6
      }
    }, stInfo.label))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.muted
      }
    }, data));
  })));
};
const PintoresList = ({
  roleFilter,
  title,
  defaultRole,
  emptyMsg
}) => {
  // Mostra TODOS os profissionais do tipo, sendo PRO ou nao.
  const {
    data,
    loading,
    refetch: fetchPintores
  } = useSupabaseQuery(() => profilesService.list({
    painterOnly: true,
    order: 'created_at',
    ascending: false
  }), []);
  const pintores = roleFilter ? (data || []).filter(roleFilter) : data || [];
  const updateVerified = (id, verified) => setProfileVerified(id, verified, fetchPintores);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando...");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, title || 'Pintores Cadastrados', " (", pintores.length, ")"), /*#__PURE__*/React.createElement(CreateAppUserForm, {
    onCreated: fetchPintores,
    defaultRole: defaultRole || 'pintor'
  }), pintores.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, emptyMsg || 'Nenhum pintor cadastrado.'), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13,
      minWidth: 700
    }
  }, pintores.length > 0 && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Nome', 'Tipo', 'Tag', 'Cidade', 'Estado', 'Especialidades', 'Avaliacao', 'Status', 'PRO', 'Portal', 'Acoes'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, pintores.map((p, i) => /*#__PURE__*/React.createElement("tr", {
    key: p.id,
    style: {
      borderBottom: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(AvatarCell, {
    name: p.name,
    avatarUrl: p.avatar_url,
    size: 32
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, p.name || 'Sem nome'))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement(RoleSelect, {
    profile: p,
    after: fetchPintores
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px',
      color: C.muted,
      fontSize: 12
    }
  }, p.tag ? '@' + p.tag : '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, p.city || '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, p.state || '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px',
      fontSize: 12,
      color: C.muted
    }
  }, p.specialties || '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, p.rating_avg != null ? Number(p.rating_avg).toFixed(1) : '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, p.verified ? /*#__PURE__*/React.createElement("span", {
    style: {
      background: C.p6 + '22',
      color: C.p6,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600
    }
  }, "Aprovado") : /*#__PURE__*/React.createElement("span", {
    style: {
      background: C.p7 + '22',
      color: '#b8860b',
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600
    }
  }, "Pendente")), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement(ProBadgeCell, {
    profile: p,
    onChange: fetchPintores
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement(PortalAccessCell, {
    profile: p,
    onChange: fetchPintores
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, !p.verified ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
    onClick: () => updateVerified(p.id, true),
    style: {
      background: C.p6,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 11,
      fontWeight: 600
    }
  }, "Aprovar"), /*#__PURE__*/React.createElement("button", {
    onClick: () => updateVerified(p.id, false),
    style: {
      background: C.p4,
      color: '#fff',
      border: 'none',
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 11,
      fontWeight: 600
    }
  }, "Rejeitar")) : /*#__PURE__*/React.createElement("button", {
    onClick: () => updateVerified(p.id, false),
    style: {
      background: 'none',
      border: '1px solid ' + C.border,
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 11,
      color: C.muted
    }
  }, "Revogar")))))))));
};

// Dicionário determinístico: cor escrita no nome → hex. Compostos primeiro.
// Movido para escopo de módulo: nunca muda e era recriado a cada render.
const COLOR_DICT = [['branco neve', '#fbfbf7'], ['branco gelo', '#eef0ea'], ['branco fosco', '#f4f3ee'], ['off white', '#efece1'], ['branco', '#f6f5f0'], ['preto fosco', '#1c1c1c'], ['preto', '#1a1a1a'], ['cinza chumbo', '#4b4f54'], ['cinza grafite', '#3a3d40'], ['grafite', '#3a3d40'], ['cinza claro', '#c7c9c8'], ['cinza escuro', '#5a5d5f'], ['cinza concreto', '#9a9b96'], ['concreto', '#9a9b96'], ['cinza', '#9b9d9c'], ['prata', '#c5c7c9'], ['aluminio', '#b8bcc0'], ['azul claro', '#9ec7e8'], ['azul bebe', '#bcd9ee'], ['azul royal', '#1f4ea1'], ['azul marinho', '#1b2a4a'], ['azul petroleo', '#1f5560'], ['azul turquesa', '#2bb6c4'], ['turquesa', '#2bb6c4'], ['azul', '#2f6fb0'], ['verde musgo', '#5a6b3b'], ['verde limao', '#bcd64a'], ['verde agua', '#bfe3d8'], ['verde bandeira', '#1e7a3d'], ['verde oliva', '#6b6b3a'], ['verde', '#2e8b57'], ['amarelo ouro', '#e0a526'], ['amarelo canario', '#f5d427'], ['amarelo', '#f2c531'], ['ouro', '#caa233'], ['dourado', '#caa233'], ['vermelho', '#c0392b'], ['vinho', '#5e1f24'], ['bordo', '#5e1f24'], ['carmim', '#9b1c2e'], ['laranja', '#e67e22'], ['terracota', '#b5562e'], ['tijolo', '#9c4a2f'], ['salmao', '#f0a78f'], ['rosa', '#e79bb3'], ['pink', '#e84d8a'], ['magenta', '#c0337a'], ['roxo', '#6b3fa0'], ['lilas', '#b9a5d6'], ['violeta', '#7a4fb0'], ['marrom', '#6b4226'], ['cafe', '#4b3621'], ['chocolate', '#4b2e1e'], ['caramelo', '#a9743b'], ['tabaco', '#7a5230'], ['imbuia', '#5a3a22'], ['mogno', '#6e3326'], ['cedro', '#8a5a33'], ['castanho', '#5d3a22'], ['bege', '#d8c6a8'], ['areia', '#d6c5a0'], ['palha', '#e3d5ad'], ['creme', '#efe6cf'], ['nude', '#e3c9b3'], ['camurca', '#c9a878'], ['marfim', '#efe7d2'], ['gelo', '#eef0ea'], ['perola', '#ece7dd']];
const _PLACEHOLDER_HEX = /^#?(c0622d|cccccc|ddd|dddddd|e8e2d9)$/i;
const resolveColorHex = p => {
  const ch = p && p.color_hex ? String(p.color_hex).trim() : '';
  if (ch && !_PLACEHOLDER_HEX.test(ch.replace('#', ''))) return ch;
  const n = ' ' + String(p && p.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
  for (const [k, hex] of COLOR_DICT) {
    if (n.includes(k)) return hex;
  }
  return ch || null;
};
const productBg = p => p && p.color_gradient ? 'linear-gradient(135deg,' + p.color_gradient + ')' : resolveColorHex(p) || '#e8e2d9';

// Classificador automático por palavra-chave no nome (marca/tipo).
// A ordem importa: o primeiro menu cuja palavra-chave casar vence.
const MENUS = [{
  key: 'arte_urbana',
  label: '🎨 Arte Urbana & Spray',
  kw: ['arte urbana', 'colorgin', 'spray', 'aerossol', 'aerosol', 'grafit', 'graffit']
}, {
  key: 'tintas',
  label: '🪣 Tintas',
  kw: ['tinta', 'esmalte', 'latex', 'látex', 'acrilic', 'acrílic', 'verniz', 'primer', 'seladora', 'fundo preparador', 'base coat', 'automotiva', 'suvinil', 'coral', 'sherwin']
}, {
  key: 'texturas',
  label: '🧱 Texturas & Massas',
  kw: ['textura', 'grafiato', 'massa corrida', 'massa acrilic', 'massa pva', 'reboco', 'chapisco']
}, {
  key: 'epoxi',
  label: '⚗️ Epóxi & Poliuretano',
  kw: ['epoxi', 'epóxi', 'poliuretano', ' pu ']
}, {
  key: 'solventes',
  label: '💧 Solventes & Aditivos',
  kw: ['thinner', 'solvente', 'diluente', 'aguarras', 'aguarrás', 'acelerador', 'secante', 'catalisador', 'endurecedor', 'aditivo', 'redutor', 'removedor']
}, {
  key: 'adesivos',
  label: '🧪 Adesivos & Colas',
  kw: ['adesivo', 'cola', 'silicone', 'vedante', 'veda calha', 'rejunte', 'massa epox', 'durepoxi']
}, {
  key: 'ferramentas',
  label: '🧰 Ferramentas',
  kw: ['alicate', 'tesoura', 'chave', 'martelo', 'abre trinca', 'espatula', 'espátula', 'desempenadeira', 'colher de pedreiro', 'trena', 'serra', 'furadeira', 'broca', 'lixadeira', 'estilete', 'formao', 'formão', 'grosa', 'lima', 'torques']
}, {
  key: 'pintura',
  label: '🖌️ Acessórios de Pintura',
  kw: ['rolo', 'pincel', 'trincha', 'bandeja', 'fita crepe', 'fita', 'lixa', 'cabo extensor', 'extensor', 'gaiola', 'luva', 'mascara', 'máscara', 'respirador', 'oculos', 'óculos', 'lona', 'plastico', 'plástico', 'crepe']
}, {
  key: 'eletrica',
  label: '🔌 Elétrica',
  kw: ['tomada', 'adaptador', 'extens', 'lampada', 'lâmpada', 'disjuntor', 'filtro de linha', 'benjamim', 'fio ', 'interruptor']
}, {
  key: 'equipamentos',
  label: '🛠️ Equipamentos',
  kw: ['aerografo', 'aerógrafo', 'compressor', 'pistola', 'maquina', 'máquina', 'pulverizador', 'airless']
}];
const classify = p => {
  const n = (' ' + (p.name || '') + ' ').toLowerCase();
  for (const m of MENUS) {
    if (m.kw.some(k => n.includes(k))) return m.key;
  }
  return 'outros';
};
const MENU_LABEL = Object.fromEntries(MENUS.map(m => [m.key, m.label]).concat([['outros', '📦 Outros']]));
const ProdutosList = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [menuFilter, setMenuFilter] = useState('all');
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState({
    name: '',
    code: '',
    category: 'tintas',
    volume: '18L',
    price: '',
    color_hex: '#c0622d',
    color_gradient: '',
    image_url: '',
    stock: 0,
    badge: '',
    description: '',
    line: 'Linha Premium',
    rendimento: '~10m²/L',
    demaos: '2',
    secagem: '2h',
    active: true
  });
  const loadProducts = async () => {
    setLoading(true);
    try {
      const PAGE = 1000;
      const byId = new Map();
      for (let pageNo = 0; pageNo < 30; pageNo++) {
        const from = pageNo * PAGE;
        const {
          data,
          error
        } = await supa.from('products').select('*').order('name').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        const before = byId.size;
        data.forEach(p => {
          byId.set(p.id, p);
        });
        if (byId.size === before) break;
        if (data.length < PAGE) break;
      }
      setProducts(Array.from(byId.values()));
    } catch (e) {
      console.error('loadProducts error:', e);
      setProducts([]);
    }
    setLoading(false);
  };
  useEffect(() => {
    loadProducts();
  }, []);
  const saveProduct = async () => {
    try {
      const productData = {
        ...form,
        price: parseFloat(String(form.price).replace(',', '.')) || 0,
        stock: parseInt(form.stock) || 0
      };
      if (!productData.image_url) delete productData.image_url; // só envia se houver foto (coluna pode não existir ainda)
      if (!productData.name) {
        alert('Nome obrigatorio');
        return;
      }
      // productsService.upsert cobre insert + update (quando id presente).
      if (editing) productData.id = editing;
      await productsService.upsert(productData);
      setShowForm(false);
      setEditing(null);
      setForm({
        name: '',
        code: '',
        category: 'tintas',
        volume: '18L',
        price: '',
        color_hex: '#c0622d',
        color_gradient: '',
        image_url: '',
        stock: 0,
        badge: '',
        description: '',
        line: 'Linha Premium',
        rendimento: '~10m²/L',
        demaos: '2',
        secagem: '2h',
        active: true
      });
      loadProducts();
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    }
  };
  const deleteProduct = async id => {
    if (!confirm('Excluir este produto?')) return;
    try {
      await productsService.remove(id);
      loadProducts();
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    }
  };
  const editProduct = p => {
    setForm({
      name: p.name || '',
      code: p.code || '',
      category: p.category || 'tintas',
      volume: p.volume || '18L',
      price: p.price || '',
      color_hex: p.color_hex || '#c0622d',
      color_gradient: p.color_gradient || '',
      image_url: p.image_url || '',
      stock: p.stock || 0,
      badge: p.badge || '',
      description: p.description || '',
      line: p.line || '',
      rendimento: p.rendimento || '',
      demaos: p.demaos || '',
      secagem: p.secagem || '',
      active: p.active !== false
    });
    setEditing(p.id);
    setShowForm(true);
  };

  // Agrupamento por categoria — pesado quando há milhares de produtos.
  // Só recalcula quando a lista de produtos muda (não a cada keystroke da busca).
  const grouped = React.useMemo(() => {
    const g = {};
    products.forEach(p => {
      const k = classify(p);
      if (!g[k]) g[k] = [];
      g[k].push(p);
    });
    return g;
  }, [products]);
  const orderedKeys = React.useMemo(() => MENUS.map(m => m.key).concat(['outros']).filter(k => grouped[k] && grouped[k].length), [grouped]);
  const totalItens = products.length;
  const qLower = React.useMemo(() => busca.trim().toLowerCase(), [busca]);
  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid ' + C.border,
    fontSize: 13,
    outline: 'none'
  };
  const labelStyle = {
    fontSize: 12,
    color: C.muted,
    marginBottom: 4,
    display: 'block'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: C.ink,
      fontSize: 18
    }
  }, "\uD83C\uDFA8 Produtos / Tintas"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setEditing(null);
      setForm({
        name: '',
        code: '',
        category: 'tintas',
        volume: '18L',
        price: '',
        color_hex: '#c0622d',
        color_gradient: '',
        image_url: '',
        stock: 0,
        badge: '',
        description: '',
        line: 'Linha Premium',
        rendimento: '~10m²/L',
        demaos: '2',
        secagem: '2h',
        active: true
      });
      setShowForm(true);
    },
    style: {
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '8px 20px',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "+ Novo Produto"))), showForm && /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 14,
      padding: 20,
      marginBottom: 20,
      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      border: '2px solid ' + C.p1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 15,
      marginBottom: 14
    }
  }, editing ? 'Editar Produto' : 'Novo Produto'), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Nome *"), /*#__PURE__*/React.createElement("input", {
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    }),
    style: inputStyle,
    placeholder: "Terracota Premium"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "C\xF3digo"), /*#__PURE__*/React.createElement("input", {
    value: form.code,
    onChange: e => setForm({
      ...form,
      code: e.target.value
    }),
    style: inputStyle,
    placeholder: "CC-TT-001"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Categoria"), /*#__PURE__*/React.createElement("select", {
    value: form.category,
    onChange: e => setForm({
      ...form,
      category: e.target.value
    }),
    style: inputStyle
  }, /*#__PURE__*/React.createElement("option", {
    value: "tintas"
  }, "Tintas"), /*#__PURE__*/React.createElement("option", {
    value: "texturas"
  }, "Texturas"), /*#__PURE__*/React.createElement("option", {
    value: "epoxi"
  }, "Ep\xF3xi"), /*#__PURE__*/React.createElement("option", {
    value: "acessorios"
  }, "Acess\xF3rios")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Volume"), /*#__PURE__*/React.createElement("input", {
    value: form.volume,
    onChange: e => setForm({
      ...form,
      volume: e.target.value
    }),
    style: inputStyle,
    placeholder: "18L"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Pre\xE7o (R$)"), /*#__PURE__*/React.createElement("input", {
    value: form.price,
    onChange: e => setForm({
      ...form,
      price: e.target.value
    }),
    style: inputStyle,
    placeholder: "289.00"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Estoque"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: form.stock,
    onChange: e => setForm({
      ...form,
      stock: e.target.value
    }),
    style: inputStyle
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Badge"), /*#__PURE__*/React.createElement("input", {
    value: form.badge,
    onChange: e => setForm({
      ...form,
      badge: e.target.value
    }),
    style: inputStyle,
    placeholder: "-10%, NOVO"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Cor (hex)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "color",
    value: form.color_hex,
    onChange: e => setForm({
      ...form,
      color_hex: e.target.value
    }),
    style: {
      width: 40,
      height: 34,
      border: 'none',
      cursor: 'pointer'
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: form.color_hex,
    onChange: e => setForm({
      ...form,
      color_hex: e.target.value
    }),
    style: {
      ...inputStyle,
      flex: 1
    }
  }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Gradiente (opcional)"), /*#__PURE__*/React.createElement("input", {
    value: form.color_gradient,
    onChange: e => setForm({
      ...form,
      color_gradient: e.target.value
    }),
    style: inputStyle,
    placeholder: "#c4956a,#d4a870"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Linha"), /*#__PURE__*/React.createElement("input", {
    value: form.line,
    onChange: e => setForm({
      ...form,
      line: e.target.value
    }),
    style: inputStyle,
    placeholder: "Linha Premium"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Foto do produto (opcional \u2014 sobrep\xF5e a cor)"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, form.image_url && /*#__PURE__*/React.createElement("div", {
    style: {
      width: 48,
      height: 48,
      borderRadius: 8,
      background: 'center/cover no-repeat url(' + form.image_url + ')',
      border: '1px solid ' + C.border,
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("input", {
    type: "file",
    accept: "image/*",
    onChange: async e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        setAiBusy('Enviando foto...');
        const path = 'products/' + Date.now() + '-' + f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const {
          error
        } = await supa.storage.from('posts').upload(path, f, {
          upsert: true
        });
        if (error) throw error;
        const {
          data
        } = supa.storage.from('posts').getPublicUrl(path);
        setForm(fm => ({
          ...fm,
          image_url: data && data.publicUrl || ''
        }));
      } catch (err) {
        alert('Erro ao enviar foto: ' + (err.message || err));
      }
      setAiBusy('');
    },
    style: {
      fontSize: 12,
      flex: 1
    }
  }), form.image_url && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: () => setForm({
      ...form,
      image_url: ''
    }),
    style: {
      background: 'none',
      border: '1px solid ' + C.border,
      borderRadius: 8,
      padding: '6px 12px',
      fontSize: 12,
      cursor: 'pointer',
      color: C.muted
    }
  }, "Remover"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Rendimento"), /*#__PURE__*/React.createElement("input", {
    value: form.rendimento,
    onChange: e => setForm({
      ...form,
      rendimento: e.target.value
    }),
    style: inputStyle,
    placeholder: "~10m\xB2/L"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Dem\xE3os"), /*#__PURE__*/React.createElement("input", {
    value: form.demaos,
    onChange: e => setForm({
      ...form,
      demaos: e.target.value
    }),
    style: inputStyle,
    placeholder: "2"
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Secagem"), /*#__PURE__*/React.createElement("input", {
    value: form.secagem,
    onChange: e => setForm({
      ...form,
      secagem: e.target.value
    }),
    style: inputStyle,
    placeholder: "2h"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: labelStyle
  }, "Descri\xE7\xE3o"), /*#__PURE__*/React.createElement("textarea", {
    value: form.description,
    onChange: e => setForm({
      ...form,
      description: e.target.value
    }),
    style: {
      ...inputStyle,
      minHeight: 60
    },
    placeholder: "Tinta premium com acabamento fosco..."
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: form.active,
    onChange: e => setForm({
      ...form,
      active: e.target.checked
    })
  }), " Ativo"), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowForm(false);
      setEditing(null);
    },
    style: {
      background: 'none',
      border: '1px solid ' + C.border,
      borderRadius: 8,
      padding: '8px 18px',
      fontSize: 13,
      cursor: 'pointer',
      color: C.muted
    }
  }, "Cancelar"), /*#__PURE__*/React.createElement("button", {
    onClick: saveProduct,
    style: {
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 8,
      padding: '8px 24px',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, editing ? 'Salvar' : 'Criar Produto'))), !loading && products.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: busca,
    onChange: e => setBusca(e.target.value),
    placeholder: "\uD83D\uDD0E Buscar produto...",
    style: {
      ...inputStyle,
      marginBottom: 12
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setMenuFilter('all'),
    style: {
      border: '1px solid ' + (menuFilter === 'all' ? C.p1 : C.border),
      background: menuFilter === 'all' ? C.p1 : 'transparent',
      color: menuFilter === 'all' ? '#fff' : C.ink,
      borderRadius: 20,
      padding: '6px 14px',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, "Todos ", /*#__PURE__*/React.createElement("b", null, "(", totalItens, ")")), orderedKeys.map(k => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setMenuFilter(k),
    style: {
      border: '1px solid ' + (menuFilter === k ? C.p1 : C.border),
      background: menuFilter === k ? C.p1 : 'transparent',
      color: menuFilter === k ? '#fff' : C.ink,
      borderRadius: 20,
      padding: '6px 14px',
      fontSize: 12,
      fontWeight: 600,
      cursor: 'pointer'
    }
  }, MENU_LABEL[k], " ", /*#__PURE__*/React.createElement("b", null, "(", grouped[k].length, ")"))))), loading ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: 40,
      color: C.muted
    }
  }, "Carregando produtos...") : products.length === 0 ? /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: 40,
      color: C.muted
    }
  }, "Nenhum produto cadastrado. Clique em \"+ Novo Produto\" para come\xE7ar.") : orderedKeys.filter(cat => menuFilter === 'all' || menuFilter === cat).map(cat => {
    const items = grouped[cat].filter(p => !qLower || (p.name || '').toLowerCase().includes(qLower) || (p.code || '').toLowerCase().includes(qLower));
    if (items.length === 0) return null;
    return /*#__PURE__*/React.createElement("div", {
      key: cat,
      style: {
        marginBottom: 24
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: C.muted,
        marginBottom: 10,
        textTransform: 'uppercase',
        letterSpacing: .5
      }
    }, MENU_LABEL[cat] || cat, " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.p1
      }
    }, "(", grouped[cat].length, ")")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3,1fr)',
        gap: 16
      }
    }, items.map(p => {
      const bg = p.image_url ? 'center/cover no-repeat url(' + p.image_url + ')' : productBg(p);
      return /*#__PURE__*/React.createElement("div", {
        key: p.id,
        style: {
          background: C.white,
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          opacity: p.active === false ? 0.5 : 1,
          position: 'relative'
        }
      }, p.badge && /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          top: 8,
          left: 8,
          background: p.badge === 'NOVO' ? C.p1 : '#e63946',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 10,
          zIndex: 1
        }
      }, p.badge), /*#__PURE__*/React.createElement("div", {
        style: {
          width: '100%',
          height: 60,
          borderRadius: 8,
          background: bg,
          marginBottom: 12
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 600,
          fontSize: 14
        }
      }, p.name), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: C.muted
        }
      }, p.code, p.code && p.volume ? ' · ' : '', p.volume), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          fontWeight: 700,
          color: C.p1
        }
      }, "R$ ", Number(p.price || 0).toFixed(2).replace('.', ',')), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 11,
          color: p.stock <= 5 ? '#e63946' : '#2e7d32'
        }
      }, p.stock, " unid")), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 6,
          marginTop: 10
        }
      }, /*#__PURE__*/React.createElement("button", {
        onClick: () => editProduct(p),
        style: {
          flex: 1,
          background: C.cream,
          border: 'none',
          borderRadius: 8,
          padding: '6px',
          fontSize: 12,
          cursor: 'pointer',
          fontWeight: 600,
          color: C.ink
        }
      }, "Editar"), /*#__PURE__*/React.createElement("button", {
        "aria-label": "Excluir produto",
        onClick: () => deleteProduct(p.id),
        style: {
          background: 'none',
          border: '1px solid #e6394644',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 12,
          cursor: 'pointer',
          color: '#e63946'
        }
      }, "\xD7")));
    })));
  }));
};
const Camisetas = () => {
  const [cor, setCor] = useState('#1a1a2e');
  const [tam, setTam] = useState('M');
  const [logo, setLogo] = useState(true);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDC55 Configurador de Camisetas"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: C.muted,
      marginBottom: 8
    }
  }, "Cor da Camiseta"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, ['#1a1a2e', '#ff6b35', '#2ec4b6', '#e63946', '#ffffff', '#4a4a4a'].map(c => /*#__PURE__*/React.createElement("div", {
    key: c,
    onClick: () => setCor(c),
    style: {
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: c,
      border: cor === c ? '3px solid ' + C.p1 : '2px solid ' + C.border,
      cursor: 'pointer'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: C.muted,
      marginTop: 16,
      marginBottom: 8
    }
  }, "Tamanho"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, ['P', 'M', 'G', 'GG'].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setTam(t),
    style: {
      padding: '6px 16px',
      borderRadius: 8,
      border: '2px solid ' + (tam === t ? C.p1 : C.border),
      background: tam === t ? C.p1 : 'transparent',
      color: tam === t ? '#fff' : C.ink,
      cursor: 'pointer',
      fontWeight: 600
    }
  }, t))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: C.muted,
      marginTop: 16,
      marginBottom: 8
    }
  }, "Logo"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("label", {
    style: {
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: logo,
    onChange: e => setLogo(e.target.checked)
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "Cali Colors + Nome Pintor")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 120,
      height: 140,
      background: cor,
      borderRadius: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      border: '2px solid ' + C.border
    }
  }, logo && /*#__PURE__*/React.createElement("div", {
    style: {
      color: cor === '#ffffff' ? '#333' : '#fff',
      fontSize: 11,
      fontFamily: 'Syne,sans-serif',
      fontWeight: 800,
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, "CaliColors"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      marginTop: 2
    }
  }, "PINTOR PRO")), /*#__PURE__*/React.createElement("div", {
    style: {
      color: cor === '#ffffff' ? '#333' : 'rgba(255,255,255,0.5)',
      fontSize: 8,
      marginTop: 8
    }
  }, "TAM ", tam)), /*#__PURE__*/React.createElement("button", {
    style: {
      marginTop: 16,
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '10px 24px',
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "Gerar Pedido"))));
};
const Analytics = () => {
  const [data, setData] = useState({
    profiles: 0,
    leads: 0,
    quotes: 0,
    messages: 0,
    quotesAccepted: 0,
    quotesData: []
  });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const sb = supa;
      const [pRes, lRes, qRes, mRes] = await Promise.all([sb.from('profiles').select('id, created_at'), sb.from('leads').select('id, status'), sb.from('quotes').select('id, status, service_type, price, created_at'), sb.from('messages').select('id')]);
      const profiles = pRes.data || [];
      const leads = lRes.data || [];
      const quotes = qRes.data || [];
      const messages = mRes.data || [];
      const accepted = quotes.filter(q => q.status === 'accepted' || q.status === 'completed').length;
      setData({
        profiles: profiles.length,
        leads: leads.length,
        quotes: quotes.length,
        messages: messages.length,
        quotesAccepted: accepted,
        quotesData: quotes
      });
      setLoading(false);
    })();
  }, []);
  const funnel = React.useMemo(() => {
    const funnelTotal = data.profiles || 1;
    return [{
      label: 'Perfis cadastrados',
      n: data.profiles,
      pct: 100
    }, {
      label: 'Leads captados',
      n: data.leads,
      pct: Math.round(data.leads / funnelTotal * 100)
    }, {
      label: 'Orçamentos solicitados',
      n: data.quotes,
      pct: Math.round(data.quotes / funnelTotal * 100)
    }, {
      label: 'Orçamentos aceitos/concluídos',
      n: data.quotesAccepted,
      pct: Math.round(data.quotesAccepted / funnelTotal * 100)
    }];
  }, [data]);
  const topServices = React.useMemo(() => {
    const serviceCounts = {};
    data.quotesData.forEach(q => {
      const s = q.service_type || q.title || 'Outros';
      serviceCounts[s] = (serviceCounts[s] || 0) + 1;
    });
    return Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data.quotesData]);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando analytics...");
  const serviceColors = [C.p1, C.p3, C.p7, C.p5, C.p6];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(KPICard, {
    title: "Perfis",
    value: data.profiles,
    sub: "cadastrados",
    trend: "",
    color: C.p3
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Leads",
    value: data.leads,
    sub: "captados",
    trend: "",
    color: C.p5
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Or\xE7amentos",
    value: data.quotes,
    sub: "total",
    trend: "",
    color: C.p1
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Mensagens",
    value: data.messages,
    sub: "enviadas",
    trend: "",
    color: C.p6
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      gridColumn: 'span 2'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16
    }
  }, "\uD83D\uDCC8 Funil de Convers\xE3o"), funnel.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, s.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 700
    }
  }, s.n.toLocaleString('pt-BR'))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.border,
      borderRadius: 4,
      height: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.p1,
      height: 8,
      borderRadius: 4,
      width: Math.max(s.pct, 2) + '%'
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16
    }
  }, "\uD83C\uDFC6 Top Servi\xE7os"), topServices.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum or\xE7amento ainda."), topServices.map(([name, count], i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 12,
      height: 12,
      borderRadius: 3,
      background: serviceColors[i % serviceColors.length]
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 12
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 700
    }
  }, count))))));
};

// Categoria de quem fala: loja / profissional / cliente (cor + tag)
const senderKind = (p, isStore) => {
  if (isStore) return {
    label: 'LOJA',
    fg: '#7a30d6',
    chip: '#efe7fb',
    bub: '#f3edfb',
    bd: '#d9c7f5'
  };
  if (p && (roleOf(p) === 'admin' || p.portal_access === true)) return {
    label: 'LOJA',
    fg: '#7a30d6',
    chip: '#efe7fb',
    bub: '#f3edfb',
    bd: '#d9c7f5'
  };
  if (p && isProProfile(p)) return {
    label: 'PROFISSIONAL',
    fg: '#d2541f',
    chip: '#fff1e8',
    bub: '#fff3ec',
    bd: '#f6d4bf'
  };
  return {
    label: 'CLIENTE',
    fg: '#2563eb',
    chip: '#e8f0fe',
    bub: '#eef4ff',
    bd: '#cdddfb'
  };
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
  const msgsEndRef = React.useRef(null);
  const subRef = React.useRef(null);
  const scrollToBottom = () => {
    msgsEndRef.current?.scrollIntoView({
      behavior: 'smooth'
    });
  };

  // Load conversations list
  const loadConversations = async () => {
    const {
      data: {
        session
      }
    } = await supa.auth.getSession();
    if (session) setMyUserId(session.user.id);
    const {
      data,
      error
    } = await supa.from('messages').select('id, sender_id, receiver_id, conversation_id, content, type, created_at').order('created_at', {
      ascending: false
    }).limit(200);
    if (error || !data) {
      setLoading(false);
      return;
    }
    const ids = [...new Set(data.flatMap(m => [m.sender_id, m.receiver_id]).filter(Boolean))];
    let profMap = {};
    if (ids.length > 0) {
      const {
        data: profs
      } = await supa.from('profiles').select('id, name, avatar_url, role, user_type, tag').in('id', ids);
      if (profs) profs.forEach(p => {
        profMap[p.id] = p;
      });
    }
    setProfiles(profMap);
    const convMap = {};
    data.forEach(m => {
      const key = m.conversation_id || m.sender_id || m.id;
      if (!convMap[key]) convMap[key] = {
        id: key,
        messages: [],
        lastMsg: m,
        participants: new Set(),
        is3way: false
      };
      convMap[key].messages.push(m);
      if (m.sender_id) convMap[key].participants.add(m.sender_id);
      if (m.receiver_id) convMap[key].participants.add(m.receiver_id);
      if (m.type === 'system' && m.content === '__STORE_ADDED__') convMap[key].is3way = true;
      if (!convMap[key].lastMsg || new Date(m.created_at) > new Date(convMap[key].lastMsg.created_at)) convMap[key].lastMsg = m;
    });
    const sorted = Object.values(convMap).sort((a, b) => new Date(b.lastMsg.created_at) - new Date(a.lastMsg.created_at));
    setConversations(sorted);
    setLoading(false);
  };
  useEffect(() => {
    loadConversations();
  }, []);

  // Open a conversation
  const openChat = async convId => {
    setOpenConv(convId);
    setChatLoading(true);
    setChatMsgs([]);
    const {
      data,
      error
    } = await supa.from('messages').select('id, sender_id, receiver_id, conversation_id, content, type, created_at').eq('conversation_id', convId).order('created_at', {
      ascending: true
    }).limit(200);
    if (!error && data) setChatMsgs(data);
    setChatLoading(false);
    setTimeout(scrollToBottom, 100);

    // Realtime subscription
    if (subRef.current) subRef.current.unsubscribe();
    subRef.current = supa.channel('portal-chat-' + convId).on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'messages',
      filter: 'conversation_id=eq.' + convId
    }, payload => {
      setChatMsgs(prev => {
        if (prev.some(m => m.id === payload.new.id)) return prev;
        return [...prev, payload.new];
      });
      setTimeout(scrollToBottom, 100);
    }).subscribe();
  };

  // Cleanup subscription on unmount or conv change
  useEffect(() => {
    return () => {
      if (subRef.current) subRef.current.unsubscribe();
    };
  }, []);

  // Send message
  const sendMessage = async () => {
    const txt = msgText.trim();
    if (!txt || sending) return;
    setSending(true);
    setMsgText('');
    const {
      data: {
        session
      }
    } = await supa.auth.getSession();
    if (!session) {
      setSending(false);
      return;
    }

    // Find receiver from conversation participants
    const conv = conversations.find(c => c.id === openConv);
    const participantIds = conv ? [...conv.participants] : [];
    const receiverId = participantIds.find(id => id !== session.user.id) || null;
    const {
      data: inserted,
      error
    } = await supa.from('messages').insert({
      sender_id: session.user.id,
      receiver_id: receiverId,
      conversation_id: openConv,
      content: txt,
      type: 'store'
    }).select();
    if (error) {
      console.error('Send error:', error);
      alert('Erro ao enviar: ' + error.message);
    } else if (inserted && inserted[0]) {
      // Optimistic: add to chat immediately without waiting for realtime
      setChatMsgs(prev => {
        if (prev.some(m => m.id === inserted[0].id)) return prev;
        return [...prev, inserted[0]];
      });
    }
    setSending(false);
    setTimeout(scrollToBottom, 100);
  };
  const handleKeyDown = e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  const formatTime = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    }) + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  };
  const getInitials = name => name ? name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??';
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando mensagens...");

  // Chat view (conversation open)
  if (openConv) {
    const conv = conversations.find(c => c.id === openConv);
    const participantNames = conv ? [...conv.participants].map(id => profiles[id]?.name || 'Usuario').join(', ') : '';
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 120px)',
        background: C.white,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '16px 20px',
        borderBottom: '1px solid ' + C.border,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("button", {
      "aria-label": "Voltar para lista de conversas",
      onClick: () => {
        setOpenConv(null);
        loadConversations();
      },
      style: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 18,
        color: C.ink,
        padding: '4px 8px',
        borderRadius: 8
      }
    }, "\u2190"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: -4
      }
    }, conv && [...conv.participants].slice(0, 3).map((id, i) => {
      const p = profiles[id];
      return /*#__PURE__*/React.createElement("div", {
        key: id,
        style: {
          width: 36,
          height: 36,
          borderRadius: '50%',
          overflow: 'hidden',
          background: C.p2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 11,
          color: C.ink,
          marginLeft: i > 0 ? -8 : 0,
          border: '2px solid ' + C.white,
          position: 'relative',
          zIndex: 3 - i
        }
      }, p?.avatar_url ? /*#__PURE__*/React.createElement("img", {
        src: p.avatar_url,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }
      }) : getInitials(p?.name || ''));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: 14,
        color: C.ink
      }
    }, participantNames), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.muted
      }
    }, conv?.is3way && /*#__PURE__*/React.createElement("span", {
      style: {
        background: C.p1 + '22',
        color: C.p1,
        borderRadius: 4,
        fontSize: 9,
        padding: '1px 6px',
        fontWeight: 700,
        marginRight: 6
      }
    }, "3-WAY"), conv ? conv.participants.size + ' participantes' : ''))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflowY: 'auto',
        padding: '16px 20px',
        background: '#faf8f5'
      }
    }, chatLoading && /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center',
        color: C.muted,
        padding: 20
      }
    }, "Carregando..."), chatMsgs.filter(m => m.type !== 'system').map(m => {
      const isMe = m.sender_id === myUserId;
      const isStore = m.type === 'store';
      const sender = profiles[m.sender_id];
      // Mostra quem respondeu de fato; "Cali Colors" só quando não há perfil do remetente
      const senderName = sender?.name || (isStore ? 'Cali Colors' : 'Usuario');
      const isImg = m.type === 'image' || m.content && m.content.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
      const time = formatTime(m.created_at);
      const kind = senderKind(sender, isStore);
      return /*#__PURE__*/React.createElement("div", {
        key: m.id,
        style: {
          display: 'flex',
          flexDirection: isMe ? 'row-reverse' : 'row',
          gap: 8,
          marginBottom: 14,
          alignItems: 'flex-end'
        }
      }, !isMe && /*#__PURE__*/React.createElement("div", {
        style: {
          width: 32,
          height: 32,
          borderRadius: '50%',
          overflow: 'hidden',
          background: kind.chip,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 10,
          color: kind.fg,
          flexShrink: 0
        }
      }, sender?.avatar_url ? /*#__PURE__*/React.createElement("img", {
        src: sender.avatar_url,
        style: {
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }
      }) : sender ? getInitials(senderName) : 'CC'), /*#__PURE__*/React.createElement("div", {
        style: {
          maxWidth: '65%'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          justifyContent: isMe ? 'flex-end' : 'flex-start',
          marginBottom: 3
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 9,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '.4px',
          color: kind.fg,
          background: kind.chip,
          padding: '2px 8px',
          borderRadius: 8
        }
      }, senderName, " \xB7 ", kind.label)), /*#__PURE__*/React.createElement("div", {
        style: {
          padding: isImg ? 4 : '10px 14px',
          borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: kind.bub,
          color: C.ink,
          fontSize: 13,
          lineHeight: '1.4',
          border: '1px solid ' + kind.bd,
          wordBreak: 'break-word'
        }
      }, isImg ? /*#__PURE__*/React.createElement("img", {
        src: m.content,
        style: {
          maxWidth: 220,
          borderRadius: 12,
          display: 'block'
        }
      }) : m.content), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 9,
          color: C.muted,
          marginTop: 2,
          textAlign: isMe ? 'right' : 'left',
          marginLeft: 4,
          marginRight: 4
        }
      }, time)));
    }), /*#__PURE__*/React.createElement("div", {
      ref: msgsEndRef
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '12px 20px',
        borderTop: '1px solid ' + C.border,
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexShrink: 0,
        background: C.white
      }
    }, /*#__PURE__*/React.createElement("input", {
      value: msgText,
      onChange: e => setMsgText(e.target.value),
      onKeyDown: handleKeyDown,
      placeholder: "Digite sua mensagem...",
      style: {
        flex: 1,
        padding: '10px 16px',
        borderRadius: 24,
        border: '1px solid ' + C.border,
        fontSize: 13,
        outline: 'none',
        background: '#faf8f5'
      }
    }), /*#__PURE__*/React.createElement("button", {
      "aria-label": "Enviar mensagem",
      onClick: sendMessage,
      disabled: sending || !msgText.trim(),
      style: {
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: msgText.trim() ? C.p1 : C.border,
        color: '#fff',
        border: 'none',
        cursor: msgText.trim() ? 'pointer' : 'default',
        fontSize: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }
    }, "\u27A4")));
  }

  // Conversations list
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "Conversas"), conversations.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhuma conversa encontrada."), conversations.map((conv, i) => {
    const m = conv.lastMsg;
    const sender = profiles[m.sender_id];
    const senderName = sender ? sender.name : m.sender_id ? m.sender_id.slice(0, 8) + '...' : 'Desconhecido';
    const senderAvatar = sender?.avatar_url;
    const initials = getInitials(senderName);
    const participantNames = [...conv.participants].map(id => profiles[id]?.name || '?').join(', ');
    const isPintor = sender && (sender.role === 'pintor' || sender.user_type === 'pintor');
    const lastContent = m.type === 'system' ? '(sistema)' : m.type === 'image' ? '📷 Foto' : (m.content || '').substring(0, 60);
    const dt = m.created_at ? new Date(m.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }) : '';
    return /*#__PURE__*/React.createElement("div", {
      key: conv.id || i,
      onClick: () => openChat(conv.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        borderBottom: i < conversations.length - 1 ? '1px solid ' + C.border : 'none',
        cursor: 'pointer',
        transition: 'background 0.15s',
        borderRadius: 8
      },
      onMouseEnter: e => e.currentTarget.style.background = '#faf8f5',
      onMouseLeave: e => e.currentTarget.style.background = 'transparent'
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 44,
        height: 44,
        borderRadius: '50%',
        overflow: 'hidden',
        background: C.p2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 14,
        color: C.ink,
        flexShrink: 0
      }
    }, senderAvatar ? /*#__PURE__*/React.createElement("img", {
      src: senderAvatar,
      style: {
        width: '100%',
        height: '100%',
        objectFit: 'cover'
      }
    }) : initials), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        marginBottom: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        fontSize: 13
      }
    }, senderName), isPintor && /*#__PURE__*/React.createElement("span", {
      style: {
        background: C.ink,
        color: C.p1,
        borderRadius: 6,
        fontSize: 9,
        padding: '1px 6px',
        fontWeight: 700
      }
    }, "PINTOR"), conv.is3way && /*#__PURE__*/React.createElement("span", {
      style: {
        background: C.p1 + '22',
        color: C.p1,
        borderRadius: 6,
        fontSize: 9,
        padding: '1px 6px',
        fontWeight: 700
      }
    }, "3-WAY"), conv.participants.size > 2 && !conv.is3way && /*#__PURE__*/React.createElement("span", {
      style: {
        background: C.p3 + '22',
        color: C.p3,
        borderRadius: 6,
        fontSize: 9,
        padding: '1px 6px',
        fontWeight: 700
      }
    }, conv.participants.size, "P")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: C.muted,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, lastContent), conv.participants.size > 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.muted,
        marginTop: 2
      }
    }, participantNames)), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'right',
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.muted
      }
    }, dt), conv.messages.length > 1 && /*#__PURE__*/React.createElement("div", {
      style: {
        background: C.p1,
        color: '#fff',
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 700,
        padding: '2px 7px',
        marginTop: 4,
        display: 'inline-block'
      }
    }, conv.messages.length)));
  }));
};
const CLAUDE_API_KEY = localStorage.getItem('claude_api_key') || '';
const AI_SEARCH_STORE_ADDRESS = 'Estr. Pres. Juscelino K. de Oliveira, 1071 - Jardim dos Pimentas, Guarulhos - SP, 07272-345';
const AiSearchModal = ({
  open,
  onClose,
  onResults,
  existingLeads
}) => {
  const [alvo, setAlvo] = useState('');
  const [raio, setRaio] = useState(15);
  const [endereco, setEndereco] = useState(AI_SEARCH_STORE_ADDRESS);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState(CLAUDE_API_KEY);
  const [showKeyInput, setShowKeyInput] = useState(!CLAUDE_API_KEY);
  const doSearch = async () => {
    if (!alvo.trim()) {
      setError('Descreva o alvo da busca');
      return;
    }
    if (!apiKey.trim()) {
      setShowKeyInput(true);
      setError('Configure sua API Key do Claude');
      return;
    }
    localStorage.setItem('claude_api_key', apiKey);
    setSearching(true);
    setError('');
    setResults(null);
    const existingNames = existingLeads.map(l => (l.name || '').toLowerCase());
    const prompt = `Você é um assistente de prospecção de leads para uma loja de tintas chamada "Cali Colors" localizada em: ${endereco}.

TAREFA: Encontre ${alvo} em um raio de até ${raio}km da loja.

REGRAS:
- Retorne APENAS um JSON array com no máximo 20 resultados
- Cada objeto deve ter: name, phone, segment, category, rating, review_count, neighborhood, city, priority, address
- segment deve ser: RESIDENCIAL, COMERCIAL, AUTOMOTIVO ou GRAFFITI
- priority: alta, media ou baixa (baseado em proximidade e relevância)
- phone no formato: 11 XXXX-XXXX (DDD de Guarulhos/SP)
- rating de 1.0 a 5.0
- NÃO inclua estes nomes que já são leads: ${existingNames.slice(0, 30).join(', ')}
- Gere resultados realistas baseados no tipo de negócio e região
- Responda SOMENTE com o JSON array, sem texto adicional`;
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || 'Erro na API Claude');
      const text = data.content?.[0]?.text || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('Resposta inválida da AI');
      const parsed = JSON.parse(jsonMatch[0]);
      setResults(parsed);
    } catch (e) {
      setError(e.message || 'Erro ao buscar leads');
    } finally {
      setSearching(false);
    }
  };
  const saveLeads = async () => {
    if (!results || results.length === 0) return;
    const rows = results.map(r => ({
      name: r.name,
      phone: r.phone,
      segment: r.segment,
      category: r.category,
      rating: r.rating,
      review_count: r.review_count,
      neighborhood: r.neighborhood,
      city: r.city || 'Guarulhos',
      priority: r.priority || 'media',
      address: r.address || '',
      source: 'ai_search',
      status: 'novo'
    }));
    let saved = 0;
    try {
      await leadsService.insertBatch(rows);
      saved = rows.length;
    } catch (e) {
      // Se o batch falhar, tenta um a um para nao perder todos.
      console.warn('insertBatch leads falhou, tentando um a um:', e);
      for (const row of rows) {
        try {
          await leadsService.insertBatch([row]);
          saved++;
        } catch (_) {/* ignora */}
      }
    }
    alert('✅ ' + saved + ' leads salvos no banco!');
    onResults();
    onClose();
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "ai-search-modal-title",
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    },
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: C.white,
      borderRadius: 20,
      width: 620,
      maxHeight: '85vh',
      overflow: 'auto',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'linear-gradient(135deg, #8338ec, #6b21c8)',
      padding: '24px 28px',
      borderRadius: '20px 20px 0 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    id: "ai-search-modal-title",
    style: {
      color: '#fff',
      fontSize: 20,
      fontWeight: 800,
      fontFamily: 'Syne,sans-serif'
    }
  }, "\u2728 Busca AI de Leads"), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 13,
      marginTop: 4
    }
  }, "Powered by Claude AI \u2014 Encontre novos clientes na regi\xE3o")), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Fechar busca AI",
    onClick: onClose,
    style: {
      background: 'rgba(255,255,255,0.2)',
      border: 'none',
      borderRadius: 10,
      width: 36,
      height: 36,
      fontSize: 18,
      color: '#fff',
      cursor: 'pointer'
    }
  }, "\u2715"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 24
    }
  }, showKeyInput && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "\uD83D\uDD11 API Key Claude"), /*#__PURE__*/React.createElement("input", {
    value: apiKey,
    onChange: e => setApiKey(e.target.value),
    placeholder: "sk-ant-...",
    type: "password",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 13,
      outline: 'none',
      fontFamily: 'monospace'
    }
  })), !showKeyInput && apiKey && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: C.p6
    }
  }, "\u2705 API Key configurada"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShowKeyInput(true),
    style: {
      fontSize: 11,
      color: C.p5,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "Alterar")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "\uD83D\uDCCD Endere\xE7o da Cali Colors"), /*#__PURE__*/React.createElement("input", {
    value: endereco,
    onChange: e => setEndereco(e.target.value),
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 13,
      outline: 'none',
      background: C.bg
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6
    }
  }, "\uD83C\uDFAF Descri\xE7\xE3o do Alvo"), /*#__PURE__*/React.createElement("textarea", {
    value: alvo,
    onChange: e => setAlvo(e.target.value),
    rows: 3,
    placeholder: "Ex: funilarias e oficinas de pintura automotiva, lojas de materiais de constru\xE7\xE3o, pintores residenciais...",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 13,
      outline: 'none',
      resize: 'vertical',
      fontFamily: 'DM Sans,sans-serif'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8
    }
  }, "\uD83D\uDCCF Raio de busca: ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.p5,
      fontSize: 16,
      fontWeight: 800
    }
  }, raio, "km")), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: 5,
    max: 50,
    value: raio,
    onChange: e => setRaio(Number(e.target.value)),
    style: {
      width: '100%',
      accentColor: C.p5
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 11,
      color: C.muted
    }
  }, /*#__PURE__*/React.createElement("span", null, "5km"), /*#__PURE__*/React.createElement("span", null, "15km"), /*#__PURE__*/React.createElement("span", null, "30km"), /*#__PURE__*/React.createElement("span", null, "50km"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 20
    }
  }, ['Funilarias e pintura automotiva', 'Pintores residenciais', 'Construtoras e reformas', 'Lojas de materiais', 'Imobiliárias', 'Condomínios'].map(t => /*#__PURE__*/React.createElement("button", {
    key: t,
    onClick: () => setAlvo(t),
    style: {
      padding: '6px 14px',
      borderRadius: 20,
      border: '1px solid ' + C.border,
      background: alvo === t ? 'rgba(131,56,236,0.1)' : 'transparent',
      color: alvo === t ? C.p5 : C.ink,
      fontSize: 12,
      cursor: 'pointer',
      fontWeight: 500
    }
  }, t))), error && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.p4,
      fontSize: 13,
      marginBottom: 12,
      padding: '8px 14px',
      background: 'rgba(230,57,70,0.1)',
      borderRadius: 10
    }
  }, "\u26A0\uFE0F ", error), /*#__PURE__*/React.createElement("button", {
    onClick: doSearch,
    disabled: searching,
    style: {
      width: '100%',
      padding: 14,
      borderRadius: 12,
      border: 'none',
      background: searching ? C.muted : 'linear-gradient(135deg, #8338ec, #6b21c8)',
      color: '#fff',
      fontSize: 15,
      fontWeight: 700,
      cursor: searching ? 'wait' : 'pointer',
      fontFamily: 'DM Sans,sans-serif',
      boxShadow: '0 4px 15px rgba(131,56,236,0.3)'
    }
  }, searching ? '🔄 Buscando com Claude AI...' : '✨ Buscar Leads com AI'), results && results.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: C.ink
    }
  }, "\uD83C\uDFAF ", results.length, " leads encontrados"), /*#__PURE__*/React.createElement("button", {
    onClick: saveLeads,
    style: {
      padding: '8px 18px',
      borderRadius: 10,
      border: 'none',
      background: C.p6,
      color: '#fff',
      fontSize: 13,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "\uD83D\uDCBE Salvar todos no banco")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 300,
      overflow: 'auto',
      borderRadius: 12,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: C.bg
    }
  }, ['Nome', 'Segmento', 'Categoria', 'Rating', 'Telefone', 'Bairro'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      padding: '8px 10px',
      textAlign: 'left',
      fontWeight: 600,
      color: C.muted,
      fontSize: 11
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, results.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderTop: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '8px 10px',
      fontWeight: 600
    }
  }, r.name), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '8px 10px'
    }
  }, /*#__PURE__*/React.createElement(StatusBadge, {
    status: (r.segment || '').toUpperCase(),
    colorMap: LEAD_SEG_COLORS,
    labelMap: {}
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '8px 10px',
      color: C.muted
    }
  }, r.category), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '8px 10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#f5a623'
    }
  }, '★'.repeat(Math.round(r.rating || 0))), " ", (r.rating || 0).toFixed(1)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '8px 10px',
      color: C.p3
    }
  }, r.phone), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '8px 10px',
      color: C.muted
    }
  }, r.neighborhood))))))), results && results.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      padding: 20,
      color: C.muted,
      marginTop: 16
    }
  }, "Nenhum lead encontrado. Tente termos diferentes."))));
};

// Constantes estáticas dos Leads — movidas para módulo (eram recriadas a cada render).
const LEAD_SEG_COLORS = {
  AUTOMOTIVO: '#e63946',
  GRAFFITI: '#8338ec',
  RESIDENCIAL: '#ff6b35',
  COMERCIAL: '#2ec4b6'
};
const LEAD_SEG_ICONS = {
  AUTOMOTIVO: '🚗',
  GRAFFITI: '🎨',
  'GRAFFITI/ARTE': '🎨',
  RESIDENCIAL: '🏠',
  COMERCIAL: '🏢'
};
const LEAD_CAT_ICONS = {
  'Funilaria/Auto': '🚗',
  'Graffiti/Arte': '🎨',
  'Pintor': '🖌',
  'Reformas': '🔧',
  'Construtoras': '🏗',
  'Imobiliárias': '🏢',
  'Arquitetura': '✏',
  'Materiais': '🧱',
  'Condomínios': '🏘',
  'Academias': '💪',
  'Bares': '🍺',
  'Limpeza': '🧹',
  'Marmoraria': '💎'
};
const LEAD_STATUS_COLORS = {
  novo: C.p3,
  contactado: C.p7,
  qualificado: C.p6,
  convertido: C.p1,
  perdido: C.p4
};
const LEAD_PRIO_COLORS = {
  alta: C.p6,
  media: C.p7,
  baixa: C.muted
};
const Leads = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('Todos');
  const [filtroSegmento, setFiltroSegmento] = useState('TODOS');
  const [filtroCategoria, setFiltroCategoria] = useState('Todas');
  const [ordenar, setOrdenar] = useState('rating');
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const removeDuplicates = async allLeads => {
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
        try {
          await leadsService.remove(id);
        } catch (e) {
          console.warn('leads.remove dup error:', e);
        }
      }
    }
    return dupeIds.length;
  };
  const fetchLeads = async () => {
    try {
      const rows = await leadsService.list();
      setLeads(rows);
    } catch (e) {
      console.error('fetchLeads error:', e);
      setLeads([]);
    }
    setLoading(false);
  };
  useEffect(() => {
    fetchLeads();
  }, []);
  const updateStatus = async (id, newStatus) => {
    try {
      await leadsService.updateStatus(id, newStatus);
      fetchLeads();
    } catch (e) {
      alert('Erro ao atualizar status: ' + (e.message || e));
    }
  };
  const statusColor = s => LEAD_STATUS_COLORS[s] || C.muted;
  const prioColor = p => LEAD_PRIO_COLORS[p] || C.muted;
  const segColors = LEAD_SEG_COLORS;

  // Filters + sort — pesado quando há muitos leads. Memoizado por estado de filtro/busca/lista.
  const filtered = React.useMemo(() => {
    let out = leads;
    if (busca) {
      const q = busca.toLowerCase();
      out = out.filter(l => (l.name || '').toLowerCase().includes(q) || (l.segment || '').toLowerCase().includes(q) || (l.category || '').toLowerCase().includes(q) || (l.neighborhood || '').toLowerCase().includes(q));
    }
    if (filtroStatus !== 'Todos') out = out.filter(l => l.status === filtroStatus.toLowerCase());
    if (filtroSegmento !== 'TODOS') out = out.filter(l => (l.segment || '').toUpperCase() === filtroSegmento);
    if (filtroCategoria !== 'Todas') out = out.filter(l => l.category === filtroCategoria);
    if (ordenar === 'rating') out = [...out].sort((a, b) => (b.rating || 0) - (a.rating || 0));else if (ordenar === 'reviews') out = [...out].sort((a, b) => (b.review_count || 0) - (a.review_count || 0));else if (ordenar === 'name') out = [...out].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return out;
  }, [leads, busca, filtroStatus, filtroSegmento, filtroCategoria, ordenar]);

  // Segment / Category / Status counts — só dependem de leads.
  const segments = React.useMemo(() => {
    const s = {};
    leads.forEach(l => {
      const k = (l.segment || 'Outros').toUpperCase();
      s[k] = (s[k] || 0) + 1;
    });
    return s;
  }, [leads]);
  const categories = React.useMemo(() => {
    const c = {};
    leads.forEach(l => {
      const k = l.category || 'Outros';
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [leads]);
  const statusCounts = React.useMemo(() => {
    const sc = {
      total: leads.length
    };
    ['novo', 'contactado', 'qualificado', 'convertido', 'perdido'].forEach(s => {
      sc[s] = leads.filter(l => l.status === s).length;
    });
    return sc;
  }, [leads]);
  const sortedSegments = React.useMemo(() => Object.entries(segments).sort((a, b) => b[1] - a[1]), [segments]);
  const sortedCategories = React.useMemo(() => Object.entries(categories).sort((a, b) => b[1] - a[1]), [categories]);
  const exportCSV = () => {
    const header = ['#', 'Nome', 'Bairro', 'Segmento', 'Categoria', 'Rating', 'Reviews', 'Telefone', 'Prioridade', 'Status'];
    const rows = filtered.map((l, i) => [i + 1, l.name || '', l.neighborhood || '', l.segment || '', l.category || '', l.rating || '', l.review_count || '', l.phone || '', l.priority || '', l.status || '']);
    const csv = [header, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'leads_calicolors.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const openWhatsApp = (phone, name) => {
    if (!phone) return;
    const num = phone.replace(/\D/g, '');
    const fullNum = num.startsWith('55') ? num : '55' + num;
    const msg = encodeURIComponent('Olá ' + (name || '') + '! Somos da Cali Colors — QueroUmaCor. Gostaríamos de apresentar nossa plataforma para você. Podemos conversar?');
    window.open('https://wa.me/' + fullNum + '?text=' + msg, '_blank', 'noopener,noreferrer');
  };
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando leads...");
  const segIcons = LEAD_SEG_ICONS;
  const catIcons = LEAD_CAT_ICONS;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      marginBottom: 20,
      flexWrap: 'wrap',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 20,
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.p1,
      fontWeight: 700,
      fontSize: 16
    }
  }, leads.length), /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.muted,
      fontSize: 12
    }
  }, "leads")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 20,
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.p6,
      fontWeight: 700,
      fontSize: 16
    }
  }, statusCounts.convertido || 0), /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.muted,
      fontSize: 12
    }
  }, "clientes")), sortedSegments.slice(0, 5).map(([seg, count]) => /*#__PURE__*/React.createElement("div", {
    key: seg,
    style: {
      background: C.white,
      borderRadius: 20,
      padding: '8px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, segIcons[seg] || '📌'), /*#__PURE__*/React.createElement("span", {
    style: {
      color: C.ink,
      fontWeight: 700,
      fontSize: 16
    }
  }, count)))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 14,
      padding: 16,
      marginBottom: 16,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      marginBottom: 14,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: busca,
    onChange: e => setBusca(e.target.value),
    placeholder: "Buscar por nome, segmento, bairro...",
    style: {
      width: '100%',
      padding: '10px 14px 10px 36px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      background: C.bg,
      color: C.ink,
      fontSize: 13,
      outline: 'none',
      fontFamily: 'DM Sans,sans-serif'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      fontSize: 14,
      color: C.muted
    }
  }, "\uD83D\uDD0D")), /*#__PURE__*/React.createElement("select", {
    value: filtroStatus,
    onChange: e => setFiltroStatus(e.target.value),
    style: {
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      background: C.bg,
      color: C.ink,
      fontSize: 12,
      outline: 'none',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "Todos"
  }, "Todos status"), /*#__PURE__*/React.createElement("option", {
    value: "Novo"
  }, "Novo"), /*#__PURE__*/React.createElement("option", {
    value: "Contactado"
  }, "Contactado"), /*#__PURE__*/React.createElement("option", {
    value: "Qualificado"
  }, "Qualificado"), /*#__PURE__*/React.createElement("option", {
    value: "Convertido"
  }, "Convertido"), /*#__PURE__*/React.createElement("option", {
    value: "Perdido"
  }, "Perdido")), /*#__PURE__*/React.createElement("select", {
    value: ordenar,
    onChange: e => setOrdenar(e.target.value),
    style: {
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      background: C.bg,
      color: C.ink,
      fontSize: 12,
      outline: 'none',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: "rating"
  }, "Ordenar: Rating \u2193"), /*#__PURE__*/React.createElement("option", {
    value: "reviews"
  }, "Ordenar: Reviews \u2193"), /*#__PURE__*/React.createElement("option", {
    value: "name"
  }, "Ordenar: Nome A-Z")), /*#__PURE__*/React.createElement("button", {
    onClick: exportCSV,
    style: {
      padding: '10px 16px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      background: C.bg,
      color: C.ink,
      fontSize: 12,
      cursor: 'pointer',
      fontWeight: 600,
      whiteSpace: 'nowrap'
    }
  }, "\u2B07 CSV"), /*#__PURE__*/React.createElement("button", {
    onClick: () => setAiModalOpen(true),
    style: {
      padding: '10px 16px',
      borderRadius: 10,
      border: 'none',
      background: 'linear-gradient(135deg, #8338ec, #6b21c8)',
      color: '#fff',
      fontSize: 12,
      cursor: 'pointer',
      fontWeight: 700,
      whiteSpace: 'nowrap',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      boxShadow: '0 2px 10px rgba(131,56,236,0.35)'
    }
  }, "\u2728 Busca AI")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setFiltroSegmento('TODOS'),
    style: {
      padding: '6px 14px',
      borderRadius: 20,
      border: '1px solid ' + (filtroSegmento === 'TODOS' ? C.p1 : C.border),
      background: filtroSegmento === 'TODOS' ? C.p1 : 'transparent',
      color: filtroSegmento === 'TODOS' ? '#fff' : C.ink,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600
    }
  }, "TODOS ", leads.length), sortedSegments.map(([seg, count]) => /*#__PURE__*/React.createElement("button", {
    key: seg,
    onClick: () => setFiltroSegmento(seg === filtroSegmento ? 'TODOS' : seg),
    style: {
      padding: '6px 14px',
      borderRadius: 20,
      border: '1px solid ' + (filtroSegmento === seg ? C.p1 : C.border),
      background: filtroSegmento === seg ? 'rgba(255,107,53,0.1)' : 'transparent',
      color: filtroSegmento === seg ? C.p1 : C.ink,
      cursor: 'pointer',
      fontSize: 12,
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", null, segIcons[seg] || '📌'), /*#__PURE__*/React.createElement("span", null, seg), /*#__PURE__*/React.createElement("span", {
    style: {
      background: 'rgba(0,0,0,0.08)',
      borderRadius: 10,
      padding: '1px 6px',
      fontSize: 10,
      fontWeight: 700
    }
  }, count)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setFiltroCategoria('Todas'),
    style: {
      padding: '4px 12px',
      borderRadius: 16,
      border: '1px solid ' + (filtroCategoria === 'Todas' ? C.p1 : C.border),
      background: filtroCategoria === 'Todas' ? C.p1 : 'transparent',
      color: filtroCategoria === 'Todas' ? '#fff' : C.muted,
      cursor: 'pointer',
      fontSize: 11
    }
  }, "Todas ", leads.length), sortedCategories.map(([cat, count]) => /*#__PURE__*/React.createElement("button", {
    key: cat,
    onClick: () => setFiltroCategoria(cat === filtroCategoria ? 'Todas' : cat),
    style: {
      padding: '4px 12px',
      borderRadius: 16,
      border: '1px solid ' + (filtroCategoria === cat ? C.p1 : C.border),
      background: filtroCategoria === cat ? 'rgba(255,107,53,0.08)' : 'transparent',
      color: filtroCategoria === cat ? C.p1 : C.muted,
      cursor: 'pointer',
      fontSize: 11,
      display: 'flex',
      alignItems: 'center',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("span", null, catIcons[cat] || '🔹'), /*#__PURE__*/React.createElement("span", null, cat), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 700
    }
  }, count))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 14,
      padding: 4,
      overflowX: 'auto',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13,
      color: C.ink
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['NOME ↕', 'SEGMENTO ↕', 'CATEGORIA ↕', 'RATING ↕', 'TELEFONE', 'PRIO.', 'STATUS', 'AÇÃO'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '12px 10px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, filtered.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 8,
    style: {
      padding: '30px 10px',
      color: C.muted,
      textAlign: 'center'
    }
  }, "Nenhum lead encontrado.")), filtered.map((l, i) => {
    const sc = statusColor(l.status);
    const pc = prioColor(l.priority);
    const segColor = segColors[(l.segment || '').toUpperCase()] || C.muted;
    const stars = l.rating ? '★'.repeat(Math.min(5, Math.round(Number(l.rating)))) : '';
    return /*#__PURE__*/React.createElement("tr", {
      key: l.id || i,
      style: {
        borderBottom: '1px solid ' + C.border,
        transition: 'background 0.15s'
      },
      onMouseEnter: e => e.currentTarget.style.background = 'rgba(0,0,0,0.02)',
      onMouseLeave: e => e.currentTarget.style.background = 'transparent'
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600,
        color: C.ink
      }
    }, l.name || '—'), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.muted
      }
    }, l.neighborhood || l.city || '—')), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, /*#__PURE__*/React.createElement(StatusBadge, {
      status: (l.segment || '—').toUpperCase(),
      colorMap: LEAD_SEG_COLORS,
      labelMap: {}
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        background: 'rgba(0,0,0,0.06)',
        color: C.ink,
        borderRadius: 6,
        padding: '3px 10px',
        fontSize: 11
      }
    }, l.category || '—')), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: '#f5a623'
      }
    }, stars), /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.ink,
        marginLeft: 4
      }
    }, l.rating ? Number(l.rating).toFixed(1) : '—'), l.review_count != null && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.muted
      }
    }, "(", l.review_count, ")")), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px',
        color: l.phone ? C.p3 : C.muted
      }
    }, l.phone || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: pc
      }
    }, "\u25CF "), /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.ink,
        textTransform: 'capitalize'
      }
    }, l.priority || '—')), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, /*#__PURE__*/React.createElement("select", {
      value: l.status || 'novo',
      onChange: e => updateStatus(l.id, e.target.value),
      style: {
        padding: '4px 8px',
        borderRadius: 6,
        border: '1px solid ' + C.border,
        background: C.bg,
        color: C.ink,
        fontSize: 11,
        outline: 'none',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "novo"
    }, "Novo"), /*#__PURE__*/React.createElement("option", {
      value: "contactado"
    }, "Contactado"), /*#__PURE__*/React.createElement("option", {
      value: "qualificado"
    }, "Qualificado"), /*#__PURE__*/React.createElement("option", {
      value: "convertido"
    }, "Convertido"), /*#__PURE__*/React.createElement("option", {
      value: "perdido"
    }, "Perdido"))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '12px 10px'
      }
    }, l.phone ? /*#__PURE__*/React.createElement("button", {
      onClick: () => openWhatsApp(l.phone, l.name),
      style: {
        background: '#25D366',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        padding: '6px 12px',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap'
      }
    }, /*#__PURE__*/React.createElement("span", null, "\uD83D\uDCF1"), " WhatsApp") : /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted
      }
    }, "\u2014")));
  })))), /*#__PURE__*/React.createElement(AiSearchModal, {
    open: aiModalOpen,
    onClose: () => setAiModalOpen(false),
    onResults: fetchLeads,
    existingLeads: leads
  }));
};

// Status de orcamento — novo ciclo:
// pending -> rascunho -> enviado -> aprovado -> em_execucao -> concluido (+ recusado)
// Legacy: accepted/completed/rejected mantidos como sinonimos.
const QUOTE_STATUS = {
  pending: {
    label: 'Aguardando',
    cat: 'pending'
  },
  rascunho: {
    label: 'Rascunho',
    cat: 'pending'
  },
  enviado: {
    label: 'Enviado',
    cat: 'progress'
  },
  aprovado: {
    label: 'Aprovado',
    cat: 'progress'
  },
  em_execucao: {
    label: 'Em execução',
    cat: 'progress'
  },
  concluido: {
    label: 'Concluído',
    cat: 'done'
  },
  recusado: {
    label: 'Recusado',
    cat: 'rejected'
  },
  // Legacy / backward compat
  accepted: {
    label: 'Aceito',
    cat: 'progress'
  },
  completed: {
    label: 'Concluído',
    cat: 'done'
  },
  rejected: {
    label: 'Rejeitado',
    cat: 'rejected'
  }
};
const quoteStatusInfo = s => QUOTE_STATUS[s] || {
  label: s || '—',
  cat: 'pending'
};
// Cores por categoria: verde p/ concluido, azul p/ em andamento, cinza p/ pendente, vermelho p/ recusado
const QUOTE_STATUS_COLORS = {
  done: {
    bg: C.p6 + '22',
    fg: C.p6
  },
  // verde
  progress: {
    bg: C.p3 + '22',
    fg: C.p3
  },
  // azul/turquesa
  pending: {
    bg: C.p7 + '44',
    fg: '#b8860b'
  },
  // amarelo/cinza
  rejected: {
    bg: C.p4 + '22',
    fg: C.p4
  } // vermelho
};
const quoteStatusStyle = s => {
  const info = quoteStatusInfo(s);
  const col = QUOTE_STATUS_COLORS[info.cat] || QUOTE_STATUS_COLORS.pending;
  return {
    background: col.bg,
    color: col.fg,
    borderRadius: 8,
    padding: '3px 10px',
    fontSize: 11
  };
};
// Mantido por compat: STATUS_MAP[status] devolve so o label.
const STATUS_MAP = Object.fromEntries(Object.entries(QUOTE_STATUS).map(([k, v]) => [k, v.label]));
const Orcamentos = () => {
  const {
    data,
    loading
  } = useSupabaseQuery(sb => sb.from('quotes').select('*, client:profiles!client_id(name), painter:profiles!painter_id(name)').order('created_at', {
    ascending: false
  }), []);
  const orcamentos = data || [];
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando or\xE7amentos...");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDCCB Or\xE7amentos"), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Cliente', 'Pintor', 'Serviço', 'Valor', 'Status', 'Data'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, orcamentos.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: 6,
    style: {
      padding: '20px 12px',
      color: C.muted,
      textAlign: 'center'
    }
  }, "Nenhum or\xE7amento encontrado.")), orcamentos.map((o, i) => {
    const stInfo = quoteStatusInfo(o.status);
    const data = o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    }) : '—';
    return /*#__PURE__*/React.createElement("tr", {
      key: o.id || i,
      style: {
        borderBottom: '1px solid ' + C.border
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, o.client?.name || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, o.painter?.name || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, o.service_type || o.title || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 700
      }
    }, o.price != null ? 'R$ ' + Number(o.price).toLocaleString('pt-BR') : '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: quoteStatusStyle(o.status)
    }, stInfo.label)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, data));
  }))));
};
const ClientesList = () => {
  const {
    data,
    loading,
    refetch: fetchClientes
  } = useSupabaseQuery(async sb => {
    const profiles = await profilesService.list({
      clienteOnly: true,
      order: 'created_at',
      ascending: false
    });
    // Load invite codes generated by each user
    const {
      data: invites
    } = await sb.from('invites').select('code, created_by').order('created_at', {
      ascending: false
    });
    const inviteMap = {};
    (invites || []).forEach(inv => {
      if (!inviteMap[inv.created_by]) inviteMap[inv.created_by] = [];
      inviteMap[inv.created_by].push(inv.code);
    });
    return profiles.map(p => ({
      ...p,
      _generated_codes: inviteMap[p.id] || []
    }));
  }, []);
  const clientes = data || [];
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando clientes...");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDC65 Clientes Cadastrados (", clientes.length, ")"), /*#__PURE__*/React.createElement(CreateAppUserForm, {
    onCreated: fetchClientes,
    defaultRole: "cliente"
  }), clientes.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum cliente cadastrado."), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13,
      minWidth: 800
    }
  }, clientes.length > 0 && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Nome', 'Tipo', '@Tag', 'Email', 'Cidade', 'Estado', 'Cadastro', 'Codigo Gerado', 'Codigo Utilizado', 'PRO', 'Portal'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, clientes.map((c, i) => {
    const data = c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }) : '—';
    return /*#__PURE__*/React.createElement("tr", {
      key: c.id || i,
      style: {
        borderBottom: '1px solid ' + C.border
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(AvatarCell, {
      name: c.name,
      avatarUrl: c.avatar_url,
      size: 32
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600
      }
    }, c.name || 'Sem nome'))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement(RoleSelect, {
      profile: c,
      after: fetchClientes
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.p3,
        fontWeight: 600
      }
    }, c.tag ? '@' + c.tag : '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, c.email || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, c.city || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, c.state || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, data), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1
      }
    }, c._generated_codes && c._generated_codes.length > 0 ? c._generated_codes.join(', ') : '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 1
      }
    }, c.invite_code_used || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement(ProBadgeCell, {
      profile: c,
      onChange: fetchClientes
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement(PortalAccessCell, {
      profile: c,
      onChange: fetchClientes
    })));
  })))));
};
const PostsModeracao = () => {
  const [filter, setFilter] = useState('pending');
  const {
    data,
    loading,
    refetch: fetchPosts
  } = useSupabaseQuery(sb => {
    let query = sb.from('posts').select('*, profiles!user_id(name, tag, avatar_url, role)').order('created_at', {
      ascending: false
    }).limit(50);
    if (filter === 'pending') query = query.eq('status', 'pending');else if (filter === 'rejected') query = query.eq('status', 'rejected');
    return query;
  }, [filter]);
  const posts = data || [];
  const updateStatus = async (id, status) => {
    try {
      await postsService.setStatus(id, status);
      fetchPosts();
    } catch (e) {
      alert('Erro ao atualizar post: ' + (e.message || e));
    }
  };
  const deletePost = async id => {
    if (!confirm('Deletar permanentemente?')) return;
    try {
      await postsService.deleteWithChildren(id);
      fetchPosts();
    } catch (e) {
      alert('Erro ao deletar post: ' + (e.message || e));
    }
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginBottom: 16
    }
  }, ['pending', 'rejected', 'all'].map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setFilter(f),
    style: {
      padding: '8px 16px',
      borderRadius: 8,
      border: filter === f ? '2px solid ' + C.p1 : '1.5px solid ' + C.border,
      background: filter === f ? 'rgba(255,107,53,0.08)' : '#fff',
      color: filter === f ? C.p1 : C.ink,
      fontWeight: 700,
      fontSize: 12,
      cursor: 'pointer'
    }
  }, f === 'pending' ? '⏳ Pendentes' : f === 'rejected' ? '❌ Rejeitados' : '📋 Todos'))), loading && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      padding: 20
    }
  }, "Carregando..."), !loading && posts.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      padding: 20,
      textAlign: 'center'
    }
  }, "Nenhum post ", filter === 'pending' ? 'pendente' : 'encontrado', " \uD83C\uDF89"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))',
      gap: 12
    }
  }, posts.map(p => {
    const prof = p.profiles || {};
    const isVideo = p.media_url && (p.media_url.includes('.mp4') || p.media_type === 'video');
    return /*#__PURE__*/React.createElement("div", {
      key: p.id,
      style: {
        background: C.white,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
        border: p.status === 'pending' ? '2px solid #f0ad4e' : p.status === 'rejected' ? '2px solid #e74c3c' : '1px solid ' + C.border
      }
    }, p.media_url && (isVideo ? /*#__PURE__*/React.createElement("video", {
      src: p.media_url,
      controls: true,
      style: {
        width: '100%',
        maxHeight: 200,
        objectFit: 'cover'
      }
    }) : /*#__PURE__*/React.createElement("img", {
      src: p.media_url,
      style: {
        width: '100%',
        maxHeight: 200,
        objectFit: 'cover'
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: prof.avatar_url || 'https://ui-avatars.com/api/?name=U&size=32',
      style: {
        width: 28,
        height: 28,
        borderRadius: '50%',
        objectFit: 'cover'
      }
    }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700
      }
    }, prof.name || 'User'), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.muted
      }
    }, prof.tag ? '@' + prof.tag : '', " \xB7 ", prof.role || 'cliente')), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto'
      }
    }, /*#__PURE__*/React.createElement(StatusBadge, {
      status: p.status || 'pending',
      colorMap: POSTS_STATUS_COLORS,
      labelMap: POSTS_STATUS_LABELS
    }))), p.caption && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: C.ink,
        marginBottom: 8
      }
    }, p.caption), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.muted,
        marginBottom: 10
      }
    }, new Date(p.created_at).toLocaleString('pt-BR')), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 6
      }
    }, p.status !== 'approved' && /*#__PURE__*/React.createElement("button", {
      onClick: () => updateStatus(p.id, 'approved'),
      style: {
        flex: 1,
        padding: '6px 10px',
        background: '#28a745',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer'
      }
    }, "\u2713 Aprovar"), p.status !== 'rejected' && /*#__PURE__*/React.createElement("button", {
      onClick: () => updateStatus(p.id, 'rejected'),
      style: {
        flex: 1,
        padding: '6px 10px',
        background: '#ffc107',
        color: '#333',
        border: 'none',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer'
      }
    }, "\u2717 Rejeitar"), /*#__PURE__*/React.createElement("button", {
      "aria-label": "Excluir post",
      onClick: () => deletePost(p.id),
      style: {
        padding: '6px 10px',
        background: '#dc3545',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer'
      }
    }, "\uD83D\uDDD1"))));
  })));
};
const AvaliacoesList = () => {
  const {
    data,
    loading
  } = useSupabaseQuery(sb => sb.from('quotes').select('*, client:profiles!client_id(name, rating_avg), painter:profiles!painter_id(name, rating_avg)').order('created_at', {
    ascending: false
  }), []);
  const quotes = data || [];
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando avalia\xE7\xF5es...");
  const rated = quotes.filter(q => q.painter?.rating_avg != null || q.client?.rating_avg != null);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\u2B50 Avalia\xE7\xF5es \u2014 Pintores"), quotes.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum or\xE7amento encontrado para avaliar."), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, quotes.length > 0 && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Pintor', 'Nota Média', 'Cliente', 'Serviço', 'Status', 'Data'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, quotes.map((q, i) => {
    const st = STATUS_MAP[q.status] || q.status;
    const data = q.created_at ? new Date(q.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit'
    }) : '—';
    const rating = q.painter?.rating_avg;
    return /*#__PURE__*/React.createElement("tr", {
      key: q.id || i,
      style: {
        borderBottom: '1px solid ' + C.border
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 600
      }
    }, q.painter?.name || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, rating != null ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.p1
      }
    }, '★'.repeat(Math.round(Number(rating))), '☆'.repeat(5 - Math.round(Number(rating))), " ", Number(rating).toFixed(1)) : /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted
      }
    }, "\u2014")), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, q.client?.name || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, q.service_type || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        background: st === 'aceito' ? C.p6 + '22' : st === 'pendente' ? C.p7 + '44' : st === 'concluido' ? C.p3 + '22' : C.p4 + '22',
        color: st === 'aceito' ? C.p6 : st === 'pendente' ? '#b8860b' : st === 'concluido' ? C.p3 : C.p4,
        borderRadius: 8,
        padding: '3px 10px',
        fontSize: 11
      }
    }, st)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, data));
  })))));
};
const CursosList = () => {
  const {
    data,
    loading
  } = useSupabaseQuery(sb => sb.from('profiles').select('id, name, city, state, verified, rating_avg').order('rating_avg', {
    ascending: false
  }), []);
  const profiles = (data || []).filter(p => p.verified);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando cursos...");
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 8,
      color: C.ink
    }
  }, "\uD83D\uDCDA Cursos \u2014 Pintores Verificados"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: C.muted,
      marginBottom: 16
    }
  }, "Pintores verificados podem criar e vender cursos na plataforma."), profiles.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum pintor verificado ainda. Aprove pintores na se\xE7\xE3o Pintores para habilitar cursos."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16
    }
  }, profiles.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: p.id || i,
    style: {
      background: C.bg,
      borderRadius: 12,
      padding: 16,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      borderRadius: '50%',
      background: C.p1 + '22',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      color: C.p1,
      fontSize: 14
    }
  }, (p.name || '?')[0]), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 13
    }
  }, p.name || 'Sem nome'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.muted
    }
  }, [p.city, p.state].filter(Boolean).join(', ')))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.p1
    }
  }, "\u2B50 ", p.rating_avg != null ? Number(p.rating_avg).toFixed(1) : '—'), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.p6 + '22',
      color: C.p6,
      borderRadius: 8,
      padding: '3px 10px',
      fontSize: 11,
      fontWeight: 600,
      display: 'inline-block',
      marginTop: 8
    }
  }, "\u2713 Verificado"))))));
};
const MarketingPage = () => {
  const {
    data,
    loading
  } = useSupabaseQuery(async sb => {
    const [pRes, lRes, qRes] = await Promise.all([sb.from('profiles').select('id', {
      count: 'exact',
      head: true
    }), sb.from('leads').select('id', {
      count: 'exact',
      head: true
    }), sb.from('quotes').select('id', {
      count: 'exact',
      head: true
    })]);
    return {
      data: {
        profiles: pRes.count || 0,
        leads: lRes.count || 0,
        quotes: qRes.count || 0
      }
    };
  }, []);
  const stats = data || {
    profiles: 0,
    leads: 0,
    quotes: 0
  };
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando marketing...");
  const convRate = stats.profiles > 0 ? (stats.quotes / stats.profiles * 100).toFixed(1) : '0';
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(KPICard, {
    title: "Alcance (Perfis)",
    value: stats.profiles,
    sub: "base total",
    trend: "",
    color: C.p3
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Leads Captados",
    value: stats.leads,
    sub: "funil de entrada",
    trend: "",
    color: C.p5
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Taxa de Convers\xE3o",
    value: convRate + '%',
    sub: "perfis \u2192 or\xE7amentos",
    trend: "",
    color: C.p1
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 12,
      color: C.ink
    }
  }, "\uD83D\uDCE3 Funil de Marketing"), [{
    label: 'Perfis cadastrados',
    value: stats.profiles,
    pct: 100
  }, {
    label: 'Leads captados',
    value: stats.leads,
    pct: stats.profiles ? Math.round(stats.leads / stats.profiles * 100) : 0
  }, {
    label: 'Orçamentos gerados',
    value: stats.quotes,
    pct: stats.profiles ? Math.round(stats.quotes / stats.profiles * 100) : 0
  }].map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, s.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 700
    }
  }, s.value)), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.border,
      borderRadius: 4,
      height: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.p1,
      height: 8,
      borderRadius: 4,
      width: Math.min(Math.max(s.pct, 2), 100) + '%'
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 12,
      color: C.ink
    }
  }, "\uD83D\uDCA1 Insights"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: C.ink,
      lineHeight: 1.8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 0',
      borderBottom: '1px solid ' + C.border
    }
  }, "\uD83D\uDCCA ", /*#__PURE__*/React.createElement("b", null, stats.profiles), " perfis na base"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 0',
      borderBottom: '1px solid ' + C.border
    }
  }, "\uD83E\uDDF2 ", /*#__PURE__*/React.createElement("b", null, stats.leads), " leads captados"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 0',
      borderBottom: '1px solid ' + C.border
    }
  }, "\uD83D\uDCCB ", /*#__PURE__*/React.createElement("b", null, stats.quotes), " or\xE7amentos solicitados"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 0'
    }
  }, "\uD83D\uDCC8 Taxa de convers\xE3o: ", /*#__PURE__*/React.createElement("b", null, convRate, "%"))))));
};

// ══ AVISOS (Announcements) ══
const Avisos = () => {
  const {
    data,
    loading,
    refetch: loadAvisos
  } = useSupabaseQuery(sb => sb.from('announcements').select('*').order('created_at', {
    ascending: false
  }), []);
  const avisos = data || [];
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const saveAviso = async () => {
    if (!title.trim()) {
      alert('Preencha o titulo');
      return;
    }
    if (!message.trim()) {
      alert('Preencha a mensagem');
      return;
    }
    setSaving(true);
    try {
      const {
        data: {
          session
        }
      } = await supa.auth.getSession();
      await announcementsService.insert({
        title: title.trim(),
        message: message.trim(),
        active: true,
        created_by: session?.user?.id || null,
        created_at: new Date().toISOString()
      });
      setTitle('');
      setMessage('');
      loadAvisos();
    } catch (e) {
      alert('Erro: ' + (e.message || 'tente novamente'));
    }
    setSaving(false);
  };
  const toggleAviso = async (id, active) => {
    try {
      // active recebido eh o estado atual; toggle = !active
      await announcementsService.toggle(id, !active);
      loadAvisos();
    } catch (e) {
      console.warn('toggleAviso error:', e);
    }
  };
  const deleteAviso = async id => {
    if (!confirm('Tem certeza que deseja excluir este aviso?')) return;
    try {
      await announcementsService.remove(id);
      loadAvisos();
    } catch (e) {
      console.warn('deleteAviso error:', e);
    }
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDCE2 Criar Novo Aviso"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 4
    }
  }, "Titulo"), /*#__PURE__*/React.createElement("input", {
    value: title,
    onChange: e => setTitle(e.target.value),
    placeholder: "Ex: Promocao de tintas",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 4
    }
  }, "Mensagem"), /*#__PURE__*/React.createElement("textarea", {
    value: message,
    onChange: e => setMessage(e.target.value),
    placeholder: "Escreva o conteudo do aviso...",
    rows: 3,
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none',
      resize: 'vertical',
      fontFamily: 'DM Sans, sans-serif'
    }
  })), /*#__PURE__*/React.createElement("button", {
    disabled: saving,
    onClick: saveAviso,
    style: {
      padding: '10px 24px',
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      fontSize: 14,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, saving ? 'Salvando...' : 'Publicar Aviso'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.muted,
      marginTop: 8
    }
  }, "Este aviso aparecera na aba de notificacoes do app para todos os usuarios.")), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "Avisos Publicados"), loading && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Carregando..."), !loading && avisos.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum aviso publicado ainda."), avisos.map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    style: {
      borderBottom: '1px solid ' + C.border,
      padding: '14px 0',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 24
    }
  }, a.active ? '📢' : '🔇'), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      fontSize: 14,
      color: a.active ? C.ink : C.muted
    }
  }, a.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: '#555',
      marginTop: 2
    }
  }, a.message), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: C.muted,
      marginTop: 4
    }
  }, a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }) : '')), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => toggleAviso(a.id, a.active),
    style: {
      background: a.active ? C.p7 + '33' : C.p6 + '33',
      border: 'none',
      borderRadius: 8,
      padding: '4px 10px',
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
      color: a.active ? '#b8860b' : C.p6
    }
  }, a.active ? 'Desativar' : 'Ativar'), /*#__PURE__*/React.createElement("button", {
    onClick: () => deleteAviso(a.id),
    style: {
      background: C.p4 + '22',
      border: 'none',
      borderRadius: 8,
      padding: '4px 10px',
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
      color: C.p4
    }
  }, "Excluir"))))));
};

// ══ PEDIDOS DA LOJA (Orders) ══
const PedidosLoja = () => {
  // Busca em 2 passos (sem embed PostgREST `profiles!user_id`): a FK de
  // orders.user_id aponta pra auth.users, não pra profiles, então o embed
  // quebrava a query inteira e a tela ficava "Nenhum pedido recebido".
  // RLS (orders_admin_view = is_portal_admin) continua filtrando.
  const {
    data,
    loading,
    refetch
  } = useSupabaseQuery(async sb => {
    const {
      data: rows,
      error
    } = await sb.from('orders').select('*').order('created_at', {
      ascending: false
    });
    if (error) return {
      error
    };
    const list = rows || [];
    const userIds = [...new Set(list.map(o => o.user_id).filter(Boolean))];
    const pmap = {};
    if (userIds.length) {
      const {
        data: profs
      } = await sb.from('profiles').select('id, name, phone, city, state, tag').in('id', userIds);
      (profs || []).forEach(p => {
        pmap[p.id] = p;
      });
    }
    return {
      data: list.map(o => ({
        ...o,
        user: pmap[o.user_id] || null
      }))
    };
  }, []);
  const orders = data || [];
  const [detailOrder, setDetailOrder] = React.useState(null);
  const brl = n => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',');
  const updateOrderStatus = async (id, status) => {
    try {
      await ordersService.updateStatus(id, status);
      refetch();
    } catch (e) {
      alert('Não foi possível atualizar o pedido: ' + (e.message || e));
      console.warn('updateOrderStatus error:', e);
    }
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDED2 Pedidos da Loja"), loading && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Carregando pedidos..."), !loading && orders.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum pedido recebido ainda."), /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, orders.length > 0 && /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Cliente', 'Telefone', 'Itens', 'Total', 'Status', 'Data', 'Acoes'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, orders.map((o, i) => {
    const user = o.user || {};
    const items = o.items || [];
    const st = o.status || 'pending';
    const data = o.created_at ? new Date(o.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }) : '';
    return /*#__PURE__*/React.createElement("tr", {
      key: o.id || i,
      onClick: () => setDetailOrder(o),
      style: {
        borderBottom: '1px solid ' + C.border,
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 600
      }
    }, user.name || '—', user.tag ? ' @' + user.tag : ''), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, user.phone || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        maxWidth: 280
      }
    }, items.length ? items.map((it, idx) => /*#__PURE__*/React.createElement("div", {
      key: idx,
      style: {
        lineHeight: 1.35
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600
      }
    }, Number(it.qty) || 1, "\xD7"), " ", it.name || 'Item', it.volume ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted
      }
    }, " \xB7 ", it.volume) : null)) : '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 700,
        color: C.p1
      }
    }, "R$", Number(o.total || 0).toFixed(2).replace('.', ',')), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement(StatusBadge, {
      status: st,
      colorMap: ORDERS_STATUS_COLORS,
      labelMap: ORDERS_STATUS_LABELS
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted
      }
    }, data), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      },
      onClick: e => e.stopPropagation()
    }, /*#__PURE__*/React.createElement("select", {
      value: st,
      onChange: e => updateOrderStatus(o.id, e.target.value),
      style: {
        padding: '4px 8px',
        borderRadius: 8,
        border: '1px solid ' + C.border,
        fontSize: 12,
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "pending"
    }, "Aguardando"), /*#__PURE__*/React.createElement("option", {
      value: "processing"
    }, "Em andamento"), /*#__PURE__*/React.createElement("option", {
      value: "shipped"
    }, "Enviado"), /*#__PURE__*/React.createElement("option", {
      value: "completed"
    }, "Concluido"), /*#__PURE__*/React.createElement("option", {
      value: "canceled"
    }, "Cancelado"))));
  }))))), detailOrder && (() => {
    const o = detailOrder;
    const u = o.user || {};
    const its = o.items || [];
    const st = o.status || 'pending';
    const dt = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR') : '—';
    const hasPay = o.gateway || o.tx_id || o.paid_at || o.paid_amount != null;
    const sec = {
      fontWeight: 700,
      fontSize: 12,
      textTransform: 'uppercase',
      color: C.muted,
      margin: '16px 0 6px',
      letterSpacing: 0.4
    };
    const row = (label, val) => /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '4px 0',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted
      }
    }, label), /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 600,
        textAlign: 'right'
      }
    }, val));
    return /*#__PURE__*/React.createElement("div", {
      role: "dialog",
      "aria-modal": "true",
      onClick: () => setDetailOrder(null),
      style: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: e => e.stopPropagation(),
      style: {
        background: C.white,
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 520,
        maxHeight: '85vh',
        overflowY: 'auto',
        boxShadow: '0 10px 40px rgba(0,0,0,0.25)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        fontSize: 16,
        color: C.ink
      }
    }, "\uD83D\uDED2 Pedido #", String(o.id || '').slice(0, 8)), /*#__PURE__*/React.createElement("button", {
      onClick: () => setDetailOrder(null),
      "aria-label": "Fechar",
      style: {
        border: 'none',
        background: 'transparent',
        fontSize: 24,
        cursor: 'pointer',
        color: C.muted,
        lineHeight: 1
      }
    }, "\xD7")), /*#__PURE__*/React.createElement("div", {
      style: sec
    }, "Cliente"), row('Nome', (u.name || '—') + (u.tag ? ' @' + u.tag : '')), row('Telefone', u.phone || '—'), row('Cidade/UF', [u.city, u.state].filter(Boolean).join('/') || '—'), /*#__PURE__*/React.createElement("div", {
      style: sec
    }, "Itens"), its.length ? its.map((it, idx) => {
      const q = Number(it.qty) || 1;
      const unit = Number(it.price) || 0;
      return /*#__PURE__*/React.createElement("div", {
        key: idx,
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          padding: '6px 0',
          borderBottom: '1px solid ' + C.border,
          fontSize: 13
        }
      }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
        style: {
          fontWeight: 600
        }
      }, q, "\xD7"), " ", it.name || 'Item', it.volume ? /*#__PURE__*/React.createElement("span", {
        style: {
          color: C.muted
        }
      }, " \xB7 ", it.volume) : null), /*#__PURE__*/React.createElement("span", {
        style: {
          whiteSpace: 'nowrap',
          textAlign: 'right'
        }
      }, brl(unit), " ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: C.muted,
          fontSize: 11
        }
      }, "= ", brl(unit * q))));
    }) : /*#__PURE__*/React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 13
      }
    }, "\u2014"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '10px 0',
        fontWeight: 700,
        fontSize: 15
      }
    }, /*#__PURE__*/React.createElement("span", null, "Total"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.p1
      }
    }, brl(o.total))), /*#__PURE__*/React.createElement("div", {
      style: sec
    }, "Pedido"), row('Data', dt), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '4px 0'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted,
        fontSize: 13
      }
    }, "Status"), /*#__PURE__*/React.createElement("select", {
      value: st,
      onChange: e => {
        updateOrderStatus(o.id, e.target.value);
        setDetailOrder(null);
      },
      style: {
        padding: '4px 8px',
        borderRadius: 8,
        border: '1px solid ' + C.border,
        fontSize: 12,
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement("option", {
      value: "pending"
    }, "Aguardando"), /*#__PURE__*/React.createElement("option", {
      value: "processing"
    }, "Em andamento"), /*#__PURE__*/React.createElement("option", {
      value: "shipped"
    }, "Enviado"), /*#__PURE__*/React.createElement("option", {
      value: "completed"
    }, "Concluido"), /*#__PURE__*/React.createElement("option", {
      value: "canceled"
    }, "Cancelado"))), /*#__PURE__*/React.createElement("div", {
      style: sec
    }, "Pagamento"), hasPay ? /*#__PURE__*/React.createElement(React.Fragment, null, row('Gateway', o.gateway || '—'), row('Transação', o.tx_id || '—'), row('Valor pago', o.paid_amount != null ? brl(o.paid_amount) : '—'), row('Método', o.payment_method || '—'), row('Pago em', o.paid_at ? new Date(o.paid_at).toLocaleString('pt-BR') : '—'), o.receipt_url ? /*#__PURE__*/React.createElement("a", {
      href: o.receipt_url,
      target: "_blank",
      rel: "noreferrer",
      style: {
        color: C.p1,
        fontSize: 13
      }
    }, "Ver comprovante") : null) : /*#__PURE__*/React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 13,
        fontStyle: 'italic'
      }
    }, "Aguardando pagamento / contato (pagamento online ainda n\xE3o ativado)."), /*#__PURE__*/React.createElement("div", {
      style: sec
    }, "Entrega"), /*#__PURE__*/React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 13,
        fontStyle: 'italic'
      }
    }, o.shipping_address || 'Endereço não informado (captura no checkout ainda não implementada).')));
  })());
};
const PortalUsersList = () => {
  const {
    data,
    loading,
    refetch: fetchUsers
  } = useSupabaseQuery(() => profilesService.list({
    portalOnly: true,
    order: 'created_at',
    ascending: false
  }), []);
  const users = data || [];
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: ''
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');
  const createUser = async () => {
    setFormError('');
    setFormMsg('');
    const name = form.name.trim(),
      email = form.email.trim(),
      password = form.password;
    if (!email || !password) {
      setFormError('Email e senha sao obrigatorios');
      return;
    }
    if (password.length < 8) {
      setFormError('Senha deve ter no minimo 8 caracteres');
      return;
    }
    setSaving(true);
    try {
      const tag = (email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_.]/g, '') + '_' + Math.random().toString(36).slice(2, 7);
      const res = await authService.signUpAppUser({
        name: name || email,
        email,
        password,
        role: 'admin',
        portalAccess: true,
        userMetadata: {
          role: 'admin',
          tag
        },
        extraProfile: {
          email,
          tag
        }
      });
      if (!res.ok) {
        setFormError(res.error || 'Erro ao criar usuario');
        return;
      }
      setFormMsg('Usuario criado com sucesso. Ele ja pode entrar no portal com essas credenciais.');
      setForm({
        name: '',
        email: '',
        password: ''
      });
      setShowForm(false);
      fetchUsers();
    } catch (e) {
      setFormError(e.message || 'Erro ao criar usuario');
    } finally {
      setSaving(false);
    }
  };
  const revokeAccess = async id => {
    if (!confirm('Remover o acesso ao portal deste usuario?')) return;
    if (await adminUsers({
      action: 'revoke',
      userId: id
    })) fetchUsers();
  };
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando usuarios do portal...");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: C.ink
    }
  }, "\uD83D\uDD10 Usuarios com acesso ao Portal (", users.length, ")"), /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      setShowForm(!showForm);
      setFormError('');
      setFormMsg('');
    },
    style: {
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '8px 16px',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 700
    }
  }, showForm ? 'Cancelar' : '+ Criar usuario')), showForm && /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.cream,
      borderRadius: 12,
      padding: 16,
      marginBottom: 20,
      border: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: C.ink,
      marginBottom: 12,
      fontSize: 14
    }
  }, "Criar novo usuario do portal"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Nome"), /*#__PURE__*/React.createElement("input", {
    value: form.name,
    onChange: e => setForm({
      ...form,
      name: e.target.value
    }),
    placeholder: "Nome (opcional)",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    value: form.email,
    onChange: e => setForm({
      ...form,
      email: e.target.value
    }),
    placeholder: "email@exemplo.com",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12,
      maxWidth: '50%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Senha"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: form.password,
    onChange: e => setForm({
      ...form,
      password: e.target.value
    }),
    placeholder: "Minimo 6 caracteres",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), formError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#e63946',
      fontSize: 13,
      marginBottom: 10
    }
  }, formError), /*#__PURE__*/React.createElement("button", {
    disabled: saving,
    onClick: createUser,
    style: {
      background: C.p6,
      color: '#fff',
      border: 'none',
      borderRadius: 10,
      padding: '10px 20px',
      cursor: saving ? 'wait' : 'pointer',
      fontSize: 13,
      fontWeight: 700
    }
  }, saving ? 'Criando...' : 'Criar usuario')), formMsg && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#2e7d32',
      fontSize: 13,
      marginBottom: 16,
      background: C.p6 + '15',
      padding: '10px 14px',
      borderRadius: 10
    }
  }, formMsg), users.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum usuario com acesso ao portal."), users.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      overflowX: 'auto'
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13,
      minWidth: 600
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Nome', 'Email', 'Papel', 'PRO', 'Criado em', 'Acoes'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, users.map(u => /*#__PURE__*/React.createElement("tr", {
    key: u.id,
    style: {
      borderBottom: '1px solid ' + C.border
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(AvatarCell, {
    name: u.name,
    avatarUrl: u.avatar_url,
    size: 32
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 600
    }
  }, u.name || 'Sem nome'))), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px',
      color: C.muted,
      fontSize: 12
    }
  }, u.email || '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      background: C.p5 + '22',
      color: C.p5,
      borderRadius: 6,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600
    }
  }, u.role || u.user_type || 'admin')), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement(ProBadgeCell, {
    profile: u,
    onChange: fetchUsers
  })), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px',
      color: C.muted,
      fontSize: 12
    }
  }, u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => revokeAccess(u.id),
    style: {
      background: 'none',
      border: '1px solid ' + C.border,
      borderRadius: 6,
      padding: '4px 10px',
      cursor: 'pointer',
      fontSize: 11,
      color: C.p4
    }
  }, "Revogar acesso"))))))));
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
      let q = supa.from('reports').select('id, reporter_id, post_id, target_user_id, reason, status, created_at, reporter:profiles!reporter_id(name, avatar_url)').order('created_at', {
        ascending: false
      }).limit(200);
      if (filter !== 'all') q = q.eq('status', filter);
      const {
        data,
        error: err
      } = await q;
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
  useEffect(() => {
    fetchReports();
  }, [filter]);
  const resolveReport = async id => {
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
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: C.ink
    }
  }, "\uD83D\uDEE1\uFE0F Modera\xE7\xE3o \u2014 Den\xFAncias"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8
    }
  }, ['pending', 'resolved', 'dismissed', 'all'].map(f => /*#__PURE__*/React.createElement("button", {
    key: f,
    onClick: () => setFilter(f),
    style: {
      padding: '6px 14px',
      borderRadius: 20,
      border: '1px solid ' + (filter === f ? C.p1 : C.border),
      background: filter === f ? C.p1 : 'transparent',
      color: filter === f ? '#fff' : C.ink,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 600
    }
  }, f === 'pending' ? 'Pendentes' : f === 'resolved' ? 'Resolvidas' : f === 'dismissed' ? 'Descartadas' : 'Todas')))), loading && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      padding: 20
    }
  }, "Carregando den\xFAncias..."), !loading && tableMissing && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      padding: 20,
      textAlign: 'center'
    }
  }, "Sem den\xFAncias"), !loading && !tableMissing && reports.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      padding: 20,
      textAlign: 'center'
    }
  }, "Sem den\xFAncias"), !loading && !tableMissing && reports.length > 0 && /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['ID', 'Denunciante', 'Alvo', 'Motivo', 'Status', 'Data', 'Ações'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, reports.map(r => {
    const data = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }) + ' ' + new Date(r.created_at).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    }) : '—';
    const targetType = r.post_id ? 'post' : r.target_user_id ? 'usuário' : '—';
    const targetId = r.post_id || r.target_user_id || '—';
    const targetIdShort = typeof targetId === 'string' && targetId.length > 8 ? targetId.slice(0, 8) + '…' : targetId;
    const idShort = r.id ? String(r.id).slice(0, 8) + '…' : '—';
    const st = r.status || 'pending';
    return /*#__PURE__*/React.createElement("tr", {
      key: r.id,
      style: {
        borderBottom: '1px solid ' + C.border
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted,
        fontSize: 11,
        fontFamily: 'monospace'
      }
    }, idShort), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, r.reporter?.name || (r.reporter_id ? String(r.reporter_id).slice(0, 8) + '…' : '—')), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 600
      }
    }, targetType), /*#__PURE__*/React.createElement("div", {
      style: {
        color: C.muted,
        fontSize: 11,
        fontFamily: 'monospace'
      }
    }, targetIdShort)), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontSize: 12,
        maxWidth: 240
      }
    }, r.reason || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement(StatusBadge, {
      status: st,
      colorMap: REPORTS_STATUS_COLORS,
      labelMap: REPORTS_STATUS_LABELS
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted,
        fontSize: 12
      }
    }, data), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, st === 'pending' ? /*#__PURE__*/React.createElement("button", {
      onClick: () => resolveReport(r.id),
      style: {
        background: C.p6,
        border: 'none',
        color: '#fff',
        borderRadius: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: 11,
        fontWeight: 700
      }
    }, "Resolver") : /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted,
        fontSize: 11
      }
    }, "\u2014")));
  })))));
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
        const [refsRes, ptsRes] = await Promise.all([sb.from('referrals').select('id, referrer_id, referred_id, status, bonus_points, created_at, referrer:profiles!referrer_id(name, avatar_url), referred:profiles!referred_id(name, avatar_url)').order('created_at', {
          ascending: false
        }).limit(500), sb.from('points').select('amount, user_id, type')]);
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
          if (!counts[r.referrer_id]) counts[r.referrer_id] = {
            id: r.referrer_id,
            name: r.referrer?.name || '—',
            count: 0,
            bonus: 0
          };
          counts[r.referrer_id].count += 1;
          counts[r.referrer_id].bonus += Number(r.bonus_points) || 0;
        });
        const top = Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
        setTopReferrers(top);
      } catch (e) {
        console.warn('Indicacoes load error:', e);
        setReferrals([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando indica\xE7\xF5es...");
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(KPICard, {
    title: "Total de Indica\xE7\xF5es",
    value: referrals.length,
    sub: "hist\xF3rico completo",
    trend: "\uD83D\uDD17",
    color: C.p1
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Pontos Creditados",
    value: pointsTotal.toLocaleString('pt-BR'),
    sub: "soma de todos os pontos",
    trend: "\u2B50",
    color: C.p7
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "Indicadores \xDAnicos",
    value: topReferrers.length,
    sub: "pessoas que indicaram",
    trend: "\uD83D\uDC65",
    color: C.p5
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 12,
      color: C.ink
    }
  }, "\uD83C\uDFC6 Top 5 Indicadores"), topReferrers.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhum indicador ainda."), topReferrers.map((t, i) => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 0',
      borderBottom: i < topReferrers.length - 1 ? '1px solid ' + C.border : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: C.p1 + '22',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      fontSize: 13,
      color: C.p1
    }
  }, i + 1), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontWeight: 600,
      fontSize: 13
    }
  }, t.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted
    }
  }, t.count, " indica\xE7", t.count === 1 ? 'ão' : 'ões'), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.p7,
      fontWeight: 700,
      minWidth: 80,
      textAlign: 'right'
    }
  }, "+", t.bonus, " pts")))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\uD83D\uDD17 Indica\xE7\xF5es"), referrals.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhuma indica\xE7\xE3o registrada."), referrals.length > 0 && /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Indicador', 'Indicado', 'Status', 'Pontos', 'Data'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, referrals.map(r => {
    const data = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }) : '—';
    const st = r.status || 'pending';
    return /*#__PURE__*/React.createElement("tr", {
      key: r.id,
      style: {
        borderBottom: '1px solid ' + C.border
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 600
      }
    }, r.referrer?.name || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, r.referred?.name || '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, /*#__PURE__*/React.createElement(StatusBadge, {
      status: st,
      colorMap: REFERRALS_STATUS_COLORS,
      labelMap: REFERRALS_STATUS_LABELS
    })), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 700,
        color: C.p7
      }
    }, r.bonus_points != null ? '+' + r.bonus_points : '—'), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted,
        fontSize: 12
      }
    }, data));
  })))));
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
        const {
          data,
          error
        } = await sb.from('reviews').select('id, reviewer_id, quote_id, rating, criteria, comment, created_at, reviewer:profiles!reviewer_id(name, avatar_url), quote:quotes!quote_id(id, painter:profiles!painter_id(name, avatar_url, rating_avg))').order('created_at', {
          ascending: false
        }).limit(500);
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
  const avg = React.useMemo(() => total ? reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / total : 0, [reviews, total]);
  if (loading) return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      color: C.muted
    }
  }, "Carregando avalia\xE7\xF5es...");
  const stars = v => {
    const n = Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
    return '★'.repeat(n) + '☆'.repeat(5 - n);
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2,1fr)',
      gap: 16,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(KPICard, {
    title: "Total de Avalia\xE7\xF5es",
    value: total,
    sub: "enviadas pelos clientes",
    trend: "\u2B50",
    color: C.p1
  }), /*#__PURE__*/React.createElement(KPICard, {
    title: "M\xE9dia Geral",
    value: total ? avg.toFixed(2) : '—',
    sub: total ? stars(avg) : 'sem avaliações ainda',
    trend: "",
    color: C.p7
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      background: C.white,
      borderRadius: 16,
      padding: 20,
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      marginBottom: 16,
      color: C.ink
    }
  }, "\u2B50 Avalia\xE7\xF5es dos Pintores"), reviews.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: C.muted,
      fontSize: 13
    }
  }, "Nenhuma avalia\xE7\xE3o registrada."), reviews.length > 0 && /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      borderBottom: '2px solid ' + C.border
    }
  }, ['Pintor', 'Cliente', 'Nota', 'Critérios', 'Comentário', 'Data'].map(h => /*#__PURE__*/React.createElement("th", {
    key: h,
    style: {
      textAlign: 'left',
      padding: '8px 12px',
      color: C.muted,
      fontWeight: 600,
      fontSize: 11,
      textTransform: 'uppercase'
    }
  }, h)))), /*#__PURE__*/React.createElement("tbody", null, reviews.map(r => {
    const data = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    }) : '—';
    const painterName = r.quote?.painter?.name || '—';
    const reviewerName = r.reviewer?.name || '—';
    const crits = Array.isArray(r.criteria) ? r.criteria : r.criteria ? [r.criteria] : [];
    return /*#__PURE__*/React.createElement("tr", {
      key: r.id,
      style: {
        borderBottom: '1px solid ' + C.border,
        verticalAlign: 'top'
      }
    }, /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontWeight: 600
      }
    }, painterName), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, reviewerName), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.p1,
        whiteSpace: 'nowrap'
      }
    }, stars(r.rating), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted,
        fontSize: 11
      }
    }, Number(r.rating || 0).toFixed(1))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px'
      }
    }, crits.length === 0 ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted,
        fontSize: 11
      }
    }, "\u2014") : /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4
      }
    }, crits.map((c, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        background: C.p3 + '22',
        color: C.p3,
        borderRadius: 8,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600
      }
    }, c)))), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        fontSize: 12,
        maxWidth: 280,
        color: C.ink
      }
    }, r.comment || /*#__PURE__*/React.createElement("span", {
      style: {
        color: C.muted
      }
    }, "\u2014")), /*#__PURE__*/React.createElement("td", {
      style: {
        padding: '10px 12px',
        color: C.muted,
        fontSize: 12,
        whiteSpace: 'nowrap'
      }
    }, data));
  })))));
};
const PAGES_DEF = [{
  id: 'dashboard',
  icon: '📊',
  label: 'Dashboard',
  section: 'PRINCIPAL',
  component: /*#__PURE__*/React.createElement(Dashboard, null)
}, {
  id: 'avisos',
  icon: '📢',
  label: 'Avisos / Notificacoes',
  section: 'PRINCIPAL',
  component: /*#__PURE__*/React.createElement(Avisos, null)
}, {
  id: 'chats',
  icon: '💬',
  label: 'Chats 3-Way',
  section: 'PRINCIPAL',
  badgeKey: 'chats',
  component: /*#__PURE__*/React.createElement(Chats, null)
}, {
  id: 'orcamentos',
  icon: '📋',
  label: 'Orçamentos',
  section: 'PRINCIPAL',
  badgeKey: 'orcamentos',
  component: /*#__PURE__*/React.createElement(Orcamentos, null)
}, {
  id: 'pintores',
  icon: '🖌️',
  label: 'Pintores',
  section: 'PESSOAS',
  badgeKey: 'pintores',
  component: /*#__PURE__*/React.createElement(PintoresList, {
    key: "pintores",
    roleFilter: p => currentRoleKey(p) === 'pintor',
    title: "Pintores Cadastrados",
    defaultRole: "pintor",
    emptyMsg: "Nenhum pintor cadastrado."
  })
}, {
  id: 'grafiteiros',
  icon: '🎨',
  label: 'Grafiteiros',
  section: 'PESSOAS',
  badgeKey: 'grafiteiros',
  component: /*#__PURE__*/React.createElement(PintoresList, {
    key: "grafiteiros",
    roleFilter: p => currentRoleKey(p) === 'grafiteiro',
    title: "Grafiteiros / Muralistas",
    defaultRole: "grafiteiro",
    emptyMsg: "Nenhum grafiteiro cadastrado."
  })
}, {
  id: 'funileiros',
  icon: '🚗',
  label: 'Funileiros / Automotivo',
  section: 'PESSOAS',
  badgeKey: 'funileiros',
  component: /*#__PURE__*/React.createElement(PintoresList, {
    key: "funileiros",
    roleFilter: p => currentRoleKey(p) === 'funileiro' || currentRoleKey(p) === 'automotivo',
    title: "Funileiros / Pintura Automotiva",
    defaultRole: "funileiro",
    emptyMsg: "Nenhum funileiro cadastrado."
  })
}, {
  id: 'leads',
  icon: '🧲',
  label: 'Leads',
  section: 'PESSOAS',
  badgeKey: 'leads',
  component: /*#__PURE__*/React.createElement(Leads, null)
}, {
  id: 'clientes',
  icon: '👥',
  label: 'Clientes',
  section: 'PESSOAS',
  badgeKey: 'clientes',
  component: /*#__PURE__*/React.createElement(ClientesList, null)
}, {
  id: 'portal-users',
  icon: '🔐',
  label: 'Portal',
  section: 'PESSOAS',
  badgeKey: 'portalUsers',
  component: /*#__PURE__*/React.createElement(PortalUsersList, null)
}, {
  id: 'pedidos-loja',
  icon: '🛒',
  label: 'Pedidos da Loja',
  section: 'LOJA',
  component: /*#__PURE__*/React.createElement(PedidosLoja, null)
}, {
  id: 'produtos',
  icon: '🎨',
  label: 'Produtos / Tintas',
  section: 'LOJA',
  component: /*#__PURE__*/React.createElement(ProdutosList, null)
}, {
  id: 'camisetas',
  icon: '👕',
  label: 'Camisetas Personalizadas',
  section: 'LOJA',
  component: /*#__PURE__*/React.createElement(Camisetas, null)
}, {
  id: 'cursos',
  icon: '📚',
  label: 'Cursos',
  section: 'LOJA',
  component: /*#__PURE__*/React.createElement(CursosList, null)
}, {
  id: 'marketing',
  icon: '📣',
  label: 'Marketing / Ads',
  section: 'LOJA',
  component: /*#__PURE__*/React.createElement(MarketingPage, null)
}, {
  id: 'moderacao',
  icon: '🛡️',
  label: 'Moderação',
  section: 'PRINCIPAL',
  component: /*#__PURE__*/React.createElement(Moderacao, null)
}, {
  id: 'analytics',
  icon: '📈',
  label: 'Analytics',
  section: 'DADOS',
  component: /*#__PURE__*/React.createElement(Analytics, null)
}, {
  id: 'indicacoes',
  icon: '🔗',
  label: 'Indicações',
  section: 'DADOS',
  component: /*#__PURE__*/React.createElement(Indicacoes, null)
}, {
  id: 'avaliacoes',
  icon: '⭐',
  label: 'Avaliações',
  section: 'DADOS',
  component: /*#__PURE__*/React.createElement(AvaliacoesTab, null)
}];
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null
    };
  }
  static getDerivedStateFromError(error) {
    return {
      error
    };
  }
  componentDidCatch(error, info) {
    console.error('Portal crash:', error && error.message);
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: {
          padding: 24,
          color: '#c00',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap'
        }
      }, 'Erro no portal: ' + (this.state.error.message || 'desconhecido') + '\nRecarregue a página.');
    }
    return this.props.children;
  }
}

// ============================================================
// Telas de autenticacao (login / signup com convite / reset de senha).
// Extraidas do App para deixar o componente raiz menor. Cada tela recebe
// estado/handlers via props — fonte de verdade segue no App.
// ============================================================
const AuthCard = ({
  children
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    minHeight: '100vh',
    background: C.ink,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    background: C.white,
    borderRadius: 24,
    padding: 40,
    width: 360,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  }
}, /*#__PURE__*/React.createElement("div", {
  style: {
    fontFamily: 'Syne,sans-serif',
    fontSize: 24,
    fontWeight: 800,
    marginBottom: 4
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    color: C.ink
  }
}, "Cali"), /*#__PURE__*/React.createElement("span", {
  style: {
    color: C.p1
  }
}, "Colors")), /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 13,
    color: C.muted,
    marginBottom: 28
  }
}, "Portal de Gest\xE3o QueroUmaCor"), children));
function LoginScreen({
  email,
  setEmail,
  pw,
  setPw,
  loginError,
  loginLoading,
  onLogin,
  onSwitchSignup,
  onSwitchReset
}) {
  return /*#__PURE__*/React.createElement(AuthCard, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "loja@calicolors.com.br",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Senha"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right',
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onSwitchReset,
    style: {
      fontSize: 12,
      color: C.p1,
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "Esqueci minha senha")), loginError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#e63946',
      fontSize: 13,
      marginBottom: 12,
      textAlign: 'center'
    }
  }, loginError), /*#__PURE__*/React.createElement("button", {
    disabled: loginLoading,
    onClick: onLogin,
    style: {
      width: '100%',
      padding: '12px',
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 12,
      fontSize: 15,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, "Entrar no Portal"), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onSwitchSignup,
    style: {
      fontSize: 13,
      color: C.p1,
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "Criar conta no portal")), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginTop: 6,
      fontSize: 12,
      color: C.muted
    }
  }, "Acesso exclusivo Cali Colors"));
}
function SignupScreen({
  step,
  signupCode,
  setSignupCode,
  signupName,
  setSignupName,
  email,
  setEmail,
  pw,
  setPw,
  validatedInvite,
  loginError,
  loginLoading,
  onValidateInvite,
  onCreateAccount,
  onBack
}) {
  return /*#__PURE__*/React.createElement(AuthCard, null, step === 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: C.ink,
      marginBottom: 6
    }
  }, "Codigo de Convite"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 16
    }
  }, "Para criar uma conta no portal, voce precisa de um codigo de convite de alguem que ja tem acesso."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: signupCode,
    onChange: e => setSignupCode(e.target.value.toUpperCase()),
    placeholder: "QUC-XXXXX",
    style: {
      width: '100%',
      padding: '12px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 18,
      fontWeight: 700,
      letterSpacing: 2,
      textAlign: 'center',
      outline: 'none',
      fontFamily: 'monospace'
    }
  })), loginError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#e63946',
      fontSize: 13,
      marginBottom: 12,
      textAlign: 'center'
    }
  }, loginError), /*#__PURE__*/React.createElement("button", {
    disabled: loginLoading,
    onClick: onValidateInvite,
    style: {
      width: '100%',
      padding: '12px',
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 12,
      fontSize: 15,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, loginLoading ? 'Validando...' : 'Validar Codigo')) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: C.ink,
      marginBottom: 4
    }
  }, "Criar conta"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 16
    }
  }, "Codigo ", /*#__PURE__*/React.createElement("b", null, validatedInvite?.code), " validado"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Nome"), /*#__PURE__*/React.createElement("input", {
    value: signupName,
    onChange: e => setSignupName(e.target.value),
    placeholder: "Seu nome",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "email@exemplo.com",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Senha"), /*#__PURE__*/React.createElement("input", {
    type: "password",
    value: pw,
    onChange: e => setPw(e.target.value),
    placeholder: "Minimo 6 caracteres",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), loginError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#e63946',
      fontSize: 13,
      marginBottom: 12,
      textAlign: 'center'
    }
  }, loginError), /*#__PURE__*/React.createElement("button", {
    disabled: loginLoading,
    onClick: onCreateAccount,
    style: {
      width: '100%',
      padding: '12px',
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 12,
      fontSize: 15,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, loginLoading ? 'Criando conta...' : 'Criar Conta')), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onBack,
    style: {
      fontSize: 13,
      color: C.p1,
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "\u2190 Voltar ao login")));
}
function ResetPasswordScreen({
  email,
  setEmail,
  loginError,
  loginLoading,
  resetMsg,
  onReset,
  onBack
}) {
  return /*#__PURE__*/React.createElement(AuthCard, null, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted,
      marginBottom: 6
    }
  }, "Email"), /*#__PURE__*/React.createElement("input", {
    value: email,
    onChange: e => setEmail(e.target.value),
    placeholder: "loja@calicolors.com.br",
    style: {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid ' + C.border,
      fontSize: 14,
      outline: 'none'
    }
  })), resetMsg && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#2e7d32',
      fontSize: 13,
      marginBottom: 12,
      textAlign: 'center'
    }
  }, resetMsg), loginError && /*#__PURE__*/React.createElement("div", {
    style: {
      color: '#e63946',
      fontSize: 13,
      marginBottom: 12,
      textAlign: 'center'
    }
  }, loginError), /*#__PURE__*/React.createElement("button", {
    disabled: loginLoading,
    onClick: onReset,
    style: {
      width: '100%',
      padding: '12px',
      background: C.p1,
      color: '#fff',
      border: 'none',
      borderRadius: 12,
      fontSize: 15,
      fontWeight: 700,
      cursor: 'pointer'
    }
  }, loginLoading ? 'Enviando...' : 'Enviar link de redefinição'), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'center',
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    onClick: onBack,
    style: {
      fontSize: 13,
      color: C.p1,
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "\u2190 Voltar ao login")));
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
      if (!sb) return;
      const [msgsRes, quotesRes, profiles, leadsRes] = await Promise.all([sb.from('messages').select('id', {
        count: 'exact',
        head: true
      }), sb.from('quotes').select('id', {
        count: 'exact',
        head: true
      }), profilesService.list({
        fields: 'role, user_type, profession, portal_access'
      }), sb.from('leads').select('id', {
        count: 'exact',
        head: true
      })]);
      setBadges({
        chats: msgsRes.count || 0,
        orcamentos: quotesRes.count || 0,
        pintores: profiles.filter(p => isProProfile(p) && currentRoleKey(p) === 'pintor').length,
        grafiteiros: profiles.filter(p => isProProfile(p) && currentRoleKey(p) === 'grafiteiro').length,
        funileiros: profiles.filter(p => isProProfile(p) && (currentRoleKey(p) === 'funileiro' || currentRoleKey(p) === 'automotivo')).length,
        leads: leadsRes.count || 0,
        clientes: profiles.filter(isClienteProfile).length,
        portalUsers: profiles.filter(p => p.portal_access === true).length
      });
    } catch (e) {
      console.error('loadBadges error:', e);
    }
  };
  useEffect(() => {
    if (loggedIn) loadBadges();
  }, [loggedIn]);
  useEffect(() => {
    (async () => {
      try {
        const {
          data: {
            session
          }
        } = await supa.auth.getSession();
        if (session && session.user) {
          const {
            data: prof
          } = await supa.from('profiles').select('portal_access').eq('id', session.user.id).single();
          if (prof && prof.portal_access) setLoggedIn(true);
        }
      } catch (e) {/* sessão inválida: mostra login */} finally {
        setAuthChecking(false);
      }
    })();
  }, []);
  const PAGES = React.useMemo(() => PAGES_DEF.map(p => ({
    ...p,
    badge: p.badgeKey ? badges[p.badgeKey] || null : undefined
  })), [badges]);
  // Estes hooks PRECISAM rodar antes dos early returns abaixo, senao a
  // ordem dos hooks muda entre renders (Rules of Hooks).
  const currentPage = React.useMemo(() => PAGES.find(p => p.id === page), [PAGES, page]);
  const sections = React.useMemo(() => [...new Set(PAGES.map(p => p.section))], [PAGES]);
  const handleNav = React.useCallback(id => setPage(id), []);
  if (authChecking) return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      background: C.ink,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontFamily: 'Syne,sans-serif',
      fontSize: 18,
      fontWeight: 700
    }
  }, "Carregando portal...");
  if (!loggedIn) {
    const handleLogin = async () => {
      setLoginError('');
      setLoginLoading(true);
      try {
        const {
          data,
          error
        } = await supa.auth.signInWithPassword({
          email,
          password: pw
        });
        if (error) throw error;
        const {
          data: prof
        } = await supa.from('profiles').select('portal_access').eq('id', data.user.id).single();
        if (!prof || !prof.portal_access) {
          await supa.auth.signOut();
          throw new Error('Sem permissao. Esta conta nao tem acesso ao portal.');
        }
        setLoggedIn(true);
      } catch (e) {
        setLoginError(e.message || 'Email ou senha incorretos');
      } finally {
        setLoginLoading(false);
      }
    };
    const handleSwitchSignup = () => {
      setMode('signup');
      setSignupStep(0);
      setLoginError('');
      setSignupCode('');
      setSignupName('');
      setEmail('');
      setPw('');
      setValidatedInvite(null);
    };
    const handleSwitchReset = () => {
      setMode('reset');
      setLoginError('');
      setResetMsg('');
    };
    const handleBackToLogin = () => {
      setMode('login');
      setLoginError('');
      setResetMsg('');
    };
    const handleValidateInvite = async () => {
      setLoginError('');
      setLoginLoading(true);
      try {
        if (!signupCode.trim()) throw new Error('Insira o codigo de convite');
        const {
          data: inv,
          error
        } = await supa.from('invites').select('id, code, used, max_uses, uses, created_by').eq('code', signupCode.trim()).single();
        if (error || !inv) throw new Error('Codigo invalido');
        if (inv.used || inv.max_uses > 0 && inv.uses >= inv.max_uses) throw new Error('Este codigo ja foi utilizado');
        const {
          data: inviter
        } = await supa.from('profiles').select('portal_access').eq('id', inv.created_by).single();
        if (!inviter || !inviter.portal_access) throw new Error('Este codigo nao da acesso ao portal. O codigo precisa ser de alguem que ja tem acesso ao portal.');
        setValidatedInvite(inv);
        setSignupStep(1);
      } catch (e) {
        setLoginError(e.message);
      } finally {
        setLoginLoading(false);
      }
    };
    const handleCreateAccount = async () => {
      setLoginError('');
      setLoginLoading(true);
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
          userMetadata: {
            role: 'admin'
          },
          extraProfile: {
            invited_by: validatedInvite.created_by
          }
        });
        if (!res.ok) throw new Error(res.error || 'Erro ao criar conta');
        await supa.from('invites').update({
          uses: (validatedInvite.uses || 0) + 1
        }).eq('id', validatedInvite.id);
        const {
          error: signInErr
        } = await supa.auth.signInWithPassword({
          email: email.trim(),
          password: pw
        });
        if (signInErr) throw signInErr;
        setLoggedIn(true);
      } catch (e) {
        setLoginError(e.message || 'Erro ao criar conta');
      } finally {
        setLoginLoading(false);
      }
    };
    const handleReset = async () => {
      setLoginError('');
      setResetMsg('');
      setLoginLoading(true);
      try {
        if (!email) throw new Error('Informe seu email');
        const {
          error
        } = await supa.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });
        if (error) throw error;
        setResetMsg('Link de redefinição enviado para ' + email);
      } catch (e) {
        setLoginError(e.message || 'Erro ao enviar email');
      } finally {
        setLoginLoading(false);
      }
    };
    if (mode === 'reset') return /*#__PURE__*/React.createElement(ResetPasswordScreen, {
      email: email,
      setEmail: setEmail,
      loginError: loginError,
      loginLoading: loginLoading,
      resetMsg: resetMsg,
      onReset: handleReset,
      onBack: handleBackToLogin
    });
    if (mode === 'signup') return /*#__PURE__*/React.createElement(SignupScreen, {
      step: signupStep,
      signupCode: signupCode,
      setSignupCode: setSignupCode,
      signupName: signupName,
      setSignupName: setSignupName,
      email: email,
      setEmail: setEmail,
      pw: pw,
      setPw: setPw,
      validatedInvite: validatedInvite,
      loginError: loginError,
      loginLoading: loginLoading,
      onValidateInvite: handleValidateInvite,
      onCreateAccount: handleCreateAccount,
      onBack: handleBackToLogin
    });
    return /*#__PURE__*/React.createElement(LoginScreen, {
      email: email,
      setEmail: setEmail,
      pw: pw,
      setPw: setPw,
      loginError: loginError,
      loginLoading: loginLoading,
      onLogin: handleLogin,
      onSwitchSignup: handleSwitchSignup,
      onSwitchReset: handleSwitchReset
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      minHeight: '100vh',
      fontFamily: 'DM Sans, sans-serif'
    }
  }, /*#__PURE__*/React.createElement("nav", {
    "aria-label": "Menu administrativo",
    style: {
      width: 240,
      background: C.ink,
      position: 'fixed',
      top: 0,
      left: 0,
      height: '100vh',
      overflow: 'hidden',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement(Logo, null), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 0',
      marginTop: 8,
      flex: 1,
      overflowY: 'auto'
    }
  }, sections.map(section => /*#__PURE__*/React.createElement("div", {
    key: section
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.muted,
      letterSpacing: 2,
      textTransform: 'uppercase',
      padding: '12px 20px 4px'
    }
  }, section), PAGES.filter(p => p.section === section).map(p => /*#__PURE__*/React.createElement(NavItem, {
    key: p.id,
    icon: p.icon,
    label: p.label,
    badge: p.badge,
    active: page === p.id,
    onClick: () => handleNav(p.id)
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flexShrink: 0,
      padding: 16,
      borderTop: '1px solid rgba(255,255,255,0.1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      color: 'rgba(255,255,255,0.7)',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 32,
      height: 32,
      borderRadius: '50%',
      background: C.p1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 700,
      color: '#fff'
    }
  }, "C"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      color: C.white
    }
  }, "Cali Colors"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11
    }
  }, "Plano Business \xB7 Ativo"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 240,
      flex: 1,
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("header", {
    role: "banner",
    style: {
      background: C.white,
      borderBottom: '1px solid ' + C.border,
      padding: '0 28px',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 50
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'Syne, sans-serif',
      fontSize: 18,
      fontWeight: 800,
      color: C.ink
    }
  }, currentPage?.label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: C.muted
    }
  }, new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => {
      if (window.confirm('Tem certeza que deseja sair do portal?')) {
        supa.auth.signOut();
        setLoggedIn(false);
      }
    },
    style: {
      background: 'transparent',
      border: '1px solid ' + C.border,
      borderRadius: 8,
      padding: '6px 12px',
      cursor: 'pointer',
      fontSize: 12,
      color: C.muted
    }
  }, "Sair"))), /*#__PURE__*/React.createElement("main", {
    style: {
      padding: 28,
      flex: 1
    }
  }, currentPage?.component)));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(ErrorBoundary, null, /*#__PURE__*/React.createElement(App, null)));
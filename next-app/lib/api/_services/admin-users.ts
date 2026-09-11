// lib/api/_services/admin-users.ts — port de
// `functions/api/_services/admin-users.js`. Promove/revoga portal_access,
// set PRO, role, verified. Service role + dupla checagem de admin
// (ADMIN_EMAILS + portal_access ATIVO do caller).

import { ServiceError, getServiceKey, getSupabaseUrl } from '../security';
import { ehUuid, escaparCuringasIlike, valorParaOr } from './_untrusted';

const TIMEOUT_MS = 10000;

export type AdminUsersAction = 'promote' | 'revoke' | 'verify' | 'set_pro' | 'set_role';

interface AdminUsersBody {
  action?: string;
  value?: unknown;
  expiresAt?: unknown;
  roleKey?: unknown;
}

const ROLE_MAP: Record<string, Record<string, string>> = {
  pintor: { role: 'pintor', user_type: 'pintor', profession: 'pintor' },
  grafiteiro: { role: 'grafiteiro', user_type: 'grafiteiro', profession: 'grafiteiro' },
  automotivo: { role: 'automotivo', user_type: 'automotivo', profession: 'automotivo' },
  funileiro: { role: 'automotivo', user_type: 'automotivo', profession: 'funileiro' },
  arquiteto: { role: 'arquiteto', user_type: 'arquiteto', profession: 'arquiteto' },
  // 'engenheiro' grava o MESMO papel, mudando só a profissão exibida —
  // exatamente como 'funileiro' faz com 'automotivo'.
  engenheiro: { role: 'arquiteto', user_type: 'arquiteto', profession: 'engenheiro' },
  cliente: { role: 'cliente', user_type: 'cliente' },
};

/**
 * Constrói o patch baseado na action. Throw ServiceError se action/params inválidos.
 */
export function buildPatch(body: AdminUsersBody): Record<string, unknown> {
  const { action } = body;
  if (action === 'promote' || action === 'revoke') {
    return { portal_access: action === 'promote' };
  }
  if (action === 'verify') {
    return { verified: body?.value === true };
  }
  if (action === 'set_pro') {
    const enable = body?.value === true;
    let expiresAt: string | null = null;
    if (enable) {
      const raw = typeof body?.expiresAt === 'string' ? body.expiresAt : '';
      const parsed = raw ? new Date(raw) : null;
      expiresAt =
        parsed && !isNaN(parsed.getTime())
          ? parsed.toISOString()
          : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }
    return { is_pro: enable, pro_expires_at: expiresAt };
  }
  if (action === 'set_role') {
    const m = ROLE_MAP[typeof body?.roleKey === 'string' ? body.roleKey : ''];
    if (!m) throw new ServiceError('roleKey inválido', 400);
    return { ...m };
  }
  throw new ServiceError('ação inválida', 400);
}

/**
 * Dupla checagem além de estar em ADMIN_EMAILS: caller PRECISA ter portal_access
 * ATIVO no profile. Bloqueia auto-promoção via lojistas com portal_access.
 */
export async function ensureCallerHasPortalAccess(args: { callerId: string }): Promise<void> {
  const { callerId } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  try {
    const g = await fetch(
      `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=portal_access`,
      { headers: sHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const arr = (await g.json()) as Array<{ portal_access?: boolean }>;
    if (!arr?.[0]?.portal_access) throw new ServiceError('não autorizado (portal_access)', 403);
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('falha ao verificar permissão', 502);
  }
}

/**
 * Aplica patch no profile target.
 */
export async function patchProfile(args: {
  userId: string;
  patch: Record<string, unknown>;
}): Promise<{ ok: true; patch: Record<string, unknown> }> {
  const { userId, patch } = args;
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    console.warn('admin-users supabase error', r.status, txt);
    throw new ServiceError('Falha temporária na consulta — tente de novo', 502);
  }
  const updated = (await r.json()) as unknown[];
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, patch };
}

/**
 * Edita a @tag de um perfil (portal admin). REGRA DO APP: tag nunca fica
 * vazia — sem ela o perfil some da busca e perde o link público. Mesmas
 * regras do tagSchema do app (a-z, 0-9, _; 3-24 chars; lowercase). O
 * trigger `sync_profile_tag_username` do banco propaga pra `username`.
 */
export async function setTag(args: {
  userId: string;
  tag: unknown;
}): Promise<{ ok: true; tag: string }> {
  const raw =
    typeof args.tag === 'string' ? args.tag.trim().replace(/^@+/, '').toLowerCase() : '';
  if (!raw) throw new ServiceError('a @tag não pode ficar vazia', 400);
  if (raw.length < 3 || raw.length > 24 || !/^[a-z0-9_]+$/.test(raw)) {
    throw new ServiceError('@tag inválida: 3 a 24 caracteres, só a-z, 0-9 e _', 400);
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Unicidade: a tag é o handle público — duas pessoas com a mesma quebra
  // busca e link de perfil. Pré-checagem + tradução do 409 do PostgREST.
  const dup = await fetch(
    `${supaUrl}/rest/v1/profiles?select=id&or=(tag.eq.${encodeURIComponent(raw)},username.eq.${encodeURIComponent(raw)})&id=neq.${encodeURIComponent(args.userId)}&limit=1`,
    { headers: sHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (dup.ok) {
    const rows = (await dup.json()) as unknown[];
    if (Array.isArray(rows) && rows.length > 0) {
      throw new ServiceError(`a @tag "${raw}" já está em uso por outro perfil`, 409);
    }
  }

  const r = await fetch(
    `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(args.userId)}`,
    {
      method: 'PATCH',
      headers: { ...sHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ tag: raw, username: raw }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (r.status === 409) throw new ServiceError(`a @tag "${raw}" já está em uso`, 409);
  if (!r.ok) {
    console.warn('admin-users setTag supabase error', r.status, (await r.text()).slice(0, 200));
    throw new ServiceError('Falha ao salvar a @tag — tente de novo', 502);
  }
  const updated = (await r.json()) as unknown[];
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, tag: raw };
}

/**
 * Edita o nome de exibição de um perfil (portal admin). Trim + limites
 * frouxos (2-60) — nome é campo livre, sem regra de unicidade.
 */
export async function setName(args: {
  userId: string;
  name: unknown;
}): Promise<{ ok: true; name: string }> {
  const raw = typeof args.name === 'string' ? args.name.trim().replace(/\s+/g, ' ') : '';
  if (raw.length < 2 || raw.length > 60) {
    throw new ServiceError('nome inválido: use de 2 a 60 caracteres', 400);
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(args.userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ name: raw }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    console.warn('admin-users setName supabase error', r.status, (await r.text()).slice(0, 200));
    throw new ServiceError('Falha ao salvar o nome — tente de novo', 502);
  }
  const updated = (await r.json()) as unknown[];
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, name: raw };
}

/**
 * Normaliza o telefone do jeito que o APP grava (`phoneSchema`): dígitos
 * puros com o DDI na frente — "(11) 95976-5031" vira "5511959765031". Se o
 * portal gravasse com máscara, o número deixaria de casar com
 * `whatsapp_messages` e com os leads, que comparam dígitos.
 *
 * Segue a MESMA regra de `normalizeWhatsAppTarget` (whatsapp-evo.ts), e não
 * a de `normalizeBrPhone`: com 11 dígitos só é celular brasileiro quando o
 * 3º dígito é 9. Colar '55' em qualquer coisa com 11 dígitos foi o que
 * transformou o contato dos EUA `16503154274` em `5516503154274` —
 * inexistente — e derrubou o envio com 502. Número estrangeiro passa
 * verbatim.
 */
function normalizePhoneBr(raw: string): string {
  const d = raw.replace(/\D+/g, '');
  if (!d) return '';
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10) return '55' + d;                    // fixo BR
  if (d.length === 11 && d[2] === '9') return '55' + d;    // celular BR
  if (d.length >= 11 && d.length <= 15) return d;          // DDI estrangeiro
  throw new ServiceError(
    'telefone inválido: use DDD + número (ex.: 11 95976-5031) ou vazio pra limpar',
    400,
  );
}

/**
 * Edita cidade/estado/especialidades/telefone (portal admin). Cada campo é
 * opcional; string vazia LIMPA o campo (vira null). Pelo menos um campo
 * precisa vir no body.
 */
export async function setInfo(args: {
  userId: string;
  city?: unknown;
  state?: unknown;
  specialties?: unknown;
  phone?: unknown;
}): Promise<{ ok: true; patch: Record<string, string | null> }> {
  const patch: Record<string, string | null> = {};

  if (typeof args.city === 'string') {
    const v = args.city.trim().replace(/\s+/g, ' ');
    if (v.length > 60) throw new ServiceError('cidade muito longa (máx 60 caracteres)', 400);
    patch.city = v || null;
  }
  if (typeof args.state === 'string') {
    const v = args.state.trim().toUpperCase();
    if (v && !/^[A-Z]{2}$/.test(v)) {
      throw new ServiceError('estado inválido: use a UF com 2 letras (ex.: SP) ou vazio pra limpar', 400);
    }
    patch.state = v || null;
  }
  if (typeof args.specialties === 'string') {
    const v = args.specialties.trim().replace(/\s+/g, ' ');
    if (v.length > 200) throw new ServiceError('especialidades muito longas (máx 200 caracteres)', 400);
    patch.specialties = v || null;
  }
  if (typeof args.phone === 'string') {
    patch.phone = normalizePhoneBr(args.phone) || null;
  }
  if (Object.keys(patch).length === 0) {
    throw new ServiceError('nada pra atualizar (city/state/specialties/phone)', 400);
  }

  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const r = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(args.userId)}`, {
    method: 'PATCH',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    console.warn('admin-users setInfo supabase error', r.status, (await r.text()).slice(0, 200));
    throw new ServiceError('Falha ao salvar — tente de novo', 502);
  }
  const updated = (await r.json()) as unknown[];
  if (!Array.isArray(updated) || updated.length === 0) {
    throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, patch };
}

/**
 * Troca o e-mail de um usuário (portal admin). Atualiza o LOGIN no Auth
 * (GoTrue admin API — sem e-mail de confirmação: ação administrativa) e
 * espelha em `profiles.email` (coluna de exibição usada pelo portal).
 * Perfil órfão (sem login no Auth, 404) ganha só o espelho no profile.
 */
export async function setEmail(args: {
  userId: string;
  email: unknown;
}): Promise<{ ok: true; email: string; authUpdated: boolean }> {
  const raw = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
  // Validação simples e suficiente pro admin: algo@algo.tld sem espaços.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) || raw.length > 254) {
    throw new ServiceError('e-mail inválido (formato esperado: nome@dominio.com)', 400);
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // 1) Login no Auth. É a fonte de verdade — se falhar (fora 404), aborta
  //    sem tocar no profile, senão exibição e login divergem.
  let authUpdated = false;
  let ar: Response;
  try {
    ar = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(args.userId)}`, {
      method: 'PUT',
      headers: sHeaders,
      body: JSON.stringify({ email: raw }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('não consegui falar com o Auth do Supabase — nada foi alterado', 502);
  }
  if (ar.ok) {
    authUpdated = true;
  } else if (ar.status !== 404) {
    const body = (await ar.text()).slice(0, 180);
    if (ar.status === 422 || /already|registered|exists/i.test(body)) {
      throw new ServiceError(`o e-mail "${raw}" já está em uso por outro login`, 409);
    }
    console.warn('admin-users setEmail auth error', ar.status, body);
    throw new ServiceError(
      `o Auth recusou trocar o e-mail (HTTP ${ar.status}): ${body || 'sem detalhe'}`,
      502,
    );
  }

  // 2) Espelho em profiles.email (o portal lista daqui).
  const pr = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(args.userId)}`, {
    method: 'PATCH',
    headers: { ...sHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ email: raw }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!pr.ok) {
    console.warn('admin-users setEmail profile error', pr.status, (await pr.text()).slice(0, 200));
    throw new ServiceError(
      authUpdated
        ? 'login atualizado, mas falhou espelhar no perfil — rode de novo pra sincronizar'
        : 'Falha ao salvar o e-mail no perfil — tente de novo',
      502,
    );
  }
  const updated = (await pr.json()) as unknown[];
  if (!Array.isArray(updated) || updated.length === 0) {
    if (!authUpdated) throw new ServiceError('perfil não encontrado', 404);
  }
  return { ok: true, email: raw, authUpdated };
}

/**
 * Lê o e-mail de LOGIN no Auth (GoTrue admin) e espelha em
 * `profiles.email`. Existe porque a coluna `profiles.email` é só um
 * ESPELHO: perfil criado antes dela (ou por fluxo que não a preenchia)
 * fica com email NULL e o portal mostra "—" pra sempre — o login de
 * verdade mora em `auth.users`, que o portal (chave anon) não enxerga.
 * Sem `p_email` novo: não troca nada no Auth, só revela e sincroniza.
 */
export async function syncEmailFromAuth(args: {
  userId: string;
}): Promise<{ ok: true; email: string; mirrored: boolean; source: 'auth' | 'profile' }> {
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // 1) Fonte de verdade: o login no Auth.
  let ar: Response;
  try {
    ar = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(args.userId)}`, {
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('não consegui falar com o Auth do Supabase', 502);
  }

  let authEmail = '';
  if (ar.ok) {
    const u = (await ar.json()) as { email?: unknown; new_email?: unknown };
    if (typeof u?.email === 'string') authEmail = u.email.trim().toLowerCase();
    // Conta criada por telefone/OAuth sem e-mail confirmado ainda pode ter
    // só `new_email` pendente — melhor mostrar isso do que "—".
    if (!authEmail && typeof u?.new_email === 'string') authEmail = u.new_email.trim().toLowerCase();
  } else if (ar.status !== 404) {
    console.warn('admin-users syncEmail auth error', ar.status);
    throw new ServiceError(`o Auth recusou a consulta (HTTP ${ar.status})`, 502);
  }

  // 2) Sem login (perfil órfão) ou login sem e-mail: cai pro espelho.
  if (!authEmail) {
    const pr = await fetch(
      `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(args.userId)}&select=email`,
      { headers: sHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    const rows = pr.ok ? ((await pr.json()) as { email?: string | null }[]) : [];
    const mirrored = Array.isArray(rows) && rows[0] && typeof rows[0].email === 'string'
      ? rows[0].email.trim()
      : '';
    if (mirrored) return { ok: true, email: mirrored, mirrored: false, source: 'profile' };
    throw new ServiceError(
      ar.status === 404
        ? 'este perfil não tem login no Auth (perfil órfão) e não tem e-mail salvo — use o lápis pra cadastrar um'
        : 'o login desta conta não tem e-mail cadastrado (entrou por telefone/rede social) — use o lápis pra cadastrar um',
      404,
    );
  }

  // 3) Espelha no profile pra próxima listagem já vir preenchida. Falhar
  //    aqui não custa a resposta — o e-mail já foi descoberto.
  let mirrored = false;
  try {
    const pr = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(args.userId)}`, {
      method: 'PATCH',
      headers: sHeaders,
      body: JSON.stringify({ email: authEmail }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    mirrored = pr.ok;
    if (!pr.ok) console.warn('admin-users syncEmail mirror error', pr.status);
  } catch {
    /* espelho é best-effort */
  }
  return { ok: true, email: authEmail, mirrored, source: 'auth' };
}

/**
 * Exclusão PERMANENTE: apaga o login no Auth (GoTrue admin API) e a linha
 * de `profiles`. Sem volta. Guardas: nunca a própria conta do caller, e
 * nunca um perfil admin/portal (remova o acesso antes, se for o caso).
 * As FKs ON DELETE CASCADE limpam o rastro (posts/mensagens/etc. conforme
 * o schema); mídia órfã cai no cleanup_orphan_media() semanal.
 */
export async function deleteUserPermanently(args: {
  userId: string;
  callerId: string;
}): Promise<{ ok: true; deleted: string }> {
  const { userId, callerId } = args;
  if (userId === callerId) {
    throw new ServiceError('você não pode excluir a própria conta por aqui', 400);
  }
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  // Proteção anti-tiro-no-pé: admin/portal não se exclui em lote.
  const g = await fetch(
    `${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=portal_access,role`,
    { headers: sHeaders, signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (g.ok) {
    const rows = (await g.json()) as Array<{ portal_access?: boolean; role?: string | null }>;
    const row = rows?.[0];
    if (row && (row.portal_access || row.role === 'admin')) {
      throw new ServiceError(
        'este perfil tem acesso admin/portal — revogue o acesso antes de excluir',
        400,
      );
    }
  }

  // 1) Login (Auth). 404 = já não existia (perfil órfão) — segue pro passo 2.
  // O erro upstream vai NA MENSAGEM: um 502 pelado ("A acao falhou: HTTP
  // 502") não diz se foi FK travando o delete, timeout ou o GoTrue fora —
  // e sem isso não dá pra consertar a causa.
  let ar: Response;
  try {
    ar = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && e.name === 'TimeoutError';
    throw new ServiceError(
      timeout
        ? 'o Auth demorou demais pra excluir este login (timeout 10s) — tente de novo em lotes menores'
        : 'não consegui falar com o Auth do Supabase — nada foi apagado',
      502,
    );
  }
  if (!ar.ok && ar.status !== 404) {
    const body = (await ar.text()).slice(0, 180);
    console.warn('admin-users deleteUser auth error', ar.status, body);
    throw new ServiceError(
      `o Auth recusou excluir o login (HTTP ${ar.status}): ${body || 'sem detalhe'}`,
      502,
    );
  }

  // 2) Linha de profiles (cobre FK sem cascade e perfis órfãos).
  let pr: Response;
  try {
    pr = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ServiceError('login excluído, mas o perfil não respondeu — rode de novo pra limpar', 502);
  }
  if (!pr.ok && pr.status !== 404) {
    const body = (await pr.text()).slice(0, 180);
    console.warn('admin-users deleteUser profile error', pr.status, body);
    throw new ServiceError(
      `login excluído, mas falhou apagar o perfil (HTTP ${pr.status}): ${body || 'sem detalhe'} — rode de novo`,
      502,
    );
  }

  return { ok: true, deleted: userId };
}

/**
 * High-level: lookup de um usuário por id ou email. Devolve `{ users: [...] }`.
 * Usado pelo controller `admin-users` quando body manda `query`/`email`/`userId`
 * sem nenhuma `action` de mutação — vira modo "read only" pra preencher UI.
 *
 * Mantém compat com o controller vanilla (que só fazia PATCH) adicionando esse
 * modo de busca exigido pela task. Nenhum caller do app antigo é afetado.
 */
export async function listUsers(args: {
  query?: string;
  userId?: string;
  email?: string;
}): Promise<{ users: unknown[] }> {
  const serviceKey = getServiceKey();
  if (!serviceKey) throw new ServiceError('Gestão de usuários não configurada', 503);
  const supaUrl = getSupabaseUrl();
  const sHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  const qs = new URLSearchParams();
  qs.set(
    'select',
    'id,name,email,role,user_type,profession,is_pro,pro_expires_at,portal_access,verified,created_at'
  );
  qs.set('limit', '50');

  const q = valorParaOr((args.query || '').trim());
  if (args.userId) {
    // `eq.` é literal, mas id que não é UUID não acha nada de todo jeito —
    // e um 400 do PostgREST vira 502 opaco pro operador.
    if (!ehUuid(args.userId)) throw new ServiceError('userId inválido', 400);
    qs.set('id', `eq.${args.userId}`);
  } else if (args.email) {
    // Igualdade sem curinga: `{"email":"*"}` listava os 50 primeiros perfis.
    const email = String(args.email).trim().toLowerCase().slice(0, 254);
    if (!/^[^\s@*%,()]+@[^\s@*%,()]+$/.test(email)) throw new ServiceError('email inválido', 400);
    qs.set('email', `ilike.${escaparCuringasIlike(email)}`);
  } else if (q) {
    // Busca por nome OU email (PostgREST `or`). `valorParaOr` tirou `,` `(`
    // `)` `.` e curingas: sem isso `a*,role.eq.admin,name.ilike.*` reescrevia
    // o predicado inteiro (auditoria 2026-09-11).
    qs.set('or', `(name.ilike.*${q}*,email.ilike.*${q}*)`);
  } else {
    throw new ServiceError('query/userId/email obrigatório', 400);
  }

  try {
    const r = await fetch(`${supaUrl}/rest/v1/profiles?${qs.toString()}`, {
      headers: sHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      console.warn('admin-users listUsers supabase error', r.status);
      throw new ServiceError('Falha ao consultar usuários', 502);
    }
    return { users: (await r.json()) as unknown[] };
  } catch (e) {
    if (e instanceof ServiceError) throw e;
    throw new ServiceError('Erro de rede consultando usuários', 502);
  }
}

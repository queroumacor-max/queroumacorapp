// /api/delete-account — exclusão de conta (LGPD Art. 18 VI).
// ──────────────────────────────────────────────────────────────────────
// Fluxo:
//   1. User logado faz POST com seu accessToken no body
//   2. Valida token via requireAuthStrict
//   3. Soft delete em cascade nas tabelas do user (Wave 8 já tem
//      deleted_at em posts/comments/messages/notes/quotes/checklists +
//      cleanup_soft_deleted hard delete em 30d)
//   4. Anonimiza profile (email/phone/birth_date/address NULL, name
//      → 'Conta excluída', avatar_url NULL)
//   5. Log em audit_log (action='lgpd.account_deletion', target=user_id)
//   6. Deleta o auth.user (auth.admin.deleteUser via service_role)
//
// Idempotente: se já excluída, retorna 200 com status=already_deleted.
// Não throws em erros não-fatais — preserva resposta 200 pra cliente.

import { NextResponse, type NextRequest } from 'next/server';
import {
  requireAuthStrict,
  getServiceKey,
  getSupabaseUrl,
  resolveSupabaseEnv,
  ServiceError,
  enforceRateLimit,
} from '@/lib/api/security';
import { logAuditEvent } from '@/lib/api/audit';
import { captureDrAuditEvent } from '@/lib/drAuditTrail';
import { cleanupUserStorage } from '@/lib/api/_services/storageCleanup';

// @opennextjs/cloudflare (adapter atual) só suporta o runtime nodejs do
// Next — não 'edge' (herança do @cloudflare/next-on-pages; ver ADR 0006).
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // Ação destrutiva e rara — limite baixo por IP antes de validar token.
  const limited = await enforceRateLimit(request, { endpoint: 'delete-account', limit: 5 });
  if (limited) return limited;
  let body: { accessToken?: string };
  try {
    body = (await request.json()) as { accessToken?: string };
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  let userId: string;
  let email: string | null = null;
  let userToken: string;
  try {
    const auth = await requireAuthStrict(request, body);
    userId = auth.user.id;
    email = auth.user.email ?? null;
    userToken = auth.token;
  } catch (e) {
    if (e instanceof ServiceError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'auth failed' }, { status: 401 });
  }

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json({ error: 'service unavailable' }, { status: 503 });
  }
  let supaUrl: string;
  try {
    supaUrl = getSupabaseUrl();
  } catch {
    return NextResponse.json({ error: 'service unavailable' }, { status: 503 });
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  const now = new Date().toISOString();

  // -1. Derruba TODAS as sessões da conta (2026-09-28, janela de corrida).
  // A exclusão é uma sequência de chamadas HTTP (storage → soft-delete →
  // anonimização → auth.users). Enquanto ela anda, a mesma conta segue
  // logada em outra aba/aparelho e pode gravar linha ou subir arquivo que a
  // varredura já passou. O CASCADE do DELETE final leva quase toda linha
  // nova; o que sobra é arquivo órfão no Storage (tratado no fim, com a 2ª
  // limpeza) e linha com FK SET NULL. O logout `scope=global` revoga todos
  // os refresh tokens: nenhuma sessão consegue renovar. LIMITE: um access
  // token já emitido continua válido até expirar (≤1h) — o JWT é validado
  // só pela assinatura no PostgREST/Storage. Best-effort: falhar aqui não
  // impede a exclusão.
  await revogarSessoes(userToken);

  // 0. Storage: apaga os ARQUIVOS do usuário nos buckets públicos onde o
  // path segue a convenção `<uid>/...` (avatars, art-refs; `posts` também
  // segue essa convenção pro que o PRÓPRIO usuário fez upload — post de
  // OUTRO usuário nunca cai sob o prefixo do uid deletado, então apagar o
  // prefixo inteiro é seguro).
  //
  // Privacidade 2026-09-17: nenhum dos dois caminhos de exclusão de conta
  // (este endpoint e a RPC `admin_delete_user`, que é SQL puro e não pode
  // tocar Storage) deletava arquivo nenhum — o profile ficava anonimizado
  // no banco, mas a foto de perfil/arte publicada continuava baixável pra
  // sempre pela URL pública antiga. `cleanupUserStorage` é compartilhada
  // com `/api/admin/users` (action `cleanup_storage`), que fecha o mesmo
  // gap pro caminho de exclusão PELO ADMIN. Best-effort: falha aqui não
  // pode impedir o resto da exclusão.
  await cleanupUserStorage(userId, supaUrl, serviceKey);

  // 1. Soft-delete em cascade nas tabelas do user.
  // PATCH em massa em cada tabela com user_id ou owner. Best-effort:
  // falha em uma tabela não bloqueia as outras (loop captura erros).
  const cascadeTargets = [
    { table: 'posts', col: 'user_id' },
    { table: 'comments', col: 'user_id' },
    { table: 'notes', col: 'user_id' },
    { table: 'checklists', col: 'user_id' },
    { table: 'art_references', col: 'user_id' },
  ];
  for (const t of cascadeTargets) {
    try {
      await fetch(`${supaUrl}/rest/v1/${t.table}?${t.col}=eq.${userId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ deleted_at: now }),
      });
    } catch {
      /* silent */
    }
  }
  // messages: soft delete em mensagens enviadas pelo user
  try {
    await fetch(`${supaUrl}/rest/v1/messages?sender_id=eq.${userId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ deleted_at: now }),
    });
  } catch {
    /* silent */
  }
  // quotes: soft delete em quotes onde é client ou painter
  for (const col of ['client_id', 'painter_id']) {
    try {
      await fetch(`${supaUrl}/rest/v1/quotes?${col}=eq.${userId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ deleted_at: now }),
      });
    } catch {
      /* silent */
    }
  }

  // 2. Anonimiza profile.
  // `display_name` NÃO é coluna real de `profiles` (nenhuma migration a
  // criou — ver a mesma pegadinha em lib/services/profile.ts). Incluí-la
  // aqui faz o PostgREST rejeitar o PATCH INTEIRO (coluna desconhecida no
  // schema cache) — e como ninguém checa `res.ok` abaixo, a etapa central
  // deste endpoint (LGPD Art. 18 VI) falhava em SILÊNCIO: o cliente recebia
  // 200 "sucesso" e o profile nunca era anonimizado de verdade.
  const anonymizedFields = {
    name: 'Conta excluída',
    tag: null,
    username: null,
    avatar_url: null,
    bio: null,
    phone: null,
    email: null,
    address: null,
    birth_date: null,
    business_logo_url: null,
    business_name: null,
    instagram_url: null,
    website_url: null,
    cart: null,
    archived_conversations: null,
    seen_stories: null,
  };
  try {
    await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(anonymizedFields),
    });
  } catch {
    /* silent */
  }

  // 3. Audit log (trilha de exclusão pra DPO da Cali Colors).
  // R-H5: ação LGPD → critical=true. Perder o registro de exclusão é
  // problema regulatório (Art. 18 VI da LGPD). Se o insert falhar,
  // retornamos 500 genérico sem deletar o auth.user — operador re-tenta
  // depois com o estado de soft-delete já aplicado (idempotente).
  try {
    await logAuditEvent({
      actorId: userId,
      action: 'lgpd.account_deletion',
      targetTable: 'profiles',
      targetId: userId,
      changes: {
        email_hash: email ? email.slice(0, 4) + '***' : null,
        deleted_at: now,
      },
      request,
      critical: true,
    });
  } catch (e) {
    console.warn(
      'delete-account: audit critical failed',
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ error: 'erro interno' }, { status: 500 });
  }

  // DR audit 2026-09-17 (HIGH-1): espelha o evento no Sentry, FORA do
  // Postgres — um PITR restore rola `audit_log` pra trás junto com o
  // resto do banco; isto dá à reconciliação pós-restore uma fonte
  // independente pra saber quais contas foram excluídas entre o backup e
  // o disaster. Ver lib/api/drAuditTrail.ts.
  captureDrAuditEvent('account_deletion', {
    userId,
    deletedAt: now,
    source: 'self-service',
  });

  // 4. Deleta o auth.user. SECURITY: service_role tem auth.admin.
  // Endpoint: POST /auth/v1/admin/users/{user_id} com DELETE method.
  //
  // Auditoria de negócio 2026-09-16: o `await fetch(...)` sozinho, sem
  // checar `res.ok`, só lança em falha de REDE — um 4xx/5xx do GoTrue
  // (permissão, falha transitória, alguma FK que a varredura de
  // 2026-08-28 não cobriu) passava batido e o endpoint respondia
  // `{ok:true}` mesmo com o `auth.users` intacto. Nesse caso o
  // access/refresh token da conta CONTINUA válido — `requireAuth`
  // revalida contra o GoTrue vivo a cada chamada, então a sessão não
  // morre sozinha até expirar naturalmente (e o refresh token nem isso).
  // Perfil já fica anonimizado/soft-deleted (LGPD cumprida), mas a conta
  // "excluída" continuava conseguindo autenticar. Falha agora É VISÍVEL
  // (log — flui pro Sentry/observability existente) em vez de silenciosa;
  // a resposta ao cliente segue `{ok:true}` porque o lado que importa pro
  // usuário (dados removidos) já aconteceu, e bloquear a resposta por
  // isso pioraria a UX sem mudar o resultado (operador precisa limpar
  // manualmente de qualquer forma).
  // Privacy audit 2026-09-17: UMA retentativa (falha de GoTrue é muitas
  // vezes transitória) e, se persistir, grava em `errors` — `console.error`
  // sozinho só existe nos logs do Cloudflare Worker (sem retenção/dashboard
  // garantidos pra este projeto); `/admin/errors` já é o painel que a loja
  // olha pra incidente. Continua best-effort: nunca muda a resposta 200.
  async function tryDeleteAuthUser(): Promise<boolean> {
    try {
      const res = await fetch(`${supaUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey as string },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  let authDeleted = await tryDeleteAuthUser();
  if (!authDeleted) authDeleted = await tryDeleteAuthUser();
  if (!authDeleted) {
    console.error(
      `delete-account: GoTrue DELETE falhou (2 tentativas) para ${userId} — ` +
        `auth.users pode continuar ATIVO (sessão/token seguem válidos).`
    );
    try {
      await fetch(`${supaUrl}/rest/v1/errors`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'account-deletion-incomplete',
          msg: `auth.users de ${userId} não foi removido após soft-delete + anonimização — limpar manualmente`,
          user_id: userId,
          client_ts: Date.now(),
        }),
      });
    } catch {
      /* silent — best-effort */
    }
  }

  // 5. 2ª limpeza de Storage, DEPOIS do auth.users sumir: pega arquivo que
  // outra sessão ainda viva subiu enquanto a exclusão andava (a 1ª passada
  // já tinha listado o bucket). Com o usuário apagado, nada mais escreve em
  // `<uid>/`. Best-effort, igual a primeira.
  if (authDeleted) await cleanupUserStorage(userId, supaUrl, serviceKey);

  return NextResponse.json({ ok: true, deleted_at: now });
}

/** Logout global com o token do PRÓPRIO usuário. Nunca lança. */
async function revogarSessoes(userToken: string): Promise<void> {
  try {
    // URL e anon key do MESMO par (regra de 2026-09-04) — é o GoTrue que
    // valida o token do usuário aqui.
    let par: { url: string; anonKey: string };
    try {
      par = resolveSupabaseEnv();
    } catch {
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(`${par.url}/auth/v1/logout?scope=global`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userToken}`, apikey: par.anonKey },
        signal: ctrl.signal,
      });
      if (!res.ok) console.warn(`delete-account: logout global respondeu ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn('delete-account: logout global falhou', e instanceof Error ? e.message : e);
  }
}

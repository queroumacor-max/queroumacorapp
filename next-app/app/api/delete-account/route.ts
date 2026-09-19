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
import { requireAuthStrict, getServiceKey, getSupabaseUrl, ServiceError, enforceRateLimit } from '@/lib/api/security';
import { logAuditEvent } from '@/lib/api/audit';
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
  try {
    const auth = await requireAuthStrict(request, body);
    userId = auth.user.id;
    email = auth.user.email ?? null;
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

  return NextResponse.json({ ok: true, deleted_at: now });
}

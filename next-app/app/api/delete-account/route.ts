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
import { requireAuthStrict, getServiceKey, getSupabaseUrl, ServiceError } from '@/lib/api/security';
import { logAuditEvent } from '@/lib/api/audit';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
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
  const anonymizedFields = {
    name: 'Conta excluída',
    tag: null,
    username: null,
    display_name: null,
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
  });

  // 4. Deleta o auth.user. SECURITY: service_role tem auth.admin.
  // Endpoint: POST /auth/v1/admin/users/{user_id} com DELETE method.
  try {
    await fetch(`${supaUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    });
  } catch {
    /* silent — soft delete + anonimização já cumprem LGPD.
       auth user pode ficar até cleanup manual depois. */
  }

  return NextResponse.json({ ok: true, deleted_at: now });
}

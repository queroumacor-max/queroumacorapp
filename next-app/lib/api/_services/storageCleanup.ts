// lib/api/_services/storageCleanup.ts
//
// Apaga os arquivos de um usuário nos buckets públicos onde o path segue a
// convenção `<uid>/...` (avatars, art-refs, posts — inclui logos gerados em
// `posts/<uid>/logos/`). Extraído de `/api/delete-account` (privacy audit
// 2026-09-17) pra ser reusado também pela exclusão de conta PELO ADMIN
// (`/api/admin/users`, action `cleanup_storage`) — a RPC `admin_delete_user`
// é SQL puro e não alcança a API de Storage de jeito nenhum.
//
// Best-effort de propósito: falha aqui nunca pode impedir/reverter uma
// exclusão de conta já feita no banco. Usa service_role (Storage list/remove
// exigem privilégio que nem o próprio admin logado tem via RLS — as policies
// de `storage.objects` são owner-only, sem bypass de `is_portal_admin()`).

const BUCKETS = ['avatars', 'art-refs', 'posts'] as const;

async function deleteUserStorageFolder(
  bucket: string,
  userId: string,
  supaUrl: string,
  headers: HeadersInit,
): Promise<void> {
  try {
    const listRes = await fetch(`${supaUrl}/storage/v1/object/list/${bucket}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }),
    });
    if (!listRes.ok) return;
    const items = (await listRes.json().catch(() => [])) as Array<{ name?: string }>;
    const paths = (Array.isArray(items) ? items : [])
      .map((it) => (typeof it.name === 'string' ? `${userId}/${it.name}` : null))
      .filter((p): p is string => !!p);
    if (paths.length === 0) return;
    await fetch(`${supaUrl}/storage/v1/object/remove/${bucket}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prefixes: paths }),
    });
  } catch {
    /* silent — best-effort, não bloqueia a exclusão de conta */
  }
}

/** Apaga os arquivos do usuário em avatars/art-refs/posts. Nunca lança. */
export async function cleanupUserStorage(
  userId: string,
  supaUrl: string,
  serviceKey: string,
): Promise<void> {
  const headers: HeadersInit = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  await Promise.all(
    BUCKETS.map((bucket) => deleteUserStorageFolder(bucket, userId, supaUrl, headers)),
  );
}

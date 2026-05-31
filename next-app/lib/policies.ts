// policies.ts — port de /policies.js para TS estrito.
// Autorização pura (RBAC + ownership). Decisões locais SEM DOM/rede:
// recebe `currentUser` + recurso, devolve boolean. Mantém a lógica de
// autorização testável e centralizada — useAuth() do AuthProvider injeta
// `user` que casa com o shape esperado aqui.

import { AuthorizationError } from './errors';
import type { Profile } from './types';

// PolicyUser é o subset de `Profile` que estas funções consomem. Tipado
// permissivo (tudo opcional) pra refletir como o frontend lê linhas de
// `profiles_public` (que pode não trazer todas as colunas).
export interface PolicyUser {
  id?: string;
  is_admin?: boolean | null;
  is_pro?: boolean | null;
  role?: string | null;
  name?: string | null;
  display_name?: string | null;
  tag?: string | null;
  username?: string | null;
  pro_expires_at?: string | null;
  pro_grace_until?: string | null;
}

// Aceita `Profile` direto ou o subset mais enxuto — facilita chamar com
// `user` vindo do AuthProvider que pode trazer só `id + email + tag`.
type MaybeUser = PolicyUser | Profile | null | undefined;

// Admin = is_admin true OU role 'admin'. Aceitamos os dois sinais porque
// o banco grava em colunas diferentes dependendo do path de promoção.
export function isAdmin(user: MaybeUser): boolean {
  if (!user) return false;
  return user.is_admin === true || user.role === 'admin';
}

// Edita próprio perfil; admin edita qualquer um (moderação/correção).
export function canEditProfile(
  user: MaybeUser,
  targetProfile: { id?: string } | null | undefined
): boolean {
  if (!user || !user.id || !targetProfile || !targetProfile.id) return false;
  if (user.id === targetProfile.id) return true;
  return isAdmin(user);
}

// Dono do post sempre pode deletar; admin sempre pode (moderação).
export function canDeletePost(
  user: MaybeUser,
  post: { id?: string; user_id?: string } | null | undefined
): boolean {
  if (!user || !user.id || !post) return false;
  if (post.user_id && user.id === post.user_id) return true;
  return isAdmin(user);
}

// Pintor edita seu próprio orçamento ENQUANTO ele está "vivo" — depois
// que o cliente aprovou/recusou/iniciou/concluiu, o orçamento vira histórico
// imutável (auditoria e contagem de status no painel do cliente).
// "Vivo" = status ∈ { pending, rascunho, enviado }. Mantém 'aceito' (rótulo
// legado) na lista de finais pra compat com linhas antigas.
export function canEditQuote(
  user: MaybeUser,
  quote: { painter_id?: string; status?: string | null } | null | undefined
): boolean {
  if (!user || !user.id || !quote) return false;
  if (user.id !== quote.painter_id) return false;
  const alive = ['pending', 'rascunho', 'enviado'];
  const status = quote.status || 'rascunho';
  return alive.indexOf(status) !== -1;
}

// Só o pintor avaliado pode responder à própria review. Admin NÃO
// responde em nome do pintor (seria forjar fala alheia).
export function canReplyToReview(
  user: MaybeUser,
  _review: unknown,
  painterId: string | null | undefined
): boolean {
  if (!user || !user.id || !painterId) return false;
  return user.id === painterId;
}

// Moderação (remover post, banir, esconder review) é só admin.
export function canModerateContent(user: MaybeUser): boolean {
  return isAdmin(user);
}

// Features PRO: liberadas para assinantes PRO e para admins (admin
// testa/dá suporte sem precisar de PRO próprio).
//
// Grace period (Pagamentos#17): se `pro_expires_at` já passou MAS
// `pro_grace_until` está no futuro, ainda considera ativo. Webhook MP
// preenche `pro_grace_until = pro_expires_at + 3 days` quando recebe um
// failed payment retry — dá margem pro usuário regularizar antes do PRO
// virar pumpkin. Server-side equivalente: RPC `is_pro_active(uuid)`.
//
// Quando o perfil vem da view `profiles_public` ou de uma fonte que NÃO
// projeta `pro_grace_until`, o campo vira undefined e o comportamento é
// idêntico ao anterior (fallback pra is_pro puro).
export function canSeeProFeature(user: MaybeUser): boolean {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (user.is_pro !== true) return false;
  const now = Date.now();
  // is_pro true: confere se a janela de validade ainda cobre — soma
  // expires_at OU grace_until (a maior). Se nenhum dos dois existe, o
  // banco confiou no is_pro=true → libera (legacy/admin path).
  const expiresAt = parseDate(user.pro_expires_at);
  const graceUntil = parseDate(
    (user as { pro_grace_until?: string | null }).pro_grace_until
  );
  if (expiresAt === null && graceUntil === null) return true;
  const futureOk = (expiresAt !== null && expiresAt > now) ||
                   (graceUntil !== null && graceUntil > now);
  return futureOk;
}

// Helper local: parse timestamp ISO → ms. Retorna null pra ausente/inválido.
function parseDate(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// Não pode seguir a si mesmo, e ambos os ids precisam existir.
export function canFollowUser(user: MaybeUser, targetUserId: string | null | undefined): boolean {
  if (!user || !user.id) return false;
  if (!targetUserId) return false;
  if (user.id === targetUserId) return false;
  return true;
}

// Criar post exige apenas estar logado. Moderação posterior decide
// se o post fica visível (status approved/pending no banco).
export function canCreatePost(user: MaybeUser): boolean {
  if (!user || !user.id) return false;
  return true;
}

// Mensageria exige perfil minimamente preenchido — sem nome o
// destinatário não consegue identificar quem está falando.
export function canSendMessage(user: MaybeUser): boolean {
  if (!user || !user.id) return false;
  const nome = user.name || user.display_name || user.tag || user.username;
  if (!nome) return false;
  return true;
}

// Painel admin é estritamente para admins.
export function canViewAdminPanel(user: MaybeUser): boolean {
  return isAdmin(user);
}

// Utility pra usar nos call sites: lança AuthorizationError se não autorizado.
// Diferente do vanilla (que lançava Error genérico), aqui usamos o erro
// tipado de errors.ts pra que o handler do route/action consiga classificar.
export function requireOrThrow(allowed: boolean, message?: string): void {
  if (!allowed) throw new AuthorizationError(message);
}

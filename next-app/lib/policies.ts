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
  post: { user_id?: string } | null | undefined
): boolean {
  if (!user || !user.id || !post) return false;
  if (post.user_id && user.id === post.user_id) return true;
  return isAdmin(user);
}

// Pintor edita seu próprio orçamento ENQUANTO ele está "vivo" — depois
// que o cliente aceitou/recusou/concluiu, o orçamento vira histórico
// imutável (auditoria e contagem de status no painel do cliente).
export function canEditQuote(
  user: MaybeUser,
  quote: { painter_id?: string; status?: string | null } | null | undefined
): boolean {
  if (!user || !user.id || !quote) return false;
  if (user.id !== quote.painter_id) return false;
  const finais = ['aceito', 'recusado', 'concluido'];
  if (finais.indexOf(quote.status || '') !== -1) return false;
  return true;
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
export function canSeeProFeature(user: MaybeUser): boolean {
  if (!user) return false;
  if (user.is_pro === true) return true;
  return isAdmin(user);
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

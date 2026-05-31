// types.ts — shared domain types for the Next.js port.
// Modeled on /supabase_init.sql tables (profiles, posts, follows, etc.).
// Kept hand-written (instead of generated from Supabase) because:
//   - The vanilla app has been live for months and the SQL has drifted in
//     incremental migrations; the generated `db.types.d.ts` in the repo
//     root reflects that, but we want a small, app-focused subset for the
//     Next.js port. We export deliberately permissive types (most fields
//     optional) to mirror how the vanilla code actually reads rows.

export type UserRole =
  | 'pintor'
  | 'grafiteiro'
  | 'automotivo'
  | 'cliente'
  | 'admin';

export type UserType = UserRole | string;

// Subset of `profiles` columns the app reads. Everything is optional because
// the row may come from `profiles_public` (view) which projects only a subset.
export interface Profile {
  id: string;
  name?: string | null;
  tag?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  role?: UserRole | string | null;
  user_type?: UserType | null;
  is_pro?: boolean | null;
  is_admin?: boolean | null;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  bio?: string | null;
  specialties?: string | null;
  profession?: string | null;
  rating_avg?: number | null;
  review_count?: number | null;
  lat?: number | null;
  lng?: number | null;
  portal_access?: boolean | null;
  business_logo_url?: string | null;
  business_name?: string | null;
  pro_expires_at?: string | null;
  created_at?: string | null;
}

// Status nullable porque posts antigos pré-moderação são `status IS NULL`.
export type PostStatus = 'approved' | 'pending' | 'rejected' | null;
export type PostMediaType = 'image' | 'video' | 'story' | string;

export interface Post {
  id: string;
  user_id: string;
  caption?: string | null;
  media_url?: string | null;
  media_type?: PostMediaType | null;
  status?: PostStatus;
  for_sale?: boolean | null;
  price?: number | null;
  art_type?: string | null;
  created_at: string;
}

export interface Follow {
  id?: string;
  follower_id: string;
  following_id: string;
  created_at?: string;
}

export interface Like {
  id?: string;
  user_id: string;
  post_id: string;
  created_at?: string;
}

export interface Comment {
  id: string;
  user_id: string;
  post_id: string;
  body: string;
  created_at: string;
}

export interface Order {
  id: string;
  user_id: string;
  total: number;
  status: string;
  created_at: string;
}

// Quote = orçamento. `status` segue o vocabulário em PT-BR usado pelo
// vanilla: rascunho → enviado → aceito|recusado|concluido.
export type QuoteStatus =
  | 'rascunho'
  | 'enviado'
  | 'aceito'
  | 'recusado'
  | 'concluido';

export interface Quote {
  id: string;
  painter_id: string;
  client_id?: string | null;
  status?: QuoteStatus | string;
  title?: string | null;
  service_type?: string | null;
  area_m2?: number | null;
  address?: string | null;
  description?: string | null;
  price?: number | null;
  proposed_date?: string | null;
  created_at?: string;
}

export interface Job {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  payload?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at: string;
}

// Result shape used pelo db facade quando o caller precisa diferenciar
// sucesso de erro (vs. funções `getXxx` que retornam null/[] degradado).
export interface MutationResult {
  ok: boolean;
  code?: string;
  message?: string;
}

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
  address?: string | null;
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
  service_radius?: number | null;
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

// Order = pedido da loja Cali Colors. O status original do schema (linha 1128
// supabase_init.sql) é o conjunto `pending|paid|amount_mismatch|refunded|canceled`,
// mas o app vanilla também usou rótulos antigos em PT (rascunho/enviado/entregue)
// em telas/mocks anteriores. Mantemos os dois grupos no union pra absorver
// histórico e linhas legadas sem quebrar o tipo.
export type OrderStatus =
  | 'rascunho'
  | 'pendente'
  | 'pago'
  | 'enviado'
  | 'entregue'
  | 'cancelado';

export interface OrderItem {
  product_id: string;
  name: string;
  qty: number;
  price: number;
}

export interface OrderShippingAddress {
  cep: string;
  rua: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface Order {
  id: string;
  user_id: string;
  // Aberto pra string porque o banco já carregou linhas com `pending`/`paid`
  // (em inglês) antes do union em PT ser adotado pelo frontend. UI mapeia
  // valores desconhecidos pra "pendente" como fallback.
  status: OrderStatus | string;
  items: OrderItem[];
  total: number;
  paid_amount?: number | null;
  shipping_address?: OrderShippingAddress | null;
  tracking_code?: string | null;
  created_at: string;
  updated_at?: string | null;
}

// Quote = orçamento. `status` segue o ciclo atual do banco
// (supabase_init.sql linha 1097+):
//   pending → rascunho → enviado → aprovado → em_execucao → concluido
//   (+ recusado).
// Mantemos `aceito` no union pra absorver rótulos legados gravados antes da
// migration; UI mapeia desconhecidos pro grupo "Rascunho" como fallback.
export type QuoteStatus =
  | 'pending'
  | 'rascunho'
  | 'enviado'
  | 'aprovado'
  | 'em_execucao'
  | 'concluido'
  | 'recusado'
  | 'aceito';

export interface QuoteSnapshot {
  frozen_at: string;
  service_type: string | null;
  title: string | null;
  area_m2: number | null;
  address: string | null;
  description: string | null;
  price: number;
  proposed_date: string | null;
  quote_data: unknown;
}

export interface Quote {
  id: string;
  painter_id: string;
  client_id?: string | null;
  client_name?: string | null;
  status?: QuoteStatus | string;
  title?: string | null;
  service_type?: string | null;
  area_m2?: number | null;
  address?: string | null;
  description?: string | null;
  price?: number | null;
  proposed_date?: string | null;
  sent_at?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  approval_method?: 'manual' | 'app' | string | null;
  approval_note?: string | null;
  completed_at?: string | null;
  scope_snapshot?: QuoteSnapshot | null;
  quote_data?: unknown;
  images?: string[] | null;
  created_at?: string;
  // Joined: profiles!client_id(name) — convenience for card display.
  client?: { name?: string | null } | null;
}

// Job = obra agendada no calendário do pintor (tabela `jobs`). Schema em
// supabase_init.sql linha 613+: painter_id, client_name, service_type,
// address, scheduled_date (date), scheduled_time (text livre tipo "14:30"),
// status (default 'agendado'), revenue, material_cost, notes.
// `status` é string aberto no banco, mas o app usa o union abaixo como
// vocabulário canônico — UI mapeia outros valores pra "agendado".
export type JobStatus = 'agendado' | 'em_andamento' | 'concluido' | 'cancelado';

export interface Job {
  id: string;
  painter_id: string;
  quote_id?: string | null;
  client_name?: string | null;
  service_type?: string | null;
  address?: string | null;
  scheduled_date?: string | null; // YYYY-MM-DD
  scheduled_time?: string | null; // texto livre, p. ex. "14:30"
  status: JobStatus | string;
  notes?: string | null;
  revenue?: number | null;
  material_cost?: number | null;
  created_at?: string | null;
}

// Input pra createJob — subset gravável pelo usuário (sem id/created_at/
// status default 'agendado'). painter_id vem do contexto do auth, não
// do form, pra evitar que UI grave em nome de outro pintor.
export interface JobInput {
  client_name: string;
  service_type?: string | null;
  address?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  notes?: string | null;
  revenue?: number | null;
  material_cost?: number | null;
}

// Notification — alinhado com o schema real em supabase_init.sql (linha
// 1008+): colunas `type, title, body, ref_id, read (boolean), actor_id`. A
// flag de leitura é boolean (`read`) e não timestamp — usamos `read=true`
// como sentinel "leu". O conjunto de `type` válidos vem de notify_user()
// (RPC SECURITY DEFINER) + do código do vanilla (modules/notif.js).
export type NotificationType =
  | 'like'
  | 'comment'
  | 'follow'
  | 'message'
  | 'quote_sent'
  | 'quote_approved'
  | 'order'
  | 'review'
  | 'announcement'
  | 'info'
  | 'system'
  | string; // string aberto pra absorver tipos novos sem quebrar build.

export interface Notification {
  id: string;
  user_id: string | null;
  actor_id?: string | null;
  type?: NotificationType | null;
  title?: string | null;
  body?: string | null;
  ref_id?: string | null;
  read?: boolean | null;
  created_at: string;
}

// Result shape used pelo db facade quando o caller precisa diferenciar
// sucesso de erro (vs. funções `getXxx` que retornam null/[] degradado).
export interface MutationResult {
  ok: boolean;
  code?: string;
  message?: string;
}

// Lead = post marcado com for_sale=true. Pintor PRO "compra" o lead criando
// uma quote pra ele (RLS força painter_id = auth.uid()). Esse shape é o que
// LeadsList consome — não inclui caminho de pagamento/pontos, isso vive na
// camada de service. Campos opcionais nullable refletem o schema real de
// `posts` (caption pode ser null, price pode estar vazio em legado).
export interface Lead {
  id: string;
  user_id: string; // cliente que postou o serviço
  caption: string | null;
  media_url: string | null;
  media_type: 'image' | 'video' | string | null;
  price?: number | null;
  art_type?: string | null;
  created_at: string;
}

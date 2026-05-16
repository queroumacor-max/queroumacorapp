-- ============================================
-- QueroUmaCor - Supabase Database Setup
-- Execute this in Supabase SQL Editor
-- ============================================

-- Products table (used by Cali Colors portal)
CREATE TABLE IF NOT EXISTS public.products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  code text,
  category text DEFAULT 'tintas',
  volume text DEFAULT '18L',
  price numeric DEFAULT 0,
  color_hex text DEFAULT '#c0622d',
  color_gradient text,
  stock integer DEFAULT 0,
  badge text,
  description text,
  line text DEFAULT 'Linha Premium',
  rendimento text DEFAULT '~10m²/L',
  demaos text DEFAULT '2',
  secagem text DEFAULT '2h',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Allow public read access to products
DROP POLICY IF EXISTS "Products are viewable by everyone" ON public.products;
CREATE POLICY "Products are viewable by everyone" ON public.products
  FOR SELECT USING (true);

-- Allow authenticated users to manage products (portal admin)
DROP POLICY IF EXISTS "Authenticated users can insert products" ON public.products;
CREATE POLICY "Authenticated users can insert products" ON public.products
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;
CREATE POLICY "Authenticated users can update products" ON public.products
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete products" ON public.products;
CREATE POLICY "Authenticated users can delete products" ON public.products
  FOR DELETE TO authenticated USING (true);

-- ============================================
-- Posts table (ensure insert policy exists)
-- ============================================
-- If posts table already exists, just ensure RLS policies allow inserts:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'posts' AND policyname = 'Users can insert own posts'
  ) THEN
    CREATE POLICY "Users can insert own posts" ON public.posts
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Ensure users can read posts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'posts' AND policyname = 'Posts are viewable by everyone'
  ) THEN
    CREATE POLICY "Posts are viewable by everyone" ON public.posts
      FOR SELECT USING (true);
  END IF;
END $$;

-- ============================================
-- Profiles table - ensure all columns exist
-- ============================================
-- Add missing columns if they don't exist
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN tag text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN email text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN city text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN state text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN phone text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN specialties text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN role text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN user_type text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN rating_avg numeric; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN lat numeric; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN lng numeric; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN invited_by uuid; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN invite_code_used text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN portal_access boolean DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN is_pro boolean DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN pro_expires_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN mp_preapproval_id text; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- Add status column to posts for content moderation
DO $$
BEGIN
  BEGIN ALTER TABLE public.posts ADD COLUMN status text DEFAULT 'approved'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.posts ADD COLUMN for_sale boolean DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.posts ADD COLUMN price numeric; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.posts ADD COLUMN art_type text; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- ============================================
-- Profiles table - ensure read/write works
-- ============================================
-- Funcao auxiliar: o caller atual tem portal_access? SECURITY DEFINER
-- ignora RLS de profiles, evitando recursao (42P17) quando usada em
-- policies da propria tabela profiles. Definida antes das policies.
CREATE OR REPLACE FUNCTION public.is_portal_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND portal_access = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_portal_admin() TO authenticated;

-- Allow everyone to read profiles (needed for search, feed, etc.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Profiles are viewable by everyone'
  ) THEN
    CREATE POLICY "Profiles are viewable by everyone" ON public.profiles
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can update own profile'
  ) THEN
    CREATE POLICY "Users can update own profile" ON public.profiles
      FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can insert own profile'
  ) THEN
    CREATE POLICY "Users can insert own profile" ON public.profiles
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
  END IF;
  -- Portal admins (portal_access = true) can update any profile.
  -- Needed for verificar pintor, promover a usuario do portal e revogar acesso.
  -- Usa funcao SECURITY DEFINER para evitar recursao infinita (42P17):
  -- uma policy em profiles que faz subquery em profiles entra em loop.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Portal admins can update any profile'
  ) THEN
    CREATE POLICY "Portal admins can update any profile" ON public.profiles
      FOR UPDATE TO authenticated
      USING (public.is_portal_admin())
      WITH CHECK (public.is_portal_admin());
  END IF;
END $$;

-- ============================================
-- Foreign key: posts.user_id -> profiles.id
-- (needed for Supabase embedded joins)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'posts_user_id_fkey' AND table_name = 'posts'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);
  END IF;
END $$;

-- ============================================
-- Follows table (needed for feed filtering)
-- ============================================
CREATE TABLE IF NOT EXISTS public.follows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(follower_id, following_id)
);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'follows' AND policyname = 'Follows are viewable by everyone'
  ) THEN
    CREATE POLICY "Follows are viewable by everyone" ON public.follows FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'follows' AND policyname = 'Users can manage own follows'
  ) THEN
    CREATE POLICY "Users can manage own follows" ON public.follows
      FOR ALL TO authenticated USING (auth.uid() = follower_id) WITH CHECK (auth.uid() = follower_id);
  END IF;
END $$;

-- ============================================
-- Likes table (needed for post likes)
-- ============================================
CREATE TABLE IF NOT EXISTS public.likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'likes' AND policyname = 'Likes are viewable by everyone'
  ) THEN
    CREATE POLICY "Likes are viewable by everyone" ON public.likes FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'likes' AND policyname = 'Users can manage own likes'
  ) THEN
    CREATE POLICY "Users can manage own likes" ON public.likes
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Comments table (post comments)
-- ============================================
CREATE TABLE IF NOT EXISTS public.comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'Comments are viewable by everyone'
  ) THEN
    CREATE POLICY "Comments are viewable by everyone" ON public.comments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'Users can insert own comments'
  ) THEN
    CREATE POLICY "Users can insert own comments" ON public.comments
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'Users can delete own comments'
  ) THEN
    CREATE POLICY "Users can delete own comments" ON public.comments
      FOR DELETE TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'comments' AND policyname = 'Post owners can delete comments'
  ) THEN
    CREATE POLICY "Post owners can delete comments" ON public.comments
      FOR DELETE TO authenticated USING (
        EXISTS (SELECT 1 FROM public.posts WHERE id = post_id AND user_id = auth.uid())
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comments_post_id ON public.comments(post_id);

-- ============================================
-- Saved posts table (bookmarks)
-- ============================================
CREATE TABLE IF NOT EXISTS public.saved_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, post_id)
);

ALTER TABLE public.saved_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saved_posts' AND policyname = 'Users can view own saved posts'
  ) THEN
    CREATE POLICY "Users can view own saved posts" ON public.saved_posts
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'saved_posts' AND policyname = 'Users can manage own saved posts'
  ) THEN
    CREATE POLICY "Users can manage own saved posts" ON public.saved_posts
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Storage: ensure 'posts' bucket exists
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('posts', 'posts', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to posts bucket
DROP POLICY IF EXISTS "Users can upload to posts bucket" ON storage.objects;
CREATE POLICY "Users can upload to posts bucket" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'posts');

-- Allow public read from posts bucket
DROP POLICY IF EXISTS "Public read posts bucket" ON storage.objects;
CREATE POLICY "Public read posts bucket" ON storage.objects
  FOR SELECT USING (bucket_id = 'posts');

-- Storage: ensure 'avatars' bucket exists
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to avatars bucket
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can upload avatars') THEN
  CREATE POLICY "Users can upload avatars" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
END IF;
END $$;

-- Allow public read from avatars bucket
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read avatars') THEN
  CREATE POLICY "Public read avatars" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');
END IF;
END $$;

-- Allow users to update/overwrite their own avatars
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Users can update own avatars') THEN
  CREATE POLICY "Users can update own avatars" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
END IF;
END $$;

-- ============================================
-- Announcements table (avisos do portal)
-- ============================================
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  message text NOT NULL,
  active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Announcements viewable by everyone" ON public.announcements;
CREATE POLICY "Announcements viewable by everyone" ON public.announcements
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage announcements" ON public.announcements;
CREATE POLICY "Authenticated users can manage announcements" ON public.announcements
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- Orders table (pedidos da loja)
-- ============================================
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  items jsonb DEFAULT '[]'::jsonb,
  total numeric DEFAULT 0,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own orders" ON public.orders;
CREATE POLICY "Users can create own orders" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can view all orders" ON public.orders;
CREATE POLICY "Authenticated users can view all orders" ON public.orders
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can update orders" ON public.orders;
CREATE POLICY "Authenticated users can update orders" ON public.orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- Messages table (ensure conversation_id and receiver_id exist)
-- ============================================
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id text,
  content text,
  type text DEFAULT 'text',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'Messages viewable by participants'
  ) THEN
    CREATE POLICY "Messages viewable by participants" ON public.messages
      FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'Users can send messages'
  ) THEN
    CREATE POLICY "Users can send messages" ON public.messages
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);
  END IF;
  -- Portal users (admin) can view ALL messages for Chats 3-Way
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'messages' AND policyname = 'Portal users can view all messages'
  ) THEN
    CREATE POLICY "Portal users can view all messages" ON public.messages
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

-- Enable Realtime for messages table (required for postgres_changes subscription)
-- REPLICA IDENTITY FULL is REQUIRED for Realtime + RLS to work together
-- Without it, Supabase cannot evaluate RLS policies on realtime events
ALTER TABLE public.messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- Index for faster conversation queries
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON public.messages(receiver_id);

-- ============================================
-- Reviews table (ensure it exists)
-- ============================================
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id uuid,
  rating integer,
  criteria jsonb DEFAULT '[]'::jsonb,
  comment text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reviews viewable by everyone" ON public.reviews;
CREATE POLICY "Reviews viewable by everyone" ON public.reviews
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can create reviews" ON public.reviews;
CREATE POLICY "Users can create reviews" ON public.reviews
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = reviewer_id);

-- ============================================
-- Quotes table (orçamentos)
-- ============================================
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  painter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text,
  service_type text,
  area_m2 numeric,
  address text,
  description text,
  proposed_date date,
  price numeric,
  status text DEFAULT 'pending',
  lead_type text DEFAULT 'shared',
  is_exclusive boolean DEFAULT false,
  commission_pct numeric DEFAULT 10,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'Quotes are viewable by everyone'
  ) THEN
    CREATE POLICY "Quotes are viewable by everyone" ON public.quotes
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'Users can insert own quotes'
  ) THEN
    CREATE POLICY "Users can insert own quotes" ON public.quotes
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = client_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'quotes' AND policyname = 'Users can update own quotes'
  ) THEN
    CREATE POLICY "Users can update own quotes" ON public.quotes
      FOR UPDATE TO authenticated
      USING (auth.uid() = client_id OR auth.uid() = painter_id)
      WITH CHECK (auth.uid() = client_id OR auth.uid() = painter_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_quotes_client_id ON public.quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_painter_id ON public.quotes(painter_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON public.quotes(status);

-- ============================================
-- Checklists table (listas de tarefas)
-- ============================================
CREATE TABLE IF NOT EXISTS public.checklists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id uuid,
  title text,
  items jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.checklists ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'checklists' AND policyname = 'Users can manage own checklists'
  ) THEN
    CREATE POLICY "Users can manage own checklists" ON public.checklists
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Jobs table (agenda de serviços)
-- ============================================
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  painter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id uuid,
  client_name text,
  service_type text,
  address text,
  scheduled_date date,
  scheduled_time text,
  status text DEFAULT 'agendado',
  notes text,
  revenue numeric DEFAULT 0,
  material_cost numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'jobs' AND policyname = 'Users can manage own jobs'
  ) THEN
    CREATE POLICY "Users can manage own jobs" ON public.jobs
      FOR ALL TO authenticated USING (auth.uid() = painter_id) WITH CHECK (auth.uid() = painter_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_painter_id ON public.jobs(painter_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON public.jobs(scheduled_date);

-- ============================================
-- Commissions table (comissões da plataforma)
-- ============================================
CREATE TABLE IF NOT EXISTS public.commissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid,
  quote_id uuid,
  painter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric,
  pct numeric,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'commissions' AND policyname = 'Users can view own commissions'
  ) THEN
    CREATE POLICY "Users can view own commissions" ON public.commissions
      FOR SELECT TO authenticated USING (auth.uid() = painter_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'commissions' AND policyname = 'Platform can manage all commissions'
  ) THEN
    CREATE POLICY "Platform can manage all commissions" ON public.commissions
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

-- ============================================
-- Points table (cashback / recompensas)
-- ============================================
CREATE TABLE IF NOT EXISTS public.points (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  amount integer,
  type text,
  source text,
  reference_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.points ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'points' AND policyname = 'Users can view own points'
  ) THEN
    CREATE POLICY "Users can view own points" ON public.points
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'points' AND policyname = 'Users can insert own points'
  ) THEN
    CREATE POLICY "Users can insert own points" ON public.points
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Referrals table (indicações pintor-a-pintor)
-- ============================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  referrer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id uuid,
  status text DEFAULT 'pending',
  bonus_points integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'referrals' AND policyname = 'Users can view own referrals'
  ) THEN
    CREATE POLICY "Users can view own referrals" ON public.referrals
      FOR SELECT TO authenticated USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
  END IF;
END $$;

-- ============================================
-- Auto-responses table (respostas automáticas)
-- ============================================
CREATE TABLE IF NOT EXISTS public.auto_responses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_type text,
  message_template text,
  is_active boolean DEFAULT true,
  delay_minutes integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.auto_responses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'auto_responses' AND policyname = 'Users can manage own auto responses'
  ) THEN
    CREATE POLICY "Users can manage own auto responses" ON public.auto_responses
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Follow-ups table (acompanhamentos agendados)
-- ============================================
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE,
  painter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_at timestamptz,
  message text,
  status text DEFAULT 'pending',
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'follow_ups' AND policyname = 'Users can manage own follow ups'
  ) THEN
    CREATE POLICY "Users can manage own follow ups" ON public.follow_ups
      FOR ALL TO authenticated USING (auth.uid() = painter_id) WITH CHECK (auth.uid() = painter_id);
  END IF;
END $$;

-- ============================================
-- Business logo (logo da empresa para a camiseta Cali Colors)
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN business_logo_url text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN business_name text; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- ============================================
-- Profession field (pintor / funileiro / grafiteiro)
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN profession text DEFAULT 'pintor'; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- ============================================
-- Qualifications (Formação) — itens do perfil profissional
-- ============================================
CREATE TABLE IF NOT EXISTS public.qualifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  org text,
  year text,
  icon text DEFAULT '🎓',
  created_at timestamptz DEFAULT now()
);
-- Caso a tabela já existisse com outra estrutura, garante as colunas:
ALTER TABLE public.qualifications ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.qualifications ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.qualifications ADD COLUMN IF NOT EXISTS org text;
ALTER TABLE public.qualifications ADD COLUMN IF NOT EXISTS year text;
ALTER TABLE public.qualifications ADD COLUMN IF NOT EXISTS icon text DEFAULT '🎓';
ALTER TABLE public.qualifications ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.qualifications ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='qualifications' AND policyname='Qualifications viewable by everyone') THEN
    CREATE POLICY "Qualifications viewable by everyone" ON public.qualifications FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='qualifications' AND policyname='Users manage own qualifications') THEN
    CREATE POLICY "Users manage own qualifications" ON public.qualifications
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Courses (Cursos) — cursos criados pelo profissional
-- ============================================
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  subtitle text,
  cover_url text,
  price numeric,
  is_free boolean DEFAULT false,
  duration text,
  link text,
  created_at timestamptz DEFAULT now()
);
-- Caso a tabela já existisse com outra estrutura, garante as colunas:
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS is_free boolean DEFAULT false;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS duration text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='courses' AND policyname='Courses viewable by everyone') THEN
    CREATE POLICY "Courses viewable by everyone" ON public.courses FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='courses' AND policyname='Users manage own courses') THEN
    CREATE POLICY "Users manage own courses" ON public.courses
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Índices de performance (escala) — idempotentes
-- ============================================
-- posts: feed, perfil, moderação
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON public.posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_status_created ON public.posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_mediatype_created ON public.posts(media_type, created_at DESC);
-- relações sociais
CREATE INDEX IF NOT EXISTS idx_follows_follower ON public.follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows(following_id);
CREATE INDEX IF NOT EXISTS idx_likes_post ON public.likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON public.likes(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_user ON public.saved_posts(user_id);
-- mensagens (created_at p/ ordenação das conversas)
CREATE INDEX IF NOT EXISTS idx_messages_sender_created ON public.messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver_created ON public.messages(receiver_id, created_at DESC);
-- perfil profissional
CREATE INDEX IF NOT EXISTS idx_qualifications_user ON public.qualifications(user_id);
CREATE INDEX IF NOT EXISTS idx_courses_user ON public.courses(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON public.reviews(reviewer_id);

-- ============================================
-- RPC: get_conversations() — agrega conversas no servidor
-- (substitui a agregação no cliente; escala melhor)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_conversations()
RETURNS TABLE (
  conv_id text,
  other_id uuid,
  last_msg text,
  last_msg_time timestamptz,
  last_sender uuid,
  is3way boolean,
  name text,
  avatar_url text,
  tag text,
  email text,
  role text,
  user_type text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (SELECT auth.uid() AS uid),
  msgs AS (
    SELECT m.content, m.created_at, m.sender_id, m.type,
      COALESCE(
        m.conversation_id::text,
        LEAST(m.sender_id::text, m.receiver_id::text) || '-' || GREATEST(m.sender_id::text, m.receiver_id::text)
      ) AS ckey,
      CASE WHEN m.sender_id = (SELECT uid FROM me) THEN m.receiver_id ELSE m.sender_id END AS oid
    FROM public.messages m, me
    WHERE m.sender_id = (SELECT uid FROM me) OR m.receiver_id = (SELECT uid FROM me)
  ),
  last_msg AS (
    SELECT DISTINCT ON (ckey) ckey, content, created_at, sender_id, oid
    FROM msgs
    ORDER BY ckey, created_at DESC
  ),
  flags AS (
    SELECT ckey, bool_or(type = 'system' AND content = '__STORE_ADDED__') AS is3way
    FROM msgs GROUP BY ckey
  )
  SELECT
    l.ckey AS conv_id,
    l.oid AS other_id,
    l.content AS last_msg,
    l.created_at AS last_msg_time,
    l.sender_id AS last_sender,
    COALESCE(f.is3way, false) AS is3way,
    p.name, p.avatar_url, p.tag, p.email, p.role, p.user_type
  FROM last_msg l
  LEFT JOIN flags f ON f.ckey = l.ckey
  LEFT JOIN public.profiles p ON p.id = l.oid
  ORDER BY l.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversations() TO authenticated;

-- ============================================
-- profiles.user_type check constraint
-- Portal admins are created with role='admin'; allow 'admin' (and the
-- known app roles) as a valid user_type so the auth.users trigger that
-- copies signup metadata into profiles does not violate the constraint.
-- ============================================
DO $$
BEGIN
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;

  -- Normaliza sinonimos conhecidos antes de aplicar o CHECK
  UPDATE public.profiles SET user_type = 'grafiteiro'
    WHERE lower(btrim(user_type)) IN ('graffiti','grafite','muralista','grafiteiro/muralista');
  UPDATE public.profiles SET user_type = 'automotivo'
    WHERE lower(btrim(user_type)) IN ('funilaria','automotiva','pintor automotivo');

  -- Qualquer valor ainda fora da lista (ex.: '', 'pro', lixo) vira NULL
  -- (o app e o portal tratam NULL como cliente)
  UPDATE public.profiles SET user_type = NULL
    WHERE user_type IS NOT NULL
      AND lower(btrim(user_type)) NOT IN
        ('cliente','pintor','grafiteiro','automotivo','funileiro','admin');

  ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_type_check
    CHECK (user_type IS NULL OR user_type IN ('cliente','pintor','grafiteiro','automotivo','funileiro','admin'));
END $$;

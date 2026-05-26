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
-- Profiles table - ensure it exists
-- ============================================
-- A tabela profiles pode ja existir; garante a estrutura minima.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  avatar_url text,
  profession text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Profiles table - ensure all columns exist
-- ============================================
-- Add missing columns if they don't exist
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN avatar_url text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN profession text; EXCEPTION WHEN duplicate_column THEN NULL; END;
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
-- Auto-criar profile ao registrar usuario (auth.users)
-- ============================================
-- "Database error saving new user" acontece quando o trigger de signup
-- falha e o GoTrue faz rollback do cadastro inteiro. Esta versao roda
-- como SECURITY DEFINER (ignora RLS), so preenche o minimo a partir do
-- metadata e NUNCA propaga erro: qualquer falha e capturada para que o
-- cadastro de autenticacao sempre conclua. O cliente completa o restante
-- do profile via upsert apos o signup.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (id, name, user_type, role, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      COALESCE(NEW.raw_user_meta_data->>'user_type', 'cliente'),
      COALESCE(NEW.raw_user_meta_data->>'user_type', 'cliente'),
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca bloquear o signup por causa do profile.
    RAISE WARNING 'handle_new_user falhou para %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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

  -- Canoniza TODA linha antes do CHECK (case-insensitive): valor valido
  -- minusculo/sem espacos, sinonimo mapeado, ou NULL. O CHECK e
  -- case-sensitive, entao 'Pintor' precisa virar 'pintor'.
  UPDATE public.profiles
  SET user_type = CASE
    WHEN lower(btrim(user_type)) IN
         ('cliente','pintor','grafiteiro','automotivo','funileiro','admin')
      THEN lower(btrim(user_type))
    WHEN lower(btrim(user_type)) IN
         ('graffiti','grafite','muralista','grafiteiro/muralista')
      THEN 'grafiteiro'
    WHEN lower(btrim(user_type)) IN
         ('funilaria','automotiva','pintor automotivo')
      THEN 'automotivo'
    ELSE NULL
  END
  WHERE user_type IS NOT NULL;

  ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_type_check
    CHECK (user_type IS NULL OR user_type IN ('cliente','pintor','grafiteiro','automotivo','funileiro','admin'));
END $$;

-- ============================================
-- Notes table (anotações do usuário)
-- ============================================
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  body text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'Users can manage own notes'
  ) THEN
    CREATE POLICY "Users can manage own notes" ON public.notes
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================
-- Notifications table (avisos do sininho)
-- ============================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text,
  title text,
  body text,
  ref_id text,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can view own notifications'
  ) THEN
    CREATE POLICY "Users can view own notifications" ON public.notifications
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can create notifications'
  ) THEN
    CREATE POLICY "Users can create notifications" ON public.notifications
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = actor_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can update own notifications'
  ) THEN
    CREATE POLICY "Users can update own notifications" ON public.notifications
      FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Realtime para o badge do sininho atualizar ao vivo
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- Realtime do Pipeline — novo orçamento aparece sem reabrir a tela
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- ============================================
-- Colunas que faltavam na tabela quotes (bancos antigos)
-- ============================================
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS area_m2 numeric,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS proposed_date date,
  ADD COLUMN IF NOT EXISTS price numeric,
  ADD COLUMN IF NOT EXISTS lead_type text DEFAULT 'shared',
  ADD COLUMN IF NOT EXISTS is_exclusive boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_pct numeric DEFAULT 10,
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS client_phone text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approval_method text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS scope_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS client_followup_optin boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_data jsonb,
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

-- ============================================
-- CHECK constraint do status no quotes (novo ciclo)
-- ============================================
-- Bancos antigos tinham um check apenas com 'pending/accepted/rejected/completed'.
-- O ciclo atual usa pending → rascunho → enviado → aprovado → em_execucao →
-- concluido (+ recusado). Mantém os legados pra compat.
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check
  CHECK (status IS NULL OR status IN (
    'pending','rascunho','enviado','aprovado','em_execucao','concluido','recusado',
    'accepted','completed','rejected'
  ));

-- ============================================
-- Colunas que faltavam na tabela reviews (bancos antigos)
-- ============================================
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS quote_id uuid,
  ADD COLUMN IF NOT EXISTS rating integer,
  ADD COLUMN IF NOT EXISTS criteria jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comment text;

-- ============================================
-- Orders: colunas para integração InfinitePay (gateway, tx, valor pago)
-- ============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS gateway        text,
  ADD COLUMN IF NOT EXISTS payment_url    text,
  ADD COLUMN IF NOT EXISTS tx_id          text,
  ADD COLUMN IF NOT EXISTS paid_amount    numeric,
  ADD COLUMN IF NOT EXISTS paid_at        timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS installments   integer,
  ADD COLUMN IF NOT EXISTS receipt_url    text;

-- Status pode ficar: pending | paid | amount_mismatch | refunded | canceled
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','paid','amount_mismatch','refunded','canceled'));

-- Index para o webhook achar a order rápido
CREATE INDEX IF NOT EXISTS idx_orders_tx_id ON public.orders(tx_id) WHERE tx_id IS NOT NULL;

-- ============================================================================
-- ============================================================================
-- SECURITY HARDENING (PÓS-LANÇAMENTO) — consolidação das baterias 1-4
-- ============================================================================
-- ============================================================================
-- Tudo daqui pra baixo foi rodado via chat durante as auditorias de segurança
-- (B1, B2, B3, B4 + re-auditoria). Persistido aqui pra que o repo seja
-- source-of-truth e o schema possa ser rerodado limpo.
-- IDEMPOTENTE: DROP IF EXISTS + CREATE OR REPLACE em tudo.
-- ============================================================================

-- ============================================================
-- B2 — Reviews: rating CHECK 1-5 + colunas idempotentes
-- ============================================================
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewer_id uuid,
  ADD COLUMN IF NOT EXISTS quote_id    uuid,
  ADD COLUMN IF NOT EXISTS rating      integer,
  ADD COLUMN IF NOT EXISTS criteria    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comment     text,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now();

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_rating_range;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_range
  CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5));

-- ============================================================
-- B2 — Protect profile columns (anti PRO/admin grátis no devtools)
-- ============================================================
DROP FUNCTION IF EXISTS public.protect_profile_columns() CASCADE;
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Bypass: SECURITY DEFINER (postgres) + service_role + portal admin
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF public.is_portal_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.is_pro IS DISTINCT FROM OLD.is_pro
     OR NEW.pro_expires_at IS DISTINCT FROM OLD.pro_expires_at THEN
    RAISE EXCEPTION 'PRO só pode ser alterado via RPC ou pagamento (não tente atalhos 🐻)';
  END IF;
  IF NEW.portal_access IS DISTINCT FROM OLD.portal_access THEN
    RAISE EXCEPTION 'portal_access só pode ser alterado por admin';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_profile_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- ============================================================
-- B2 — RPCs SECURITY DEFINER (quote, painter draft, review, PRO redeem)
-- ============================================================

-- create_quote_from_post: força client_id = auth.uid()
DROP FUNCTION IF EXISTS public.create_quote_from_post(uuid, uuid, text, text, numeric, text, text, date, jsonb, text);
CREATE OR REPLACE FUNCTION public.create_quote_from_post(
  p_painter_id    uuid,
  p_post_id       uuid,
  p_title         text,
  p_service_type  text,
  p_area_m2       numeric,
  p_address       text,
  p_description   text,
  p_proposed_date date,
  p_images        jsonb DEFAULT '[]'::jsonb,
  p_lead_type     text  DEFAULT 'direct'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para solicitar orçamento'; END IF;
  IF p_painter_id IS NOT NULL AND p_painter_id = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode pedir orçamento para si mesmo';
  END IF;
  INSERT INTO public.quotes (
    client_id, painter_id, title, service_type, area_m2, address,
    description, proposed_date, images, lead_type, status, created_at
  ) VALUES (
    auth.uid(), p_painter_id,
    COALESCE(NULLIF(TRIM(p_title), ''), 'Orçamento'),
    COALESCE(NULLIF(TRIM(p_service_type), ''), 'pintura'),
    p_area_m2, p_address, p_description, p_proposed_date,
    COALESCE(p_images, '[]'::jsonb),
    COALESCE(NULLIF(TRIM(p_lead_type), ''),
      CASE WHEN p_painter_id IS NULL THEN 'shared' ELSE 'direct' END),
    'pending', now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_quote_from_post(uuid, uuid, text, text, numeric, text, text, date, jsonb, text) TO authenticated;

-- create_painter_draft: força painter_id = auth.uid()
DROP FUNCTION IF EXISTS public.create_painter_draft(text, text, text, numeric, numeric, jsonb);
CREATE OR REPLACE FUNCTION public.create_painter_draft(
  p_client_name  text,
  p_service_type text,
  p_title        text,
  p_area_m2      numeric,
  p_price        numeric,
  p_quote_data   jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para salvar rascunho'; END IF;
  INSERT INTO public.quotes (
    painter_id, client_id, client_name, service_type, title,
    area_m2, price, status, quote_data, created_at
  ) VALUES (
    auth.uid(), NULL,
    COALESCE(NULLIF(TRIM(p_client_name), ''), 'Cliente'),
    COALESCE(NULLIF(TRIM(p_service_type), ''), 'Orçamento'),
    COALESCE(NULLIF(TRIM(p_title), ''), 'Orçamento'),
    p_area_m2, COALESCE(p_price, 0), 'rascunho',
    COALESCE(p_quote_data, '{}'::jsonb), now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_painter_draft(text, text, text, numeric, numeric, jsonb) TO authenticated;

-- submit_review: valida quote ownership + anti-duplicata
DROP FUNCTION IF EXISTS public.submit_review(uuid, uuid, integer, text, jsonb);
CREATE OR REPLACE FUNCTION public.submit_review(
  p_quote_id   uuid,
  p_painter_id uuid,
  p_rating     integer,
  p_comment    text  DEFAULT NULL,
  p_criteria   jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_owner uuid; v_painter uuid; v_dup integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login para avaliar'; END IF;
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'Nota tem que ser de 1 a 5';
  END IF;
  IF p_quote_id IS NOT NULL THEN
    SELECT client_id, painter_id INTO v_owner, v_painter FROM public.quotes WHERE id = p_quote_id;
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
    IF v_owner != auth.uid() THEN RAISE EXCEPTION 'Você só pode avaliar os próprios orçamentos'; END IF;
    IF p_painter_id IS NOT NULL AND v_painter IS NOT NULL AND p_painter_id != v_painter THEN
      RAISE EXCEPTION 'Painter informado não bate com o do orçamento';
    END IF;
    SELECT COUNT(*) INTO v_dup FROM public.reviews
      WHERE quote_id = p_quote_id AND reviewer_id = auth.uid();
    IF v_dup > 0 THEN RAISE EXCEPTION 'Você já avaliou este orçamento'; END IF;
  END IF;
  INSERT INTO public.reviews (reviewer_id, quote_id, rating, comment, criteria, created_at)
  VALUES (auth.uid(), p_quote_id, p_rating, p_comment, COALESCE(p_criteria, '[]'::jsonb), now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, uuid, integer, text, jsonb) TO authenticated;

-- redeem_pro_with_points: balance check + débito + ativação ATÔMICA + advisory lock
-- IMPORTANTE: o parâmetro p_cost é IGNORADO no corpo (hardcode 100). Sem isso,
-- cliente chamava sb.rpc('redeem_pro_with_points', { p_cost: 1 }) e ganhava
-- 30 dias PRO por 1 ponto.
DROP FUNCTION IF EXISTS public.redeem_pro_with_points(integer);
CREATE OR REPLACE FUNCTION public.redeem_pro_with_points(
  p_cost integer DEFAULT 100
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance integer := 0;
  v_current_exp timestamptz;
  v_new_exp timestamptz;
  v_real_cost integer := 100;  -- HARDCODED — ignora qualquer p_cost do cliente
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login'; END IF;
  -- Lock por user (serializa redeem paralelo — anti race condition)
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  SELECT COALESCE(SUM(CASE WHEN type = 'earned' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.points WHERE user_id = auth.uid();
  IF v_balance < v_real_cost THEN
    RAISE EXCEPTION 'Saldo insuficiente (tem %, precisa %)', v_balance, v_real_cost;
  END IF;
  SELECT pro_expires_at INTO v_current_exp FROM public.profiles WHERE id = auth.uid();
  v_new_exp := COALESCE(CASE WHEN v_current_exp > now() THEN v_current_exp ELSE now() END, now())
               + interval '30 days';
  INSERT INTO public.points (user_id, amount, type, source, created_at)
  VALUES (auth.uid(), v_real_cost, 'redeemed', 'pro_1mes', now());
  UPDATE public.profiles SET is_pro = true, pro_expires_at = v_new_exp WHERE id = auth.uid();
  RETURN v_new_exp;
END $$;
GRANT EXECUTE ON FUNCTION public.redeem_pro_with_points(integer) TO authenticated;

-- ============================================================
-- B2 — Cleanup de policies permissivas (quotes, reviews)
-- ============================================================
DROP POLICY IF EXISTS "Reviews viewable by everyone" ON public.reviews;
DROP POLICY IF EXISTS "Users can create reviews"     ON public.reviews;
DROP POLICY IF EXISTS "Quotes are viewable by everyone" ON public.quotes;
DROP POLICY IF EXISTS "Quotes viewable by everyone"     ON public.quotes;
DROP POLICY IF EXISTS "Painters can insert own quotes"  ON public.quotes;
DROP POLICY IF EXISTS "Users can insert own quotes"     ON public.quotes;
DROP POLICY IF EXISTS "Users can insert quotes"         ON public.quotes;
DROP POLICY IF EXISTS quotes_client_insert              ON public.quotes;

-- Quotes SELECT só pra partes ou admin (vazamento fechado)
DROP POLICY IF EXISTS quotes_own_read ON public.quotes;
CREATE POLICY quotes_own_read ON public.quotes
  FOR SELECT TO authenticated
  USING (
    auth.uid() = client_id
    OR auth.uid() = painter_id
    OR public.is_portal_admin()
  );

-- ============================================================
-- B3.1 — notify_user RPC + drop INSERT direto (anti spam in-app)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can create notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can create notifications"         ON public.notifications;

DROP FUNCTION IF EXISTS public.notify_user(uuid, text, text, text, uuid);
CREATE OR REPLACE FUNCTION public.notify_user(
  p_user_id uuid, p_type text, p_title text, p_body text, p_ref_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_caller uuid; v_ok boolean;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Faça login pra notificar'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_caller THEN RETURN NULL; END IF;
  SELECT (
    EXISTS(SELECT 1 FROM public.quotes
       WHERE (client_id = v_caller AND painter_id = p_user_id)
          OR (painter_id = v_caller AND client_id = p_user_id))
    OR EXISTS(SELECT 1 FROM public.messages
       WHERE (sender_id = v_caller AND receiver_id = p_user_id)
          OR (sender_id = p_user_id AND receiver_id = v_caller))
    OR public.is_portal_admin()
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'Sem relação com o destinatário (precisa quote ou conversa compartilhada)';
  END IF;
  INSERT INTO public.notifications (user_id, actor_id, type, title, body, ref_id, created_at)
  VALUES (p_user_id, v_caller, COALESCE(NULLIF(TRIM(p_type),''), 'info'),
          COALESCE(p_title, ''), COALESCE(p_body, ''), p_ref_id, now())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.notify_user(uuid, text, text, text, uuid) TO authenticated;

-- ============================================================
-- B3.2 — Points: triggers automáticos + drop INSERT direto
-- ============================================================
DROP POLICY IF EXISTS "Users can insert own points" ON public.points;

CREATE OR REPLACE FUNCTION public.award_quote_request_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.client_id, 5, 'earned', 'quote_request', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_award_quote_request_points ON public.quotes;
CREATE TRIGGER trg_award_quote_request_points
  AFTER INSERT ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.award_quote_request_points();

CREATE OR REPLACE FUNCTION public.award_quote_completed_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND NEW.painter_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.points WHERE source = 'quote_completed' AND reference_id = NEW.id) THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.painter_id, 15, 'earned', 'quote_completed', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_award_quote_completed_points ON public.quotes;
CREATE TRIGGER trg_award_quote_completed_points
  AFTER UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.award_quote_completed_points();

CREATE OR REPLACE FUNCTION public.award_order_paid_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pts integer;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.user_id IS NOT NULL THEN
    v_pts := FLOOR(COALESCE(NEW.total, 0) / 10)::integer;
    IF v_pts > 0 AND NOT EXISTS (SELECT 1 FROM public.points WHERE source = 'order_paid' AND reference_id = NEW.id) THEN
      INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
      VALUES (NEW.user_id, v_pts, 'earned', 'order_paid', NEW.id, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_award_order_paid_points ON public.orders;
CREATE TRIGGER trg_award_order_paid_points
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.award_order_paid_points();

-- ============================================================
-- B3.3 — avatar_url / posts.image_url scheme allowlist
-- ============================================================
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_scheme;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_url_scheme
  CHECK (
    avatar_url IS NULL
    OR avatar_url ~ '^https://'
    OR avatar_url ~ '^data:image/(png|jpeg|jpg|gif|webp);base64,'
  ) NOT VALID;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='posts' AND column_name='image_url') THEN
    ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_image_url_scheme;
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_image_url_scheme
      CHECK (
        image_url IS NULL
        OR image_url ~ '^https://'
        OR image_url ~ '^data:image/(png|jpeg|jpg|gif|webp);base64,'
      ) NOT VALID;
  END IF;
END $$;

-- ============================================================
-- B4.1 — Rate limiting (rate_limits + RPC check_rate_limit)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id      uuid NOT NULL,
  endpoint     text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, endpoint, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits(window_start);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid, p_endpoint text, p_limit integer DEFAULT 30, p_window_minutes integer DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_window timestamptz; v_count integer;
BEGIN
  v_window := date_trunc('minute', now());
  INSERT INTO public.rate_limits (user_id, endpoint, window_start, count)
  VALUES (p_user_id, p_endpoint, v_window, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'retry_after_seconds', GREATEST(1, 60 - EXTRACT(SECOND FROM now())::integer)
  );
END $$;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour'; END $$;
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;

-- ============================================================
-- B4.3 — Audit log (audit_events + triggers + RPC manual)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_events (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type    text NOT NULL,
  actor_id      uuid,
  target_id     uuid,
  target_table  text,
  target_row_id uuid,
  metadata      jsonb DEFAULT '{}'::jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_target  ON public.audit_events(target_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor   ON public.audit_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type_ts ON public.audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON public.audit_events(created_at DESC);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_admin_read ON public.audit_events;
CREATE POLICY audit_events_admin_read ON public.audit_events
  FOR SELECT TO authenticated USING (public.is_portal_admin());

CREATE OR REPLACE FUNCTION public.audit_profile_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_pro IS DISTINCT FROM OLD.is_pro OR NEW.pro_expires_at IS DISTINCT FROM OLD.pro_expires_at THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('pro_change', auth.uid(), NEW.id, 'profiles', NEW.id,
      jsonb_build_object('old_is_pro', OLD.is_pro, 'new_is_pro', NEW.is_pro,
        'old_expires_at', OLD.pro_expires_at, 'new_expires_at', NEW.pro_expires_at,
        'caller_role', current_user));
  END IF;
  IF NEW.portal_access IS DISTINCT FROM OLD.portal_access THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('portal_access_change', auth.uid(), NEW.id, 'profiles', NEW.id,
      jsonb_build_object('old', OLD.portal_access, 'new', NEW.portal_access, 'caller_role', current_user));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_profile_changes ON public.profiles;
CREATE TRIGGER trg_audit_profile_changes
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profile_changes();

CREATE OR REPLACE FUNCTION public.audit_order_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('paid', 'refunded', 'canceled', 'amount_mismatch') THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('order_status_change', auth.uid(), NEW.user_id, 'orders', NEW.id,
      jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status,
        'total', NEW.total, 'paid_amount', NEW.paid_amount, 'gateway', NEW.gateway,
        'tx_id', NEW.tx_id, 'caller_role', current_user));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_order_changes ON public.orders;
CREATE TRIGGER trg_audit_order_changes
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_order_changes();

CREATE OR REPLACE FUNCTION public.audit_points_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.type = 'redeemed'
     OR NEW.source NOT IN ('quote_request', 'quote_completed', 'order_paid', 'referral') THEN
    INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
    VALUES ('points_movement', auth.uid(), NEW.user_id, 'points', NEW.id,
      jsonb_build_object('amount', NEW.amount, 'type', NEW.type, 'source', NEW.source,
        'reference_id', NEW.reference_id, 'caller_role', current_user));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_points_insert ON public.points;
CREATE TRIGGER trg_audit_points_insert
  AFTER INSERT ON public.points
  FOR EACH ROW EXECUTE FUNCTION public.audit_points_insert();

DROP FUNCTION IF EXISTS public.audit_log_manual(text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public.audit_log_manual(
  p_event_type text, p_target_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Faça login'; END IF;
  IF NOT public.is_portal_admin() THEN RAISE EXCEPTION 'Só portal admin pode registrar evento manual'; END IF;
  INSERT INTO public.audit_events (event_type, actor_id, target_id, metadata)
  VALUES (COALESCE(NULLIF(TRIM(p_event_type), ''), 'manual'), auth.uid(), p_target_id, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.audit_log_manual(text, uuid, jsonb) TO authenticated;

-- ============================================================
-- B4.4 — Storage: bucket size + MIME + folder-prefix policies
-- ============================================================
UPDATE storage.buckets SET file_size_limit = 8388608,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
 WHERE id = 'posts';
UPDATE storage.buckets SET file_size_limit = 4194304,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
 WHERE id = 'avatars';

DROP POLICY IF EXISTS "Users can upload to posts bucket" ON storage.objects;
DROP POLICY IF EXISTS posts_user_insert ON storage.objects;
CREATE POLICY posts_user_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS posts_user_update ON storage.objects;
CREATE POLICY posts_user_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS posts_user_delete ON storage.objects;
CREATE POLICY posts_user_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'posts' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can upload avatars"     ON storage.objects;
DROP POLICY IF EXISTS "Users can update own avatars" ON storage.objects;
DROP POLICY IF EXISTS avatars_user_insert ON storage.objects;
CREATE POLICY avatars_user_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_user_update ON storage.objects;
CREATE POLICY avatars_user_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS avatars_user_delete ON storage.objects;
CREATE POLICY avatars_user_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Re-auditoria Onda 1 — products / orders / announcements / commissions
-- ============================================================

-- products: só portal admin altera catálogo
DROP POLICY IF EXISTS "Authenticated users can insert products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can update products" ON public.products;
DROP POLICY IF EXISTS "Authenticated users can delete products" ON public.products;
DROP POLICY IF EXISTS products_admin_insert ON public.products;
DROP POLICY IF EXISTS products_admin_update ON public.products;
DROP POLICY IF EXISTS products_admin_delete ON public.products;
CREATE POLICY products_admin_insert ON public.products
  FOR INSERT TO authenticated WITH CHECK (public.is_portal_admin());
CREATE POLICY products_admin_update ON public.products
  FOR UPDATE TO authenticated USING (public.is_portal_admin()) WITH CHECK (public.is_portal_admin());
CREATE POLICY products_admin_delete ON public.products
  FOR DELETE TO authenticated USING (public.is_portal_admin());

-- orders: drop "view all" + "update (true)" — só dono lê, só admin altera, webhook bypass via service_role
DROP POLICY IF EXISTS "Authenticated users can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Authenticated users can update orders"   ON public.orders;
DROP POLICY IF EXISTS orders_admin_view   ON public.orders;
DROP POLICY IF EXISTS orders_admin_update ON public.orders;
CREATE POLICY orders_admin_view ON public.orders
  FOR SELECT TO authenticated USING (public.is_portal_admin());
CREATE POLICY orders_admin_update ON public.orders
  FOR UPDATE TO authenticated USING (public.is_portal_admin()) WITH CHECK (public.is_portal_admin());

-- announcements: só admin escreve
DROP POLICY IF EXISTS "Authenticated users can manage announcements" ON public.announcements;
DROP POLICY IF EXISTS "announcements_all"        ON public.announcements;
DROP POLICY IF EXISTS announcements_public_read  ON public.announcements;
DROP POLICY IF EXISTS announcements_admin_write  ON public.announcements;
CREATE POLICY announcements_public_read ON public.announcements
  FOR SELECT USING (active = true);
CREATE POLICY announcements_admin_write ON public.announcements
  FOR ALL TO authenticated
  USING (public.is_portal_admin()) WITH CHECK (public.is_portal_admin());

-- commissions: troca subquery por is_portal_admin()
DROP POLICY IF EXISTS "Platform can manage all commissions" ON public.commissions;
DROP POLICY IF EXISTS commissions_admin_all ON public.commissions;
CREATE POLICY commissions_admin_all ON public.commissions
  FOR ALL TO authenticated
  USING (public.is_portal_admin()) WITH CHECK (public.is_portal_admin());

-- follows: impede self-follow (deleta lixo antes)
DELETE FROM public.follows WHERE follower_id = following_id;
ALTER TABLE public.follows DROP CONSTRAINT IF EXISTS follows_no_self;
ALTER TABLE public.follows
  ADD CONSTRAINT follows_no_self CHECK (follower_id <> following_id);

-- ============================================================
-- Re-auditoria Onda 1 — handle_new_user com allowlist de user_type
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_type text;
BEGIN
  v_user_type := LOWER(COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'user_type'), ''), 'cliente'));
  IF v_user_type NOT IN ('cliente','pintor','grafiteiro','automotivo') THEN
    v_user_type := 'cliente';
  END IF;
  BEGIN
    INSERT INTO public.profiles (id, name, user_type, role, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      v_user_type, v_user_type, now()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user falhou para %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

-- ============================================================
-- Re-auditoria de PAGAMENTO — hardening adicional
-- ============================================================

-- orders.tx_id UNIQUE (anti-replay de webhook + dupla creditação)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public' AND indexname='idx_orders_tx_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_orders_tx_unique
      ON public.orders(tx_id) WHERE tx_id IS NOT NULL;
  END IF;
END $$;

-- points.amount: bloqueia valores absurdos (admin comprometido não credita 999999)
ALTER TABLE public.points DROP CONSTRAINT IF EXISTS points_amount_sane;
ALTER TABLE public.points
  ADD CONSTRAINT points_amount_sane
  CHECK (amount IS NULL OR (amount >= 0 AND amount <= 10000));

-- award_order_paid_points com CAP em 100 pts/order + usa LEAST(total, paid_amount)
-- (anti admin fraud + admin não pode inflar total pra creditar mais pts)
CREATE OR REPLACE FUNCTION public.award_order_paid_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pts integer; v_base numeric;
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.user_id IS NOT NULL THEN
    -- Usa LEAST de total e paid_amount — anti-fraude (webhook MP é fonte de verdade)
    v_base := LEAST(
      COALESCE(NEW.total, 0),
      COALESCE(NEW.paid_amount, NEW.total, 0)
    );
    -- Cap em 100 pts por order
    v_pts := LEAST(100, FLOOR(v_base / 10)::integer);
    IF v_pts > 0
       AND NOT EXISTS (SELECT 1 FROM public.points WHERE source = 'order_paid' AND reference_id = NEW.id) THEN
      INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
      VALUES (NEW.user_id, v_pts, 'earned', 'order_paid', NEW.id, now());
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ============================================================
-- HARDENING FINAL (RE-AUDITORIA SEGURANÇA — fecha 10 itens)
-- ============================================================

-- 🔴 FIX 1: posts table — ENABLE RLS + policies UPDATE/DELETE
-- (Esquecido no hardening anterior. Sem isso, recrear DB do source = RLS off)
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posts_owner_update ON public.posts;
CREATE POLICY posts_owner_update ON public.posts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_portal_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_portal_admin());

DROP POLICY IF EXISTS posts_owner_delete ON public.posts;
CREATE POLICY posts_owner_delete ON public.posts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_portal_admin());

-- 🔴 FIX 2: award_quote_completed_points exige aprovação prévia
-- (Antes painter podia farmar pts auto-aprovando próprios quotes)
CREATE OR REPLACE FUNCTION public.award_quote_completed_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'concluido'
     AND OLD.status IS DISTINCT FROM 'concluido'
     AND OLD.status IN ('aprovado','em_execucao','accepted','completed')
     AND NEW.painter_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.points
        WHERE source = 'quote_completed' AND reference_id = NEW.id
     ) THEN
    INSERT INTO public.points (user_id, amount, type, source, reference_id, created_at)
    VALUES (NEW.painter_id, 15, 'earned', 'quote_completed', NEW.id, now());
  END IF;
  RETURN NEW;
END $$;

-- 🟠 FIX 3: profiles_public view (esconde phone/email/lat/lng do SELECT público)
-- Cliente deve migrar busca/feed pra essa view; o profile completo só pro dono + admin.
-- security_invoker = true: a view executa com a permissão de quem consulta.
CREATE OR REPLACE VIEW public.profiles_public WITH (security_invoker = true) AS
SELECT
  id, name, avatar_url, bio, tag, role, user_type, profession, specialties, palette,
  city, state, country, is_pro, verified, rating_avg, review_count,
  service_radius, created_at, portal_access
FROM public.profiles;
GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- 🟠 FIX 4: commissions CHECK constraints (amount sano + pct 0..100)
ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_amount_sane;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_amount_sane
  CHECK (amount IS NULL OR (amount >= 0 AND amount <= 100000));

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_pct_sane;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_pct_sane
  CHECK (commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 100));

-- 🟡 FIX 5: referrals INSERT policy + UNIQUE (anti dupla-indicação)
DROP POLICY IF EXISTS "Referred user can insert own referrals" ON public.referrals;
DROP POLICY IF EXISTS referrals_referred_insert ON public.referrals;
CREATE POLICY referrals_referred_insert ON public.referrals
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = referred_id AND referrer_id IS NOT NULL AND referrer_id <> auth.uid());

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_unique_pair;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_unique_pair UNIQUE (referrer_id, referred_id);

-- 🟡 FIX 6: Cleanup functions pra tabelas que crescem indefinidamente
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications WHERE created_at < now() - interval '90 days';
END $$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_notifications() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_audit_events()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Compliance LGPD: 1 ano de retenção
  DELETE FROM public.audit_events WHERE created_at < now() - interval '1 year';
END $$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_audit_events() TO service_role;

-- Pra agendar (rodar manualmente quando habilitar pg_cron):
-- SELECT cron.schedule('cleanup_notifications', '0 3 * * 0', 'SELECT public.cleanup_old_notifications()');
-- SELECT cron.schedule('cleanup_audit', '0 4 * * 0', 'SELECT public.cleanup_old_audit_events()');

-- 🟡 FIX 7: VALIDATE constraints que ficaram NOT VALID antes
-- Backfill defensivo: nulla URLs inválidas pré-existentes antes de validar
UPDATE public.profiles
   SET avatar_url = NULL
 WHERE avatar_url IS NOT NULL
   AND avatar_url !~ '^https://'
   AND avatar_url !~ '^data:image/(png|jpeg|jpg|gif|webp);base64,';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='posts' AND column_name='image_url') THEN
    UPDATE public.posts
       SET image_url = NULL
     WHERE image_url IS NOT NULL
       AND image_url !~ '^https://'
       AND image_url !~ '^data:image/(png|jpeg|jpg|gif|webp);base64,';
  END IF;
END $$;

-- Agora valida (idempotente: re-rodar é no-op)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_avatar_url_scheme;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'VALIDATE profiles_avatar_url_scheme falhou: %', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_image_url_scheme') THEN
    BEGIN
      ALTER TABLE public.posts VALIDATE CONSTRAINT posts_image_url_scheme;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'VALIDATE posts_image_url_scheme falhou: %', SQLERRM;
    END;
  END IF;
END $$;

-- ============================================================
-- LGPD COMPLIANCE — Wave Final (auditoria LGPD)
-- ============================================================

-- 🔴 LGPD #2 (Art. 6 II/VII): tighten SELECT em quotes + orders
DROP POLICY IF EXISTS "Quotes are viewable by everyone" ON public.quotes;
DROP POLICY IF EXISTS "Quotes viewable by everyone"     ON public.quotes;
DROP POLICY IF EXISTS "Authenticated users can view all orders" ON public.orders;

-- 🔴 LGPD #3 (Art. 18 VI, Art. 19): tabela de pedidos de exclusão SLA 15d
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz DEFAULT now(),
  status       text DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','rejected')),
  completed_at timestamptz,
  notes        text,
  UNIQUE (user_id)
);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deletion_request_own ON public.account_deletion_requests;
CREATE POLICY deletion_request_own ON public.account_deletion_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_portal_admin());

DROP FUNCTION IF EXISTS public.request_account_deletion(text);
CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faça login pra solicitar exclusão';
  END IF;
  INSERT INTO public.account_deletion_requests (user_id, notes)
  VALUES (auth.uid(), p_reason)
  ON CONFLICT (user_id) DO UPDATE
    SET requested_at = now(),
        notes = COALESCE(EXCLUDED.notes, account_deletion_requests.notes)
  RETURNING id INTO v_id;
  INSERT INTO public.audit_events (event_type, actor_id, target_id, target_table, target_row_id, metadata)
  VALUES ('account_deletion_request', auth.uid(), auth.uid(), 'account_deletion_requests', v_id,
          jsonb_build_object('reason', p_reason));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated;

-- 🟠 LGPD Art. 8 §1: evidência de consentimento
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consent_at      timestamptz,
  ADD COLUMN IF NOT EXISTS consent_version text;

-- 🟠 Cadastro: data de nascimento (sem bloqueio etário; apenas registro)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_date date;

-- 🟠 LGPD Art. 16: cleanup de retenção
CREATE OR REPLACE FUNCTION public.cleanup_old_messages()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.messages WHERE created_at < now() - interval '2 years';
END $$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_messages() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_old_quotes()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.quotes
   WHERE created_at < now() - interval '3 years'
     AND status IN ('concluido','recusado','canceled');
END $$;
GRANT EXECUTE ON FUNCTION public.cleanup_old_quotes() TO service_role;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 🟢 WAVE 3: Hardening pós-auditoria 26/05
-- ════════════════════════════════════════════════════════════════════

-- 🔴 FIX 1: protect_profile_columns também em INSERT (evita escalada via INSERT)
-- O trigger atual só dispara em UPDATE. Quem fizer INSERT com portal_access=true
-- contorna a proteção. Recriar como BEFORE INSERT OR UPDATE.
DROP TRIGGER IF EXISTS protect_profile_columns ON public.profiles;
CREATE TRIGGER protect_profile_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_columns();

-- Ajuste da função para aceitar TG_OP = 'INSERT' também
CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_role text;
BEGIN
  caller_role := current_setting('role', true);
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_pro = true OR NEW.portal_access = true OR NEW.role = 'admin' THEN
      IF caller_role IS DISTINCT FROM 'service_role' AND auth.role() IS DISTINCT FROM 'service_role' THEN
        NEW.is_pro := false;
        NEW.portal_access := false;
        IF NEW.role = 'admin' THEN NEW.role := 'cliente'; END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: bloquear escalada
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF OLD.is_pro IS DISTINCT FROM NEW.is_pro THEN NEW.is_pro := OLD.is_pro; END IF;
    IF OLD.portal_access IS DISTINCT FROM NEW.portal_access THEN NEW.portal_access := OLD.portal_access; END IF;
    IF OLD.role IS DISTINCT FROM NEW.role AND NEW.role = 'admin' THEN NEW.role := OLD.role; END IF;
  END IF;
  RETURN NEW;
END $$;

-- 🟠 FIX 2: UNIQUE em points(source, reference_id) — anti double-credit em race
CREATE UNIQUE INDEX IF NOT EXISTS idx_points_source_ref
  ON public.points(source, reference_id)
  WHERE reference_id IS NOT NULL;

-- 🟠 FIX 3: Restringir leitura de grafo social a authenticated (sem anon enumerar)
DROP POLICY IF EXISTS "follows_select_all" ON public.follows;
DROP POLICY IF EXISTS "Users can view all follows" ON public.follows;
CREATE POLICY "follows_select_auth" ON public.follows
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "likes_select_all" ON public.likes;
DROP POLICY IF EXISTS "Users can view all likes" ON public.likes;
CREATE POLICY "likes_select_auth" ON public.likes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "comments_select_all" ON public.comments;
DROP POLICY IF EXISTS "Users can view all comments" ON public.comments;
CREATE POLICY "comments_select_auth" ON public.comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "qualifications_select_all" ON public.qualifications;
CREATE POLICY "qualifications_select_auth" ON public.qualifications
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "courses_select_all" ON public.courses;
CREATE POLICY "courses_select_auth" ON public.courses
  FOR SELECT TO authenticated USING (true);

-- 🟠 FIX 4: announcements — esconder created_by para não-admin
-- Manter SELECT público mas via uma view que omite created_by
DROP POLICY IF EXISTS "Announcements are viewable by everyone" ON public.announcements;
CREATE POLICY "announcements_select_active" ON public.announcements
  FOR SELECT USING (active = true);

CREATE OR REPLACE VIEW public.announcements_public WITH (security_invoker = true) AS
SELECT id, title, message, active, created_at
FROM public.announcements;
GRANT SELECT ON public.announcements_public TO anon, authenticated;

-- 🟢 FIX 5: rate_limits — deny-all explícita por defense-in-depth
DROP POLICY IF EXISTS "rate_limits_deny" ON public.rate_limits;
CREATE POLICY "rate_limits_deny" ON public.rate_limits
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 🟢 FIX 6: reviews — restaurar SELECT público se foi droppada por engano
DROP POLICY IF EXISTS "reviews_select_public" ON public.reviews;
CREATE POLICY "reviews_select_public" ON public.reviews
  FOR SELECT USING (true);

-- 🟢 FIX 7: FK ON DELETE em announcements.created_by
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_created_by_fkey;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ════════════════════════════════════════════════════════════════════
-- 🟢 WAVE 4: Tabelas faltantes (bugs do code-vs-schema)
-- ════════════════════════════════════════════════════════════════════

-- 🔴 Bug fix: reports (denúncias) — app.js submitReport() inseria em tabela inexistente
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','reviewed','resolved','dismissed')),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reports_insert_auth" ON public.reports;
CREATE POLICY "reports_insert_auth" ON public.reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());
DROP POLICY IF EXISTS "reports_select_own" ON public.reports;
CREATE POLICY "reports_select_own" ON public.reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_per_post
  ON public.reports(reporter_id, post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON public.reports(status, created_at DESC);

-- 🟠 Bug fix: feature_interest (métrica de "em breve" da Maquininha)
CREATE TABLE IF NOT EXISTS public.feature_interest (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  action text NOT NULL,
  contact text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.feature_interest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feature_interest_insert_auth" ON public.feature_interest;
CREATE POLICY "feature_interest_insert_auth" ON public.feature_interest FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);
CREATE INDEX IF NOT EXISTS idx_feature_interest_feature_created
  ON public.feature_interest(feature, created_at DESC);

-- ============================================
-- QueroUmaCor - Supabase Phase 2 Migrations
-- Commercial features: analytics, subscriptions,
-- lead boosts, slugs, referrals, marketplace, ads
-- ============================================
-- Execute this in Supabase SQL Editor AFTER supabase_init.sql
-- All migrations are idempotent (safe to run multiple times)
-- ============================================


-- ============================================
-- PHASE 1 - FOUNDATION
-- ============================================

-- ============================================
-- 1. analytics_events: funnel tracking
-- ============================================
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  event_name text NOT NULL,
  event_props jsonb DEFAULT '{}'::jsonb,
  page text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Anyone (anon + authenticated) can insert events (funnel tracking)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'analytics_events' AND policyname = 'Anyone can insert analytics events'
  ) THEN
    CREATE POLICY "Anyone can insert analytics events" ON public.analytics_events
      FOR INSERT WITH CHECK (true);
  END IF;
  -- Only portal_access=true users can read events
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'analytics_events' AND policyname = 'Portal users can view analytics'
  ) THEN
    CREATE POLICY "Portal users can view analytics" ON public.analytics_events
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_name ON public.analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON public.analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON public.analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session_id ON public.analytics_events(session_id);


-- ============================================
-- 2. profiles: subscription columns
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN subscription_tier text DEFAULT 'free'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN subscription_status text DEFAULT 'inactive'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN subscription_started_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN subscription_ends_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN trial_ends_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN payment_provider text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN payment_customer_id text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN grandfather_price numeric; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_tier ON public.profiles(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status ON public.profiles(subscription_status);


-- ============================================
-- 3. subscription_events: plan change history
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_tier text,
  to_tier text,
  amount numeric,
  provider text,
  provider_ref text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscription_events' AND policyname = 'Users can view own subscription events'
  ) THEN
    CREATE POLICY "Users can view own subscription events" ON public.subscription_events
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscription_events' AND policyname = 'Portal can manage subscription events'
  ) THEN
    CREATE POLICY "Portal can manage subscription events" ON public.subscription_events
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscription_events' AND policyname = 'Users can insert own subscription events'
  ) THEN
    CREATE POLICY "Users can insert own subscription events" ON public.subscription_events
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON public.subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_event_type ON public.subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_subscription_events_created_at ON public.subscription_events(created_at);


-- ============================================
-- PHASE 2 - REVENUE
-- ============================================

-- ============================================
-- 4. lead_boosts: painter buys exclusive lead
-- ============================================
CREATE TABLE IF NOT EXISTS public.lead_boosts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  painter_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  status text DEFAULT 'pending',
  provider_ref text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.lead_boosts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lead_boosts' AND policyname = 'Painters can view own lead boosts'
  ) THEN
    CREATE POLICY "Painters can view own lead boosts" ON public.lead_boosts
      FOR SELECT TO authenticated USING (auth.uid() = painter_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lead_boosts' AND policyname = 'Painters can insert own lead boosts'
  ) THEN
    CREATE POLICY "Painters can insert own lead boosts" ON public.lead_boosts
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = painter_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'lead_boosts' AND policyname = 'Portal can manage lead boosts'
  ) THEN
    CREATE POLICY "Portal can manage lead boosts" ON public.lead_boosts
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lead_boosts_painter_id ON public.lead_boosts(painter_id);
CREATE INDEX IF NOT EXISTS idx_lead_boosts_quote_id ON public.lead_boosts(quote_id);
CREATE INDEX IF NOT EXISTS idx_lead_boosts_status ON public.lead_boosts(status);


-- ============================================
-- 5. quotes: boost columns
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.quotes ADD COLUMN boosted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.quotes ADD COLUMN boost_expires_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_quotes_boosted_by ON public.quotes(boosted_by);


-- ============================================
-- 6. plan_pricing: seedable pricing table
-- ============================================
CREATE TABLE IF NOT EXISTS public.plan_pricing (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tier text UNIQUE NOT NULL,
  name text NOT NULL,
  price_monthly numeric DEFAULT 0,
  price_yearly numeric DEFAULT 0,
  commission_pct numeric DEFAULT 0,
  features jsonb DEFAULT '[]'::jsonb,
  max_leads_per_day int,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.plan_pricing ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'plan_pricing' AND policyname = 'Plan pricing viewable by everyone'
  ) THEN
    CREATE POLICY "Plan pricing viewable by everyone" ON public.plan_pricing
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'plan_pricing' AND policyname = 'Portal can manage plan pricing'
  ) THEN
    CREATE POLICY "Portal can manage plan pricing" ON public.plan_pricing
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
-- PHASE 3 - GROWTH
-- ============================================

-- ============================================
-- 7. profile_slugs: SEO URLs (/p/joao-sp)
-- ============================================
CREATE TABLE IF NOT EXISTS public.profile_slugs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL,
  city_slug text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profile_slugs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profile_slugs' AND policyname = 'Profile slugs viewable by everyone'
  ) THEN
    CREATE POLICY "Profile slugs viewable by everyone" ON public.profile_slugs
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profile_slugs' AND policyname = 'Users can insert own slug'
  ) THEN
    CREATE POLICY "Users can insert own slug" ON public.profile_slugs
      FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profile_slugs' AND policyname = 'Users can update own slug'
  ) THEN
    CREATE POLICY "Users can update own slug" ON public.profile_slugs
      FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profile_slugs_slug ON public.profile_slugs(slug);
CREATE INDEX IF NOT EXISTS idx_profile_slugs_city_slug ON public.profile_slugs(city_slug);


-- ============================================
-- 8. referrals: 2-sided referral fields
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.referrals ADD COLUMN referral_code text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.referrals ADD COLUMN reward_amount numeric DEFAULT 20; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.referrals ADD COLUMN reward_status text DEFAULT 'pending'; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.referrals ADD COLUMN reward_paid_at timestamptz; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.referrals ADD COLUMN source text DEFAULT 'painter'; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_referrals_referral_code ON public.referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_reward_status ON public.referrals(reward_status);


-- ============================================
-- 9. profiles: referral_code + credit
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.profiles ADD COLUMN referral_code text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.profiles ADD COLUMN referral_credit numeric DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

-- Unique constraint on referral_code (only if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_referral_code_key'
  ) THEN
    BEGIN
      ALTER TABLE public.profiles ADD CONSTRAINT profiles_referral_code_key UNIQUE (referral_code);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);


-- ============================================
-- Function + trigger: auto-generate referral_code on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_code text;
  attempts int := 0;
BEGIN
  IF NEW.referral_code IS NOT NULL AND NEW.referral_code <> '' THEN
    RETURN NEW;
  END IF;
  LOOP
    new_code := substring(md5(random()::text || clock_timestamp()::text) from 1 for 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = new_code);
    attempts := attempts + 1;
    EXIT WHEN attempts > 10;
  END LOOP;
  NEW.referral_code := new_code;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_profiles_generate_referral_code'
  ) THEN
    CREATE TRIGGER trg_profiles_generate_referral_code
      BEFORE INSERT ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.generate_referral_code();
  END IF;
END $$;

-- Backfill referral_code for existing profiles without one
UPDATE public.profiles
SET referral_code = substring(md5(random()::text || id::text) from 1 for 8)
WHERE referral_code IS NULL;


-- ============================================
-- PHASE 4 - MARKETPLACE & B2B
-- ============================================

-- ============================================
-- 10. cart_abandoned: recovery tracking
-- ============================================
CREATE TABLE IF NOT EXISTS public.cart_abandoned (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  items jsonb DEFAULT '[]'::jsonb,
  total numeric DEFAULT 0,
  recovered boolean DEFAULT false,
  notified_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.cart_abandoned ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cart_abandoned' AND policyname = 'Users can view own abandoned carts'
  ) THEN
    CREATE POLICY "Users can view own abandoned carts" ON public.cart_abandoned
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cart_abandoned' AND policyname = 'Users can manage own abandoned carts'
  ) THEN
    CREATE POLICY "Users can manage own abandoned carts" ON public.cart_abandoned
      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cart_abandoned' AND policyname = 'Portal can view all abandoned carts'
  ) THEN
    CREATE POLICY "Portal can view all abandoned carts" ON public.cart_abandoned
      FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cart_abandoned_user_id ON public.cart_abandoned(user_id);
CREATE INDEX IF NOT EXISTS idx_cart_abandoned_recovered ON public.cart_abandoned(recovered);
CREATE INDEX IF NOT EXISTS idx_cart_abandoned_created_at ON public.cart_abandoned(created_at);


-- ============================================
-- 11. product_bundles: combos
-- ============================================
CREATE TABLE IF NOT EXISTS public.product_bundles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  product_ids uuid[] DEFAULT '{}',
  price numeric DEFAULT 0,
  discount_pct numeric DEFAULT 0,
  active boolean DEFAULT true,
  image_url text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_bundles' AND policyname = 'Product bundles viewable by everyone'
  ) THEN
    CREATE POLICY "Product bundles viewable by everyone" ON public.product_bundles
      FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_bundles' AND policyname = 'Portal can manage product bundles'
  ) THEN
    CREATE POLICY "Portal can manage product bundles" ON public.product_bundles
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_product_bundles_active ON public.product_bundles(active);


-- ============================================
-- 12. orders: shipping/coupon/discount columns
-- ============================================
DO $$
BEGIN
  BEGIN ALTER TABLE public.orders ADD COLUMN shipping_cost numeric DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD COLUMN free_shipping_applied boolean DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD COLUMN coupon_code text; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD COLUMN discount_amount numeric DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END;
  BEGIN ALTER TABLE public.orders ADD COLUMN bundle_id uuid; EXCEPTION WHEN duplicate_column THEN NULL; END;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_coupon_code ON public.orders(coupon_code);
CREATE INDEX IF NOT EXISTS idx_orders_bundle_id ON public.orders(bundle_id);


-- ============================================
-- 13. coupons
-- ============================================
CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  type text NOT NULL,
  value numeric DEFAULT 0,
  min_order numeric DEFAULT 0,
  max_uses int,
  uses_count int DEFAULT 0,
  valid_until timestamptz,
  active boolean DEFAULT true,
  applies_to text DEFAULT 'all',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Anyone can read active coupons (needed for redemption validation)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'coupons' AND policyname = 'Active coupons viewable by everyone'
  ) THEN
    CREATE POLICY "Active coupons viewable by everyone" ON public.coupons
      FOR SELECT USING (active = true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'coupons' AND policyname = 'Portal can manage coupons'
  ) THEN
    CREATE POLICY "Portal can manage coupons" ON public.coupons
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON public.coupons(active);


-- ============================================
-- 14. sponsored_ads: paid placements
-- ============================================
CREATE TABLE IF NOT EXISTS public.sponsored_ads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sponsor_name text NOT NULL,
  image_url text,
  target_url text,
  placement text,
  starts_at timestamptz,
  ends_at timestamptz,
  impressions_count int DEFAULT 0,
  clicks_count int DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sponsored_ads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sponsored_ads' AND policyname = 'Active sponsored ads viewable by everyone'
  ) THEN
    CREATE POLICY "Active sponsored ads viewable by everyone" ON public.sponsored_ads
      FOR SELECT USING (active = true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sponsored_ads' AND policyname = 'Portal can manage sponsored ads'
  ) THEN
    CREATE POLICY "Portal can manage sponsored ads" ON public.sponsored_ads
      FOR ALL TO authenticated
      USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      )
      WITH CHECK (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND portal_access = true)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sponsored_ads_active ON public.sponsored_ads(active);
CREATE INDEX IF NOT EXISTS idx_sponsored_ads_placement ON public.sponsored_ads(placement);


-- ============================================
-- SEED DATA: plan_pricing (4 tiers)
-- Uses INSERT ... ON CONFLICT (tier) DO UPDATE so re-runs refresh values
-- ============================================
INSERT INTO public.plan_pricing (tier, name, price_monthly, price_yearly, commission_pct, max_leads_per_day, features, is_active)
VALUES
  (
    'free', 'Free', 0, 0, 15, 3,
    '{"boost": false, "badge": false, "leads": "3/dia", "support": "comunidade", "description": "Comece grátis e teste a plataforma"}'::jsonb,
    true
  ),
  (
    'pro', 'PRO', 39, 390, 8, NULL,
    '{"boost": false, "badge": true, "leads": "ilimitado", "support": "prioritario", "description": "Leads ilimitados, badge PRO e comissão reduzida"}'::jsonb,
    true
  ),
  (
    'premium', 'Premium', 89, 890, 5, NULL,
    '{"boost": true, "boosts_included": 5, "badge": true, "leads": "ilimitado", "support": "prioritario", "description": "5 boosts inclusos/mês + comissão menor"}'::jsonb,
    true
  ),
  (
    'studio', 'Studio', 199, 1990, 3, NULL,
    '{"boost": true, "multi_profile": true, "priority": "absoluta", "badge": true, "leads": "ilimitado", "support": "dedicado", "description": "Multi-perfil, prioridade absoluta, menor comissão"}'::jsonb,
    true
  )
ON CONFLICT (tier) DO UPDATE SET
  name = EXCLUDED.name,
  price_monthly = EXCLUDED.price_monthly,
  price_yearly = EXCLUDED.price_yearly,
  commission_pct = EXCLUDED.commission_pct,
  max_leads_per_day = EXCLUDED.max_leads_per_day,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active;


-- ============================================
-- END OF PHASE 2 MIGRATIONS
-- ============================================

// Hand-written Supabase-style schema types for the QueroUmaCor database.
// Derived from supabase_init.sql (CREATE TABLE + ALTER TABLE statements) and
// columns documented in CLAUDE.md as "JA FOI EXECUTADO" in the live Supabase
// project but not present in supabase_init.sql.
//
// Mirrors the shape that `supabase gen types typescript` would produce so that
// VS Code / tsserver picks it up via jsconfig.json (allowJs + .d.ts include).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      // ============================================================
      // products — catálogo Cali Colors
      // ============================================================
      products: {
        Row: {
          id: string;
          name: string;
          code: string | null;
          category: string | null;
          volume: string | null;
          price: number | null;
          color_hex: string | null;
          color_gradient: string | null;
          stock: number | null;
          badge: string | null;
          description: string | null;
          line: string | null;
          rendimento: string | null;
          demaos: string | null;
          secagem: string | null;
          active: boolean | null;
          created_at: string | null;
          // CLAUDE.md: products.image_url já criado no Supabase
          image_url: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          code?: string | null;
          category?: string | null;
          volume?: string | null;
          price?: number | null;
          color_hex?: string | null;
          color_gradient?: string | null;
          stock?: number | null;
          badge?: string | null;
          description?: string | null;
          line?: string | null;
          rendimento?: string | null;
          demaos?: string | null;
          secagem?: string | null;
          active?: boolean | null;
          created_at?: string | null;
          image_url?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string | null;
          category?: string | null;
          volume?: string | null;
          price?: number | null;
          color_hex?: string | null;
          color_gradient?: string | null;
          stock?: number | null;
          badge?: string | null;
          description?: string | null;
          line?: string | null;
          rendimento?: string | null;
          demaos?: string | null;
          secagem?: string | null;
          active?: boolean | null;
          created_at?: string | null;
          image_url?: string | null;
        };
      };

      // ============================================================
      // profiles — usuários (1-1 com auth.users)
      // ============================================================
      profiles: {
        Row: {
          id: string;
          name: string | null;
          avatar_url: string | null;
          profession: string | null;
          tag: string | null;
          email: string | null;
          city: string | null;
          state: string | null;
          phone: string | null;
          specialties: string | null;
          role: string | null;
          user_type: string | null;
          rating_avg: number | null;
          lat: number | null;
          lng: number | null;
          invited_by: string | null;
          invite_code_used: string | null;
          portal_access: boolean | null;
          is_pro: boolean | null;
          pro_expires_at: string | null;
          mp_preapproval_id: string | null;
          business_logo_url: string | null;
          business_name: string | null;
          consent_at: string | null;
          consent_version: string | null;
          birth_date: string | null;
          created_at: string | null;
          // Colunas adicionadas via SQL waves (CLAUDE.md JA FOI EXECUTADO):
          service_radius: number | null;
          archived_conversations: Json | null;
          cart: Json | null;
          ai_logo_gen_count: number | null;
          seen_stories: Json | null;
          review_count: number | null;
          // Referenciadas pela view profiles_public — assumir existência no live DB:
          bio: string | null;
          country: string | null;
          verified: boolean | null;
          palette: Json | null;
        };
        Insert: {
          id: string;
          name?: string | null;
          avatar_url?: string | null;
          profession?: string | null;
          tag?: string | null;
          email?: string | null;
          city?: string | null;
          state?: string | null;
          phone?: string | null;
          specialties?: string | null;
          role?: string | null;
          user_type?: string | null;
          rating_avg?: number | null;
          lat?: number | null;
          lng?: number | null;
          invited_by?: string | null;
          invite_code_used?: string | null;
          portal_access?: boolean | null;
          is_pro?: boolean | null;
          pro_expires_at?: string | null;
          mp_preapproval_id?: string | null;
          business_logo_url?: string | null;
          business_name?: string | null;
          consent_at?: string | null;
          consent_version?: string | null;
          birth_date?: string | null;
          created_at?: string | null;
          service_radius?: number | null;
          archived_conversations?: Json | null;
          cart?: Json | null;
          ai_logo_gen_count?: number | null;
          seen_stories?: Json | null;
          review_count?: number | null;
          bio?: string | null;
          country?: string | null;
          verified?: boolean | null;
          palette?: Json | null;
        };
        Update: {
          id?: string;
          name?: string | null;
          avatar_url?: string | null;
          profession?: string | null;
          tag?: string | null;
          email?: string | null;
          city?: string | null;
          state?: string | null;
          phone?: string | null;
          specialties?: string | null;
          role?: string | null;
          user_type?: string | null;
          rating_avg?: number | null;
          lat?: number | null;
          lng?: number | null;
          invited_by?: string | null;
          invite_code_used?: string | null;
          portal_access?: boolean | null;
          is_pro?: boolean | null;
          pro_expires_at?: string | null;
          mp_preapproval_id?: string | null;
          business_logo_url?: string | null;
          business_name?: string | null;
          consent_at?: string | null;
          consent_version?: string | null;
          birth_date?: string | null;
          created_at?: string | null;
          service_radius?: number | null;
          archived_conversations?: Json | null;
          cart?: Json | null;
          ai_logo_gen_count?: number | null;
          seen_stories?: Json | null;
          review_count?: number | null;
          bio?: string | null;
          country?: string | null;
          verified?: boolean | null;
          palette?: Json | null;
        };
      };

      // ============================================================
      // posts — feed (não há CREATE TABLE no supabase_init.sql, mas
      // colunas referenciadas via ALTER TABLE/indexes confirmam o
      // shape mínimo que vive no banco)
      // ============================================================
      posts: {
        Row: {
          id: string;
          user_id: string | null;
          image_url: string | null;
          media_type: string | null;
          status: string | null;
          for_sale: boolean | null;
          price: number | null;
          art_type: string | null;
          caption: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          image_url?: string | null;
          media_type?: string | null;
          status?: string | null;
          for_sale?: boolean | null;
          price?: number | null;
          art_type?: string | null;
          caption?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          image_url?: string | null;
          media_type?: string | null;
          status?: string | null;
          for_sale?: boolean | null;
          price?: number | null;
          art_type?: string | null;
          caption?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // follows
      // ============================================================
      follows: {
        Row: {
          id: string;
          follower_id: string | null;
          following_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          follower_id?: string | null;
          following_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          follower_id?: string | null;
          following_id?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // likes
      // ============================================================
      likes: {
        Row: {
          id: string;
          user_id: string | null;
          post_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          post_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          post_id?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // comments
      // ============================================================
      comments: {
        Row: {
          id: string;
          post_id: string | null;
          user_id: string | null;
          text: string;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          post_id?: string | null;
          user_id?: string | null;
          text: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          post_id?: string | null;
          user_id?: string | null;
          text?: string;
          created_at?: string | null;
        };
      };

      // ============================================================
      // saved_posts
      // ============================================================
      saved_posts: {
        Row: {
          id: string;
          user_id: string | null;
          post_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          post_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          post_id?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // announcements
      // ============================================================
      announcements: {
        Row: {
          id: string;
          title: string;
          message: string;
          active: boolean | null;
          created_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          title: string;
          message: string;
          active?: boolean | null;
          created_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          title?: string;
          message?: string;
          active?: boolean | null;
          created_by?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // orders — pedidos da loja (+ colunas InfinitePay)
      // ============================================================
      orders: {
        Row: {
          id: string;
          user_id: string | null;
          items: Json | null;
          total: number | null;
          status: string | null;
          gateway: string | null;
          payment_url: string | null;
          tx_id: string | null;
          paid_amount: number | null;
          paid_at: string | null;
          payment_method: string | null;
          installments: number | null;
          receipt_url: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          items?: Json | null;
          total?: number | null;
          status?: string | null;
          gateway?: string | null;
          payment_url?: string | null;
          tx_id?: string | null;
          paid_amount?: number | null;
          paid_at?: string | null;
          payment_method?: string | null;
          installments?: number | null;
          receipt_url?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          items?: Json | null;
          total?: number | null;
          status?: string | null;
          gateway?: string | null;
          payment_url?: string | null;
          tx_id?: string | null;
          paid_amount?: number | null;
          paid_at?: string | null;
          payment_method?: string | null;
          installments?: number | null;
          receipt_url?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // messages — chat
      // ============================================================
      messages: {
        Row: {
          id: string;
          sender_id: string | null;
          receiver_id: string | null;
          conversation_id: string | null;
          content: string | null;
          type: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          sender_id?: string | null;
          receiver_id?: string | null;
          conversation_id?: string | null;
          content?: string | null;
          type?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          sender_id?: string | null;
          receiver_id?: string | null;
          conversation_id?: string | null;
          content?: string | null;
          type?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // reviews
      // ============================================================
      reviews: {
        Row: {
          id: string;
          reviewer_id: string | null;
          quote_id: string | null;
          rating: number | null;
          criteria: Json | null;
          comment: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          reviewer_id?: string | null;
          quote_id?: string | null;
          rating?: number | null;
          criteria?: Json | null;
          comment?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          reviewer_id?: string | null;
          quote_id?: string | null;
          rating?: number | null;
          criteria?: Json | null;
          comment?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // quotes — orçamentos (+ colunas de hardening)
      // ============================================================
      quotes: {
        Row: {
          id: string;
          client_id: string | null;
          painter_id: string | null;
          title: string | null;
          service_type: string | null;
          area_m2: number | null;
          address: string | null;
          description: string | null;
          proposed_date: string | null;
          price: number | null;
          status: string | null;
          lead_type: string | null;
          is_exclusive: boolean | null;
          commission_pct: number | null;
          client_name: string | null;
          client_phone: string | null;
          sent_at: string | null;
          approved_at: string | null;
          approved_by: string | null;
          approval_method: string | null;
          completed_at: string | null;
          scope_snapshot: Json | null;
          client_followup_optin: boolean | null;
          quote_data: Json | null;
          images: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          painter_id?: string | null;
          title?: string | null;
          service_type?: string | null;
          area_m2?: number | null;
          address?: string | null;
          description?: string | null;
          proposed_date?: string | null;
          price?: number | null;
          status?: string | null;
          lead_type?: string | null;
          is_exclusive?: boolean | null;
          commission_pct?: number | null;
          client_name?: string | null;
          client_phone?: string | null;
          sent_at?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          approval_method?: string | null;
          completed_at?: string | null;
          scope_snapshot?: Json | null;
          client_followup_optin?: boolean | null;
          quote_data?: Json | null;
          images?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          painter_id?: string | null;
          title?: string | null;
          service_type?: string | null;
          area_m2?: number | null;
          address?: string | null;
          description?: string | null;
          proposed_date?: string | null;
          price?: number | null;
          status?: string | null;
          lead_type?: string | null;
          is_exclusive?: boolean | null;
          commission_pct?: number | null;
          client_name?: string | null;
          client_phone?: string | null;
          sent_at?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          approval_method?: string | null;
          completed_at?: string | null;
          scope_snapshot?: Json | null;
          client_followup_optin?: boolean | null;
          quote_data?: Json | null;
          images?: Json | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // checklists
      // ============================================================
      checklists: {
        Row: {
          id: string;
          user_id: string | null;
          quote_id: string | null;
          title: string | null;
          items: Json | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          quote_id?: string | null;
          title?: string | null;
          items?: Json | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          quote_id?: string | null;
          title?: string | null;
          items?: Json | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // jobs — agenda de serviços
      // ============================================================
      jobs: {
        Row: {
          id: string;
          painter_id: string | null;
          quote_id: string | null;
          client_name: string | null;
          service_type: string | null;
          address: string | null;
          scheduled_date: string | null;
          scheduled_time: string | null;
          status: string | null;
          notes: string | null;
          revenue: number | null;
          material_cost: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          painter_id?: string | null;
          quote_id?: string | null;
          client_name?: string | null;
          service_type?: string | null;
          address?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          status?: string | null;
          notes?: string | null;
          revenue?: number | null;
          material_cost?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          painter_id?: string | null;
          quote_id?: string | null;
          client_name?: string | null;
          service_type?: string | null;
          address?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          status?: string | null;
          notes?: string | null;
          revenue?: number | null;
          material_cost?: number | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // commissions
      // ============================================================
      commissions: {
        Row: {
          id: string;
          job_id: string | null;
          quote_id: string | null;
          painter_id: string | null;
          amount: number | null;
          pct: number | null;
          status: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          job_id?: string | null;
          quote_id?: string | null;
          painter_id?: string | null;
          amount?: number | null;
          pct?: number | null;
          status?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string | null;
          quote_id?: string | null;
          painter_id?: string | null;
          amount?: number | null;
          pct?: number | null;
          status?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // points
      // ============================================================
      points: {
        Row: {
          id: string;
          user_id: string | null;
          amount: number | null;
          type: string | null;
          source: string | null;
          reference_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          amount?: number | null;
          type?: string | null;
          source?: string | null;
          reference_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          amount?: number | null;
          type?: string | null;
          source?: string | null;
          reference_id?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // referrals
      // ============================================================
      referrals: {
        Row: {
          id: string;
          referrer_id: string | null;
          referred_id: string | null;
          quote_id: string | null;
          status: string | null;
          bonus_points: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          referrer_id?: string | null;
          referred_id?: string | null;
          quote_id?: string | null;
          status?: string | null;
          bonus_points?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          referrer_id?: string | null;
          referred_id?: string | null;
          quote_id?: string | null;
          status?: string | null;
          bonus_points?: number | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // auto_responses
      // ============================================================
      auto_responses: {
        Row: {
          id: string;
          user_id: string | null;
          trigger_type: string | null;
          message_template: string | null;
          is_active: boolean | null;
          delay_minutes: number | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          trigger_type?: string | null;
          message_template?: string | null;
          is_active?: boolean | null;
          delay_minutes?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          trigger_type?: string | null;
          message_template?: string | null;
          is_active?: boolean | null;
          delay_minutes?: number | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // follow_ups
      // ============================================================
      follow_ups: {
        Row: {
          id: string;
          quote_id: string | null;
          painter_id: string | null;
          scheduled_at: string | null;
          message: string | null;
          status: string | null;
          sent_at: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          quote_id?: string | null;
          painter_id?: string | null;
          scheduled_at?: string | null;
          message?: string | null;
          status?: string | null;
          sent_at?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          quote_id?: string | null;
          painter_id?: string | null;
          scheduled_at?: string | null;
          message?: string | null;
          status?: string | null;
          sent_at?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // qualifications — formação no perfil profissional
      // ============================================================
      qualifications: {
        Row: {
          id: string;
          user_id: string | null;
          title: string;
          org: string | null;
          year: string | null;
          icon: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          title: string;
          org?: string | null;
          year?: string | null;
          icon?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          title?: string;
          org?: string | null;
          year?: string | null;
          icon?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // courses
      // ============================================================
      courses: {
        Row: {
          id: string;
          user_id: string | null;
          title: string;
          subtitle: string | null;
          cover_url: string | null;
          price: number | null;
          is_free: boolean | null;
          duration: string | null;
          link: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          title: string;
          subtitle?: string | null;
          cover_url?: string | null;
          price?: number | null;
          is_free?: boolean | null;
          duration?: string | null;
          link?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          title?: string;
          subtitle?: string | null;
          cover_url?: string | null;
          price?: number | null;
          is_free?: boolean | null;
          duration?: string | null;
          link?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // notes — anotações do usuário
      // ============================================================
      notes: {
        Row: {
          id: string;
          user_id: string | null;
          body: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          body?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          body?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // notifications — sininho
      // ============================================================
      notifications: {
        Row: {
          id: string;
          user_id: string | null;
          actor_id: string | null;
          type: string | null;
          title: string | null;
          body: string | null;
          ref_id: string | null;
          read: boolean | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          actor_id?: string | null;
          type?: string | null;
          title?: string | null;
          body?: string | null;
          ref_id?: string | null;
          read?: boolean | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          actor_id?: string | null;
          type?: string | null;
          title?: string | null;
          body?: string | null;
          ref_id?: string | null;
          read?: boolean | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // rate_limits — composite PK, all NOT NULL
      // ============================================================
      rate_limits: {
        Row: {
          user_id: string;
          endpoint: string;
          window_start: string;
          count: number;
        };
        Insert: {
          user_id: string;
          endpoint: string;
          window_start: string;
          count?: number;
        };
        Update: {
          user_id?: string;
          endpoint?: string;
          window_start?: string;
          count?: number;
        };
      };

      // ============================================================
      // audit_events
      // ============================================================
      audit_events: {
        Row: {
          id: string;
          event_type: string;
          actor_id: string | null;
          target_id: string | null;
          target_table: string | null;
          target_row_id: string | null;
          metadata: Json | null;
          ip: string | null;
          user_agent: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          event_type: string;
          actor_id?: string | null;
          target_id?: string | null;
          target_table?: string | null;
          target_row_id?: string | null;
          metadata?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          event_type?: string;
          actor_id?: string | null;
          target_id?: string | null;
          target_table?: string | null;
          target_row_id?: string | null;
          metadata?: Json | null;
          ip?: string | null;
          user_agent?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // account_deletion_requests — LGPD
      // ============================================================
      account_deletion_requests: {
        Row: {
          id: string;
          user_id: string;
          requested_at: string | null;
          status: string | null;
          completed_at: string | null;
          notes: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          requested_at?: string | null;
          status?: string | null;
          completed_at?: string | null;
          notes?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          requested_at?: string | null;
          status?: string | null;
          completed_at?: string | null;
          notes?: string | null;
        };
      };

      // ============================================================
      // reports — denúncias (Wave 4)
      // ============================================================
      reports: {
        Row: {
          id: string;
          reporter_id: string;
          post_id: string | null;
          target_user_id: string | null;
          reason: string;
          status: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          reporter_id: string;
          post_id?: string | null;
          target_user_id?: string | null;
          reason: string;
          status?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          post_id?: string | null;
          target_user_id?: string | null;
          reason?: string;
          status?: string | null;
          created_at?: string | null;
        };
      };

      // ============================================================
      // feature_interest — "em breve" / Maquininha clicks
      // ============================================================
      feature_interest: {
        Row: {
          id: string;
          user_id: string | null;
          feature: string;
          action: string;
          contact: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          feature: string;
          action: string;
          contact?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          feature?: string;
          action?: string;
          contact?: string | null;
          created_at?: string | null;
        };
      };
    };

    Enums: {
      // No `CREATE TYPE ... AS ENUM` blocks found in supabase_init.sql.
      // Status columns use plain `text` with CHECK constraints, not enum types.
      [_ in never]: never;
    };

    Functions: {
      // ---- is_portal_admin: SELECT boolean ----
      is_portal_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };

      // ---- get_conversations: aggregated chat list ----
      get_conversations: {
        Args: Record<string, never>;
        Returns: {
          conv_id: string;
          other_id: string | null;
          last_msg: string | null;
          last_msg_time: string | null;
          last_sender: string | null;
          is3way: boolean;
          name: string | null;
          avatar_url: string | null;
          tag: string | null;
          email: string | null;
          role: string | null;
          user_type: string | null;
        }[];
      };

      // ---- create_quote_from_post ----
      create_quote_from_post: {
        Args: {
          p_painter_id: string | null;
          p_post_id: string | null;
          p_title: string;
          p_service_type: string;
          p_area_m2: number | null;
          p_address: string | null;
          p_description: string | null;
          p_proposed_date: string | null;
          p_images?: Json;
          p_lead_type?: string;
        };
        Returns: string;
      };

      // ---- create_painter_draft ----
      create_painter_draft: {
        Args: {
          p_client_name: string;
          p_service_type: string;
          p_title: string;
          p_area_m2: number | null;
          p_price: number | null;
          p_quote_data?: Json;
        };
        Returns: string;
      };

      // ---- submit_review ----
      submit_review: {
        Args: {
          p_quote_id: string | null;
          p_painter_id: string | null;
          p_rating: number;
          p_comment?: string | null;
          p_criteria?: Json;
        };
        Returns: string;
      };

      // ---- redeem_pro_with_points ----
      redeem_pro_with_points: {
        Args: { p_cost?: number };
        Returns: string; // timestamptz as ISO string
      };

      // ---- notify_user ----
      notify_user: {
        Args: {
          p_user_id: string;
          p_type: string;
          p_title: string;
          p_body: string;
          p_ref_id?: string | null;
        };
        Returns: string;
      };

      // ---- check_rate_limit (service_role) ----
      check_rate_limit: {
        Args: {
          p_user_id: string;
          p_endpoint: string;
          p_limit?: number;
          p_window_minutes?: number;
        };
        Returns: Json;
      };

      // ---- cleanup_* (service_role only, void) ----
      cleanup_rate_limits: { Args: Record<string, never>; Returns: void };
      cleanup_old_notifications: { Args: Record<string, never>; Returns: void };
      cleanup_old_audit_events: { Args: Record<string, never>; Returns: void };
      cleanup_old_messages: { Args: Record<string, never>; Returns: void };
      cleanup_old_quotes: { Args: Record<string, never>; Returns: void };

      // ---- audit_log_manual (portal admin only) ----
      audit_log_manual: {
        Args: {
          p_event_type: string;
          p_target_id: string | null;
          p_metadata?: Json;
        };
        Returns: string;
      };

      // ---- request_account_deletion (LGPD) ----
      request_account_deletion: {
        Args: { p_reason?: string | null };
        Returns: string;
      };
    };
  };
};

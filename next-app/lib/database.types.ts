// database.types.ts — espelho TYPED do schema Supabase (queroumacor).
//
// Source-of-truth: /supabase_init.sql na raiz do repo. Foi escrito MANUALMENTE
// (não rodamos `supabase gen types` aqui porque o agent não tem CLI conectada
// ao projeto) cobrindo cada CREATE TABLE / VIEW / FUNCTION relevante. Mantém
// o mesmo shape que o gen produziria pra que, no futuro, dê pra trocar o
// arquivo gerado sem ripple no resto do codebase.
//
// Convenções (mirror do `supabase gen types typescript`):
//   - text/uuid/timestamptz → string
//   - text NULL → string | null
//   - integer/numeric/bigint → number
//   - boolean → boolean
//   - jsonb → Json (alias recursivo)
//   - text[] → string[]
//   - Colunas com `NOT NULL DEFAULT X` (que sempre vêm preenchidas pelo banco):
//     required no Row, opcional (ou ausente) no Insert, opcional no Update.
//
// IMPORTANTE: o objetivo aqui é DAR TIPOS pra `createClient<Database>(...)`.
// Não promovemos status/role pra union literal NESTE arquivo — o banco aceita
// qualquer text que case com o CHECK constraint; quando o consumer (frontend)
// quer narrowing, importa o union literal de `lib/types.ts`. Quem ler do banco
// vai pegar `string` aqui, e refinar via narrow no caller (ou aceitar como
// fallback livre, igual já era no vanilla).

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
      // ─── profiles ────────────────────────────────────────────────────────
      profiles: {
        Row: {
          id: string;
          name: string | null;
          avatar_url: string | null;
          profession: string | null;
          tag: string | null;
          username: string | null;
          email: string | null;
          city: string | null;
          state: string | null;
          country: string | null;
          phone: string | null;
          specialties: string | null;
          palette: string | null;
          role: string | null;
          user_type: string | null;
          rating_avg: number | null;
          review_count: number | null;
          lat: number | null;
          lng: number | null;
          invited_by: string | null;
          invite_code_used: string | null;
          portal_access: boolean | null;
          is_pro: boolean | null;
          is_admin: boolean | null;
          verified: boolean | null;
          pro_expires_at: string | null;
          mp_preapproval_id: string | null;
          business_logo_url: string | null;
          business_name: string | null;
          display_name: string | null;
          address: string | null;
          bio: string | null;
          service_radius: number | null;
          archived_conversations: Json | null;
          cart: Json | null;
          ai_logo_gen_count: number | null;
          seen_stories: Json | null;
          consent_at: string | null;
          consent_version: string | null;
          birth_date: string | null;
          // Coluna usada pelo CRM pra persistir o intervalo de follow-up
          // do pintor (existe em prod mas não foi importada pro
          // supabase_init.sql — documentar quando a próxima wave SQL passar).
          followup_interval_months: number | null;
          created_at: string | null;
        };
        Insert: {
          id: string;
          name?: string | null;
          avatar_url?: string | null;
          profession?: string | null;
          tag?: string | null;
          username?: string | null;
          email?: string | null;
          city?: string | null;
          state?: string | null;
          country?: string | null;
          phone?: string | null;
          specialties?: string | null;
          palette?: string | null;
          role?: string | null;
          user_type?: string | null;
          rating_avg?: number | null;
          review_count?: number | null;
          lat?: number | null;
          lng?: number | null;
          invited_by?: string | null;
          invite_code_used?: string | null;
          portal_access?: boolean | null;
          is_pro?: boolean | null;
          is_admin?: boolean | null;
          verified?: boolean | null;
          pro_expires_at?: string | null;
          mp_preapproval_id?: string | null;
          business_logo_url?: string | null;
          business_name?: string | null;
          display_name?: string | null;
          address?: string | null;
          bio?: string | null;
          service_radius?: number | null;
          archived_conversations?: Json | null;
          cart?: Json | null;
          ai_logo_gen_count?: number | null;
          seen_stories?: Json | null;
          consent_at?: string | null;
          consent_version?: string | null;
          birth_date?: string | null;
          followup_interval_months?: number | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string | null;
          avatar_url?: string | null;
          profession?: string | null;
          tag?: string | null;
          username?: string | null;
          email?: string | null;
          city?: string | null;
          state?: string | null;
          country?: string | null;
          phone?: string | null;
          specialties?: string | null;
          palette?: string | null;
          role?: string | null;
          user_type?: string | null;
          rating_avg?: number | null;
          review_count?: number | null;
          lat?: number | null;
          lng?: number | null;
          invited_by?: string | null;
          invite_code_used?: string | null;
          portal_access?: boolean | null;
          is_pro?: boolean | null;
          is_admin?: boolean | null;
          verified?: boolean | null;
          pro_expires_at?: string | null;
          mp_preapproval_id?: string | null;
          business_logo_url?: string | null;
          business_name?: string | null;
          display_name?: string | null;
          address?: string | null;
          bio?: string | null;
          service_radius?: number | null;
          archived_conversations?: Json | null;
          cart?: Json | null;
          ai_logo_gen_count?: number | null;
          seen_stories?: Json | null;
          consent_at?: string | null;
          consent_version?: string | null;
          birth_date?: string | null;
          followup_interval_months?: number | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // ─── posts ───────────────────────────────────────────────────────────
      posts: {
        Row: {
          id: string;
          user_id: string;
          caption: string | null;
          media_url: string | null;
          media_type: string | null;
          status: string | null;
          for_sale: boolean | null;
          price: number | null;
          art_type: string | null;
          image_url: string | null;
          created_at: string;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          caption?: string | null;
          media_url?: string | null;
          media_type?: string | null;
          status?: string | null;
          for_sale?: boolean | null;
          price?: number | null;
          art_type?: string | null;
          image_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          caption?: string | null;
          media_url?: string | null;
          media_type?: string | null;
          status?: string | null;
          for_sale?: boolean | null;
          price?: number | null;
          art_type?: string | null;
          image_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      // ─── follows ─────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── likes ───────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── comments ────────────────────────────────────────────────────────
      // OBS: a tabela usa coluna `text`, NÃO `body` (o type Comment de
      // lib/types.ts diverge — virou tech debt). Aqui espelhamos o banco.
      comments: {
        Row: {
          id: string;
          post_id: string | null;
          user_id: string | null;
          text: string;
          created_at: string | null;
          deleted_at: string | null;
          parent_id: string | null; // Wave 34 (2026-06-16) — resposta
        };
        Insert: {
          id?: string;
          post_id?: string | null;
          user_id?: string | null;
          text: string;
          created_at?: string | null;
          deleted_at?: string | null;
          parent_id?: string | null;
        };
        Update: {
          id?: string;
          post_id?: string | null;
          user_id?: string | null;
          text?: string;
          created_at?: string | null;
          deleted_at?: string | null;
          parent_id?: string | null;
        };
        Relationships: [];
      };
      // ─── comment_likes (Wave 34, 2026-06-16) ───────────────────────────────
      comment_likes: {
        Row: {
          id: string;
          user_id: string | null;
          comment_id: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          comment_id?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          comment_id?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // ─── saved_posts ─────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── messages ────────────────────────────────────────────────────────
      messages: {
        Row: {
          id: string;
          sender_id: string | null;
          receiver_id: string | null;
          conversation_id: string | null;
          content: string | null;
          type: string | null;
          created_at: string | null;
          deleted_at: string | null;
          read_at: string | null; // Wave 24 (2026-06-10)
        };
        Insert: {
          id?: string;
          sender_id?: string | null;
          receiver_id?: string | null;
          conversation_id?: string | null;
          content?: string | null;
          type?: string | null;
          created_at?: string | null;
          deleted_at?: string | null;
          read_at?: string | null;
        };
        Update: {
          id?: string;
          sender_id?: string | null;
          receiver_id?: string | null;
          conversation_id?: string | null;
          content?: string | null;
          type?: string | null;
          created_at?: string | null;
          deleted_at?: string | null;
          read_at?: string | null;
        };
        Relationships: [];
      };
      // ─── orders ──────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── quotes ──────────────────────────────────────────────────────────
      quotes: {
        Row: {
          id: string;
          client_id: string | null;
          painter_id: string | null;
          // post_id existe em prod (FK opcional pro post-fonte do lead); o
          // supabase_init.sql não persistiu mas o código de leads.ts depende.
          post_id: string | null;
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
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          painter_id?: string | null;
          post_id?: string | null;
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
          // approval_note não está no SQL ainda, mas pipeline.approveQuote
          // grava. Mesma situação de post_id/code/followup_interval_months.
          approval_note?: string | null;
          created_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          painter_id?: string | null;
          post_id?: string | null;
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
          approval_note?: string | null;
          created_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      // ─── jobs ────────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── reviews ─────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── products ────────────────────────────────────────────────────────
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
          image_url: string | null;
          created_at: string | null;
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
          image_url?: string | null;
          created_at?: string | null;
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
          image_url?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // ─── points ──────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── referrals ───────────────────────────────────────────────────────
      referrals: {
        Row: {
          id: string;
          referrer_id: string | null;
          referred_id: string | null;
          quote_id: string | null;
          status: string | null;
          bonus_points: number | null;
          // Código de convite (formato `QUC-XXXXXX`) — coluna usada pelo
          // signup pra resolver invited_by. Existe em prod (criada por
          // migration paralela à supabase_init.sql).
          code: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          referrer_id?: string | null;
          referred_id?: string | null;
          quote_id?: string | null;
          status?: string | null;
          bonus_points?: number | null;
          code?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          referrer_id?: string | null;
          referred_id?: string | null;
          quote_id?: string | null;
          status?: string | null;
          bonus_points?: number | null;
          code?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // ─── notifications ───────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── reports ─────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── feature_interest ────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── consent_log ─────────────────────────────────────────────────────
      // SQL Wave 5 (2026-05-31). LGPD audit trail.
      consent_log: {
        Row: {
          id: string;
          user_id: string | null;
          consent_type: string;
          consent_version: string;
          consent_given: boolean;
          ip_address: string | null;
          user_agent: string | null;
          granted_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          consent_type: string;
          consent_version?: string;
          consent_given: boolean;
          ip_address?: string | null;
          user_agent?: string | null;
          granted_at?: string;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          consent_type?: string;
          consent_version?: string;
          consent_given?: boolean;
          ip_address?: string | null;
          user_agent?: string | null;
          granted_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      // ─── audit_log ───────────────────────────────────────────────────────
      // SQL Wave 5 (2026-05-31). Auditoria de ações administrativas (catálogo
      // manual; convive com `audit_events`, que é o trigger-driven granular).
      audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          action: string;
          target_table: string | null;
          target_id: string | null;
          changes: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          actor_id?: string | null;
          action: string;
          target_table?: string | null;
          target_id?: string | null;
          changes?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          actor_id?: string | null;
          action?: string;
          target_table?: string | null;
          target_id?: string | null;
          changes?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // ─── invite_codes ────────────────────────────────────────────────────
      // SQL Wave 5 (2026-05-31). Códigos de convite com expiração default 30d.
      invite_codes: {
        Row: {
          code: string;
          created_by: string | null;
          created_at: string;
          expires_at: string | null;
          used_count: number;
          max_uses: number | null;
          metadata: Json | null;
        };
        Insert: {
          code: string;
          created_by?: string | null;
          created_at?: string;
          expires_at?: string | null;
          used_count?: number;
          max_uses?: number | null;
          metadata?: Json | null;
        };
        Update: {
          code?: string;
          created_by?: string | null;
          created_at?: string;
          expires_at?: string | null;
          used_count?: number;
          max_uses?: number | null;
          metadata?: Json | null;
        };
        Relationships: [];
      };
      // ─── checklists ──────────────────────────────────────────────────────
      checklists: {
        Row: {
          id: string;
          user_id: string | null;
          quote_id: string | null;
          title: string | null;
          items: Json | null;
          created_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          quote_id?: string | null;
          title?: string | null;
          items?: Json | null;
          created_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          quote_id?: string | null;
          title?: string | null;
          items?: Json | null;
          created_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      // ─── notes ───────────────────────────────────────────────────────────
      notes: {
        Row: {
          id: string;
          user_id: string | null;
          body: string | null;
          created_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          body?: string | null;
          created_at?: string | null;
          deleted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          body?: string | null;
          created_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      // ─── auto_responses ──────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── follow_ups ──────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── qualifications ──────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── courses ─────────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── announcements ───────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── commissions ─────────────────────────────────────────────────────
      commissions: {
        Row: {
          id: string;
          job_id: string | null;
          quote_id: string | null;
          painter_id: string | null;
          amount: number | null;
          pct: number | null;
          commission_pct: number | null;
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
          commission_pct?: number | null;
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
          commission_pct?: number | null;
          status?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      // ─── rate_limits ─────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── audit_events ────────────────────────────────────────────────────
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
        Relationships: [];
      };
      // ─── account_deletion_requests ───────────────────────────────────────
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
        Relationships: [];
      };
      // ─── errors (tabela caseira de logs — convive com Sentry) ────────────
      // O CLAUDE.md menciona "tabela caseira `errors` + dashboard
      // `/admin/errors`". O schema mínimo (não está no supabase_init.sql mas
      // foi rodado via SQL Editor à parte) é portado aqui pra cobertura.
      errors: {
        Row: {
          id: string;
          user_id: string | null;
          message: string | null;
          stack: string | null;
          path: string | null;
          user_agent: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          message?: string | null;
          stack?: string | null;
          path?: string | null;
          user_agent?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          message?: string | null;
          stack?: string | null;
          path?: string | null;
          user_agent?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      // profiles_public — subset seguro pra leitura pública (esconde phone,
      // email, lat, lng do schema da profiles). Definição em supabase_init.sql
      // linha 1810+.
      profiles_public: {
        Row: {
          id: string | null;
          name: string | null;
          avatar_url: string | null;
          bio: string | null;
          tag: string | null;
          role: string | null;
          user_type: string | null;
          profession: string | null;
          specialties: string | null;
          city: string | null;
          state: string | null;
          is_pro: boolean | null;
          verified: boolean | null;
          rating_avg: number | null;
          review_count: number | null;
          service_radius: number | null;
          created_at: string | null;
          portal_access: boolean | null;
        };
        Relationships: [];
      };
      // announcements_public — esconde created_by (anti-OSINT). Definição em
      // supabase_init.sql linha 2044+.
      announcements_public: {
        Row: {
          id: string | null;
          title: string | null;
          message: string | null;
          active: boolean | null;
          created_at: string | null;
        };
        Relationships: [];
      };
      // ─── product_variants (Wave 25, 2026-06-10) ─────────────────────────
      product_variants: {
        Row: {
          id: string;
          product_id: string;
          size_label: string;
          volume_ml: number | null;
          price: number;
          stock: number | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          size_label: string;
          volume_ml?: number | null;
          price: number;
          stock?: number | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          size_label?: string;
          volume_ml?: number | null;
          price?: number;
          stock?: number | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // ─── art_references (Wave 26, 2026-06-10) ──────────────────────────
      art_references: {
        Row: {
          id: string;
          user_id: string;
          title: string | null;
          image_url: string;
          tags: string[];
          width: number | null;
          height: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string | null;
          image_url: string;
          tags?: string[];
          width?: number | null;
          height?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string | null;
          image_url?: string;
          tags?: string[];
          width?: number | null;
          height?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      // get_conversations: agrega conversas no servidor (linha 899+ no SQL).
      get_conversations: {
        Args: Record<PropertyKey, never>;
        Returns: {
          conv_id: string;
          other_id: string;
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
      // create_quote_from_post: força client_id = auth.uid() (linha 1195+).
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
      // create_painter_draft (linha 1232+). Aceita também `p_post_id` no
      // overload usado por leads.comprarObra (existe em prod mas overload não
      // está no supabase_init.sql ainda — RPC ignora arg desconhecido em
      // versão anterior, signature aqui reflete o lado do cliente).
      create_painter_draft: {
        Args:
          | {
              p_client_name: string;
              p_service_type: string;
              p_title: string;
              p_area_m2: number | null;
              p_price: number | null;
              p_quote_data?: Json;
            }
          | { p_post_id: string };
        Returns: string;
      };
      // submit_review (linha 1261+).
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
      // redeem_pro_with_points (linha 1299+).
      redeem_pro_with_points: {
        Args: { p_cost?: number };
        Returns: string;
      };
      // check_rate_limit (linha 1479+).
      check_rate_limit: {
        Args: {
          p_user_id: string;
          p_endpoint: string;
          p_limit?: number;
          p_window_minutes?: number;
        };
        Returns: Json;
      };
      // notify_user (linha 1357+).
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
      // request_account_deletion (linha 1922+).
      request_account_deletion: {
        Args: { p_reason?: string | null };
        Returns: string;
      };
      // audit_log_manual (linha 1587+).
      audit_log_manual: {
        Args: {
          p_event_type: string;
          p_target_id: string | null;
          p_metadata?: Json;
        };
        Returns: string;
      };
      // is_portal_admin (linha 128+).
      is_portal_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: {
      // Não há tipos enum nativos no schema. Os domínios fechados (user_type,
      // status de orders, status de quotes) são CHECK constraints em texto, e
      // o app refina em union literals em lib/types.ts.
      [_: string]: never;
    };
    CompositeTypes: {
      [_: string]: never;
    };
  };
};

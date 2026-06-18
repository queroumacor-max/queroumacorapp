-- 2026-06-18-handle-new-user-city-state.sql
-- Bug "cidade em branco após cadastro": a trigger handle_new_user inseria só
-- name/user_type/role; city/state/birth_date dependiam de um UPDATE pós-signup
-- que, quando roda SEM sessão ativa (ex.: confirmação de email pendente), é
-- bloqueado pela RLS e falha em silêncio → cidade fica vazia.
--
-- Fix: a trigger (SECURITY DEFINER, sem RLS) passa a gravar tag/phone/city/
-- state/birth_date a partir do user_metadata já no INSERT. O frontend agora
-- manda esses campos no options.data do signUp. O UPDATE pós-signup segue como
-- fallback (idempotente). Superset das colunas anteriores — não remove nada.
--
-- Idempotente (CREATE OR REPLACE). Rodar no Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_type text;
  v_birth date;
BEGIN
  v_user_type := LOWER(COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'user_type'), ''), 'cliente'));
  IF v_user_type NOT IN ('cliente','pintor','grafiteiro','automotivo') THEN
    v_user_type := 'cliente';
  END IF;

  -- birth_date pode vir vazio/ inválido — cast defensivo.
  BEGIN
    v_birth := NULLIF(TRIM(NEW.raw_user_meta_data->>'birth_date'), '')::date;
  EXCEPTION WHEN OTHERS THEN
    v_birth := NULL;
  END;

  BEGIN
    INSERT INTO public.profiles
      (id, name, user_type, role, tag, phone, city, state, birth_date, created_at)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
      v_user_type, v_user_type,
      NULLIF(TRIM(NEW.raw_user_meta_data->>'tag'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'phone'), ''),
      NULLIF(TRIM(NEW.raw_user_meta_data->>'city'), ''),
      NULLIF(TRIM(UPPER(NEW.raw_user_meta_data->>'state')), ''),
      v_birth,
      now()
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user falhou para %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $$;

-- Trigger já existe (AFTER INSERT ON auth.users); o CREATE OR REPLACE acima
-- só troca o corpo da função. Não precisa recriar o trigger.

-- SaaS Phase 3 — restaurant provisioning. A single SECURITY DEFINER RPC,
-- following the exact same shape as every other write RPC in this schema
-- (permission check first, re-derives everything server-side, atomic by
-- virtue of being one PL/pgSQL function body — no explicit transaction
-- control needed or wanted, Postgres already wraps the whole function).
--
-- Deliberately minimal, per the approved design: creates exactly
-- restaurants + restaurant_settings + the owner's restaurant_staff
-- membership. Does NOT create a menu, categories, tables, or a QR token
-- — getOrCreateDefaultMenuId() (app/actions/menuAdmin.ts) already lazily
-- and idempotently creates the one Menu row a restaurant needs, the
-- first time an admin adds a category; duplicating that here would be
-- two places doing the same job. Tables/QR codes are inherently
-- physical/owner-specific (how many, what labels) and are left to the
-- owner's first login, reusing createTable/generateTableQrToken
-- completely unchanged.
--
-- Idempotency is slug-based, not a separate idempotency_key column —
-- restaurants.slug is already UNIQUE and restaurant_staff already has
-- restaurant_staff_restaurant_user_unique, so retry-safety falls out of
-- constraints that already exist rather than a new parallel mechanism:
--   - INSERT ... ON CONFLICT (slug) DO NOTHING, exactly the idiom
--     create_order's session acquisition and next_order_number's
--     counter increment already use.
--   - A retry with a DIFFERENT owner email doesn't error — it grants
--     that owner an additional admin membership on the same restaurant
--     (co-owners are a legitimate, safe outcome, not a bug).
--   - owner_staff_user_id is intentionally sticky to whichever call
--     first transitions the restaurant out of 'provisioning' — a later
--     retry with a different owner must never silently reassign who the
--     platform considers accountable for an already-active tenant, so
--     the final UPDATE only ever fires `WHERE status = 'provisioning'`.
--
-- Atomicity: everything below is one function invocation. If ANY
-- statement raises (e.g. p_owner_staff_user_id doesn't reference a real
-- staff_users row — a foreign-key violation), Postgres rolls back the
-- ENTIRE function automatically, including the restaurants row inserted
-- earlier in the same call — there is no intermediate commit point where
-- a restaurant could be observed existing without its settings and
-- owner membership. status only ever becomes 'active' in that same,
-- all-or-nothing step.
CREATE OR REPLACE FUNCTION public.provision_restaurant(
  p_name text,
  p_slug text,
  p_timezone text,
  p_currency text,
  p_owner_staff_user_id uuid,
  p_order_number_prefix text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_created boolean := false;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0026';
  END IF;

  INSERT INTO restaurants (name, slug, timezone, currency, status)
  VALUES (p_name, p_slug, COALESCE(p_timezone, 'UTC'), COALESCE(p_currency, 'USD'), 'provisioning')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO v_restaurant_id;

  IF v_restaurant_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT id INTO v_restaurant_id FROM restaurants WHERE slug = p_slug;
  END IF;

  INSERT INTO restaurant_settings (restaurant_id, order_number_prefix)
  VALUES (v_restaurant_id, COALESCE(p_order_number_prefix, 'A'))
  ON CONFLICT (restaurant_id) DO NOTHING;

  -- FK to staff_users(id) is the actual guarantee here: an invalid
  -- p_owner_staff_user_id fails this INSERT, which rolls back the whole
  -- function per the header note above. Every real caller resolves this
  -- id via findOrCreateStaffAuthUser first, so it should never actually
  -- be invalid in normal operation.
  INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role)
  VALUES (v_restaurant_id, p_owner_staff_user_id, 'admin')
  ON CONFLICT (restaurant_id, staff_user_id) DO NOTHING;

  UPDATE restaurants
  SET status = 'active', owner_staff_user_id = p_owner_staff_user_id
  WHERE id = v_restaurant_id AND status = 'provisioning';

  RETURN jsonb_build_object(
    'restaurant_id', v_restaurant_id,
    'slug', p_slug,
    'created', v_created
  );
END;
$$;

-- Tables + QR Management (§12 QR lifecycle). Before this migration there
-- was no application code path that minted a table_qr_tokens row at all
-- — only db/seed/seed.mjs did, with a low-entropy, human-readable demo
-- token (`demo-<slug>-<label>-<8 hex chars>`, ~32 bits of randomness).
-- That's fine for local seed data but not something to reuse for a real
-- admin-facing "generate/rotate QR" feature: a QR token is a bearer
-- credential exactly like an order's access_token, and needs the same
-- strength — hence the same fix already applied to create_order in
-- 0003_fix_create_order_token_generation.sql (two concatenated
-- gen_random_uuid() calls, ~256 bits, no pgcrypto dependency).
--
-- Generate and rotate are the same operation from the DB's point of
-- view — "make this table's active token be a brand-new one, and make
-- sure the previous one (if any) stops resolving" — so one function
-- serves both app/actions/tablesAdmin.ts callers rather than duplicating
-- the revoke-then-insert logic (and its entropy generation) twice.
--
-- Atomicity is the actual reason this needed a SECURITY DEFINER function
-- instead of two separate app-layer UPDATE/INSERT calls: table_qr_tokens
-- has no partial-unique-per-table index (unlike table_sessions' "one
-- open session per table"), so nothing at the DB level stops two active
-- tokens existing for the same table. If revoke-then-insert were two
-- separate round trips and the second failed, the table could be left
-- with zero active tokens (customers locked out) or — if done in the
-- other order — with the old, supposedly-rotated-away token still live
-- (defeating the entire point of rotation). One function, one
-- transaction, closes that window.
CREATE OR REPLACE FUNCTION public.generate_table_qr_token(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_token text;
  v_id uuid;
  v_created_at timestamptz;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM tables WHERE id = p_table_id;
  IF v_restaurant_id IS NULL THEN
    -- P0000/P0015/P0016 etc. are already claimed by distinct conditions
    -- elsewhere (0001_functions.sql) — P0022/P0023 are the next free codes.
    RAISE EXCEPTION 'TABLE_NOT_FOUND' USING ERRCODE = 'P0022';
  END IF;

  IF public.staff_role_for(v_restaurant_id) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'FORBIDDEN: only admin may generate or rotate a table''s QR token' USING ERRCODE = 'P0023';
  END IF;

  -- Revoke first: resolve_table_by_token filters on is_active = true, so
  -- this alone is enough to make any currently-active token for this
  -- table stop resolving, before the new one exists.
  UPDATE table_qr_tokens
  SET is_active = false, revoked_at = now()
  WHERE table_id = p_table_id AND is_active = true;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO table_qr_tokens (restaurant_id, table_id, token)
  VALUES (v_restaurant_id, p_table_id, v_token)
  RETURNING id, token, created_at INTO v_id, v_token, v_created_at;

  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'created_at', v_created_at);
END;
$$;

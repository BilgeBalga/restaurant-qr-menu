-- Fix: create_order's access-token generation depended on pgcrypto's
-- gen_random_bytes(), which is not resolvable under this function's
-- explicit `SET search_path = public` on a real Supabase project — there,
-- pgcrypto is pre-installed in a separate `extensions` schema, not
-- `public` (confirmed via pg_extension). The local Postgres 14 test
-- harness didn't surface this because pgcrypto had no prior installation
-- there and landed directly in `public`.
--
-- Fix is token-generation only: two gen_random_uuid() calls (built into
-- Postgres core since v13, no extension/schema dependency at all)
-- concatenated with their dashes stripped, giving a 64-hex-char token —
-- MORE random-bit budget than the original encode(gen_random_bytes(24),
-- 'hex') (48 hex chars), not less. No change to validation order, locking,
-- pricing, session acquisition, or the returned shape.
--
-- Preserves SECURITY DEFINER and the explicit search_path = public
-- hardening exactly as before — the fix removes the dependency that
-- conflicted with that hardening, rather than widening the search_path
-- to work around it.
CREATE OR REPLACE FUNCTION public.create_order(
  p_table_id uuid,
  p_items jsonb,           -- [{menu_item_id, quantity, option_choice_ids: [uuid,...], line_note}]
  p_customer_note text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_table_active boolean;
  v_ordering_enabled boolean;
  v_existing record;
  v_session_id uuid;
  v_order_id uuid;
  v_access_token text;
  v_order_number text;
  v_subtotal bigint := 0;
  v_line_subtotal bigint;
  v_tax_rate numeric;
  v_service_rate numeric;
  v_tax_cents bigint;
  v_service_cents bigint;
  v_total_cents bigint;
  v_item jsonb;
  v_choice_id uuid;
  v_menu_item record;
  v_choice record;
  v_order_item_id uuid;
  v_qty int;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) = 0 THEN
    RAISE EXCEPTION 'MISSING_IDEMPOTENCY_KEY' USING ERRCODE = 'P0021';
  END IF;

  -- Finding 4 / edge cases 6+7: retried or double-tapped submit resolves
  -- to the original order instead of creating a second one.
  SELECT id, order_number, access_token, total_cents INTO v_existing
  FROM orders WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'access_token', v_existing.access_token,
      'total_cents', v_existing.total_cents
    );
  END IF;

  SELECT t.restaurant_id, t.is_active, r.ordering_enabled
  INTO v_restaurant_id, v_table_active, v_ordering_enabled
  FROM tables t JOIN restaurants r ON r.id = t.restaurant_id
  WHERE t.id = p_table_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND' USING ERRCODE = 'P0000';
  END IF;
  IF NOT v_table_active THEN
    RAISE EXCEPTION 'TABLE_INACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_ordering_enabled THEN
    RAISE EXCEPTION 'ORDERING_DISABLED' USING ERRCODE = 'P0002';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_ORDER' USING ERRCODE = 'P0003';
  END IF;

  -- Pass 1: validate + price. FOR SHARE locks are held for the rest of
  -- this transaction, so pass 2 below is guaranteed to see the same rows.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item ->> 'quantity')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 20 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY' USING ERRCODE = 'P0004';
    END IF;

    SELECT id, name, price_cents, is_active, is_available
    INTO v_menu_item
    FROM menu_items
    WHERE id = (v_item ->> 'menu_item_id')::uuid
      AND restaurant_id = v_restaurant_id
    FOR SHARE;

    IF v_menu_item.id IS NULL THEN
      RAISE EXCEPTION 'MENU_ITEM_NOT_FOUND' USING ERRCODE = 'P0005';
    END IF;
    IF NOT v_menu_item.is_active OR NOT v_menu_item.is_available THEN
      RAISE EXCEPTION 'MENU_ITEM_UNAVAILABLE: %', v_menu_item.name USING ERRCODE = 'P0006';
    END IF;

    v_line_subtotal := v_menu_item.price_cents * v_qty;

    FOR v_choice_id IN
      SELECT jsonb_array_elements_text(COALESCE(v_item -> 'option_choice_ids', '[]'::jsonb))::uuid
    LOOP
      SELECT oc.id, oc.name, oc.price_delta_cents, oc.is_available
      INTO v_choice
      FROM option_choices oc
      JOIN option_groups og ON og.id = oc.option_group_id
      WHERE oc.id = v_choice_id
        AND og.menu_item_id = v_menu_item.id
        AND oc.restaurant_id = v_restaurant_id
      FOR SHARE;

      IF v_choice.id IS NULL THEN
        RAISE EXCEPTION 'OPTION_NOT_FOUND' USING ERRCODE = 'P0007';
      END IF;
      IF NOT v_choice.is_available THEN
        RAISE EXCEPTION 'OPTION_UNAVAILABLE: %', v_choice.name USING ERRCODE = 'P0008';
      END IF;

      v_line_subtotal := v_line_subtotal + (v_choice.price_delta_cents * v_qty);
    END LOOP;

    v_subtotal := v_subtotal + v_line_subtotal;
  END LOOP;

  SELECT tax_rate, service_charge_rate INTO v_tax_rate, v_service_rate
  FROM restaurant_settings WHERE restaurant_id = v_restaurant_id;

  v_tax_cents := round(v_subtotal * COALESCE(v_tax_rate, 0));
  v_service_cents := round(v_subtotal * COALESCE(v_service_rate, 0));
  v_total_cents := v_subtotal + v_tax_cents + v_service_cents;

  -- Finding 1: race-safe session acquisition. Reuses the table's open
  -- session if one exists; otherwise this INSERT wins the race against
  -- any concurrent caller doing the same thing for the same table.
  INSERT INTO table_sessions (restaurant_id, table_id, status)
  VALUES (v_restaurant_id, p_table_id, 'open')
  ON CONFLICT (table_id) WHERE status = 'open' DO NOTHING
  RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    SELECT id INTO v_session_id FROM table_sessions
    WHERE table_id = p_table_id AND status = 'open';
  END IF;

  v_order_number := public.next_order_number(v_restaurant_id);
  -- Fixed: two gen_random_uuid() calls, dashes stripped, concatenated —
  -- no pgcrypto/extensions-schema dependency. See migration header note.
  v_access_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, restaurant_id, table_id, table_session_id, order_number, status,
    subtotal_cents, tax_cents, service_charge_cents, total_cents,
    customer_note, access_token, idempotency_key
  ) VALUES (
    v_order_id, v_restaurant_id, p_table_id, v_session_id, v_order_number, 'new',
    v_subtotal, v_tax_cents, v_service_cents, v_total_cents,
    p_customer_note, v_access_token, p_idempotency_key
  );

  -- Pass 2: insert line items against the now-existing order, re-reading
  -- the exact rows locked in pass 1 (still locked — same transaction).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item ->> 'quantity')::int;

    SELECT id, name, price_cents
    INTO v_menu_item
    FROM menu_items WHERE id = (v_item ->> 'menu_item_id')::uuid;

    INSERT INTO order_items (
      restaurant_id, order_id, menu_item_id, name_snapshot, unit_price_cents_snapshot, quantity, line_note
    ) VALUES (
      v_restaurant_id, v_order_id, v_menu_item.id, v_menu_item.name, v_menu_item.price_cents, v_qty,
      v_item ->> 'line_note'
    )
    RETURNING id INTO v_order_item_id;

    FOR v_choice_id IN
      SELECT jsonb_array_elements_text(COALESCE(v_item -> 'option_choice_ids', '[]'::jsonb))::uuid
    LOOP
      SELECT oc.name, oc.price_delta_cents, og.name AS group_name
      INTO v_choice
      FROM option_choices oc
      JOIN option_groups og ON og.id = oc.option_group_id
      WHERE oc.id = v_choice_id;

      INSERT INTO order_item_options (
        restaurant_id, order_item_id, group_name_snapshot, choice_name_snapshot, price_delta_cents_snapshot
      ) VALUES (
        v_restaurant_id, v_order_item_id, v_choice.group_name, v_choice.name, v_choice.price_delta_cents
      );
    END LOOP;
  END LOOP;

  INSERT INTO order_status_history (restaurant_id, order_id, previous_status, new_status, changed_by_staff_id, note)
  VALUES (v_restaurant_id, v_order_id, NULL, 'new', NULL, NULL);

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'access_token', v_access_token,
    'total_cents', v_total_cents
  );
END;
$$;

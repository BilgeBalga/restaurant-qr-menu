-- Explicit staff-controlled table session closing.
--
-- table_sessions/clear_table/create_order's lazy session-acquisition
-- already implemented almost all of this (§7/§18): a session stays open
-- until a staff member calls clear_table (or the last order in it
-- completes/cancels), closing is a status flip that preserves the row
-- and every historical order, and create_order already opens a FRESH
-- session — never reopening a closed one — whenever no open session
-- exists for a table (already covered by the "opens a FRESH session"
-- test in order-status-transitions.test.ts). No redesign here.
--
-- The one real gap: create_order had no way to reject an order from a
-- customer whose browser is still showing a session that staff has since
-- closed (scenario: customer orders, leaves, staff clears the table,
-- customer's stale /menu tab refreshes and tries to order again). Table
-- id alone can't distinguish that stale browser from a genuinely new
-- customer who just scanned the same static QR after the close — both
-- send the same table id. Fixed by having the client optionally remember
-- which session it last ordered into (table_session_id, now returned by
-- create_order) and pass it back in; create_order rejects outright if
-- that specific session is no longer open. Omitting it (first order at a
-- table, or a fresh QR scan/cookie reset) is unaffected — the existing
-- acquire-or-create logic runs exactly as before.
--
-- clear_table now returns the id of the session it actually closed (null
-- if none was open) so the calling server action can log an audit entry
-- via the existing log_audit_event/logAuditEvent mechanism (§29) — every
-- other admin-write action already logs from the app layer this same
-- way (see app/actions/tablesAdmin.ts), not from inside the RPC.

-- create_order gains a new trailing parameter (p_session_id). Postgres
-- identifies a function by its full parameter type list, so CREATE OR
-- REPLACE alone would leave the old 4-arg version in place as a separate
-- overload instead of replacing it — drop it explicitly first.
DROP FUNCTION IF EXISTS public.create_order(uuid, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.create_order(
  p_table_id uuid,
  p_items jsonb,           -- [{menu_item_id, quantity, option_choice_ids: [uuid,...], line_note}]
  p_customer_note text,
  p_idempotency_key text,
  p_session_id uuid DEFAULT NULL  -- the customer's remembered table_session_id, if any (see header note)
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
  SELECT id, order_number, access_token, total_cents, table_session_id INTO v_existing
  FROM orders WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'access_token', v_existing.access_token,
      'total_cents', v_existing.total_cents,
      'table_session_id', v_existing.table_session_id
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

  -- The stale-browser guard: a caller that remembers a specific session
  -- must still have that exact session open right now. A bogus id, a
  -- session for a different table, or one staff has since closed via
  -- clear_table (or that auto-closed) all fail identically — nothing is
  -- created, matching every other guard above. Omitting p_session_id
  -- (first order at a table, or a fresh QR scan/cookie reset after a
  -- close) skips this entirely and falls through to the unchanged
  -- acquire-or-create logic below.
  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM table_sessions
    WHERE id = p_session_id AND table_id = p_table_id AND status = 'open';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SESSION_CLOSED' USING ERRCODE = 'P0024';
    END IF;
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

  IF p_session_id IS NOT NULL THEN
    -- Already confirmed open and belonging to this table, above.
    v_session_id := p_session_id;
  ELSE
    -- Finding 1: race-safe session acquisition. Reuses the table's open
    -- session if one exists; otherwise this INSERT wins the race against
    -- any concurrent caller doing the same thing for the same table.
    -- Unchanged from before this migration — a closed (or auto-closed)
    -- session never blocks this, it just means there's no open row for
    -- the ON CONFLICT to find, so a brand new session is created here.
    INSERT INTO table_sessions (restaurant_id, table_id, status)
    VALUES (v_restaurant_id, p_table_id, 'open')
    ON CONFLICT (table_id) WHERE status = 'open' DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      SELECT id INTO v_session_id FROM table_sessions
      WHERE table_id = p_table_id AND status = 'open';
    END IF;
  END IF;

  v_order_number := public.next_order_number(v_restaurant_id);
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
    'total_cents', v_total_cents,
    'table_session_id', v_session_id
  );
END;
$$;

-- clear_table's return type changes (void -> jsonb), which CREATE OR
-- REPLACE cannot do in place.
DROP FUNCTION IF EXISTS public.clear_table(uuid);

CREATE OR REPLACE FUNCTION public.clear_table(p_table_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
  v_role text;
  v_session_id uuid;
BEGIN
  SELECT restaurant_id INTO v_restaurant_id FROM tables WHERE id = p_table_id;
  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND' USING ERRCODE = 'P0015';
  END IF;

  v_role := public.staff_role_for(v_restaurant_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0016';
  END IF;

  -- Still an UPDATE, never a delete — historical orders and the session
  -- row itself are untouched. RETURNING lets the caller (clearTable in
  -- app/actions/orders.ts) log an audit entry only when a session
  -- actually closed, the same "fetch what changed, then log" shape every
  -- other admin-write action already uses.
  UPDATE table_sessions
  SET status = 'closed', closed_at = now(), closed_by_staff_id = auth.uid()
  WHERE table_id = p_table_id AND status = 'open'
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$$;

-- Fix: order numbers could collide across a calendar-day boundary,
-- causing a unique-constraint violation that blocked ordering entirely
-- (observed live: "orders_restaurant_order_number_unique" violation on
-- (restaurant_id, order_number)=(<id>, B-001) the first time an order was
-- placed on a new day).
--
-- Root cause — two compounding bugs:
--
--   1. orders_restaurant_order_number_unique (0000_init_schema.sql) was
--      scoped to (restaurant_id, order_number) — unique for the
--      restaurant's whole lifetime. But next_order_number()
--      (0001_functions.sql) resets its counter to 1 every day
--      (restaurant_daily_counters is keyed by (restaurant_id, day) by
--      design — "daily sequential numbering" is the intended, visible
--      behavior: B-001, B-002, ... resetting each day, not a running
--      lifetime count). The first order of ANY subsequent day therefore
--      re-mints 'B-001', which collides with day one's real 'B-001'.
--
--   2. next_order_number() computed "day" via current_date — the
--      database session's own timezone (UTC on Supabase), not the
--      restaurant's own (restaurants.timezone). A restaurant behind UTC
--      would see its counter reset hours before its actual local
--      midnight; one ahead of UTC, hours after — neither matches "today"
--      the way staff on the floor experience it, and disagreed with
--      every other "today" computation in the app (dashboard, order
--      history), which already use lib/business/timezone.ts's
--      restaurant-timezone-aware helpers.
--
-- Fix: the intended human-facing numbering is UNCHANGED — still
-- "<prefix>-<counter>", still resetting daily, decided by inspecting
-- next_order_number()'s own design comment ("one row per restaurant per
-- day"), the visible format (no date component), and the existing
-- concurrency test asserting a gapless T-001..T-015 sequence. What
-- changes is only the DATABASE-LEVEL representation of "which day":
--
--   - orders gains order_date (the restaurant-LOCAL calendar date the
--     number was minted for), computed once per create_order call via
--     (now() AT TIME ZONE restaurants.timezone)::date and threaded into
--     both the counter lookup and the new orders row — so the two values
--     that must agree for correctness are structurally guaranteed to,
--     never independently (re)computed and liable to drift.
--   - the unique index becomes (restaurant_id, order_date, order_number)
--     instead of (restaurant_id, order_number) — the same order_number
--     text may now legitimately repeat across different order_dates
--     (exactly the intended "resets daily" behavior), but can never
--     repeat within the same restaurant-day, and concurrent creation
--     within a day is still race-safe via the existing atomic
--     INSERT ... ON CONFLICT DO UPDATE ... RETURNING in
--     next_order_number() (Finding 4) — untouched by this migration.
--
-- Existing order_number text is never touched — order_date is backfilled
-- from each historical order's own created_at, read through ITS
-- restaurant's timezone, so history keeps its true original numbers and
-- gains only the (previously implicit) day they were minted on.

-- ============================================================
-- orders.order_date
-- ============================================================
ALTER TABLE orders ADD COLUMN order_date date;

UPDATE orders o
SET order_date = (o.created_at AT TIME ZONE COALESCE(r.timezone, 'UTC'))::date
FROM restaurants r
WHERE r.id = o.restaurant_id;

ALTER TABLE orders ALTER COLUMN order_date SET NOT NULL;

DROP INDEX IF EXISTS orders_restaurant_order_number_unique;
CREATE UNIQUE INDEX "orders_restaurant_order_date_order_number_unique"
  ON "orders" USING btree ("restaurant_id", "order_date", "order_number");

-- ============================================================
-- next_order_number — now takes the day explicitly instead of
-- recomputing its own via current_date, so it always agrees with
-- whatever day create_order is about to stamp on the orders row.
-- Signature changes (uuid) -> (uuid, date): CREATE OR REPLACE can't
-- change a function's parameter list, so the old one is dropped first.
-- ============================================================
DROP FUNCTION IF EXISTS public.next_order_number(uuid);

CREATE OR REPLACE FUNCTION public.next_order_number(p_restaurant_id uuid, p_day date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_prefix text;
BEGIN
  INSERT INTO restaurant_daily_counters (restaurant_id, day, counter)
  VALUES (p_restaurant_id, p_day, 1)
  ON CONFLICT (restaurant_id, day)
  DO UPDATE SET counter = restaurant_daily_counters.counter + 1
  RETURNING counter INTO v_count;

  SELECT order_number_prefix INTO v_prefix
  FROM restaurant_settings WHERE restaurant_id = p_restaurant_id;

  RETURN COALESCE(v_prefix, 'A') || '-' || lpad(v_count::text, 3, '0');
END;
$$;

-- ============================================================
-- create_order — same signature/behavior as 0007's version in every
-- other respect (session-closed enforcement, pricing, idempotency,
-- locking); the only change is computing v_order_date once (restaurant-
-- local, via the table's own restaurant's timezone) and using it for
-- both the order-number lookup and the new orders row.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_order(
  p_table_id uuid,
  p_items jsonb,           -- [{menu_item_id, quantity, option_choice_ids: [uuid,...], line_note}]
  p_customer_note text,
  p_idempotency_key text,
  p_session_id uuid DEFAULT NULL
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
  v_timezone text;
  v_order_date date;
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
  -- to the original order instead of creating a second one. Deliberately
  -- unaffected by session/day logic below — a retry of an already-
  -- successful submission must keep succeeding even if the table's
  -- session has since closed or the calendar day has since rolled over.
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

  SELECT t.restaurant_id, t.is_active, r.ordering_enabled, r.timezone
  INTO v_restaurant_id, v_table_active, v_ordering_enabled, v_timezone
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

  v_order_date := (now() AT TIME ZONE COALESCE(v_timezone, 'UTC'))::date;

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
    v_session_id := p_session_id;
  ELSE
    INSERT INTO table_sessions (restaurant_id, table_id, status)
    VALUES (v_restaurant_id, p_table_id, 'open')
    ON CONFLICT (table_id) WHERE status = 'open' DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      SELECT id INTO v_session_id FROM table_sessions
      WHERE table_id = p_table_id AND status = 'open';
    END IF;
  END IF;

  v_order_number := public.next_order_number(v_restaurant_id, v_order_date);
  v_access_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_order_id := gen_random_uuid();

  INSERT INTO orders (
    id, restaurant_id, table_id, table_session_id, order_number, order_date, status,
    subtotal_cents, tax_cents, service_charge_cents, total_cents,
    customer_note, access_token, idempotency_key
  ) VALUES (
    v_order_id, v_restaurant_id, p_table_id, v_session_id, v_order_number, v_order_date, 'new',
    v_subtotal, v_tax_cents, v_service_cents, v_total_cents,
    p_customer_note, v_access_token, p_idempotency_key
  );

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

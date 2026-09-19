-- Removes Finding 2's auto-close: set_order_status used to close a
-- table's open session the instant its last non-terminal order finished
-- (completed/cancelled), so a customer could never place a second order
-- at the same table without staff re-issuing a session — the table's
-- physical occupancy and the session's lifecycle were conflated. Per
-- product decision, a table session must now stay open across any number
-- of orders and close ONLY via an explicit clear_table() call. This is a
-- pure removal — the auto-close block is deleted, nothing else in the
-- function changes: same signature, same permission check
-- (staff_role_for), same row lock (Finding 3's FOR UPDATE), same
-- transition validation (is_legal_order_transition), same
-- order_status_history insert.
CREATE OR REPLACE FUNCTION public.set_order_status(
  p_order_id uuid,
  p_new_status text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_role text;
BEGIN
  -- Finding 3: lock the row before validating. A concurrent second call
  -- blocks here until this transaction commits, then re-validates against
  -- whatever actually landed — never a silent overwrite.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0010';
  END IF;

  v_role := public.staff_role_for(v_order.restaurant_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0011';
  END IF;

  IF NOT public.is_legal_order_transition(v_order.status::text, p_new_status, v_role) THEN
    RAISE EXCEPTION 'ILLEGAL_TRANSITION: % -> % (role %)', v_order.status, p_new_status, v_role
      USING ERRCODE = 'P0012';
  END IF;

  UPDATE orders SET status = p_new_status::order_status WHERE id = p_order_id;

  INSERT INTO order_status_history (restaurant_id, order_id, previous_status, new_status, changed_by_staff_id, note)
  VALUES (v_order.restaurant_id, p_order_id, v_order.status::text, p_new_status, auth.uid(), p_note);

  RETURN jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
END;
$$;

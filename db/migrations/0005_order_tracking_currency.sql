-- Fix: get_order_by_token never returned currency, so the customer
-- tracking page (Phase 5) had no way to format money correctly. Adds one
-- joined column and one output key — no other change to validation,
-- shape, or the SECURITY DEFINER / search_path hardening.
CREATE OR REPLACE FUNCTION public.get_order_by_token(p_access_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_items jsonb;
  v_history jsonb;
BEGIN
  SELECT
    o.id, o.order_number, o.status, o.subtotal_cents, o.tax_cents, o.service_charge_cents,
    o.total_cents, o.customer_note, o.created_at, t.label AS table_label, r.currency
  INTO v_order
  FROM orders o
  JOIN tables t ON t.id = o.table_id
  JOIN restaurants r ON r.id = o.restaurant_id
  WHERE o.access_token = p_access_token;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0013';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', oi.name_snapshot,
    'unit_price_cents', oi.unit_price_cents_snapshot,
    'quantity', oi.quantity,
    'line_note', oi.line_note,
    'options', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'group', oo.group_name_snapshot,
        'choice', oo.choice_name_snapshot,
        'price_delta_cents', oo.price_delta_cents_snapshot
      )), '[]'::jsonb)
      FROM order_item_options oo WHERE oo.order_item_id = oi.id
    )
  )), '[]'::jsonb) INTO v_items
  FROM order_items oi WHERE oi.order_id = v_order.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'previous_status', h.previous_status,
    'new_status', h.new_status,
    'created_at', h.created_at
  ) ORDER BY h.created_at), '[]'::jsonb) INTO v_history
  FROM order_status_history h WHERE h.order_id = v_order.id;

  RETURN jsonb_build_object(
    'order_number', v_order.order_number,
    'status', v_order.status,
    'table_label', v_order.table_label,
    'subtotal_cents', v_order.subtotal_cents,
    'tax_cents', v_order.tax_cents,
    'service_charge_cents', v_order.service_charge_cents,
    'total_cents', v_order.total_cents,
    'currency', v_order.currency,
    'customer_note', v_order.customer_note,
    'created_at', v_order.created_at,
    'items', v_items,
    'status_history', v_history
  );
END;
$$;

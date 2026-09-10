-- Customer order tracking realtime (§16): anonymous customers have no
-- RLS grant on orders at all (Finding 6), so Postgres Changes isn't an
-- option for them. Instead, a trigger on order_status_history broadcasts
-- to a channel literally named `order-<access_token>` — the token itself
-- is the capability, same pattern as the QR token (§12). Broadcast with
-- private=false performs no RLS check, which is correct and sufficient
-- here: nobody who doesn't already hold the (64-hex-char, unguessable)
-- token can name the channel to subscribe to it in the first place.
--
-- Payload is deliberately minimal — {status, changed_at} only, never
-- changed_by_staff_id — a customer channel has no reason to carry staff
-- identity (§16, §27).
CREATE OR REPLACE FUNCTION public.broadcast_order_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_access_token text;
BEGIN
  SELECT access_token INTO v_access_token FROM orders WHERE id = NEW.order_id;

  IF v_access_token IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('status', NEW.new_status, 'changed_at', NEW.created_at),
      'order_status_changed',
      'order-' || v_access_token,
      false
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_broadcast_order_status_change ON order_status_history;
CREATE TRIGGER trg_broadcast_order_status_change
  AFTER INSERT ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_order_status_change();

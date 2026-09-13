-- Bug #3 (Phase 5 live acceptance test) — public menu reads were only
-- reachable by two disjoint roles: `anon` (via *_select_anon, USING
-- is_active/status = 'active') and `authenticated` staff at that specific
-- restaurant (via *_select_staff, USING is_staff_of(...)). An
-- authenticated user who is NOT staff at the restaurant they're browsing
-- as a customer (e.g. a staff member of a DIFFERENT restaurant scanning
-- a QR code in the same browser they're signed into /staff with) matched
-- neither policy and got zero rows back — an empty menu, or (via
-- restaurants, below) "We couldn't find your table" outright — instead of
-- the same public view an anonymous customer sees. Confirmed live and
-- root-caused against the real demo restaurant.
--
-- Fix: one additional, purely additive OR'd SELECT policy per table,
-- scoped TO authenticated, with the EXACT SAME condition as that table's
-- existing anon policy — never anything broader. No existing policy is
-- touched, weakened, or replaced; a staff member's own-restaurant access
-- via *_select_staff is completely unaffected, and staff-only data
-- (restaurant_staff, order history, settings, etc.) is untouched by this
-- migration entirely. Mirrors the additive-policy pattern already used by
-- 0013_platform_admin_read_access.sql.
--
-- restaurants: getRestaurant()/resolveCurrentTable()'s cookie-based
-- fallback path both read this table directly (not through a SECURITY
-- DEFINER RPC), so it needs the same fix as the menu tables themselves —
-- without it, an authenticated non-staff customer would still hit
-- TableUnavailable even after categories/menu_items are fixed below.
CREATE POLICY "restaurants_select_authenticated_public" ON "restaurants"
  FOR SELECT TO authenticated
  USING (status = 'active');

CREATE POLICY "categories_select_authenticated_public" ON "categories"
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "menu_items_select_authenticated_public" ON "menu_items"
  FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "option_groups_select_authenticated_public" ON "option_groups"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.id = option_groups.menu_item_id AND mi.is_active = true
    )
  );

CREATE POLICY "option_choices_select_authenticated_public" ON "option_choices"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM option_groups og
      JOIN menu_items mi ON mi.id = og.menu_item_id
      WHERE og.id = option_choices.option_group_id AND mi.is_active = true
    )
  );

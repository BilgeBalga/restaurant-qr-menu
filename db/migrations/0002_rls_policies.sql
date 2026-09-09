-- Phase 2 — Row Level Security. Hand-written per architecture §3.
--
-- Baseline: revoke every default privilege Supabase grants `anon` and
-- `authenticated` on public-schema tables, then grant back exactly what
-- each table needs — nothing is grandfathered in. RLS is then enabled
-- everywhere, and a table with zero matching policies denies that
-- operation outright, regardless of any table-level grant.
--
-- `service_role` is not referenced here: it already bypasses RLS
-- (Supabase grants it BYPASSRLS at the platform level, not per-schema
-- migration) and is never used for anything a normal session should do.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- ============================================================
-- restaurants
-- ============================================================
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON restaurants TO anon, authenticated;
GRANT UPDATE ON restaurants TO authenticated;

CREATE POLICY restaurants_select_anon ON restaurants
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY restaurants_select_staff ON restaurants
  FOR SELECT TO authenticated
  USING (public.is_staff_of(id));

CREATE POLICY restaurants_update_admin ON restaurants
  FOR UPDATE TO authenticated
  USING (public.staff_role_for(id) = 'admin')
  WITH CHECK (public.staff_role_for(id) = 'admin');

-- ============================================================
-- restaurant_settings — no anon access at all (tax rate etc. never
-- exposed directly; the client-visible total always comes from
-- create_order's return value).
-- ============================================================
ALTER TABLE restaurant_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON restaurant_settings TO authenticated;

CREATE POLICY restaurant_settings_select_staff ON restaurant_settings
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY restaurant_settings_update_admin ON restaurant_settings
  FOR UPDATE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- staff_users — self-read, or read of a colleague at a restaurant where
-- you are admin (needed for the staff-accounts settings screen). No
-- INSERT policy anywhere: rows are created solely by the
-- handle_new_auth_user trigger (0001), never by direct app INSERT.
-- ============================================================
ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;

GRANT SELECT, UPDATE ON staff_users TO authenticated;

CREATE POLICY staff_users_select_self_or_admin_colleague ON staff_users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM restaurant_staff mine
      JOIN restaurant_staff theirs ON theirs.restaurant_id = mine.restaurant_id
      WHERE mine.staff_user_id = auth.uid()
        AND mine.role = 'admin'
        AND mine.is_active = true
        AND theirs.staff_user_id = staff_users.id
    )
  );

CREATE POLICY staff_users_update_self ON staff_users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- restaurant_staff — any staff member can see the roster; only admin
-- manages it (§11: invite/deactivate/role changes are admin-only).
-- ============================================================
ALTER TABLE restaurant_staff ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON restaurant_staff TO authenticated;

CREATE POLICY restaurant_staff_select_staff ON restaurant_staff
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY restaurant_staff_write_admin ON restaurant_staff
  FOR ALL TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- tables — deliberately NO anon access (deviation from the architecture
-- doc's §26 summary table, which listed `tables` alongside the
-- menu/category group without a functional reason). The customer flow
-- only ever needs resolve_table_by_token(), a SECURITY DEFINER function;
-- nothing in §21's API contracts has anon reading this table directly,
-- and broad anon SELECT would let any customer enumerate every table
-- label at every restaurant with no scoping. Tightened here; documented
-- in the Phase 2 report.
-- ============================================================
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON tables TO authenticated;

CREATE POLICY tables_select_staff ON tables
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY tables_write_admin ON tables
  FOR ALL TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- table_qr_tokens — admin only, no anon, and no DELETE grant for anyone:
-- §12 says rotation is "an insert + an update, not a destructive edit."
-- ============================================================
ALTER TABLE table_qr_tokens ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON table_qr_tokens TO authenticated;

CREATE POLICY table_qr_tokens_all_admin ON table_qr_tokens
  FOR ALL TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- table_sessions — staff read-only. Lifecycle is entirely owned by the
-- create_order / set_order_status / clear_table SECURITY DEFINER
-- functions (Findings 1 & 2) — no direct write grant to anyone.
-- ============================================================
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON table_sessions TO authenticated;

CREATE POLICY table_sessions_select_staff ON table_sessions
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

-- ============================================================
-- restaurant_daily_counters — pure implementation detail behind
-- next_order_number(); nobody gets a direct grant.
-- ============================================================
ALTER TABLE restaurant_daily_counters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- menus / categories — anon browses active rows; admin manages them.
-- ============================================================
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON menus TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON menus TO authenticated;

CREATE POLICY menus_select_anon ON menus
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY menus_select_staff ON menus
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY menus_write_admin ON menus
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY menus_update_admin ON menus
  FOR UPDATE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY menus_delete_admin ON menus
  FOR DELETE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin');

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON categories TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON categories TO authenticated;

CREATE POLICY categories_select_anon ON categories
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY categories_select_staff ON categories
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY categories_write_admin ON categories
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY categories_update_admin ON categories
  FOR UPDATE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY categories_delete_admin ON categories
  FOR DELETE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- menu_items — anon sees everything with is_active = true (unavailable
-- items still show, per §19, just disabled client-side — is_available
-- never gates visibility). Any staff role may UPDATE at the row level;
-- the enforce_menu_item_update_scope trigger (0001) enforces that a
-- non-admin can only actually change is_available.
-- ============================================================
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON menu_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON menu_items TO authenticated;

CREATE POLICY menu_items_select_anon ON menu_items
  FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY menu_items_select_staff ON menu_items
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY menu_items_insert_admin ON menu_items
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY menu_items_update_staff ON menu_items
  FOR UPDATE TO authenticated
  USING (public.is_staff_of(restaurant_id))
  WITH CHECK (public.is_staff_of(restaurant_id));

CREATE POLICY menu_items_delete_admin ON menu_items
  FOR DELETE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- option_groups / option_choices — anon visibility follows the parent
-- menu_item's is_active (via EXISTS), not their own is_available.
-- ============================================================
ALTER TABLE option_groups ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON option_groups TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON option_groups TO authenticated;

CREATE POLICY option_groups_select_anon ON option_groups
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM menu_items mi
      WHERE mi.id = option_groups.menu_item_id AND mi.is_active = true
    )
  );

CREATE POLICY option_groups_select_staff ON option_groups
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY option_groups_write_admin ON option_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY option_groups_update_admin ON option_groups
  FOR UPDATE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY option_groups_delete_admin ON option_groups
  FOR DELETE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin');

ALTER TABLE option_choices ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON option_choices TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON option_choices TO authenticated;

CREATE POLICY option_choices_select_anon ON option_choices
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM option_groups og
      JOIN menu_items mi ON mi.id = og.menu_item_id
      WHERE og.id = option_choices.option_group_id AND mi.is_active = true
    )
  );

CREATE POLICY option_choices_select_staff ON option_choices
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY option_choices_write_admin ON option_choices
  FOR INSERT TO authenticated
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY option_choices_update_admin ON option_choices
  FOR UPDATE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin')
  WITH CHECK (public.staff_role_for(restaurant_id) = 'admin');

CREATE POLICY option_choices_delete_admin ON option_choices
  FOR DELETE TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin');

-- ============================================================
-- orders family (Finding 6) — SELECT only for authenticated staff,
-- scoped to their restaurant; NOTHING for anon at all; NO INSERT/UPDATE/
-- DELETE grant for anyone. create_order and set_order_status (0001) are
-- SECURITY DEFINER and write as their owner, which bypasses RLS as the
-- table owner — that is the only way any row in this family is ever
-- written.
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON orders, order_items, order_item_options, order_status_history TO authenticated;

CREATE POLICY orders_select_staff ON orders
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY order_items_select_staff ON order_items
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY order_item_options_select_staff ON order_item_options
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

CREATE POLICY order_status_history_select_staff ON order_status_history
  FOR SELECT TO authenticated
  USING (public.is_staff_of(restaurant_id));

-- ============================================================
-- audit_logs — admin read-only (§11); writes only via log_audit_event().
-- ============================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON audit_logs TO authenticated;

CREATE POLICY audit_logs_select_admin ON audit_logs
  FOR SELECT TO authenticated
  USING (public.staff_role_for(restaurant_id) = 'admin');

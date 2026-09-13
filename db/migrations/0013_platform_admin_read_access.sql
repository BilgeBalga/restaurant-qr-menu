-- SaaS Phase 4 — platform-admin read access for the /platform UI.
--
-- Found during preflight, not assumed: restaurants_select_staff
-- (USING is_staff_of(id)) and staff_users_select_self_or_admin_colleague
-- both scope visibility to the caller's OWN restaurant relationships. A
-- platform admin — who may legitimately have zero restaurant_staff rows
-- at all (§ architecture Part 3) — could not see any restaurant, or
-- resolve any owner's email, through either existing policy. Without
-- this, the restaurant list/detail pages would have nothing to query.
--
-- Both additions are purely additive (a second, OR'd permissive SELECT
-- policy alongside the existing one, exactly the audit_logs_select_platform_admin
-- pattern from Phase 2) — no existing policy is touched, weakened, or
-- replaced. A restaurant admin's visibility is exactly what it already
-- was; a platform admin additionally sees everything.
CREATE POLICY "restaurants_select_platform_admin" ON "restaurants"
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

CREATE POLICY "staff_users_select_platform_admin" ON "staff_users"
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

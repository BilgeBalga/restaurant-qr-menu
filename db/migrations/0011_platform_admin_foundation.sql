-- SaaS Phase 2 (Platform admin foundation) — a platform-level access
-- axis that is structurally, not just conventionally, separate from
-- every restaurant-scoped role. platform_admins carries no restaurant_id
-- column at all, so there is no field to accidentally scope or misread —
-- a restaurant `admin` row in restaurant_staff can never be confused
-- with platform-admin status by construction, not by code review.
--
-- Deliberately minimal: this migration lays down the table, the
-- SECURITY DEFINER check function, and read access for the eventual
-- platform-admin UI — it does NOT add a grant/revoke action or policy,
-- because no such action exists yet (that arrives with restaurant
-- provisioning / platform-admin management, a later phase). Until then,
-- granting platform-admin status is a manual, service-role/superuser-only
-- operation — the same way the current single demo restaurant itself was
-- ever created (db/seed/seed.mjs, or the Supabase dashboard), not a gap
-- introduced by this migration.

CREATE TABLE "platform_admins" (
  "staff_user_id" uuid PRIMARY KEY REFERENCES "staff_users"("id") ON DELETE CASCADE,
  "granted_by" uuid REFERENCES "staff_users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- is_platform_admin — mirrors is_staff_of/staff_role_for exactly
-- (0001_functions.sql): SECURITY DEFINER + STABLE so it can be used
-- inside RLS policies without recursive-policy evaluation, reading
-- auth.uid() directly rather than trusting anything client-supplied.
-- Defined before any policy that references it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_admins WHERE staff_user_id = auth.uid()
  );
$$;

-- SELECT only — no INSERT/UPDATE/DELETE grant to `authenticated` at all.
-- Existing platform admins can see the full roster (so they know who else
-- holds this power); nobody can grant/revoke it through the RLS-scoped
-- client until that action exists.
GRANT SELECT ON "platform_admins" TO authenticated;

CREATE POLICY "platform_admins_select_platform_admin" ON "platform_admins"
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ============================================================
-- audit_logs: support a genuinely restaurant-less event (e.g. a future
-- "platform.admin.grant") without a second audit system. Reuses the
-- existing table/RPC/UI entirely — log_audit_event() already just does
-- INSERT INTO audit_logs (restaurant_id, ...) VALUES (p_restaurant_id, ...),
-- so passing NULL now simply works once the column allows it; no function
-- signature change needed. Every existing restaurant-scoped event
-- (including every one logged so far) is completely unaffected — this
-- only makes NULL a new, additional legal value, nothing existing changes.
-- ============================================================
ALTER TABLE "audit_logs" ALTER COLUMN "restaurant_id" DROP NOT NULL;

-- Additive: OR'd with the existing audit_logs_select_admin policy
-- (0002_rls_policies.sql), which is untouched — a restaurant admin's
-- visibility is exactly what it already was. A platform admin
-- additionally sees everything, including the NULL-restaurant rows a
-- restaurant-scoped admin structurally cannot (staff_role_for(NULL) has
-- no matching restaurant_staff row, so it's never true for them).
CREATE POLICY "audit_logs_select_platform_admin" ON "audit_logs"
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * SaaS Phase 2 (Platform admin foundation) — db/migrations/0011_platform_admin_foundation.sql.
 * platform_admins/is_platform_admin() are structurally separate from
 * every restaurant-scoped role (no restaurant_id column exists on
 * platform_admins at all), so these tests specifically verify that
 * separation holds — a restaurant admin, however privileged within their
 * own tenant, gets nothing extra from platform_admins or the
 * platform-level audit_logs policy.
 */

async function isPlatformAdmin(staffUserId: string): Promise<boolean> {
  const [row] = await withRole("authenticated", staffUserId, async (conn) => {
    return conn`SELECT public.is_platform_admin() AS result`;
  });
  return row!.result as boolean;
}

describe("is_platform_admin() — orthogonal to every restaurant role", () => {
  it("returns false for a restaurant admin who has no platform_admins row", async () => {
    const fx = await createTestRestaurant();
    expect(await isPlatformAdmin(fx.adminId)).toBe(false);
  });

  it("returns false for plain restaurant staff", async () => {
    const fx = await createTestRestaurant();
    expect(await isPlatformAdmin(fx.staffId)).toBe(false);
  });

  it("returns true once a platform_admins row exists for that user, regardless of any restaurant role", async () => {
    const fx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.staffId})`; // plain staff at their restaurant, but a platform admin
    expect(await isPlatformAdmin(fx.staffId)).toBe(true);
  });

  it("a platform admin with ZERO restaurant memberships is still recognized (a pure platform employee is a valid state)", async () => {
    const platformOnlyId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${platformOnlyId}, ${"platform-only-" + platformOnlyId + "@example.com"})`;
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${platformOnlyId})`;

    const noMemberships = await sql`SELECT count(*)::int AS count FROM restaurant_staff WHERE staff_user_id = ${platformOnlyId}`;
    expect(noMemberships[0]!.count).toBe(0);
    expect(await isPlatformAdmin(platformOnlyId)).toBe(true);
  });
});

describe("platform_admins — RLS visibility", () => {
  it("a restaurant admin cannot see the platform_admins table at all, even a row naming their own restaurant's staff", async () => {
    const fx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.staffId})`;

    const visibleToRestaurantAdmin = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT staff_user_id FROM platform_admins`;
    });
    expect(visibleToRestaurantAdmin).toHaveLength(0);
  });

  it("a platform admin can see the full roster, including other platform admins — not just their own row", async () => {
    // platform_admins is genuinely global, unlike every other table in this
    // suite (all restaurant-scoped) — other tests in this file may have
    // already inserted rows that persist across the shared connection pool,
    // so this asserts containment, not an exact full-table snapshot.
    const fx = await createTestRestaurant();
    const other = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.adminId})`;
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${other.adminId})`;

    const visible = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT staff_user_id FROM platform_admins`;
    });
    const ids = visible.map((r) => r.staff_user_id);
    expect(ids).toContain(fx.adminId);
    expect(ids).toContain(other.adminId); // proves visibility isn't limited to the caller's own row
  });

  it("nobody — not even a platform admin — can INSERT into platform_admins through the RLS-scoped client (no grant/revoke action exists yet)", async () => {
    const fx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.adminId})`; // fx.adminId is a platform admin

    const target = await createTestRestaurant();
    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`INSERT INTO platform_admins (staff_user_id) VALUES (${target.adminId}::uuid)`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("nobody can DELETE from platform_admins through the RLS-scoped client either", async () => {
    const fx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.adminId})`;

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`DELETE FROM platform_admins WHERE staff_user_id = ${fx.adminId}::uuid`;
      }),
    ).rejects.toThrow(/permission denied/);

    const [row] = await sql`SELECT staff_user_id FROM platform_admins WHERE staff_user_id = ${fx.adminId}`;
    expect(row).toBeDefined(); // untouched
  });
});

describe("audit_logs — platform-level (NULL restaurant_id) events", () => {
  it("log_audit_event accepts a NULL restaurant_id without any signature change", async () => {
    const entityId = crypto.randomUUID();
    await withRole("authenticated", null, async (conn) => {
      return conn`SELECT public.log_audit_event(NULL, 'platform.admin.grant', 'platform_admins', ${entityId}::uuid, NULL, NULL)`;
    });

    const [row] = await sql`SELECT restaurant_id, action FROM audit_logs WHERE entity_id = ${entityId}`;
    expect(row!.restaurant_id).toBeNull();
    expect(row!.action).toBe("platform.admin.grant");
  });

  it("a restaurant admin cannot see a platform-level (NULL restaurant_id) audit row", async () => {
    const fx = await createTestRestaurant();
    const entityId = crypto.randomUUID();
    await sql`INSERT INTO audit_logs (restaurant_id, action, entity_type, entity_id) VALUES (NULL, 'platform.admin.grant', 'platform_admins', ${entityId})`;

    const visible = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE entity_id = ${entityId}::uuid`;
    });
    expect(visible).toHaveLength(0);
  });

  it("a platform admin CAN see a platform-level (NULL restaurant_id) audit row", async () => {
    const fx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.adminId})`;
    const entityId = crypto.randomUUID();
    await sql`INSERT INTO audit_logs (restaurant_id, action, entity_type, entity_id) VALUES (NULL, 'platform.admin.grant', 'platform_admins', ${entityId})`;

    const visible = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE entity_id = ${entityId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });

  it("a platform admin can ALSO still see ordinary restaurant-scoped audit rows they are not staff at — additive, not a replacement of the existing policy", async () => {
    const platformAdminFx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${platformAdminFx.adminId})`;

    const otherRestaurant = await createTestRestaurant();
    const entityId = crypto.randomUUID();
    await sql`INSERT INTO audit_logs (restaurant_id, action, entity_type, entity_id) VALUES (${otherRestaurant.restaurantId}, 'menu.item.delete', 'menu_items', ${entityId})`;

    const visible = await withRole("authenticated", platformAdminFx.adminId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE entity_id = ${entityId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });

  it("a restaurant admin's own-restaurant audit visibility is unchanged by this migration (regression)", async () => {
    const fx = await createTestRestaurant();
    const entityId = crypto.randomUUID();
    await sql`INSERT INTO audit_logs (restaurant_id, action, entity_type, entity_id) VALUES (${fx.restaurantId}, 'menu.item.delete', 'menu_items', ${entityId})`;

    const visible = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE entity_id = ${entityId}::uuid`;
    });
    expect(visible).toHaveLength(1);

    const otherRestaurant = await createTestRestaurant();
    const notVisible = await withRole("authenticated", otherRestaurant.adminId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE entity_id = ${entityId}::uuid`;
    });
    expect(notVisible).toHaveLength(0);
  });
});

/**
 * SaaS Phase 4 — db/migrations/0013_platform_admin_read_access.sql. The
 * /platform restaurant list/detail pages need a platform admin to read
 * ANY restaurant (and resolve any owner's email), even one they have no
 * restaurant_staff relationship with at all. Both policies below are
 * additive (a second, OR'd permissive SELECT policy) — the existing
 * restaurants_select_staff / staff_users_select_self_or_admin_colleague
 * policies are untouched, so a restaurant admin's own visibility is
 * exactly what it already was.
 */
describe("restaurants — platform-admin read access (Phase 4)", () => {
  // Updated for db/migrations/0014_public_menu_authenticated_access.sql
  // (Phase 5 live acceptance Bug #3 fix): an ACTIVE restaurant's public
  // row is now legitimately visible to any authenticated user (matching
  // anon — see rls-permissions.test.ts), so it can no longer stand in
  // for "an ordinary restaurant admin has no special platform-admin
  // grant." A SUSPENDED restaurant still isn't public (the new
  // authenticated policy mirrors anon's status = 'active' condition
  // exactly), so it correctly isolates what this test actually means to
  // prove: an ordinary admin gets nothing extra from
  // restaurants_select_platform_admin, which has no status condition at
  // all.
  it("a restaurant admin cannot see a SUSPENDED restaurant they don't belong to (the platform-admin-only grant doesn't leak to them)", async () => {
    const mine = await createTestRestaurant();
    const other = await createTestRestaurant();
    await sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${other.restaurantId}`;

    const visible = await withRole("authenticated", mine.adminId, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${other.restaurantId}::uuid`;
    });
    expect(visible).toHaveLength(0);
  });

  it("a restaurant admin CAN see another restaurant's public (active) row now — intentional, matching anon (Bug #3 fix), not a platform-admin leak", async () => {
    const mine = await createTestRestaurant();
    const other = await createTestRestaurant();

    const visible = await withRole("authenticated", mine.adminId, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${other.restaurantId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });

  it("a restaurant admin can still see their own restaurant (regression)", async () => {
    const fx = await createTestRestaurant();
    const visible = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${fx.restaurantId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });

  it("a platform admin can see a restaurant they have no staff relationship with at all", async () => {
    const platformAdminFx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${platformAdminFx.adminId})`;
    const other = await createTestRestaurant();

    const visible = await withRole("authenticated", platformAdminFx.adminId, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${other.restaurantId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });

  it("a platform admin with ZERO restaurant memberships can still see every restaurant", async () => {
    const platformOnlyId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${platformOnlyId}, ${"platform-only-b-" + platformOnlyId + "@example.com"})`;
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${platformOnlyId})`;
    const fx = await createTestRestaurant();

    const visible = await withRole("authenticated", platformOnlyId, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${fx.restaurantId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });
});

describe("staff_users — platform-admin read access (Phase 4)", () => {
  it("a restaurant admin cannot see a staff_users row for someone at a restaurant they don't belong to", async () => {
    const mine = await createTestRestaurant();
    const other = await createTestRestaurant();

    const visible = await withRole("authenticated", mine.adminId, async (conn) => {
      return conn`SELECT id FROM staff_users WHERE id = ${other.adminId}::uuid`;
    });
    expect(visible).toHaveLength(0);
  });

  it("a platform admin can resolve any staff_users row, needed to show a restaurant's owner email", async () => {
    const platformAdminFx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${platformAdminFx.adminId})`;
    const other = await createTestRestaurant();

    const visible = await withRole("authenticated", platformAdminFx.adminId, async (conn) => {
      return conn`SELECT id, email FROM staff_users WHERE id = ${other.adminId}::uuid`;
    });
    expect(visible).toHaveLength(1);
  });
});

/**
 * Bug #1 (Phase 5 live acceptance test) — app/actions/auth.ts's
 * signInWithPassword() rejected any login where the authenticated user
 * had zero active restaurant_staff rows, with no carve-out for
 * platform_admins — a pure platform employee (the exact identity shape
 * §architecture Part 3 and this file's own "ZERO restaurant memberships"
 * tests above describe as valid) could never actually sign in. Confirmed
 * live: only reachable at all via a manual grant-then-deactivate
 * workaround.
 *
 * The fix (app/actions/auth.ts) is purely additive: if the restaurant_staff
 * count is zero, ALSO check platform_admins before rejecting, and land a
 * zero-membership platform admin on /platform (never /staff/dashboard,
 * which would immediately bounce them back to /staff/login — see
 * requireStaffContext) — /staff must still never auto-select a
 * restaurant for them, and platform-admin status is never converted into
 * or treated as a restaurant membership.
 *
 * signInWithPassword() itself can't be invoked here — it's a "use server"
 * action requiring a real Supabase Auth (GoTrue) session, which this
 * bare-Postgres harness doesn't have (same boundary as
 * order-tenant-scoping.test.ts). loginDecision() below mirrors its exact
 * post-auth gating logic over the two RLS-scoped counts the fixed code
 * now queries — proving that logic against real fixtures for all four
 * required scenarios.
 */
describe("Bug #1 regression — signInWithPassword's login gate", () => {
  async function loginGateCounts(userId: string): Promise<{ staffCount: number; platformAdminCount: number }> {
    const [staffRow] = await withRole("authenticated", userId, (conn) => conn`SELECT count(*)::int AS count FROM restaurant_staff WHERE is_active = true`);
    // platform_admins_select_platform_admin's USING clause is a per-session
    // boolean (is_platform_admin()), not a per-row match — once the caller
    // qualifies, EVERY row becomes visible, not just their own (see "a
    // platform admin can see the full roster" above). An explicit
    // staff_user_id filter is what makes this an exact "is THIS user a
    // platform admin" count instead of "how many platform admins exist
    // total" — the same scoping app/actions/auth.ts's fix applies.
    const [platformAdminRow] = await withRole(
      "authenticated",
      userId,
      (conn) => conn`SELECT count(*)::int AS count FROM platform_admins WHERE staff_user_id = ${userId}::uuid`,
    );
    return { staffCount: staffRow!.count as number, platformAdminCount: platformAdminRow!.count as number };
  }

  // Mirrors app/actions/auth.ts's signInWithPassword() exactly: if
  // staffCount is truthy, unchanged pre-existing behavior; otherwise the
  // new platform_admins carve-out decides accept/reject, and where a
  // zero-membership platform admin lands.
  function loginDecision(staffCount: number, platformAdminCount: number): { allowed: boolean; redirectTo: "/staff/dashboard" | "/platform" | null } {
    if (staffCount > 0) return { allowed: true, redirectTo: "/staff/dashboard" };
    if (platformAdminCount > 0) return { allowed: true, redirectTo: "/platform" };
    return { allowed: false, redirectTo: null };
  }

  it("an ordinary user with zero memberships and no platform_admins row is still rejected", async () => {
    const ordinaryId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${ordinaryId}, ${"ordinary-" + ordinaryId + "@example.com"})`;

    const { staffCount, platformAdminCount } = await loginGateCounts(ordinaryId);
    expect(staffCount).toBe(0);
    expect(platformAdminCount).toBe(0);
    expect(loginDecision(staffCount, platformAdminCount)).toEqual({ allowed: false, redirectTo: null });
  });

  it("a platform admin with zero restaurant memberships is now allowed, and lands on /platform — never auto-selecting a restaurant", async () => {
    const platformOnlyId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${platformOnlyId}, ${"platform-only-login-" + platformOnlyId + "@example.com"})`;
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${platformOnlyId})`;

    const { staffCount, platformAdminCount } = await loginGateCounts(platformOnlyId);
    expect(staffCount).toBe(0);
    expect(platformAdminCount).toBe(1);
    expect(loginDecision(staffCount, platformAdminCount)).toEqual({ allowed: true, redirectTo: "/platform" });
  });

  it("a platform admin who ALSO has restaurant memberships keeps the existing behavior — lands on /staff/dashboard, exactly as before this fix", async () => {
    const fx = await createTestRestaurant();
    await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${fx.adminId})`;

    const { staffCount, platformAdminCount } = await loginGateCounts(fx.adminId);
    expect(staffCount).toBeGreaterThan(0);
    expect(platformAdminCount).toBe(1);
    expect(loginDecision(staffCount, platformAdminCount)).toEqual({ allowed: true, redirectTo: "/staff/dashboard" });
  });

  it("a restaurant admin who is NOT a platform admin is unaffected by this fix — lands on /staff/dashboard as always", async () => {
    const fx = await createTestRestaurant();

    const { staffCount, platformAdminCount } = await loginGateCounts(fx.adminId);
    expect(staffCount).toBeGreaterThan(0);
    expect(platformAdminCount).toBe(0);
    expect(loginDecision(staffCount, platformAdminCount)).toEqual({ allowed: true, redirectTo: "/staff/dashboard" });
  });
});

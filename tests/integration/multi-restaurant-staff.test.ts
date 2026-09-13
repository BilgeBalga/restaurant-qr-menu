import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * SaaS Phase 5 — proves restaurant_staff's N:N shape (already structurally
 * correct since Phase 2, restaurant_staff_restaurant_user_unique is
 * (restaurant_id, staff_user_id), not staff_user_id alone) actually
 * behaves correctly under a genuine multi-tenant identity, not just in
 * theory. Every fixture below creates TWO real restaurants and then adds
 * the SAME staff_user_id as a member of both — never two separate users
 * standing in for "multi-tenant," which would prove nothing about this
 * phase's actual point.
 */

/** Adds `staffUserId` (already a real auth.users/staff_users row from another createTestRestaurant() fixture) as an additional member of `restaurantId`, with `role`. */
async function addExistingUserToRestaurant(restaurantId: string, staffUserId: string, role: "admin" | "manager" | "staff" | "kitchen") {
  await sql`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${restaurantId}, ${staffUserId}, ${role})`;
}

describe("a single staff identity across two real tenants", () => {
  it("restaurant_staff correctly holds two active rows for the same staff_user_id, one per restaurant", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const rows = await sql`SELECT restaurant_id, role FROM restaurant_staff WHERE staff_user_id = ${a.adminId} AND is_active = true ORDER BY role`;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.restaurant_id).sort()).toEqual([a.restaurantId, b.restaurantId].sort());
  });

  it("the same person can be admin at one restaurant and merely staff at another — role is scoped per membership, never global", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const [roleAtA] = await withRole("authenticated", a.adminId, (conn) => conn`SELECT staff_role_for(${a.restaurantId}::uuid) AS role`);
    expect(roleAtA!.role).toBe("admin");

    const [roleAtB] = await withRole("authenticated", a.adminId, (conn) => conn`SELECT staff_role_for(${b.restaurantId}::uuid) AS role`);
    expect(roleAtB!.role).toBe("staff");
  });

  it("admin-only writes succeed at the restaurant where this person is admin, and are silently filtered (not an error) where they're only staff", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const updatedA = await withRole("authenticated", a.adminId, (conn) => {
      return conn`UPDATE restaurants SET name = 'Renamed A' WHERE id = ${a.restaurantId}::uuid RETURNING id`;
    });
    expect(updatedA).toHaveLength(1);

    const updatedB = await withRole("authenticated", a.adminId, (conn) => {
      return conn`UPDATE restaurants SET name = 'Should Not Apply' WHERE id = ${b.restaurantId}::uuid RETURNING id`;
    });
    expect(updatedB).toHaveLength(0); // restaurants_update_admin requires staff_role_for(id) = 'admin' — this person is only 'staff' at B

    const [bRow] = await sql`SELECT name FROM restaurants WHERE id = ${b.restaurantId}`;
    expect(bRow!.name).not.toBe("Should Not Apply");
  });

  it("an UNSCOPED query legitimately shows rows from BOTH restaurants for a dual member — this is correct, expected RLS behavior, not a leak", async () => {
    // RLS answers "is this row visible to auth.uid() at all" per row, not
    // "is this the caller's currently-selected restaurant" — a person
    // who's genuinely staff at two restaurants is allowed to see menu
    // items at both. Demonstrating this is the point of the next test:
    // it's exactly why every staff action must explicitly scope by
    // membership.restaurantId rather than relying on RLS alone.
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const allVisible = await withRole("authenticated", a.adminId, (conn) => conn`SELECT restaurant_id FROM menu_items`);
    const restaurantIds = new Set(allVisible.map((r) => r.restaurant_id));
    expect(restaurantIds.has(a.restaurantId)).toBe(true);
    expect(restaurantIds.has(b.restaurantId)).toBe(true);
  });

  it("an explicitly-scoped query — the pattern every staff action actually uses via membership.restaurantId — sees only the selected restaurant, even for a dual member", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const onlyA = await withRole("authenticated", a.adminId, (conn) => {
      return conn`SELECT restaurant_id FROM menu_items WHERE restaurant_id = ${a.restaurantId}::uuid`;
    });
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyA.every((r) => r.restaurant_id === a.restaurantId)).toBe(true);

    const onlyB = await withRole("authenticated", a.adminId, (conn) => {
      return conn`SELECT restaurant_id FROM menu_items WHERE restaurant_id = ${b.restaurantId}::uuid`;
    });
    expect(onlyB.length).toBeGreaterThan(0);
    expect(onlyB.every((r) => r.restaurant_id === b.restaurantId)).toBe(true);
  });

  it("orders placed at restaurant A are never visible when scoped to restaurant B, for this same dual-member person", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "admin");

    const [order] = await withRole("anon", null, (conn) => {
      return conn`SELECT public.create_order(${a.tableId}::uuid, ${conn.json([{ menu_item_id: a.menuItemId, quantity: 1 }])}, NULL, ${crypto.randomUUID()}, NULL) AS result`;
    });
    const orderId = (order!.result as { order_id: string }).order_id;

    const visibleAtA = await withRole("authenticated", a.adminId, (conn) => conn`SELECT id FROM orders WHERE id = ${orderId}::uuid AND restaurant_id = ${a.restaurantId}::uuid`);
    expect(visibleAtA).toHaveLength(1);

    const visibleAtBScoped = await withRole("authenticated", a.adminId, (conn) => conn`SELECT id FROM orders WHERE id = ${orderId}::uuid AND restaurant_id = ${b.restaurantId}::uuid`);
    expect(visibleAtBScoped).toHaveLength(0); // same person, but scoped to B — A's order is invisible
  });
});

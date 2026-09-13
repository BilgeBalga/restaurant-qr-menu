import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * Bug #2 (Phase 5 live acceptance test, CRITICAL) —
 * app/actions/orders.ts's getOrderDetail/setOrderStatus/listActiveOrders
 * (and, found during the post-fix audit, clearTable) queried by entity id
 * alone, relying entirely on RLS (is_staff_of) to gate access. RLS proves
 * "is this staff at *a* restaurant they belong to," never "is this their
 * currently SELECTED restaurant" (see multi-restaurant-staff.test.ts's own
 * "unscoped query legitimately shows rows from BOTH restaurants" test) —
 * so a genuinely dual-membership staffer could read/write another
 * restaurant's order, or see it on the wrong restaurant's active-order
 * board, while a DIFFERENT restaurant was their active context. Confirmed
 * live against the real Supabase project: a staffer switched to "QR Live
 * Test Alpha" could still read and change the status of a "QR Live Test
 * Beta" order, and saw it on Alpha's kanban board.
 *
 * The fix adds an explicit .eq("restaurant_id", membership.restaurantId)
 * — membership always freshly re-derived by requireActiveMembership(),
 * never client-supplied — to every one of these queries, and (for
 * setOrderStatus/clearTable) refuses to ever call the underlying
 * SECURITY DEFINER RPC unless that scoped pre-check already found the
 * entity in the active restaurant.
 *
 * This file cannot invoke the actual "use server" action functions
 * directly — they require next/headers + a real Supabase Auth session,
 * unavailable to this bare-Postgres harness (the same architectural
 * boundary that made a live browser acceptance test necessary in the
 * first place — see the Phase 5 live acceptance report). Instead it
 * proves, against a real dual-membership fixture, the exact SQL-level
 * contract those fixes now rely on: the scoped query shape correctly
 * isolates by ACTIVE restaurant in both directions, and — for the two
 * RPC-backed writes, whose SECURITY DEFINER functions legitimately
 * re-derive role from the entity's TRUE restaurant, not any "selected"
 * one — that the RPC itself still succeeds when called directly. That's
 * not a residual bug: it's exactly why the pre-check (not the RPC) has
 * to be the guard, and confirms the fix didn't weaken RLS or change RPC
 * trust to satisfy it.
 */

async function addExistingUserToRestaurant(restaurantId: string, staffUserId: string, role: "admin" | "manager" | "staff" | "kitchen") {
  await sql`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${restaurantId}, ${staffUserId}, ${role})`;
}

async function placeOrder(tableId: string, menuItemId: string) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(${tableId}::uuid, ${conn.json([{ menu_item_id: menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()}) AS result
    `;
    return row!.result as { order_id: string };
  });
}

describe("Bug #2 regression — order/table actions scoped to the ACTIVE restaurant, not just any restaurant RLS allows", () => {
  it("getOrderDetail's fixed query shape isolates restaurant B's order by active restaurant, in both directions", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const orderB = await placeOrder(b.tableId, b.menuItemId);

    // The OLD, buggy shape (id alone) legitimately finds it — proving RLS
    // alone was never going to catch this; is_staff_of(B) is true here.
    const unscoped = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT id FROM orders WHERE id = ${orderB.order_id}::uuid`,
    );
    expect(unscoped).toHaveLength(1);

    // The FIXED shape — id + active restaurant = A — correctly excludes it.
    const scopedToA = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT id FROM orders WHERE id = ${orderB.order_id}::uuid AND restaurant_id = ${a.restaurantId}::uuid`,
    );
    expect(scopedToA).toHaveLength(0);

    // "Switch context to B": scoped to B, the same order is readable again.
    const scopedToB = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT id FROM orders WHERE id = ${orderB.order_id}::uuid AND restaurant_id = ${b.restaurantId}::uuid`,
    );
    expect(scopedToB).toHaveLength(1);
  });

  it("listActiveOrders' fixed query shape: restaurant B's active order never appears on A's board, and vice versa", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const orderA = await placeOrder(a.tableId, a.menuItemId);
    const orderB = await placeOrder(b.tableId, b.menuItemId);

    const boardWhileAActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT id FROM orders WHERE restaurant_id = ${a.restaurantId}::uuid AND status IN ('new','preparing','ready')`,
    );
    const idsOnA = boardWhileAActive.map((r) => r.id);
    expect(idsOnA).toContain(orderA.order_id);
    expect(idsOnA).not.toContain(orderB.order_id);

    // Inverse direction.
    const boardWhileBActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT id FROM orders WHERE restaurant_id = ${b.restaurantId}::uuid AND status IN ('new','preparing','ready')`,
    );
    const idsOnB = boardWhileBActive.map((r) => r.id);
    expect(idsOnB).toContain(orderB.order_id);
    expect(idsOnB).not.toContain(orderA.order_id);
  });

  it("setOrderStatus's fixed pre-check finds nothing for restaurant B's order while A is active — even though set_order_status itself would still allow the write if called directly", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const orderB = await placeOrder(b.tableId, b.menuItemId);

    // The fixed pre-check query — exactly what app/actions/orders.ts now
    // runs BEFORE ever calling set_order_status. Finding nothing here is
    // what makes the action refuse to reach the RPC at all.
    const preCheckWhileAActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT status FROM orders WHERE id = ${orderB.order_id}::uuid AND restaurant_id = ${a.restaurantId}::uuid`,
    );
    expect(preCheckWhileAActive).toHaveLength(0);

    // Document exactly why the pre-check — not the RPC — has to be the
    // guard: set_order_status is SECURITY DEFINER and re-derives role
    // from the order's TRUE restaurant (B, via staff_role_for), not from
    // anything "selected", so calling it directly still succeeds here.
    // This is intentional and unchanged (per instructions: don't weaken
    // RLS, don't change the RPC to trust a client-supplied restaurant id)
    // — isolation has to come from never reaching the RPC in the first
    // place for an out-of-context order.
    await withRole("authenticated", a.adminId, (conn) => conn`SELECT public.set_order_status(${orderB.order_id}::uuid, 'preparing', NULL)`);
    const [afterDirectRpcCall] = await sql`SELECT status FROM orders WHERE id = ${orderB.order_id}`;
    expect(afterDirectRpcCall!.status).toBe("preparing");

    // "Switch context to B": the pre-check now finds the (already
    // transitioned) order, and a legitimate further transition succeeds.
    const preCheckWhileBActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT status FROM orders WHERE id = ${orderB.order_id}::uuid AND restaurant_id = ${b.restaurantId}::uuid`,
    );
    expect(preCheckWhileBActive).toHaveLength(1);

    await withRole("authenticated", a.adminId, (conn) => conn`SELECT public.set_order_status(${orderB.order_id}::uuid, 'ready', NULL)`);
    const [afterLegitimateWrite] = await sql`SELECT status FROM orders WHERE id = ${orderB.order_id}`;
    expect(afterLegitimateWrite!.status).toBe("ready");
  });

  it("inverse direction: setOrderStatus's pre-check finds nothing for restaurant A's order while B is active", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    const orderA = await placeOrder(a.tableId, a.menuItemId);

    const preCheckWhileBActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT status FROM orders WHERE id = ${orderA.order_id}::uuid AND restaurant_id = ${b.restaurantId}::uuid`,
    );
    expect(preCheckWhileBActive).toHaveLength(0);

    const preCheckWhileAActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT status FROM orders WHERE id = ${orderA.order_id}::uuid AND restaurant_id = ${a.restaurantId}::uuid`,
    );
    expect(preCheckWhileAActive).toHaveLength(1);
  });

  it("clearTable's fixed pre-check (found during the post-fix audit — same pattern, a different entity): restaurant B's table cannot be found while A is active, even though clear_table's RPC would still allow it directly", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await addExistingUserToRestaurant(b.restaurantId, a.adminId, "staff");

    await placeOrder(b.tableId, b.menuItemId); // opens a table_session at B's table

    const preCheckWhileAActive = await withRole("authenticated", a.adminId, (conn) =>
      conn`SELECT id FROM tables WHERE id = ${b.tableId}::uuid AND restaurant_id = ${a.restaurantId}::uuid`,
    );
    expect(preCheckWhileAActive).toHaveLength(0);

    // Same shape as set_order_status: clear_table is SECURITY DEFINER and
    // re-derives role from the TABLE's true restaurant (B) — calling it
    // directly still succeeds, which is exactly why the guard has to be
    // the pre-check that now runs before it, not the RPC itself.
    await withRole("authenticated", a.adminId, (conn) => conn`SELECT public.clear_table(${b.tableId}::uuid)`);
    const [session] = await sql`SELECT status FROM table_sessions WHERE table_id = ${b.tableId} ORDER BY opened_at DESC LIMIT 1`;
    expect(session!.status).toBe("closed");
  });
});

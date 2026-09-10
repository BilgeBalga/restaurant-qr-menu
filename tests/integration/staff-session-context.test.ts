import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * Exercises the exact query patterns Phase 3's app-layer DAL
 * (lib/auth/session.ts) and login rejection (app/actions/auth.ts) rely
 * on — restaurant_staff lookups scoped to auth.uid(), RLS already
 * proven in Phase 2's rls-permissions/multi-tenant-isolation suites.
 * This file is about the *shape* those two new call sites depend on.
 */
describe("staff session context (§19 DAL)", () => {
  it("an authenticated user with zero restaurant_staff rows resolves to no membership — matches getStaffContext's empty-array case", async () => {
    const fx = await createTestRestaurant();
    const strangerId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${strangerId}, 'stranger@example.com')`;

    const rows = await withRole("authenticated", strangerId, async (conn) => {
      return conn`SELECT restaurant_id, role FROM restaurant_staff WHERE staff_user_id = ${strangerId} AND is_active = true`;
    });

    expect(rows).toHaveLength(0);
    void fx; // restaurant exists only to prove the stranger has zero rows despite a real restaurant existing
  });

  it("a deactivated (is_active=false) staff row is invisible to the same lookup — matches the login-rejection count query", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurant_staff SET is_active = false WHERE staff_user_id = ${fx.staffId}`;

    const rows = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM restaurant_staff WHERE staff_user_id = ${fx.staffId} AND is_active = true`;
    });

    expect(rows).toHaveLength(0);

    // Deactivated staff also can't act — set_order_status independently checks staff_role_for.
    const order = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(${fx.tableId}::uuid, ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()}) AS result
      `;
      return row!.result as { order_id: string };
    });
    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`SELECT public.set_order_status(${order.order_id}::uuid, 'preparing', NULL)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("an active membership resolves with the correct role, restaurant, and restaurant name — matches getStaffContext's success case", async () => {
    const fx = await createTestRestaurant();

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT rs.restaurant_id, rs.role, r.name AS restaurant_name
        FROM restaurant_staff rs JOIN restaurants r ON r.id = rs.restaurant_id
        WHERE rs.staff_user_id = ${fx.adminId} AND rs.is_active = true
      `;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ restaurant_id: fx.restaurantId, role: "admin" });
    expect(rows[0]?.restaurant_name).toBeTruthy();
  });

  it("staff of restaurant A gets zero membership rows when queried against restaurant B's context (tenant isolation at the DAL's own query)", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const rows = await withRole("authenticated", a.staffId, async (conn) => {
      return conn`SELECT id FROM restaurant_staff WHERE staff_user_id = ${a.staffId} AND restaurant_id = ${b.restaurantId}::uuid`;
    });

    expect(rows).toHaveLength(0);
  });
});

describe("admin vs staff permission boundary (§11, exercised through the real RPCs)", () => {
  it("staff can move an order through the working columns; only admin can cancel once ready", async () => {
    const fx = await createTestRestaurant();
    const order = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(${fx.tableId}::uuid, ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()}) AS result
      `;
      return row!.result as { order_id: string };
    });

    await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.set_order_status(${order.order_id}::uuid, 'preparing', NULL)`;
    });
    await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.set_order_status(${order.order_id}::uuid, 'ready', NULL)`;
    });

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`SELECT public.set_order_status(${order.order_id}::uuid, 'cancelled', NULL)`;
      }),
    ).rejects.toThrow(/ILLEGAL_TRANSITION/);

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT public.set_order_status(${order.order_id}::uuid, 'cancelled', NULL)`;
    });

    const [row] = await sql`SELECT status FROM orders WHERE id = ${order.order_id}`;
    expect(row!.status).toBe("cancelled");
  });
});

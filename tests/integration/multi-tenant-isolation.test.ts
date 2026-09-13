import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * Scenario 10 of the critical review: "Restaurant A and Restaurant B
 * exist in the database. Staff from Restaurant A must never be able to
 * access Restaurant B's data." This is the single most important test
 * in the suite — RLS is claimed as the actual guarantee (§26), not the
 * SQL file existing, so it has to be proven against a real Postgres
 * enforcing it against a genuinely different tenant's staff session!.
 */
describe("multi-tenant isolation", () => {

  it("staff of restaurant A cannot see restaurant B's orders", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const orderB = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(
          ${b.tableId}::uuid,
          ${conn.json([{ menu_item_id: b.menuItemId, quantity: 1 }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        ) AS result
      `;
      return row!.result as { order_id: string };
    });

    const visibleToA = await withRole("authenticated", a.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE id = ${orderB.order_id}`;
    });
    expect(visibleToA).toHaveLength(0);

    const visibleToB = await withRole("authenticated", b.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE id = ${orderB.order_id}`;
    });
    expect(visibleToB).toHaveLength(1);
  });

  it("staff of restaurant A cannot change status on restaurant B's order", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const orderB = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(
          ${b.tableId}::uuid,
          ${conn.json([{ menu_item_id: b.menuItemId, quantity: 1 }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        ) AS result
      `;
      return row!.result as { order_id: string };
    });

    await expect(
      withRole("authenticated", a.staffId, async (conn) => {
        return conn`SELECT public.set_order_status(${orderB.order_id}::uuid, 'preparing', NULL)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);

    const [row] = await sql`SELECT status FROM orders WHERE id = ${orderB.order_id}`;
    expect(row!.status).toBe("new");
  });

  // Updated for db/migrations/0014_public_menu_authenticated_access.sql
  // (Phase 5 live acceptance Bug #3 fix): an ACTIVE menu item's row is
  // now intentionally, publicly readable by any authenticated user —
  // matching anon exactly, the same as scanning that restaurant's own QR
  // code would show. That's the fix working as designed, not a leak, so
  // it can no longer stand in for "staff SELECT isolates tenants." An
  // INACTIVE (soft-deleted) item isn't public either way — is_staff_of
  // is still the ONLY thing that can grant it — so it's what actually
  // still proves staff-scoped isolation here.
  it("staff of restaurant A cannot see restaurant B's INACTIVE menu items via staff SELECT (active items are now intentionally public — see rls-permissions.test.ts)", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await withRole("authenticated", b.adminId, async (conn) => {
      return conn`UPDATE menu_items SET is_active = false WHERE id = ${b.menuItemId}::uuid`;
    });

    const rows = await withRole("authenticated", a.staffId, async (conn) => {
      return conn`SELECT id FROM menu_items WHERE id = ${b.menuItemId}`;
    });
    expect(rows).toHaveLength(0);
  });

  it("staff of restaurant A cannot see restaurant B's staff roster", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const rows = await withRole("authenticated", a.staffId, async (conn) => {
      return conn`SELECT id FROM restaurant_staff WHERE restaurant_id = ${b.restaurantId}::uuid`;
    });
    expect(rows).toHaveLength(0);
  });

  it("staff of restaurant A cannot regenerate/read restaurant B's QR tokens", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const rows = await withRole("authenticated", a.staffId, async (conn) => {
      return conn`SELECT id FROM table_qr_tokens WHERE restaurant_id = ${b.restaurantId}::uuid`;
    });
    expect(rows).toHaveLength(0);
  });
});

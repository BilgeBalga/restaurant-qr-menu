import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

/**
 * SaaS Phase 1 (Foundation) — db/migrations/0010_restaurant_lifecycle_status.sql.
 * Covers the replacement of restaurants.is_active with a proper
 * provisioning|active|suspended|archived status, the new
 * owner_staff_user_id pointer, and the column-privilege narrowing that
 * keeps both unwritable through the normal RLS-scoped client.
 */

async function callCreateOrder(tableId: string, items: readonly postgres.JSONValue[], idempotencyKey: string) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(${tableId}::uuid, ${conn.json(items)}, NULL, ${idempotencyKey}, NULL) AS result
    `;
    return row!.result as { order_id: string };
  });
}

async function resolveToken(token: string) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`SELECT public.resolve_table_by_token(${token}) AS result`;
    return row!.result as { restaurant_active: boolean; table_active: boolean };
  });
}

describe("restaurant lifecycle — create_order enforces status at the DB level", () => {
  it("allows an order when the restaurant is active (regression — default/unchanged behavior)", async () => {
    const fx = await createTestRestaurant();
    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-active-1"));
    expect(result.order_id).toBeDefined();
  });

  it("rejects an order when the restaurant is suspended, and creates nothing", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${fx.restaurantId}`;

    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-suspended-1")),
    ).rejects.toThrow(/RESTAURANT_INACTIVE/);

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
    expect(countRow!.count).toBe(0);
  });

  it("rejects an order when the restaurant is archived, and creates nothing", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET status = 'archived' WHERE id = ${fx.restaurantId}`;

    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-archived-1")),
    ).rejects.toThrow(/RESTAURANT_INACTIVE/);

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
    expect(countRow!.count).toBe(0);
  });

  it("rejects an order when the restaurant is still provisioning — must never be reachable in practice, but the DB check must hold regardless", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET status = 'provisioning' WHERE id = ${fx.restaurantId}`;

    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-provisioning-1")),
    ).rejects.toThrow(/RESTAURANT_INACTIVE/);
  });

  it("an idempotent retry of an order placed while active still succeeds even if the restaurant is suspended afterward", async () => {
    const fx = await createTestRestaurant();
    const key = uniqueKey("idem-retry-after-suspend");
    const first = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], key);

    await sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${fx.restaurantId}`;

    const retry = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], key);
    expect(retry.order_id).toBe(first.order_id);
  });
});

describe("restaurant lifecycle — resolve_table_by_token reflects status", () => {
  it("reports restaurant_active correctly across active/suspended/archived", async () => {
    const fx = await createTestRestaurant();

    expect((await resolveToken(fx.qrToken)).restaurant_active).toBe(true);

    await sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${fx.restaurantId}`;
    expect((await resolveToken(fx.qrToken)).restaurant_active).toBe(false);

    await sql`UPDATE restaurants SET status = 'archived' WHERE id = ${fx.restaurantId}`;
    expect((await resolveToken(fx.qrToken)).restaurant_active).toBe(false);
  });
});

describe("restaurant lifecycle — anon RLS gates on status, not the old is_active", () => {
  it("anon cannot see a suspended restaurant row directly", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET status = 'suspended' WHERE id = ${fx.restaurantId}`;

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${fx.restaurantId}::uuid`;
    });
    expect(rows).toHaveLength(0);
  });

  it("anon cannot see an archived restaurant row directly", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET status = 'archived' WHERE id = ${fx.restaurantId}`;

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${fx.restaurantId}::uuid`;
    });
    expect(rows).toHaveLength(0);
  });

  it("anon can still see an active restaurant row (regression)", async () => {
    const fx = await createTestRestaurant();
    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT id FROM restaurants WHERE id = ${fx.restaurantId}::uuid`;
    });
    expect(rows).toHaveLength(1);
  });
});

describe("restaurant lifecycle — status/owner_staff_user_id are unwritable through the RLS-scoped client", () => {
  it("a restaurant admin cannot change status via a direct UPDATE, even to their own restaurant", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`UPDATE restaurants SET status = 'suspended' WHERE id = ${fx.restaurantId}::uuid`;
      }),
    ).rejects.toThrow(/permission denied/);

    const [row] = await sql`SELECT status FROM restaurants WHERE id = ${fx.restaurantId}`;
    expect(row!.status).toBe("active"); // untouched
  });

  it("a restaurant admin cannot change owner_staff_user_id via a direct UPDATE", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`UPDATE restaurants SET owner_staff_user_id = ${fx.adminId}::uuid WHERE id = ${fx.restaurantId}::uuid`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("a restaurant admin CAN still change name/ordering_enabled directly (regression — column grant isn't overly restrictive)", async () => {
    const fx = await createTestRestaurant();

    const [row] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE restaurants SET ordering_enabled = false, name = 'Renamed Bistro' WHERE id = ${fx.restaurantId}::uuid RETURNING ordering_enabled, name`;
    });
    expect(row!.ordering_enabled).toBe(false);
    expect(row!.name).toBe("Renamed Bistro");
  });
});

describe("restaurant lifecycle — owner_staff_user_id is informational only", () => {
  it("defaults to null for a freshly-created restaurant and can be set directly (no RLS/permission check tied to it besides the write-privilege narrowing above)", async () => {
    const fx = await createTestRestaurant();

    const [before] = await sql`SELECT owner_staff_user_id FROM restaurants WHERE id = ${fx.restaurantId}`;
    expect(before!.owner_staff_user_id).toBeNull();

    await sql`UPDATE restaurants SET owner_staff_user_id = ${fx.adminId} WHERE id = ${fx.restaurantId}`;
    const [after] = await sql`SELECT owner_staff_user_id FROM restaurants WHERE id = ${fx.restaurantId}`;
    expect(after!.owner_staff_user_id).toBe(fx.adminId);
  });
});

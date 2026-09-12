import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";
import { startOfDayInTimeZone, startOfNextDayInTimeZone } from "@/lib/business/timezone";
import { can } from "@/lib/business/permissions";

async function createOrder(tableId: string, menuItemId: string, key: string) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(
        ${tableId}::uuid, ${conn.json([{ menu_item_id: menuItemId, quantity: 1 }])}, NULL, ${key}
      ) AS result
    `;
    return row!.result as { order_id: string };
  });
}

async function setStatus(orderId: string, staffId: string, status: string) {
  return withRole("authenticated", staffId, async (conn) => {
    return conn`SELECT public.set_order_status(${orderId}::uuid, ${status}, NULL)`;
  });
}

/**
 * These tests exercise the exact query shape app/actions/orders.ts's
 * listOrderHistory() runs — restaurant_id + status IN (...) plus optional
 * table_id / date-range / ILIKE filters — directly against Postgres under
 * an authenticated staff session. Same convention as every other
 * integration test (rls-permissions.test.ts, multi-tenant-isolation.test.ts):
 * this harness authenticates via withRole()/raw SQL, not through the
 * Next.js server action, which needs a request-scoped cookie-backed
 * Supabase client this harness doesn't construct. RLS (orders_select_staff)
 * is what's actually under test for isolation/authorization; the
 * additional .eq("restaurant_id", ...) the action applies is defense in
 * depth on top of it.
 */
describe("order history — retrieval and completed/cancelled filtering", () => {
  it("returns only completed and cancelled orders, never new/preparing/ready", async () => {
    const fx = await createTestRestaurant();
    const active = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-active"));
    const completed = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-completed"));
    const cancelled = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-cancelled"));
    await setStatus(completed.order_id, fx.staffId, "preparing");
    await setStatus(completed.order_id, fx.staffId, "ready");
    await setStatus(completed.order_id, fx.staffId, "completed");
    await setStatus(cancelled.order_id, fx.staffId, "cancelled");
    // `active` stays "new" — never transitioned.

    const rows = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
      `;
    });

    const ids = rows.map((r) => r.id as string);
    expect(ids).toContain(completed.order_id);
    expect(ids).toContain(cancelled.order_id);
    expect(ids).not.toContain(active.order_id);
  });

  it("a status filter of just 'completed' excludes cancelled orders, and vice versa", async () => {
    const fx = await createTestRestaurant();
    const completed = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-status-completed"));
    const cancelled = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-status-cancelled"));
    await setStatus(completed.order_id, fx.staffId, "preparing");
    await setStatus(completed.order_id, fx.staffId, "ready");
    await setStatus(completed.order_id, fx.staffId, "completed");
    await setStatus(cancelled.order_id, fx.staffId, "cancelled");

    const completedOnly = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed')`;
    });
    expect(completedOnly.map((r) => r.id)).toEqual([completed.order_id]);

    const cancelledOnly = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('cancelled')`;
    });
    expect(cancelledOnly.map((r) => r.id)).toEqual([cancelled.order_id]);
  });

  it("table label is available via the same join the action embeds (tables(label))", async () => {
    const fx = await createTestRestaurant();
    const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-join"));
    await setStatus(order.order_id, fx.staffId, "cancelled");
    const [expectedTable] = await sql`SELECT label FROM tables WHERE id = ${fx.tableId}`;

    const [row] = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT o.id, t.label FROM orders o JOIN tables t ON t.id = o.table_id
        WHERE o.id = ${order.order_id}
      `;
    });
    expect(row!.label).toBe(expectedTable!.label);
  });
});

describe("order history — search", () => {
  it("matches by order number", async () => {
    const fx = await createTestRestaurant();
    const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-search-num"));
    await setStatus(order.order_id, fx.staffId, "cancelled");
    const [row] = await sql`SELECT order_number FROM orders WHERE id = ${order.order_id}`;
    const fragment = (row!.order_number as string).slice(-3);

    const matches = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          AND order_number ILIKE ${"%" + fragment + "%"}
      `;
    });
    expect(matches.map((r) => r.id)).toContain(order.order_id);
  });

  it("matches by table label — resolved to table ids first, the same two-query approach the action uses", async () => {
    const fx = await createTestRestaurant();
    const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-search-table"));
    await setStatus(order.order_id, fx.staffId, "cancelled");

    const [tableRow] = await sql`SELECT label FROM tables WHERE id = ${fx.tableId}`;
    const fragment = (tableRow!.label as string).slice(0, 5);

    const matchingTables = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM tables WHERE restaurant_id = ${fx.restaurantId}::uuid AND label ILIKE ${"%" + fragment + "%"}`;
    });
    const matchingTableIds = matchingTables.map((r) => r.id as string);
    expect(matchingTableIds).toContain(fx.tableId);

    const matches = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          AND table_id = ANY(${matchingTableIds}::uuid[])
      `;
    });
    expect(matches.map((r) => r.id)).toContain(order.order_id);
  });

  it("a term matching neither an order number nor any table label returns nothing", async () => {
    const fx = await createTestRestaurant();
    const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-search-none"));
    await setStatus(order.order_id, fx.staffId, "cancelled");

    const matches = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          AND order_number ILIKE ${"%definitely-not-a-real-order-number%"}
      `;
    });
    expect(matches).toHaveLength(0);
  });
});

describe("order history — date range with restaurant timezone", () => {
  it("'today' uses the restaurant's own timezone, not UTC, for its boundary (§dashboard precedent)", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET timezone = 'America/New_York' WHERE id = ${fx.restaurantId}`;

    const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-tz"));
    await setStatus(order.order_id, fx.staffId, "cancelled");

    const now = new Date();
    const todayStart = startOfDayInTimeZone("America/New_York", now);
    const tomorrowStart = startOfNextDayInTimeZone("America/New_York", now);

    // Exactly at local midnight: included (>=).
    await sql`UPDATE orders SET created_at = ${todayStart.toISOString()} WHERE id = ${order.order_id}`;
    const included = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          AND created_at >= ${todayStart.toISOString()} AND created_at < ${tomorrowStart.toISOString()}
      `;
    });
    expect(included.map((r) => r.id)).toContain(order.order_id);

    // One millisecond before local midnight: excluded — proves the boundary
    // is the restaurant's local midnight, not a UTC-day boundary (New York
    // is UTC-4/-5, so a naive UTC-midnight filter would include this row).
    const justBefore = new Date(todayStart.getTime() - 1);
    await sql`UPDATE orders SET created_at = ${justBefore.toISOString()} WHERE id = ${order.order_id}`;
    const excluded = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          AND created_at >= ${todayStart.toISOString()} AND created_at < ${tomorrowStart.toISOString()}
      `;
    });
    expect(excluded.map((r) => r.id)).not.toContain(order.order_id);

    // One millisecond before tomorrow's local midnight: included (< is exclusive on the upper bound only).
    const justBeforeTomorrow = new Date(tomorrowStart.getTime() - 1);
    await sql`UPDATE orders SET created_at = ${justBeforeTomorrow.toISOString()} WHERE id = ${order.order_id}`;
    const includedLate = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        SELECT id FROM orders
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          AND created_at >= ${todayStart.toISOString()} AND created_at < ${tomorrowStart.toISOString()}
      `;
    });
    expect(includedLate.map((r) => r.id)).toContain(order.order_id);
  });
});

describe("order history — pagination", () => {
  it("pages via LIMIT/OFFSET in reverse-chronological order, with no overlap and no gaps", async () => {
    const fx = await createTestRestaurant();
    const orderIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey(`hist-page-${i}`));
      await setStatus(order.order_id, fx.staffId, "cancelled");
      await sql`UPDATE orders SET created_at = now() + (${i}::text || ' seconds')::interval WHERE id = ${order.order_id}`;
      orderIds.push(order.order_id);
    }
    // orderIds[4] was created "latest" (now + 4s) — reverse-chronological means it's first.
    const expectedOrder = [...orderIds].reverse();

    const pageSize = 2;
    const fetchPage = (page: number) =>
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`
          SELECT id FROM orders WHERE restaurant_id = ${fx.restaurantId}::uuid AND status IN ('completed', 'cancelled')
          ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `;
      });

    const page1 = (await fetchPage(1)).map((r) => r.id as string);
    const page2 = (await fetchPage(2)).map((r) => r.id as string);
    const page3 = (await fetchPage(3)).map((r) => r.id as string);

    expect(page1).toEqual(expectedOrder.slice(0, 2));
    expect(page2).toEqual(expectedOrder.slice(2, 4));
    expect(page3).toEqual(expectedOrder.slice(4, 5));
    // Bounded and non-overlapping — never an unbounded fetch of all 5 at once.
    expect(new Set([...page1, ...page2, ...page3]).size).toBe(5);
  });
});

describe("order history — tenant isolation and staff authorization", () => {
  it("staff of restaurant A see none of restaurant B's history, even with identical filters", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    const orderB = await createOrder(b.tableId, b.menuItemId, uniqueKey("hist-tenant-b"));
    await setStatus(orderB.order_id, b.staffId, "cancelled");

    const visibleToA = await withRole("authenticated", a.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE restaurant_id = ${b.restaurantId}::uuid AND status IN ('completed', 'cancelled')`;
    });
    expect(visibleToA).toHaveLength(0);

    const visibleToB = await withRole("authenticated", b.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE restaurant_id = ${b.restaurantId}::uuid AND status IN ('completed', 'cancelled')`;
    });
    expect(visibleToB.map((r) => r.id)).toContain(orderB.order_id);
  });

  it("anon has no access to order history — no SELECT grant on orders for anon at all", async () => {
    const fx = await createTestRestaurant();
    const order = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("hist-anon"));
    await setStatus(order.order_id, fx.staffId, "cancelled");

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT id FROM orders WHERE id = ${order.order_id}`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("RLS grants any staff role read access, but the app-layer history:read gate (§permissions) still excludes kitchen", () => {
    // RLS (orders_select_staff) is role-blind — it only checks is_staff_of(restaurant_id) — so the
    // above tenant-isolation assertions hold for every staff role identically. The finer-grained
    // "which roles may open the History screen at all" gate is enforced in the app layer, by
    // listOrderHistory()'s can(role, "history:read") check — fully unit-tested in permissions.test.ts.
    // This assertion just ties that existing coverage explicitly to this feature's actual usage.
    expect(can("admin", "history:read")).toBe(true);
    expect(can("staff", "history:read")).toBe(true);
    expect(can("kitchen", "history:read")).toBe(false);
  });
});

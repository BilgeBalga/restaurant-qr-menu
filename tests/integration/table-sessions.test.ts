import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

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

/**
 * Finding 1 / scenario 1 of the critical review: four phones at Table 12
 * submitting near-simultaneously must land in exactly ONE open session,
 * not four. The partial unique index (table_id) WHERE status='open' plus
 * create_order's INSERT ... ON CONFLICT ... DO NOTHING is what's actually
 * under test here — this is a real race, not a sequential simulation.
 */
describe("Finding 1 — concurrent table-session creation is race-safe", () => {

  it("four simultaneous first-orders at an idle table share exactly one session", async () => {
    const fx = await createTestRestaurant();

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => createOrder(fx.tableId, fx.menuItemId, `idem-concurrent-${i}`)),
    );
    expect(results).toHaveLength(4);

    const sessions = await sql`SELECT id FROM table_sessions WHERE table_id = ${fx.tableId}`;
    expect(sessions).toHaveLength(1);

    const orders = await sql`SELECT table_session_id FROM orders WHERE table_id = ${fx.tableId}`;
    expect(orders).toHaveLength(4);
    expect(new Set(orders.map((o) => o.table_session_id)).size).toBe(1);
  });

  it("twenty simultaneous first-orders at an idle table still share exactly one session", async () => {
    const fx = await createTestRestaurant();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => createOrder(fx.tableId, fx.menuItemId, `idem-heavy-${i}`)),
    );

    const [countRow] = await sql`SELECT count(*)::int AS count FROM table_sessions WHERE table_id = ${fx.tableId}`;
    const count = countRow!.count;
    expect(count).toBe(1);
  });

  it("order numbers stay unique and gapless under concurrent creation (Finding 4)", async () => {
    const fx = await createTestRestaurant();

    await Promise.all(
      Array.from({ length: 15 }, (_, i) => createOrder(fx.tableId, fx.menuItemId, `idem-ordernum-${i}`)),
    );

    const rows = await sql`SELECT order_number FROM orders WHERE restaurant_id = ${fx.restaurantId} ORDER BY order_number`;
    const numbers = rows.map((r) => r.order_number as string);
    expect(new Set(numbers).size).toBe(15); // no duplicates
    expect(numbers).toEqual(["T-001", "T-002", "T-003", "T-004", "T-005", "T-006", "T-007", "T-008", "T-009", "T-010", "T-011", "T-012", "T-013", "T-014", "T-015"]); // no gaps
  });

  it("different tables at the same restaurant get independent sessions", async () => {
    const fx = await createTestRestaurant();
    const [secondTable] = await sql`
      INSERT INTO tables (restaurant_id, label) VALUES (${fx.restaurantId}, 'Table Other') RETURNING id
    `;

    await createOrder(fx.tableId, fx.menuItemId, "idem-tableA");
    await createOrder(secondTable!.id, fx.menuItemId, "idem-tableB");

    const [countRow] = await sql`SELECT count(*)::int AS count FROM table_sessions WHERE restaurant_id = ${fx.restaurantId}`;
    const count = countRow!.count;
    expect(count).toBe(2);
  });
});

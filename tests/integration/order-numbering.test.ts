import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

/**
 * db/migrations/0008_order_number_daily_scope.sql — regression coverage
 * for the order-number rollover bug: orders_restaurant_order_number_unique
 * used to be scoped (restaurant_id, order_number) only, while
 * next_order_number() resets its counter every day, so the first order of
 * any subsequent day re-minted a number that already existed from an
 * earlier day and hit a unique-constraint violation. Fixed by scoping
 * uniqueness to (restaurant_id, order_date, order_number), where
 * order_date is the restaurant-LOCAL day the number was minted for
 * (computed via restaurants.timezone, not the DB session's own tz).
 */

async function callCreateOrder(
  tableId: string,
  items: readonly postgres.JSONValue[],
  idempotencyKey: string,
) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(
        ${tableId}::uuid, ${conn.json(items)}, NULL, ${idempotencyKey}, NULL
      ) AS result
    `;
    return row!.result as {
      order_id: string;
      order_number: string;
      access_token: string;
      total_cents: number;
      table_session_id: string;
    };
  });
}

/** Simulates a real order placed on `day` (a 'YYYY-MM-DD' string), bypassing create_order entirely — used to set up "yesterday already happened" fixtures without manipulating the server clock. */
async function seedHistoricalOrder(
  fx: Awaited<ReturnType<typeof createTestRestaurant>>,
  day: string,
  counter: number,
) {
  const orderNumber = `T-${String(counter).padStart(3, "0")}`;
  const [session] = await sql`
    INSERT INTO table_sessions (restaurant_id, table_id, status, opened_at, closed_at)
    VALUES (${fx.restaurantId}, ${fx.tableId}, 'closed', ${day}::date, ${day}::date)
    RETURNING id
  `;
  await sql`
    INSERT INTO orders (
      restaurant_id, table_id, table_session_id, order_number, order_date, status,
      subtotal_cents, tax_cents, service_charge_cents, total_cents,
      access_token, idempotency_key, created_at
    ) VALUES (
      ${fx.restaurantId}, ${fx.tableId}, ${session!.id}, ${orderNumber}, ${day}::date, 'completed',
      1000, 0, 0, 1000,
      ${uniqueKey("seed-token")}, ${uniqueKey("seed-idem")}, ${day}::date
    )
  `;
  await sql`
    INSERT INTO restaurant_daily_counters (restaurant_id, day, counter)
    VALUES (${fx.restaurantId}, ${day}::date, ${counter})
    ON CONFLICT (restaurant_id, day) DO UPDATE SET counter = ${counter}
  `;
  return orderNumber;
}

describe("order numbering — daily reset never collides across a day boundary (0008 fix)", () => {

  it("reproduces the original bug scenario: yesterday already used T-001..T-003, today's first order also gets T-001 without a unique-constraint violation", async () => {
    const fx = await createTestRestaurant();
    await seedHistoricalOrder(fx, "2026-09-10", 1);
    await seedHistoricalOrder(fx, "2026-09-10", 2);
    await seedHistoricalOrder(fx, "2026-09-10", 3);

    // Before the fix, this exact call raised: duplicate key value violates
    // unique constraint "orders_restaurant_order_number_unique".
    const today = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-newday-1"));
    expect(today.order_number).toBe("T-001");

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE restaurant_id = ${fx.restaurantId} AND order_number = 'T-001'`;
    expect(countRow!.count).toBe(2); // yesterday's T-001 and today's T-001 legitimately coexist
  });

  it("second order on a new day continues the fresh counter (T-002), not a continuation of yesterday's count", async () => {
    const fx = await createTestRestaurant();
    await seedHistoricalOrder(fx, "2026-09-10", 5); // yesterday reached T-005

    const first = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-newday-2a"));
    const second = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-newday-2b"));

    expect(first.order_number).toBe("T-001");
    expect(second.order_number).toBe("T-002");
  });

  it("existing previous-day order numbers remain unchanged and queryable after today's orders are created", async () => {
    const fx = await createTestRestaurant();
    const historicalNumber = await seedHistoricalOrder(fx, "2026-09-10", 1);
    await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-preserve-1"));

    const [historical] = await sql`
      SELECT order_number, order_date::text AS order_date FROM orders
      WHERE restaurant_id = ${fx.restaurantId} AND order_date = '2026-09-10'
    `;
    expect(historical!.order_number).toBe(historicalNumber);
    expect(historical!.order_date).toBe("2026-09-10");
  });

  it("concurrent order creation on the same day still produces a gapless, unique sequence (unchanged from before the fix)", async () => {
    const fx = await createTestRestaurant();
    await seedHistoricalOrder(fx, "2026-09-10", 3); // prior day's numbers must not interfere

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey(`idem-concurrent-${i}`))),
    );

    const numbers = results.map((r) => r.order_number).sort();
    expect(new Set(numbers).size).toBe(10); // no duplicates
    expect(numbers).toEqual(
      Array.from({ length: 10 }, (_, i) => `T-${String(i + 1).padStart(3, "0")}`),
    );
  });

  it("multiple restaurants number independently — one restaurant's T-001 today never collides with another's", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    await seedHistoricalOrder(a, "2026-09-10", 1);

    const orderA = await callCreateOrder(a.tableId, [{ menu_item_id: a.menuItemId, quantity: 1 }], uniqueKey("idem-multi-a"));
    const orderB = await callCreateOrder(b.tableId, [{ menu_item_id: b.menuItemId, quantity: 1 }], uniqueKey("idem-multi-b"));

    expect(orderA.order_number).toBe("T-001");
    expect(orderB.order_number).toBe("T-001"); // same visible number, different restaurant — always fine, restaurant_id already scopes this
  });

  it("order_date is computed from the RESTAURANT's own timezone, not the database session's", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET timezone = 'Pacific/Kiritimati' WHERE id = ${fx.restaurantId}`; // UTC+14, one of the furthest-ahead real zones

    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-tz-1"));

    const [expected] = await sql`SELECT (now() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS d`;
    const [order] = await sql`SELECT order_date::text AS order_date FROM orders WHERE id = ${result.order_id}`;
    expect(order!.order_date).toBe(expected!.d);
  });

  it("a restaurant far behind UTC also gets its own correctly-computed order_date, independent of another restaurant's zone", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE restaurants SET timezone = 'Etc/GMT+12' WHERE id = ${fx.restaurantId}`; // UTC-12, one of the furthest-behind real zones

    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-tz-2"));

    const [expected] = await sql`SELECT (now() AT TIME ZONE 'Etc/GMT+12')::date::text AS d`;
    const [order] = await sql`SELECT order_date::text AS order_date FROM orders WHERE id = ${result.order_id}`;
    expect(order!.order_date).toBe(expected!.d);
  });

  it("idempotent retry still returns the original order unchanged, even across what would otherwise be a day boundary", async () => {
    const fx = await createTestRestaurant();
    const key = uniqueKey("idem-retry-tz");

    const first = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], key);
    // A retry of the exact same idempotency key must short-circuit to the
    // original row before order_date/session logic ever runs again —
    // simulate "the day has since rolled over" by moving the counter
    // forward; the retry must still ignore all of that.
    await sql`UPDATE restaurant_daily_counters SET counter = counter + 5 WHERE restaurant_id = ${fx.restaurantId}`;

    const retry = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], key);

    expect(retry.order_id).toBe(first.order_id);
    expect(retry.order_number).toBe(first.order_number);
    expect(retry.table_session_id).toBe(first.table_session_id);

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE idempotency_key = ${key}`;
    expect(countRow!.count).toBe(1);
  });
});

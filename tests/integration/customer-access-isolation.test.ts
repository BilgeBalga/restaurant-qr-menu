import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

async function placeOrder(tableId: string, menuItemId: string) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(${tableId}::uuid, ${conn.json([{ menu_item_id: menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()}) AS result
    `;
    return row!.result as { order_id: string; access_token: string };
  });
}

describe("customer QR token — invalid and revoked (§12)", () => {
  it("a syntactically plausible but unknown token is rejected, not silently treated as valid", async () => {
    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.resolve_table_by_token(${"not-a-real-token-" + crypto.randomUUID()})`;
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });

  it("a token revoked after being handed out stops resolving immediately", async () => {
    const fx = await createTestRestaurant();
    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${fx.qrToken}) AS result`;
      return row!.result;
    });
    expect(resolved).toBeTruthy();

    await sql`UPDATE table_qr_tokens SET is_active = false, revoked_at = now() WHERE token = ${fx.qrToken}`;

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.resolve_table_by_token(${fx.qrToken})`;
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });
});

describe("customer table isolation", () => {
  it("resolving table A's token never returns table B's identity, even at the same restaurant", async () => {
    const fx = await createTestRestaurant();
    const [tableB] = await sql`INSERT INTO tables (restaurant_id, label) VALUES (${fx.restaurantId}, 'Table B') RETURNING id`;
    const tokenB = "token-b-" + crypto.randomUUID();
    await sql`INSERT INTO table_qr_tokens (restaurant_id, table_id, token) VALUES (${fx.restaurantId}, ${tableB!.id}, ${tokenB})`;

    const resolvedA = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${fx.qrToken}) AS result`;
      return row!.result as { table_id: string };
    });

    expect(resolvedA.table_id).toBe(fx.tableId);
    expect(resolvedA.table_id).not.toBe(tableB!.id);
  });

  it("orders placed at two different tables never share a table_session, even same restaurant", async () => {
    const fx = await createTestRestaurant();
    const [tableB] = await sql`INSERT INTO tables (restaurant_id, label) VALUES (${fx.restaurantId}, 'Table B') RETURNING id`;

    const orderA = await placeOrder(fx.tableId, fx.menuItemId);
    const orderB = await placeOrder(tableB!.id, fx.menuItemId);

    const [rowA] = await sql`SELECT table_session_id FROM orders WHERE id = ${orderA.order_id}`;
    const [rowB] = await sql`SELECT table_session_id FROM orders WHERE id = ${orderB.order_id}`;

    expect(rowA!.table_session_id).not.toBe(rowB!.table_session_id);
  });
});

describe("customer order-token isolation (§13/§16)", () => {
  it("order A's access_token can never read order B's data, even at the same table", async () => {
    const fx = await createTestRestaurant();
    const orderA = await placeOrder(fx.tableId, fx.menuItemId);
    const orderB = await placeOrder(fx.tableId, fx.menuItemId);

    expect(orderA.access_token).not.toBe(orderB.access_token);

    const viaTokenA = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.get_order_by_token(${orderA.access_token}) AS result`;
      return row!.result as { order_number: string };
    });
    const viaTokenB = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.get_order_by_token(${orderB.access_token}) AS result`;
      return row!.result as { order_number: string };
    });

    expect(viaTokenA.order_number).not.toBe(viaTokenB.order_number);

    // The literal cross-check: A's token must not somehow resolve to B's order_number.
    const [aRow] = await sql`SELECT order_number FROM orders WHERE id = ${orderA.order_id}`;
    const [bRow] = await sql`SELECT order_number FROM orders WHERE id = ${orderB.order_id}`;
    expect(viaTokenA.order_number).toBe(aRow!.order_number);
    expect(viaTokenB.order_number).toBe(bRow!.order_number);
  });

  it("a made-up access_token is rejected, not silently matched", async () => {
    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.get_order_by_token(${"forged-" + crypto.randomUUID()})`;
      }),
    ).rejects.toThrow(/ORDER_NOT_FOUND/);
  });
});

describe("customer order creation — idempotency under real concurrency", () => {
  it("ten concurrent submits with the SAME idempotency key produce exactly one order (double-tap, not just sequential retry)", async () => {
    const fx = await createTestRestaurant();
    const key = "idem-concurrent-tap-" + crypto.randomUUID();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        withRole("anon", null, async (conn) => {
          const [row] = await conn`
            SELECT public.create_order(${fx.tableId}::uuid, ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])}, NULL, ${key}) AS result
          `;
          return row!.result as { order_id: string };
        }),
      ),
    );

    const uniqueOrderIds = new Set(results.map((r) => r.order_id));
    expect(uniqueOrderIds.size).toBe(1);

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE idempotency_key = ${key}`;
    expect(countRow!.count).toBe(1);
  });
});

describe("customer order tracking reflects live status (§16)", () => {
  it("get_order_by_token returns the updated status immediately after a staff transition", async () => {
    const fx = await createTestRestaurant();
    const order = await placeOrder(fx.tableId, fx.menuItemId);

    const before = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.get_order_by_token(${order.access_token}) AS result`;
      return row!.result as { status: string };
    });
    expect(before.status).toBe("new");

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT public.set_order_status(${order.order_id}::uuid, 'preparing', NULL)`;
    });

    const after = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.get_order_by_token(${order.access_token}) AS result`;
      return row!.result as { status: string; status_history: unknown[] };
    });
    expect(after.status).toBe("preparing");
    expect(after.status_history).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

describe("RLS — anonymous (customer) read permissions", () => {

  it("anon can browse active menu items, categories, and the restaurant row", async () => {
    const fx = await createTestRestaurant();

    const [items, categories, restaurant] = await withRole("anon", null, async (conn) => {
      return Promise.all([
        conn`SELECT id FROM menu_items WHERE id = ${fx.menuItemId}`,
        conn`SELECT id FROM categories WHERE id = ${fx.categoryId}`,
        conn`SELECT id FROM restaurants WHERE id = ${fx.restaurantId}::uuid`,
      ]);
    });

    expect(items).toHaveLength(1);
    expect(categories).toHaveLength(1);
    expect(restaurant).toHaveLength(1);
  });

  it("anon sees a sold-out (is_available=false) item — only is_active hides it, per §19", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE menu_items SET is_available = false WHERE id = ${fx.menuItemId}`;

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT id, is_available FROM menu_items WHERE id = ${fx.menuItemId}`;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_available).toBe(false);
  });

  it("anon cannot see a soft-deleted (is_active=false) item at all", async () => {
    const fx = await createTestRestaurant();
    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET is_active = false WHERE id = ${fx.menuItemId}::uuid`;
    });

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT id FROM menu_items WHERE id = ${fx.menuItemId}`;
    });

    expect(rows).toHaveLength(0);
  });

  it("anon cannot read tables directly (only resolve_table_by_token) — no grant at all, not just an empty result", async () => {
    const fx = await createTestRestaurant();
    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT id FROM tables WHERE id = ${fx.tableId}::uuid`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("anon cannot read orders, table_qr_tokens, staff_users, restaurant_staff, or audit_logs", async () => {
    const fx = await createTestRestaurant();

    await withRole("anon", null, async (conn) => {
      await expect(conn`SELECT * FROM orders`).rejects.toThrow(/permission denied/);
      await expect(conn`SELECT * FROM table_qr_tokens WHERE table_id = ${fx.tableId}::uuid`).rejects.toThrow(
        /permission denied/,
      );
      await expect(conn`SELECT * FROM staff_users`).rejects.toThrow(/permission denied/);
      await expect(conn`SELECT * FROM restaurant_staff`).rejects.toThrow(/permission denied/);
      await expect(conn`SELECT * FROM audit_logs`).rejects.toThrow(/permission denied/);
      await expect(conn`SELECT * FROM table_sessions`).rejects.toThrow(/permission denied/);
    });
  });

  it("resolve_table_by_token works for anon and rejects an unknown token", async () => {
    const fx = await createTestRestaurant();

    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${fx.qrToken}) AS result`;
      return row!.result as { table_id: string; restaurant_id: string };
    });
    expect(resolved.table_id).toBe(fx.tableId);
    expect(resolved.restaurant_id).toBe(fx.restaurantId);

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.resolve_table_by_token('does-not-exist')`;
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });
});

describe("RLS — staff permissions", () => {

  it("non-admin staff cannot create a menu item; admin can", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`
          INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents)
          VALUES (${fx.restaurantId}::uuid, ${fx.categoryId}::uuid, 'Fries', 'fries', 500)
        `;
      }),
    ).rejects.toThrow();

    const inserted = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents)
        VALUES (${fx.restaurantId}::uuid, ${fx.categoryId}::uuid, 'Fries', 'fries', 500)
        RETURNING id
      `;
    });
    expect(inserted).toHaveLength(1);
  });

  it("non-admin staff CAN toggle is_available but CANNOT change price (column-scope trigger)", async () => {
    const fx = await createTestRestaurant();

    const toggled = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        UPDATE menu_items SET is_available = false WHERE id = ${fx.menuItemId}::uuid RETURNING is_available
      `;
    });
    expect(toggled[0]?.is_available).toBe(false);

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`UPDATE menu_items SET price_cents = 999 WHERE id = ${fx.menuItemId}::uuid`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);

    const [row] = await sql`SELECT price_cents FROM menu_items WHERE id = ${fx.menuItemId}`;
    expect(row!.price_cents).toBe(1200);
  });

  it("admin CAN change price directly", async () => {
    const fx = await createTestRestaurant();

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET price_cents = 1500 WHERE id = ${fx.menuItemId}::uuid`;
    });

    const [row] = await sql`SELECT price_cents FROM menu_items WHERE id = ${fx.menuItemId}`;
    expect(row!.price_cents).toBe(1500);
  });

  it("non-admin staff cannot invite/deactivate staff — RLS makes the write match zero rows, not an error", async () => {
    const fx = await createTestRestaurant();

    const updated = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        UPDATE restaurant_staff SET is_active = false WHERE staff_user_id = ${fx.adminId}::uuid RETURNING id
      `;
    });
    expect(updated).toHaveLength(0);

    const [row] = await sql`SELECT is_active FROM restaurant_staff WHERE staff_user_id = ${fx.adminId}`;
    expect(row!.is_active).toBe(true);
  });

  it("staff (any role) can read orders for their own restaurant", async () => {
    const fx = await createTestRestaurant();
    const created = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(
          ${fx.tableId}::uuid,
          ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        ) AS result
      `;
      return row!.result as { order_id: string };
    });

    const seenByStaff = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM orders WHERE id = ${created.order_id}`;
    });
    expect(seenByStaff).toHaveLength(1);
  });
});

describe("RLS — unauthorized writes to the orders family are impossible even for staff", () => {

  it("no role can raw-INSERT into orders (Finding 6 — RPCs are the only writer)", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`
          INSERT INTO orders (
            restaurant_id, table_id, table_session_id, order_number, subtotal_cents, total_cents,
            access_token, idempotency_key
          )
          SELECT ${fx.restaurantId}::uuid, ${fx.tableId}::uuid, id, 'FORGED-1', 100, 100, 'forged-token', 'forged-idem'
          FROM table_sessions LIMIT 1
        `;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("no role can raw-UPDATE orders.status (must go through set_order_status)", async () => {
    const fx = await createTestRestaurant();
    const created = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(
          ${fx.tableId}::uuid,
          ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        ) AS result
      `;
      return row!.result as { order_id: string; total_cents: number };
    });

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`UPDATE orders SET status = 'completed' WHERE id = ${created.order_id}`;
      }),
    ).rejects.toThrow(/permission denied/);

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`UPDATE orders SET total_cents = 1 WHERE id = ${created.order_id}`;
      }),
    ).rejects.toThrow(/permission denied/);

    const [row] = await sql`SELECT status, total_cents FROM orders WHERE id = ${created.order_id}`;
    expect(row!.status).toBe("new");
    expect(row!.total_cents).toBe(created.total_cents);
  });

  it("anon cannot call set_order_status at all", async () => {
    const fx = await createTestRestaurant();
    const created = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(
          ${fx.tableId}::uuid,
          ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        ) AS result
      `;
      return row!.result as { order_id: string };
    });

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.set_order_status(${created.order_id}::uuid, 'preparing', NULL)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});

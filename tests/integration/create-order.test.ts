import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

async function callCreateOrder(
  tableId: string,
  items: readonly postgres.JSONValue[],
  idempotencyKey: string,
  note: string | null = null,
) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(
        ${tableId}::uuid, ${conn.json(items)}, ${note}, ${idempotencyKey}
      ) AS result
    `;
    return row!.result as { order_id: string; order_number: string; access_token: string; total_cents: number };
  });
}

describe("create_order — transaction correctness", () => {

  it("creates order + order_items + order_item_options + status history atomically, with server-computed totals", async () => {
    const fx = await createTestRestaurant({ taxRate: "0.0800", serviceChargeRate: "0.1000" });

    const result = await callCreateOrder(
      fx.tableId,
      [{ menu_item_id: fx.menuItemId, quantity: 2, option_choice_ids: [fx.optionChoiceId], line_note: "no onions" }],
      "idem-txn-1",
      "Table note",
    );

    // 2 * (1200 + 150) = 2700 subtotal; 8% tax = 216; 10% service = 270; total 3186
    expect(result.total_cents).toBe(3186);

    const [order] = await sql`SELECT * FROM orders WHERE id = ${result.order_id}`;
    expect(order!.status).toBe("new");
    expect(order!.subtotal_cents).toBe(2700);
    expect(order!.tax_cents).toBe(216);
    expect(order!.service_charge_cents).toBe(270);
    expect(order!.total_cents).toBe(3186);
    expect(order!.customer_note).toBe("Table note");

    const items = await sql`SELECT * FROM order_items WHERE order_id = ${result.order_id}`;
    expect(items).toHaveLength(1);
    expect(items[0]?.name_snapshot).toBe("Classic Burger");
    expect(items[0]?.unit_price_cents_snapshot).toBe(1200);
    expect(items[0]?.quantity).toBe(2);
    expect(items[0]?.line_note).toBe("no onions");

    const options = await sql`SELECT * FROM order_item_options WHERE order_item_id = ${items[0]!.id}`;
    expect(options).toHaveLength(1);
    expect(options[0]?.choice_name_snapshot).toBe("Extra cheese");
    expect(options[0]?.price_delta_cents_snapshot).toBe(150);

    const history = await sql`SELECT * FROM order_status_history WHERE order_id = ${result.order_id}`;
    expect(history).toHaveLength(1);
    expect(history[0]?.previous_status).toBeNull();
    expect(history[0]?.new_status).toBe("new");
  });

  it("ignores any client-supplied price/name field — only menu_item_id/quantity/options are used", async () => {
    const fx = await createTestRestaurant();

    const result = await callCreateOrder(
      fx.tableId,
      [
        {
          menu_item_id: fx.menuItemId,
          quantity: 1,
          price_cents: 1, // attempted price manipulation
          name: "Free Burger", // attempted name manipulation
          unit_price_cents_snapshot: 0,
        },
      ],
      "idem-manip-1",
    );

    expect(result.total_cents).toBe(1200); // real menu price, untouched by the forged fields
    const [item] = await sql`SELECT name_snapshot, unit_price_cents_snapshot FROM order_items WHERE order_id = ${result.order_id}`;
    expect(item!.name_snapshot).toBe("Classic Burger");
    expect(item!.unit_price_cents_snapshot).toBe(1200);
  });

  it("is idempotent: the same idempotency_key returns the original order, never creates a second one", async () => {
    const fx = await createTestRestaurant();
    const key = "idem-dup-" + crypto.randomUUID();

    const first = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], key);
    const second = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 3 }], key);

    expect(second.order_id).toBe(first.order_id);
    expect(second.total_cents).toBe(first.total_cents); // second call's different qty is ignored — same row returned

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
    const count = countRow!.count;
    expect(count).toBe(1);
  });

  it("rejects an unavailable menu item by name, and creates nothing", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE menu_items SET is_available = false WHERE id = ${fx.menuItemId}`;

    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], "idem-unavail-1"),
    ).rejects.toThrow(/MENU_ITEM_UNAVAILABLE: Classic Burger/);

    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
    const count = countRow!.count;
    expect(count).toBe(0);
  });

  it("rejects an unavailable option choice, and creates nothing", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE option_choices SET is_available = false WHERE id = ${fx.optionChoiceId}`;

    await expect(
      callCreateOrder(
        fx.tableId,
        [{ menu_item_id: fx.menuItemId, quantity: 1, option_choice_ids: [fx.optionChoiceId] }],
        "idem-opt-unavail-1",
      ),
    ).rejects.toThrow(/OPTION_UNAVAILABLE: Extra cheese/);
  });

  it("rejects an empty cart", async () => {
    const fx = await createTestRestaurant();
    await expect(callCreateOrder(fx.tableId, [], "idem-empty-1")).rejects.toThrow(/EMPTY_ORDER/);
  });

  it("rejects invalid quantities (zero, negative, absurdly large)", async () => {
    const fx = await createTestRestaurant();
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 0 }], "idem-q0"),
    ).rejects.toThrow(/INVALID_QUANTITY/);
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: -1 }], "idem-qneg"),
    ).rejects.toThrow(/INVALID_QUANTITY/);
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 21 }], "idem-qbig"),
    ).rejects.toThrow(/INVALID_QUANTITY/);
  });

  it("rejects a menu_item_id that doesn't exist", async () => {
    const fx = await createTestRestaurant();
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: crypto.randomUUID(), quantity: 1 }], "idem-noitem"),
    ).rejects.toThrow(/MENU_ITEM_NOT_FOUND/);
  });

  it("rejects a menu item belonging to a different restaurant (cross-tenant order forgery attempt)", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    await expect(
      callCreateOrder(a.tableId, [{ menu_item_id: b.menuItemId, quantity: 1 }], "idem-crosstenant"),
    ).rejects.toThrow(/MENU_ITEM_NOT_FOUND/);
  });

  it("rejects ordering from an inactive table, and from a restaurant with ordering disabled", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE tables SET is_active = false WHERE id = ${fx.tableId}`;
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], "idem-inactive-table"),
    ).rejects.toThrow(/TABLE_INACTIVE/);

    const fx2 = await createTestRestaurant();
    await sql`UPDATE restaurants SET ordering_enabled = false WHERE id = ${fx2.restaurantId}`;
    await expect(
      callCreateOrder(fx2.tableId, [{ menu_item_id: fx2.menuItemId, quantity: 1 }], "idem-ordering-disabled"),
    ).rejects.toThrow(/ORDERING_DISABLED/);
  });
});

describe("price snapshots and referential integrity", () => {

  it("a later price change never alters a historical order (§4/§7 price-history decision)", async () => {
    const fx = await createTestRestaurant();
    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], "idem-snap-1");

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET price_cents = 5000 WHERE id = ${fx.menuItemId}::uuid`;
    });

    const [item] = await sql`SELECT unit_price_cents_snapshot FROM order_items WHERE order_id = ${result.order_id}`;
    expect(item!.unit_price_cents_snapshot).toBe(1200);

    const [order] = await sql`SELECT total_cents FROM orders WHERE id = ${result.order_id}`;
    expect(order!.total_cents).toBe(1200);
  });

  it("a menu item that has been ordered can never be hard-deleted (ON DELETE RESTRICT)", async () => {
    const fx = await createTestRestaurant();
    await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], "idem-restrict-1");

    await expect(sql`DELETE FROM menu_items WHERE id = ${fx.menuItemId}`).rejects.toThrow(/violates foreign key/);
  });

  it("a menu item that has never been ordered CAN be hard-deleted (§19: soft-delete only if ordered)", async () => {
    const fx = await createTestRestaurant();
    const [neverOrdered] = await sql`
      INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents)
      VALUES (${fx.restaurantId}, ${fx.categoryId}, 'Untouched Item', 'untouched-item', 100)
      RETURNING id
    `;

    await sql`DELETE FROM menu_items WHERE id = ${neverOrdered!.id}`;
    const rows = await sql`SELECT id FROM menu_items WHERE id = ${neverOrdered!.id}`;
    expect(rows).toHaveLength(0);
  });

  it("order totals always satisfy total = subtotal + tax + service_charge (DB CHECK constraint)", async () => {
    const fx = await createTestRestaurant();
    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], "idem-check-1");

    await expect(sql`UPDATE orders SET total_cents = 999999 WHERE id = ${result.order_id}`).rejects.toThrow(
      /orders_total_equals_components/,
    );
  });
});

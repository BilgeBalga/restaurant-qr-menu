import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

async function callCreateOrder(
  tableId: string,
  items: readonly postgres.JSONValue[],
  idempotencyKey: string,
  note: string | null = null,
  sessionId: string | null = null,
) {
  return withRole("anon", null, async (conn) => {
    const [row] = await conn`
      SELECT public.create_order(
        ${tableId}::uuid, ${conn.json(items)}, ${note}, ${idempotencyKey}, ${sessionId}::uuid
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

describe("create_order — transaction correctness", () => {

  it("creates order + order_items + order_item_options + status history atomically, with server-computed totals", async () => {
    const fx = await createTestRestaurant({ taxRate: "0.0800", serviceChargeRate: "0.1000" });

    const result = await callCreateOrder(
      fx.tableId,
      [{ menu_item_id: fx.menuItemId, quantity: 2, option_choice_ids: [fx.optionChoiceId], line_note: "no onions" }],
      uniqueKey("idem-txn-1"),
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
      uniqueKey("idem-manip-1"),
    );

    expect(result.total_cents).toBe(1200); // real menu price, untouched by the forged fields
    const [item] = await sql`SELECT name_snapshot, unit_price_cents_snapshot FROM order_items WHERE order_id = ${result.order_id}`;
    expect(item!.name_snapshot).toBe("Classic Burger");
    expect(item!.unit_price_cents_snapshot).toBe(1200);
  });

  it("is idempotent: the same idempotency_key returns the original order, never creates a second one", async () => {
    const fx = await createTestRestaurant();
    const key = uniqueKey("idem-dup");

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
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-unavail-1")),
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
        uniqueKey("idem-opt-unavail-1"),
      ),
    ).rejects.toThrow(/OPTION_UNAVAILABLE: Extra cheese/);
  });

  it("rejects an empty cart", async () => {
    const fx = await createTestRestaurant();
    await expect(callCreateOrder(fx.tableId, [], uniqueKey("idem-empty-1"))).rejects.toThrow(/EMPTY_ORDER/);
  });

  describe("option group selection cardinality (db/migrations/0016)", () => {
    it("rejects a required group (min_select=1) submitted with zero choices, and creates nothing", async () => {
      const fx = await createTestRestaurant();
      const [group] = await sql`
        INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, is_required, min_select, max_select)
        VALUES (${fx.restaurantId}, ${fx.menuItemId}, 'Size', 'single', true, 1, 1)
        RETURNING id
      `;
      await sql`
        INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
        VALUES (${fx.restaurantId}, ${group!.id}, 'Small', 0)
      `;

      await expect(
        callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-group-min-1")),
      ).rejects.toThrow(/OPTION_GROUP_SELECTION_INVALID: Size/);

      const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
      expect(countRow!.count).toBe(0);
    });

    it("rejects more choices than a group's max_select allows, and creates nothing", async () => {
      const fx = await createTestRestaurant();
      const [group] = await sql`
        INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, min_select, max_select)
        VALUES (${fx.restaurantId}, ${fx.menuItemId}, 'Size', 'single', 0, 1)
        RETURNING id
      `;
      const [small] = await sql`
        INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
        VALUES (${fx.restaurantId}, ${group!.id}, 'Small', 0) RETURNING id
      `;
      const [large] = await sql`
        INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
        VALUES (${fx.restaurantId}, ${group!.id}, 'Large', 200) RETURNING id
      `;

      await expect(
        callCreateOrder(
          fx.tableId,
          [{ menu_item_id: fx.menuItemId, quantity: 1, option_choice_ids: [small!.id, large!.id] }],
          uniqueKey("idem-group-max-1"),
        ),
      ).rejects.toThrow(/OPTION_GROUP_SELECTION_INVALID: Size/);

      const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
      expect(countRow!.count).toBe(0);
    });

    it("still accepts zero choices from an optional group (min_select=0)", async () => {
      const fx = await createTestRestaurant(); // fixture's own "Extras" group is min_select=0, max_select=2
      const result = await callCreateOrder(
        fx.tableId,
        [{ menu_item_id: fx.menuItemId, quantity: 1 }],
        uniqueKey("idem-group-optional-1"),
      );
      expect(result.order_id).toBeTruthy();
    });
  });

  it("rejects invalid quantities (zero, negative, absurdly large)", async () => {
    const fx = await createTestRestaurant();
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 0 }], uniqueKey("idem-q0")),
    ).rejects.toThrow(/INVALID_QUANTITY/);
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: -1 }], uniqueKey("idem-qneg")),
    ).rejects.toThrow(/INVALID_QUANTITY/);
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 21 }], uniqueKey("idem-qbig")),
    ).rejects.toThrow(/INVALID_QUANTITY/);
  });

  it("rejects a menu_item_id that doesn't exist", async () => {
    const fx = await createTestRestaurant();
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: crypto.randomUUID(), quantity: 1 }], uniqueKey("idem-noitem")),
    ).rejects.toThrow(/MENU_ITEM_NOT_FOUND/);
  });

  it("rejects a menu item belonging to a different restaurant (cross-tenant order forgery attempt)", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    await expect(
      callCreateOrder(a.tableId, [{ menu_item_id: b.menuItemId, quantity: 1 }], uniqueKey("idem-crosstenant")),
    ).rejects.toThrow(/MENU_ITEM_NOT_FOUND/);
  });

  it("rejects ordering from an inactive table, and from a restaurant with ordering disabled", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE tables SET is_active = false WHERE id = ${fx.tableId}`;
    await expect(
      callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-inactive-table")),
    ).rejects.toThrow(/TABLE_INACTIVE/);

    const fx2 = await createTestRestaurant();
    await sql`UPDATE restaurants SET ordering_enabled = false WHERE id = ${fx2.restaurantId}`;
    await expect(
      callCreateOrder(fx2.tableId, [{ menu_item_id: fx2.menuItemId, quantity: 1 }], uniqueKey("idem-ordering-disabled")),
    ).rejects.toThrow(/ORDERING_DISABLED/);
  });
});

describe("price snapshots and referential integrity", () => {

  it("a later price change never alters a historical order (§4/§7 price-history decision)", async () => {
    const fx = await createTestRestaurant();
    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-snap-1"));

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
    await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-restrict-1"));

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
    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-check-1"));

    await expect(sql`UPDATE orders SET total_cents = 999999 WHERE id = ${result.order_id}`).rejects.toThrow(
      /orders_total_equals_components/,
    );
  });
});

/**
 * §18 explicit staff-controlled session closing. Covers the exact stale-
 * browser scenario from the feature brief: a customer's remembered
 * table_session_id must stop working the instant staff closes it — table
 * id alone can't distinguish that stale request from a genuinely new
 * customer who just scanned the same static QR (who sends no session id
 * at all and is handled by the untouched acquire-or-create path, already
 * covered by "Finding 1"/"Finding 2" tests elsewhere in this suite).
 */
describe("create_order — closed-session rejection (§18)", () => {

  it("returns the table_session_id it created or joined", async () => {
    const fx = await createTestRestaurant();
    const result = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-sid-1"));

    const [session] = await sql`SELECT id FROM table_sessions WHERE table_id = ${fx.tableId}`;
    expect(result.table_session_id).toBe(session!.id);
  });

  it("rejects a new order once staff has closed the caller's remembered session, and creates nothing", async () => {
    const fx = await createTestRestaurant();
    const first = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-close-1"));
    const sessionId = first.table_session_id;

    await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.clear_table(${fx.tableId}::uuid)`;
    });

    await expect(
      callCreateOrder(
        fx.tableId,
        [{ menu_item_id: fx.menuItemId, quantity: 1 }],
        uniqueKey("idem-close-2"),
        null,
        sessionId,
      ),
    ).rejects.toThrow(/SESSION_CLOSED/);

    // Only the first order exists — the rejected attempt created no order,
    // no order_items, and no order_status_history (all in the same table).
    const [countRow] = await sql`SELECT count(*)::int AS count FROM orders WHERE table_id = ${fx.tableId}`;
    expect(countRow!.count).toBe(1);
  });

  it("a fresh order with no remembered session succeeds after a manual close, opening a NEW session — the closed one is never reused", async () => {
    const fx = await createTestRestaurant();
    const first = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-rescan-1"));

    await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.clear_table(${fx.tableId}::uuid)`;
    });

    // Simulates a rescanned QR / reset cookie: no session id sent at all.
    const second = await callCreateOrder(fx.tableId, [{ menu_item_id: fx.menuItemId, quantity: 1 }], uniqueKey("idem-rescan-2"));

    expect(second.table_session_id).not.toBe(first.table_session_id);

    const [closedSession] = await sql`SELECT status, closed_by_staff_id FROM table_sessions WHERE id = ${first.table_session_id}`;
    expect(closedSession!.status).toBe("closed");
    expect(closedSession!.closed_by_staff_id).toBe(fx.staffId); // stays closed forever, attributed to the staff member who closed it

    const [newSession] = await sql`SELECT status FROM table_sessions WHERE id = ${second.table_session_id}`;
    expect(newSession!.status).toBe("open");

    const [countRow] = await sql`SELECT count(*)::int AS count FROM table_sessions WHERE table_id = ${fx.tableId}`;
    expect(countRow!.count).toBe(2);
  });

  it("a session id for a different table is rejected the same way (SESSION_CLOSED), never silently ignored", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    const orderInA = await callCreateOrder(a.tableId, [{ menu_item_id: a.menuItemId, quantity: 1 }], uniqueKey("idem-cross-a"));

    await expect(
      callCreateOrder(
        b.tableId,
        [{ menu_item_id: b.menuItemId, quantity: 1 }],
        uniqueKey("idem-cross-b"),
        null,
        orderInA.table_session_id,
      ),
    ).rejects.toThrow(/SESSION_CLOSED/);
  });
});

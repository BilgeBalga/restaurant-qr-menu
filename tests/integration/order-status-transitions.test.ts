import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

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
    const [row] = await conn`SELECT public.set_order_status(${orderId}::uuid, ${status}, NULL) AS result`;
    return row!.result;
  });
}

describe("set_order_status — legal/illegal transitions (§15)", () => {

  it("walks the full happy path: new -> preparing -> ready -> completed", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-happy-1"));

    await setStatus(order_id, fx.staffId, "preparing");
    await setStatus(order_id, fx.staffId, "ready");
    await setStatus(order_id, fx.staffId, "completed");

    const [order] = await sql`SELECT status FROM orders WHERE id = ${order_id}`;
    expect(order!.status).toBe("completed");

    const history = await sql`
      SELECT previous_status, new_status FROM order_status_history WHERE order_id = ${order_id} ORDER BY created_at
    `;
    expect(history.map((h) => [h.previous_status, h.new_status])).toEqual([
      [null, "new"],
      ["new", "preparing"],
      ["preparing", "ready"],
      ["ready", "completed"],
    ]);
  });

  it("rejects skipping a state (new -> ready) and leaves the order untouched", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-skip-1"));

    await expect(setStatus(order_id, fx.staffId, "ready")).rejects.toThrow(/ILLEGAL_TRANSITION/);

    const [order] = await sql`SELECT status FROM orders WHERE id = ${order_id}`;
    expect(order!.status).toBe("new");
  });

  it("rejects a no-op same-status transition", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-noop-1"));
    await expect(setStatus(order_id, fx.staffId, "new")).rejects.toThrow(/ILLEGAL_TRANSITION/);
  });

  it("rejects any transition out of a terminal status", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-terminal-1"));
    await setStatus(order_id, fx.staffId, "cancelled");
    await expect(setStatus(order_id, fx.staffId, "preparing")).rejects.toThrow(/ILLEGAL_TRANSITION/);
  });

  it("only admin can cancel a ready order; plain staff cannot (§11)", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-cancelready-1"));
    await setStatus(order_id, fx.staffId, "preparing");
    await setStatus(order_id, fx.staffId, "ready");

    await expect(setStatus(order_id, fx.staffId, "cancelled")).rejects.toThrow(/ILLEGAL_TRANSITION/);

    await setStatus(order_id, fx.adminId, "cancelled");
    const [order] = await sql`SELECT status FROM orders WHERE id = ${order_id}`;
    expect(order!.status).toBe("cancelled");
  });

  it("staff can cancel a new or preparing order without admin", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-staffcancel-1"));
    await setStatus(order_id, fx.staffId, "cancelled");
    const [order] = await sql`SELECT status FROM orders WHERE id = ${order_id}`;
    expect(order!.status).toBe("cancelled");
  });
});

describe("Finding 3 — concurrent status transitions serialize via FOR UPDATE, never silently overwrite", () => {

  it("two simultaneous transitions from the same status: exactly one succeeds, the other is cleanly rejected", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-race-1"));
    await setStatus(order_id, fx.staffId, "preparing");

    // Fire both at once — one races to "ready", the other to "cancelled" — from the SAME starting status.
    const results = await Promise.allSettled([
      setStatus(order_id, fx.staffId, "ready"),
      setStatus(order_id, fx.staffId, "cancelled"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/ILLEGAL_TRANSITION/);

    // Final state matches whichever one actually won — not a corrupted hybrid.
    const [order] = await sql`SELECT status FROM orders WHERE id = ${order_id}`;
    expect(["ready", "cancelled"]).toContain(order!.status);

    const history = await sql`SELECT new_status FROM order_status_history WHERE order_id = ${order_id}`;
    // Exactly one history row was added by the race (plus the earlier "new" and "preparing" rows) — no duplicate/double-write.
    expect(history).toHaveLength(3);
  });

  it("ten concurrent identical transition attempts: exactly one succeeds", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-race-10"));

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => setStatus(order_id, fx.staffId, "preparing")),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const [order] = await sql`SELECT status FROM orders WHERE id = ${order_id}`;
    expect(order!.status).toBe("preparing");

    const [countRow] = await sql`
      SELECT count(*)::int AS count FROM order_status_history WHERE order_id = ${order_id} AND new_status = 'preparing'
    `;
    expect(countRow!.count).toBe(1);
  });
});

describe("Finding 2 — table_session auto-closes exactly when its last non-terminal order finishes", () => {

  it("closes the session when the only order in it completes", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-autoclose-1"));

    const [openSession] = await sql`SELECT id, status FROM table_sessions WHERE table_id = ${fx.tableId}`;
    expect(openSession!.status).toBe("open");

    await setStatus(order_id, fx.staffId, "preparing");
    await setStatus(order_id, fx.staffId, "ready");

    const [stillOpen] = await sql`SELECT status FROM table_sessions WHERE id = ${openSession!.id}`;
    expect(stillOpen!.status).toBe("open");

    await setStatus(order_id, fx.staffId, "completed");

    const [closed] = await sql`SELECT status, closed_at, closed_by_staff_id FROM table_sessions WHERE id = ${openSession!.id}`;
    expect(closed!.status).toBe("closed");
    expect(closed!.closed_at).not.toBeNull();
    expect(closed!.closed_by_staff_id).toBeNull(); // NULL marks an AUTO-close, distinct from a manual clear_table()
  });

  it("does NOT close the session while a second order in it is still active", async () => {
    const fx = await createTestRestaurant();
    const first = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-multi-1"));
    const second = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-multi-2"));

    const [session] = await sql`SELECT id FROM table_sessions WHERE table_id = ${fx.tableId}`;
    // Both orders share the one open session (§7/§18 — one table, one open session, many orders).
    const [sessionCountRow] = await sql`SELECT count(*)::int AS count FROM table_sessions WHERE table_id = ${fx.tableId}`;
    expect(sessionCountRow!.count).toBe(1);

    await setStatus(first.order_id, fx.staffId, "preparing");
    await setStatus(first.order_id, fx.staffId, "ready");
    await setStatus(first.order_id, fx.staffId, "completed");

    const [stillOpen] = await sql`SELECT status FROM table_sessions WHERE id = ${session!.id}`;
    expect(stillOpen!.status).toBe("open"); // second order is still "new" — session must stay open

    await setStatus(second.order_id, fx.staffId, "cancelled");

    const [nowClosed] = await sql`SELECT status FROM table_sessions WHERE id = ${session!.id}`;
    expect(nowClosed!.status).toBe("closed");
  });

  it("a new order placed after the session auto-closed opens a FRESH session, never rejoins the closed one", async () => {
    const fx = await createTestRestaurant();
    const first = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-fresh-1"));
    await setStatus(first.order_id, fx.staffId, "preparing");
    await setStatus(first.order_id, fx.staffId, "ready");
    await setStatus(first.order_id, fx.staffId, "completed");

    const [closedSession] = await sql`SELECT id FROM table_sessions WHERE table_id = ${fx.tableId}`;

    const second = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-fresh-2"));
    const [secondOrder] = await sql`SELECT table_session_id FROM orders WHERE id = ${second.order_id}`;

    expect(secondOrder!.table_session_id).not.toBe(closedSession!.id);
    const [countRow] = await sql`SELECT count(*)::int AS count FROM table_sessions WHERE table_id = ${fx.tableId}`;
    const count = countRow!.count;
    expect(count).toBe(2);
  });
});

describe("clear_table — manual override", () => {

  it("closes an open session with no orders at all, attributing the close to the acting staff member", async () => {
    const fx = await createTestRestaurant();
    // A party sat down (session opened by a would-be order flow) but never ordered — simulate directly.
    const [session] = await sql`
      INSERT INTO table_sessions (restaurant_id, table_id, status) VALUES (${fx.restaurantId}, ${fx.tableId}, 'open')
      RETURNING id
    `;

    await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.clear_table(${fx.tableId}::uuid)`;
    });

    const [closed] = await sql`SELECT status, closed_by_staff_id FROM table_sessions WHERE id = ${session!.id}`;
    expect(closed!.status).toBe("closed");
    expect(closed!.closed_by_staff_id).toBe(fx.staffId); // non-NULL marks a MANUAL clear, distinct from auto-close
  });

  it("rejects clear_table from someone who isn't staff at that restaurant", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    await expect(
      withRole("authenticated", b.staffId, async (conn) => {
        return conn`SELECT public.clear_table(${a.tableId}::uuid)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("returns the id of the session it actually closed — the app layer uses this to log the audit entry", async () => {
    const fx = await createTestRestaurant();
    const [session] = await sql`
      INSERT INTO table_sessions (restaurant_id, table_id, status) VALUES (${fx.restaurantId}, ${fx.tableId}, 'open')
      RETURNING id
    `;

    const [row] = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.clear_table(${fx.tableId}::uuid) AS result`;
    });

    expect((row!.result as { session_id: string }).session_id).toBe(session!.id);
  });

  it("returns session_id: null (a safe no-op) when there is no open session to close", async () => {
    const fx = await createTestRestaurant();

    const [row] = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.clear_table(${fx.tableId}::uuid) AS result`;
    });

    expect((row!.result as { session_id: string | null }).session_id).toBeNull();
  });

  it("preserves the session row and all its historical orders — never deletes anything", async () => {
    const fx = await createTestRestaurant();
    const { order_id } = await createOrder(fx.tableId, fx.menuItemId, uniqueKey("idem-preserve-1"));
    const [before] = await sql`SELECT table_session_id FROM orders WHERE id = ${order_id}`;

    await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT public.clear_table(${fx.tableId}::uuid)`;
    });

    const [session] = await sql`SELECT id, status FROM table_sessions WHERE id = ${before!.table_session_id}`;
    expect(session).toBeDefined();
    expect(session!.status).toBe("closed");

    const [order] = await sql`SELECT id, table_session_id FROM orders WHERE id = ${order_id}`;
    expect(order).toBeDefined();
    expect(order!.table_session_id).toBe(before!.table_session_id);
  });
});

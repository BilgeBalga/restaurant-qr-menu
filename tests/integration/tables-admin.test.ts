import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * RLS/RPC layer behind app/actions/tablesAdmin.ts and the
 * generate_table_qr_token function (db/migrations/0006_table_qr_token_generation.sql).
 * resolve_table_by_token itself is untouched by this feature — these
 * tests prove that fact by exercising it against both an old-style
 * (seed-script-shaped) token and a freshly RPC-generated one.
 */

describe("tables admin — table CRUD (§11 tables:write, admin-only)", () => {
  it("admin can create, rename, deactivate, and hard-delete a table with no history", async () => {
    const fx = await createTestRestaurant();

    const created = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`INSERT INTO tables (restaurant_id, label, seats) VALUES (${fx.restaurantId}::uuid, '99', 4) RETURNING id, label, is_active`;
    });
    expect(created).toHaveLength(1);
    const tableId = created[0]!.id as string;

    const renamed = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE tables SET label = '99A' WHERE id = ${tableId}::uuid RETURNING label`;
    });
    expect(renamed[0]?.label).toBe("99A");

    const deactivated = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE tables SET is_active = false WHERE id = ${tableId}::uuid RETURNING is_active`;
    });
    expect(deactivated[0]?.is_active).toBe(false);

    const deleted = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`DELETE FROM tables WHERE id = ${tableId}::uuid RETURNING id`;
    });
    expect(deleted).toHaveLength(1);
  });

  it("non-admin staff cannot create, update, or delete a table — RLS matches zero rows", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`INSERT INTO tables (restaurant_id, label) VALUES (${fx.restaurantId}::uuid, '100')`;
      }),
    ).rejects.toThrow();

    const renamed = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`UPDATE tables SET label = 'Hijacked' WHERE id = ${fx.tableId}::uuid RETURNING id`;
    });
    expect(renamed).toHaveLength(0);

    const deleted = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`DELETE FROM tables WHERE id = ${fx.tableId}::uuid RETURNING id`;
    });
    expect(deleted).toHaveLength(0);
  });

  it("a table with a QR token cannot be hard-deleted (ON DELETE RESTRICT) — even a revoked one, kept for audit", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`DELETE FROM tables WHERE id = ${fx.tableId}::uuid`;
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it("a table with a dining session cannot be hard-deleted either", async () => {
    const fx = await createTestRestaurant();
    await withRole("anon", null, async (conn) => {
      return conn`
        SELECT public.create_order(${fx.tableId}::uuid, ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()})
      `;
    });

    // Remove the fixture's QR too so the FK failure below is unambiguously about table_sessions, not table_qr_tokens.
    await sql`DELETE FROM table_qr_tokens WHERE table_id = ${fx.tableId}`;

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`DELETE FROM tables WHERE id = ${fx.tableId}::uuid`;
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });
});

describe("tables admin — table/session safety (§12): deactivation never touches sessions or orders", () => {
  it("deactivating a table with an open session and active orders leaves both completely unchanged", async () => {
    const fx = await createTestRestaurant();
    const order = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(${fx.tableId}::uuid, ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()}) AS result
      `;
      return row!.result as { order_id: string };
    });

    const [sessionBefore] = await sql`SELECT id, status FROM table_sessions WHERE table_id = ${fx.tableId} AND status = 'open'`;
    const [orderBefore] = await sql`SELECT status FROM orders WHERE id = ${order.order_id}`;

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE tables SET is_active = false WHERE id = ${fx.tableId}::uuid`;
    });

    const [sessionAfter] = await sql`SELECT id, status FROM table_sessions WHERE id = ${sessionBefore!.id}`;
    const [orderAfter] = await sql`SELECT status FROM orders WHERE id = ${order.order_id}`;

    expect(sessionAfter!.status).toBe(sessionBefore!.status);
    expect(orderAfter!.status).toBe(orderBefore!.status);
  });

  it("a deactivated table still resolves via its QR (the route, not the RPC, decides what to do with table_active) — new orders are blocked by create_order itself", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE tables SET is_active = false WHERE id = ${fx.tableId}`;

    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${fx.qrToken}) AS result`;
      return row!.result as { table_active: boolean };
    });
    expect(resolved.table_active).toBe(false);

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`
          SELECT public.create_order(${fx.tableId}::uuid, ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1 }])}, NULL, ${"idem-" + crypto.randomUUID()})
        `;
      }),
    ).rejects.toThrow(/TABLE_INACTIVE/);
  });
});

describe("tables admin — QR lifecycle (generate_table_qr_token)", () => {
  it("generating a QR for a table with none yet creates exactly one active token", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE table_qr_tokens SET is_active = false, revoked_at = now() WHERE table_id = ${fx.tableId}`;

    const generated = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`SELECT public.generate_table_qr_token(${fx.tableId}::uuid) AS result`;
      return row!.result as { id: string; token: string; created_at: string };
    });
    expect(generated.token).toBeTruthy();
    expect(generated.token).toMatch(/^[0-9a-f]{64}$/); // two concatenated gen_random_uuid()s (32 hex chars each), dashes stripped

    const active = await sql`SELECT id FROM table_qr_tokens WHERE table_id = ${fx.tableId} AND is_active = true`;
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(generated.id);
  });

  it("rotating (calling it again on a table that already has one) invalidates the old token and the new one resolves", async () => {
    const fx = await createTestRestaurant();
    const oldToken = fx.qrToken;

    const rotated = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`SELECT public.generate_table_qr_token(${fx.tableId}::uuid) AS result`;
      return row!.result as { token: string };
    });
    expect(rotated.token).not.toBe(oldToken);

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.resolve_table_by_token(${oldToken})`;
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);

    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${rotated.token}) AS result`;
      return row!.result as { table_id: string };
    });
    expect(resolved.table_id).toBe(fx.tableId);

    const activeCount = await sql`SELECT count(*) AS n FROM table_qr_tokens WHERE table_id = ${fx.tableId} AND is_active = true`;
    expect(Number(activeCount[0]!.n)).toBe(1);
  });

  it("revoking a token (a plain UPDATE, matching what revokeTableQrToken does) makes it stop resolving immediately", async () => {
    const fx = await createTestRestaurant();

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE table_qr_tokens SET is_active = false, revoked_at = now() WHERE table_id = ${fx.tableId}::uuid AND is_active = true`;
    });

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.resolve_table_by_token(${fx.qrToken})`;
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });

  it("a pre-existing, seed-script-style token (not generated via the new RPC) still resolves — the RPC is purely additive, resolve_table_by_token is untouched", async () => {
    const fx = await createTestRestaurant();
    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${fx.qrToken}) AS result`;
      return row!.result as { table_id: string; restaurant_id: string };
    });
    expect(resolved.table_id).toBe(fx.tableId);
    expect(resolved.restaurant_id).toBe(fx.restaurantId);
  });

  it("non-admin staff cannot call generate_table_qr_token", async () => {
    const fx = await createTestRestaurant();
    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`SELECT public.generate_table_qr_token(${fx.tableId}::uuid)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("anon cannot call generate_table_qr_token at all", async () => {
    const fx = await createTestRestaurant();
    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.generate_table_qr_token(${fx.tableId}::uuid)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("an admin of one restaurant cannot generate a QR for another restaurant's table (cross-tenant)", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    await expect(
      withRole("authenticated", a.adminId, async (conn) => {
        return conn`SELECT public.generate_table_qr_token(${b.tableId}::uuid)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("generating a QR for a nonexistent table fails clearly rather than silently succeeding", async () => {
    const fx = await createTestRestaurant();
    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`SELECT public.generate_table_qr_token(${crypto.randomUUID()}::uuid)`;
      }),
    ).rejects.toThrow(/TABLE_NOT_FOUND/);
  });
});

describe("tables admin — audit logging", () => {
  it("admin can log a table/QR change via log_audit_event, and only admin can read it back", async () => {
    const fx = await createTestRestaurant();

    const logged = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`
        SELECT public.log_audit_event(${fx.restaurantId}::uuid, 'table.qr.rotate', 'table_qr_tokens', ${fx.tableId}::uuid) AS id
      `;
      return row!.id as string;
    });

    const seenByAdmin = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT action FROM audit_logs WHERE id = ${logged}::uuid`;
    });
    expect(seenByAdmin[0]?.action).toBe("table.qr.rotate");

    const seenByStaff = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE id = ${logged}::uuid`;
    });
    expect(seenByStaff).toHaveLength(0);
  });
});

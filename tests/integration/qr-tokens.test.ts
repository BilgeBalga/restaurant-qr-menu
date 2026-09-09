import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

describe("QR token revocation (§12)", () => {

  it("a revoked token no longer resolves, while the table and its history survive untouched", async () => {
    const fx = await createTestRestaurant();

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE table_qr_tokens SET is_active = false, revoked_at = now() WHERE token = ${fx.qrToken}`;
    });

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.resolve_table_by_token(${fx.qrToken})`;
      }),
    ).rejects.toThrow(/INVALID_TOKEN/);

    // Table itself is untouched.
    const [table] = await sql`SELECT id, label, is_active FROM tables WHERE id = ${fx.tableId}`;
    expect(table!.is_active).toBe(true);
  });

  it("rotating a token (revoke old + issue new) is an insert+update, never a delete — old token stays in history", async () => {
    const fx = await createTestRestaurant();

    const newToken = "rotated-" + crypto.randomUUID();
    await withRole("authenticated", fx.adminId, async (conn) => {
      await conn`UPDATE table_qr_tokens SET is_active = false, revoked_at = now() WHERE token = ${fx.qrToken}`;
      await conn`INSERT INTO table_qr_tokens (restaurant_id, table_id, token) VALUES (${fx.restaurantId}::uuid, ${fx.tableId}::uuid, ${newToken})`;
    });

    const rows = await sql`SELECT token, is_active FROM table_qr_tokens WHERE table_id = ${fx.tableId} ORDER BY created_at`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ token: fx.qrToken, is_active: false });
    expect(rows[1]).toMatchObject({ token: newToken, is_active: true });

    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${newToken}) AS result`;
      return row!.result as { table_id: string };
    });
    expect(resolved.table_id).toBe(fx.tableId);
  });

  it("no DELETE grant exists on table_qr_tokens for anyone — rotation must be revoke+insert, never a destructive edit", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`DELETE FROM table_qr_tokens WHERE token = ${fx.qrToken}`;
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("non-admin staff cannot revoke or issue tokens (RLS: zero rows affected); admin can", async () => {
    const fx = await createTestRestaurant();

    const updated = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`UPDATE table_qr_tokens SET is_active = false WHERE token = ${fx.qrToken} RETURNING id`;
    });
    expect(updated).toHaveLength(0);

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE table_qr_tokens SET is_active = false WHERE token = ${fx.qrToken}`;
    });
    const [row] = await sql`SELECT is_active FROM table_qr_tokens WHERE token = ${fx.qrToken}`;
    expect(row!.is_active).toBe(false);
  });

  it("a deactivated table still resolves via its token but is flagged inactive to the caller", async () => {
    const fx = await createTestRestaurant();
    await sql`UPDATE tables SET is_active = false WHERE id = ${fx.tableId}`;

    const resolved = await withRole("anon", null, async (conn) => {
      const [row] = await conn`SELECT public.resolve_table_by_token(${fx.qrToken}) AS result`;
      return row!.result as { table_active: boolean };
    });
    expect(resolved.table_active).toBe(false);
  });
});

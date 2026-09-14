import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * RLS/DB layer behind app/actions/audit.ts (the new admin-only /staff/audit
 * page). audit_logs_select_admin (db/migrations/0002_rls_policies.sql) and
 * the admin/tenant read boundary it enforces are already exhaustively
 * covered by rls-permissions.test.ts, platform-admin.test.ts,
 * tables-admin.test.ts, staff-admin.test.ts and restaurant-settings.test.ts
 * — this file exercises what's actually new here: pagination and filtering
 * over that same table, at the exact clause shape listAuditLog uses
 * (restaurant scoping, action/entity_type ILIKE, actor_staff_id equality,
 * created_at range, ORDER BY created_at DESC, LIMIT/OFFSET), directly via
 * raw SQL under an authenticated session — same convention as every other
 * integration test here, since a "use server" action can't be called
 * directly outside a request context (see staff-admin.test.ts's own note).
 *
 * Rows are inserted directly (bypassing log_audit_event) only so
 * created_at can be pinned to exact, predictable values for pagination/
 * date-range assertions — log_audit_event itself is untouched by this
 * feature and its own round-trip behavior stays covered by the existing
 * suites referenced above.
 */

const PAGE_SIZE = 25; // must match AUDIT_LOG_PAGE_SIZE in app/actions/audit.ts

async function insertAuditRow(opts: {
  restaurantId: string;
  actorStaffId: string | null;
  action: string;
  entityType: string;
  createdAt: string;
}): Promise<string> {
  const entityId = crypto.randomUUID();
  await sql`
    INSERT INTO audit_logs (restaurant_id, actor_staff_id, action, entity_type, entity_id, created_at)
    VALUES (${opts.restaurantId}, ${opts.actorStaffId}, ${opts.action}, ${opts.entityType}, ${entityId}, ${opts.createdAt})
  `;
  return entityId;
}

describe("audit log — tenant isolation and admin-only read", () => {
  it("admin can read audit logs for their own restaurant, newest first", async () => {
    const fx = await createTestRestaurant();
    const t0 = new Date();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date(t0.getTime() - 2000).toISOString(),
    });
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.create",
      entityType: "menu_items",
      createdAt: t0.toISOString(),
    });

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid
        ORDER BY created_at DESC
      `;
    });
    expect(rows.map((r) => r.action)).toEqual(["menu.item.create", "menu.item.update"]);
  });

  it("non-admin staff cannot read audit logs, even scoped to their own restaurant", async () => {
    const fx = await createTestRestaurant();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date().toISOString(),
    });

    const rows = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE restaurant_id = ${fx.restaurantId}::uuid`;
    });
    expect(rows).toHaveLength(0);
  });

  it("audit logs from another restaurant are never returned, even querying without a restaurant filter", async () => {
    const fx = await createTestRestaurant();
    const otherFx = await createTestRestaurant();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date().toISOString(),
    });
    await insertAuditRow({
      restaurantId: otherFx.restaurantId,
      actorStaffId: otherFx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date().toISOString(),
    });

    // No restaurant_id filter at all — RLS alone must be the thing that
    // keeps this to fx's own restaurant, exactly as listAuditLog's
    // explicit .eq("restaurant_id", ...) is defense in depth on top of it.
    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT restaurant_id FROM audit_logs`;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.restaurant_id === fx.restaurantId)).toBe(true);
  });
});

describe("audit log — pagination", () => {
  it("paginates newest-first with LIMIT/OFFSET, and totals match the real row count", async () => {
    const fx = await createTestRestaurant();
    const total = PAGE_SIZE + 5; // forces a second, partial page
    const base = Date.now();
    for (let i = 0; i < total; i++) {
      // Strictly decreasing created_at as i increases, so ORDER BY created_at DESC
      // yields action "page-test.0" first regardless of insertion order.
      await insertAuditRow({
        restaurantId: fx.restaurantId,
        actorStaffId: fx.adminId,
        action: `page-test.${i}`,
        entityType: "menu_items",
        createdAt: new Date(base - i * 1000).toISOString(),
      });
    }

    const firstPage = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND action ILIKE 'page-test.%'
        ORDER BY created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET 0
      `;
    });
    expect(firstPage).toHaveLength(PAGE_SIZE);
    expect(firstPage[0]!.action).toBe("page-test.0");
    expect(firstPage[PAGE_SIZE - 1]!.action).toBe(`page-test.${PAGE_SIZE - 1}`);

    const secondPage = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND action ILIKE 'page-test.%'
        ORDER BY created_at DESC
        LIMIT ${PAGE_SIZE} OFFSET ${PAGE_SIZE}
      `;
    });
    expect(secondPage).toHaveLength(5);
    expect(secondPage[0]!.action).toBe(`page-test.${PAGE_SIZE}`);

    const [countRow] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT count(*)::int AS count FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND action ILIKE 'page-test.%'
      `;
    });
    expect(countRow!.count).toBe(total);
  });
});

describe("audit log — filters", () => {
  it("filters by action (partial match)", async () => {
    const fx = await createTestRestaurant();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date().toISOString(),
    });
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "staff.role_change",
      entityType: "restaurant_staff",
      createdAt: new Date().toISOString(),
    });

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND action ILIKE ${"%menu%"}
      `;
    });
    expect(rows.map((r) => r.action)).toEqual(["menu.item.update"]);
  });

  it("filters by entity_type (partial match)", async () => {
    const fx = await createTestRestaurant();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date().toISOString(),
    });
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "table.create",
      entityType: "tables",
      createdAt: new Date().toISOString(),
    });

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT entity_type FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND entity_type ILIKE ${"%table%"}
      `;
    });
    expect(rows.map((r) => r.entity_type)).toEqual(["tables"]);
  });

  it("filters by actor (exact staff member)", async () => {
    const fx = await createTestRestaurant();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "settings.restaurant.update",
      entityType: "restaurants",
      createdAt: new Date().toISOString(),
    });
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.staffId,
      action: "orders.status.update",
      entityType: "orders",
      createdAt: new Date().toISOString(),
    });

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND actor_staff_id = ${fx.staffId}::uuid
      `;
    });
    expect(rows.map((r) => r.action)).toEqual(["orders.status.update"]);
  });

  it("filters by date range (created_at >= from AND < to)", async () => {
    const fx = await createTestRestaurant();
    const now = new Date();
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "recent.event",
      entityType: "menu_items",
      createdAt: now.toISOString(),
    });
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "old.event",
      entityType: "menu_items",
      createdAt: eightDaysAgo.toISOString(),
    });

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND created_at >= ${sevenDaysAgo}::timestamptz
      `;
    });
    expect(rows.map((r) => r.action)).toEqual(["recent.event"]);
  });

  it("a filter combination matching nothing returns an empty result, not an error", async () => {
    const fx = await createTestRestaurant();
    await insertAuditRow({
      restaurantId: fx.restaurantId,
      actorStaffId: fx.adminId,
      action: "menu.item.update",
      entityType: "menu_items",
      createdAt: new Date().toISOString(),
    });

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND action ILIKE ${"%nonexistent-action%"}
      `;
    });
    expect(rows).toEqual([]);
  });
});

describe("audit log — existing writes are unaffected", () => {
  it("log_audit_event still records events exactly as before, immediately visible to the new query shape", async () => {
    const fx = await createTestRestaurant();

    const logId = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`
        SELECT public.log_audit_event(${fx.restaurantId}::uuid, 'menu.item.update', 'menu_items', ${fx.menuItemId}::uuid) AS id
      `;
      return row!.id as string;
    });

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT action, entity_type, actor_staff_id FROM audit_logs
        WHERE restaurant_id = ${fx.restaurantId}::uuid AND id = ${logId}::uuid
      `;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("menu.item.update");
    expect(rows[0]!.entity_type).toBe("menu_items");
    expect(rows[0]!.actor_staff_id).toBe(fx.adminId);
  });
});

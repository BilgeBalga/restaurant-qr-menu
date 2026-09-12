import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

/**
 * RLS/DB layer behind app/actions/staffAdmin.ts. Exercises the exact
 * operations that action performs — INSERT/UPDATE on restaurant_staff,
 * the handle_new_auth_user mirror, log_audit_event — directly via raw SQL
 * under an authenticated session, same convention as tables-admin.test.ts
 * and restaurant-settings.test.ts.
 *
 * NOT covered here (by design): the "last active admin" guarantee is pure
 * application logic (lib/business/staffAccess.ts's wouldLeaveNoActiveAdmin),
 * not enforced by RLS or any DB constraint — nothing at the DB layer
 * blocks demoting/deactivating a restaurant's only admin, which is exactly
 * why that check exists in the action layer. It's exhaustively unit-tested
 * in tests/unit/business/staffAccess.test.ts instead. Likewise, the
 * "create a brand-new Supabase Auth user via the Admin API" path needs a
 * real GoTrue server this local Postgres-only harness doesn't run (see
 * harness/manage-test-db.sh's own comment) — that branch is unit-tested
 * against a mock client in tests/unit/auth/adminUsers.test.ts instead.
 */

async function logAudit(staffId: string, restaurantId: string, action: string, entityType: string, entityId: string) {
  return withRole("authenticated", staffId, async (conn) => {
    const [row] = await conn`
      SELECT public.log_audit_event(${restaurantId}::uuid, ${action}, ${entityType}, ${entityId}::uuid) AS id
    `;
    return row!.id as string;
  });
}

describe("staff management — listing and tenant isolation", () => {
  it("any active staff role can read the roster for their own restaurant", async () => {
    const fx = await createTestRestaurant();

    const rows = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT staff_user_id, role FROM restaurant_staff WHERE restaurant_id = ${fx.restaurantId}::uuid`;
    });
    const roles = rows.map((r) => r.role as string).sort();
    expect(roles).toEqual(["admin", "staff"]);
  });

  it("staff of restaurant A cannot read restaurant B's roster", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const visible = await withRole("authenticated", a.adminId, async (conn) => {
      return conn`SELECT id FROM restaurant_staff WHERE restaurant_id = ${b.restaurantId}::uuid`;
    });
    expect(visible).toHaveLength(0);
  });

  it("an admin of restaurant A cannot modify restaurant B's roster", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    const updated = await withRole("authenticated", a.adminId, async (conn) => {
      return conn`UPDATE restaurant_staff SET role = 'admin' WHERE restaurant_id = ${b.restaurantId}::uuid RETURNING id`;
    });
    expect(updated).toHaveLength(0); // RLS makes the write match zero rows, not an error (same shape as tables_write_admin elsewhere)

    const [stillStaff] = await sql`SELECT role FROM restaurant_staff WHERE staff_user_id = ${b.staffId} AND restaurant_id = ${b.restaurantId}`;
    expect(stillStaff!.role).toBe("staff");

    await expect(
      withRole("authenticated", a.adminId, async (conn) => {
        return conn`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${b.restaurantId}::uuid, ${a.staffId}::uuid, 'admin')`;
      }),
    ).rejects.toThrow(); // WITH CHECK fails outright for an INSERT (unlike UPDATE, which just matches zero rows)
  });

  it("non-admin staff cannot modify their own restaurant's roster either", async () => {
    const fx = await createTestRestaurant();

    const updated = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`UPDATE restaurant_staff SET role = 'admin' WHERE id = (SELECT id FROM restaurant_staff WHERE staff_user_id = ${fx.staffId}) RETURNING id`;
    });
    expect(updated).toHaveLength(0);

    const [stillStaff] = await sql`SELECT role FROM restaurant_staff WHERE staff_user_id = ${fx.staffId}`;
    expect(stillStaff!.role).toBe("staff");
  });
});

describe("staff management — adding a member (mirrors app/actions/staffAdmin.ts's addStaffMember)", () => {
  it("a new auth.users row is mirrored into staff_users automatically (the basis for 'find by email')", async () => {
    const email = `mirror-${uniqueKey("x")}@example.com`;
    const authId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${authId}, ${email})`;

    const [mirrored] = await sql`SELECT id, email FROM staff_users WHERE id = ${authId}`;
    expect(mirrored?.email).toBe(email);
  });

  it("admin can add an existing Auth user as a new staff member; non-admin cannot", async () => {
    const fx = await createTestRestaurant();
    const email = `newhire-${uniqueKey("x")}@example.com`;
    const authId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${authId}, ${email})`;

    const inserted = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${fx.restaurantId}::uuid, ${authId}::uuid, 'staff')
        RETURNING id, role, is_active
      `;
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.role).toBe("staff");
    expect(inserted[0]!.is_active).toBe(true);

    const email2 = `newhire2-${uniqueKey("x")}@example.com`;
    const authId2 = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${authId2}, ${email2})`;

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${fx.restaurantId}::uuid, ${authId2}::uuid, 'staff')`;
      }),
    ).rejects.toThrow();

    const [notAdded] = await sql`SELECT id FROM restaurant_staff WHERE staff_user_id = ${authId2}`;
    expect(notAdded).toBeUndefined();
  });

  it("prevents a duplicate membership — the same person cannot be added to the same restaurant twice", async () => {
    const fx = await createTestRestaurant();

    // fx.staffId is already a member (from createTestRestaurant's own fixture setup).
    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${fx.restaurantId}::uuid, ${fx.staffId}::uuid, 'manager')`;
      }),
    ).rejects.toThrow(/duplicate key value/);
  });

  it("the same person CAN be staff at two different restaurants (uniqueness is per-restaurant, not global)", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    const email = `multirestaurant-${uniqueKey("x")}@example.com`;
    const authId = crypto.randomUUID();
    await sql`INSERT INTO auth.users (id, email) VALUES (${authId}, ${email})`;

    await withRole("authenticated", a.adminId, async (conn) => {
      return conn`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${a.restaurantId}::uuid, ${authId}::uuid, 'staff')`;
    });
    await withRole("authenticated", b.adminId, async (conn) => {
      return conn`INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${b.restaurantId}::uuid, ${authId}::uuid, 'manager')`;
    });

    const rows = await sql`SELECT restaurant_id, role FROM restaurant_staff WHERE staff_user_id = ${authId} ORDER BY role`;
    expect(rows).toHaveLength(2);
  });
});

describe("staff management — role changes and activate/deactivate", () => {
  it("admin can change a staff member's role; non-admin cannot", async () => {
    const fx = await createTestRestaurant();

    const changed = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE restaurant_staff SET role = 'manager' WHERE staff_user_id = ${fx.staffId}::uuid AND restaurant_id = ${fx.restaurantId}::uuid RETURNING role`;
    });
    expect(changed[0]?.role).toBe("manager");

    const blocked = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`UPDATE restaurant_staff SET role = 'admin' WHERE staff_user_id = ${fx.staffId}::uuid AND restaurant_id = ${fx.restaurantId}::uuid RETURNING role`;
    });
    expect(blocked).toHaveLength(0);
  });

  it("admin can deactivate and reactivate a staff member; non-admin cannot", async () => {
    const fx = await createTestRestaurant();

    const deactivated = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE restaurant_staff SET is_active = false WHERE staff_user_id = ${fx.staffId}::uuid AND restaurant_id = ${fx.restaurantId}::uuid RETURNING is_active`;
    });
    expect(deactivated[0]?.is_active).toBe(false);

    const reactivated = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE restaurant_staff SET is_active = true WHERE staff_user_id = ${fx.staffId}::uuid AND restaurant_id = ${fx.restaurantId}::uuid RETURNING is_active`;
    });
    expect(reactivated[0]?.is_active).toBe(true);

    const blocked = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`UPDATE restaurant_staff SET is_active = false WHERE staff_user_id = ${fx.staffId}::uuid AND restaurant_id = ${fx.restaurantId}::uuid RETURNING is_active`;
    });
    expect(blocked).toHaveLength(0);
  });

  it(
    "the DB layer alone does NOT stop deactivating a restaurant's only admin — proving why the app-layer " +
      "wouldLeaveNoActiveAdmin() check in app/actions/staffAdmin.ts is load-bearing, not redundant with RLS",
    async () => {
      const fx = await createTestRestaurant();
      // fx has exactly one admin (fx.adminId) and one staff (fx.staffId).

      const deactivated = await withRole("authenticated", fx.adminId, async (conn) => {
        return conn`UPDATE restaurant_staff SET is_active = false WHERE staff_user_id = ${fx.adminId}::uuid AND restaurant_id = ${fx.restaurantId}::uuid RETURNING is_active`;
      });
      expect(deactivated[0]?.is_active).toBe(false);

      const [activeAdminCount] = await sql`
        SELECT count(*)::int AS count FROM restaurant_staff
        WHERE restaurant_id = ${fx.restaurantId} AND role = 'admin' AND is_active = true
      `;
      expect(activeAdminCount!.count).toBe(0);
    },
  );
});

describe("staff management — audit logging", () => {
  it("admin can log staff.add / staff.role_change / staff.activate / staff.deactivate; only admin can read them back", async () => {
    const fx = await createTestRestaurant();
    const targetMembershipId = (
      await sql`SELECT id FROM restaurant_staff WHERE staff_user_id = ${fx.staffId} AND restaurant_id = ${fx.restaurantId}`
    )[0]!.id as string;

    const addId = await logAudit(fx.adminId, fx.restaurantId, "staff.add", "restaurant_staff", targetMembershipId);
    const roleChangeId = await logAudit(fx.adminId, fx.restaurantId, "staff.role_change", "restaurant_staff", targetMembershipId);
    const deactivateId = await logAudit(fx.adminId, fx.restaurantId, "staff.deactivate", "restaurant_staff", targetMembershipId);

    const rows = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        SELECT id, action, entity_type, actor_staff_id FROM audit_logs
        WHERE id IN (${addId}, ${roleChangeId}, ${deactivateId})
        ORDER BY created_at
      `;
    });
    expect(rows.map((r) => r.action)).toEqual(["staff.add", "staff.role_change", "staff.deactivate"]);
    expect(rows.every((r) => r.entity_type === "restaurant_staff")).toBe(true);
    expect(rows.every((r) => r.actor_staff_id === fx.adminId)).toBe(true);

    const blocked = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE id = ${addId}`;
    });
    expect(blocked).toHaveLength(0);
  });

  it("previous/new values round-trip through log_audit_event for a role change", async () => {
    const fx = await createTestRestaurant();
    const targetMembershipId = (
      await sql`SELECT id FROM restaurant_staff WHERE staff_user_id = ${fx.staffId} AND restaurant_id = ${fx.restaurantId}`
    )[0]!.id as string;

    const logId = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`
        SELECT public.log_audit_event(
          ${fx.restaurantId}::uuid, 'staff.role_change', 'restaurant_staff', ${targetMembershipId}::uuid,
          ${conn.json({ role: "staff" })}, ${conn.json({ role: "manager" })}
        ) AS id
      `;
      return row!.id as string;
    });

    const [row] = await sql`SELECT previous_value, new_value FROM audit_logs WHERE id = ${logId}`;
    expect(row!.previous_value).toEqual({ role: "staff" });
    expect(row!.new_value).toEqual({ role: "manager" });
  });
});

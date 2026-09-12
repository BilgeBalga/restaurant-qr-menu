import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * RLS/RPC layer behind app/actions/settings.ts. The action itself is a
 * thin translation of these same queries (requireActiveMembership() for
 * restaurant_id, can(role, "settings:write") as the fast-rejection
 * layer) — the real guarantee proven here is that RLS independently
 * blocks a non-admin write even if that app-layer check were ever
 * bypassed or had a bug.
 */
describe("restaurant settings — admin-only writes (§11 settings:write)", () => {
  it("admin can update restaurants (name/currency/timezone/ordering_enabled)", async () => {
    const fx = await createTestRestaurant();

    const updated = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        UPDATE restaurants
        SET name = 'Renamed Bistro', currency = 'GBP', timezone = 'Europe/London', ordering_enabled = false
        WHERE id = ${fx.restaurantId}::uuid
        RETURNING name, currency, timezone, ordering_enabled
      `;
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      name: "Renamed Bistro",
      currency: "GBP",
      timezone: "Europe/London",
      ordering_enabled: false,
    });
  });

  it("non-admin staff's UPDATE to restaurants matches zero rows (RLS, not a thrown error)", async () => {
    const fx = await createTestRestaurant();

    const updated = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        UPDATE restaurants SET name = 'Hijacked' WHERE id = ${fx.restaurantId}::uuid RETURNING id
      `;
    });
    expect(updated).toHaveLength(0);

    const [row] = await sql`SELECT name FROM restaurants WHERE id = ${fx.restaurantId}`;
    expect(row!.name).not.toBe("Hijacked");
  });

  it("admin can update restaurant_settings (tax_rate/service_charge_rate)", async () => {
    const fx = await createTestRestaurant();

    const updated = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        UPDATE restaurant_settings
        SET tax_rate = 0.085, service_charge_rate = 0.10
        WHERE restaurant_id = ${fx.restaurantId}::uuid
        RETURNING tax_rate, service_charge_rate
      `;
    });

    expect(updated).toHaveLength(1);
    expect(Number(updated[0]!.tax_rate)).toBeCloseTo(0.085, 4);
    expect(Number(updated[0]!.service_charge_rate)).toBeCloseTo(0.1, 4);
  });

  it("non-admin staff's UPDATE to restaurant_settings matches zero rows", async () => {
    const fx = await createTestRestaurant({ taxRate: "0.05", serviceChargeRate: "0.05" });

    const updated = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`
        UPDATE restaurant_settings SET tax_rate = 0.99 WHERE restaurant_id = ${fx.restaurantId}::uuid RETURNING restaurant_id
      `;
    });
    expect(updated).toHaveLength(0);

    const [row] = await sql`SELECT tax_rate FROM restaurant_settings WHERE restaurant_id = ${fx.restaurantId}`;
    expect(Number(row!.tax_rate)).toBeCloseTo(0.05, 4);
  });

  it("the CHECK constraints reject an out-of-range rate even for admin — the DB is the actual floor, not just app-layer validation", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`UPDATE restaurant_settings SET tax_rate = 1.5 WHERE restaurant_id = ${fx.restaurantId}::uuid`;
      }),
    ).rejects.toThrow();
  });

  it("anon has no grant on restaurant_settings at all", async () => {
    const fx = await createTestRestaurant();

    await withRole("anon", null, async (conn) => {
      await expect(conn`SELECT * FROM restaurant_settings WHERE restaurant_id = ${fx.restaurantId}::uuid`).rejects.toThrow(
        /permission denied/,
      );
    });
  });
});

describe("restaurant settings — audit logging (log_audit_event)", () => {
  it("admin can record a settings change via log_audit_event, and only admin can read it back", async () => {
    const fx = await createTestRestaurant();

    const logged = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`
        SELECT public.log_audit_event(
          ${fx.restaurantId}::uuid,
          'settings.restaurant.update',
          'restaurants',
          ${fx.restaurantId}::uuid,
          ${conn.json({ name: "Old Name" })},
          ${conn.json({ name: "New Name" })}
        ) AS id
      `;
      return row!.id as string;
    });
    expect(logged).toBeTruthy();

    const seenByAdmin = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`SELECT action, entity_type, previous_value, new_value FROM audit_logs WHERE id = ${logged}::uuid`;
    });
    expect(seenByAdmin).toHaveLength(1);
    expect(seenByAdmin[0]).toMatchObject({ action: "settings.restaurant.update", entity_type: "restaurants" });

    const seenByStaff = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`SELECT id FROM audit_logs WHERE id = ${logged}::uuid`;
    });
    expect(seenByStaff).toHaveLength(0);
  });

  it("log_audit_event records the calling admin as actor_staff_id via auth.uid()", async () => {
    const fx = await createTestRestaurant();

    const logged = await withRole("authenticated", fx.adminId, async (conn) => {
      const [row] = await conn`
        SELECT public.log_audit_event(
          ${fx.restaurantId}::uuid, 'settings.tax_service_charge.update', 'restaurant_settings', ${fx.restaurantId}::uuid
        ) AS id
      `;
      return row!.id as string;
    });

    const [row] = await sql`SELECT actor_staff_id FROM audit_logs WHERE id = ${logged}`;
    expect(row!.actor_staff_id).toBe(fx.adminId);
  });
});
